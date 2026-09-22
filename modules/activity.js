// ─────────────────────────────────────────────
//  WRAITH · modules/activity.js
//  In-memory cache + debounced atomic flush.
// ─────────────────────────────────────────────
import { isOwner } from '../core/identity.js';
import { readJson, writeJsonAtomic } from '../core/state-io.js';
import { inState } from '../core/paths.js';

const STATE = () => inState('activity.json');
const DEBUG = process.env.WRAITH_DEBUG === '1';
const FLUSH_MS = 5000;

let _cache = null;
let _dirty = false;
let _flushTimer = null;

function read() {
    if (_cache) return _cache;
    _cache = readJson(STATE(), {});
    return _cache;
}

function write(o) {
    _cache = o;
    _dirty = true;
    scheduleFlush();
}

function scheduleFlush() {
    if (_flushTimer) return;
    _flushTimer = setTimeout(() => {
        _flushTimer = null;
        if (!_dirty) return;
        try { writeJsonAtomic(STATE(), _cache); _dirty = false; } catch {}
    }, FLUSH_MS);
    if (typeof _flushTimer.unref === 'function') _flushTimer.unref();
}

function flushNow() {
    if (!_dirty) return;
    try { writeJsonAtomic(STATE(), _cache); _dirty = false; } catch {}
}
process.on('SIGINT', flushNow);
process.on('SIGTERM', flushNow);

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

function renderChatDetail(jid, rec) {
    const lines = [];
    lines.push(`📊 *chat detail*`);
    lines.push('');
    lines.push(`*jid* · \`${jid}\``);
    lines.push(`*messages* · ${rec.total}  (text ${rec.texts} · media ${rec.media})`);
    lines.push(`*first seen* · ${timeAgo(rec.firstSeen)}`);
    lines.push(`*last active* · ${timeAgo(rec.lastActive)}`);
    const contacts = Object.entries(rec.contacts || {}).sort((a, b) => b[1].count - a[1].count);
    if (contacts.length > 0) {
        lines.push('');
        lines.push(`*top senders* · ${contacts.length}`);
        for (const [sender, c] of contacts.slice(0, 15)) {
            lines.push(`  \`${sender.split('@')[0]}\` — ${c.count} msgs, ${timeAgo(c.last)}`);
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

    const query = (args?.[0] || '').trim();
    if (query) {
        const needle = query.replace(/[@\s]/g, '');
        const hit = entries.find(([jid]) =>
            jid === query || jid.split('@')[0] === needle || jid.split('@')[0].includes(needle)
        );
        if (!hit) {
            return sock.sendMessage(chat, { text: `❌ No tracked chat matches \`${query}\`.` }, { quoted: msg });
        }
        return sock.sendMessage(chat, { text: renderChatDetail(hit[0], hit[1]) }, { quoted: msg });
    }

    entries.sort((a, b) => b[1].total - a[1].total);
    let totalMsgs = 0, totalMedia = 0, totalTexts = 0;
    for (const [, rec] of entries) {
        totalMsgs += rec.total; totalMedia += rec.media; totalTexts += rec.texts;
    }

    const lines = [
        `📊 *activity dashboard*`, ``,
        `*Global*`,
        `• chats tracked · ${entries.length}`,
        `• total messages · ${totalMsgs}`,
        `• text · ${totalTexts}`,
        `• media · ${totalMedia}`,
        ``,
        `*Top chats*`,
    ];
    for (const [jid, rec] of entries.slice(0, 10)) {
        lines.push(`  \`${jid.split('@')[0]}\` — ${rec.total} msgs, ${rec.media} media, ${timeAgo(rec.lastActive)}`);
    }
    lines.push('', `_Use \`.activity <jid>\` for per-chat detail._`);
    return sock.sendMessage(chat, { text: lines.join('\n') }, { quoted: msg });
}

function timeAgo(ts) {
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
}
