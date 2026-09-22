import fs from 'fs';
import { pipeline } from 'stream/promises';
import { downloadContentFromMessage, proto } from '@whiskeysockets/baileys';

import { isOwner, ownerJid, digitsOf } from '../core/identity.js';
import { vaultPath, vaultMediaName, dropFromVault } from '../core/vault.js';
import { CONFIG } from '../config.js';
import { extractViewOnce } from './peek.js';
import { sendInteractive, createQuickReply } from '../lib/buttons.js';
import { getPrefix } from '../core/settings.js';
import { inState, statePath } from '../core/paths.js';

const STATE = () => inState('ghost.json');
const LEDGER_FILE = () => inState('ghost-ledger.json');

const DEBUG = process.env.WRAITH_DEBUG === '1';
const MAX_STORAGE_MEDIA_BYTES = 30 * 1024 * 1024; // 30 MB per file
const LEDGER_MAX = 400;      // max text entries
const MEDIA_QUEUE_MAX = 20;  // max media files on disk (FIFO)

// ─────────────────────────────────────────────
//  Persistent ledger + media FIFO queue
// ─────────────────────────────────────────────
const ledger = new Map();
const mediaQueue = []; // { id, file } — insertion order
let saveTimer = null;

function enqueueMedia(id, file) {
    if (!id || !file) return;
    // De-dup: if this id somehow already has a queue entry, drop the old file first
    const prior = mediaQueue.findIndex(x => x.id === id);
    if (prior !== -1) {
        try { dropFromVault(mediaQueue[prior].file); } catch {}
        mediaQueue.splice(prior, 1);
    }
    mediaQueue.push({ id, file });
    while (mediaQueue.length > MEDIA_QUEUE_MAX) {
        const old = mediaQueue.shift();
        try { dropFromVault(old.file); } catch {}
        const rec = ledger.get(old.id);
        if (rec && rec.file === old.file) {
            rec.file = null;  // keep text, drop attachment
            ledger.set(old.id, rec);
        }
        if (DEBUG) console.log(`[ghost] media cap: evicted file for ${old.id}`);
    }
}

function removeFromQueue(id) {
    const qi = mediaQueue.findIndex(x => x.id === id);
    if (qi !== -1) mediaQueue.splice(qi, 1);
}

function loadLedger() {
    try {
        const file = LEDGER_FILE();
        if (!fs.existsSync(file)) return;
        const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
        const cutoff = Date.now() - CONFIG.memoryTTL;
        for (const [id, rec] of Object.entries(raw)) {
            if (rec?.at >= cutoff) ledger.set(id, rec);
        }
        // Rebuild queue oldest→newest, enforce cap
        const withMedia = [...ledger.entries()].filter(([, r]) => r.file).sort((a, b) => a[1].at - b[1].at);
        const overflow = Math.max(0, withMedia.length - MEDIA_QUEUE_MAX);
        for (let i = 0; i < overflow; i++) {
            const [, r] = withMedia[i];
            dropFromVault(r.file);
            r.file = null;
        }
        for (let i = overflow; i < withMedia.length; i++) {
            const [id, r] = withMedia[i];
            mediaQueue.push({ id, file: r.file });
        }
        if (DEBUG) console.log(`[ghost] loaded ${ledger.size} entries, ${mediaQueue.length} media tracked`);
    } catch (e) {
        if (DEBUG) console.log('[ghost] ledger load failed:', e.message);
    }
}

function scheduleSave() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
        saveTimer = null;
        try {
            statePath();
            const obj = Object.fromEntries(ledger);
            fs.writeFileSync(LEDGER_FILE(), JSON.stringify(obj));
        } catch (e) {
            if (DEBUG) console.log('[ghost] ledger save failed:', e.message);
        }
    }, 3000);
}

loadLedger();

export function getLedgerEntry(id) {
    if (!id) return null;
    return ledger.get(id) || null;
}

// ─────────────────────────────────────────────
//  Protocol constants
// ─────────────────────────────────────────────
const TYPE_REVOKE       = proto.Message.ProtocolMessage.Type.REVOKE;
const TYPE_MESSAGE_EDIT = proto.Message.ProtocolMessage.Type.MESSAGE_EDIT;

const WRAPPER_KEYS = [
    'ephemeralMessage','viewOnceMessage','viewOnceMessageV2',
    'viewOnceMessageV2Extension','documentWithCaptionMessage','associatedChildMessage',
];

export function unwrapProtocol(msg) {
    if (!msg) return { pm: null, host: msg };
    let cur = msg.message;
    const seen = new Set();
    let depth = 0;
    while (cur && typeof cur === 'object' && depth < 6) {
        depth++;
        if (seen.has(cur)) break;
        seen.add(cur);
        if (cur.protocolMessage) return { pm: cur.protocolMessage, host: msg };
        let descended = false;
        for (const key of WRAPPER_KEYS) {
            const node = cur[key];
            if (!node) continue;
            if (node.protocolMessage) return { pm: node.protocolMessage, host: msg };
            if (node.message) { cur = node.message; descended = true; break; }
        }
        if (!descended) break;
    }
    return { pm: null, host: msg };
}

export function bodyText(m) {
    if (!m) return '';
    if (m.message && !m.conversation && !m.extendedTextMessage && !m.imageMessage && !m.videoMessage && !m.documentMessage) {
        return bodyText(m.message);
    }
    return (m.conversation || m.extendedTextMessage?.text || m.imageMessage?.caption ||
            m.videoMessage?.caption || m.documentMessage?.caption || m.audioMessage?.caption || '').trim();
}

export function classifyMessage(msg) {
    if (!msg?.message) return null;
    const { pm } = unwrapProtocol(msg);
    if (pm) {
        const t = pm.type;
        if (t === TYPE_REVOKE || t === 'REVOKE' || t === 0) return 'revoke';
        if (t === TYPE_MESSAGE_EDIT || t === 'MESSAGE_EDIT' || t === 14) return 'edit';
    }
    if (msg.message?.editedMessage) return 'edit';
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
    try {
        const raw = JSON.parse(fs.readFileSync(STATE(), 'utf-8'));
        return { on: raw.on !== false, edit: raw.edit !== false };
    } catch { return { on: true, edit: true }; }
}
function write(o) {
    try { statePath(); fs.writeFileSync(STATE(), JSON.stringify(o, null, 2)); } catch {}
}

async function saveStreamToFile(node, kind, filePath) {
    const stream = await downloadContentFromMessage(node, kind);
    const writeStream = fs.createWriteStream(filePath);
    await pipeline(stream, writeStream);
}

// ─────────────────────────────────────────────
//  .ghost command
// ─────────────────────────────────────────────
export async function ghostCommand(sock, chat, msg, args) {
    const from = msg.key.participant || msg.key.remoteJid;
    if (!msg.key.fromMe && !isOwner(from)) {
        return sock.sendMessage(chat, { text: '⛔ Owner only.' }, { quoted: msg });
    }
    const s = read();
    const a0 = (args?.[0] || '').toLowerCase();
    const a1 = (args?.[1] || '').toLowerCase();
    const p = getPrefix();

    const statusBody = (prefix = '') =>
        `${prefix}antidelete · ${s.on ? 'ON' : 'OFF'}\n` +
        `antiedit   · ${s.edit ? 'ON' : 'OFF'}\n` +
        `ledger     · ${ledger.size}/${LEDGER_MAX}\n` +
        `media      · ${mediaQueue.length}/${MEDIA_QUEUE_MAX} files\n`;

    const buttons = () => [
        createQuickReply(s.on ? 'Antidelete OFF' : 'Antidelete ON', `${p}ghost ${s.on ? 'off' : 'on'}`),
        createQuickReply(s.edit ? 'Antiedit OFF' : 'Antiedit ON', `${p}ghost edit ${s.edit ? 'off' : 'on'}`),
    ];

    if (!a0) {
        return sendInteractive(sock, chat, {
            body: `👻 *ghost* — watcher status\n\n${statusBody()}`,
            footer: 'Provided by 𝗪𝗥𝗔𝗜𝗧🇭',
            buttons: buttons(),
        }, { quoted: msg });
    }

    if (a0 === 'on' || a0 === 'off') {
        s.on = a0 === 'on'; write(s);
        return sendInteractive(sock, chat, {
            body: `👻 Antidelete is now *${s.on ? 'ARMED (ON)' : 'DISARMED (OFF)'}*.\n\n${statusBody()}`,
            footer: 'Provided by 𝗪𝗥𝗔𝗜𝗧🇭',
            buttons: buttons(),
        }, { quoted: msg });
    }

    if (a0 === 'edit') {
        if (a1 !== 'on' && a1 !== 'off') {
            return sock.sendMessage(chat, { text: '👻 use _.ghost edit on_ or _.ghost edit off_' }, { quoted: msg });
        }
        s.edit = a1 === 'on'; write(s);
        return sendInteractive(sock, chat, {
            body: `👻 Antiedit is now *${s.edit ? 'ARMED (ON)' : 'DISARMED (OFF)'}*.\n\n${statusBody()}`,
            footer: 'Provided by 𝗪𝗥𝗔𝗜𝗧🇭',
            buttons: buttons(),
        }, { quoted: msg });
    }

    return sock.sendMessage(chat, { text: '👻 unknown option.' }, { quoted: msg });
}

// ─────────────────────────────────────────────
//  REMEMBER
// ─────────────────────────────────────────────
export async function remember(sock, msg) {
    if (msg.key?.fromMe) return;
    const s = read();
    if (!s.on && !s.edit) return;

    const chat = msg.key?.remoteJid;
    const sender = msg.key?.participant || chat;
    if (chat?.endsWith('@newsletter') || sender?.endsWith('@newsletter')) return;

    const id = msg.key?.id;
    if (!id) return;
    if (msg.message?.protocolMessage) return;
    if (msg.message?.secretEncryptedMessage) return;
    if (msg.message?.editedMessage) return;

    const record = {
        from: msg.key.participant || msg.key.remoteJid,
        scope: msg.key.remoteJid?.endsWith('@g.us') ? msg.key.remoteJid : null,
        text: '', media: null, file: null, at: Date.now(),
    };

    try {
        const vo = extractViewOnce(msg.message);
        if (vo) {
            record.media = vo.type;
            record.text = vo.node.caption || '';
            const ext = vo.type === 'image' ? 'jpg' : (vo.type === 'video' ? 'mp4' : 'ogg');
            const fp = vaultPath(vaultMediaName(record.from, 'ghost', id, ext));
            await saveStreamToFile(vo.node, vo.type, fp);
            record.file = fp;
            try {
                const voSender = record.from;
                const caption = `👁️ *ghost captured a view-once ${vo.type}*\nfrom @${digitsOf(voSender)}`;
                let payload;
                if (vo.type === 'image') payload = { image: { url: fp }, caption, mentions: [voSender] };
                else if (vo.type === 'video') payload = { video: { url: fp }, caption, mentions: [voSender] };
                else payload = { audio: { url: fp }, mimetype: vo.node.mimetype || 'audio/mpeg', ptt: false, caption, mentions: [voSender] };
                await sock.sendMessage(ownerJid(), payload);
                dropFromVault(fp); record.file = null;
            } catch (e) { if (DEBUG) console.log('[ghost] view-once forward failed:', e.message); }
        } else if (msg.message?.imageMessage) {
            record.media = 'image';
            record.text = msg.message.imageMessage.caption || '';
            const fp = vaultPath(vaultMediaName(record.from, 'chat', id, 'jpg'));
            await saveStreamToFile(msg.message.imageMessage, 'image', fp);
            record.file = fp;
        } else if (msg.message?.videoMessage) {
            record.media = 'video';
            record.text = msg.message.videoMessage.caption || '';
            const fp = vaultPath(vaultMediaName(record.from, 'chat', id, 'mp4'));
            await saveStreamToFile(msg.message.videoMessage, 'video', fp);
            record.file = fp;
        } else if (msg.message?.audioMessage) {
            record.media = 'audio';
            const mime = msg.message.audioMessage.mimetype || '';
            const ext = mime.includes('ogg') ? 'ogg' : 'mp3';
            const fp = vaultPath(vaultMediaName(record.from, 'chat', id, ext));
            await saveStreamToFile(msg.message.audioMessage, 'audio', fp);
            record.file = fp;
        } else if (msg.message?.stickerMessage) {
            record.media = 'sticker';
            const fp = vaultPath(vaultMediaName(record.from, 'chat', id, 'webp'));
            await saveStreamToFile(msg.message.stickerMessage, 'sticker', fp);
            record.file = fp;
        } else {
            record.text = bodyText(msg.message);
        }

        if (record.file && fs.existsSync(record.file)) {
            const stat = fs.statSync(record.file);
            if (stat.size > MAX_STORAGE_MEDIA_BYTES) {
                if (DEBUG) console.log(`[ghost] media ${(stat.size / (1024 * 1024)).toFixed(1)} MB exceeds 30 MB, dropping`);
                dropFromVault(record.file);
                record.file = null;
            }
        }

        ledger.set(id, record);
        if (record.file) enqueueMedia(id, record.file);

        if (ledger.size > LEDGER_MAX) {
            const firstKey = ledger.keys().next().value;
            const firstRec = ledger.get(firstKey);
            if (firstRec?.file) dropFromVault(firstRec.file);
            ledger.delete(firstKey);
            removeFromQueue(firstKey);
        }
        scheduleSave();

        if (DEBUG) console.log(`[ghost] stored ${id} text="${record.text.slice(0, 40)}" media=${record.media || '-'}`);
    } catch (e) {
        if (DEBUG) console.log('[ghost] remember error:', e.message);
    }
}

// ─────────────────────────────────────────────
//  De-dup caches
// ─────────────────────────────────────────────
const processedDeletes = new Set();
const processedEdits = new Set();

function markProcessed(set, key, max = 500) {
    set.add(key);
    if (set.size > max) set.delete(set.values().next().value);
}

// ─────────────────────────────────────────────
//  REVEAL — delete
// ─────────────────────────────────────────────
export async function revealDelete(sock, msg) {
    if (msg.key?.fromMe) return;
    const s = read();
    if (!s.on) return;

    const { pm } = unwrapProtocol(msg);
    if (!pm?.key?.id) return;

    const targetId = pm.key.id;
    if (processedDeletes.has(targetId)) return;
    markProcessed(processedDeletes, targetId);

    const culprit = msg.participant || msg.key?.participant || msg.key?.remoteJid;
    const selfNum = digitsOf(sock.user?.id || '');
    if (culprit && digitsOf(culprit) === selfNum) return;

    const rec = ledger.get(targetId);
    if (!rec) return;
    if (rec.from && digitsOf(rec.from) === selfNum) return;

    const owner = ownerJid();
    const stamp = new Date().toLocaleString('en-GB', {
        hour12: true, timeZone: 'Asia/Karachi',
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
    });

    let scope = '';
    if (rec.scope) { try { scope = (await sock.groupMetadata(rec.scope)).subject; } catch {} }

    const lines = [
        `👻 *ghost ledger · erased*`, ``,
        `*erased by ·* @${digitsOf(culprit)}`,
        `*original sender ·* @${digitsOf(rec.from)}`,
        `*when ·* ${stamp}`,
    ];
    if (scope) lines.push(`*chat ·* ${scope}`);
    if (rec.text) lines.push(``, `*what was said*`, rec.text);

    try {
        await sock.sendMessage(owner, { text: lines.join('\n'), mentions: [culprit, rec.from] });
    } catch (e) { if (DEBUG) console.log('[ghost] reveal text failed:', e.message); }

    if (rec.media && rec.file && fs.existsSync(rec.file)) {
        const cap = `👻 erased ${rec.media} · from @${digitsOf(rec.from)}`;
        const opts = { caption: cap, mentions: [rec.from] };
        try {
            if (rec.media === 'image') await sock.sendMessage(owner, { image: { url: rec.file }, ...opts });
            else if (rec.media === 'video') await sock.sendMessage(owner, { video: { url: rec.file }, ...opts });
            else if (rec.media === 'sticker') await sock.sendMessage(owner, { sticker: { url: rec.file } });
            else if (rec.media === 'audio') await sock.sendMessage(owner, { audio: { url: rec.file }, mimetype: 'audio/mpeg', ...opts });
        } catch (e) { if (DEBUG) console.log('[ghost] reveal media failed:', e.message); }
        dropFromVault(rec.file);
    }

    ledger.delete(targetId);
    removeFromQueue(targetId);
    scheduleSave();
}

// ─────────────────────────────────────────────
//  REVEAL — edit
// ─────────────────────────────────────────────
export async function revealEdit(sock, msg) {
    if (msg.key?.fromMe) return;
    const s = read();
    if (!s.edit) return;

    let pm = unwrapProtocol(msg).pm;
    if (!pm && msg.message?.editedMessage) {
        const em = msg.message.editedMessage;
        pm = { type: 14, key: em.key || msg.key, editedMessage: em.message || em };
    }
    if (!pm) return;

    const targetId = pm.key?.id || msg.key?.id;
    const afterText =
        bodyText(pm.editedMessage) ||
        bodyText(pm.editedMessage?.message) ||
        bodyText(pm.editedMessage?.extendedTextMessage) || '';

    const editDedupeKey = `${targetId || ''}:${afterText}`;
    if (processedEdits.has(editDedupeKey)) return;
    markProcessed(processedEdits, editDedupeKey);

    const rec = targetId ? ledger.get(targetId) : null;
    const originalText = rec?.text || '';
    const editor = msg.participant || msg.key?.participant || msg.key?.remoteJid;
    const originalSender = rec?.from || editor;

    const selfNum = digitsOf(sock.user?.id || '');
    if (editor && digitsOf(editor) === selfNum) return;
    if (originalSender && digitsOf(originalSender) === selfNum) return;

    if (rec && targetId) {
        rec.text = afterText || rec.text;
        rec.editedAt = Date.now();
        ledger.set(targetId, rec);
        scheduleSave();
    }

    const stamp = new Date().toLocaleString('en-GB', {
        hour12: true, timeZone: 'Asia/Karachi',
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
    });

    let scope = '';
    if (rec?.scope) { try { scope = (await sock.groupMetadata(rec.scope)).subject; } catch {} }

    const lines = [
        `👻 *ghost ledger · edited*`, ``,
        `*edited by ·* @${digitsOf(editor)}`,
        `*original sender ·* @${digitsOf(originalSender)}`,
        `*when ·* ${stamp}`,
    ];
    if (scope) lines.push(`*chat ·* ${scope}`);
    lines.push(``, `*before*`, originalText || '_…not captured (antiedit was armed after)_');
    lines.push(``, `*after*`, afterText || '_…empty (could not extract new content)_');

    try {
        await sock.sendMessage(ownerJid(), { text: lines.join('\n'), mentions: [editor, originalSender] });
    } catch (e) { if (DEBUG) console.log('[ghost] reveal edit failed:', e.message); }
}

// ─────────────────────────────────────────────
//  REVEAL — secret encrypted edit
// ─────────────────────────────────────────────
export async function revealSecretEdit(sock, msg) {
    if (msg.key?.fromMe) return;
    const s = read();
    if (!s.edit) return;

    const sem = msg.message?.secretEncryptedMessage;
    if (!sem) return;

    const targetId = sem.targetMessageKey?.id || msg.key?.id;
    const editor = msg.key?.participant || msg.key?.remoteJid;
    const rec = targetId ? ledger.get(targetId) : null;
    const originalText = rec?.text || '';
    const originalSender = rec?.from || editor;

    const selfNum = digitsOf(sock.user?.id || '');
    if (editor && digitsOf(editor) === selfNum) return;
    if (originalSender && digitsOf(originalSender) === selfNum) return;

    const stamp = new Date().toLocaleString('en-GB', {
        hour12: true, timeZone: 'Asia/Karachi',
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
    });

    let scope = '';
    if (rec?.scope) { try { scope = (await sock.groupMetadata(rec.scope)).subject; } catch {} }

    const lines = [
        `👻 *ghost ledger · edited*`, ``,
        `*edited by ·* @${digitsOf(editor)}`,
        `*original sender ·* @${digitsOf(originalSender)}`,
        `*when ·* ${stamp}`,
    ];
    if (scope) lines.push(`*chat ·* ${scope}`);
    lines.push(``, `*before*`, originalText || '_…not captured_');
    lines.push(``, `*after*`, '_…new text is encrypted by WhatsApp and cannot be read on linked devices_');

    try {
        await sock.sendMessage(ownerJid(), { text: lines.join('\n'), mentions: [editor, originalSender] });
    } catch (e) { if (DEBUG) console.log('[ghost] reveal secret failed:', e.message); }

    if (rec && targetId) { rec.editedAt = Date.now(); ledger.set(targetId, rec); scheduleSave(); }
}

// ─────────────────────────────────────────────
//  Housekeeping — 24 h TTL sweep + orphan media GC
// ─────────────────────────────────────────────
setInterval(() => {
    try {
        const cutoff = Date.now() - CONFIG.memoryTTL;
        let changed = false;
        for (const [id, rec] of ledger.entries()) {
            if (rec.at < cutoff) {
                if (rec.file) dropFromVault(rec.file);
                ledger.delete(id);
                removeFromQueue(id);
                changed = true;
            }
        }
        for (let i = mediaQueue.length - 1; i >= 0; i--) {
            const q = mediaQueue[i];
            const rec = ledger.get(q.id);
            if (!rec || rec.file !== q.file) {
                try { dropFromVault(q.file); } catch {}
                mediaQueue.splice(i, 1);
            }
        }
        if (changed) scheduleSave();
    } catch (e) {
        if (DEBUG) console.log('[ghost] sweeper error:', e.message);
    }
}, 5 * 60 * 1000);
