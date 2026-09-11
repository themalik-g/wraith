import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { writeFile } from 'fs/promises';
import { downloadContentFromMessage, proto } from '@whiskeysockets/baileys';

import { isOwner, ownerJid, digitsOf } from '../core/identity.js';
import { vaultPath, dropFromVault } from '../core/vault.js';
import { CONFIG } from '../config.js';
import { extractViewOnce } from './peek.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const STATE = path.join(here, '..', 'state', 'ghost.json');
const LEDGER_FILE = path.join(here, '..', 'state', 'ghost-ledger.json');

const DEBUG = process.env.WRAITH_DEBUG === '1';

// ─────────────────────────────────────────────
//  Persistent ledger
// ─────────────────────────────────────────────
const ledger = new Map();
let saveTimer = null;

function loadLedger() {
    try {
        if (!fs.existsSync(LEDGER_FILE)) return;
        const raw = JSON.parse(fs.readFileSync(LEDGER_FILE, 'utf-8'));
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
        try {
            const obj = Object.fromEntries(ledger);
            fs.writeFileSync(LEDGER_FILE, JSON.stringify(obj));
        } catch (e) {
            if (DEBUG) console.log('[ghost] ledger save failed:', e.message);
        }
    }, 3000);
}

loadLedger();

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

    return null;
}

// ─────────────────────────────────────────────
//  State
// ─────────────────────────────────────────────
function read() {
    try { return JSON.parse(fs.readFileSync(STATE, 'utf-8')); }
    catch { return { on: false, edit: true }; }
}
function write(o) {
    try { fs.writeFileSync(STATE, JSON.stringify(o, null, 2)); } catch {}
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
// ─────────────────────────────────────────────
export async function remember(sock, msg) {
    const s = read();
    if (!s.on && !s.edit) return;

    const id = msg.key?.id;
    if (!id) return;

    if (msg.message?.protocolMessage) return;
    if (msg.message?.secretEncryptedMessage) return;

    const record = {
        from: msg.key.participant || msg.key.remoteJid,
        scope: msg.key.remoteJid?.endsWith('@g.us') ? msg.key.remoteJid : null,
        text: '',
        media: null,
        file: null,
        at: Date.now()
    };

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
        else if (msg.message?.imageMessage) {
            record.media = 'image';
            record.text = msg.message.imageMessage.caption || '';
            const buf = await grab(msg.message.imageMessage, 'image');
            const fp = vaultPath(`${id}.jpg`);
            await writeFile(fp, buf);
            record.file = fp;
        }
        else if (msg.message?.videoMessage) {
            record.media = 'video';
            record.text = msg.message.videoMessage.caption || '';
            const buf = await grab(msg.message.videoMessage, 'video');
            const fp = vaultPath(`${id}.mp4`);
            await writeFile(fp, buf);
            record.file = fp;
        }
        else if (msg.message?.audioMessage) {
            record.media = 'audio';
            const mime = msg.message.audioMessage.mimetype || '';
            const ext = mime.includes('ogg') ? 'ogg' : 'mp3';
            const buf = await grab(msg.message.audioMessage, 'audio');
            const fp = vaultPath(`${id}.${ext}`);
            await writeFile(fp, buf);
            record.file = fp;
        }
        else if (msg.message?.stickerMessage) {
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

    const targetId = pm.key.id;
    const culprit = msg.participant || msg.key?.participant || msg.key?.remoteJid;

    const selfNum = digitsOf(sock.user?.id || '');
    if (culprit && digitsOf(culprit) === selfNum) return;

    const rec = ledger.get(targetId);
    if (!rec) return;

    const owner = ownerJid();
    const stamp = new Date().toLocaleString('en-GB', {
        hour12: true,
        timeZone: 'Asia/Karachi',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });

    let scope = '';
    if (rec.scope) {
        try { scope = (await sock.groupMetadata(rec.scope)).subject; } catch {}
    }

    const lines = [
        `👻 *ghost ledger · erased*`,
        ``,
        `*erased by ·* @${digitsOf(culprit)}`,
        `*original sender ·* @${digitsOf(rec.from)}`,
        `*when ·* ${stamp}`
    ];
    if (scope) lines.push(`*chat ·* ${scope}`);
    if (rec.text) lines.push(``, `*what was said*`, rec.text);

    await sock.sendMessage(owner, {
        text: lines.join('\n'),
        mentions: [culprit, rec.from]
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
//  REVEAL — legacy edit (protocolMessage)
// ─────────────────────────────────────────────
export async function revealEdit(sock, msg) {
    const s = read();
    if (!s.edit) return;

    const { pm } = unwrapProtocol(msg);
    if (!pm) return;

    const targetId = pm.key?.id;

    const afterText =
        bodyText(pm.editedMessage) ||
        bodyText(pm.editedMessage?.message) ||
        bodyText(pm.editedMessage?.extendedTextMessage) ||
        '';

    const rec = targetId ? ledger.get(targetId) : null;

    if (DEBUG) {
        console.log('[ghost:edit] payload →', JSON.stringify({
            targetId,
            editedMessageKeys: pm.editedMessage ? Object.keys(pm.editedMessage) : [],
            afterText: afterText.slice(0, 80)
        }, null, 2));
    }

    const originalText = rec?.text || '';
    const editor = msg.participant || msg.key?.participant || msg.key?.remoteJid;
    const originalSender = rec?.from || editor;

    if (rec) {
        rec.text = afterText || rec.text;
        rec.editedAt = Date.now();
        ledger.set(targetId, rec);
        scheduleSave();
    }

    const stamp = pm.timestampMs
        ? new Date(pm.timestampMs).toLocaleString('en-GB', {
              hour12: true,
              timeZone: 'Asia/Karachi',
              day: '2-digit',
              month: 'short',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
          })
        : new Date().toLocaleString('en-GB', {
              hour12: true,
              timeZone: 'Asia/Karachi',
              day: '2-digit',
              month: 'short',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
          });

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
        `*when ·* ${stamp}`
    ];
    if (scope) lines.push(`*chat ·* ${scope}`);

    lines.push(``);
    lines.push(`*before*`);
    if (originalText) {
        lines.push(originalText);
    } else {
        lines.push('_…not captured (message arrived before antiedit was armed)_');
    }

    lines.push(``);
    lines.push(`*after*`);
    lines.push(afterText || '_…empty (could not extract new content)_');

    await sock.sendMessage(owner, {
        text: lines.join('\n'),
        mentions: [editor, originalSender]
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
    const editor = msg.key?.participant || msg.key?.remoteJid;

    console.log('\n[ghost:secret-edit] →', JSON.stringify({
        targetId,
        editor,
        fromMe: msg.key?.fromMe,
        hasPayload: !!sem.encPayload,
        payloadBytes: sem.encPayload?.length || 0
    }, null, 2));

    const rec = targetId ? ledger.get(targetId) : null;
    const originalText = rec?.text || '';
    const originalSender = rec?.from || editor;

    const stamp = new Date().toLocaleString('en-GB', {
        hour12: true,
        timeZone: 'Asia/Karachi',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });

    let scope = '';
    if (rec?.scope) {
        try { scope = (await sock.groupMetadata(rec.scope)).subject; } catch {}
    }

    const lines = [
        `👻 *ghost ledger · edited*`,
        ``,
        `*edited by ·* @${digitsOf(editor)}`,
        `*original sender ·* @${digitsOf(originalSender)}`,
        `*when ·* ${stamp}`
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
        mentions: [editor, originalSender]
    });

    if (rec) {
        rec.editedAt = Date.now();
        ledger.set(targetId, rec);
        scheduleSave();
    }
}

// ─────────────────────────────────────────────
//  REVEAL — edit (from messages.update channel)
// ─────────────────────────────────────────────
export async function revealEditFromUpdate(sock, update) {
    const s = read();
    if (!s.edit) return;

    const key = update?.key;
    if (!key?.id) return;

    const pm =
        update?.update?.message?.protocolMessage ||
        update?.update?.protocolMessage ||
        update?.message?.protocolMessage;

    if (!pm) return;

    const targetId = pm.key?.id || key.id;

    const afterText =
        bodyText(pm.editedMessage) ||
        bodyText(pm.editedMessage?.message) ||
        bodyText(pm.editedMessage?.extendedTextMessage) ||
        '';

    const rec = ledger.get(targetId);
    const originalText = rec?.text || '';
    const editor = update.participant || key.participant || key.remoteJid;
    const originalSender = rec?.from || editor;

    const selfNum = digitsOf(sock.user?.id || '');
    if (editor && digitsOf(editor) === selfNum) return;

    if (rec) {
        rec.text = afterText || rec.text;
        rec.editedAt = Date.now();
        ledger.set(targetId, rec);
        scheduleSave();
    }

    const stamp = new Date().toLocaleString('en-GB', {
        hour12: true,
        timeZone: 'Asia/Karachi',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });

    const owner = ownerJid();

    const lines = [
        `👻 *ghost ledger · edited*`,
        ``,
        `*edited by ·* @${digitsOf(editor)}`,
        `*original sender ·* @${digitsOf(originalSender)}`,
        `*when ·* ${stamp}`,
        ``,
        `*before*`,
        originalText || '_…not captured_',
        ``,
        `*after*`,
        afterText || '_…empty_'
    ];

    await sock.sendMessage(owner, {
        text: lines.join('\n'),
        mentions: [editor, originalSender]
    });
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
