// ─────────────────────────────────────────────
// WRAITH · modules/download.js
// YouTube downloader using ytdlp-nodejs (yt-dlp binary wrapper)
// No cookies required for public videos
// ─────────────────────────────────────────────

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { YtDlp } from '@choewy/yt-dlp';
import { YtdlpNodejs } from 'ytdlp-nodejs';
import { isOwner } from '../core/identity.js';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

const VIDEO_MAX_BYTES = 128 * 1024 * 1024;
const AUDIO_MAX_BYTES = 15 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;
const SEARCH_TIMEOUT_MS = 20_000;

// ─── Queue (unchanged) ───
const _queue = [];
let _running = false;

function enqueue(task) {
  return new Promise((resolve, reject) => {
    _queue.push({ task, resolve, reject });
    _drain();
  });
}

async function _drain() {
  if (_running) return;
  const next = _queue.shift();
  if (!next) return;
  _running = true;
  try {
    next.resolve(await next.task());
  } catch (e) {
    next.reject(e);
  } finally {
    _running = false;
    setImmediate(_drain);
  }
}

// ─── Helpers ───
async function react(sock, chat, msg, emoji) {
  try { await sock.sendMessage(chat, { react: { text: emoji, key: msg.key } }); } catch {}
}

function withTimeout(promise, ms, label = 'operation') {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, rej) => {
      timer = setTimeout(() => rej(new Error(`${label} timeout after ${ms / 1000}s`)), ms);
    }),
  ]);
}

// ─── Search (unchanged) ───
function findYtDlpBinary() {
  const candidates = [];
  try {
    const pkgPath = require.resolve('@choewy/yt-dlp/package.json');
    const pkgDir = path.dirname(pkgPath);
    candidates.push(
      path.join(pkgDir, 'bin', 'yt-dlp'),
      path.join(pkgDir, 'bin', 'yt-dlp.exe'),
      path.join(pkgDir, 'vendor', 'yt-dlp'),
      path.join(pkgDir, 'vendor', 'yt-dlp.exe'),
      path.join(pkgDir, 'yt-dlp'),
      path.join(pkgDir, 'yt-dlp.exe')
    );
  } catch {}
  candidates.push('/usr/local/bin/yt-dlp', '/usr/bin/yt-dlp', '/bin/yt-dlp');
  for (const c of candidates) {
    try { if (fs.statSync(c).isFile()) return c; } catch {}
  }
  return null;
}

async function ytDlpSearch(query) {
  const bin = findYtDlpBinary();
  if (!bin) return null;
  try {
    const { stdout } = await execFileAsync(
      bin,
      ['--print', 'id', '--skip-download', '--no-warnings', '--no-playlist', `ytsearch1:${query}`],
      { timeout: SEARCH_TIMEOUT_MS, maxBuffer: 1024 * 1024 }
    );
    const id = stdout.trim().split('\n').filter(Boolean).pop();
    if (id && /^[A-Za-z0-9_-]{11}$/.test(id)) {
      return { id, url: `https://www.youtube.com/watch?v=${id}` };
    }
  } catch (err) {
    console.error('[search] yt-dlp binary failed:', err.message);
  }
  return null;
}

async function scraperSearch(query) {
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=EgIQAQ%253D%253D`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  if (!res.ok) throw new Error(`YouTube search HTTP ${res.status}`);
  const html = await res.text();
  const m = html.match(/"videoRenderer":\{"videoId":"([A-Za-z0-9_-]{11})"/);
  if (!m) throw new Error('No video results found');
  return { id: m[1], url: `https://www.youtube.com/watch?v=${m[1]}`, title: query };
}

async function searchYouTube(query) {
  const viaYtDlp = await ytDlpSearch(query);
  if (viaYtDlp) return { id: viaYtDlp.id, url: viaYtDlp.url, title: query };
  return scraperSearch(query);
}

// ─── URL helpers ───
function isYouTubeUrl(u) { return /(?:youtube\.com|youtu\.be)/i.test(u); }
function extractYouTubeId(u) {
  const m = u.match(/(?:youtu\.be\/|v=|embed\/|shorts\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}
function thumbFor(id) { return id ? `https://i.ytimg.com/vi/${id}/sddefault.jpg` : undefined; }

async function resolveVideo(input) {
  if (isYouTubeUrl(input)) {
    const id = extractYouTubeId(input);
    return { url: input, title: input, thumbnail: thumbFor(id) };
  }
  const found = await withTimeout(searchYouTube(input), SEARCH_TIMEOUT_MS + 5_000, 'search');
  return { url: found.url, title: found.title, thumbnail: thumbFor(found.id) };
}

function detectFormat(buf) {
  const ascii4 = buf.toString('ascii', 4, 8);
  if (ascii4 === 'ftyp') return { ext: 'm4a', mime: 'audio/mp4' };
  if (buf.toString('ascii', 0, 3) === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) {
    return { ext: 'mp3', mime: 'audio/mpeg' };
  }
  if (buf.toString('ascii', 0, 4) === 'OggS') return { ext: 'ogg', mime: 'audio/ogg; codecs=opus' };
  if (buf.toString('ascii', 0, 4) === 'RIFF') return { ext: 'wav', mime: 'audio/wav' };
  return { ext: 'm4a', mime: 'audio/mp4' };
}

// ─── NEW: ytdlp-nodejs download helper ───
async function downloadWithYtdlp(url, mode, container, maxBytes, onStatus) {
  const ytdlp = new YtdlpNodejs();

  const tmpDir = os.tmpdir();
  const prefix = `wraith_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // Build format string based on mode
  let formatStr;
  if (mode === 'audio') {
    // Best audio, prefer m4a, fall back to best
    formatStr = container === 'mp3'
      ? 'bestaudio/best'
      : 'bestaudio[ext=m4a]/bestaudio/best';
  } else {
    // Best video with audio, prefer mp4
    formatStr = 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best';
  }

  const outputTemplate = path.join(tmpDir, `${prefix}.%(ext)s`);

  try {
    if (onStatus) onStatus(`⬇️ downloading via yt-dlp...`);

    const result = await withTimeout(
      ytdlp.download(url, {
        output: outputTemplate,
        format: formatStr,
        noPlaylist: true,
        retries: 3,
        noWarnings: true,
        noProgress: true,
        // Post-processing for audio extraction if mp3 requested
        ...(mode === 'audio' && container === 'mp3'
          ? {
              extractAudio: true,
              audioFormat: 'mp3',
              audioQuality: '0', // best
            }
          : {}),
      }),
      DOWNLOAD_TIMEOUT_MS,
      'yt-dlp download'
    );

    if (!result?.path || !fs.existsSync(result.path)) {
      throw new Error('yt-dlp produced no output file');
    }

    const stat = fs.statSync(result.path);
    if (stat.size > maxBytes) {
      fs.unlinkSync(result.path);
      throw new Error(`File too large (${(stat.size / 1048576).toFixed(1)} MB)`);
    }

    const buffer = fs.readFileSync(result.path);
    fs.unlinkSync(result.path);

    // Get title from yt-dlp metadata
    let title = 'media';
    try {
      const info = await withTimeout(
        ytdlp.getInfo(url, { noWarnings: true, noPlaylist: true }),
        15_000,
        'yt-dlp metadata'
      );
      if (info?.title) title = info.title;
    } catch {
      // title fallback
    }

    if (onStatus) onStatus(`✅ download complete (${(stat.size / 1048576).toFixed(1)} MB)`);

    return {
      buffer,
      title,
      thumbnail: thumbFor(extractYouTubeId(url)),
      provider: 'ytdlp-nodejs',
      size: stat.size,
    };
  } catch (err) {
    console.error(`[ytdlp-nodejs] failed: ${err.message}`);
    throw err;
  }
}

// ─── .song ───
export async function songCommand(sock, chat, msg, args) {
  return enqueue(async () => {
    try {
      const from = msg?.key?.participant || msg?.key?.remoteJid;
      if (!msg?.key?.fromMe && !isOwner(from)) {
        await react(sock, chat, msg, '❌');
        return sock.sendMessage(chat, { text: '⛔ Owner only.' }, { quoted: msg });
      }

      const query = Array.isArray(args) ? args.join(' ').trim() : '';
      if (!query) {
        await react(sock, chat, msg, '❌');
        return sock.sendMessage(chat, { text: '* WRAITH · SONG*\n\nUsage: `.song <query or URL>`' }, { quoted: msg });
      }

      const video = await resolveVideo(query);
      if (!video) {
        await react(sock, chat, msg, '❌');
        return sock.sendMessage(chat, { text: '❌ No video found.' }, { quoted: msg });
      }

      if (video.thumbnail) {
        await sock.sendMessage(chat, {
          image: { url: video.thumbnail },
          caption: `Downloading: *${video.title}*`,
        }, { quoted: msg }).catch(() => {});
      }

      const result = await downloadWithYtdlp(
        video.url,
        'audio',
        'm4a', // ytdlp-nodejs handles container via format string; m4a is safest
        AUDIO_MAX_BYTES,
        (s) => { sock.sendMessage(chat, { text: s }, { quoted: msg }).catch(() => {}); }
      );

      const safeTitle = (result.title || video.title || 'song').replace(/[^\w\s-]/g, '').trim() || 'song';

      await sock.sendMessage(chat, {
        audio: result.buffer,
        mimetype: 'audio/mp4',
        fileName: `${safeTitle}.m4a`,
        ptt: false,
      }, { quoted: msg });

      await react(sock, chat, msg, '✅');
    } catch (err) {
      console.error('[song] error:', err?.message);
      await react(sock, chat, msg, '❌');
      const detail = String(err?.message || err).slice(0, 180);
      await sock.sendMessage(chat, { text: `❌ Failed to download song.\n${detail}` }, { quoted: msg }).catch(() => {});
    }
  });
}

// ─── .video ───
export async function videoCommand(sock, chat, msg, args) {
  return enqueue(async () => {
    try {
      const from = msg?.key?.participant || msg?.key?.remoteJid;
      if (!msg?.key?.fromMe && !isOwner(from)) {
        await react(sock, chat, msg, '❌');
        return sock.sendMessage(chat, { text: '⛔ Owner only.' }, { quoted: msg });
      }

      const query = Array.isArray(args) ? args.join(' ').trim() : '';
      if (!query) {
        await react(sock, chat, msg, '❌');
        return sock.sendMessage(chat, { text: '* WRAITH · VIDEO*\n\nUsage: `.video <query or URL>`' }, { quoted: msg });
      }

      const video = await resolveVideo(query);
      if (!video) {
        await react(sock, chat, msg, '❌');
        return sock.sendMessage(chat, { text: '❌ No video found.' }, { quoted: msg });
      }

      if (video.thumbnail) {
        await sock.sendMessage(chat, {
          image: { url: video.thumbnail },
          caption: `Downloading: *${video.title}*`,
        }, { quoted: msg }).catch(() => {});
      }

      const result = await downloadWithYtdlp(
        video.url,
        'video',
        'mp4',
        VIDEO_MAX_BYTES,
        (s) => { sock.sendMessage(chat, { text: s }, { quoted: msg }).catch(() => {}); }
      );

      const safeTitle = (result.title || video.title || 'video').replace(/[^\w\s-]/g, '').trim() || 'video';

      await sock.sendMessage(chat, {
        video: result.buffer,
        mimetype: 'video/mp4',
        fileName: `${safeTitle}.mp4`,
        caption: `*${result.title || video.title || 'Video'}*`,
      }, { quoted: msg });

      await react(sock, chat, msg, '✅');
    } catch (err) {
      console.error('[video] error:', err?.message);
      await react(sock, chat, msg, '❌');
      const detail = String(err?.message || err).slice(0, 180);
      await sock.sendMessage(chat, { text: `❌ Failed to download video.\n${detail}` }, { quoted: msg }).catch(() => {});
    }
  });
}

// ─── .dl ───
export async function downloadCommand(sock, chat, msg, args) {
  const from = msg?.key?.participant || msg?.key?.remoteJid;
  if (!msg?.key?.fromMe && !isOwner(from)) {
    await react(sock, chat, msg, '❌');
    return sock.sendMessage(chat, { text: '⛔ Owner only.' }, { quoted: msg });
  }

  const arr = Array.isArray(args) ? [...args] : [];
  const urlIdx = arr.findIndex((p) => /^https?:\/\//i.test(p));

  if (urlIdx === -1) {
    await react(sock, chat, msg, '❌');
    return sock.sendMessage(chat, {
      text: [
        '* WRAITH · DOWNLOAD*',
        '',
        '• `.dl <url>` — auto',
        '• `.dl audio <url>` — audio',
        '• `.dl mp3 <url>` — mp3',
        '• `.song <query>` — search + audio',
        '• `.video <query>` — search + video',
      ].join('\n'),
    }, { quoted: msg });
  }

  const url = arr.splice(urlIdx, 1)[0];
  let mode = 'video';
  let container = 'mp4';

  for (const p of arr.map((x) => String(x).toLowerCase())) {
    if (p === 'audio' || p === 'a') { mode = 'audio'; container = 'm4a'; }
    else if (p === 'mp3') { mode = 'audio'; container = 'mp3'; }
    else if (p === 'm4a') { mode = 'audio'; container = 'm4a'; }
    else if (p === 'video' || p === 'v') { mode = 'video'; container = 'mp4'; }
  }

  if (isYouTubeUrl(url)) {
    if (mode === 'audio') return songCommand(sock, chat, msg, [url]);
    return videoCommand(sock, chat, msg, [url]);
  }

  // Non-YouTube: fall back to yt-dlp via @choewy/yt-dlp (unchanged)
  return downloadViaYtDlp(sock, chat, msg, url, mode, container);
}

// ─── Non-YouTube via yt-dlp (unchanged) ───
async function downloadViaYtDlp(sock, chat, msg, url, mode, container) {
  const prefix = `wraith_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const outTemplate = path.join(os.tmpdir(), `${prefix}.%(ext)s`);

  try {
    await sock.sendMessage(chat, { text: '⏳ downloading…' }, { quoted: msg });

    const ytDlp = new YtDlp({
      url,
      output: outTemplate,
      format: mode === 'audio' ? 'bestaudio/best' : 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
      quiet: true,
      noWarnings: true,
      noProgress: true,
      playlist: false,
      retries: 3,
    });

    const builder = mode === 'audio'
      ? ytDlp.audioFormat(container).audio()
      : ytDlp.mergeFormat('mp4').video();

    const result = await withTimeout(builder.download(), DOWNLOAD_TIMEOUT_MS, 'yt-dlp download');
    const outFile = result?.path;

    if (!outFile || !fs.existsSync(outFile)) throw new Error('no output file');

    const stat = fs.statSync(outFile);
    const cap = mode === 'audio' ? AUDIO_MAX_BYTES : VIDEO_MAX_BYTES;
    if (stat.size > cap) {
      try { fs.unlinkSync(outFile); } catch {}
      throw new Error(`File too large (${(stat.size / 1048576).toFixed(1)} MB)`);
    }

    const stream = fs.createReadStream(outFile);
    const cleanup = () => { try { fs.unlinkSync(outFile); } catch {} };
    stream.on('close', cleanup);
    stream.on('error', cleanup);

    const filename = path.basename(outFile);

    if (mode === 'audio') {
      await sock.sendMessage(chat, {
        audio: { stream },
        mimetype: 'audio/mpeg',
        fileName: filename,
        ptt: false,
      }, { quoted: msg });
    } else {
      await sock.sendMessage(chat, {
        video: { stream },
        mimetype: 'video/mp4',
        fileName: filename,
        caption: filename,
      }, { quoted: msg });
    }

    await react(sock, chat, msg, '✅');
  } catch (err) {
    console.error('[dl] error:', err?.message);
    await react(sock, chat, msg, '❌');
    await sock.sendMessage(chat, {
      text: `❌ Download failed.\n${String(err?.message || err).slice(0, 180)}`,
    }, { quoted: msg }).catch(() => {});
  }
}
