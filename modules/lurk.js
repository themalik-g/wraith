import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { downloadContentFromMessage } from '@whiskeysockets/baileys';
import { isOwner, ownerJid } from '../core/identity.js';
import { vaultPath, dropFromVault } from '../core/vault.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const STATE = path.join(here, '..', 'state', 'lurk.json');

const DEBUG = process.env.WRAITH_DEBUG === '1';

// ─────────────────────────────────────────────
//  State
// ─────────────────────────────────────────────
fs.mkdirSync(path.dirname(STATE), { recursive: true });
if (!fs.existsSync(STATE)) {
    fs.writeFileSync(STATE, JSON.stringify({
        on: false,
        react: false,
        emoji: '❤️',
        download: false
    }));
}

function read() {
    try {
        const raw = JSON.parse(fs.readFileSync(STATE, 'utf-8'));
        return {
            on: raw.on === true,
            react: raw.react === true,
            emoji: raw.emoji || '❤️',
            download: raw.download === true
        };
    } catch {
        return { on: false, react: false, emoji: '❤️', download: false };
    }
}

function write(o) {
    try { fs.writeFileSync(STATE, JSON.stringify(o, null, 2)); } catch {}
}

export function isLurking() { return read().on === true; }
function isReacting()     { return read().react === true; }
function isDownloading()  { return read().download === true; }
function emoji()          { return read().emoji || '❤️'; }

const RANDOM_POOL = ['❤️','🔥','👍','😮','😂','😍','🥰','😎','🙌','✨','💯','🎉','🍀','⚡','🌙'];

function pickEmoji() {
    const e = emoji();
    if (e === 'random') return RANDOM_POOL[Math.floor(Math.random() * RANDOM_POOL.length)];
    return e;
}

// ─────────────────────────────────────────────
//  .lurk — command
// ─────────────────────────────────────────────
export async function lurkCommand(sock, chat, msg, args) {
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
                `🌒 *lurk* — status watcher\n\n` +
                `auto-view  · ${s.on ? 'on' : 'off'}\n` +
                `auto-react · ${s.react ? 'on' : 'off'}\n` +
                `download   · ${s.download ? 'on' : 'off'}\n` +
                `emoji      · ${s.emoji}\n\n` +
                `_.lurk on | off_\n` +
                `_.lurk react on | off_\n` +
                `_.lurk download on | off_\n` +
                `_.lurk emoji ❤️_        — set a custom emoji\n` +
                `_.lurk emoji random_    — pick a random emoji per status\n` +
                `_.lurk emoji none_      — revert to empty reaction\n\n` +
                `_When download is ON and auto-view/react are OFF,\n` +
                `statuses are downloaded without sending seen or reaction._`
        }, { quoted: msg });
    }

    if (a0 === 'on' || a0 === 'off') {
        s.on = a0 === 'on';
        write(s);
        return sock.sendMessage(chat, {
            text: s.on ? '🌒 lurk engaged.' : '🌒 lurk disengaged.'
        }, { quoted: msg });
    }

    if (a0 === 'react') {
        if (a1 !== 'on' && a1 !== 'off') {
            return sock.sendMessage(chat, { text: '🌒 use _.lurk react on|off_' }, { quoted: msg });
        }
        s.react = a1 === 'on';
        write(s);
        return sock.sendMessage(chat, {
            text: s.react ? '🌒 reactions enabled.' : '🌒 reactions disabled.'
        }, { quoted: msg });
    }

    if (a0 === 'download') {
        if (a1 !== 'on' && a1 !== 'off') {
            return sock.sendMessage(chat, { text: '🌒 use _.lurk download on|off_' }, { quoted: msg });
        }
        s.download = a1 === 'on';
        write(s);
        return sock.sendMessage(chat, {
            text: s.download
                ? '🌒 status download enabled. When auto-view/react are off, statuses will be saved silently.'
                : '🌒 status download disabled.'
        }, { quoted: msg });
    }

    if (a0 === 'emoji') {
        if (!a1) {
            return sock.sendMessage(chat, { text: '🌒 use _.lurk emoji ❤️_' }, { quoted: msg });
        }

        if (a1 === 'random') {
            s.emoji = 'random';
            write(s);
            return sock.sendMessage(chat, { text: '🌒 each status will get a random emoji.' }, { quoted: msg });
        }

        if (a1 === 'none' || a1 === 'off') {
            s.emoji = '';
            write(s);
            return sock.sendMessage(chat, { text: '🌒 reactions will be empty (silent).' }, { quoted: msg });
        }

        const chosen = args[1];
        s.emoji = chosen;
        write(s);
        return sock.sendMessage(chat, { text: `🌒 reaction emoji set to ${chosen}` }, { quoted: msg });
    }

    return sock.sendMessage(chat, { text: '🌒 unknown option.' }, { quoted: msg });
}

// ─────────────────────────────────────────────
//  Reaction attach
// ─────────────────────────────────────────────
async function attach(sock, key) {
    if (!isReacting()) return;

    const chosen = pickEmoji();

    try {
        await sock.relayMessage('status@broadcast', {
            reactionMessage: {
                key: {
                    remoteJid: 'status@broadcast',
                    id: key.id,
                    participant: key.participant || key.remoteJid,
                    fromMe: false
                },
                text: chosen
            }
        }, {
            messageId: key.id,
            statusJidList: [key.remoteJid, key.participant || key.remoteJid]
        });
    } catch {}
}

// ─────────────────────────────────────────────
//  Download status media without seen/reaction
// ─────────────────────────────────────────────
async function downloadStatus(sock, key, statusMsg) {
    if (!isDownloading()) return;

    try {
        const m = statusMsg?.message;
        if (!m) return;

        // Extract media node
        let node = null;
        let type = null;

        if (m.imageMessage) { node = m.imageMessage; type = 'image'; }
        else if (m.videoMessage) { node = m.videoMessage; type = 'video'; }
        else if (m.audioMessage) { node = m.audioMessage; type = 'audio'; }
        else {
            // Check wrapped shapes
            const wrapped =
                m.viewOnceMessageV2?.message ||
                m.viewOnceMessageV2Extension?.message ||
                m.viewOnceMessage?.message ||
                m.ephemeralMessage?.message;

            if (wrapped?.imageMessage) { node = wrapped.imageMessage; type = 'image'; }
            else if (wrapped?.videoMessage) { node = wrapped.videoMessage; type = 'video'; }
            else if (wrapped?.audioMessage) { node = wrapped.audioMessage; type = 'audio'; }
        }

        if (!node || !type) return;

        // Download to buffer
        const stream = await downloadContentFromMessage(node, type);
        const chunks = [];
        for await (const c of stream) chunks.push(c);
        const buf = Buffer.concat(chunks);

        // Save to vault
        const ext = type === 'image' ? 'jpg' : (type === 'video' ? 'mp4' : 'ogg');
        const fp = vaultPath(`${key.id}.${ext}`);
        fs.writeFileSync(fp, buf);

        // Forward to owner DM
        const sender = key.participant || key.remoteJid;
        const caption = `🌒 *status captured* · ${type}\nfrom @${sender.split('@')[0]}`;

        const sendOpts = { caption, mentions: [sender] };

        if (type === 'image') {
            await sock.sendMessage(ownerJid(), { image: { url: fp }, ...sendOpts });
        } else if (type === 'video') {
            await sock.sendMessage(ownerJid(), { video: { url: fp }, ...sendOpts });
        } else if (type === 'audio') {
            await sock.sendMessage(ownerJid(), {
                audio: { url: fp },
                mimetype: node.mimetype || 'audio/mpeg',
                ptt: false,
                ...sendOpts
            });
        }

        dropFromVault(fp);
        if (DEBUG) console.log(`[lurk:download] captured ${type} from ${sender}`);
    } catch (e) {
        if (DEBUG) console.log('[lurk:download] error:', e.message);
    }
}

// ─────────────────────────────────────────────
//  View with retry
// ─────────────────────────────────────────────
async function viewWithRetry(sock, key) {
    try {
        await sock.readMessages([key]);
    } catch (e) {
        if (String(e.message).includes('rate-overlimit')) {
            await new Promise(r => setTimeout(r, 2500));
            try { await sock.readMessages([key]); } catch {}
        }
    }
}

// ─────────────────────────────────────────────
//  Handler — called by router on status events
// ─────────────────────────────────────────────
export async function lurkTick(sock, payload) {
    const s = read();

    // Silent download mode: download only, no seen/reaction
    const silentDownload = s.download && !s.on && !s.react;

    if (!s.on && !s.download) return;

    await new Promise(r => setTimeout(r, 800));

    const candidates = [];

    if (Array.isArray(payload?.messages)) {
        for (const m of payload.messages) {
            if (m?.key?.remoteJid === 'status@broadcast') {
                candidates.push({ key: m.key, msg: m });
            }
        }
    }
    if (payload?.key?.remoteJid === 'status@broadcast') {
        candidates.push({ key: payload.key, msg: payload });
    }
    if (payload?.reaction?.key?.remoteJid === 'status@broadcast') {
        candidates.push({ key: payload.reaction.key, msg: payload.reaction });
    }

    for (const { key, msg } of candidates) {
        // Silent download (no seen, no reaction)
        if (silentDownload) {
            await downloadStatus(sock, key, msg);
            continue;
        }

        // Normal lurk: view + optionally react + optionally download
        if (s.on) {
            await viewWithRetry(sock, key);
        }

        if (s.download) {
            await downloadStatus(sock, key, msg);
        }

        if (s.react) {
            await attach(sock, key);
        }
    }
}
