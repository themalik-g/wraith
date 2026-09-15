// ─────────────────────────────────────────────
// WRAITH · modules/song.js
// Primary: @snwfdhmp/soundcloud-downloader → proper MP3 conversion
// Backup : SoundCloud search → yt-dlp downloads the track URL
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
function newestAudio(dir) {
  const files = fs.readdirSync(dir)
    .filter((f) => /\.(mp3|m4a|opus|ogg|wav|webm)$/i.test(f))
    .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  return files[0] ? path.join(dir, files[0].f) : null;
}

// ─── Format detection from file header ───
function detectAudioFormat(buf) {
  if (!buf || buf.length < 12) return { ext: 'mp3', mime: 'audio/mpeg' };
  const a4 = buf.toString('ascii', 4, 8);
  const a0 = buf.toString('ascii', 0, 4);
  if (a4 === 'ftyp') return { ext: 'm4a', mime: 'audio/mp4' };
  if (a0 === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) return { ext: 'mp3', mime: 'audio/mpeg' };
  if (a0 === 'OggS') return { ext: 'ogg', mime: 'audio/ogg; codecs=opus' };
  if (a0 === 'RIFF') return { ext: 'wav', mime: 'audio/wav' };
  if (a0 === 'fLaC') return { ext: 'flac', mime: 'audio/flac' };
  return { ext: 'mp3', mime: 'audio/mpeg' };
}

// ─────────────────────────────────────────────
//  PROPER MP3 CONVERTER
//  audio-decode (decode any format → PCM)
//  @audio/encode (encode PCM → MP3 via WASM)
//  No ffmpeg binary required.
// ─────────────────────────────────────────────
let _decodeAudio = null;
let _encode = null;

async function getDecodeAudio() {
  if (_decodeAudio) return _decodeAudio;
  try {
    const mod = await import('audio-decode');
    _decodeAudio = mod.default || mod;
    return _decodeAudio;
  } catch (e) {
    console.warn('[song] audio-decode unavailable:', e.message);
    return null;
  }
}

async function getEncoder() {
  if (_encode) return _encode;
  try {
    const mod = await import('@audio/encode');
    _encode = mod.default || mod;
    return _encode;
  } catch (e) {
    console.warn('[song] @audio/encode unavailable:', e.message);
    return null;
  }
}

/**
 * Convert any audio file to a proper MP3.
 * Returns the output path on success, throws on failure.
 */
async function convertToMp3(inputPath, outputPath, bitrate = 192) {
  const decodeAudio = await getDecodeAudio();
  const encode = await getEncoder();

  if (!decodeAudio || !encode) {
    throw new Error('MP3 conversion libraries not available (audio-decode + @audio/encode)');
  }

  const buffer = fs.readFileSync(inputPath);
  const audioBuffer = await decodeAudio(buffer);

  const channelCount = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const length = audioBuffer.length;

  if (!length) throw new Error('decoded audio is empty');

  // Build Float32Array[] — one per channel
  const channels = [];
  for (let i = 0; i < channelCount; i++) {
    channels.push(audioBuffer.getChannelData(i));
  }

  // Encode to MP3
  const mp3 = await encode.mp3(channels, {
    sampleRate,
    bitrate,
  });

  fs.writeFileSync(outputPath, Buffer.from(mp3));

  // Verify output
  if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size < 1024) {
    throw new Error('MP3 conversion produced empty output');
  }

  return outputPath;
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

// ─── SoundCloud download (raw) ───
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

// ─── yt-dlp download from a specific URL (with live progress) ───
function runYtDlp(url, outFile, onProgress) {
  return new Promise((resolve, reject) => {
    const args = [
      url,
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

    let rawFile = null;        // what SoundCloud downloader gave us
    let mp3File = null;        // final MP3 to send
    let usedSource = null;

    try {
      // ── Step 1: SoundCloud download ──
      await editMessage(sock, chat, status, `🎵 *Searching SoundCloud…*`);

      const stamp = Date.now();
      rawFile = path.join(TMP_DIR, `wraith-raw-${stamp}.bin`);
      mp3File = path.join(TMP_DIR, `wraith-${stamp}.mp3`);

      let soundcloudOk = false;

      try {
        await editMessage(sock, chat, status, `🎵 *Downloading from SoundCloud…*`);
        const track = await downloadViaSoundcloud(query, rawFile);
        soundcloudOk = true;
        usedSource = 'SoundCloud';
        await editMessage(sock, chat, status,
          `🎵 *Downloaded from SoundCloud ✅*\n\n_${(track.title || query).slice(0, 60)}_\n\n⚙️ Converting to MP3…`);
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
          // Fall through to yt-dlp backup
          cleanFile(mp3File);
          mp3File = null;
          soundcloudOk = false;
        }
      }

      // ── Step 3: Backup — SoundCloud search → yt-dlp download ──
      if (!soundcloudOk) {
        usedSource = 'yt-dlp (SoundCloud URL)';
        mp3File = path.join(TMP_DIR, `wraith-${Date.now()}.mp3`);

        let trackUrl = null;
        try {
          await editMessage(sock, chat, status, `🔍 *Searching SoundCloud for backup…*`);
          const track = await searchSoundcloud(query);
          if (track?.permalink_url) {
            trackUrl = track.permalink_url;
          }
        } catch (e) {
          console.warn('[song] SoundCloud backup search failed:', e.message);
        }

        if (!trackUrl) {
          // Last resort: let yt-dlp search SoundCloud itself
          trackUrl = `scsearch1:${query}`;
          usedSource = 'yt-dlp (scsearch)';
        }

        await editMessage(sock, chat, status,
          `🎵 *Downloading via yt-dlp…*\n\n[${progressBar(0)}] 0%`);

        let lastPct = -1;
        await runYtDlp(trackUrl, mp3File, async (pct) => {
          if (pct - lastPct < 5 && pct < 100) return;
          lastPct = pct;
          await editMessage(sock, chat, status,
            `🎵 *Downloading via yt-dlp…*\n\n[${progressBar(pct)}] ${pct.toFixed(1)}%`);
        });

        // yt-dlp sometimes names the file differently
        if (!fs.existsSync(mp3File)) {
          const alt = newestAudio(TMP_DIR);
          if (!alt) throw new Error('No output file from yt-dlp');
          if (alt !== mp3File) fs.renameSync(alt, mp3File);
        }

        await editMessage(sock, chat, status,
          `🎵 *Downloaded ✅*\n*Converted to MP3 ✅*\n\nUploading…`);
      }

      // ── Step 4: size check ──
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

      if (stat.size < 1024) {
        throw new Error('audio file is empty');
      }

      // ── Step 5: send ──
      const buffer = fs.readFileSync(mp3File);
      const safeName = query.replace(/[^\w\s-]/g, '').slice(0, 50).trim() || 'audio';

      await sock.sendMessage(chat, {
        audio: buffer,
        mimetype: 'audio/mpeg',
        fileName: `${safeName}.mp3`,
        ptt: false
      }, { quoted: msg });

      await editMessage(sock, chat, status, `✅ *Done via ${usedSource}*`);
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
