// ─────────────────────────────────────────────
//  WRAITH · modules/jid.js
//  .getjid — resolve JIDs, list channels, get current chat JID.
// ─────────────────────────────────────────────
import { isOwner } from '../core/identity.js';
import {
    resolveBoth,
    resolveLidToPn,
    resolvePnToLid,
    resolveFromMessageKey,
    resolveFromGroup,
    resolveAllGroupMembers,
    fetchJoinedChannels,
    fetchNewsletterMeta,
    stripDevice,
    jidType
} from '../core/jid-resolver.js';

const DEBUG = process.env.WRAITH_DEBUG === '1';

function formatResult(res, inputLabel) {
    const lines = [];
    lines.push(`📌 *JID lookup* · *${inputLabel}*`);
    lines.push('');

    if (res.pn) {
        lines.push(`✅ *PN JID*`);
        lines.push(`*${res.pn}*`);
    } else {
        lines.push(`❌ *PN JID* — not found`);
        if (res.reason) lines.push(`_${res.reason}_`);
    }
    lines.push('');
    if (res.lid) {
        lines.push(`✅ *LID JID*`);
        lines.push(`*${res.lid}*`);
    } else {
        lines.push(`❌ *LID JID* — not found`);
        if (res.reason) lines.push(`_${res.reason}_`);
    }
    if (res.source) { lines.push(''); lines.push(`_source: ${res.source}_`); }
    if (res.note) { lines.push(''); lines.push(`_${res.note}_`); }
    if (res.channelName) {
        lines.push('');
        lines.push(`📛 *Channel name:* ${res.channelName}`);
        if (res.subscribers) lines.push(`👥 *Subscribers:* ${res.subscribers}`);
    }
    return lines.join('\n');
}

function formatChannels(channels, source, note) {
    if (!channels || channels.length === 0) return '📭 No channels found.';
    const lines = ['📡 *joined channels*', ''];
    for (const c of channels) {
        lines.push(`• ${c.name}`);
        lines.push(`  *${c.jid}*`);
        if (c.subscribers) lines.push(`  _${c.subscribers} subscribers_`);
    }
    if (source) lines.push(`\n_source: ${source}_`);
    if (note) lines.push(`_${note}_`);
    return lines.join('\n');
}

function formatGroupMembers(members, subject) {
    const lines = [`👥 *group members* · ${subject || 'this group'}`, ''];
    lines.push(`Total: ${members.length}`);
    lines.push('');
    for (const m of members) {
        const label = m.pn ? m.pn.split('@')[0] : (m.lid ? m.lid.split('@')[0] : 'unknown');
        const adminTag = m.admin ? ` [${m.admin}]` : '';
        lines.push(`• ${label}${adminTag}`);
        if (m.pn) lines.push(`  PN: *${m.pn}*`);
        if (m.lid) lines.push(`  LID: *${m.lid}*`);
    }
    return lines.join('\n');
}

export async function getjidCommand(sock, chat, msg, args) {
    const from = msg.key.participant || msg.key.remoteJid;
    const isChannel = chat?.endsWith('@newsletter');

    // ── In channels, allow through: only channel admins can post,
    //    and WhatsApp delivers channel posts with an ambiguous sender.
    //    Also accept remoteJidAlt as a fallback owner signal for DMs.
    const isOwnerFromAlt = msg.key?.remoteJidAlt
        ? isOwner(msg.key.remoteJidAlt)
        : false;

    const allowed =
        msg.key.fromMe ||
        isChannel ||
        isOwner(from) ||
        isOwnerFromAlt;

    if (!allowed) {
        return sock.sendMessage(chat, { text: '⛔ Owner only.' }, { quoted: msg });
    }

    const sub = (args?.[0] || '').toLowerCase();
    const ctx = msg.message?.extendedTextMessage?.contextInfo;

    // ── .getjid channels ──
    if (sub === 'channels') {
        const result = await fetchJoinedChannels(sock);
        if (!result.ok) {
            return sock.sendMessage(chat, { text: `❌ ${result.reason}` }, { quoted: msg });
        }
        return sock.sendMessage(chat, {
            text: formatChannels(result.channels, result.source, result.note)
        }, { quoted: msg });
    }

    // ── .getjid currentchat ──
    if (sub === 'currentchat') {
        const chatType = jidType(chat);

        if (chatType === 'newsletter') {
            const meta = await fetchNewsletterMeta(sock, chat);
            const lines = ['📌 *Current channel*', '', '*JID*', `*${chat}*`];
            if (meta?.name) {
                lines.push('');
                lines.push(`📛 *Name:* ${meta.name}`);
                if (meta.subscribers) lines.push(`👥 *Subscribers:* ${meta.subscribers}`);
                if (meta.description) lines.push(`📝 ${meta.description}`);
            } else {
                lines.push('');
                lines.push(`_Could not fetch name. Make sure the bot is *following* this channel._`);
            }
            return sock.sendMessage(chat, { text: lines.join('\n') }, { quoted: msg });
        }

        if (chatType === 'group') {
            return sock.sendMessage(chat, {
                text: `📌 *Current chat JID*\n*${chat}*\n\n_Group — use .getjid members to list participants._`
            }, { quoted: msg });
        }

        const res = { pn: null, lid: null, source: null, reason: null };
        if (chatType === 'lid') {
            res.lid = stripDevice(chat);
            const r = await resolveLidToPn(sock, chat, null);
            if (r.pn) { res.pn = r.pn; res.source = r.source; } else { res.reason = r.reason; }
        } else if (chatType === 'pn') {
            res.pn = stripDevice(chat);
            const r = await resolvePnToLid(sock, chat);
            if (r.lid) { res.lid = r.lid; res.source = r.source; } else { res.reason = r.reason; }
        }
        return sock.sendMessage(chat, { text: formatResult(res, 'current chat') }, { quoted: msg });
    }

    // ── .getjid members ──
    if (sub === 'members') {
        if (!chat.endsWith('@g.us')) {
            return sock.sendMessage(chat, { text: '❌ This command only works in groups.' }, { quoted: msg });
        }
        const result = await resolveAllGroupMembers(sock, chat);
        if (!result.ok) {
            return sock.sendMessage(chat, { text: `❌ Could not fetch members: ${result.reason}` }, { quoted: msg });
        }
        return sock.sendMessage(chat, { text: formatGroupMembers(result.members, result.subject) }, { quoted: msg });
    }

    // ── .getjid owner <target> ──
    if (sub === 'owner') {
        const targetRaw = args?.slice(1).join(' ');
        if (!targetRaw) {
            return sock.sendMessage(chat, { text: '❌ Usage: .getjid owner <number|@username|jid>' }, { quoted: msg });
        }
        const res = await resolveBoth(sock, targetRaw);
        return sock.sendMessage(chat, { text: formatResult(res, targetRaw) }, { quoted: msg });
    }

    // ── .getjid group <groupJid> <targetJid> ──
    if (sub === 'group') {
        const groupJid = args?.[1] || chat;
        const targetRaw = args?.slice(2).join(' ') || ctx?.participant;
        if (!groupJid.endsWith('@g.us')) {
            return sock.sendMessage(chat, { text: '❌ Usage: .getjid group <groupJid> <targetJid> or reply in a group.' }, { quoted: msg });
        }
        if (!targetRaw) {
            return sock.sendMessage(chat, { text: '❌ Provide a target JID or reply to a message.' }, { quoted: msg });
        }
        const res = await resolveFromGroup(sock, targetRaw, groupJid);
        return sock.sendMessage(chat, { text: formatResult(res, targetRaw) }, { quoted: msg });
    }

    // ── No args: replied message ──
    if (!sub && ctx) {
        const fromKey = resolveFromMessageKey({
            participant: ctx.participant,
            participantAlt: ctx.participantAlt,
            remoteJid: chat,
            remoteJidAlt: null
        });
        const res = { pn: fromKey.pn, lid: fromKey.lid, source: fromKey.source, reason: null };
        if (res.lid && !res.pn) {
            const r = await resolveLidToPn(sock, res.lid, chat.endsWith('@g.us') ? chat : null);
            if (r.pn) { res.pn = r.pn; res.source = `${res.source} + ${r.source}`; } else { res.reason = r.reason; }
        } else if (res.pn && !res.lid) {
            const r = await resolvePnToLid(sock, res.pn);
            if (r.lid) { res.lid = r.lid; res.source = `${res.source} + ${r.source}`; } else { res.reason = r.reason; }
        }
        if (!res.pn && chat.endsWith('@g.us')) {
            const gRes = await resolveFromGroup(sock, ctx.participant, chat);
            if (gRes.pn) { res.pn = gRes.pn; res.source = gRes.source; }
            if (gRes.lid) { res.lid = gRes.lid; res.source = gRes.source; }
            if (gRes.admin) res.note = `Admin: ${gRes.admin}`;
        }
        const label = res.lid || res.pn || 'replied user';
        return sock.sendMessage(chat, { text: formatResult(res, label) }, { quoted: msg });
    }

    // ── Target after command ──
    if (sub && (/^\d+$/.test(sub) || sub.startsWith('@') || sub.includes('@'))) {
        const res = await resolveBoth(sock, sub);
        return sock.sendMessage(chat, { text: formatResult(res, sub) }, { quoted: msg });
    }

    // ── Fallback ──
    const chatType = jidType(chat);
    if (chatType === 'group') {
        return sock.sendMessage(chat, {
            text: `📌 *Current chat JID*\n*${chat}*\n\n_Use .getjid members to list all participants._`
        }, { quoted: msg });
    }
    if (chatType === 'newsletter') {
        const meta = await fetchNewsletterMeta(sock, chat);
        const lines = [`📌 *Current channel*`, '', `*${chat}*`];
        if (meta?.name) lines.push(`\n📛 *${meta.name}*`);
        return sock.sendMessage(chat, { text: lines.join('\n') }, { quoted: msg });
    }
    return sock.sendMessage(chat, {
        text: `📌 *Current chat JID*\n*${chat}*\n\n_Reply to a message or provide a number/username/JID for full lookup._`
    }, { quoted: msg });
}
