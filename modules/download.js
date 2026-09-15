// ─────────────────────────────────────────────
// WRAITH · modules/download.js
// .dl / .download / .mp3  →  yt-dlp (all platforms)
//   · URLs are used directly
//   · text queries default to scsearch1: (SoundCloud)
//     so YouTube cookies are never required
// ─────────────────────────────────────────────
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import PQueue from 'p-queue';
import ffmpegPath from 'ffmpeg-static';

const TMP = path.join(os.tmpdir(), 'wraith-song');
fs.mkdirSync(TMP, { recursive: true });

const MAX_BYTES = 15 * 1024 * 1024;
const queue = new PQueue({ concurrency: 1 });

async function react(sock, chat, msg, emoji) {
  try { await sock.sendMessage(chat, { react: { text: emoji, key: msg.key } }); } catch {}
}
async function edit(sock, chat, key, text) {
  try { await sock.sendMessage(chat, { text, edit: key.key }); } catch {}
}
function cleanFile(p) {
  try { if (p && fs.existsSync(p)) fs.unlinkSync(p); } catch {}
}
function newestAudio(dir, since) {
  return fs.readdirSync(dir)
    .filter((f) => /\.(mp3|m4a|opus|ogg|wav|webm)$/i.test(f))
    .map((f) => ({
      full: path.join(dir, f),
      t: fs.statSync(path.join(dir, f)).mtimeMs,
    }))
    .filter((x) => !since || x.t >= since)
    .sort((a, b) => b.t - a.t)[0]?.full || null;
}

function convertToMp3(inp, out, bitrate = 192) {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error('ffmpeg-static missing — run `npm install`'));
    if (!fs.existsSync(inp)) return reject(new Error('input file missing'));

    const p = spawn(ffmpegPath, [
      '-hide_banner', '-loglevel', 'error',
      '-i', inp,
      '-vn',
      '-codec:a', 'libmp3lame',
      '-b:a', `${bitrate}k`,
      '-y', out,
    ]);

    let err = '';
    p.stderr.on('data', (d) => { err += d.toString(); });
    p.on('error', (e) => reject(new Error(`ffmpeg spawn: ${e.message}`)));
    p.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg ${code}: ${err.slice(-200)}`));
      if (!fs.existsSync(out) || fs.statSync(out).size < 1024) {
        return reject(new Error('ffmpeg produced empty mp3'));
      }
      resolve(out);
    });
  });
}

// ─────────────────────────────────────────────
//  .dl / .download / .mp3  →  yt-dlp
// ─────────────────────────────────────────────
export async function ytdlCommand(sock, chat, msg, args) {
  const query = (args || []).join(' ').trim();
  if (!query) {
    return sock.sendMessage(chat, { text: '❌ Usage: `.dl <url or query>`' }, { quoted: msg });
  }

  return queue.add(async () => {
    const status = await sock.sendMessage(chat, {
      text: `⬇️ *yt-dlp:* ${query}`,
    }, { quoted: msg });

    const stamp = Date.now();
    let mp3 = path.join(TMP, `wraith-${stamp}.mp3`);

    try {
      const { YtDlp } = await import('@choewy/yt-dlp');

      // If it's a URL, use it directly. Otherwise search SoundCloud
      // (no YouTube → no cookies needed).
      const url = /^https?:\/\//i.test(query)
        ? query
        : `scsearch1:${query}`;

      const before = Date.now();
      const yt = new YtDlp({
        url,
        output: mp3.replace(/\.mp3$/i, '.%(ext)s'),
        format: 'bestaudio/best',
        quiet: true,
        noWarnings: true,
        noProgress: true,
        playlist: false,
        retries: 3,
      });

      await yt.audioFormat('mp3').audio().download();

      if (!fs.existsSync(mp3)) {
        const alt = newestAudio(TMP, before);
        if (!alt) throw new Error('yt-dlp produced no file');
        if (/\.mp3$/i.test(alt)) {
          fs.renameSync(alt, mp3);
        } else {
          await edit(sock, chat, status, '⚙️ converting to mp3…');
          const conv = path.join(TMP, `wraith-conv-${Date.now()}.mp3`);
          await convertToMp3(alt, conv, 192);
          mp3 = conv;
          cleanFile(alt);
        }
      }

      const stat = fs.statSync(mp3);
      if (stat.size > MAX_BYTES) {
        throw new Error(`too big (${(stat.size / 1048576).toFixed(1)} MB > 15 MB)`);
      }
      if (stat.size < 1024) throw new Error('audio file is empty');

      const safeName = (query.replace(/[^\w\s-]/g, '').slice(0, 50).trim() || 'audio');
      await sock.sendMessage(chat, {
        audio: fs.readFileSync(mp3),
        mimetype: 'audio/mpeg',
        fileName: `${safeName}.mp3`,
        ptt: false,
      }, { quoted: msg });

      await edit(sock, chat, status, `✅ *Done via yt-dlp*\n_${query}_`);
      await react(sock, chat, msg, '☑');
      cleanFile(mp3);
    } catch (e) {
      console.error('[ytdl]', e.message);
      await edit(sock, chat, status, `❌ *Failed:* ${e.message}`);
      await react(sock, chat, msg, '❌');
      cleanFile(mp3);
    }
  });
  }
