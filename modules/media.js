// ─────────────────────────────────────────────
// WRAITH · modules/media.js
// Books + image search + movie + song info + lyrics + couplepp
// ─────────────────────────────────────────────
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  searchBooks,
  searchImages,
  searchMovie,
  searchSong,
  fetchLyrics,
} from '../lib/apis.js';
import { chunkText, downloadToFile } from '../lib/net.js';

// ─── Book cache ───
const bookCache = new Map();
const BOOK_CACHE_TTL = 10 * 60 * 1000;

function getCachedBooks(chat) {
  const e = bookCache.get(chat);
  if (e && Date.now() - e.time < BOOK_CACHE_TTL) return e;
  return null;
}

async function sendChunked(sock, chat, msg, text) {
  for (const p of chunkText(text, 3800)) {
    await sock.sendMessage(chat, { text: p }, { quoted: msg });
  }
}

// ─────────────────────────────────────────────
// .book
// ─────────────────────────────────────────────
export async function bookCommand(sock, chat, msg, args) {
  try {
    const a0 = (args?.[0] || '').toLowerCase();

    // ── .book dl <n> ──
    if (a0 === 'dl' && args[1]) {
      const cached = getCachedBooks(chat);
      let book = null;
      const n = parseInt(args[1], 10);

      if (cached && !isNaN(n) && cached.books[n - 1]) {
        book = cached.books[n - 1];
      } else {
        const r = await searchBooks(args[1], 1);
        if (r.ok && r.books[0]) book = r.books[0];
      }

      if (!book) {
        return sock.sendMessage(chat, {
          text: '❌ Book not found. Run `.book <title>` first, then `.book dl <number>`.'
        }, { quoted: msg });
      }

      if (!book.url) {
        return sock.sendMessage(chat, {
          text: `❌ No direct download for *${book.title}*.\n_Read online:_ ${book.webUrl || 'not available'}`
        }, { quoted: msg });
      }

      await sock.sendMessage(chat, {
        text: `📚 Downloading *${book.title}* (${book.format})…`
      }, { quoted: msg });

      const ext = book.format === 'epub' ? '.epub'
                : book.format === 'pdf' ? '.pdf'
                : '.txt';
      const safeName = (book.title || 'book')
        .replace(/[^\w\s-]/g, '').trim().slice(0, 60) || 'book';

      const dest = path.join(os.tmpdir(), `wraith-book-${Date.now()}${ext}`);

      try {
        await downloadToFile(
          book.url,
          dest,
          100 * 1024 * 1024,
          5,
          book.url.includes('archive.org') ? { Referer: 'https://archive.org/' } : {}
        );

        const buf = fs.readFileSync(dest);
        const mimetype =
          ext === '.pdf' ? 'application/pdf'
          : ext === '.epub' ? 'application/epub+zip'
          : 'text/plain';

        await sock.sendMessage(chat, {
          document: buf,
          fileName: `${safeName}${ext}`,
          mimetype,
          caption: `📚 *${book.title}*\n_by ${book.author}_${book.year ? ` · ${book.year}` : ''}`
        }, { quoted: msg });
      } catch (e) {
        await sock.sendMessage(chat, { text: `❌ Download failed: ${e.message}` }, { quoted: msg });
      } finally {
        try { if (fs.existsSync(dest)) fs.unlinkSync(dest); } catch {}
      }
      return;
    }

    // ── .book <query> ──
    const query = (args || []).join(' ').trim();
    if (!query) {
      return sock.sendMessage(chat, {
        text: '📚 *book*\n\n`.book <title>` — search\n`.book dl <number>` — download from last results'
      }, { quoted: msg });
    }

    const r = await searchBooks(query, 8);
    if (!r.ok || !r.books.length) {
      return sock.sendMessage(chat, {
        text: `❌ No downloadable books found for *${query}*.`
      }, { quoted: msg });
    }

    bookCache.set(chat, { time: Date.now(), query, books: r.books });

    const lines = [`📚 *Books* — "${query}"`, ''];
    r.books.forEach((b, i) => {
      lines.push(`*${i + 1}.* ${b.title}`);
      lines.push(`   _${b.author}_${b.year ? ` · ${b.year}` : ''} · ${b.format ? b.format.toUpperCase() : '—'}`);
      lines.push(`   ✅ \`.book dl ${i + 1}\``);
    });
    lines.push('', `_Source: ${r.source}_`);
    await sendChunked(sock, chat, msg, lines.join('\n'));

  } catch (e) {
    await sock.sendMessage(chat, { text: `⚠️ book failed: ${e.message}` }, { quoted: msg }).catch(() => {});
  }
}

// ─────────────────────────────────────────────
// .img / .image — stock image search
// ─────────────────────────────────────────────
export async function imageCommand(sock, chat, msg, args) {
  try {
    const parts = (args || []).slice();
    let count = 5;
    if (parts.length > 1 && /^\d+$/.test(parts[parts.length - 1])) {
      count = Math.min(Math.max(parseInt(parts.pop(), 10), 1), 10);
    }
    const query = parts.join(' ').trim();
    if (!query) {
      return sock.sendMessage(chat, {
        text: '🖼️ *img*\n\nUsage: `.img <query> [count]`\nCount default 5, max 10.'
      }, { quoted: msg });
    }

    await sock.sendMessage(chat, { text: `🔎 Searching images for *${query}*…` }, { quoted: msg });

    const r = await searchImages(query, count);
    if (!r.ok || !r.images?.length) {
      return sock.sendMessage(chat, { text: `❌ No images found for *${query}*.` }, { quoted: msg });
    }

    let sent = 0;
    for (const img of r.images.slice(0, count)) {
      const url = img.full || img.url;
      if (!url) continue;
      try {
        await sock.sendMessage(chat, {
          image: { url },
          caption: sent === 0 ? `🖼️ *${query}*\n_source: ${img.source || r.source || 'web'}_` : undefined,
        }, sent === 0 ? { quoted: msg } : undefined);
        sent++;
      } catch {}
    }
    if (!sent) {
      await sock.sendMessage(chat, { text: `❌ Could not send any images for *${query}*.` }, { quoted: msg });
    }
  } catch (e) {
    await sock.sendMessage(chat, { text: `⚠️ img failed: ${e.message}` }, { quoted: msg }).catch(() => {});
  }
}

// ─────────────────────────────────────────────
// .movie
// ─────────────────────────────────────────────
export async function movieCommand(sock, chat, msg, args) {
  try {
    const query = (args || []).join(' ').trim();
    if (!query) {
      return sock.sendMessage(chat, { text: '🎬 *movie*\n\nUsage: `.movie <title>`' }, { quoted: msg });
    }

    const r = await searchMovie(query);
    if (!r.ok) {
      return sock.sendMessage(chat, { text: `❌ No movie found for *${query}*.` }, { quoted: msg });
    }

    const lines = [
      `🎬 *${r.title}*`,
      `*year* · ${r.year || '—'}`,
      `*genre* · ${r.genre || '—'}`,
      `*director* · ${r.director || '—'}`,
      `*rating* · ${r.rating || '—'}`,
      '',
      r.description ? r.description.slice(0, 600) : '',
      '',
      `_source: ${r.source}_`
    ].filter(Boolean);

    if (r.poster) {
      await sock.sendMessage(chat, {
        image: { url: r.poster },
        caption: lines.join('\n')
      }, { quoted: msg });
    } else {
      await sendChunked(sock, chat, msg, lines.join('\n'));
    }
  } catch (e) {
    await sock.sendMessage(chat, { text: `⚠️ movie failed: ${e.message}` }, { quoted: msg }).catch(() => {});
  }
}

// ─────────────────────────────────────────────
// .songinfo — track metadata (not a download)
// ─────────────────────────────────────────────
export async function songCommand(sock, chat, msg, args) {
  try {
    const query = (args || []).join(' ').trim();
    if (!query) {
      return sock.sendMessage(chat, { text: '🎵 *songinfo*\n\nUsage: `.songinfo <title>`' }, { quoted: msg });
    }

    const r = await searchSong(query);
    if (!r.ok) {
      return sock.sendMessage(chat, { text: `❌ No song found for *${query}*.` }, { quoted: msg });
    }

    const dur = r.duration
      ? `${Math.floor(r.duration / 60)}:${String(r.duration % 60).padStart(2, '0')}`
      : '—';

    const lines = [
      `🎵 *${r.title}*`,
      `*artist* · ${r.artist || '—'}`,
      `*album* · ${r.album || '—'}`,
      `*duration* · ${dur}`,
      '',
      `_source: ${r.source}_`
    ];

    if (r.cover) {
      await sock.sendMessage(chat, {
        image: { url: r.cover },
        caption: lines.join('\n')
      }, { quoted: msg });
    } else {
      await sendChunked(sock, chat, msg, lines.join('\n'));
    }
  } catch (e) {
    await sock.sendMessage(chat, { text: `⚠️ songinfo failed: ${e.message}` }, { quoted: msg }).catch(() => {});
  }
}

// ─────────────────────────────────────────────
// .lyrics
// ─────────────────────────────────────────────
export async function lyricsCommand(sock, chat, msg, args) {
  try {
    const full = (args || []).join(' ').trim();
    if (!full) {
      return sock.sendMessage(chat, {
        text: '📜 *lyrics*\n\nUsage: `.lyrics <artist> - <title>`'
      }, { quoted: msg });
    }

    const sep = full.indexOf(' - ');
    if (sep === -1) {
      return sock.sendMessage(chat, {
        text: '❌ Use format: `.lyrics <artist> - <title>`'
      }, { quoted: msg });
    }

    const artist = full.slice(0, sep).trim();
    const title  = full.slice(sep + 3).trim();
    if (!artist || !title) {
      return sock.sendMessage(chat, {
        text: '❌ Both artist and title are required.'
      }, { quoted: msg });
    }

    const r = await fetchLyrics(artist, title);
    if (!r.ok || !r.lyrics) {
      return sock.sendMessage(chat, {
        text: `❌ No lyrics found for *${title}* by *${artist}*.`
      }, { quoted: msg });
    }

    const header = `📜 *${title}* — _${artist}_\n_source: ${r.source}_\n\n`;
    await sendChunked(sock, chat, msg, header + r.lyrics);
  } catch (e) {
    await sock.sendMessage(chat, { text: `⚠️ lyrics failed: ${e.message}` }, { quoted: msg }).catch(() => {});
  }
}

// ─────────────────────────────────────────────
// .couplepp — random couple profile pics in a group
// ─────────────────────────────────────────────
export async function coupleppCommand(sock, chat, msg, args) {
  if (!chat.endsWith('@g.us')) {
    return sock.sendMessage(chat, { text: '❌ This command only works in groups.' }, { quoted: msg });
  }
  try {
    const meta = await sock.groupMetadata(chat);
    const parts = (meta.participants || []).filter((p) => p?.id);
    if (parts.length < 2) {
      return sock.sendMessage(chat, { text: '❌ Not enough members to pair.' }, { quoted: msg });
    }

    const count = Math.min(Math.max(parseInt(args?.[0], 10) || 1, 1), 5);
    let sent = 0;

    for (let i = 0; i < count; i++) {
      const a = parts[Math.floor(Math.random() * parts.length)];
      let b = parts[Math.floor(Math.random() * parts.length)];
      let guard = 0;
      while (b.id === a.id && guard++ < 20) {
        b = parts[Math.floor(Math.random() * parts.length)];
      }
      if (b.id === a.id) continue;

      let urlA = null, urlB = null;
      try { urlA = await sock.profilePictureUrl(a.id, 'image'); } catch {}
      try { urlB = await sock.profilePictureUrl(b.id, 'image'); } catch {}
      if (!urlA && !urlB) continue;

      const aNum = a.id.split('@')[0];
      const bNum = b.id.split('@')[0];
      const caption = `💞 *couple*\n@${aNum} ❤️ @${bNum}`;
      const mentions = [a.id, b.id];

      try {
        if (urlA) {
          await sock.sendMessage(chat, {
            image: { url: urlA },
            caption,
            mentions,
          }, { quoted: msg });
        } else if (urlB) {
          await sock.sendMessage(chat, {
            image: { url: urlB },
            caption,
            mentions,
          }, { quoted: msg });
        }
        if (urlA && urlB) {
          await sock.sendMessage(chat, { image: { url: urlB } });
        }
        sent++;
      } catch {}
    }

    if (!sent) {
      await sock.sendMessage(chat, { text: '❌ Could not fetch profile pictures for a couple.' }, { quoted: msg });
    }
  } catch (e) {
    await sock.sendMessage(chat, { text: `⚠️ couplepp failed: ${e.message}` }, { quoted: msg }).catch(() => {});
  }
}
