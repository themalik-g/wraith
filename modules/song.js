// ─────────────────────────────────────────────
// WRAITH · modules/song.js
// Primary: @snwfdhmp/soundcloud-downloader → ffmpeg-static → proper MP3
// Backup : SoundCloud search → scored best match → yt-dlp
// ─────────────────────────────────────────────
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import PQueue from 'p-queue';
import ffmpegPath from 'ffmpeg-static';

const require = createRequire(import.meta.url);

// ─── SoundCloud downloader (CJS, defensive) ───
let scdl = null;
try {
  const mod = require('@snwfdhmp/soundcloud-downloader');
  scdl = mod?.default || mod;
} catch (e) {
  console.warn('[song] @snwfdhmp/soundcloud-downloader unavailable:', e.message);
}

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
function cleanFile(p) {
  try { if (p && fs.existsSync(p)) fs.unlinkSync(p); } catch {}
}
function newestAudio(dir, since) {
  const files = fs.readdirSync(dir)
    .filter((f) => /\.(mp3|m4a|opus|ogg|wav|webm)$/i.test(f))
    .map((f) => {
      const full = path.join(dir, f);
      return { f, full, t: fs.statSync(full).mtimeMs };
    })
    .filter((x) => !since || x.t >= since)
    .sort((a, b) => b.t - a.t);
  return files[0] ? files[0].full : null;
}

// ─────────────────────────────────────────────
//  PROPER MP3 CONVERTER (ffmpeg-static)
// ─────────────────────────────────────────────
function convertToMp3(inputPath, outputPath, bitrate = 192) {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error('ffmpeg-static binary missing — run `npm install`'));
    if (!fs.existsSync(inputPath)) return reject(new Error('input file does not exist'));

    const proc = spawn(ffmpegPath, [
      '-hide_banner',
      '-loglevel', 'error',
      '-i', inputPath,
      '-vn',
      '-codec:a', 'libmp3lame',
      '-b:a', `${bitrate}k`,
      '-y',
      outputPath,
    ]);

    let err = '';
    proc.stderr.on('data', (d) => { err += d.toString(); });
    proc.on('error', (e) => reject(new Error(`ffmpeg spawn failed: ${e.message}`)));
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg exited ${code}: ${err.slice(-200) || 'unknown'}`));
      try {
        if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size < 1024) {
          return reject(new Error('ffmpeg produced empty mp3'));
        }
        resolve(outputPath);
      } catch (e) { reject(e); }
    });
  });
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
      if (m) { _cachedClientId = m[1]; return _cachedClientId; }
    } catch {}
  }
  throw new Error('Could not extract SoundCloud client_id');
}

// ─────────────────────────────────────────────
//  SCORING — pick the best match, not just the first
//
//  SoundCloud no longer ranks by relevance. The API
//  returns tracks by creation date, so the first hit
//  is often a cover, remix, karaoke, or an unrelated
//  upload that happens to contain the words.
//
//  We fetch many results, then score each one:
//    · exact / starts-with / contains title match
//    · artist name appears in the query (or vice versa)
//    · duration is in the normal song range
//    · penalties for cover/remix/live/karaoke/sped-up
// ─────────────────────────────────────────────
function scoreTrack(track, query) {
  const q = String(query || '').toLowerCase().trim();
  const title = String(track?.title || '').toLowerCase();
  const artist = String(track?.user?.username || '').toLowerCase();
  const dur = Number(track?.duration) || 0; // milliseconds

  let score = 0;

  // Title match
  if (title === q) score += 120;
  else if (title.startsWith(q)) score += 80;
  else if (title.includes(q)) score += 60;
  else {
    const words = q.split(/\s+/).filter(Boolean);
    if (words.length) {
      const hits = words.filter((w) => title.includes(w)).length;
      score += (hits / words.length) * 40;
    }
  }

  // Artist match
  if (artist && q.includes(artist)) score += 35;
  else if (artist && artist.includes(q)) score += 25;

  // Duration sanity (SoundCloud duration is in milliseconds)
  const sec = dur / 1000;
  if (sec >= 120 && sec <= 420) score += 30;
  else if (sec > 420) score += 10;
  else if (sec > 90 && sec < 120) score += 5;
  else if (sec < 60) score -= 40;
  else if (sec < 90) score -= 15;

  // Penalty words — covers, remixes, live, karaoke, sped up, etc.
  const bad = [
    'cover', 'remix', 'live', 'instrumental', 'karaoke',
    'reaction', 'sped up', 'slowed', 'nightcore',
    'tribute', 'parody', 'teaser', 'preview', 'snippet'
  ];
  for (const w of bad) {
    if (title.includes(w)) score -= 25;
    if (String(track?.description || '').toLowerCase().includes(w)) score -= 10;
  }

  // Prefer tracks with more plays (more likely the "real" upload)
  const plays = Number(track?.playback_count) || 0;
  if (plays > 100000) score += 15;
  else if (plays > 10000) score += 8;
  else if (plays > 1000) score += 3;

  return score;
}

// ─────────────────────────────────────────────
//  SoundCloud search — fetch many, return the BEST
// ─────────────────────────────────────────────
async function searchSoundcloud(query) {
  const clientId = await getSoundcloudClientId();
  const url =
    `https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(query)}` +
    `&client_id=${clientId}&limit=10&app_locale=en`;

  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`SoundCloud search HTTP ${res.status}`);

  const data = await res.json();
  const collection = Array.isArray(data?.collection) ? data.collection : [];
  if (!collection.length) return null;

  const scored = collection
    .map((t) => ({ track: t, score: scoreTrack(t, query) }))
    .sort((a, b) => b.score - a.score);

  return scored[0]?.track || null;
}

// ─── SoundCloud download (raw bytes) ───
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

// ─────────────────────────────────────────────
//  yt-dlp via @choewy/yt-dlp class API
// ─────────────────────────────────────────────
async function ytDlpDownload(url, outFile) {
  const { YtDlp } = await import('@choewy/yt-dlp');
  const ytDlp = new YtDlp({
    url,
    output: outFile.replace(/\.mp3$/i, '.%(ext)s'),
    format: 'bestaudio/best',
    quiet: true,
    noWarnings: true,
    noProgress: true,
    playlist: false,
    retries: 3,
  });
  const result = await ytDlp.audioFormat('mp3').audio().download();
  return result;
}

// ─────────────────────────────────────────────
//  Main handler
// ─────────────────────────────────────────────
export async function songCommand(sock, chat, msg, args) {
  const query = (args || []).join(' ').trim();
  if (!query) {
    return sock.sendMessage(chat, { text: '❌ Usage: `.song <song name>`' }, { quoted: msg });
  }

  return queue.add(async () => {
    const status = await sock.sendMessage(chat, {
      text: `🎵 *Searching:* ${query}`
    }, { quoted: msg });

    const stamp = Date.now();
    let rawFile = path.join(TMP_DIR, `wraith-raw-${stamp}.bin`);
    let mp3File = path.join(TMP_DIR, `wraith-${stamp}.mp3`);
    let usedSource = null;
    let chosenTrack = null;

    try {
      // ── Step 1: SoundCloud search + download ──
      await editMessage(sock, chat, status, `🔍 *Searching SoundCloud…*`);

      let soundcloudOk = false;
      try {
        const track = await searchSoundcloud(query);
        if (!track || !track.permalink_url) throw new Error('No suitable SoundCloud result');

        chosenTrack = track;
        await editMessage(sock, chat, status,
          `🎵 *Found:* ${track.title}\n_by ${track.user?.username || '?'}_\n\n⬇️ Downloading…`);

        // Download the exact track we picked (bypasses the old limit=1 bug)
        if (!scdl) throw new Error('soundcloud-downloader not installed');
        const stream = await scdl.download(track.permalink_url);
        await new Promise((resolve, reject) => {
          const ws = fs.createWriteStream(rawFile);
          stream.pipe(ws);
          stream.on('error', reject);
          ws.on('finish', resolve);
          ws.on('error', reject);
        });

        if (!fs.existsSync(rawFile) || fs.statSync(rawFile).size < 1024) {
          throw new Error('SoundCloud download produced empty file');
        }

        soundcloudOk = true;
        usedSource = 'SoundCloud';

        await editMessage(sock, chat, status,
          `🎵 *Downloaded from SoundCloud ✅*\n\n⚙️ Converting to MP3…`);
      } catch (scErr) {
        console.warn('[song] SoundCloud downloader failed:', scErr.message);
        cleanFile(rawFile);
        rawFile = null;
      }

      // ── Step 2: Convert to proper MP3 ──
      if (soundcloudOk && rawFile) {
        try {
          await convertToMp3(rawFile, mp3File, 192);
          await editMessage(sock, chat, status,
            `🎵 *Downloaded from SoundCloud ✅*\n*Converted to MP3 ✅*\n\nUploading…`);
        } catch (convErr) {
          console.warn('[song] MP3 conversion failed:', convErr.message);
          cleanFile(mp3File);
          soundcloudOk = false;
        }
      }

      // ── Step 3: Backup — SoundCloud search → yt-dlp ──
      if (!soundcloudOk) {
        usedSource = 'yt-dlp';
        mp3File = path.join(TMP_DIR, `wraith-${Date.now()}.mp3`);
        const before = Date.now();

        let trackUrl = null;

        // Try to find the exact URL via our scored search first
        try {
          await editMessage(sock, chat, status, `🔍 *Searching SoundCloud (backup)…*`);
          const track = await searchSoundcloud(query);
          if (track?.permalink_url) {
            trackUrl = track.permalink_url;
            chosenTrack = track;
            await editMessage(sock, chat, status,
              `🎵 *Found:* ${track.title}\n_by ${track.user?.username || '?'}_\n\n⬇️ Downloading via yt-dlp…`);
          }
        } catch (e) {
          console.warn('[song] SoundCloud backup search failed:', e.message);
        }

        // Last resort: let yt-dlp do its own SoundCloud search
        if (!trackUrl) {
          trackUrl = `scsearch1:${query}`;
          await editMessage(sock, chat, status, `🎵 *Downloading via yt-dlp…*`);
        }

        await ytDlpDownload(trackUrl, mp3File);

        if (!fs.existsSync(mp3File)) {
          const alt = newestAudio(TMP_DIR, before);
          if (!alt) throw new Error('yt-dlp produced no output');
          if (alt !== mp3File) fs.renameSync(alt, mp3File);
        }

        // If yt-dlp produced non-mp3, convert it
        if (!/\.mp3$/i.test(mp3File) || !fs.existsSync(mp3File)) {
          const alt = newestAudio(TMP_DIR, before);
          if (alt) {
            const converted = path.join(TMP_DIR, `wraith-conv-${Date.now()}.mp3`);
            await convertToMp3(alt, converted, 192);
            mp3File = converted;
          }
        }

        await editMessage(sock, chat, status,
          `🎵 *Downloaded ✅*\n*Converted to MP3 ✅*\n\nUploading…`);
      }

      // ── Step 4: verify ──
      if (!mp3File || !fs.existsSync(mp3File)) {
        throw new Error('No audio file produced');
      }
      const stat = fs.statSync(mp3File);
      if (stat.size > AUDIO_MAX_BYTES) {
        const mb = (stat.size / 1024 / 1024).toFixed(2);
        await editMessage(sock, chat, status,
          `⚠️ File too big (${mb} MB). WhatsApp limit ~15 MB.`);
        await react(sock, chat, msg, '❌');
        cleanFile(mp3File);
        cleanFile(rawFile);
        return;
      }
      if (stat.size < 1024) throw new Error('audio file is empty');

      // ── Step 5: send ──
      const buffer = fs.readFileSync(mp3File);
      const safeName = query.replace(/[^\w\s-]/g, '').slice(0, 50).trim() || 'audio';

      await sock.sendMessage(chat, {
        audio: buffer,
        mimetype: 'audio/mpeg',
        fileName: `${safeName}.mp3`,
        ptt: false
      }, { quoted: msg });

      const titleLine = chosenTrack
        ? `_${chosenTrack.title} — ${chosenTrack.user?.username || '?'}_`
        : '';
      await editMessage(sock, chat, status,
        `✅ *Done via ${usedSource}*\n${titleLine}`);
      await react(sock, chat, msg, '☑');
      cleanFile(mp3File);
      cleanFile(rawFile);

    } catch (err) {
      console.error('[song]', err.message);
      await editMessage(sock, chat, status, `❌ *Failed:* ${err.message}`);
      await react(sock, chat, msg, '❌');
      if (mp3File) cleanFile(mp3File);
      if (rawFile) cleanFile(rawFile);
    }
  });
}
