// ─────────────────────────────────────────────
// WRAITH · modules/download.js
// Media downloader — yt-dlp primary, Cobalt backup
// · ALL options passed in constructor (no fragile builder methods)
// · /tmp (RAM-backed) staging · auto-cleanup
// · Quality selection · timeout · size caps · playlist-proof
// · Crash-safe · full error reporting · uses official download() path
// · Cobalt API fallback for cookie-walled platforms (YouTube etc.)
// ─────────────────────────────────────────────
import { YtDlp } from '@choewy/yt-dlp';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isOwner } from '../core/identity.js';
import {
  isCobaltSupported,
  cobaltDownloadAudio,
  cobaltDownloadVideo,
} from './cobalt.js';

const execFileAsync = promisify(execFile);

// ── Safety caps ──
const VIDEO_MAX_BYTES = 64 * 1024 * 1024; // 64 MB
const AUDIO_MAX_BYTES = 15 * 1024 * 1024; // 15 MB
const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000; // 5 min hard cap

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
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return;
  }
  for (const f of entries) {
    if (!f.startsWith(prefix)) continue;
    try {
      fs.unlinkSync(path.join(dir, f));
    } catch {
      /* ignore */
    }
  }
}

// ─────────────────────────────────────────────
// Argument parser
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

    if (p === 'audio' || p === 'a') {
      mode = 'audio';
      container = 'm4a';
      continue;
    }
    if (p === 'mp3') {
      mode = 'audio';
      container = 'mp3';
      continue;
    }
    if (p === 'm4a') {
      mode = 'audio';
      container = 'm4a';
      continue;
    }
    if (p === 'video' || p === 'v') {
      mode = 'video';
      container = 'mp4';
      continue;
    }

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
    return '🍪 The platform requires authentication cookies. Try another URL or use `.song` for YouTube audio.';
  if (m.includes('private') || m.includes('unavailable') || m.includes('removed'))
    return '🚫 This content is private, removed, or unavailable.';
  if (m.includes('geo') || m.includes('not available in your country'))
    return '🌍 This content is geo-blocked in the server\'s region.';
  if (m.includes('timed out') || m.includes('timeout'))
    return '⏱️ The download timed out. Try again or use a lower quality.';
  if (m.includes('too large') || m.includes('max-filesize'))
    return '📦 The file exceeds the size cap. Try a lower quality (e.g. `.dl 360 <url>`).';
  if (m.includes('not found') || m.includes('404') || m.includes('does not exist'))
    return '🔍 Media not found — check the URL.';
  if (m.includes('network') || m.includes('connection'))
    return '📡 Network error on the server — try again in a moment.';
  if (m.includes('unsupported url'))
    return '❌ This URL is not supported by the downloader.';
  if (m.includes('cannot find module') || m.includes('yt-dlp'))
    return '⚙️ Downloader binary missing. Run `npm install` on the server.';
  if (m.includes('not a function'))
    return '⚙️ Library API mismatch. Run `npm install @choewy/yt-dlp@1.2.0` on the server.';
  if (m.includes('cobalt'))
    return `☁️ Cobalt error: ${String(raw).slice(0, 150)}`;

  return `❌ ${String(raw).slice(0, 180)}`;
}

// ─────────────────────────────────────────────
// Usage card
// ─────────────────────────────────────────────
const USAGE = [
  '* WRAITH · MEDIA DOWNLOADER*',
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
  '*Song (search + download)*',
  '• `.song <query>` — search YouTube, download audio via Cobalt',
  '',
  '_YouTube · Instagram · TikTok · Twitter/X · Facebook · Reddit · 1000+ sites_',
  '_YouTube video downloads auto-fallback to Cobalt when yt-dlp hits cookies._',
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
// yt-dlp search helper — resolves query → YouTube URL
// ─────────────────────────────────────────────
async function ytDlpSearchUrl(query) {
  const candidates = [
    'yt-dlp',
    path.join(process.cwd(), 'node_modules', '.bin', 'yt-dlp'),
    path.join(process.cwd(), 'node_modules', '@choewy', 'yt-dlp', 'bin', 'yt-dlp'),
    path.join(process.cwd(), 'node_modules', 'yt-dlp-exec', 'bin', 'yt-dlp'),
  ];

  let lastErr;
  for (const bin of candidates) {
    try {
      const { stdout } = await execFileAsync(
        bin,
        ['--get-url', '--no-warnings', '--no-playlist', `ytsearch1:${query}`],
        { timeout: 30_000, maxBuffer: 1024 * 1024 }
      );
      const url = stdout.trim().split('\n')[0].trim();
      if (url) return url;
    } catch (e) {
      lastErr = e;
    }
  }

  throw new Error(
    `yt-dlp search failed: ${lastErr?.message || 'binary not found'}`
  );
}

// ─────────────────────────────────────────────
// Command entry — .dl <url> [quality/mode]
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

    // ── Build format string ──
    let formatStr;
    if (parsed.mode === 'audio') {
      formatStr = parsed.audioBitrate
        ? `bestaudio[abr<=${parseInt(parsed.audioBitrate, 10)}]/bestaudio`
        : 'bestaudio/best';
    } else {
      formatStr = parsed.videoHeight
        ? `bestvideo[height<=${parsed.videoHeight}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=${parsed.videoHeight}]+bestaudio/best[height<=${parsed.videoHeight}]/best`
        : 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best[ext=mp4]/best';
    }

    // ── Create YtDlp instance with ALL options in constructor ──
    const ytDlp = new YtDlp({
      url: parsed.url,
      output: outTemplate,
      format: formatStr,
      quiet: true,
      noWarnings: true,
      noProgress: true,
      playlist: false,
      retries: 3,
      fragmentRetries: 3,
      concurrentFragments: 1,
    });

    // ── Minimal builder chain ──
    let builder;
    if (parsed.mode === 'audio') {
      builder = ytDlp.audioFormat(parsed.container).audio();
    } else {
      builder = ytDlp.mergeFormat('mp4').video();
    }

    // ── Execute download (with timeout) ──
    let ytDlpFailed = false;
    let ytDlpError = null;
    let outFile = null;

    try {
      const result = await withTimeout(builder.download(), DOWNLOAD_TIMEOUT_MS);
      outFile = result?.path;
    } catch (e) {
      ytDlpFailed = true;
      ytDlpError = e;
    }

    // ── Cobalt fallback ──
    if (ytDlpFailed || !outFile || !fs.existsSync(outFile)) {
      if (ytDlpFailed) {
        console.error('[download] yt-dlp failed:', ytDlpError?.message);
      }

      if (isCobaltSupported(parsed.url)) {
        await safeReply(
          sock,
          chat,
          msg,
          '⚠️ yt-dlp failed. Retrying with Cobalt backup…'
        );

        try {
          const ext = parsed.mode === 'audio'
            ? (parsed.container === 'mp3' ? 'mp3' : 'm4a')
            : 'mp4';
          const cobaltOut = path.join(os.tmpdir(), `${prefix}.${ext}`);

          if (parsed.mode === 'audio') {
            await cobaltDownloadAudio(parsed.url, cobaltOut, {
              audioFormat: parsed.container === 'mp3' ? 'mp3' : 'm4a',
              audioBitrate: parsed.audioBitrate
                ? String(parseInt(parsed.audioBitrate, 10))
                : '128',
            });
          } else {
            await cobaltDownloadVideo(parsed.url, cobaltOut, {
              videoQuality: parsed.videoHeight
                ? String(parsed.videoHeight)
                : '720',
            });
          }

          outFile = cobaltOut;
        } catch (cobaltErr) {
          console.error('[download] cobalt fallback failed:', cobaltErr?.message);
          cleanupByPrefix(prefix);
          return safeReply(
            sock,
            chat,
            msg,
            `❌ Both yt-dlp and Cobalt failed.\n_${classifyError(ytDlpError?.message || 'yt-dlp failed')}_\n_Cobalt: ${String(cobaltErr?.message).slice(0, 120)}_`
          );
        }
      } else {
        cleanupByPrefix(prefix);
        return safeReply(
          sock,
          chat,
          msg,
          `❌ Download failed (platform not supported by Cobalt backup).\n_${classifyError(ytDlpError?.message || 'unknown error')}_`
        );
      }
    }

    // ── Validate output ──
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
    const payload =
      parsed.mode === 'audio'
        ? {
            audio: { stream },
            mimetype:
              parsed.container === 'mp3' ? 'audio/mpeg' : 'audio/mp4',
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
      return safeReply(
        sock,
        chat,
        msg,
        `❌ Failed to deliver the file to WhatsApp.\n_${String(sendErr?.message || sendErr).slice(0, 120)}_`
      );
    }

    cleanupByPrefix(prefix);
  } catch (err) {
    console.error('[download] command error:', err?.stack || err?.message || err);
    cleanupByPrefix(prefix);
    await safeReply(sock, chat, msg, classifyError(err?.message || err));
  }
}

// ─────────────────────────────────────────────
// Song command — .song <query>
// Search via yt-dlp → download audio via Cobalt
// If Cobalt fails → fallback to yt-dlp audio download
// ─────────────────────────────────────────────
export async function songCommand(sock, chat, msg, args) {
  const prefix = uniquePrefix();

  try {
    const from = msg?.key?.participant || msg?.key?.remoteJid;
    if (!msg?.key?.fromMe && !isOwner(from)) {
      return safeReply(sock, chat, msg, '⛔ Owner only.');
    }

    const query = Array.isArray(args) ? args.join(' ').trim() : '';
    if (!query) {
      return safeReply(
        sock,
        chat,
        msg,
        '* WRAITH · SONG*\n\nUsage: `.song <song name or query>`\nExample: `.song Shape of You Ed Sheeran`\n\n_Searches YouTube, downloads audio via Cobalt._'
      );
    }

    await safeReply(sock, chat, msg, `🔍 Searching: *${query}*…`);

    // ── Step 1: Search YouTube via yt-dlp ──
    let url;
    try {
      url = await ytDlpSearchUrl(query);
    } catch (searchErr) {
      console.error('[song] search failed:', searchErr?.message);
      return safeReply(
        sock,
        chat,
        msg,
        `❌ Could not search for *${query}*.\n_${String(searchErr?.message).slice(0, 150)}_`
      );
    }

    if (!url) {
      return safeReply(sock, chat, msg, `❌ No results for *${query}*.`);
    }

    await safeReply(sock, chat, msg, `🎵 Found. Downloading audio…`);

    // ── Step 2: Try Cobalt audio download ──
    const cobaltOut = path.join(os.tmpdir(), `${prefix}.mp3`);
    let outFile = null;
    let usedCobalt = false;

    try {
      await withTimeout(
        cobaltDownloadAudio(url, cobaltOut, {
          audioFormat: 'mp3',
          audioBitrate: '128',
        }),
        DOWNLOAD_TIMEOUT_MS
      );
      outFile = cobaltOut;
      usedCobalt = true;
    } catch (cobaltErr) {
      console.error('[song] cobalt failed:', cobaltErr?.message);
      await safeReply(
        sock,
        chat,
        msg,
        `⚠️ Cobalt failed. Retrying with yt-dlp…\n_${String(cobaltErr?.message).slice(0, 120)}_`
      );
    }

    // ── Step 3: yt-dlp fallback ──
    if (!outFile) {
      try {
        const ytDlp = new YtDlp({
          url,
          output: path.join(os.tmpdir(), `${prefix}.%(ext)s`),
          format: 'bestaudio/best',
          quiet: true,
          noWarnings: true,
          noProgress: true,
          playlist: false,
          retries: 3,
          fragmentRetries: 3,
          concurrentFragments: 1,
        });

        const result = await withTimeout(
          ytDlp.audioFormat('mp3').audio().download(),
          DOWNLOAD_TIMEOUT_MS
        );
        outFile = result?.path;
      } catch (ytErr) {
        console.error('[song] yt-dlp fallback failed:', ytErr?.message);
        cleanupByPrefix(prefix);
        return safeReply(
          sock,
          chat,
          msg,
          `❌ Could not download *${query}*.\n_Both Cobalt and yt-dlp failed._`
        );
      }
    }

    // ── Step 4: Validate and send ──
    if (!outFile || !fs.existsSync(outFile)) {
      cleanupByPrefix(prefix);
      return safeReply(sock, chat, msg, '❌ Download produced no file.');
    }

    const stat = fs.statSync(outFile);
    if (stat.size > AUDIO_MAX_BYTES) {
      cleanupByPrefix(prefix);
      return safeReply(
        sock,
        chat,
        msg,
        `📦 Audio too large (${(stat.size / 1024 / 1024).toFixed(1)} MB > ${(AUDIO_MAX_BYTES / 1024 / 1024).toFixed(0)} MB).`
      );
    }

    const stream = fs.createReadStream(outFile);
    stream.on('close', () => cleanupByPrefix(prefix));
    stream.on('error', (err) => {
      console.error('[song] stream error:', err?.message);
      cleanupByPrefix(prefix);
    });

    const filename = path.basename(outFile);
    await sock.sendMessage(
      chat,
      {
        audio: { stream },
        mimetype: 'audio/mpeg',
        fileName: filename,
        ptt: false,
      },
      { quoted: msg }
    );

    if (usedCobalt) {
      await safeReply(sock, chat, msg, '✅ Downloaded via Cobalt.');
    }

    cleanupByPrefix(prefix);
  } catch (err) {
    console.error('[song] command error:', err?.stack || err?.message || err);
    cleanupByPrefix(prefix);
    await safeReply(sock, chat, msg, classifyError(err?.message || err));
  }
  }
