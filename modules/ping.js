// ─────────────────────────────────────────────
//  WRAITH · modules/ping.js
//  Latency probe — measures WhatsApp round-trip
//  plus a few system vitals.
// ─────────────────────────────────────────────
import { isOwner } from '../core/identity.js';

// Captured at module load — used for uptime
const BOOT_TIME = Date.now();

// ─────────────────────────────────────────────
//  Formatting helpers
// ─────────────────────────────────────────────
function bar(ms) {
    // 1 bar per 100ms, capped at 10
    const filled = Math.min(Math.max(Math.round(ms / 100), 1), 10);
    return '█'.repeat(filled) + '░'.repeat(10 - filled);
}

function quality(ms) {
    if (ms < 150) return '🟢 excellent';
    if (ms < 400) return '🟡 good';
    if (ms < 900) return '🟠 slow';
    return '🔴 laggy';
}

function uptime() {
    const s = Math.floor((Date.now() - BOOT_TIME) / 1000);
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;

    const parts = [];
    if (d) parts.push(`${d}d`);
    if (h || d) parts.push(`${h}h`);
    if (m || h || d) parts.push(`${m}m`);
    parts.push(`${sec}s`);
    return parts.join(' ');
}

function mem() {
    const used = process.memoryUsage().rss / 1024 / 1024;
    return `${used.toFixed(1)} MB`;
}

// ─────────────────────────────────────────────
//  .ping — command
// ─────────────────────────────────────────────
export async function pingCommand(sock, chat, msg) {
    const from = msg.key.participant || msg.key.remoteJid;

    if (!msg.key.fromMe && !isOwner(from)) {
        return sock.sendMessage(chat, { text: '⛔ Owner only.' }, { quoted: msg });
    }

    // ── 1. Measure WhatsApp round-trip ──
    // Send a tiny placeholder message, then edit it after the ACK.
    const t0 = Date.now();

    const sent = await sock.sendMessage(chat, {
        text: '🏓 _probing…_'
    }, { quoted: msg });

    const t1 = Date.now();
    const rtt = t1 - t0;

    // ── 2. Event-loop lag (rough heuristic) ──
    const lagStart = Date.now();
    await new Promise(r => setImmediate(r));
    const eventLoopLag = Date.now() - lagStart;

    // ── 3. Render the card ──
    const lines = [
        `🏓 *pong*`,
        ``,
        `*whatsapp rtt* · ${rtt} ms`,
        `\`${bar(rtt)}\`  ${quality(rtt)}`,
        ``,
        `*event loop* · ${eventLoopLag} ms`,
        `*memory* · ${mem()}`,
        `*uptime* · ${uptime()}`
    ];

    // ── 4. Try to edit the placeholder into the real reply ──
    //     If edit fails (older WA clients), send a fresh message.
    try {
        await sock.sendMessage(chat, {
            text: lines.join('\n'),
            edit: sent.key
        });
    } catch {
        await sock.sendMessage(chat, { text: lines.join('\n') });
    }
}
