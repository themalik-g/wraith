import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { writeFile } from 'fs/promises';
import { downloadContentFromMessage, proto } from '@whiskeysockets/baileys';

import { isOwner, ownerJid, digitsOf, isOwnerChat } from '../core/identity.js';
import { vaultPath, dropFromVault } from '../core/vault.js';
import { CONFIG } from '../config.js';
import { readJson, writeJsonAtomic } from '../core/state-io.js';
import { extractViewOnce } from './peek.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const STATE = path.join(here, '..', 'state', 'ghost.json');
const LEDGER_FILE = path.join(here, '..', 'state', 'ghost-ledger.json');

const DEBUG = process.env.WRAITH_DEBUG === '1';

// ─────────────────────────────────────────────
//  Self-event guard
//  Returns true when the incoming delete/edit event
//  OR its target message originated from US:
//    · our own linked device (fromMe)
//    · a "note to self" / self-chat message
//    · the bot's own outgoing sends (peek forwards, etc.)
//  We NEVER report these — the whole point of ghost is
//  to catch OTHER people, not ourselves.
// ─────────────────────────────────────────────
function isSelfEvent(sock, msg, targetKey = null) {
    // 1) The event itself came from our device
    if (msg?.key?.fromMe) return true;

    // 2) The target message (the one being edited/revoked) was ours
    if (targetKey?.fromMe) return true;

    // 3) Sender digits match our own PN or LID
    const selfPn  = digitsOf(sock?.user?.id  || '');
    const selfLid = digitsOf(sock?.user?.lid || '');
    const culprit =
        msg?.participant ||
        msg?.key?.participant ||
        msg?.key?.remoteJid;
    if (culprit) {
        const cd = digitsOf(culprit);
        if (cd && (cd === selfPn || (selfLid && cd === selfLid))) return true;
    }

    // 4) The chat is our own DM-with-self
    if (isOwnerChat(msg?.key?.remoteJid)) return true;

    return false;
}

// ─────────────────────────────────────────────
//  Persistent ledger
// ─────────────────────────────────────────────
const ledger = new Map();
let saveTimer = null;

function loadLedger() {
    try {
        const raw = readJson(LEDGER_FILE, null);
        if (!raw) return;
        const cutoff = Date.now() - CONFIG.memoryTTL;
        for (const [id, rec] of Object.entries(raw)) {
            if (rec?.at >= cutoff) ledger.set(id, rec);
        }
        if (DEBUG) console.log(`[ghost] loaded ${ledger.size} ledger entries`);
    } catch (e) {
        if (DEBUG) console.log('[ghost] ledger load failed:', e.message);
    }
}

function scheduleSave() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
        saveTimer = null;
        writeJsonAtomic(LEDGER_FILE, Object.fromEntries(ledger));
    }, 3000);
}

loadLedger();

// ─────────────────────────────────────────────
//  Reveal dedupe.
//  The same delete/edit can arrive via BOTH
//  messages.upsert AND messages.update — without
//  this, the owner gets duplicate reports.
// ─────────────────────────────────────────────
const revealed = new Map();   // dedupeKey → timestamp
const REVEAL_WINDOW_MS = 2 * 60 * 1000;

function markRevealed(key) {
    const now = Date.now();
    revealed.set(key, now);
    if (revealed.size > 500) {
        for (const [k, ts] of revealed.entries()) {
            if (ts < now - REVEAL_WINDOW_MS) revealed.delete(k);
        }
    }
}

function wasRevealed(key) {
    const ts = revealed.get(key);
    if (ts && ts > Date.now() - REVEAL_WINDOW_MS) return true;
    markRevealed(key);
    return false;
}

// ─────────────────────────────────────────────
//  Protocol constants
// ─────────────────────────────────────────────
const TYPE_REVOKE       = proto.Message.ProtocolMessage.Type.REVOKE;
const TYPE_MESSAGE_EDIT = proto.Message.ProtocolMessage.Type.MESSAGE_EDIT;

const WRAPPER_KEYS = [
    'ephemeralMessage',
    'viewOnceMessage',
    'viewOnceMessageV2',
    'viewOnceMessageV2Extension',
    'documentWithCaptionMessage',
    'associatedChildMessage'
];

// ─────────────────────────────────────────────
//  Unwrap envelope to find protocolMessage
// ─────────────────────────────────────────────
export function unwrapProtocol(msg) {
    if (!msg) return { pm: null, host: msg };

    let cur = msg.message;
    const seen = new Set();
    let depth = 0;

    while (cur && typeof cur === 'object' && depth < 6) {
        depth++;
        if (seen.has(cur)) break;
        seen.add(cur);

        if (cur.protocolMessage) {
            return { pm: cur.protocolMessage, host: msg };
        }

        let descended = false;
        for (const key of WRAPPER_KEYS) {
            const node = cur[key];
            if (!node) continue;
            if (node.protocolMessage) {
                return { pm: node.protocolMessage, host: msg };
            }
            if (node.message) {
                cur = node.message;
                descended = true;
                break;
            }
        }

        if (!descended) break;
    }

    return { pm: null, host: msg };
}

// ─────────────────────────────────────────────
//  Text extraction
// ─────────────────────────────────────────────
export function bodyText(m) {
    if (!m) return '';

    if (
        m.message &&
        !m.conversation &&
        !m.extendedTextMessage &&
        !m.imageMessage &&
        !m.videoMessage &&
        !m.documentMessage
    ) {
        return bodyText(m.message);
    }

    return (
        m.conversation ||
        m.extendedTextMessage?.text ||
        m.imageMessage?.caption ||
        m.videoMessage?.caption ||
        m.documentMessage?.caption ||
        m.audioMessage?.caption ||
        ''
    ).trim();
}

// ─────────────────────────────────────────────
//  Classifier — handles BOTH legacy and new
//  edit delivery mechanisms.
//
//  Legacy:  protocolMessage { type: 14 }
//  New:     secretEncryptedMessage { secretEncType: 2 }
//  LID:     update.message.editedMessage (no protocolMessage)
// ─────────────────────────────────────────────
export function classifyMessage(msg) {
    if (!msg?.message) return null;

    // ── Legacy path: protocolMessage ──
    const { pm } = unwrapProtocol(msg);
    if (pm) {
        const t = pm.type;
        if (t === TYPE_REVOKE || t === 'REVOKE' || t === 0) return 'revoke';
        if (t === TYPE_MESSAGE_EDIT || t === 'MESSAGE_EDIT' || t === 14) return 'edit';
    }

    // ── New path: secretEncryptedMessage ──
    const sem = msg.message?.secretEncryptedMessage;
    if (sem) {
        const t = sem.secretEncType;
        if (t === 2 || t === 'MESSAGE_EDIT') return 'secret_edit';
        if (t === 1 || t === 'EVENT_EDIT') return 'secret_edit';
    }

    // ── LID path: editedMessage wrapper without protocolMessage ──
    if (msg.message?.editedMessage) return 'edit';

    return null;
}

// ─────────────────────────────────────────────
//  State
// ─────────────────────────────────────────────
function read() {
    return { on: true, edit: true, ...readJson(STATE, {}) };
}
function write(o) {
    writeJsonAtomic(STATE, o);
}

// ─────────────────────────────────────────────
//  Media download helper
// ─────────────────────────────────────────────
async function grab(node, kind) {
    const stream = await downloadContentFromMessage(node, kind);
    const chunks = [];
    for await (const c of stream) chunks.push(c);
    return Buffer.concat(chunks);
}

// ─────────────────────────────────────────────
//  Timestamp helper
// ─────────────────────────────────────────────
function stamp(ts = Date.now()) {
    return new Date(ts).toLocaleString('en-GB', {
        hour12: true,
        timeZone: CONFIG.timezone || 'Asia/Karachi',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

// ─────────────────────────────────────────────
//  .ghost — command
// ─────────────────────────────────────────────
export async function ghostCommand(sock, chat, msg, args) {
    const from = msg.key.participant || msg.key.remoteJid;

    if (!msg.key.fromMe && !isOwner(from)) {
        return sock.sendMessage(chat, { text: '⛔ Owner only.' }, { quoted: msg });
    }

    const s = read();
    const a0 = (args?.[0] || '').toLowerCase();
    const a1 = (args?.[1] || '').toLowerCase();

    if (!a0) {
        return sock.sendMessage(chat, {
            text:
                `👻 *ghost* — watcher status\n\n` +
                `antidelete · ${s.on ? 'on' : 'off'}\n` +
                `antiedit   · ${s.edit ? 'on' : 'off'}\n` +
                `ledger     · ${ledger.size} entries\n\n` +
                `_.ghost on | off_          — toggle antidelete\n` +
                `_.ghost edit on | off_     — toggle antiedit\n` +
                `_.ghost_                    — show this`
        }, { quoted: msg });
    }

    if (a0 === 'on' || a0 === 'off') {
        s.on = a0 === 'on';
        write(s);
        return sock.sendMessage(chat, {
            text: s.on ? '👻 antidelete armed.' : '👻 antidelete disarmed.'
        }, { quoted: msg });
    }

    if (a0 === 'edit') {
        if (a1 !== 'on' && a1 !== 'off') {
            return sock.sendMessage(chat, {
                text: '👻 use _.ghost edit on_ or _.ghost edit off_'
            }, { quoted: msg });
        }
        s.edit = a1 === 'on';
        write(s);
        return sock.sendMessage(chat, {
            text: s.edit ? '👻 antiedit armed.' : '👻 antiedit disarmed.'
        }, { quoted: msg });
    }

    return sock.sendMessage(chat, { text: '👻 unknown option.' }, { quoted: msg });
}

// ─────────────────────────────────────────────
//  REMEMBER — store every inbound message
//
//  ★ FIXED: The guard that skipped messages with
//    `msg.message?.protocolMessage` was too broad
//    and caused original messages in LID mode to
//    be dropped. We now only skip if there is a
//    protocolMessage AND no regular content, and
//    we do NOT skip secretEncryptedMessage at this
//    stage (they carry no storable content anyway,
//    but the guard was ambiguous).
//
//  Skips:
//   · our own outgoing messages (fromMe)
//   · messages where the sender IS us (self-chat quirk)
//   · status@broadcast
//   · owner DM (prevents report feedback loop)
//   · protocol / secretEncrypted control messages
//     (only when they carry NO regular content)
// ─────────────────────────────────────────────
export async function remember(sock, msg) {
    const s = read();
    if (!s.on && !s.edit) return;

    // Never store our own activity
    if (isSelfEvent(sock, msg)) return;

    if (msg.key?.remoteJid === 'status@broadcast') return;

    const id = msg.key?.id;
    if (!id) return;

    // ★ FIX: only skip if this is PURELY a control message
    //        (protocolMessage / secretEncryptedMessage) with
    //        no regular content. Previously this dropped
    //        legitimate messages that happened to have a
    //        protocolMessage sibling in LID mode.
    const hasProto = msg.message?.protocolMessage;
    const hasSecret = msg.message?.secretEncryptedMessage;
    const hasContent = !!(
        msg.message?.conversation ||
        msg.message?.extendedTextMessage ||
        msg.message?.imageMessage ||
        msg.message?.videoMessage ||
        msg.message?.audioMessage ||
        msg.message?.documentMessage ||
        msg.message?.stickerMessage
    );

    if ((hasProto || hasSecret) && !hasContent) return;

    const record = {
        from: msg.key.participant || msg.key.remoteJid,
        scope: msg.key.remoteJid?.endsWith('@g.us') ? msg.key.remoteJid : null,
        text: '',
        media: null,
        file: null,
        at: Date.now()
    };

    // Final safety: if the resolved sender is still us, skip
    const selfPn = digitsOf(sock?.user?.id || '');
    if (record.from && selfPn && digitsOf(record.from) === selfPn) return;

    try {
        const vo = extractViewOnce(msg.message);

        if (vo) {
            record.media = vo.type;
            record.text = vo.node.caption || '';

            const ext = vo.type === 'image' ? 'jpg' : (vo.type === 'video' ? 'mp4' : 'ogg');
            const buf = await grab(vo.node, vo.type);
            const fp = vaultPath(`${id}.${ext}`);
            await writeFile(fp, buf);
            record.file = fp;

            try {
                const sender = record.from;
                const caption =
                    `👁️ *ghost captured a view-once ${vo.type}*\n` +
                    `from @${digitsOf(sender)}`;

                let payload;
                if (vo.type === 'image') {
                    payload = { image: { url: fp }, caption, mentions: [sender] };
                } else if (vo.type === 'video') {
                    payload = { video: { url: fp }, caption, mentions: [sender] };
                } else {
                    payload = {
                        audio: { url: fp },
                        mimetype: vo.node.mimetype || 'audio/mpeg',
                        ptt: false,
                        caption,
                        mentions: [sender]
                    };
                }

                await sock.sendMessage(ownerJid(), payload);
                dropFromVault(fp);
                record.file = null;
            } catch (e) {
                if (DEBUG) console.log('[ghost] view-once forward failed:', e.message);
            }
        }
        else if (s.on && msg.message?.imageMessage) {
            record.media = 'image';
            record.text = msg.message.imageMessage.caption || '';
            const buf = await grab(msg.message.imageMessage, 'image');
            const fp = vaultPath(`${id}.jpg`);
            await writeFile(fp, buf);
            record.file = fp;
        }
        else if (s.on && msg.message?.videoMessage) {
            record.media = 'video';
            record.text = msg.message.videoMessage.caption || '';
            const buf = await grab(msg.message.videoMessage, 'video');
            const fp = vaultPath(`${id}.mp4`);
            await writeFile(fp, buf);
            record.file = fp;
        }
        else if (s.on && msg.message?.audioMessage) {
            record.media = 'audio';
            const mime = msg.message.audioMessage.mimetype || '';
            const ext = mime.includes('ogg') ? 'ogg' : 'mp3';
            const buf = await grab(msg.message.audioMessage, 'audio');
            const fp = vaultPath(`${id}.${ext}`);
            await writeFile(fp, buf);
            record.file = fp;
        }
        else if (s.on && msg.message?.stickerMessage) {
            record.media = 'sticker';
            const buf = await grab(msg.message.stickerMessage, 'sticker');
            const fp = vaultPath(`${id}.webp`);
            await writeFile(fp, buf);
            record.file = fp;
        }
        else {
            record.text = bodyText(msg.message);
        }

        ledger.set(id, record);
        scheduleSave();

        if (DEBUG) {
            console.log(`[ghost] stored ${id} → text="${record.text.slice(0, 40)}" media=${record.media || '-'}`);
        }
    } catch (e) {
        if (DEBUG) console.log('[ghost] remember error:', e.message);
    }
}

// ─────────────────────────────────────────────
//  REVEAL — delete
// ─────────────────────────────────────────────
export async function revealDelete(sock, msg) {
    const s = read();
    if (!s.on) return;

    const { pm } = unwrapProtocol(msg);
    if (!pm?.key?.id) return;

    // Never report our own deletions
    if (isSelfEvent(sock, msg, pm.key)) {
        if (DEBUG) console.log('[ghost] self-delete ignored');
        return;
    }

    const targetId = pm.key.id;
    const culprit = msg.participant || msg.key?.participant || msg.key?.remoteJid;

    const rec = ledger.get(targetId);
    if (!rec) return;

    // Belt & braces: the stored record's sender must not be us
    const selfPn = digitsOf(sock?.user?.id || '');
    if (rec.from && selfPn && digitsOf(rec.from) === selfPn) {
        ledger.delete(targetId);
        scheduleSave();
        return;
    }

    // Suppress duplicate deliveries of the same revoke
    const dk = `del:${msg.key?.remoteJid || ''}:${targetId}:${digitsOf(culprit)}`;
    if (wasRevealed(dk)) {
        if (DEBUG) console.log('[ghost] duplicate revoke suppressed:', dk);
        return;
    }

    const owner = ownerJid();

    let scope = '';
    if (rec.scope) {
        try { scope = (await sock.groupMetadata(rec.scope)).subject; } catch {}
    }

    const lines = [
        `👻 *ghost ledger · erased*`,
        ``,
        `*erased by ·* @${digitsOf(culprit)}`,
        `*original sender ·* @${digitsOf(rec.from)}`,
        `*when ·* ${stamp()}`
    ];
    if (scope) lines.push(`*chat ·* ${scope}`);
    if (rec.text) lines.push(``, `*what was said*`, rec.text);

    await sock.sendMessage(owner, {
        text: lines.join('\n'),
        mentions: [culprit, rec.from].filter(Boolean)
    });

    if (rec.media && rec.file && fs.existsSync(rec.file)) {
        const cap = `👻 erased ${rec.media} · from @${digitsOf(rec.from)}`;
        const opts = { caption: cap, mentions: [rec.from] };

        try {
            if (rec.media === 'image')
                await sock.sendMessage(owner, { image: { url: rec.file }, ...opts });
            else if (rec.media === 'video')
                await sock.sendMessage(owner, { video: { url: rec.file }, ...opts });
            else if (rec.media === 'sticker')
                await sock.sendMessage(owner, { sticker: { url: rec.file } });
            else if (rec.media === 'audio')
                await sock.sendMessage(owner, { audio: { url: rec.file }, mimetype: 'audio/mpeg', ...opts });
        } catch {}

        dropFromVault(rec.file);
    }

    ledger.delete(targetId);
    scheduleSave();
}

// ─────────────────────────────────────────────
//  REVEAL — edit (handles BOTH legacy protocolMessage
//  edits AND the LID `editedMessage` wrapper)
//
//  ★ FIXED: In LID mode, Baileys 7.0.0-rc14 emits
//    messages.update with `update.message.editedMessage`
//    and an empty `key.id`. The previous implementation
//    only understood protocolMessage and returned early,
//    which is why antiedit was silent. We now branch on
//    both shapes and recover the target ID from the
//    editedMessage wrapper when present.
// ─────────────────────────────────────────────
export async function revealEdit(sock, msg) {
    const s = read();
    if (!s.edit) return;

    const { pm } = unwrapProtocol(msg);

    // ── Branch 1: classic protocolMessage edit ──
    if (pm) {
        // Never report our own edits
        if (isSelfEvent(sock, msg, pm.key)) {
            if (DEBUG) console.log('[ghost] self-edit ignored');
            return;
        }

        const targetId = pm.key?.id;

        const afterText =
            bodyText(pm.editedMessage) ||
            bodyText(pm.editedMessage?.message) ||
            bodyText(pm.editedMessage?.extendedTextMessage) ||
            '';

        return _reportEdit(sock, msg, targetId, afterText, pm.timestampMs);
    }

    // ── Branch 2: LID-mode edit (no protocolMessage) ──
    //   Shape:
    //   msg.message.editedMessage = { message: { conversation / extendedTextMessage ... } }
    //   msg.key.id is MISSING; the original ID is not recoverable
    //   from the event itself, but the editedMessage wrapper may
    //   carry a key in some Baileys builds. We try both.
    const editedWrapper = msg.message?.editedMessage;
    if (editedWrapper) {
        if (isSelfEvent(sock, msg, null)) {
            if (DEBUG) console.log('[ghost] self-edit (LID) ignored');
            return;
        }

        const targetId = editedWrapper.key?.id || msg.key?.id || null;

        const afterText =
            bodyText(editedWrapper.message) ||
            bodyText(editedWrapper.message?.extendedTextMessage) ||
            bodyText(editedWrapper) ||
            '';

        return _reportEdit(sock, msg, targetId, afterText, msg.messageTimestamp);
    }
}

// ─────────────────────────────────────────────
//  Internal: shared edit-reporting logic
//  (extracted so both branches above stay in sync)
// ─────────────────────────────────────────────
async function _reportEdit(sock, msg, targetId, afterText, timestampMs) {
    const rec = targetId ? ledger.get(targetId) : null;

    // If somehow we stored our own message, drop it and skip
    const selfPn = digitsOf(sock?.user?.id || '');
    if (rec?.from && selfPn && digitsOf(rec.from) === selfPn) {
        if (targetId) { ledger.delete(targetId); scheduleSave(); }
        return;
    }

    const editor = msg.participant || msg.key?.participant || msg.key?.remoteJid;

    // Suppress duplicate deliveries of the same edit
    const ek = `edit:${msg.key?.remoteJid || ''}:${targetId}:${digitsOf(editor)}`;
    if (wasRevealed(ek)) {
        if (DEBUG) console.log('[ghost] duplicate edit suppressed:', ek);
        return;
    }

    const originalText = rec?.text || '';
    const originalSender = rec?.from || editor;

    if (DEBUG) {
        console.log('[ghost:edit] payload →', JSON.stringify({
            targetId,
            hasRecord: !!rec,
            afterText: afterText.slice(0, 80)
        }, null, 2));
    }

    if (rec && targetId) {
        rec.text = afterText || rec.text;
        rec.editedAt = Date.now();
        ledger.set(targetId, rec);
        scheduleSave();
    }

    const owner = ownerJid();

    let scope = '';
    if (rec?.scope) {
        try { scope = (await sock.groupMetadata(rec.scope)).subject; } catch {}
    }

    const lines = [
        `👻 *ghost ledger · edited*`,
        ``,
        `*edited by ·* @${digitsOf(editor)}`,
        `*original sender ·* @${digitsOf(originalSender)}`,
        `*when ·* ${stamp(timestampMs || Date.now())}`
    ];
    if (scope) lines.push(`*chat ·* ${scope}`);

    lines.push(``);
    lines.push(`*before*`);
    lines.push(originalText || '_…not captured (message arrived before antiedit was armed)_');

    lines.push(``);
    lines.push(`*after*`);
    lines.push(afterText || '_…empty (could not extract new content)_');

    await sock.sendMessage(owner, {
        text: lines.join('\n'),
        mentions: [editor, originalSender].filter(Boolean)
    });
}

// ─────────────────────────────────────────────
//  REVEAL — secret encrypted edit (WhatsApp 2025+)
//  Edits arrive as secretEncryptedMessage; the new
//  text is encrypted and unreadable on linked devices.
//  We can still identify the target and report it.
// ─────────────────────────────────────────────
export async function revealSecretEdit(sock, msg) {
    const s = read();
    if (!s.edit) return;

    const sem = msg.message?.secretEncryptedMessage;
    if (!sem) return;

    const targetId = sem.targetMessageKey?.id;

    // Never report our own edits
    if (isSelfEvent(sock, msg, sem.targetMessageKey)) {
        if (DEBUG) console.log('[ghost] self secret-edit ignored');
        return;
    }

    const editor = msg.key?.participant || msg.key?.remoteJid;

    if (DEBUG) {
        console.log('\n[ghost:secret-edit] →', JSON.stringify({
            targetId,
            editor,
            fromMe: msg.key?.fromMe,
            hasPayload: !!sem.encPayload,
            payloadBytes: sem.encPayload?.length || 0
        }, null, 2));
    }

    // Suppress duplicates
    const ek = `sedit:${msg.key?.remoteJid || ''}:${targetId}:${digitsOf(editor)}`;
    if (wasRevealed(ek)) {
        if (DEBUG) console.log('[ghost] duplicate secret-edit suppressed:', ek);
        return;
    }

    const rec = targetId ? ledger.get(targetId) : null;

    // If somehow we stored our own message, drop it and skip
    const selfPn = digitsOf(sock?.user?.id || '');
    if (rec?.from && selfPn && digitsOf(rec.from) === selfPn) {
        if (targetId) { ledger.delete(targetId); scheduleSave(); }
        return;
    }

    const originalText = rec?.text || '';
    const originalSender = rec?.from || editor;

    let scope = '';
    if (rec?.scope) {
        try { scope = (await sock.groupMetadata(rec.scope)).subject; } catch {}
    }

    const lines = [
        `👻 *ghost ledger · edited*`,
        ``,
        `*edited by ·* @${digitsOf(editor)}`,
        `*original sender ·* @${digitsOf(originalSender)}`,
        `*when ·* ${stamp()}`
    ];
    if (scope) lines.push(`*chat ·* ${scope}`);

    lines.push(``);
    lines.push(`*before*`);
    lines.push(originalText || '_…not captured_');

    lines.push(``);
    lines.push(`*after*`);
    lines.push('_…new text is encrypted by WhatsApp and cannot be read on linked devices_');

    await sock.sendMessage(ownerJid(), {
        text: lines.join('\n'),
        mentions: [editor, originalSender].filter(Boolean)
    });

    if (rec) {
        rec.editedAt = Date.now();
        ledger.set(targetId, rec);
        scheduleSave();
    }
}

// ─────────────────────────────────────────────
//  Housekeeping — expire stale ledger entries
// ─────────────────────────────────────────────
setInterval(() => {
    const cutoff = Date.now() - CONFIG.memoryTTL;
    let changed = false;

    for (const [id, rec] of ledger.entries()) {
        if (rec.at < cutoff) {
            dropFromVault(rec.file);
            ledger.delete(id);
            changed = true;
        }
    }

    if (changed) scheduleSave();
}, 5 * 60 * 1000);
