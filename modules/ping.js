// ─────────────────────────────────────────────
//  WRAITH · modules/ping.js
//  Latency probe + system vitals.
//  Shows: WhatsApp RTT, event-loop lag, CPU load
//         (load average + live usage), memory, uptime.
// ─────────────────────────────────────────────
import os from 'node:os';
import { isOwner } from '../core/identity.js';

// Captured at module load — used for uptime
const BOOT_TIME = Date.now();

// ─────────────────────────────────────────────
//  Formatting helpers
// ─────────────────────────────────────────────
function bar(pct, width = 10) {
    const filled = Math.max(0, Math.min(width, Math.round((pct / 100) * width)));
    return '█'.repeat(filled) + '░'.repeat(width - filled);
}

function rttBar(ms) {
    const filled = Math.min(Math.max(Math.round(ms / 100), 1), 10);
    return '█'.repeat(filled) + '░'.repeat(10 - filled);
}

function quality(ms) {
    if (ms < 150) return '🟢 excellent';
    if (ms < 400) return '🟡 good';
    if (ms < 900) return '🟠 slow';
    return '🔴 laggy';
}

function cpuQuality(pct) {
    if (pct < 25) return '🟢 idle';
    if (pct < 60) return '🟡 normal';
    if (pct < 85) return '🟠 busy';
    return '🔴 heavy';
}

function memQuality(pct) {
    if (pct < 60) return '🟢 healthy';
    if (pct < 80) return '🟡 moderate';
    if (pct < 92) return '🟠 high';
    return '🔴 critical';
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

function mb(bytes) {
    return (bytes / 1024 / 1024).toFixed(1);
}

// ─────────────────────────────────────────────
//  CPU sampling
//  os.loadavg() is instant, but on Linux reflects the
//  kernel's 1/5/15-min rolling averages (NOT instantaneous).
//  For a "right now" number we sample os.cpus() twice
//  with a short gap and compute the delta.
// ─────────────────────────────────────────────
function snapshotCpus() {
    const cpus = os.cpus() || [];
    return cpus.map((c) => {
        const t = c.times;
        const idle = t.idle;
        const total = t.user + t.nice + t.sys + t.idle + t.irq;
        return { idle, total };
    });
}

function computeCpuUsage(before, after) {
    if (!before.length || before.length !== after.length) return 0;

    let idleDelta = 0;
    let totalDelta = 0;

    for (let i = 0; i < before.length; i++) {
        idleDelta  += after[i].idle  - before[i].idle;
        totalDelta += after[i].total - before[i].total;
    }

    if (totalDelta <= 0) return 0;
    const usage = 100 * (1 - idleDelta / totalDelta);
    return Math.max(0, Math.min(100, usage));
}

async function sampleCpuUsage(gapMs = 250) {
    const before = snapshotCpus();
    await new Promise((r) => setTimeout(r, gapMs));
    const after = snapshotCpus();
    return computeCpuUsage(before, after);
}

// ─────────────────────────────────────────────
//  Memory
// ─────────────────────────────────────────────
function memoryStats() {
    const proc = process.memoryUsage();
    const total = os.totalmem();
    const free = os.freemem();
    const used = total - free;

    return {
        // Process-level
        rss: proc.rss,
        heapUsed: proc.heapUsed,
        heapTotal: proc.heapTotal,
        external: proc.external,

        // System-level
        sysTotal: total,
        sysFree: free,
        sysUsed: used,
        sysUsedPct: (used / total) * 100,
    };
}

// ─────────────────────────────────────────────
//  .ping — command
// ─────────────────────────────────────────────
export async function pingCommand(sock, chat, msg) {
    const from = msg.key.participant || msg.key.remoteJid;

    if (!msg.key.fromMe && !isOwner(from)) {
        return sock.sendMessage(chat, { text: '⛔ Owner only.' }, { quoted: msg });
    }

    // ── 1. WhatsApp round-trip ──
    const t0 = Date.now();
    const sent = await sock.sendMessage(chat, {
        text: '🏓 _probing…_'
    }, { quoted: msg });
    const rtt = Date.now() - t0;

    // ── 2. Event-loop lag ──
    const lagStart = Date.now();
    await new Promise((r) => setImmediate(r));
    const eventLoopLag = Date.now() - lagStart;

    // ── 3. CPU sample (needs two snapshots ~250ms apart) ──
    const cpuUsage = await sampleCpuUsage(250);

    // Load averages only exist on Unix — on Windows they're always 0
    const [la1, la5, la15] = os.loadavg();
    const cores = os.cpus()?.length || 1;

    // ── 4. Memory ──
    const mem = memoryStats();

    // ── 5. Render ──
    const lines = [
        `🏓 *pong*`,
        ``,
        `*whatsapp rtt* · ${rtt} ms`,
        `\`${rttBar(rtt)}\`  ${quality(rtt)}`,
        ``,
        `*event loop* · ${eventLoopLag} ms`,
        ``,
        `*cpu* · ${cores} core${cores !== 1 ? 's' : ''}`,
        `\`${bar(cpuUsage)}\`  ${cpuUsage.toFixed(1)}%  ${cpuQuality(cpuUsage)}`,
    ];

    // Only show load averages if the OS reports them
    if (la1 || la5 || la15) {
        lines.push(
            `*load avg* · ${la1.toFixed(2)}  ${la5.toFixed(2)}  ${la15.toFixed(2)}`,
            `             _1m    5m    15m_`
        );
    }

    lines.push(
        ``,
        `*memory (process)*`,
        `• rss    · ${mb(mem.rss)} MB`,
        `• heap   · ${mb(mem.heapUsed)} / ${mb(mem.heapTotal)} MB`,
        `• ext    · ${mb(mem.external)} MB`,
        ``,
        `*memory (system)*`,
        `\`${bar(mem.sysUsedPct)}\`  ${mem.sysUsedPct.toFixed(1)}%  ${memQuality(mem.sysUsedPct)}`,
        `• used   · ${mb(mem.sysUsed)} / ${mb(mem.sysTotal)} MB`,
        ``,
        `*uptime* · ${uptime()}`,
        `*platform* · ${os.platform()} ${os.arch()} · node ${process.version}`
    );

    const body = lines.join('\n');

    // ── 6. Edit placeholder into real reply ──
    try {
        await sock.sendMessage(chat, {
            text: body,
            edit: sent.key
        });
    } catch {
        await sock.sendMessage(chat, { text: body });
    }
}
