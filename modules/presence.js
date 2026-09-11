// ─────────────────────────────────────────────
//  WRAITH · modules/presence.js
//  Always online, auto-typing, auto-recording,
//  read receipts toggle.
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
    try {
        fs.writeFileSync(STATE, JSON.stringify(o, null, 2));
    } catch (e) {
        if (DEBUG) console.log('[presence] write failed:', e.message);
    }
}

// ─────────────────────────────────────────────
//  Heartbeat — keep online
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
    }, 8_000); // Baileys presence expires ~10s
}

export function shouldReadReceipts() {
    return read().readReceipts === true;
}

// ─────────────────────────────────────────────
//  .presence — command
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
        s.alwaysOnline = a1 === 'on';
        write(s);
        if (s.alwaysOnline) await sock.sendPresenceUpdate('available');
        return sock.sendMessage(chat, {
            text: s.alwaysOnline ? '✅ Always online enabled.' : '⚫ Always online disabled.'
        }, { quoted: msg });
    }

    if (a0 === 'typing') {
        s.autoTyping = a1 === 'on';
        write(s);
        return sock.sendMessage(chat, {
            text: s.autoTyping ? '⌨️ Auto-typing enabled.' : '⌨️ Auto-typing disabled.'
        }, { quoted: msg });
    }

    if (a0 === 'recording') {
        s.autoRecording = a1 === 'on';
        write(s);
        return sock.sendMessage(chat, {
            text: s.autoRecording ? '🎙️ Auto-recording enabled.' : '🎙️ Auto-recording disabled.'
        }, { quoted: msg });
    }

    if (a0 === 'reads' || a0 === 'receipts') {
        s.readReceipts = a1 === 'on';
        write(s);
        return sock.sendMessage(chat, {
            text: s.readReceipts ? '✅ Read receipts enabled.' : '✅ Read receipts disabled.'
        }, { quoted: msg });
    }

    return sock.sendMessage(chat, { text: '⚙️ unknown option.' }, { quoted: msg });
}
