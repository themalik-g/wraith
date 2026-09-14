// ─────────────────────────────────────────────
// WRAITH · modules/download.js
// Media downloader — yt-dlp (video + audio)
// · Zero npm dependencies (Node built-ins only)
// · /tmp (RAM-backed) staging · auto-cleanup
// · Quality selection · timeout · size caps
// · Playlist-proof · binary check · crash-safe
// ─────────────────────────────────────────────
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { isOwner } from '../core/identity.js';

// ── Safety caps ──
const VIDEO_MAX_BYTES = 64 * 1024 * 1024;    // 64 MB
const AUDIO_MAX_BYTES = 15 * 1024 * 1024;    // 15 MB
const YTDLP_MAX_FILESIZE = 48 * 1024 * 1024; // 48 MB pre-download guard
const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;   // 5 min hard cap
const BINARY_CHECK_TIMEOUT_MS = 5000;

// ─────────────────────────────────────────────
// Lazy binary check (cached — runs at most once)
// ─────────────────────────────────────────────
let _depsChecked = false;
let _depsStatus = { ytDlp: false, ffmpeg: false };

function checkDependencies() {
  if (_depsChecked) return _depsStatus;
  _depsChecked = true;

  try {
    const r = spawnSync('yt-dlp', ['--version'], { timeout: BINARY_CHECK_TIMEOUT_MS });
    _depsStatus.ytDlp = r.status === 0;
  } catch { _depsStatus.ytDlp = false; }

  try {
    const r = spawnSync('ffmpeg', ['-version'], { timeout: BINARY_CHECK_TIMEOUT_MS });
    _depsStatus.ffmpeg = r.status === 0;
  } catch { _depsStatus.ffmpeg = false; }

  return _depsStatus;
}

// ─────────────────────────────────────────────
// Temp-file helpers (RAM-backed on Linux)
// ─────────────────────────────────────────────
function uniquePrefix() {
  return `wraith_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function cleanupByPrefix(prefix) {
  if (!prefix) return;
  const dir = os.tmpdir();
  let entries = [];
  try { entries = fs.readdirSync(dir); } catch { return; }
  for (const f of entries) {
    if (!f.startsWith(prefix)) continue;
    try { fs.unlinkSync(path.join(dir, f)); } catch { /* ignore */ }
  }
}

function findLargestFile(prefix) {
  const dir = os.tmpdir();
  let largest = null;
  let largestSize = 0;
  let entries = [];
  try { entries = fs.readdirSync(dir); } catch { return null; }
  for (const f of entries) {
    if (!f.startsWith(prefix)) continue;
    const fp = path.join(dir, f);
    try {
      const st = fs.statSync(fp);
      if (st.isFile() && st.size > largestSize) {
        largestSize = st.size;
        largest = fp;
      }
    } catch { /* ignore */ }
  }
  return largest;
}

// ─────────────────────────────────────────────
// Argument parser
//   .dl <url>                → best video (mp4)
//   .dl 1080|720|480|360 <url> → capped resolution
//   .dl audio <url>          → best m4a
//   .dl audio 128 <url>      → 128 kbps m4a
//   .dl mp3 <url>            → best mp3
//   .dl mp3 192 <url>        → 192 kbps mp3
// ─────────────────────────────────────────────
function parseArgs(args) {
  const arr = Array.isArray(args) ? [...args] : [];
  const urlIdx = arr.findIndex((p) => /^https?:\/\//i.test(p));
  if (urlIdx === -1) return null;
  const url = arr.splice(urlIdx, 1)[0];

  let mode = 'video';
  let container = 'mp4';
  let videoHeight = null;
  let audioBitrate = null;

  for (const raw of arr) {
    const p = String(raw).toLowerCase();
    if (p === 'audio' || p === 'a') { mode = 'audio'; container = 'm4a'; continue; }
    if (p === 'mp3') { mode = 'audio'; container = 'mp3'; continue; }
    if (p === 'm4a') { mode = 'audio'; container = 'm4a'; continue; }
    if (p === 'video' || p === 'v') { mode = 'video'; container = 'mp4'; continue; }

    if (/^\d+$/.test(p)) {
      const n = parseInt(p, 10);
      if (mode === 'audio') {
        if (n >= 32 && n <= 320) audioBitrate = `${n}K`;
      } else {
        if (n >= 144 && n <= 4320) videoHeight = n;
      }
    }
  }

  return { url, mode, container, videoHeight, audioBitrate };
}

// ─────────────────────────────────────────────
// Build yt-dlp argument list
// ─────────────────────────────────────────────
function buildYtDlpArgs(parsed, outTemplate) {
  const { url, mode, container, videoHeight, audioBitrate } = parsed;

  const base = [
    '--no-cache-dir',
    '--no-mtime',
    '--no-playlist',
    '--no-warnings',
    '--buffer-size', '1024',
    '--socket-timeout', '30',
    '--retries', '3',
    '--fragment-retries', '3',
    '--max-filesize', String(YTDLP_MAX_FILESIZE),
    '-o', outTemplate,
  ];

  if (mode === 'audio') {
    const extra = [
      '-f', 'bestaudio/best',
      '--extract-audio',
      '--audio-format', container,
    ];
    if (audioBitrate) extra.push('--audio-quality', audioBitrate);
    return [...base, ...extra, url];
  }

  const fmt = videoHeight
    ? `bestvideo[height<=${videoHeight}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=${videoHeight}]+bestaudio/best[height<=${videoHeight}]/best`
    : `bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best[ext=mp4]/best`;

  return [...base, '-f', fmt, '--merge-output-format', 'mp4', url];
}

// ─────────────────────────────────────────────
// Spawn yt-dlp (safe — never throws synchronously)
// ─────────────────────────────────────────────
function runYtDlp(args) {
  return new Promise((resolve, reject) => {
    let proc;
    try {
      proc = spawn('yt-dlp', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (err) {
      return reject(new Error(`failed to start yt-dlp: ${err.message}`));
    }

    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { proc.kill('SIGKILL'); } catch { /* ignore */ }
      reject(new Error('Download timed out (5 min)'));
    }, DOWNLOAD_TIMEOUT_MS);

    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`yt-dlp spawn error: ${err.code || err.message}`));
    });

    proc.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      if (code === 0) return resolve();

      const errLines = stderr
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.startsWith('ERROR:'));
      const msg = errLines.length
        ? errLines[errLines.length - 1].replace(/^ERROR:\s*/, '')
        : `yt-dlp exited with code ${code}`;

      reject(new Error(msg.slice(0, 250)));
    });
  });
}

// ─────────────────────────────────────────────
// Error classifier → friendly chat message
// ─────────────────────────────────────────────
function classifyError(raw) {
  const m = String(raw).toLowerCase();
  if (m.includes('sign in') || m.includes('login') || m.includes('confirm you\'re not a bot'))
    return '🔐 The platform requires authentication cookies. Try another URL or ask the owner to add cookies.';
  if (m.includes('private') || m.includes('unavailable') || m.includes('removed'))
    return '🔒 This content is private, removed, or unavailable.';
  if (m.includes('geo') || m.includes('not available in your country'))
    return '🌍 This content is geo-blocked in the server\'s region.';
  if (m.includes('timed out') || m.includes('timeout'))
    return '⏱️ The download timed out. Try again or use a lower quality.';
  if (m.includes('too large') || m.includes('max-filesize'))
    return '📦 The file exceeds the size cap. Try a lower quality (e.g. `.dl 360`).';
  if (m.includes('not found') || m.includes('404') || m.includes('does not exist'))
    return '🔍 Media not found — check the URL.';
  if (m.includes('network') || m.includes('connection') || m.includes('timed out on read'))
    return '🌐 Network error on the server — try again in a moment.';
  if (m.includes('unsupported url'))
    return '❌ This URL is not supported by the downloader.';
  if (m.includes('ffmpeg') && m.includes('not found'))
    return '⚙️ ffmpeg is not installed on the server (required for merging).';
  if (m.includes('yt-dlp spawn error') || m.includes('yt-dlp not found'))
    return '⚙️ yt-dlp is not installed on the server.';
  return `❌ ${String(raw).slice(0, 180)}`;
}

// ─────────────────────────────────────────────
// Usage card
// ─────────────────────────────────────────────
const USAGE = [
  '*📥 WRAITH · MEDIA DOWNLOADER*',
  '',
  '*Video*',
  '• `.dl <url>` — best quality',
  '• `.dl 1080 <url>` — max 1080p',
  '• `.dl 720 <url>` — max 720p',
  '• `.dl 480 <url>` — max 480p',
  '• `.dl 360 <url>` — max 360p',
  '',
  '*Audio*',
  '• `.dl audio <url>` — best m4a',
  '• `.dl audio 128 <url>` — 128 kbps m4a',
  '• `.dl mp3 <url>` — best mp3',
  '• `.dl mp3 192 <url>` — 192 kbps mp3',
  '',
  '_YouTube · Instagram · TikTok · Twitter/X · Facebook · Reddit · 1000+ sites_',
].join('\n');

// ─────────────────────────────────────────────
// Safe reply helper — never throws
// ─────────────────────────────────────────────
async function safeReply(sock, chat, msg, text) {
  try {
    await sock.sendMessage(chat, { text }, { quoted: msg });
  } catch (err) {
    console.error('[download] safeReply failed:', err?.message);
  }
}

// ─────────────────────────────────────────────
// Command entry
// ─────────────────────────────────────────────
export async function downloadCommand(sock, chat, msg, args) {
  const prefix = uniquePrefix();

  try {
    const from = msg?.key?.participant || msg?.key?.remoteJid;
    if (!msg?.key?.fromMe && !isOwner(from)) {
      return safeReply(sock, chat, msg, '⛔ Owner only.');
    }

    // ── Dependency check ──
    const deps = checkDependencies();
    if (!deps.ytDlp) {
      return safeReply(sock, chat, msg,
        '⚙️ *yt-dlp is not installed on the server.*\n\nInstall it with:\n```\npip install -U yt-dlp\n```');
    }
    if (!deps.ffmpeg) {
      return safeReply(sock, chat, msg,
        '⚙️ *ffmpeg is not installed on the server.*\n\nInstall it with:\n```\nsudo apt install -y ffmpeg\n```');
    }

    // ── Parse args ──
    const parsed = parseArgs(args);
    if (!parsed) {
      return safeReply(sock, chat, msg, USAGE);
    }

    const outTemplate = path.join(os.tmpdir(), `${prefix}.%(ext)s`);
    await safeReply(sock, chat, msg, '⏳ downloading…');

    // ── Download ──
    const cmdArgs = buildYtDlpArgs(parsed, outTemplate);
    await runYtDlp(cmdArgs);

    const outFile = findLargestFile(prefix);
    if (!outFile) throw new Error('Output file was not produced');

    const stat = fs.statSync(outFile);
    const cap = parsed.mode === 'audio' ? AUDIO_MAX_BYTES : VIDEO_MAX_BYTES;
    if (stat.size > cap) {
      throw new Error(
        `File too large (${(stat.size / 1024 / 1024).toFixed(1)} MB > ${(cap / 1024 / 1024).toFixed(0)} MB)`
      );
    }

    // ── Stream to WhatsApp ──
    const stream = fs.createReadStream(outFile);
    stream.on('close', () => cleanupByPrefix(prefix));
    stream.on('error', (err) => {
      console.error('[download] stream error:', err?.message);
      cleanupByPrefix(prefix);
    });

    const filename = path.basename(outFile);

    const payload = parsed.mode === 'audio'
      ? {
          audio: { stream },
          mimetype: parsed.container === 'mp3' ? 'audio/mpeg' : 'audio/mp4',
          fileName: filename,
          ptt: false,
        }
      : {
          video: { stream },
          mimetype: 'video/mp4',
          fileName: filename,
        };

    try {
      await sock.sendMessage(chat, payload, { quoted: msg });
    } catch (sendErr) {
      console.error('[download] sendMessage failed:', sendErr?.message);
      cleanupByPrefix(prefix);
      return safeReply(sock, chat, msg,
        `❌ Failed to deliver the file to WhatsApp.\n_${String(sendErr?.message || sendErr).slice(0, 120)}_`);
    }

    cleanupByPrefix(prefix);
  } catch (err) {
    // ── Full error report ──
    console.error('[download] command error:', err?.stack || err?.message || err);
    cleanupByPrefix(prefix);
    await safeReply(sock, chat, msg, classifyError(err?.message || err));
  }
    }
