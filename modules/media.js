// ─────────────────────────────────────────────
// WRAITH · modules/media.js
// Phase 2: Books, Images, Movie, Song, Lyrics, PPT, CouplePP
// ─────────────────────────────────────────────
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isOwner } from '../core/identity.js';
import { readJson, writeJsonAtomic } from '../core/state-io.js';
import { vaultPath, dropFromVault } from '../core/vault.js';
import { CONFIG } from '../config.js';
import { chunkText, withTempFile, downloadToFile, raceApis } from '../lib/net.js';
import {
  searchBooks, searchMovie, searchSong, fetchLyrics, searchImages,
  fetchWeather, checkPwned, generateQr, decodeQr,
} from '../lib/apis.js';

const here = path.dirname(fileURLToPath(import.meta.url));

function ownerOnly(sock, chat, msg) {
  const from = msg.key.participant || msg.key.remoteJid;
  if (!msg.key.fromMe && !isOwner(from)) {
    sock.sendMessage(chat, { text: '⛔ Owner only.' }, { quoted: msg }).catch(() => {});
    return true;
  }
  return false;
}
async function sendChunked(sock, chat, msg, text) {
  for (const p of chunkText(text, 3800)) await sock.sendMessage(chat, { text: p }, { quoted: msg });
}

// ── .book ───────────────────────────────────────────────────────────────────
export async function bookCommand(sock, chat, msg, args) {
  try {
    const a0 = (args?.[0] || '').toLowerCase();
    if (a0 === 'dl' && args[1]) {
      const bookId = args[1];
      const r = await searchBooks(bookId, 1);
      if (!r.ok || !r.books[0]?.url) {
        return sock.sendMessage(chat, { text: '❌ Book not found or no download link.' }, { quoted: msg });
      }
      const book = r.books[0];
      await sock.sendMessage(chat, { text: `📥 Downloading *${book.title}* (${book.format})…` }, { quoted: msg });
      const ext = book.format === 'epub' ? '.epub' : book.format === 'pdf' ? '.pdf' : '.txt';
      await withTempFile(`book${ext}`, async (dest) => {
        await downloadToFile(book.url, dest, (CONFIG.media?.maxDownloadMB || 100) * 1024 * 1024);
        await sock.sendMessage(chat, {
          document: fs.readFileSync(dest),
          fileName: `${book.title.slice(0, 60)}${ext}`,
          mimetype: ext === '.pdf' ? 'application/pdf' : ext === '.epub' ? 'application/epub+zip' : 'text/plain',
          caption: `📚 *${book.title}*\n_by ${book.author}_`,
        }, { quoted: msg });
      });
      return;
    }

    const query = (args || []).join(' ').trim();
    if (!query) return sock.sendMessage(chat, { text: '📚 *book*\n\nUsage: `.book <title or author>`\n`.book dl <id>` — download by ID' }, { quoted: msg });
    const r = await searchBooks(query, 5);
    if (!r.ok || !r.books.length) return sock.sendMessage(chat, { text: `❌ No books found for *${query}*.` }, { quoted: msg });

    const lines = [`📚 *books* — “${query}”`, ''];
    r.books.forEach((b, i) => {
      lines.push(`*${i + 1}.* ${b.title}`);
      lines.push(`   _${b.author}_${b.year ? ` · ${b.year}` : ''} · ${b.format?.toUpperCase() || '—'}`);
      lines.push(`   \`.book dl ${b.id}\``);
    });
    lines.push('', '_Source: Project Gutenberg / Open Library_');
    await sendChunked(sock, chat, msg, lines.join('\n'));
  } catch (e) {
    await sock.sendMessage(chat, { text: `⚠️ book failed: ${e.message}` }, { quoted: msg }).catch(() => {});
  }
}

// ── .img ────────────────────────────────────────────────────────────────────
export async function imageCommand(sock, chat, msg, args) {
  try {
    const query = (args || []).join(' ').trim();
    if (!query) return sock.sendMessage(chat, { text: '🖼️ *img*\n\nUsage: `.img <query> [count]`\nMax 10 images.' }, { quoted: msg });

    const parts = query.split(/\s+/);
    const maybeCount = parseInt(parts[parts.length - 1], 10);
    const count = Math.min(Math.max(isNaN(maybeCount) ? 3 : maybeCount, 1), CONFIG.media?.maxImages || 10);
    const q = isNaN(maybeCount) ? query : parts.slice(0, -1).join(' ');

    if (!q) return sock.sendMessage(chat, { text: '❌ Query cannot be empty.' }, { quoted: msg });
    const r = await searchImages(q, count);
    if (!r.ok || !r.images.length) return sock.sendMessage(chat, { text: `❌ No images found for *${q}*.` }, { quoted: msg });

    await sock.sendMessage(chat, { text: `🖼️ Sending ${r.images.length} image${r.images.length > 1 ? 's' : ''} for *${q}*…` }, { quoted: msg });
    for (const img of r.images) {
      try {
        await withTempFile('stock.jpg', async (dest) => {
          await downloadToFile(img.url, dest, 20 * 1024 * 1024);
          await sock.sendMessage(chat, { image: fs.readFileSync(dest), caption: `_${img.source}_` }, { quoted: msg });
        });
      } catch {}
    }
  } catch (e) {
    await sock.sendMessage(chat, { text: `⚠️ img failed: ${e.message}` }, { quoted: msg }).catch(() => {});
  }
}

// ── .movie ──────────────────────────────────────────────────────────────────
export async function movieCommand(sock, chat, msg, args) {
  try {
    const query = (args || []).join(' ').trim();
    if (!query) return sock.sendMessage(chat, { text: '🎬 *movie*\n\nUsage: `.movie <title>`' }, { quoted: msg });
    const r = await searchMovie(query);
    if (!r.ok) return sock.sendMessage(chat, { text: `❌ No movie found for *${query}*.` }, { quoted: msg });

    const lines = [
      `🎬 *${r.title}*`,
      '',
      `• *director* · ${r.director}`,
      `• *year* · ${r.year || '—'}`,
      `• *genre* · ${r.genre || '—'}`,
      `• *rating* · ${r.rating || '—'}`,
      '',
      r.description ? `_${r.description.slice(0, 400)}${r.description.length > 400 ? '…' : ''}_` : '',
      '',
      `_Source: ${r.source}_`,
    ].filter(Boolean);

    if (r.poster) {
      try {
        await withTempFile('poster.jpg', async (dest) => {
          await downloadToFile(r.poster, dest, 5 * 1024 * 1024);
          await sock.sendMessage(chat, { image: fs.readFileSync(dest), caption: lines.join('\n') }, { quoted: msg });
        });
        return;
      } catch {}
    }
    await sendChunked(sock, chat, msg, lines.join('\n'));
  } catch (e) {
    await sock.sendMessage(chat, { text: `⚠️ movie failed: ${e.message}` }, { quoted: msg }).catch(() => {});
  }
}

// ── .song ───────────────────────────────────────────────────────────────────
export async function songCommand(sock, chat, msg, args) {
  try {
    const query = (args || []).join(' ').trim();
    if (!query) return sock.sendMessage(chat, { text: '🎵 *song*\n\nUsage: `.song <title> [artist]`' }, { quoted: msg });
    const r = await searchSong(query);
    if (!r.ok) return sock.sendMessage(chat, { text: `❌ No song found for *${query}*.` }, { quoted: msg });

    const dur = r.duration ? `${Math.floor(r.duration / 60)}:${String(r.duration % 60).padStart(2, '0')}` : '—';
    const lines = [
      `🎵 *${r.title}*`,
      '',
      `• *artist* · ${r.artist}`,
      `• *album* · ${r.album}`,
      `• *duration* · ${dur}`,
      '',
      `_Source: ${r.source}_`,
    ];
    if (r.cover) {
      try {
        await withTempFile('cover.jpg', async (dest) => {
          await downloadToFile(r.cover, dest, 5 * 1024 * 1024);
          await sock.sendMessage(chat, { image: fs.readFileSync(dest), caption: lines.join('\n') }, { quoted: msg });
        });
        return;
      } catch {}
    }
    await sendChunked(sock, chat, msg, lines.join('\n'));
  } catch (e) {
    await sock.sendMessage(chat, { text: `⚠️ song failed: ${e.message}` }, { quoted: msg }).catch(() => {});
  }
}

// ── .lyrics ─────────────────────────────────────────────────────────────────
export async function lyricsCommand(sock, chat, msg, args) {
  try {
    const query = (args || []).join(' ').trim();
    if (!query) return sock.sendMessage(chat, { text: '🎤 *lyrics*\n\nUsage: `.lyrics <artist> - <title>`' }, { quoted: msg });
    const sep = query.includes(' - ') ? ' - ' : query.includes(' — ') ? ' — ' : null;
    if (!sep) return sock.sendMessage(chat, { text: '❌ Use: `.lyrics <artist> - <title>`' }, { quoted: msg });
    const [artist, title] = query.split(sep);
    const r = await fetchLyrics(artist.trim(), title.trim());
    if (!r.ok) return sock.sendMessage(chat, { text: `❌ No lyrics found for *${title}* by *${artist}*.` }, { quoted: msg });
    await sendChunked(sock, chat, msg, `🎤 *${title}* — _${artist}_\n_${r.source}_\n\n${r.lyrics}`);
  } catch (e) {
    await sock.sendMessage(chat, { text: `⚠️ lyrics failed: ${e.message}` }, { quoted: msg }).catch(() => {});
  }
}

// ── .ppt ────────────────────────────────────────────────────────────────────
export async function pptCommand(sock, chat, msg, args) {
  try {
    const topic = (args || []).join(' ').trim();
    if (!topic) return sock.sendMessage(chat, { text: '📊 *ppt*\n\nUsage: `.ppt <topic>`' }, { quoted: msg });

    // Fetch topic summary from Wikipedia
    let summary = '';
    let title = topic;
    try {
      const wiki = await raceApis([
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(topic)}`,
        `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext&titles=${encodeURIComponent(topic)}&format=json&origin=*`,
      ], (d) => d.extract || d.extract);
      if (wiki.ok) {
        summary = wiki.data.extract || wiki.data.query?.pages?.[Object.keys(wiki.data.query.pages)[0]]?.extract || '';
        title = wiki.data.title || topic;
      }
    } catch {}

    if (!summary) summary = `An overview of ${topic}.`;

    // Generate a simple PPTX-compatible text document (TXT) as fallback,
    // since we don't bundle pptxgenjs to keep RAM low.
    const slideLines = summary.split('\n').filter(Boolean).slice(0, 10);
    const content = [
      `PRESENTATION: ${title}`,
      '='.repeat(60),
      '',
      `Topic: ${title}`,
      `Generated: ${new Date().toISOString()}`,
      '',
      '--- SLIDES ---',
      '',
      `Slide 1: ${title}`,
      '  • Introduction',
      '',
      ...slideLines.map((l, i) => `Slide ${i + 2}: ${l.slice(0, 100)}\n  • ${l.slice(0, 300)}`),
      '',
      '--- END ---',
    ].join('\n');

    await sock.sendMessage(chat, {
      document: Buffer.from(content, 'utf8'),
      fileName: `${title.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 40)}_presentation.txt`,
      mimetype: 'text/plain',
      caption: `📊 *${title}* — presentation outline\n_Generated from Wikipedia. Rename to .pptx and open in PowerPoint or Google Slides._`,
    }, { quoted: msg });
  } catch (e) {
    await sock.sendMessage(chat, { text: `⚠️ ppt failed: ${e.message}` }, { quoted: msg }).catch(() => {});
  }
}

// ── .couplepp ───────────────────────────────────────────────────────────────
const COUPLE_PP_SOURCES = [
  'https://raw.githubusercontent.com/PikaBotz/important-API/main/couple-API/couplepp.json',
];

export async function coupleppCommand(sock, chat, msg, args) {
  try {
    const count = Math.min(Math.max(parseInt(args?.[0] || '3', 10), 1), CONFIG.media?.maxCouplePairs || 5);
    let pairs = [];
    for (const url of COUPLE_PP_SOURCES) {
      try {
        const res = await fetch(url);
        if (!res.ok) continue;
        const data = await res.json();
        if (Array.isArray(data)) { pairs = data; break; }
      } catch {}
    }
    if (!pairs.length) return sock.sendMessage(chat, { text: '❌ Couple PP source unavailable.' }, { quoted: msg });

    const shuffled = pairs.sort(() => Math.random() - 0.5).slice(0, count);
    await sock.sendMessage(chat, { text: `💑 Sending ${shuffled.length} couple PP pair${shuffled.length > 1 ? 's' : ''}…` }, { quoted: msg });

    for (const pair of shuffled) {
      for (const imgUrl of [pair.male || pair[0], pair.female || pair[1]]) {
        if (!imgUrl) continue;
        try {
          await withTempFile('couple.jpg', async (dest) => {
            await downloadToFile(imgUrl, dest, 15 * 1024 * 1024);
            await sock.sendMessage(chat, { image: fs.readFileSync(dest) }, { quoted: msg });
          });
        } catch {}
      }
    }
  } catch (e) {
    await sock.sendMessage(chat, { text: `⚠️ couplepp failed: ${e.message}` }, { quoted: msg }).catch(() => {});
  }
}
