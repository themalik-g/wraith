// ─────────────────────────────────────────────
// WRAITH · modules/owner.js
// Phase 3: Owner profile commands
// ─────────────────────────────────────────────
import fs from 'node:fs';
import path from 'node:path';
import { downloadContentFromMessage } from '@whiskeysockets/baileys';
import { isOwner } from '../core/identity.js';
import { readJson } from '../core/state-io.js';
import { CONFIG } from '../config.js';

function ownerOnly(sock, chat, msg) {
    const from = msg.key.participant || msg.key.remoteJid;
    if (!msg.key.fromMe && !isOwner(from)) {
        sock.sendMessage(chat, { text: '⛔ Owner only.' }, { quoted: msg }).catch(() => {});
        return true;
    }
    return false;
}

let _jimp = undefined;
async function getJimp() {
    if (_jimp !== undefined) return _jimp;
    try { _jimp = (await import('jimp')).default || null; }
    catch { _jimp = null; }
    return _jimp;
}

// ── .setpp (bot profile picture) ────────────────────────────────────────────
export async function setppCommand(sock, chat, msg, args) {
    if (ownerOnly(sock, chat, msg)) return;
    try {
        const ctx = msg.message?.extendedTextMessage?.contextInfo;
        const quoted = ctx?.quotedMessage;
        if (!quoted?.imageMessage) {
            return sock.sendMessage(chat, { text: '❌ Reply to an image with `.setpp`.' }, { quoted: msg });
        }
        const stream = await downloadContentFromMessage(quoted.imageMessage, 'image');
        const chunks = [];
        for await (const c of stream) chunks.push(c);
        let buffer = Buffer.concat(chunks);

        // ★ FIX: Baileys needs the image at 640x640 for the profile-picture
        //        preview. Without an image library it throws
        //        "no library to edit image". jimp (now in package.json)
        //        resizes/crops locally before upload.
        const Jimp = await getJimp();
        if (Jimp) {
            try {
                const img = await Jimp.read(buffer);
                img.cover(640, 640);
                buffer = await img.getBufferAsync(Jimp.MIME_JPEG);
            } catch (e) {
                console.warn('[setpp] jimp processing failed, sending raw:', e.message);
            }
        } else {
            return sock.sendMessage(chat, { text: '❌ Image library missing — run `npm install` (jimp is now in package.json).' }, { quoted: msg });
        }

        const me = (sock.user?.id || '').split(':')[0];
        const meJid = me.includes('@') ? me : `${me}@s.whatsapp.net`;
        await sock.updateProfilePicture(meJid, buffer);
        await sock.sendMessage(chat, { text: '✅ Bot profile picture updated.' }, { quoted: msg });
    } catch (e) {
        await sock.sendMessage(chat, { text: `⚠️ setpp failed: ${e.message}` }, { quoted: msg }).catch(() => {});
    }
}

// ── .setabout ───────────────────────────────────────────────────────────────
export async function setaboutCommand(sock, chat, msg, args) {
    if (ownerOnly(sock, chat, msg)) return;
    try {
        const about = (args || []).join(' ').trim();
        if (!about) return sock.sendMessage(chat, { text: '❌ Provide status text.' }, { quoted: msg });
        await sock.updateProfileStatus(about);
        await sock.sendMessage(chat, { text: '✅ About updated.' }, { quoted: msg });
    } catch (e) {
        await sock.sendMessage(chat, { text: `⚠️ setabout failed: ${e.message}` }, { quoted: msg }).catch(() => {});
    }
}

// ── .chatstats ──────────────────────────────────────────────────────────────
export async function chatstatsCommand(sock, chat, msg, args) {
    try {
        const digits = (args?.[0] || '').replace(/\D/g, '');
        if (!digits) {
            return sock.sendMessage(chat, {
                text: '📊 *chatstats*\n\nUsage: `.chatstats <number>`\nShows aggregated activity for that contact across every chat the bot has seen.',
            }, { quoted: msg });
        }
        const activity = readJson(path.join(process.cwd(), 'state', 'activity.json'), {});
        let total = 0, firstSeen = 0, lastActive = 0;
        const groupBreakdown = [];
        for (const [jid, rec] of Object.entries(activity)) {
            const contacts = rec?.contacts || {};
            const hit = Object.entries(contacts).find(([sender]) => sender.replace(/\D/g, '').includes(digits));
            if (!hit) continue;
            const [, c] = hit;
            total += c.count || 0;
            if (!firstSeen || (rec.firstSeen && rec.firstSeen < firstSeen)) firstSeen = rec.firstSeen;
            if ((c.last || 0) > lastActive) lastActive = c.last;
            groupBreakdown.push({ jid, count: c.count || 0, last: c.last || 0 });
        }
        const dmRec = activity[`${digits}@s.whatsapp.net`] || activity[`${digits}@lid`];
        const dmTotal = dmRec?.total || 0;
        if (!total && !dmTotal) {
            return sock.sendMessage(chat, { text: `❌ No recorded activity for \`${digits}\`.` }, { quoted: msg });
        }
        groupBreakdown.sort((a, b) => b.count - a.count);
        const lines = [
            `📊 *chatstats* — \`${digits}\``, '',
            `• messages (in groups) · *${total}*`,
            `• messages (DM with bot) · *${dmTotal}*`,
        ];
        if (firstSeen) lines.push(`• first seen · ${new Date(firstSeen).toLocaleDateString('en-GB', { timeZone: CONFIG.timezone || 'Asia/Karachi' })}`);
        if (lastActive) lines.push(`• last active · ${new Date(lastActive).toLocaleString('en-GB', { timeZone: CONFIG.timezone || 'Asia/Karachi' })}`);
        if (groupBreakdown.length) {
            lines.push('', '*active in:*');
            for (const g of groupBreakdown.slice(0, 10)) lines.push(`  \`${g.jid.split('@')[0]}\` — ${g.count} msgs`);
        }
        await sock.sendMessage(chat, { text: lines.join('\n') }, { quoted: msg });
    } catch (e) {
        await sock.sendMessage(chat, { text: `⚠️ chatstats failed: ${e.message}` }, { quoted: msg }).catch(() => {});
    }
}
