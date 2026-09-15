// ─────────────────────────────────────────────
//  WRAITH · modules/ping.js
//  Latency probe + container-aware system vitals.
//
//  Inside Docker/Pterodactyl, os.cpus() / os.totalmem()
//  / os.loadavg() report the HOST, not your container.
//  We read cgroup v1/v2 files instead so CPU% and
//  memory reflect what your panel shows.
// ─────────────────────────────────────────────
import fs from 'node:fs';
import os from 'node:os';
import { isOwner } from '../core/identity.js';

const BOOT_TIME = Date.now();

// ─────────────────────────────────────────────
//  cgroup detection
// ─────────────────────────────────────────────
function readFileSafe(p) {
    try { return fs.readFileSync(p, 'utf8').trim(); } catch { return null; }
}

function detectCgroupVersion() {
    const cg = readFileSafe('/proc/self/cgroup');
    if (!cg) return 0;
    if (/^0::/m.test(cg)) return 2;
    return 1;
}

function detectCgroupPath() {
    const cg = readFileSafe('/proc/self/cgroup');
    if (!cg) return '';
    const v2 = cg.match(/^0::(.+)$/m);
    if (v2) return v2[1];
    const v1 = cg.match(/^\d+:[^:]*:(.+)$/m);
    return v1 ? v1[1] : '';
}

const CG_VERSION = detectCgroupVersion();
const CG_PATH    = detectCgroupPath();

function cgReadV2(file) {
    return readFileSafe(`/sys/fs/cgroup${CG_PATH}/${file}`)
        ?? readFileSafe(`/sys/fs/cgroup/${file}`);
}
function cgReadV1(subsystem, file) {
    return readFileSafe(`/sys/fs/cgroup/${subsystem}${CG_PATH}/${file}`)
        ?? readFileSafe(`/sys/fs/cgroup/${subsystem}/${file}`);
}

// ─────────────────────────────────────────────
//  Container memory
//  Prefers cgroup current/max over host os.totalmem.
// ─────────────────────────────────────────────
function containerMemory() {
    if (CG_VERSION === 2) {
        const current = parseInt(cgReadV2('memory.current') || '0', 10);
        const maxRaw  = cgReadV2('memory.max');
        const limit   = (!maxRaw || maxRaw === 'max') ? 0 : parseInt(maxRaw, 10);
        if (current > 0 && limit > 0) {
            return { used: current, limit, source: 'cgroup v2' };
        }
    }

    if (CG_VERSION === 1) {
        const current = parseInt(cgReadV1('memory', 'memory.usage_in_bytes') || '0', 10);
        const maxRaw  = cgReadV1('memory', 'memory.limit_in_bytes');
        let limit     = parseInt(maxRaw || '0', 10);
        // v1 uses a huge sentinel (~9.2e18) for "unlimited"
        if (limit > 1e15) limit = 0;
        if (current > 0 && limit > 0) {
            return { used: current, limit, source: 'cgroup v1' };
        }
    }

    // Not in a container — use host numbers
    const total = os.totalmem();
    const free  = os.freemem();
    return { used: total - free, limit: total, source: 'host' };
}

// ─────────────────────────────────────────────
//  Container CPU
//  cpuacct.usage (v1) / cpu.stat usage_usec (v2)
//  give cumulative CPU µs used by the container.
//  Two samples = live usage %. cpu.max / cfs_quota
//  tells us the effective core count.
// ─────────────────────────────────────────────
function cgCpuUsageUsec() {
    if (CG_VERSION === 2) {
        const stat = cgReadV2('cpu.stat');
        if (stat) {
            const m = stat.match(/^usage_usec\s+(\d+)/m);
            if (m) return parseInt(m[1], 10);
        }
    }
    if (CG_VERSION === 1) {
        const raw = cgReadV1('cpuacct', 'cpuacct.usage');
        if (raw) return Math.floor(parseInt(raw, 10) / 1000); // ns → µs
    }
    return null;
}

function cgCpuCores() {
    if (CG_VERSION === 2) {
        const raw = cgReadV2('cpu.max');
        if (raw) {
            const [quotaStr, periodStr] = raw.split(/\s+/);
            if (quotaStr !== 'max') {
                const quota  = parseInt(quotaStr, 10);
                const period = parseInt(periodStr, 10);
                if (quota > 0 && period > 0) return quota / period;
            }
        }
    }
    if (CG_VERSION === 1) {
        const quotaStr  = cgReadV1('cpu', 'cpu.cfs_quota_us');
        const periodStr = cgReadV1('cpu', 'cpu.cfs_period_us');
        if (quotaStr && periodStr) {
            const quota  = parseInt(quotaStr, 10);
            const period = parseInt(periodStr, 10);
            if (quota > 0 && period > 0) return quota / period;
        }
    }
    return null;
}

async function sampleContainerCpu(gapMs = 300) {
    const before = cgCpuUsageUsec();
    if (before === null) return null;

    const t0 = process.hrtime.bigint();
    await new Promise((r) => setTimeout(r, gapMs));
    const t1 = process.hrtime.bigint();

    const after = cgCpuUsageUsec();
    if (after === null) return null;

    const deltaUsageUsec = after - before;
    const deltaWallUsec  = Number(t1 - t0) / 1000;

    if (deltaWallUsec <= 0) return { pct: 0, cores: cgCpuCores() || 1, coreFraction: 0 };

    // Fraction of one CPU core used during the sample window
    const coreFraction = deltaUsageUsec / deltaWallUsec;

    // Container quota (cores). If 1 core = 100% at coreFraction 1.0.
    const quotaCores = cgCpuCores();
    const denom = (quotaCores && quotaCores > 0) ? quotaCores : 1;

    const pct = (coreFraction / denom) * 100;
    return {
        pct: Math.max(0, Math.min(100, pct)),
        cores: quotaCores || 1,
        coreFraction,
    };
}

// ─────────────────────────────────────────────
//  Formatting helpers
// ─────────────────────────────────────────────
function bar(pct, width = 10) {
    const p = Math.max(0, Math.min(100, pct));
    const filled = Math.max(0, Math.min(width, Math.round((p / 100) * width)));
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
    const s   = Math.floor((Date.now() - BOOT_TIME) / 1000);
    const d   = Math.floor(s / 86400);
    const h   = Math.floor((s % 86400) / 3600);
    const m   = Math.floor((s % 3600) / 60);
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
//  .ping
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

    // ── 3. Container CPU sample ──
    const cpu = await sampleContainerCpu(300);
    const hostCores = os.cpus()?.length || 1;

    // ── 4. Container memory ──
    const mem = containerMemory();
    const memPct = (mem.used / mem.limit) * 100;

    // ── 5. Process memory ──
    const proc = process.memoryUsage();

    // ── 6. Render ──
    const lines = [
        `🏓 *pong*`,
        ``,
        `*whatsapp rtt* · ${rtt} ms`,
        `\`${rttBar(rtt)}\`  ${quality(rtt)}`,
        ``,
        `*event loop* · ${eventLoopLag} ms`,
        ``,
    ];

    // ── CPU section ──
    if (cpu) {
        const coresLabel = cpu.cores < hostCores
            ? `${cpu.cores} (limited, host has ${hostCores})`
            : `${cpu.cores}`;
        lines.push(
            `*cpu* · ${coresLabel}`,
            `\`${bar(cpu.pct)}\`  ${cpu.pct.toFixed(1)}%  ${cpuQuality(cpu.pct)}`
        );
    } else {
        // Fallback — not in a cgroup, use host numbers
        const [la1, la5, la15] = os.loadavg();
        lines.push(
            `*cpu* · ${hostCores} cores _(host)_`,
            `*load avg* · ${la1.toFixed(2)}  ${la5.toFixed(2)}  ${la15.toFixed(2)}`
        );
    }

    // ── Memory section ──
    const memTag = mem.source === 'host' ? ' _(host)_' : ` _(container · ${mem.source})_`;
    lines.push(
        ``,
        `*memory*${memTag}`,
        `\`${bar(memPct)}\`  ${memPct.toFixed(1)}%  ${memQuality(memPct)}`,
        `• used   · ${mb(mem.used)} / ${mb(mem.limit)} MB`,
        ``,
        `*memory (process)*`,
        `• rss    · ${mb(proc.rss)} MB`,
        `• heap   · ${mb(proc.heapUsed)} / ${mb(proc.heapTotal)} MB`,
        `• ext    · ${mb(proc.external)} MB`,
        ``,
        `*uptime* · ${uptime()}`,
        `*platform* · ${os.platform()} ${os.arch()} · node ${process.version}`
    );

    const body = lines.join('\n');

    try {
        await sock.sendMessage(chat, { text: body, edit: sent.key });
    } catch {
        await sock.sendMessage(chat, { text: body });
    }
}
