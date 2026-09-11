// ─────────────────────────────────────────────
//  WRAITH · modules/jid.js
//  .getjid — resolve JIDs, list channels,
//  get current chat JID.
// ─────────────────────────────────────────────
import { isOwner } from '../core/identity.js';

const DEBUG = process.env.WRAITH_DEBUG === '1';

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
        } catch (e) {
            if (DEBUG) console.log('[jid] onWhatsApp(number) failed:', e.message);
        }
    }

    try {
        const results = await sock.onWhatsApp(clean.replace('@', ''));
        if (results?.[0]?.jid) return results[0].jid;
    } catch (e) {
        if (DEBUG) console.log('[jid] onWhatsApp(username) failed:', e.message);
    }

    return null;
}

async function fetchJoinedChannels(sock) {
    // Try newsletterFetchAllParticipating (some forks)
    if (typeof sock.newsletterFetchAllParticipating === 'function') {
        try {
            const map = await sock.newsletterFetchAllParticipating();
            const out = [];
            for (const [jid, meta] of Object.entries(map || {})) {
                out.push({
                    jid,
                    name: meta?.name || meta?.subject || meta?.thread_metadata?.name?.text || 'Unknown'
                });
            }
            return out;
        } catch (e) {
            if (DEBUG) console.log('[jid] newsletterFetchAllParticipating failed:', e.message);
        }
    }

    // Try newsletterSubscribed
    if (typeof sock.newsletterSubscribed === 'function') {
        try {
            const arr = await sock.newsletterSubscribed();
            if (Array.isArray(arr)) {
                return arr.map(c => ({
                    jid: c.jid || c.id,
                    name: c.name || c.subject || 'Unknown'
                }));
            }
        } catch (e) {
            if (DEBUG) console.log('[jid] newsletterSubscribed failed:', e.message);
        }
    }

    return null;
}

export async function getjidCommand(sock, chat, msg, args) {
    const from = msg.key.participant || msg.key.remoteJid;

    if (!msg.key.fromMe && !isOwner(from)) {
        return sock.sendMessage(chat, { text: '⛔ Owner only.' }, { quoted: msg });
    }

    const sub = (args?.[0] || '').toLowerCase();
    const ctx = msg.message?.extendedTextMessage?.contextInfo;

    // ── .getjid channels ──
    if (sub === 'channels') {
        const channels = await fetchJoinedChannels(sock);
        if (!channels) {
            return sock.sendMessage(chat, {
                text: '❌ Your Baileys build does not expose channel listing. Try a fork that supports it.'
            }, { quoted: msg });
        }
        if (channels.length === 0) {
            return sock.sendMessage(chat, { text: '📭 You are not subscribed to any channels.' }, { quoted: msg });
        }
        const lines = ['📡 *joined channels*', ''];
        for (const c of channels) {
            lines.push(`• ${c.name}`);
            lines.push(`  \`${c.jid}\``);
        }
        return sock.sendMessage(chat, { text: lines.join('\n') }, { quoted: msg });
    }

    // ── .getjid currentchat ──
    if (sub === 'currentchat') {
        return sock.sendMessage(chat, { text: `📌 Current chat JID:\n\`${chat}\`` }, { quoted: msg });
    }

    // ── .getjid owner <target> ──
    if (sub === 'owner') {
        const targetRaw = args?.[1];
        if (!targetRaw) {
            return sock.sendMessage(chat, { text: '❌ Usage: `.getjid owner <number|@username|jid>`' }, { quoted: msg });
        }
        const jid = await resolveTarget(sock, targetRaw);
        if (!jid) {
            return sock.sendMessage(chat, { text: `❌ Could not resolve: \`${targetRaw}\`` }, { quoted: msg });
        }
        return sock.sendMessage(chat, { text: `📌 JID for \`${targetRaw}\`:\n\`${jid}\`` }, { quoted: msg });
    }

    // ── .getjid (replied user or current chat) ──
    if (ctx?.participant) {
        return sock.sendMessage(chat, {
            text: `📌 JID of replied user:\n\`${ctx.participant}\``
        }, { quoted: msg });
    }

    // Default: current chat JID
    return sock.sendMessage(chat, { text: `📌 Current chat JID:\n\`${chat}\`` }, { quoted: msg });
}
