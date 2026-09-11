import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { isOwner } from '../core/identity.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const STATE = path.join(here, '..', 'state', 'lurk.json');

fs.mkdirSync(path.dirname(STATE), { recursive: true });
if (!fs.existsSync(STATE)) {
    fs.writeFileSync(STATE, JSON.stringify({ on: false, react: false, emoji: '❤️' }));
}

// ─────────────────────────────────────────────
//  State
// ─────────────────────────────────────────────
function read() {
    try { return JSON.parse(fs.readFileSync(STATE, 'utf-8')); }
    catch { return { on: false, react: false, emoji: '❤️' }; }
}
function write(o) {
    try { fs.writeFileSync(STATE, JSON.stringify(o, null, 2)); } catch {}
}

export function isLurking() { return read().on === true; }
function isReacting()     { return read().react === true; }
function emoji()          { return read().emoji || '❤️'; }

// A short list of nice defaults so `.lurk emoji random` has something to pick from
const RANDOM_POOL = ['❤️','🔥','👍','😮','😂','😍','🥰','😎','🙌','✨','💯','🎉','🍀','⚡','🌙'];

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
                `emoji      · ${s.emoji}\n\n` +
                `_.lurk on | off_\n` +
                `_.lurk react on | off_\n` +
                `_.lurk emoji ❤️_        — set a custom emoji\n` +
                `_.lurk emoji random_    — pick a random emoji per status\n` +
                `_.lurk emoji none_      — revert to empty reaction`
        });
    }

    if (a0 === 'on' || a0 === 'off') {
        s.on = a0 === 'on';
        write(s);
        return sock.sendMessage(chat, {
            text: s.on ? '🌒 lurk engaged.' : '🌒 lurk disengaged.'
        });
    }

    if (a0 === 'react') {
        if (a1 !== 'on' && a1 !== 'off') {
            return sock.sendMessage(chat, { text: '🌒 use _.lurk react on|off_' });
        }
        s.react = a1 === 'on';
        write(s);
        return sock.sendMessage(chat, {
            text: s.react ? '🌒 reactions enabled.' : '🌒 reactions disabled.'
        });
    }

    if (a0 === 'emoji') {
        if (!a1) {
            return sock.sendMessage(chat, { text: '🌒 use _.lurk emoji ❤️_' });
        }

        if (a1 === 'random') {
            s.emoji = 'random';
            write(s);
            return sock.sendMessage(chat, { text: '🌒 each status will get a random emoji.' });
        }

        if (a1 === 'none' || a1 === 'off') {
            s.emoji = '';
            write(s);
            return sock.sendMessage(chat, { text: '🌒 reactions will be empty (silent).' });
        }

        // Treat the argument itself as the emoji — preserve what was typed
        const chosen = args[1]; // use raw, not lowercased
        s.emoji = chosen;
        write(s);
        return sock.sendMessage(chat, { text: `🌒 reaction emoji set to ${chosen}` });
    }

    return sock.sendMessage(chat, { text: '🌒 unknown option.' });
}

// ─────────────────────────────────────────────
//  Reaction attach — supports custom emoji
// ─────────────────────────────────────────────
async function attach(sock, key) {
    if (!isReacting()) return;

    const configured = emoji();
    const chosen =
        configured === 'random'
            ? RANDOM_POOL[Math.floor(Math.random() * RANDOM_POOL.length)]
            : configured;

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
    if (!isLurking()) return;
    await new Promise(r => setTimeout(r, 800));

    const candidates = [];

    if (Array.isArray(payload?.messages)) {
        for (const m of payload.messages) {
            if (m?.key?.remoteJid === 'status@broadcast') candidates.push(m.key);
        }
    }
    if (payload?.key?.remoteJid === 'status@broadcast') {
        candidates.push(payload.key);
    }
    if (payload?.reaction?.key?.remoteJid === 'status@broadcast') {
        candidates.push(payload.reaction.key);
    }

    for (const key of candidates) {
        await viewWithRetry(sock, key);
        await attach(sock, key);
    }
}
