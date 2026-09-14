// ─────────────────────────────────────────────
// WRAITH · modules/download.js
// YouTube  → yt-dlp search (binary) + scraper fallback
//            → EliteProTech → Yupra → Okatsu API chain
// Others   → yt-dlp (unchanged)
// Zero new npm dependencies. Native fetch only.
// ─────────────────────────────────────────────
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { YtDlp } from '@choewy/yt-dlp';
import { isOwner } from '../core/identity.js';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

// ── Safety caps ──
const VIDEO_MAX_BYTES = 64 * 1024 * 1024;
const AUDIO_MAX_BYTES = 15 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;
const HTTP_TIMEOUT_MS = 90_000;

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// ── Optional converter (only if lib/converter.js exists) ──
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

// ── fetch with AbortController timeout ──
async function fetchWithTimeout(url, opts = {}, ms = HTTP_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ── Retry wrapper ──
async function withRetry(fn, attempts = 3) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i < attempts) await new Promise((r) => setTimeout(r, 1000 * i));
    }
  }
  throw lastErr;
}

// ─────────────────────────────────────────────
// yt-dlp binary discovery
// ─────────────────────────────────────────────
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
  } catch {
    /* package not resolvable */
  }

  candidates.push(
    '/usr/local/bin/yt-dlp',
    '/usr/bin/yt-dlp',
    '/bin/yt-dlp',
    '/opt/yt-dlp/yt-dlp'
  );

  for (const c of candidates) {
    try {
      if (fs.statSync(c).isFile()) return c;
    } catch {
      /* keep looking */
    }
  }
  return null;
}

// ─────────────────────────────────────────────
// yt-dlp search — metadata only (no download, no bot wall)
// ─────────────────────────────────────────────
async function ytDlpSearch(query) {
  const bin = findYtDlpBinary();
  if (!bin) return null;

  try {
    const { stdout } = await execFileAsync(
      bin,
      [
        '--print', 'id',
        '--skip-download',
        '--no-warnings',
        '--no-playlist',
        `ytsearch1:${query}`,
      ],
      { timeout: 30_000, maxBuffer: 1024 * 1024 }
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

// ─────────────────────────────────────────────
// HTML scraper — fallback only
// ─────────────────────────────────────────────
async function scraperSearch(query) {
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=EgIQAQ%253D%253D`;
  const res = await fetchWithTimeout(url, {
    headers: {
      'User-Agent': UA,
      'Accept-Language': 'en-US,en;q=0.9',
      Accept: 'text/html,application/xhtml+xml',
    },
  });
  if (!res.ok) throw new Error(`YouTube search HTTP ${res.status}`);

  const html = await res.text();
  const m = html.match(/"videoRenderer":\{"videoId":"([A-Za-z0-9_-]{11})"/);
  if (!m) throw new Error('No video results found');

  const id = m[1];
  let title = query;
  try {
    const tRe = new RegExp(
      `"videoId":"${id}".*?"title":\\{"runs":\\[\\{"text":"(.*?)"`
    );
    const tm = html.match(tRe);
    if (tm) title = JSON.parse(`"${tm[1]}"`);
  } catch {
    /* keep query */
  }

  return { id, url: `https://www.youtube.com/watch?v=${id}`, title };
}

// ─────────────────────────────────────────────
// Unified search — yt-dlp first, scraper fallback
// ─────────────────────────────────────────────
async function searchYouTube(query) {
  const viaYtDlp = await ytDlpSearch(query);
  if (viaYtDlp) {
    return { id: viaYtDlp.id, url: viaYtDlp.url, title: query };
  }
  return scraperSearch(query);
}

// ─────────────────────────────────────────────
// Generic JSON GET
// ─────────────────────────────────────────────
async function getJson(url) {
  const res = await fetchWithTimeout(url, {
    headers: {
      'User-Agent': UA,
      Accept: 'application/json, text/plain, */*',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ─────────────────────────────────────────────
// Generic buffer download with size cap (streamed)
// ─────────────────────────────────────────────
async function fetchBuffer(url, maxBytes) {
  const res = await fetchWithTimeout(url, {
    headers: {
      'User-Agent': UA,
      Accept: '*/*',
      'Accept-Encoding': 'identity',
    },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const chunks = [];
  let total = 0;
  for await (const chunk of res.body) {
    total += chunk.length;
    if (maxBytes && total > maxBytes) {
      throw new Error(`File too large (>${(maxBytes / 1048576).toFixed(0)} MB)`);
    }
    chunks.push(chunk);
  }
  if (!total) throw new Error('Empty response');
  return Buffer.concat(chunks);
}

// ─────────────────────────────────────────────
// API providers — AUDIO
// ─────────────────────────────────────────────
async function eliteProTechAudio(url) {
  const api = `https://eliteprotech-apis.zone.id/ytdown?url=${encodeURIComponent(url)}&format=mp3`;
  const data = await withRetry(() => getJson(api));
  if (data?.success && data?.downloadURL) {
    return { download: data.downloadURL, title: data.title };
  }
  throw new Error('EliteProTech: no downloadURL');
}

async function yupraAudio(url) {
  const api = `https://api.yupra.my.id/api/downloader/ytmp3?url=${encodeURIComponent(url)}`;
  const data = await withRetry(() => getJson(api));
  if (data?.success && data?.data?.download_url) {
    return {
      download: data.data.download_url,
      title: data.data.title,
      thumbnail: data.data.thumbnail,
    };
  }
  throw new Error('Yupra: no download_url');
}

async function okatsuAudio(url) {
  const api = `https://okatsu-rolezapiiz.vercel.app/downloader/ytmp3?url=${encodeURIComponent(url)}`;
  const data = await withRetry(() => getJson(api));
  if (data?.dl) {
    return { download: data.dl, title: data.title, thumbnail: data.thumb };
  }
  throw new Error('Okatsu: no dl');
}

// ─────────────────────────────────────────────
// API providers — VIDEO
// ─────────────────────────────────────────────
async function eliteProTechVideo(url) {
  const api = `https://eliteprotech-apis.zone.id/ytdown?url=${encodeURIComponent(url)}&format=mp4`;
  const data = await withRetry(() => getJson(api));
  if (data?.success && data?.downloadURL) {
    return { download: data.downloadURL, title: data.title };
  }
  throw new Error('EliteProTech: no downloadURL');
}

async function yupraVideo(url) {
  const api = `https://api.yupra.my.id/api/downloader/ytmp4?url=${encodeURIComponent(url)}`;
  const data = await withRetry(() => getJson(api));
  if (data?.success && data?.data?.download_url) {
    return {
      download: data.data.download_url,
      title: data.data.title,
      thumbnail: data.data.thumbnail,
    };
  }
  throw new Error('Yupra: no download_url');
}

async function okatsuVideo(url) {
  const api = `https://okatsu-rolezapiiz.vercel.app/downloader/ytmp4?url=${encodeURIComponent(url)}`;
  const data = await withRetry(() => getJson(api));
  if (data?.result?.mp4) {
    return { download: data.result.mp4, title: data.result.title };
  }
  throw new Error('Okatsu: no mp4');
}

// ─────────────────────────────────────────────
// Chain executor
// ─────────────────────────────────────────────
async function tryApiChain(providers, url, maxBytes) {
  let lastErr;
  for (const p of providers) {
    try {
      const meta = await p.fn(url);
      const buf = await fetchBuffer(meta.download, maxBytes);
      return { ...meta, buffer: buf, provider: p.name };
    } catch (err) {
      lastErr = err;
      console.error(`[dl] ${p.name} failed: ${err.message}`);
    }
  }
  throw lastErr || new Error('All providers failed');
}

// ─────────────────────────────────────────────
// URL helpers
// ─────────────────────────────────────────────
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
  const found = await searchYouTube(input);
  return {
    url: found.url,
    title: found.title,
    thumbnail: thumbFor(found.id),
  };
}

// ─────────────────────────────────────────────
// Format detection
// ─────────────────────────────────────────────
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

// ─────────────────────────────────────────────
// .song <query | youtube-url>
// ─────────────────────────────────────────────
export async function songCommand(sock, chat, msg, args) {
  try {
    const from = msg?.key?.participant || msg?.key?.remoteJid;
    if (!msg?.key?.fromMe && !isOwner(from)) {
      return sock.sendMessage(chat, { text: '⛔ Owner only.' }, { quoted: msg });
    }

    const query = Array.isArray(args) ? args.join(' ').trim() : '';
    if (!query) {
      return sock.sendMessage(
        chat,
        { text: '* WRAITH · SONG*\n\nUsage: `.song <name or YouTube link>`' },
        { quoted: msg }
      );
    }

    const video = await resolveVideo(query);
    if (!video) {
      return sock.sendMessage(chat, { text: '❌ No results found.' }, { quoted: msg });
    }

    if (video.thumbnail) {
      await sock
        .sendMessage(
          chat,
          {
            image: { url: video.thumbnail },
            caption: `🎵 Downloading: *${video.title}*`,
          },
          { quoted: msg }
        )
        .catch(() => {});
    }

    const providers = [
      { name: 'EliteProTech', fn: eliteProTechAudio },
      { name: 'Yupra', fn: yupraAudio },
      { name: 'Okatsu', fn: okatsuAudio },
    ];

    const result = await tryApiChain(providers, video.url, AUDIO_MAX_BYTES);

    let buf = result.buffer;
    let fmt = detectFormat(buf);

    if (fmt.ext !== 'mp3') {
      const toAudio = await getConverter();
      if (toAudio) {
        try {
          const converted = await toAudio(buf, fmt.ext);
          if (converted?.length) {
            buf = converted;
            fmt = { ext: 'mp3', mime: 'audio/mpeg' };
          }
        } catch (e) {
          console.error('[song] convert failed, sending original:', e.message);
        }
      }
    }

    const safeTitle =
      (result.title || video.title || 'song')
        .replace(/[^\w\s-]/g, '')
        .trim() || 'song';

    await sock.sendMessage(
      chat,
      {
        audio: buf,
        mimetype: fmt.mime,
        fileName: `${safeTitle}.${fmt.ext}`,
        ptt: false,
      },
      { quoted: msg }
    );
  } catch (err) {
    console.error('[song] error:', err?.message);
    await sock
      .sendMessage(
        chat,
        { text: `❌ Failed to download song.\n_${String(err?.message || err).slice(0, 180)}_` },
        { quoted: msg }
      )
      .catch(() => {});
  }
}

// ─────────────────────────────────────────────
// .video <query | youtube-url>
// ─────────────────────────────────────────────
export async function videoCommand(sock, chat, msg, args) {
  try {
    const from = msg?.key?.participant || msg?.key?.remoteJid;
    if (!msg?.key?.fromMe && !isOwner(from)) {
      return sock.sendMessage(chat, { text: '⛔ Owner only.' }, { quoted: msg });
    }

    const query = Array.isArray(args) ? args.join(' ').trim() : '';
    if (!query) {
      return sock.sendMessage(
        chat,
        { text: '* WRAITH · VIDEO*\n\nUsage: `.video <name or YouTube link>`' },
        { quoted: msg }
      );
    }

    const video = await resolveVideo(query);
    if (!video) {
      return sock.sendMessage(chat, { text: '❌ No videos found.' }, { quoted: msg });
    }

    if (video.thumbnail) {
      await sock
        .sendMessage(
          chat,
          {
            image: { url: video.thumbnail },
            caption: `🎬 Downloading: *${video.title}*`,
          },
          { quoted: msg }
        )
        .catch(() => {});
    }

    const providers = [
      { name: 'EliteProTech', fn: eliteProTechVideo },
      { name: 'Yupra', fn: yupraVideo },
      { name: 'Okatsu', fn: okatsuVideo },
    ];

    const result = await tryApiChain(providers, video.url, VIDEO_MAX_BYTES);
    const safeTitle =
      (result.title || video.title || 'video')
        .replace(/[^\w\s-]/g, '')
        .trim() || 'video';

    await sock.sendMessage(
      chat,
      {
        video: result.buffer,
        mimetype: 'video/mp4',
        fileName: `${safeTitle}.mp4`,
        caption: `*${result.title || video.title || 'Video'}*`,
      },
      { quoted: msg }
    );
  } catch (err) {
    console.error('[video] error:', err?.message);
    await sock
      .sendMessage(
        chat,
        { text: `❌ Failed to download video.\n_${String(err?.message || err).slice(0, 180)}_` },
        { quoted: msg }
      )
      .catch(() => {});
  }
}

// ─────────────────────────────────────────────
// .dl <url> [audio|mp3|video]
//   YouTube → API chain
//   Others  → yt-dlp
// ─────────────────────────────────────────────
export async function downloadCommand(sock, chat, msg, args) {
  const from = msg?.key?.participant || msg?.key?.remoteJid;
  if (!msg?.key?.fromMe && !isOwner(from)) {
    return sock.sendMessage(chat, { text: '⛔ Owner only.' }, { quoted: msg });
  }

  const arr = Array.isArray(args) ? [...args] : [];
  const urlIdx = arr.findIndex((p) => /^https?:\/\//i.test(p));
  if (urlIdx === -1) {
    return sock.sendMessage(
      chat,
      {
        text: [
          '* WRAITH · DOWNLOAD*',
          '',
          '• `.dl <url>` — auto',
          '• `.dl audio <url>` — audio',
          '• `.dl mp3 <url>` — mp3',
          '• `.song <query>` — search + audio',
          '• `.video <query>` — search + video',
        ].join('\n'),
      },
      { quoted: msg }
    );
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

  await downloadViaYtDlp(sock, chat, msg, url, mode, container);
}

// ─────────────────────────────────────────────
// Non-YouTube via yt-dlp
// ─────────────────────────────────────────────
async function downloadViaYtDlp(sock, chat, msg, url, mode, container) {
  const prefix = `wraith_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const outTemplate = path.join(os.tmpdir(), `${prefix}.%(ext)s`);

  try {
    await sock.sendMessage(chat, { text: '⏳ downloading…' }, { quoted: msg });

    const ytDlp = new YtDlp({
      url,
      output: outTemplate,
      format:
        mode === 'audio'
          ? 'bestaudio/best'
          : 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
      quiet: true,
      noWarnings: true,
      noProgress: true,
      playlist: false,
      retries: 3,
    });

    const builder =
      mode === 'audio'
        ? ytDlp.audioFormat(container).audio()
        : ytDlp.mergeFormat('mp4').video();

    const result = await Promise.race([
      builder.download(),
      new Promise((_, rej) =>
        setTimeout(
          () => rej(new Error('Download timed out (5 min)')),
          DOWNLOAD_TIMEOUT_MS
        )
      ),
    ]);

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
    const payload =
      mode === 'audio'
        ? {
            audio: { stream },
            mimetype: container === 'mp3' ? 'audio/mpeg' : 'audio/mp4',
            fileName: filename,
            ptt: false,
          }
        : { video: { stream }, mimetype: 'video/mp4', fileName: filename };

    await sock.sendMessage(chat, payload, { quoted: msg });
  } catch (err) {
    console.error('[dl] yt-dlp error:', err?.message);
    await sock
      .sendMessage(
        chat,
        { text: `❌ Download failed.\n_${String(err?.message || err).slice(0, 180)}_` },
        { quoted: msg }
      )
      .catch(() => {});
  }
}
