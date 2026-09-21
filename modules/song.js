// ─────────────────────────────────────────────
// WRAITH · modules/song.js
// .song  →  SoundCloud → Apple Music → Deezer
// (full-length audio, always MP3, in memory)
// ─────────────────────────────────────────────
import PQueue from 'p-queue';
import { fetchAudioFromAnySource } from '../lib/music-sources.js';
import { sendWithCta } from '../lib/buttons.js';

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
    return sendWithCta(sock, chat, '❌ Usage: `.song <song name>`', { quoted: msg });
  }

  return queue.add(async () => {
    const status = await sock.sendMessage(chat, {
      text: `🎵 *Searching:* ${query}`,
    }, { quoted: msg });

    try {
      const result = await fetchAudioFromAnySource(
        query, MAX_BYTES, (t) => edit(sock, chat, status, t)
      );

      const safeName = (query.replace(/[^\w\s-]/g, '').slice(0, 50).trim() || 'audio');

      await sock.sendMessage(chat, {
        audio: result.buffer,
        mimetype: 'audio/mpeg',
        fileName: `${safeName}.mp3`,
        ptt: false,
      }, { quoted: msg });

      await edit(sock, chat, status,
        `🎵 *_${result.title}${result.artist ? ' — ' + result.artist : ''}_*\n\nProvided by 𝗪𝗥𝗔𝗜𝗧🇭`);
      await react(sock, chat, msg, '☑');
    } catch (e) {
      console.error('[song]', e.message);
      await edit(sock, chat, status, `❌ *Failed:* ${e.message}`);
      await react(sock, chat, msg, '❌');
    }
  });
}
