// ─────────────────────────────────────────────
// WRAITH · modules/download.js
// YouTube downloader using yt-direct (InnerTube API, no cookies)
// ─────────────────────────────────────────────

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { YtDlp } from '@choewy/yt-dlp';
import ytdl from 'yt-direct';
import { isOwner } from '../core/identity.js';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

const VIDEO_MAX_BYTES = 128 * 1024 * 1024; // 128 MB
const AUDIO_MAX_BYTES = 15 * 1024 * 1024;  // 15 MB
const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const SEARCH_TIMEOUT_MS = 20_000;
const CHAIN_TIMEOUT_MS = 3 * 60 * 1000;

async function react(sock, chat, msg, emoji) {
  try {
    await sock.sendMessage(chat, { react: { text: emoji, key: msg.key } });
  } catch (e) {
    console.error('[react]', e?.message);
  }
}

// ─── Queue ───
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

// ─── Converter ───
let _toAudio;
async function getConverter() {
  if (_toAudio !== undefined) return _toAudio;
  try {
    const m = await import('../lib/converter.js');
    _toAudio = m.toAudio || m.default?.toAudio || null;
  } catch {
    _toAudio = null;
  }
  return _toAudio;
}

// ─── fetch timeout ───
async function fetchWithTimeout(url, opts = {}, ms = 60_000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`timeout after ${ms / 1000}s`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
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

async function withRetry(fn, attempts = 2, gapMs = 800) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i < attempts) await new Promise((r) => setTimeout(r, gapMs));
    }
  }
  throw lastErr;
}

// ─── yt-dlp binary (for search fallback & non-YouTube) ───
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
      path.join(pkgDir, 'yt-dlp.exe'),
      path.join(pkgDir, 'dist', 'yt-dlp'),
      path.join(pkgDir, 'dist', 'yt-dlp.exe')
    );
  } catch {}
  candidates.push(
    '/usr/local/bin/yt-dlp',
    '/usr/bin/yt-dlp',
    '/bin/yt-dlp',
    '/opt/yt-dlp/yt-dlp'
  );
  for (const c of candidates) {
    try {
      if (fs.statSync(c).isFile()) return c;
    } catch {}
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
  const res = await fetchWithTimeout(
    url,
    {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        Accept: 'text/html,application/xhtml+xml',
      },
    },
    SEARCH_TIMEOUT_MS
  );
  if (!res.ok) throw new Error(`YouTube search HTTP ${res.status}`);
  const html = await res.text();
  const m = html.match(/"videoRenderer":\{"videoId":"([A-Za-z0-9_-]{11})"/);
  if (!m) throw new Error('No video results found');
  const id = m[1];
  let title = query;
  try {
    const tRe = new RegExp(`"videoId":"${id}".*?"title":\\{"runs":\\[\\{"text":"(.*?)"`);
    const tm = html.match(tRe);
    if (tm) title = JSON.parse(`"${tm[1]}"`);
  } catch {}
  return { id, url: `https://www.youtube.com/watch?v=${id}`, title };
}

async function searchYouTube(query) {
  const viaYtDlp = await ytDlpSearch(query);
  if (viaYtDlp) return { id: viaYtDlp.id, url: viaYtDlp.url, title: query };
  return scraperSearch(query);
}

// ─── URL helpers ───
function isYouTubeUrl(u) {
  return /(?:youtube\.com|youtu\.be)/i.test(u);
}
function extractYouTubeId(u) {
  const m = u.match(/(?:youtu\.be\/|v=|embed\/|shorts\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}
function thumbFor(id) {
  return id ? `https://i.ytimg.com/vi/${id}/sddefault.jpg` : undefined;
}

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

// ─── yt-direct download helpers ───
async function downloadWithYtDirect(url, quality, format, maxBytes, onStatus) {
  try {
    if (onStatus) onStatus(`⏳ fetching metadata from YouTube...`);
    const video = await withTimeout(
      ytdl(url, {
        quality: quality, // 'audio' or a resolution like '720p'
        format: format,   // 'mp3', 'm4a', 'mp4', etc.
        timeout: 30000,
        retries: 3,
      }),
      DOWNLOAD_TIMEOUT_MS,
      'yt-direct metadata'
    );

    if (onStatus) onStatus(`⬇️ downloading ${video.title}...`);

    const tmpFile = path.join(os.tmpdir(), `wraith_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${format}`);
    const result = await withTimeout(
      video.download(tmpFile),
      DOWNLOAD_TIMEOUT_MS,
      'yt-direct download'
    );

    if (!fs.existsSync(tmpFile)) throw new Error('Downloaded file not found');

    const stat = fs.statSync(tmpFile);
    if (stat.size > maxBytes) {
      fs.unlinkSync(tmpFile);
      throw new Error(`File too large (${(stat.size / 1048576).toFixed(1)} MB)`);
    }

    const buffer = fs.readFileSync(tmpFile);
    fs.unlinkSync(tmpFile); // clean up immediately

    if (onStatus) onStatus(`✅ download complete (${(stat.size / 1048576).toFixed(1)} MB)`);

    return {
      buffer,
      title: video.title,
      thumbnail: video.thumbnail || thumbFor(extractYouTubeId(url)),
      provider: 'yt-direct',
      size: stat.size,
    };
  } catch (err) {
    console.error(`[yt-direct] failed: ${err.message}`);
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

      const result = await downloadWithYtDirect(
        video.url,
        'audio',       // quality: best audio
        'mp3',         // format: mp3
        AUDIO_MAX_BYTES,
        (s) => { sock.sendMessage(chat, { text: s }, { quoted: msg }).catch(() => {}); }
      );

      let buf = result.buffer;
      let fmt = detectFormat(buf);

      // If it's not MP3, try to convert
      if (fmt.ext !== 'mp3') {
        const toAudio = await getConverter();
        if (toAudio) {
          try {
            const converted = await withTimeout(toAudio(buf, fmt.ext), 30_000, 'conversion');
            if (converted?.length) {
              buf = converted;
              fmt = { ext: 'mp3', mime: 'audio/mpeg' };
            }
          } catch (e) {
            console.error('[song] convert failed:', e.message);
          }
        }
      }

      const safeTitle = (result.title || video.title || 'song').replace(/[^\w\s-]/g, '').trim() || 'song';

      await sock.sendMessage(chat, {
        audio: buf,
        mimetype: fmt.mime,
        fileName: `${safeTitle}.${fmt.ext}`,
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

      // For video, use 720p by default to keep file size manageable
      const result = await downloadWithYtDirect(
        video.url,
        '720p',        // quality
        'mp4',         // format
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
    if (mode === 'audio') {
      return songCommand(sock, chat, msg, [url]);
    }
    return videoCommand(sock, chat, msg, [url]);
  }

  // Non-YouTube: fall back to yt-dlp (existing implementation)
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
