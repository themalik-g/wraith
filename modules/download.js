// ─────────────────────────────────────────────
// WRAITH · modules/download.js
// Media downloader — yt-dlp primary, Cobalt backup
// · /tmp (RAM-backed) staging · auto-cleanup
// · Quality selection · timeout · size caps · playlist-proof
// · Crash-safe · full error reporting
// · Cobalt API fallback for cookie-walled platforms
// · Song: yt-dlp search → Cobalt download.
//   On YouTube "bot" errors, we extract the video ID from
//   yt-dlp's own error message and route it to Cobalt.
// ─────────────────────────────────────────────
import { YtDlp } from '@choewy/yt-dlp';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { isOwner } from '../core/identity.js';
import {
  isCobaltSupported,
  cobaltDownloadAudio,
  cobaltDownloadVideo,
} from './cobalt.js';

// ── Safety caps ──
const VIDEO_MAX_BYTES = 64 * 1024 * 1024; // 64 MB
const AUDIO_MAX_BYTES = 15 * 1024 * 1024; // 15 MB
const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000; // 5 min hard cap

// ─────────────────────────────────────────────
// Temp-file helpers
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

    if (p === 'audio' || p === 'a') { mode = 'audio'; container = 'm4a'; continue; }
    if (p === 'mp3')               { mode = 'audio'; container = 'mp3'; continue; }
    if (p === 'm4a')               { mode = 'audio'; container = 'm4a'; continue; }
    if (p === 'video' || p === 'v'){ mode = 'video'; container = 'mp4'; continue; }

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
// Error classifier
// ─────────────────────────────────────────────
function classifyError(raw) {
  const m = String(raw).toLowerCase();

  if (m.includes('sign in') || m.includes('not a bot') || m.includes('login'))
    return '🍪 Platform requires auth cookies. Try `.song` for YouTube audio (uses Cobalt).';
  if (m.includes('private') || m.includes('unavailable') || m.includes('removed'))
    return '🚫 This content is private, removed, or unavailable.';
  if (m.includes('geo') || m.includes('not available in your country'))
    return '🌍 Geo-blocked in the server\'s region.';
  if (m.includes('timed out') || m.includes('timeout'))
    return '⏱️ Download timed out. Try a lower quality.';
  if (m.includes('too large') || m.includes('max-filesize'))
    return '📦 File exceeds the size cap.';
  if (m.includes('not found') || m.includes('404'))
    return '🔍 Media not found — check the URL.';
  if (m.includes('network') || m.includes('connection'))
    return '📡 Network error on the server.';
  if (m.includes('unsupported url'))
    return '❌ URL not supported.';
  if (m.includes('cobalt'))
    return `☁️ Cobalt error: ${String(raw).slice(0, 150)}`;

  return `❌ ${String(raw).slice(0, 180)}`;
}

// ─────────────────────────────────────────────
// YouTube ID extractor from yt-dlp error text
// Matches:  "[youtube] Umqb9KENgmk: Sign in to confirm..."
// ─────────────────────────────────────────────
function extractYouTubeId(text) {
  const s = String(text || '');

  // Primary form
  let m = s.match(/\[youtube\]\s+([A-Za-z0-9_-]{11})/);
  if (m) return m[1];

  // Fallback forms
  m = s.match(/youtu\.be\/([A-Za-z0-9_-]{11})/);
  if (m) return m[1];

  m = s.match(/[?&]v=([A-Za-z0-9_-]{11})/);
  if (m) return m[1];

  m = s.match(/watch\?v=([A-Za-z0-9_-]{11})/);
  if (m) return m[1];

  return null;
}

// ─────────────────────────────────────────────
// Usage card
// ─────────────────────────────────────────────
const USAGE = [
  '* WRAITH · MEDIA DOWNLOADER*',
  '',
  '*Video*',
  '• `.dl <url>` — best quality',
  '• `.dl 1080|720|480|360 <url>`',
  '',
  '*Audio*',
  '• `.dl audio <url>` — best m4a',
  '• `.dl audio 128 <url>` — 128 kbps',
  '• `.dl mp3 <url>` — best mp3',
  '• `.dl mp3 192 <url>` — 192 kbps',
  '',
  '*Song (search + download)*',
  '• `.song <query>` — search YouTube, download audio via Cobalt',
  '',
  '_YouTube downloads auto-fallback to Cobalt when yt-dlp is blocked._',
].join('\n');

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
async function safeReply(sock, chat, msg, text) {
  try {
    await sock.sendMessage(chat, { text }, { quoted: msg });
  } catch (err) {
    console.error('[download] safeReply failed:', err?.message);
  }
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Download timed out (5 min)')), ms)
    ),
  ]);
}

// ─────────────────────────────────────────────
// Command: .dl <url> [quality/mode]
// ─────────────────────────────────────────────
export async function downloadCommand(sock, chat, msg, args) {
  const prefix = uniquePrefix();

  try {
    const from = msg?.key?.participant || msg?.key?.remoteJid;
    if (!msg?.key?.fromMe && !isOwner(from)) {
      return safeReply(sock, chat, msg, '⛔ Owner only.');
    }

    const parsed = parseArgs(args);
    if (!parsed) return safeReply(sock, chat, msg, USAGE);

    const outTemplate = path.join(os.tmpdir(), `${prefix}.%(ext)s`);
    await safeReply(sock, chat, msg, '⏳ downloading…');

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

    const builder = parsed.mode === 'audio'
      ? ytDlp.audioFormat(parsed.container).audio()
      : ytDlp.mergeFormat('mp4').video();

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
      if (ytDlpFailed) console.error('[download] yt-dlp failed:', ytDlpError?.message);

      // Last-ditch: if yt-dlp error mentions a YouTube ID, prefer that URL
      const ytId = extractYouTubeId(ytDlpError?.message);
      const targetUrl = ytId
        ? `https://www.youtube.com/watch?v=${ytId}`
        : parsed.url;

      if (isCobaltSupported(targetUrl)) {
        await safeReply(sock, chat, msg, '⚠️ yt-dlp failed. Retrying with Cobalt backup…');

        try {
          const ext = parsed.mode === 'audio'
            ? (parsed.container === 'mp3' ? 'mp3' : 'm4a')
            : 'mp4';
          const cobaltOut = path.join(os.tmpdir(), `${prefix}.${ext}`);

          if (parsed.mode === 'audio') {
            await cobaltDownloadAudio(targetUrl, cobaltOut, {
              audioFormat: parsed.container === 'mp3' ? 'mp3' : 'm4a',
              audioBitrate: parsed.audioBitrate
                ? String(parseInt(parsed.audioBitrate, 10))
                : '128',
            });
          } else {
            await cobaltDownloadVideo(targetUrl, cobaltOut, {
              videoQuality: parsed.videoHeight ? String(parsed.videoHeight) : '720',
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
      return safeReply(
        sock,
        chat,
        msg,
        `❌ Failed to deliver the file.\n_${String(sendErr?.message || sendErr).slice(0, 120)}_`
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
// Command: .song <query>
//
// Flow:
//   1. Try yt-dlp directly with `ytsearch1:<query>`
//      - Works for non-blocked content and non-YouTube platforms.
//   2. On failure, extract the YouTube video ID from the yt-dlp error
//      and construct a canonical URL.
//   3. Send that URL to Cobalt for audio download.
//   4. If Cobalt also fails, report both errors.
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
        '* WRAITH · SONG*\n\nUsage: `.song <song name or query>`\nExample: `.song Tum Hi Ho`\n\n_Searches YouTube, downloads audio via Cobalt._'
      );
    }

    await safeReply(sock, chat, msg, `🔍 Searching: *${query}*…`);

    // ── Step 1: yt-dlp with ytsearch1 (finds the video) ──
    let outFile = null;
    let ytError = null;

    try {
      await safeReply(sock, chat, msg, '🎵 Downloading via yt-dlp…');

      const yt = new YtDlp({
        url: `ytsearch1:${query}`,
        output: path.join(os.tmpdir(), `${prefix}.%(ext)s`),
        format: 'bestaudio/best',
        quiet: true,
        noWarnings: true,
        noProgress: true,
        playlist: false,
        retries: 2,
        fragmentRetries: 2,
        concurrentFragments: 1,
      });

      const result = await withTimeout(
        yt.audioFormat('mp3').audio().download(),
        DOWNLOAD_TIMEOUT_MS
      );
      outFile = result?.path;
    } catch (e) {
      ytError = e;
      console.error('[song] yt-dlp failed:', e?.message);
    }

    // ── Step 2: Cobalt fallback ──
    if (!outFile) {
      const videoId = extractYouTubeId(ytError?.message);
      const ytUrl = videoId
        ? `https://www.youtube.com/watch?v=${videoId}`
        : null;

      if (ytUrl && isCobaltSupported(ytUrl)) {
        await safeReply(
          sock,
          chat,
          msg,
          `⚠️ yt-dlp blocked by YouTube. Trying Cobalt…\n_Matched video: \`${videoId}\`_`
        );

        const cobaltOut = path.join(os.tmpdir(), `${prefix}.mp3`);
        try {
          await withTimeout(
            cobaltDownloadAudio(ytUrl, cobaltOut, {
              audioFormat: 'mp3',
              audioBitrate: '128',
            }),
            DOWNLOAD_TIMEOUT_MS
          );
          outFile = cobaltOut;
        } catch (cobaltErr) {
          console.error('[song] cobalt failed:', cobaltErr?.message);
          cleanupByPrefix(prefix);
          return safeReply(
            sock,
            chat,
            msg,
            `❌ Could not download *${query}*.\n_yt-dlp: ${String(ytError?.message || 'failed').slice(0, 140)}_\n_Cobalt: ${String(cobaltErr?.message).slice(0, 140)}_`
          );
        }
      } else {
        cleanupByPrefix(prefix);
        return safeReply(
          sock,
          chat,
          msg,
          `❌ Could not download *${query}*.\n_${String(ytError?.message || 'unknown error').slice(0, 180)}_`
        );
      }
    }

    // ── Step 3: validate + send ──
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

    cleanupByPrefix(prefix);
  } catch (err) {
    console.error('[song] command error:', err?.stack || err?.message || err);
    cleanupByPrefix(prefix);
    await safeReply(sock, chat, msg, classifyError(err?.message || err));
  }
}
