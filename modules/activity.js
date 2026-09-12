// ─────────────────────────────────────────────
//  WRAITH · modules/activity.js
//  Contact & chat activity dashboard.
//  FIX #11: `.activity <jid>` per-chat detail is now
//  real, and all state writes are atomic.
// ─────────────────────────────────────────────
import path from 'path';
import { fileURLToPath } from 'url';
import { isOwner } from '../core/identity.js';
import { readJson, writeJsonAtomic } from '../core/state-io.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const STATE = path.join(here, '..', 'state', 'activity.json');
const DEBUG = process.env.WRAITH_DEBUG === '1';

function read() {
    return readJson(STATE, {});
}

function write(o) {
    writeJsonAtomic(STATE, o);
}

export function trackActivity(chat, msg, text) {
    try {
        const s = read();
        const jid = chat;
        if (!s[jid]) {
            s[jid] = { total: 0, texts: 0, media: 0, lastActive: 0, firstSeen: Date.now(), contacts: {} };
        }
        const rec = s[jid];
        rec.total++;
        rec.lastActive = Date.now();

        const m = msg.message;
        if (m?.conversation || m?.extendedTextMessage) rec.texts++;
        else if (m?.imageMessage || m?.videoMessage || m?.audioMessage || m?.documentMessage || m?.stickerMessage) rec.media++;

        const sender = msg.key.participant || msg.key.remoteJid;
        if (sender && !msg.key.fromMe) {
            if (!rec.contacts[sender]) rec.contacts[sender] = { count: 0, last: 0 };
            rec.contacts[sender].count++;
            rec.contacts[sender].last = Date.now();
        }

        write(s);
    } catch (e) {
        if (DEBUG) console.log('[activity] track error:', e.message);
    }
}

// ─────────────────────────────────────────────
//  FIX #11 — per-chat detail view
// ─────────────────────────────────────────────
function renderChatDetail(jid, rec) {
    const lines = [];
    lines.push(`📊 *chat detail*`);
    lines.push('');
    lines.push(`*jid* · \`${jid}\``);
    lines.push(`*messages* · ${rec.total}  (text ${rec.texts} · media ${rec.media})`);
    lines.push(`*first seen* · ${timeAgo(rec.firstSeen)}`);
    lines.push(`*last active* · ${timeAgo(rec.lastActive)}`);

    const contacts = Object.entries(rec.contacts || {})
        .sort((a, b) => b[1].count - a[1].count);

    if (contacts.length > 0) {
        lines.push('');
        lines.push(`*top senders* · ${contacts.length}`);
        for (const [sender, c] of contacts.slice(0, 15)) {
            const label = sender.split('@')[0];
            lines.push(`  \`${label}\` — ${c.count} msgs, ${timeAgo(c.last)}`);
        }
    }

    return lines.join('\n');
}

export async function activityCommand(sock, chat, msg, args) {
    const from = msg.key.participant || msg.key.remoteJid;

    if (!msg.key.fromMe && !isOwner(from)) {
        return sock.sendMessage(chat, { text: '⛔ Owner only.' }, { quoted: msg });
    }

    const s = read();
    const entries = Object.entries(s);

    if (entries.length === 0) {
        return sock.sendMessage(chat, { text: '📊 No activity recorded yet.' }, { quoted: msg });
    }

    // ── FIX #11: .activity <jid> — per-chat detail ──
    const query = (args?.[0] || '').trim();
    if (query) {
        const needle = query.replace(/[@\s]/g, '');
        const hit = entries.find(([jid]) =>
            jid === query ||
            jid.split('@')[0] === needle ||
            jid.split('@')[0].includes(needle)
        );
        if (!hit) {
            return sock.sendMessage(chat, {
                text: `❌ No tracked chat matches \`${query}\`.`
            }, { quoted: msg });
        }
        return sock.sendMessage(chat, {
            text: renderChatDetail(hit[0], hit[1])
        }, { quoted: msg });
    }

    entries.sort((a, b) => b[1].total - a[1].total);

    let totalMsgs = 0, totalMedia = 0, totalTexts = 0;
    for (const [, rec] of entries) {
        totalMsgs += rec.total;
        totalMedia += rec.media;
        totalTexts += rec.texts;
    }

    const lines = [];
    lines.push(`📊 *activity dashboard*`);
    lines.push('');
    lines.push(`*Global*`);
    lines.push(`• chats tracked · ${entries.length}`);
    lines.push(`• total messages · ${totalMsgs}`);
    lines.push(`• text · ${totalTexts}`);
    lines.push(`• media · ${totalMedia}`);
    lines.push('');

    lines.push(`*Top chats*`);
    const top = entries.slice(0, 10);
    for (const [jid, rec] of top) {
        const name = jid.split('@')[0];
        const ago = timeAgo(rec.lastActive);
        lines.push(`  \`${name}\` — ${rec.total} msgs, ${rec.media} media, ${ago}`);
    }

    lines.push('');
    lines.push(`_Use \`.activity <jid>\` for per-chat detail._`);

    return sock.sendMessage(chat, { text: lines.join('\n') }, { quoted: msg });
}

function timeAgo(ts) {
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}
