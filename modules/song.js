// ─────────────────────────────────────────────
// WRAITH · modules/song.js
// .song → @snwfdhmp/soundcloud-downloader (priority)
//      → @choewy/yt-dlp binary (fallback, live %)
//      → final ☑ green tick react
// ─────────────────────────────────────────────
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import PQueue from 'p-queue';

const require = createRequire(import.meta.url);

// ─── SoundCloud downloader (CJS, defensive) ───
let scdl = null;
try {
  const mod = require('@snwfdhmp/soundcloud-downloader');
  scdl = mod?.default || mod;
} catch (e) {
  console.warn('[song] @snwfdhmp/soundcloud-downloader unavailable:', e.message);
}

// ─── yt-dlp binary resolver (@choewy/yt-dlp) ───
let YTDLP_BIN = 'yt-dlp';
try {
  const ytdlp = require('@choewy/yt-dlp');
  const candidate =
    ytdlp?.path ||
    ytdlp?.binary ||
    ytdlp?.default?.path ||
    ytdlp?.default?.binary ||
    null;
  if (candidate && fs.existsSync(candidate)) YTDLP_BIN = candidate;
} catch {}

const TMP_DIR = path.join(os.tmpdir(), 'wraith-song');
fs.mkdirSync(TMP_DIR, { recursive: true });

const AUDIO_MAX_BYTES = 15 * 1024 * 1024;
const queue = new PQueue({ concurrency: 1 });

// ─── Helpers ───
async function react(sock, chat, msg, emoji) {
  try { await sock.sendMessage(chat, { react: { text: emoji, key: msg.key } }); } catch {}
}
async function editMessage(sock, chat, key, text) {
  try { await sock.sendMessage(chat, { text, edit: key.key }); } catch {}
}
function progressBar(pct) {
  const filled = Math.max(0, Math.min(20, Math.round(pct / 5)));
  return '█'.repeat(filled) + '░'.repeat(20 - filled);
}
function cleanFile(p) {
  try { if (p && fs.existsSync(p)) fs.unlinkSync(p); } catch {}
}
function newestMp3(dir) {
  const files = fs.readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.mp3'))
    .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  return files[0] ? path.join(dir, files[0].f) : null;
}

// ─── SoundCloud client_id scrape ───
let _cachedClientId = null;
async function getSoundcloudClientId() {
  if (_cachedClientId) return _cachedClientId;

  const res = await fetch('https://soundcloud.com', {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
  });
  const html = await res.text();

  const candidates = [
    ...[...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]),
    ...[...html.matchAll(/https:\/\/a-v2\.sndcdn\.com\/assets\/[^"']+\.js/g)].map((m) => m[0])
  ];

  for (const src of candidates) {
    const full = src.startsWith('http') ? src : `https://soundcloud.com${src}`;
    try {
      const js = await (await fetch(full)).text();
      const m = js.match(/client_id\s*[:=]\s*["']([a-zA-Z0-9]{20,})["']/);
      if (m) {
        _cachedClientId = m[1];
        return _cachedClientId;
      }
    } catch {}
  }
  throw new Error('Could not extract SoundCloud client_id');
}

async function searchSoundcloud(query) {
  const clientId = await getSoundcloudClientId();
  const url =
    `https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(query)}` +
    `&client_id=${clientId}&limit=1&app_locale=en`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`SoundCloud search HTTP ${res.status}`);
  const data = await res.json();
  if (!data.collection || !data.collection.length) return null;
  return data.collection[0];
}

// ─── SoundCloud download ───
async function downloadViaSoundcloud(query, outFile) {
  if (!scdl) throw new Error('soundcloud-downloader not installed');
  const track = await searchSoundcloud(query);
  if (!track || !track.permalink_url) throw new Error('No SoundCloud result');

  const stream = await scdl.download(track.permalink_url);
  await new Promise((resolve, reject) => {
    const ws = fs.createWriteStream(outFile);
    stream.pipe(ws);
    stream.on('error', reject);
    ws.on('finish', resolve);
    ws.on('error', reject);
  });

  if (!fs.existsSync(outFile) || fs.statSync(outFile).size < 1024) {
    throw new Error('SoundCloud download produced empty file');
  }
  return track;
}

// ─── yt-dlp fallback ───
function runYtDlp(query, outFile, onProgress) {
  return new Promise((resolve, reject) => {
    const args = [
      `scsearch1:${query}`,
      '-x',
      '--audio-format', 'mp3',
      '--audio-quality', '0',
      '--newline',
      '--no-playlist',
      '--force-overwrites',
      '-o', outFile
    ];
    const proc = spawn(YTDLP_BIN, args);
    let err = '';
    proc.stdout.on('data', (chunk) => {
      const m = chunk.toString().match(/\[download\]\s+([\d.]+)%/);
      if (m && onProgress) onProgress(parseFloat(m[1]));
    });
    proc.stderr.on('data', (d) => { err += d.toString(); });
    proc.on('error', (e) => reject(new Error(`yt-dlp not found: ${e.message}`)));
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(err.slice(-200) || `yt-dlp exited ${code}`));
    });
  });
}

// ─── Main handler ───
export async function songCommand(sock, chat, msg, args) {
  const query = (args || []).join(' ').trim();
  if (!query) {
    return sock.sendMessage(chat, { text: '❌ Usage: `.song <song name>`' }, { quoted: msg });
  }

  return queue.add(async () => {
    const status = await sock.sendMessage(chat, {
      text: `🎵 *Searching:* ${query}`
    }, { quoted: msg });

    let outFile = null;
    let usedSource = null;

    try {
      // ── SoundCloud first ──
      await editMessage(sock, chat, status, `🎵 *Searching SoundCloud…*`);

      outFile = path.join(TMP_DIR, `wraith-${Date.now()}.mp3`);
      let soundcloudOk = false;

      try {
        await editMessage(sock, chat, status, `🎵 *Downloading from SoundCloud…*`);
        const track = await downloadViaSoundcloud(query, outFile);
        soundcloudOk = true;
        usedSource = 'SoundCloud';
        await editMessage(sock, chat, status,
          `🎵 *Downloaded from SoundCloud ✅*\n\n_${(track.title || query).slice(0, 60)}_`);
      } catch (scErr) {
        console.warn('[song] SoundCloud failed:', scErr.message);
        cleanFile(outFile);
        outFile = null;
      }

      // ── yt-dlp fallback with live progress ──
      if (!soundcloudOk) {
        usedSource = 'yt-dlp';
        outFile = path.join(TMP_DIR, `wraith-${Date.now()}.mp3`);

        await editMessage(sock, chat, status,
          `🎵 *Downloading using yt-dlp…*\n\n[${progressBar(0)}] 0%`);

        let lastPct = -1;
        await runYtDlp(query, outFile, async (pct) => {
          if (pct - lastPct < 5 && pct < 100) return;
          lastPct = pct;
          await editMessage(sock, chat, status,
            `🎵 *Downloading using yt-dlp…*\n\n[${progressBar(pct)}] ${pct.toFixed(1)}%`);
        });

        await editMessage(sock, chat, status,
          `🎵 *Downloaded ✅*\n\nNow converting to MP3…`);

        if (!fs.existsSync(outFile)) {
          const alt = newestMp3(TMP_DIR);
          if (!alt) throw new Error('No output file from yt-dlp');
          if (alt !== outFile) fs.renameSync(alt, outFile);
        }

        await editMessage(sock, chat, status,
          `🎵 *Downloaded ✅*\n*Converted to MP3 ✅*\n\nUploading…`);
      }

      const stat = fs.statSync(outFile);
      if (stat.size > AUDIO_MAX_BYTES) {
        const mb = (stat.size / 1024 / 1024).toFixed(2);
        await editMessage(sock, chat, status,
          `⚠️ File too big (${mb} MB). WhatsApp limit ~15 MB.`);
        await react(sock, chat, msg, '❌');
        cleanFile(outFile);
        return;
      }

      const buffer = fs.readFileSync(outFile);
      const safeName = query.replace(/[^\w\s-]/g, '').slice(0, 50).trim() || 'audio';

      await sock.sendMessage(chat, {
        audio: buffer,
        mimetype: 'audio/mpeg',
        fileName: `${safeName}.mp3`,
        ptt: false
      }, { quoted: msg });

      await editMessage(sock, chat, status, `✅ *Done via ${usedSource}*`);
      await react(sock, chat, msg, '☑');
      cleanFile(outFile);

    } catch (err) {
      console.error('[song]', err.message);
      await editMessage(sock, chat, status, `❌ *Failed:* ${err.message}`);
      await react(sock, chat, msg, '❌');
      if (outFile) cleanFile(outFile);
    }
  });
}
