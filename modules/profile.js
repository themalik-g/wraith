// ─────────────────────────────────────────────
//  WRAITH · modules/profile.js
//  .getpp — fetch profile picture of a user,
//  group, or the current chat.
// ─────────────────────────────────────────────
import { isOwner, ownerJid } from '../core/identity.js';

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

export async function getppCommand(sock, chat, msg, args) {
    const from = msg.key.participant || msg.key.remoteJid;

    if (!msg.key.fromMe && !isOwner(from)) {
        return sock.sendMessage(chat, { text: '⛔ Owner only.' }, { quoted: msg });
    }

    let targetJid = null;
    let dest = chat;

    const destArg = (args?.[0] || '').toLowerCase();
    if (destArg === 'owner') {
        dest = ownerJid();
        args = args.slice(1);
    } else if (destArg === 'chat') {
        dest = chat;
        args = args.slice(1);
    }

    const ctx = msg.message?.extendedTextMessage?.contextInfo;

    if (ctx?.participant) {
        targetJid = ctx.participant;
    } else if (args?.[0]) {
        targetJid = await resolveTarget(sock, args[0]);
    }

    if (!targetJid) {
        targetJid = chat;
    }

    let ppUrl = null;
    try {
        ppUrl = await sock.profilePictureUrl(targetJid, 'image');
    } catch {
        try {
            ppUrl = await sock.profilePictureUrl(targetJid);
        } catch {}
    }

    if (!ppUrl) {
        return sock.sendMessage(dest, {
            text: `❌ No profile picture found for \`${targetJid.split('@')[0]}\`.`
        }, { quoted: dest === chat ? msg : undefined });
    }

    await sock.sendMessage(dest, {
        image: { url: ppUrl },
        caption: `🖼️ Profile picture of \`${targetJid.split('@')[0]}\``
    }, { quoted: dest === chat ? msg : undefined });
}
