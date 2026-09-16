// ─────────────────────────────────────────────
// WRAITH · modules/download.js
// .dl / .download  →  yt-dlp, any platform, native media type
// .mp3             →  yt-dlp audio extraction (-x --audio-format mp3)
//
//  · Media type auto-detected from magic bytes (file-type)
//  · Everything deleted after send (short delay + sweep)
//  · Leftovers never accumulate
// ─────────────────────────────────────────────
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import PQueue from 'p-queue';
import ffmpegPath from 'ffmpeg-static';
import { fileTypeFromBuffer } from 'file-type';

const TMP = path.join(os.tmpdir(), 'wraith-dl');
fs.mkdirSync(TMP, { recursive: true });

const MAX_BYTES      = 15 * 1024 * 1024;   // audio / image cap
const MAX_VIDEO      = 60 * 1024 * 1024;   // video cap
const YTDLP_TIMEOUT  = 120_000;
const CONVERT_TIMEOUT = 60_000;
const queue = new PQueue({ concurrency: 1 });

async function react(sock, chat, msg, emoji) {
  try { await sock.sendMessage(chat, { react: { text: emoji, key: msg.key } }); } catch {}
}
async function edit(sock, chat, key, text) {
  try { await sock.sendMessage(chat, { text, edit: key.key }); } catch {}
}
function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms/1000)}s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
function cleanFile(p) {
  try { if (p && fs.existsSync(p)) fs.unlinkSync(p); } catch {}
}
function sweepDir(dir, since) {
  try {
    for (const f of fs.readdirSync(dir)) {
      const full = path.join(dir, f);
      try { if (fs.statSync(full).mtimeMs >= since) fs.unlinkSync(full); } catch {}
    }
  } catch {}
}
function producedFiles(dir, since) {
  return fs.readdirSync(dir)
    .map((f) => ({ full: path.join(dir, f), t: fs.statSync(path.join(dir, f)).mtimeMs }))
    .filter((x) => x.t >= since)
    .sort((a, b) => a.t - b.t)
    .map((x) => x.full);
}

function bufferToMp3(inputBuffer, bitrate = 192) {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error('ffmpeg-static missing'));
    if (!inputBuffer || inputBuffer.length < 1024) return reject(new Error('input too small'));

    const ff = spawn(ffmpegPath, [
      '-hide_banner', '-loglevel', 'error',
      '-i', 'pipe:0', '-vn',
      '-codec:a', 'libmp3lame', '-b:a', `${bitrate}k`,
      '-f', 'mp3', 'pipe:1',
    ]);

    const chunks = []; let err = '';
    ff.stdout.on('data', (c) => chunks.push(c));
    ff.stderr.on('data', (d) => { err += d.toString(); });
    ff.on('error', (e) => reject(new Error(`ffmpeg spawn: ${e.message}`)));
    ff.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg ${code}: ${err.slice(-200)}`));
      const out = Buffer.concat(chunks);
      if (out.length < 1024) return reject(new Error('ffmpeg produced empty mp3'));
      resolve(out);
    });
    ff.stdin.on('error', () => {});
    ff.stdin.write(inputBuffer);
    ff.stdin.end();
  });
}

async function classifyBuffer(buffer) {
  const ft = await fileTypeFromBuffer(buffer).catch(() => null);
  if (!ft) return { kind: 'unknown', ext: 'bin', mime: 'application/octet-stream' };
  if (ft.mime.startsWith('audio/')) return { kind: 'audio', ext: ft.ext, mime: ft.mime };
  if (ft.mime.startsWith('video/')) return { kind: 'video', ext: ft.ext, mime: ft.mime };
  if (ft.mime.startsWith('image/')) return { kind: 'image', ext: ft.ext, mime: ft.mime };
  return { kind: 'unknown', ext: ft.ext, mime: ft.mime };
}

async function downloadMedia(sock, chat, msg, query, audioOnly) {
  const verbLabel = audioOnly ? '.mp3' : '.dl';
  const status = await sock.sendMessage(chat, {
    text: `${audioOnly ? '🎵' : '⬇️'} *${verbLabel}:* ${query}`,
  }, { quoted: msg });

  const runStart = Date.now();
  let produced = null;

  try {
    const { YtDlp } = await import('@choewy/yt-dlp');
    const isUrl = /^https?:\/\//i.test(query);

    const outTemplate = path.join(TMP, `wraith-%(playlist_index)s_%(id)s.%(ext)s`);
    const yt = new YtDlp({
      url: isUrl ? query : `scsearch1:${query}`,
      output: outTemplate,
      quiet: true, noWarnings: true, noProgress: true,
      playlist: true, retries: 3,
    });

    if (audioOnly) {
      await edit(sock, chat, status, '🎵 *Extracting audio…*');
      await withTimeout(
        yt.audioFormat('mp3').audio().download(),
        YTDLP_TIMEOUT,
        'audio download'
      );
    } else {
      await edit(sock, chat, status, '⬇️ *Downloading…*');
      try {
        await withTimeout(
          yt.format('bestvideo+bestaudio/best').mergeFormat('mp4').video().download(),
          YTDLP_TIMEOUT,
          'media download'
        );
      } catch {
        // Fallback for photo/slideshow posts or format merge failures
        const ytFallback = new YtDlp({
          url: isUrl ? query : `scsearch1:${query}`,
          output: outTemplate,
          quiet: true, noWarnings: true, noProgress: true,
          playlist: true, retries: 3,
        });
        ytFallback.format('');
        await withTimeout(
          ytFallback.video().download(),
          YTDLP_TIMEOUT,
          'fallback download'
        );
      }
    }

    const files = producedFiles(TMP, runStart);
    if (!files.length) throw new Error('No media file downloaded');

    const safeName = (query.replace(/[^\w\s-]/g, '').slice(0, 50).trim() || 'media');
    let sentCount = 0;

    for (const file of files.slice(0, 20)) {
      if (!fs.existsSync(file)) continue;
      let buffer = fs.readFileSync(file);
      cleanFile(file);

      if (buffer.length < 1024) continue;
      let type = await classifyBuffer(buffer);

      if (audioOnly && !(type.kind === 'audio' && type.ext === 'mp3')) {
        await edit(sock, chat, status, '⚙️ *Converting to mp3…*');
        buffer = await withTimeout(
          bufferToMp3(buffer, 192),
          CONVERT_TIMEOUT,
          'mp3 conversion'
        );
        type = { kind: 'audio', ext: 'mp3', mime: 'audio/mpeg' };
      }

      const limit = type.kind === 'video' ? MAX_VIDEO : MAX_BYTES;
      if (buffer.length > limit) continue;

      if (type.kind === 'image') {
        await sock.sendMessage(chat, {
          image: buffer, mimetype: type.mime, caption: `🖼️ _${safeName}_\n\nProvided by 𝙒𝙍𝘼𝙄𝙏🇭`,
        }, { quoted: msg });
        sentCount++;
      } else if (type.kind === 'video') {
        await sock.sendMessage(chat, {
          video: buffer, mimetype: type.mime || 'video/mp4',
          fileName: `${safeName}.${type.ext}`, caption: `🎬 _${safeName}_\n\nProvided by 𝙒𝙍𝘼𝙄𝙏🇭`,
        }, { quoted: msg });
        sentCount++;
      } else if (type.kind === 'audio') {
        await sock.sendMessage(chat, {
          audio: buffer, mimetype: type.mime || 'audio/mpeg',
          fileName: `${safeName}.${type.ext}`, ptt: false,
        }, { quoted: msg });
        sentCount++;
      } else {
        await sock.sendMessage(chat, {
          document: buffer, mimetype: type.mime,
          fileName: `${safeName}.${type.ext}`, caption: `📄 _${safeName}_\n\nProvided by 𝙒𝙍𝘼𝙄𝙏🇭`,
        }, { quoted: msg });
        sentCount++;
      }
    }

    if (sentCount === 0) throw new Error('Downloaded files were empty or exceeded size limits');

    await edit(sock, chat, status, `✅ *Download complete*\n_${safeName}_\n\nProvided by 𝙒𝙍𝘼𝙄𝙏🇭`);
    await react(sock, chat, msg, '☑');
  } catch (e) {
    try { console.error('[download]', e.message); } catch {}
    await edit(sock, chat, status, `❌ *Failed:* ${e.message}`);
    await react(sock, chat, msg, '❌');
  } finally {
    setTimeout(() => sweepDir(TMP, runStart), 10_000).unref?.();
  }
}

export async function ytdlCommand(sock, chat, msg, args) {
  const query = (args || []).join(' ').trim();
  if (!query) return sock.sendMessage(chat, { text: '❌ Usage: `.dl <url or query>`' }, { quoted: msg });
  return queue.add(() => downloadMedia(sock, chat, msg, query, false));
}

export async function mp3Command(sock, chat, msg, args) {
  const query = (args || []).join(' ').trim();
  if (!query) return sock.sendMessage(chat, { text: '❌ Usage: `.mp3 <url or query>`' }, { quoted: msg });
  return queue.add(() => downloadMedia(sock, chat, msg, query, true));
}
