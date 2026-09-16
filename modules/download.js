// ─────────────────────────────────────────────
// WRAITH · modules/download.js
// .dl / .download  →  @postfetch/core (for post/carousel URLs) + yt-dlp (video/audio)
// .mp3             →  yt-dlp audio extraction (-x --audio-format mp3)
// .pdl / .pdlzip   →  @postfetch/core direct post download (images/carousels/zip)
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
import { postfetch, download as pfDownload, archive as pfArchive, detect as pfDetect } from '@postfetch/core';

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
  const results = [];
  function scan(d) {
    try {
      const entries = fs.readdirSync(d, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(d, entry.name);
        if (entry.isDirectory()) {
          scan(full);
        } else if (entry.isFile()) {
          try {
            const stat = fs.statSync(full);
            if (stat.mtimeMs >= since) {
              results.push({ full, t: stat.mtimeMs });
            }
          } catch {}
        }
      }
    } catch {}
  }
  scan(dir);
  return results.sort((a, b) => a.t - b.t).map((x) => x.full);
}

export function isPostUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const lower = url.toLowerCase();
  if (
    lower.includes('instagram.com/p/') ||
    lower.includes('instagram.com/reel/') ||
    lower.includes('instagram.com/tv/') ||
    lower.includes('tiktok.com/') && lower.includes('/photo/') ||
    lower.includes('tiktok.com/') && lower.includes('/video/') ||
    lower.includes('facebook.com/') && (lower.includes('/posts/') || lower.includes('/photos/') || lower.includes('/videos/')) ||
    lower.includes('fb.watch/') ||
    lower.includes('twitter.com/') && lower.includes('/status/') ||
    lower.includes('x.com/') && lower.includes('/status/') ||
    lower.includes('pinterest.com/pin/') ||
    lower.includes('pin.it/')
  ) {
    return true;
  }
  const platform = pfDetect(url);
  return !!platform;
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

// Download post media using @postfetch/core
export async function downloadPostMediaDirect(sock, chat, msg, url, asZip = false) {
  if (!isPostUrl(url)) {
    return sock.sendMessage(chat, {
      text: '❌ *Not a post URL:* This URL does not appear to be a post/photo/carousel URL.\n_If you want to download videos or search profiles, try using .ig, .tiktok, or .dl <url>._',
    }, { quoted: msg });
  }

  const status = await sock.sendMessage(chat, {
    text: `📦 *Postfetch:* Resolving post media…`,
  }, { quoted: msg });

  try {
    const result = await withTimeout(postfetch(url), YTDLP_TIMEOUT, 'postfetch resolve');
    if (!result?.items?.length) {
      throw new Error('No media items found in this post');
    }

    if (asZip) {
      await edit(sock, chat, status, `📦 *Archiving ${result.items.length} items into ZIP…*`);
      const zip = await withTimeout(pfArchive(result), YTDLP_TIMEOUT, 'postfetch archive');
      const zipBuffer = Buffer.from(zip.bytes);
      await sock.sendMessage(chat, {
        document: zipBuffer,
        fileName: zip.filename || 'post.zip',
        mimetype: zip.mime || 'application/zip',
        caption: `📦 *Downloaded Post Archive* (${result.items.length} items)\n\nProvided by 𝙒𝙍𝘼𝙄𝙏🇭`,
      }, { quoted: msg });
      await edit(sock, chat, status, `✅ *ZIP Download complete*\n\nProvided by 𝙒𝙍𝘼𝙄𝙏🇭`);
      await react(sock, chat, msg, '☑');
      return;
    }

    const totalFiles = Math.min(result.items.length, 20);
    let sentCount = 0;

    for (let i = 0; i < totalFiles; i++) {
      const item = result.items[i];
      await edit(sock, chat, status, `🖼️ *Downloading item ${i + 1}/${totalFiles}…*`);
      const res = await withTimeout(pfDownload(item), CONVERT_TIMEOUT, `download item ${i + 1}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length < 512) continue;

      let type = await classifyBuffer(buffer);
      if (type.kind === 'unknown' && item.type) {
        if (item.type === 'image') type = { kind: 'image', ext: 'jpg', mime: 'image/jpeg' };
        else if (item.type === 'video') type = { kind: 'video', ext: 'mp4', mime: 'video/mp4' };
        else if (item.type === 'audio') type = { kind: 'audio', ext: 'mp3', mime: 'audio/mpeg' };
      }

      const safeName = item.filename || `media_${i + 1}.${type.ext || 'jpg'}`;
      const limit = type.kind === 'video' ? MAX_VIDEO : MAX_BYTES;
      if (buffer.length > limit) continue;

      if (type.kind === 'image' || (!type.kind && item.type === 'image')) {
        await sock.sendMessage(chat, { image: buffer, mimetype: type.mime || 'image/jpeg' }, { quoted: msg });
        sentCount++;
      } else if (type.kind === 'video' || (!type.kind && item.type === 'video')) {
        await sock.sendMessage(chat, { video: buffer, mimetype: type.mime || 'video/mp4', fileName: safeName }, { quoted: msg });
        sentCount++;
      } else if (type.kind === 'audio') {
        await sock.sendMessage(chat, { audio: buffer, mimetype: type.mime || 'audio/mpeg', fileName: safeName, ptt: false }, { quoted: msg });
        sentCount++;
      } else {
        // Fallback: send as image if buffer looks like image data or default to document
        if (buffer[0] === 0xff && buffer[1] === 0xd8) {
          await sock.sendMessage(chat, { image: buffer, mimetype: 'image/jpeg' }, { quoted: msg });
          sentCount++;
        } else if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
          await sock.sendMessage(chat, { image: buffer, mimetype: 'image/png' }, { quoted: msg });
          sentCount++;
        } else {
          await sock.sendMessage(chat, { document: buffer, mimetype: type.mime || 'application/octet-stream', fileName: safeName }, { quoted: msg });
          sentCount++;
        }
      }
    }

    if (sentCount === 0) throw new Error('Post media files exceeded size limits or were empty');

    await edit(sock, chat, status, `✅ *Download complete* (${sentCount} items)\n\nProvided by 𝙒𝙍𝘼𝙄𝙏🇭`);
    await react(sock, chat, msg, '☑');
  } catch (e) {
    try { console.error('[postfetch]', e.message); } catch {}
    await edit(sock, chat, status, `❌ *Post download failed:* ${e.message}\n_If this is a standard video URL, try using .dl, .ig, or .tiktok._`);
    await react(sock, chat, msg, '❌');
  }
}

async function downloadMedia(sock, chat, msg, query, audioOnly) {
  const verbLabel = audioOnly ? '.mp3' : '.dl';
  const status = await sock.sendMessage(chat, {
    text: `${audioOnly ? '🎵' : '⬇️'} *${verbLabel}:* ${query}`,
  }, { quoted: msg });

  const runStart = Date.now();

  try {
    const isUrl = /^https?:\/\//i.test(query);

    if (isUrl && !audioOnly && isPostUrl(query)) {
      await edit(sock, chat, status, '🖼️ *Fetching post media (@postfetch/core)…*');
      try {
        const pfResult = await withTimeout(postfetch(query), YTDLP_TIMEOUT, 'postfetch resolve');
        if (pfResult?.items?.length) {
          const totalFiles = Math.min(pfResult.items.length, 20);
          let sentCount = 0;
          for (let i = 0; i < totalFiles; i++) {
            const item = pfResult.items[i];
            const res = await withTimeout(pfDownload(item), CONVERT_TIMEOUT, `postfetch item ${i + 1}`);
            const buffer = Buffer.from(await res.arrayBuffer());
            if (buffer.length < 512) continue;

            let type = await classifyBuffer(buffer);
            if (type.kind === 'unknown' && item.type) {
              if (item.type === 'image') type = { kind: 'image', ext: 'jpg', mime: 'image/jpeg' };
              else if (item.type === 'video') type = { kind: 'video', ext: 'mp4', mime: 'video/mp4' };
              else if (item.type === 'audio') type = { kind: 'audio', ext: 'mp3', mime: 'audio/mpeg' };
            }

            const safeName = item.filename || `media_${i + 1}.${type.ext || 'jpg'}`;
            const limit = type.kind === 'video' ? MAX_VIDEO : MAX_BYTES;
            if (buffer.length > limit) continue;

            if (type.kind === 'image' || (!type.kind && item.type === 'image')) {
              await sock.sendMessage(chat, { image: buffer, mimetype: type.mime || 'image/jpeg' }, { quoted: msg });
              sentCount++;
            } else if (type.kind === 'video' || (!type.kind && item.type === 'video')) {
              await sock.sendMessage(chat, { video: buffer, mimetype: type.mime || 'video/mp4', fileName: safeName }, { quoted: msg });
              sentCount++;
            } else if (type.kind === 'audio') {
              await sock.sendMessage(chat, { audio: buffer, mimetype: type.mime || 'audio/mpeg', fileName: safeName, ptt: false }, { quoted: msg });
              sentCount++;
            } else {
              if (buffer[0] === 0xff && buffer[1] === 0xd8) {
                await sock.sendMessage(chat, { image: buffer, mimetype: 'image/jpeg' }, { quoted: msg });
                sentCount++;
              } else if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
                await sock.sendMessage(chat, { image: buffer, mimetype: 'image/png' }, { quoted: msg });
                sentCount++;
              } else {
                await sock.sendMessage(chat, { document: buffer, mimetype: type.mime || 'application/octet-stream', fileName: safeName }, { quoted: msg });
                sentCount++;
              }
            }
          }
          if (sentCount > 0) {
            await edit(sock, chat, status, `✅ *Download complete*\n\nProvided by 𝙒𝙍𝘼𝙄𝙏🇭`);
            await react(sock, chat, msg, '☑');
            return;
          }
        }
      } catch (pfErr) {
        await edit(sock, chat, status, '⬇️ *Postfetch failed, falling back to yt-dlp…*');
      }
    }

    const { YtDlp } = await import('@choewy/yt-dlp');
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
      } catch (err1) {
        try {
          const ytFallback1 = new YtDlp({
            url: isUrl ? query : `scsearch1:${query}`,
            output: outTemplate,
            quiet: true, noWarnings: true, noProgress: true,
            playlist: true, retries: 3,
          });
          ytFallback1.format('');
          await withTimeout(
            ytFallback1.video().download(),
            YTDLP_TIMEOUT,
            'fallback download (empty format)'
          );
        } catch (err2) {
          const ytFallback2 = new YtDlp({
            url: isUrl ? query : `scsearch1:${query}`,
            output: outTemplate,
            quiet: true, noWarnings: true, noProgress: true,
            playlist: true, retries: 3,
          });
          ytFallback2.format('b/best');
          await withTimeout(
            ytFallback2.video().download(),
            YTDLP_TIMEOUT,
            'fallback download (b/best)'
          );
        }
      }
    }

    const files = producedFiles(TMP, runStart);
    if (!files.length) throw new Error('No media file downloaded');

    const safeName = (query.replace(/[^\w\s-]/g, '').slice(0, 50).trim() || 'media');
    const totalFiles = Math.min(files.length, 20);
    let sentCount = 0;

    for (let i = 0; i < totalFiles; i++) {
      const file = files[i];
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
          image: buffer, mimetype: type.mime,
        }, { quoted: msg });
        sentCount++;
      } else if (type.kind === 'video') {
        await sock.sendMessage(chat, {
          video: buffer, mimetype: type.mime || 'video/mp4',
          fileName: `${safeName}.${type.ext}`,
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
          fileName: `${safeName}.${type.ext}`,
        }, { quoted: msg });
        sentCount++;
      }

      if (totalFiles > 1) {
        await edit(sock, chat, status, `⬇️ *Downloading…* (${sentCount}/${totalFiles})`).catch(() => {});
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

export async function pdlCommand(sock, chat, msg, args) {
  const input = (args || []).join(' ').trim();
  if (!input) {
    return sock.sendMessage(chat, {
      text: '📦 *pdl* — Download Post/Carousel Media\n\nUsage:\n• `.pdl <post-url>` (Download images/videos directly)\n• `.pdl <post-url> zip` or `.pdlzip <post-url>` (Download as ZIP archive)'
    }, { quoted: msg });
  }

  let asZip = false;
  let url = input;
  if (/\bzip\b/i.test(input) || /--zip/i.test(input)) {
    asZip = true;
    url = input.replace(/\bzip\b/gi, '').replace(/--zip/gi, '').trim();
  }

  return queue.add(() => downloadPostMediaDirect(sock, chat, msg, url, asZip));
}

export async function pdlzipCommand(sock, chat, msg, args) {
  const url = (args || []).join(' ').trim();
  if (!url) {
    return sock.sendMessage(chat, {
      text: '📦 *pdlzip* — Download Post/Carousel Media as ZIP\n\nUsage: `.pdlzip <post-url>`'
    }, { quoted: msg });
  }
  return queue.add(() => downloadPostMediaDirect(sock, chat, msg, url, true));
}
