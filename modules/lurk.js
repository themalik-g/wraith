import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pipeline } from 'stream/promises';
import { downloadContentFromMessage } from '@whiskeysockets/baileys';
import { isOwner, ownerJid } from '../core/identity.js';
import { vaultPath, vaultMediaName, dropFromVault } from '../core/vault.js';
import { sendInteractive, createQuickReply } from '../lib/buttons.js';
import { getPrefix } from '../core/settings.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const STATE = path.join(here, '..', 'state', 'lurk.json');

const DEBUG = process.env.WRAITH_DEBUG === '1';

// ─────────────────────────────────────────────
//  State
// ─────────────────────────────────────────────
fs.mkdirSync(path.dirname(STATE), { recursive: true });
if (!fs.existsSync(STATE)) {
    fs.writeFileSync(STATE, JSON.stringify({
        on: true,
        react: true,
        emoji: '❤️',
        download: true
    }));
}

function read() {
    try {
        const raw = JSON.parse(fs.readFileSync(STATE, 'utf-8'));
        return {
            on: raw.on !== false,
            react: raw.react !== false,
            emoji: raw.emoji || '❤️',
            download: raw.download !== false
        };
    } catch {
        return { on: true, react: true, emoji: '❤️', download: true };
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

    const p = getPrefix();
    if (!a0) {
        return sendInteractive(sock, chat, {
            body:
                `🌒 *lurk* — status watcher\n\n` +
                `auto-view  · ${s.on ? 'ON' : 'OFF'}\n` +
                `auto-react · ${s.react ? 'ON' : 'OFF'}\n` +
                `download   · ${s.download ? 'ON' : 'OFF'}\n` +
                `emoji      · ${s.emoji}\n`,
            footer: 'Provided by 𝗪𝗥𝗜𝗧🇭 · Select an option below',
            buttons: [
                createQuickReply(s.on ? 'Auto-View OFF' : 'Auto-View ON', `${p}lurk ${s.on ? 'off' : 'on'}`),
                createQuickReply(s.react ? 'Auto-React OFF' : 'Auto-React ON', `${p}lurk react ${s.react ? 'off' : 'on'}`),
                createQuickReply(s.download ? 'Download OFF' : 'Download ON', `${p}lurk download ${s.download ? 'off' : 'on'}`),
            ]
        }, { quoted: msg });
    }

    if (a0 === 'on' || a0 === 'off') {
        s.on = a0 === 'on';
        write(s);
        return sendInteractive(sock, chat, {
            body: `🌒 Lurk auto-view is now *${s.on ? 'ENGAGED (ON)' : 'DISENGAGED (OFF)'}*.\n\n` +
                  `auto-view  · ${s.on ? 'ON' : 'OFF'}\n` +
                  `auto-react · ${s.react ? 'ON' : 'OFF'}\n` +
                  `download   · ${s.download ? 'ON' : 'OFF'}\n` +
                  `emoji      · ${s.emoji}\n`,
            footer: 'Provided by 𝗪𝗥𝗜𝗧🇭 · Select an option below',
            buttons: [
                createQuickReply(s.on ? 'Auto-View OFF' : 'Auto-View ON', `${p}lurk ${s.on ? 'off' : 'on'}`),
                createQuickReply(s.react ? 'Auto-React OFF' : 'Auto-React ON', `${p}lurk react ${s.react ? 'off' : 'on'}`),
                createQuickReply(s.download ? 'Download OFF' : 'Download ON', `${p}lurk download ${s.download ? 'off' : 'on'}`),
            ]
        }, { quoted: msg });
    }

    if (a0 === 'react') {
        if (a1 !== 'on' && a1 !== 'off') {
            return sock.sendMessage(chat, { text: '🌒 use _.lurk react on|off_' }, { quoted: msg });
        }
        s.react = a1 === 'on';
        write(s);
        return sendInteractive(sock, chat, {
            body: `🌒 Lurk auto-react is now *${s.react ? 'ENABLED (ON)' : 'DISABLED (OFF)'}*.\n\n` +
                  `auto-view  · ${s.on ? 'ON' : 'OFF'}\n` +
                  `auto-react · ${s.react ? 'ON' : 'OFF'}\n` +
                  `download   · ${s.download ? 'ON' : 'OFF'}\n` +
                  `emoji      · ${s.emoji}\n`,
            footer: 'Provided by 𝗪𝗥𝗜𝗧🇭 · Select an option below',
            buttons: [
                createQuickReply(s.on ? 'Auto-View OFF' : 'Auto-View ON', `${p}lurk ${s.on ? 'off' : 'on'}`),
                createQuickReply(s.react ? 'Auto-React OFF' : 'Auto-React ON', `${p}lurk react ${s.react ? 'off' : 'on'}`),
                createQuickReply(s.download ? 'Download OFF' : 'Download ON', `${p}lurk download ${s.download ? 'off' : 'on'}`),
            ]
        }, { quoted: msg });
    }

    if (a0 === 'download') {
        if (a1 !== 'on' && a1 !== 'off') {
            return sock.sendMessage(chat, { text: '🌒 use _.lurk download on|off_' }, { quoted: msg });
        }
        s.download = a1 === 'on';
        write(s);
        return sendInteractive(sock, chat, {
            body: `🌒 Status download is now *${s.download ? 'ENABLED (ON)' : 'DISABLED (OFF)'}*.\n\n` +
                  `auto-view  · ${s.on ? 'ON' : 'OFF'}\n` +
                  `auto-react · ${s.react ? 'ON' : 'OFF'}\n` +
                  `download   · ${s.download ? 'ON' : 'OFF'}\n` +
                  `emoji      · ${s.emoji}\n`,
            footer: 'Provided by 𝗪𝗥𝗜𝗧🇭 · Select an option below',
            buttons: [
                createQuickReply(s.on ? 'Auto-View OFF' : 'Auto-View ON', `${p}lurk ${s.on ? 'off' : 'on'}`),
                createQuickReply(s.react ? 'Auto-React OFF' : 'Auto-React ON', `${p}lurk react ${s.react ? 'off' : 'on'}`),
                createQuickReply(s.download ? 'Download OFF' : 'Download ON', `${p}lurk download ${s.download ? 'off' : 'on'}`),
            ]
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
            statusJidList: [key.participant || key.remoteJid]
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

        // Extract media node (handle view-once / ephemeral wrappers)
        let node = null;
        let type = null;

        const wrapped =
            m.viewOnceMessageV2?.message ||
            m.viewOnceMessageV2Extension?.message ||
            m.viewOnceMessage?.message ||
            m.ephemeralMessage?.message ||
            m;

        if (wrapped.imageMessage)       { node = wrapped.imageMessage;       type = 'image'; }
        else if (wrapped.videoMessage)  { node = wrapped.videoMessage;       type = 'video'; }
        else if (wrapped.audioMessage)  { node = wrapped.audioMessage;       type = 'audio'; }

        if (!node || !type) return;

        const sender = key.participant || key.remoteJid;

        // Save to vault via stream
        const ext = type === 'image' ? 'jpg' : (type === 'video' ? 'mp4' : 'ogg');
        const fp = vaultPath(vaultMediaName(sender, 'status', key.id, ext));
        const stream = await downloadContentFromMessage(node, type);
        const writeStream = fs.createWriteStream(fp);
        await pipeline(stream, writeStream);

        // Forward to owner DM
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
//  Payload normalizer — accepts every shape
//  the socket can throw at us:
//    · messages.upsert        → { messages: [WAMessage] }
//    · status.update          → WAMessageKey[]          (array!)
//    · messages.delete        → { keys: [WAMessageKey] }
//    · single key / reaction  → { key } / { reaction: { key } }
// ─────────────────────────────────────────────
function collectCandidates(payload) {
    const out = [];
    const seen = new Set();

    function push(key, msg) {
        if (!key?.id) return;
        if (key.remoteJid !== 'status@broadcast') return;
        if (seen.has(key.id)) return;
        seen.add(key.id);
        out.push({ key, msg: msg || null });
    }

    // status.update → bare array of keys
    if (Array.isArray(payload)) {
        for (const k of payload) push(k, null);
    }

    // messages.upsert → full messages (needed for download)
    if (Array.isArray(payload?.messages)) {
        for (const m of payload.messages) push(m?.key, m);
    }

    // messages.delete → { keys: [...] }
    if (Array.isArray(payload?.keys)) {
        for (const k of payload.keys) push(k, null);
    }

    // single message / single key
    if (payload?.key?.remoteJid === 'status@broadcast') {
        push(payload.key, payload.message ? payload : null);
    }

    // reaction events
    if (payload?.reaction?.key?.remoteJid === 'status@broadcast') {
        push(payload.reaction.key, null);
    }

    return out;
}

// ─────────────────────────────────────────────
//  Handler — called by router on status events
// ─────────────────────────────────────────────
export async function lurkTick(sock, payload) {
    const s = read();

    // Silent download mode: download only, no seen/reaction
    const silentDownload = s.download && !s.on && !s.react;

    if (!s.on && !s.download) return;

    const candidates = collectCandidates(payload);
    if (!candidates.length) return;

    await new Promise(r => setTimeout(r, 800));

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
