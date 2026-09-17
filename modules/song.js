// ─────────────────────────────────────────────
// WRAITH · modules/song.js
// .song  →  SoundCloud → Apple Music → Deezer
// (full-length audio, always MP3, in memory)
// ─────────────────────────────────────────────
import fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import ffmpegPath from 'ffmpeg-static';
import PQueue from 'p-queue';
import { downloadContentFromMessage } from '@whiskeysockets/baileys';
import { Shazam } from '@renmu/node-shazam';
import { fetchAudioFromAnySource } from '../lib/music-sources.js';
import { vaultPath, dropFromVault } from '../core/vault.js';

const execFileAsync = promisify(execFile);
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
        `🎵 *_${result.title}${result.artist ? ' — ' + result.artist : ''}_*\n\nProvided by 𝙒𝙍𝘼𝙄𝙏🇭`);
      await react(sock, chat, msg, '☑');
    } catch (e) {
      console.error('[song]', e.message);
      await edit(sock, chat, status, `❌ *Failed:* ${e.message}`);
      await react(sock, chat, msg, '❌');
    }
  });
}

export async function findaudioCommand(sock, chat, msg) {
  try {
    const ctx = msg.message?.extendedTextMessage?.contextInfo;
    const quoted = ctx?.quotedMessage;

    let node = null;
    let type = null;

    if (quoted) {
      const wrapped =
        quoted.viewOnceMessageV2?.message ||
        quoted.viewOnceMessageV2Extension?.message ||
        quoted.viewOnceMessage?.message ||
        quoted.ephemeralMessage?.message ||
        quoted;

      if (wrapped.audioMessage) { node = wrapped.audioMessage; type = 'audio'; }
      else if (wrapped.videoMessage) { node = wrapped.videoMessage; type = 'video'; }
      else if (wrapped.documentMessage) { node = wrapped.documentMessage; type = 'document'; }
    }

    if (!node || !type) {
      return sock.sendMessage(chat, {
        text: '🎧 *findaudio*\n\nReply to a voice note, audio file, or video clip with `.findaudio` to identify the song.'
      }, { quoted: msg });
    }

    const statusMsg = await sock.sendMessage(chat, {
      text: '🎧 *Analyzing audio sample with Shazam…*'
    }, { quoted: msg });

    const rawPath = vaultPath(`findaudio_${Date.now()}_raw`);
    const wavPath = vaultPath(`findaudio_${Date.now()}.wav`);

    try {
      const stream = await downloadContentFromMessage(node, type);
      const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      const buffer = Buffer.concat(chunks);
      fs.writeFileSync(rawPath, buffer);

      await execFileAsync(ffmpegPath, [
        '-y',
        '-i', rawPath,
        '-ar', '44100',
        '-ac', '2',
        wavPath
      ]);

      const shazam = new Shazam();
      const res = await shazam.recognise(wavPath);

      if (!res || !res.track) {
        await edit(sock, chat, statusMsg, '❌ *No match found:* Could not identify any song in the audio sample.');
        return;
      }

      const trk = res.track;
      const title = trk.title || 'Unknown Title';
      const artist = trk.subtitle || trk.artists?.[0]?.alias || 'Unknown Artist';

      let album = '';
      let genre = trk.genres?.primary || '';

      const metaSection = trk.sections?.find(s => s.type === 'SONG');
      if (metaSection && Array.isArray(metaSection.metadata)) {
        const albumItem = metaSection.metadata.find(m => m.title?.toLowerCase() === 'album');
        if (albumItem) album = albumItem.text;
      }

      const lines = [
        '🎧 *Song Identified!*',
        '',
        `🎵 *Title:* ${title}`,
        `👤 *Artist:* ${artist}`,
      ];

      if (album) lines.push(`💿 *Album:* ${album}`);
      if (genre) lines.push(`🎷 *Genre:* ${genre}`);
      if (trk.share?.href || trk.url) lines.push(`🔗 *Link:* ${trk.share?.href || trk.url}`);

      lines.push('');
      lines.push('Provided by 𝕎ℝ𝔸I𝕋ℍ');

      await edit(sock, chat, statusMsg, lines.join('\n'));
      await react(sock, chat, msg, '🎧');

    } finally {
      dropFromVault(rawPath);
      dropFromVault(wavPath);
    }

  } catch (e) {
    console.error('[findaudio]', e.message);
    try {
      await sock.sendMessage(chat, { text: `⚠️ *findaudio failed:* ${e.message}` }, { quoted: msg });
    } catch {}
  }
}
