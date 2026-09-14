// ─────────────────────────────────────────────
// WRAITH · modules/download.js
// Media downloader — @choewy/yt-dlp (auto-installs yt-dlp + ffmpeg)
// · Zero manual server setup (npm install handles everything)
// · /tmp (RAM-backed) staging · auto-cleanup
// · Quality selection · timeout · size caps · playlist-proof
// · Crash-safe · full error reporting · uses official download() path
// ─────────────────────────────────────────────
import { YtDlp } from '@choewy/yt-dlp';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { isOwner } from '../core/identity.js';

// ── Safety caps ──
const VIDEO_MAX_BYTES = 64 * 1024 * 1024;    // 64 MB
const AUDIO_MAX_BYTES = 15 * 1024 * 1024;    // 15 MB
const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;   // 5 min hard cap

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

// ─────────────────────────────────────────────
// Argument parser
//   .dl <url>                   → best video (mp4)
//   .dl 1080|720|480|360 <url>  → capped resolution
//   .dl audio <url>             → best m4a
//   .dl audio 128 <url>         → 128 kbps m4a
//   .dl mp3 <url>               → best mp3
//   .dl mp3 192 <url>           → 192 kbps mp3
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
// Error classifier → friendly chat message
// ─────────────────────────────────────────────
function classifyError(raw) {
  const m = String(raw).toLowerCase();
  if (m.includes('sign in') || m.includes('login') || m.includes("confirm you're not a bot"))
    return '🔐 The platform requires authentication cookies. Try another URL.';
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
  if (m.includes('network') || m.includes('connection'))
    return '🌐 Network error on the server — try again in a moment.';
  if (m.includes('unsupported url'))
    return '❌ This URL is not supported by the downloader.';
  if (m.includes('cannot find module') || m.includes('yt-dlp'))
    return '⚙️ Downloader binary missing. Run `npm install` on the server.';
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
// Timeout wrapper (prevents hung downloads)
// ─────────────────────────────────────────────
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Download timed out (5 min)')), ms)
    ),
  ]);
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

    // ── Parse args ──
    const parsed = parseArgs(args);
    if (!parsed) {
      return safeReply(sock, chat, msg, USAGE);
    }

    const outTemplate = path.join(os.tmpdir(), `${prefix}.%(ext)s`);
    await safeReply(sock, chat, msg, '⏳ downloading…');

    // ── Build YtDlp instance ──
    // Official order: .mergeFormat() → .output() → .video()
    //                 .audioFormat() → .output() → .audio()
    let builder = new YtDlp({ url: parsed.url });

    if (parsed.mode === 'audio') {
      builder = builder
        .audioFormat(parsed.container)
        .output(outTemplate)
        .audio();
      if (parsed.audioBitrate) {
        builder = builder.format(
          `bestaudio[abr<=${parseInt(parsed.audioBitrate, 10)}]/bestaudio`
        );
      }
    } else {
      builder = builder
        .mergeFormat('mp4')
        .output(outTemplate)
        .video();
      if (parsed.videoHeight) {
        builder = builder.format(
          `bestvideo[height<=${parsed.videoHeight}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=${parsed.videoHeight}]+bestaudio/best[height<=${parsed.videoHeight}]/best`
        );
      }
    }

    // ── Resource-saving flags (from official docs) ──
    builder = builder
      .quiet()
      .noWarnings()
      .noProgress()
      .playlist(false)          // equivalent to --no-playlist
      .retries(3)
      .fragmentRetries(3)
      .concurrentFragments(1);  // default is 4 — set to 1 for lowest CPU

    // ── Execute download (with timeout) ──
    const result = await withTimeout(builder.download(), DOWNLOAD_TIMEOUT_MS);

    // ── Use the official returned path (more reliable than scanning) ──
    const outFile = result?.path;
    if (!outFile || !fs.existsSync(outFile)) {
      throw new Error('Output file was not produced');
    }

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
    console.error('[download] command error:', err?.stack || err?.message || err);
    cleanupByPrefix(prefix);
    await safeReply(sock, chat, msg, classifyError(err?.message || err));
  }
}
