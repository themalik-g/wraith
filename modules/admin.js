// ─────────────────────────────────────────────
//  WRAITH · modules/admin.js
//  Group admin tools — LID-aware for Baileys v7.
// ─────────────────────────────────────────────
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { isOwner } from '../core/identity.js';
import { stripDevice, jidType } from '../core/jid-resolver.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const STATE = path.join(here, '..', 'state', 'admin.json');
const DEBUG = process.env.WRAITH_DEBUG === '1';

fs.mkdirSync(path.dirname(STATE), { recursive: true });

function readState() {
    try {
        if (!fs.existsSync(STATE)) return {};
        return JSON.parse(fs.readFileSync(STATE, 'utf-8'));
    } catch { return {}; }
}

function writeState(o) {
    try { fs.writeFileSync(STATE, JSON.stringify(o, null, 2)); } catch {}
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
//  Resolve to PN JID — required by groupParticipantsUpdate
// ─────────────────────────────────────────────
async function resolveToPnJid(sock, raw, groupJid = null) {
    if (!raw) return null;
    const clean = stripDevice(raw.trim());

    if (clean.endsWith('@s.whatsapp.net')) return clean;

    if (clean.endsWith('@lid')) {
        // Try cache
        try {
            const pn = await sock.signalRepository?.lidMapping?.getPNForLID?.(clean);
            if (pn) return pn;
        } catch {}
        if (typeof sock.getPNForLID === 'function') {
            try { const pn = await sock.getPNForLID(clean); if (pn) return pn; } catch {}
        }
        // Group metadata fallback
        if (groupJid) {
            try {
                const meta = await sock.groupMetadata(groupJid);
                for (const p of meta.participants || []) {
                    const pId = stripDevice(p.id || '');
                    const pLid = stripDevice(p.lid || '');
                    if (pId === clean || pLid === clean) {
                        const pn = p.phoneNumber || p.pn;
                        if (pn) return stripDevice(pn);
                    }
                }
            } catch {}
        }
        return null;
    }

    if (clean.endsWith('@g.us') || clean.endsWith('@newsletter')) return null;

    // @username
    if (clean.startsWith('@')) {
        const username = clean.slice(1);
        if (typeof sock.findUserByUsername === 'function') {
            try {
                const user = await sock.findUserByUsername(username);
                if (user?.jid) {
                    const jid = stripDevice(user.jid);
                    if (jid.endsWith('@s.whatsapp.net')) return jid;
                    if (jid.endsWith('@lid')) {
                        try {
                            const pn = await sock.signalRepository?.lidMapping?.getPNForLID?.(jid);
                            if (pn) return pn;
                        } catch {}
                    }
                }
            } catch {}
        }
        try {
            const wa = await sock.onWhatsApp(username);
            if (wa?.[0]?.jid) return stripDevice(wa[0].jid);
        } catch {}
        return null;
    }

    // Bare number
    const digits = clean.replace(/\D/g, '');
    if (digits.length >= 7) {
        try {
            const wa = await sock.onWhatsApp(digits);
            if (wa?.[0]?.jid) {
                const jid = stripDevice(wa[0].jid);
                if (jid.endsWith('@s.whatsapp.net')) return jid;
                if (jid.endsWith('@lid')) {
                    try {
                        const pn = await sock.signalRepository?.lidMapping?.getPNForLID?.(jid);
                        if (pn) return pn;
                    } catch {}
                }
            }
        } catch {}
        return digits + '@s.whatsapp.net';
    }

    return null;
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

    const ctx = msg.message?.extendedTextMessage?.contextInfo;
    let targetRaw = null;

    if (ctx?.participant) {
        targetRaw = ctx.participant;
    } else if (args?.[0]) {
        targetRaw = args[0];
    }

    if (!targetRaw) {
        return sock.sendMessage(chat, {
            text: `❌ No target. Reply to a message or provide a number/username/JID.`
        }, { quoted: msg });
    }

    const targetJid = await resolveToPnJid(sock, targetRaw, chat);

    if (!targetJid) {
        return sock.sendMessage(chat, {
            text: `❌ Could not resolve \`${targetRaw}\` to a phone-number JID.\n\n` +
                  `Try replying to their message, or use their full number (e.g. \`923001234567\`).`
        }, { quoted: msg });
    }

    if (DEBUG) console.log(`[admin] ${action} → ${targetJid}`);

    try {
        const result = await sock.groupParticipantsUpdate(chat, [targetJid], action);
        const status = result?.[0]?.status;
        const targetNum = targetJid.split('@')[0];

        if (status === '200') {
            const labels = { remove: 'Removed', add: 'Added', promote: 'Promoted', demote: 'Demoted' };
            return sock.sendMessage(chat, {
                text: `✅ ${labels[action] || action} \`${targetNum}\`.`
            }, { quoted: msg });
        }

        const errorMap = {
            '403': 'Forbidden — user privacy settings may prevent this.',
            '404': 'User not found on WhatsApp.',
            '408': 'Request timed out.',
            '409': 'Conflict — user may already be in/out of the group.'
        };
        const reason = errorMap[status] || `Status: ${status}`;
        return sock.sendMessage(chat, {
            text: `❌ Failed to ${action} \`${targetNum}\`: ${reason}`
        }, { quoted: msg });

    } catch (e) {
        const msgText = e?.message || String(e);
        if (msgText.includes('internal-server-error') || msgText.includes('Internal Server Error')) {
            return sock.sendMessage(chat, {
                text: `❌ WhatsApp rejected the \`${action}\` request.\n\n` +
                      `Common causes:\n` +
                      `• Bot is not admin in this group\n` +
                      `• Target's privacy settings block this\n` +
                      `• Target is the group owner\n` +
                      `• User recently left — try adding them manually first`
            }, { quoted: msg });
        }
        return sock.sendMessage(chat, { text: `❌ Action failed: ${msgText}` }, { quoted: msg });
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
//  Protection handler
// ─────────────────────────────────────────────
export async function handleProtection(sock, chat, msg, text) {
    if (!chat.endsWith('@g.us')) return false;

    const settings = getGroupSettings(chat);
    if (!settings.antilink && !settings.antispam && !settings.antisticker) return false;

    const from = msg.key.participant || msg.key.remoteJid;
    if (isOwner(from)) return false;

    const senderRaw = msg.key.participant || msg.key.remoteJid;
    let senderPn = senderRaw;
    if (senderRaw?.endsWith('@lid')) {
        try {
            const pn = await sock.signalRepository?.lidMapping?.getPNForLID?.(senderRaw);
            if (pn) senderPn = pn;
        } catch {}
    }

    if (settings.antilink) {
        const linkPattern = /(https?:\/\/|www\.)\S+/i;
        if (linkPattern.test(text)) {
            try {
                await sock.sendMessage(chat, { delete: msg.key });
                await sock.sendMessage(chat, {
                    text: `🔗 Links not allowed here, @${senderPn.split('@')[0]}.`,
                    mentions: [senderPn]
                });
            } catch {}
            return true;
        }
    }

    if (settings.antispam) {
        if (text.length > 2000) {
            try {
                await sock.sendMessage(chat, { delete: msg.key });
                await sock.sendMessage(chat, {
                    text: `🚫 Message too long, @${senderPn.split('@')[0]}.`,
                    mentions: [senderPn]
                });
            } catch {}
            return true;
        }
    }

    if (settings.antisticker) {
        if (msg.message?.stickerMessage) {
            try {
                await sock.sendMessage(chat, { delete: msg.key });
                await sock.sendMessage(chat, {
                    text: `🎨 Stickers not allowed here, @${senderPn.split('@')[0]}.`,
                    mentions: [senderPn]
                });
            } catch {}
            return true;
        }
    }

    return false;
}
