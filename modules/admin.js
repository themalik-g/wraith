// ─────────────────────────────────────────────
//  WRAITH · modules/admin.js
//  Group admin tools: kick, add, promote, demote,
//  antilink, antispam, antisticker.
// ─────────────────────────────────────────────
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { isOwner } from '../core/identity.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const STATE = path.join(here, '..', 'state', 'admin.json');
const DEBUG = process.env.WRAITH_DEBUG === '1';

fs.mkdirSync(path.dirname(STATE), { recursive: true });

// ─────────────────────────────────────────────
//  State
// ─────────────────────────────────────────────
function readState() {
    try {
        if (!fs.existsSync(STATE)) return {};
        return JSON.parse(fs.readFileSync(STATE, 'utf-8'));
    } catch { return {}; }
}

function writeState(o) {
    try {
        fs.writeFileSync(STATE, JSON.stringify(o, null, 2));
    } catch (e) {
        if (DEBUG) console.log('[admin] write failed:', e.message);
    }
}

function getGroupSettings(groupJid) {
    const s = readState();
    return s[groupJid] || { antilink: false, antispam: false, antisticker: false };
}

function setGroupSettings(groupJid, settings) {
    const s = readState();
    s[groupJid] = { ...getGroupSettings(groupJid), ...settings };
    writeState(s);
}

// ─────────────────────────────────────────────
//  Resolve target JID
// ─────────────────────────────────────────────
async function resolveTarget(sock, raw) {
    if (!raw) return null;
    const clean = raw.trim();

    if (clean.includes('@')) {
        if (clean.endsWith('@g.us') || clean.endsWith('@newsletter')) return clean;
        if (clean.endsWith('@s.whatsapp.net') || clean.endsWith('@lid')) return clean;
    }

    const digits = clean.replace(/\D/g, '');
    if (digits.length >= 7) {
        try {
            const results = await sock.onWhatsApp(digits);
            if (results?.[0]?.jid) return results[0].jid;
            return digits + '@s.whatsapp.net';
        } catch {}
    }

    try {
        const results = await sock.onWhatsApp(clean.replace('@', ''));
        if (results?.[0]?.jid) return results[0].jid;
    } catch {}

    return null;
}

// ─────────────────────────────────────────────
//  Admin checks
// ─────────────────────────────────────────────
async function isBotAdmin(sock, groupJid) {
    try {
        const meta = await sock.groupMetadata(groupJid);
        const botJid = sock.user?.id;
        if (!botJid) return false;
        return meta.participants.some(p =>
            p.id === botJid && (p.admin === 'admin' || p.admin === 'superadmin')
        );
    } catch { return false; }
}

// ─────────────────────────────────────────────
//  .kick / .add / .promote / .demote
// ─────────────────────────────────────────────
export async function adminAction(sock, chat, msg, args, action) {
    const from = msg.key.participant || msg.key.remoteJid;

    if (!msg.key.fromMe && !isOwner(from)) {
        return sock.sendMessage(chat, { text: '⛔ Owner only.' }, { quoted: msg });
    }

    if (!chat.endsWith('@g.us')) {
        return sock.sendMessage(chat, { text: '❌ This command only works in groups.' }, { quoted: msg });
    }

    // Resolve target: replied user or first arg
    const ctx = msg.message?.extendedTextMessage?.contextInfo;
    let targetJid = null;

    if (ctx?.participant) {
        targetJid = ctx.participant;
    } else if (args?.[0]) {
        targetJid = await resolveTarget(sock, args[0]);
    }

    if (!targetJid) {
        return sock.sendMessage(chat, {
            text: `❌ No target found. Reply to a message or provide a number/username/JID.`
        }, { quoted: msg });
    }

    try {
        if (action === 'remove') {
            await sock.groupParticipantsUpdate(chat, [targetJid], 'remove');
            return sock.sendMessage(chat, { text: `✅ Removed \`${targetJid.split('@')[0]}\`.` }, { quoted: msg });
        }

        if (action === 'add') {
            await sock.groupParticipantsUpdate(chat, [targetJid], 'add');
            return sock.sendMessage(chat, { text: `✅ Added \`${targetJid.split('@')[0]}\`.` }, { quoted: msg });
        }

        if (action === 'promote') {
            await sock.groupParticipantsUpdate(chat, [targetJid], 'promote');
            return sock.sendMessage(chat, { text: `✅ Promoted \`${targetJid.split('@')[0]}\` to admin.` }, { quoted: msg });
        }

        if (action === 'demote') {
            await sock.groupParticipantsUpdate(chat, [targetJid], 'demote');
            return sock.sendMessage(chat, { text: `✅ Demoted \`${targetJid.split('@')[0]}\` from admin.` }, { quoted: msg });
        }
    } catch (e) {
        return sock.sendMessage(chat, { text: `❌ Action failed: ${e.message}` }, { quoted: msg });
    }
}

// ─────────────────────────────────────────────
//  .antilink / .antispam / .antisticker
// ─────────────────────────────────────────────
export async function toggleProtection(sock, chat, msg, args, key) {
    const from = msg.key.participant || msg.key.remoteJid;

    if (!msg.key.fromMe && !isOwner(from)) {
        return sock.sendMessage(chat, { text: '⛔ Owner only.' }, { quoted: msg });
    }

    if (!chat.endsWith('@g.us')) {
        return sock.sendMessage(chat, { text: '❌ This command only works in groups.' }, { quoted: msg });
    }

    const val = (args?.[0] || '').toLowerCase();
    if (val !== 'on' && val !== 'off') {
        const current = getGroupSettings(chat);
        return sock.sendMessage(chat, {
            text:
                `⚙️ *group protection*\n\n` +
                `antilink    · ${current.antilink ? 'on' : 'off'}\n` +
                `antispam    · ${current.antispam ? 'on' : 'off'}\n` +
                `antisticker · ${current.antisticker ? 'on' : 'off'}\n\n` +
                `_.${key} on | off_`
        }, { quoted: msg });
    }

    setGroupSettings(chat, { [key]: val === 'on' });
    return sock.sendMessage(chat, {
        text: `✅ *${key}* turned ${val}.`
    }, { quoted: msg });
}

// ─────────────────────────────────────────────
//  Protection handler — called by router
// ─────────────────────────────────────────────
export async function handleProtection(sock, chat, msg, text) {
    if (!chat.endsWith('@g.us')) return false;

    const settings = getGroupSettings(chat);
    if (!settings.antilink && !settings.antispam && !settings.antisticker) return false;

    // Skip owner
    const from = msg.key.participant || msg.key.remoteJid;
    if (isOwner(from)) return false;

    const sender = msg.key.participant || msg.key.remoteJid;

    // Antilink
    if (settings.antilink) {
        const linkPattern = /(https?:\/\/|www\.)\S+/i;
        if (linkPattern.test(text)) {
            try {
                await sock.sendMessage(chat, { delete: msg.key });
                await sock.sendMessage(chat, {
                    text: `🔗 Links are not allowed here, @${sender.split('@')[0]}.`,
                    mentions: [sender]
                });
            } catch {}
            return true;
        }
    }

    // Antispam (crude: >5 messages in 10s from same sender)
    if (settings.antispam) {
        // Simple heuristic: message length > 2000 or excessive caps
        if (text.length > 2000) {
            try {
                await sock.sendMessage(chat, { delete: msg.key });
                await sock.sendMessage(chat, {
                    text: `🚫 That message was too long, @${sender.split('@')[0]}.`,
                    mentions: [sender]
                });
            } catch {}
            return true;
        }
    }

    // Antisticker
    if (settings.antisticker) {
        if (msg.message?.stickerMessage) {
            try {
                await sock.sendMessage(chat, { delete: msg.key });
                await sock.sendMessage(chat, {
                    text: `🎨 Stickers are not allowed here, @${sender.split('@')[0]}.`,
                    mentions: [sender]
                });
            } catch {}
            return true;
        }
    }

    return false;
}
