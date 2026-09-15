// ─────────────────────────────────────────────
// WRAITH · modules/song.js
// .song  →  SoundCloud → Apple Music → Deezer
// (full-length audio via lib/music-sources.js)
// ─────────────────────────────────────────────
import PQueue from 'p-queue';
import { fetchAudioFromAnySource } from '../lib/music-sources.js';

const MAX_BYTES = 15 * 1024 * 1024;
const queue = new PQueue({ concurrency: 1 });

async function react(sock, chat, msg, emoji) {
  try { await sock.sendMessage(chat, { react: { text: emoji, key: msg.key } }); } catch {}
}
async function edit(sock, chat, key, text) {
  try { await sock.sendMessage(chat, { text, edit: key.key }); } catch {}
}

export async function songCommand(sock, chat, msg, args) {
  const query = (args || []).join(' ').trim();
  if (!query) {
    return sock.sendMessage(chat, { text: '❌ Usage: `.song <song name>`' }, { quoted: msg });
  }

  return queue.add(async () => {
    const status = await sock.sendMessage(chat, {
      text: `🎵 *Searching:* ${query}`,
    }, { quoted: msg });

    try {
      const result = await fetchAudioFromAnySource(
        query,
        MAX_BYTES,
        (t) => edit(sock, chat, status, t)
      );

      if (!result?.buffer?.length) throw new Error('empty buffer from source');

      const safeName = (query.replace(/[^\w\s-]/g, '').slice(0, 50).trim() || 'audio');
      const ext = result.format || 'mp3';

      await sock.sendMessage(chat, {
        audio: result.buffer,
        mimetype: result.mimetype || 'audio/mpeg',
        fileName: `${safeName}.${ext}`,
        ptt: false,
      }, { quoted: msg });

      await edit(
        sock, chat, status,
        `✅ *Done via ${result.provider}*\n_${result.title}${result.artist ? ' — ' + result.artist : ''}_`
      );
      await react(sock, chat, msg, '☑');
    } catch (e) {
      console.error('[song]', e.message);
      await edit(sock, chat, status, `❌ *Failed:* ${e.message}`);
      await react(sock, chat, msg, '❌');
    }
  });
}
