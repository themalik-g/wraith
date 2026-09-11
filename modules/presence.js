// ─────────────────────────────────────────────
//  WRAITH · modules/presence.js
//  Always online + typing + recording + read receipts.
// ─────────────────────────────────────────────
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { isOwner } from '../core/identity.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const STATE = path.join(here, '..', 'state', 'presence.json');
const DEBUG = process.env.WRAITH_DEBUG === '1';

fs.mkdirSync(path.dirname(STATE), { recursive: true });

const DEFAULTS = {
    alwaysOnline: true,
    autoTyping: false,
    autoRecording: false,
    readReceipts: true
};

function read() {
    try {
        if (!fs.existsSync(STATE)) return { ...DEFAULTS };
        const raw = JSON.parse(fs.readFileSync(STATE, 'utf-8'));
        return { ...DEFAULTS, ...raw };
    } catch { return { ...DEFAULTS }; }
}

function write(o) {
    try { fs.writeFileSync(STATE, JSON.stringify(o, null, 2)); } catch {}
}

// ─────────────────────────────────────────────
//  Heartbeat
// ─────────────────────────────────────────────
let heartbeatTimer = null;

export function startPresenceHeartbeat(sock) {
    if (heartbeatTimer) clearInterval(heartbeatTimer);

    heartbeatTimer = setInterval(async () => {
        try {
            const s = read();
            if (s.alwaysOnline) {
                await sock.sendPresenceUpdate('available');
            }
        } catch (e) {
            if (DEBUG) console.log('[presence] heartbeat error:', e.message);
        }
    }, 8_000);
}

export function shouldReadReceipts() {
    return read().readReceipts === true;
}

// ─────────────────────────────────────────────
//  Auto typing / recording on inbound message
// ─────────────────────────────────────────────
export async function applyAutoPresence(sock, chat) {
    if (!chat || chat === 'status@broadcast') return;
    try {
        const s = read();
        if (s.autoTyping) {
            await sock.sendPresenceUpdate('composing', chat);
            setTimeout(() => {
                sock.sendPresenceUpdate('paused', chat).catch(() => {});
            }, 4000);
        } else if (s.autoRecording) {
            await sock.sendPresenceUpdate('recording', chat);
            setTimeout(() => {
                sock.sendPresenceUpdate('paused', chat).catch(() => {});
            }, 4000);
        }
    } catch (e) {
        if (DEBUG) console.log('[presence] applyAutoPresence error:', e.message);
    }
}

// ─────────────────────────────────────────────
//  .presence command
// ─────────────────────────────────────────────
export async function presenceCommand(sock, chat, msg, args) {
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
                `⚙️ *presence* — status control\n\n` +
                `always online · ${s.alwaysOnline ? '✅ on' : '❌ off'}\n` +
                `auto typing   · ${s.autoTyping ? '✅ on' : '❌ off'}\n` +
                `auto recording · ${s.autoRecording ? '✅ on' : '❌ off'}\n` +
                `read receipts · ${s.readReceipts ? '✅ on' : '❌ off'}\n\n` +
                `_.presence online on|off_\n` +
                `_.presence typing on|off_\n` +
                `_.presence recording on|off_\n` +
                `_.presence reads on|off_`
        }, { quoted: msg });
    }

    if (a0 === 'online') {
        if (a1 !== 'on' && a1 !== 'off') {
            return sock.sendMessage(chat, { text: '⚙️ use _.presence online on|off_' }, { quoted: msg });
        }
        s.alwaysOnline = a1 === 'on';
        write(s);
        try {
            if (s.alwaysOnline) await sock.sendPresenceUpdate('available');
            else await sock.sendPresenceUpdate('unavailable');
        } catch (e) {
            if (DEBUG) console.log('[presence] online toggle error:', e.message);
        }
        return sock.sendMessage(chat, {
            text: s.alwaysOnline ? '✅ Always online enabled.' : '⚫ Always online disabled.'
        }, { quoted: msg });
    }

    if (a0 === 'typing') {
        if (a1 !== 'on' && a1 !== 'off') {
            return sock.sendMessage(chat, { text: '⚙️ use _.presence typing on|off_' }, { quoted: msg });
        }
        s.autoTyping = a1 === 'on';
        if (s.autoTyping) s.autoRecording = false;
        write(s);
        return sock.sendMessage(chat, {
            text: s.autoTyping ? '⌨️ Auto-typing enabled.' : '⌨️ Auto-typing disabled.'
        }, { quoted: msg });
    }

    if (a0 === 'recording') {
        if (a1 !== 'on' && a1 !== 'off') {
            return sock.sendMessage(chat, { text: '⚙️ use _.presence recording on|off_' }, { quoted: msg });
        }
        s.autoRecording = a1 === 'on';
        if (s.autoRecording) s.autoTyping = false;
        write(s);
        return sock.sendMessage(chat, {
            text: s.autoRecording ? '🎙️ Auto-recording enabled.' : '🎙️ Auto-recording disabled.'
        }, { quoted: msg });
    }

    if (a0 === 'reads' || a0 === 'receipts') {
        if (a1 !== 'on' && a1 !== 'off') {
            return sock.sendMessage(chat, { text: '⚙️ use _.presence reads on|off_' }, { quoted: msg });
        }
        s.readReceipts = a1 === 'on';
        write(s);
        return sock.sendMessage(chat, {
            text: s.readReceipts ? '✅ Read receipts enabled.' : '✅ Read receipts disabled.'
        }, { quoted: msg });
    }

    return sock.sendMessage(chat, { text: '⚙️ unknown option.' }, { quoted: msg });
}
