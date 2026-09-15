// ─────────────────────────────────────────────
// WRAITH · modules/media.js
// Phase 2: Books, Images, Movie, Song, Lyrics, PPT, CouplePP
// ─────────────────────────────────────────────
import fs from 'node:fs';
import { isOwner } from '../core/identity.js';
import { CONFIG } from '../config.js';
import { chunkText, withTempFile, downloadToFile } from '../lib/net.js';
import { searchBooks, searchMovie, searchSong, fetchLyrics, searchImages } from '../lib/apis.js';

// ★ In-memory cache of each chat's last book search → `.book dl 2` is reliable
const bookCache = new Map(); // chat → { time, query, books }
const BOOK_CACHE_TTL = 10 * 60 * 1000;
function getCachedBooks(chat) {
  const e = bookCache.get(chat);
  if (e && Date.now() - e.time < BOOK_CACHE_TTL) return e;
  return null;
}

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

    // ★ NEW: `.book dl <index>` uses the cached last search — actually downloads the right book
    if (a0 === 'dl' && args[1]) {
      const cached = getCachedBooks(chat);
      let book = null;
      const n = parseInt(args[1], 10);
      if (cached && !isNaN(n) && cached.books[n - 1]) {
        book = cached.books[n - 1];
      } else {
        // fallback: treat arg as an ID/query
        const r = await searchBooks(args[1], 1);
        if (r.ok && r.books[0]) book = r.books[0];
      }
      if (!book) return sock.sendMessage(chat, { text: '❌ Book not found. Run `.book <query>` first, then `.book dl <number>`.' }, { quoted: msg });
      if (!book.url) {
        return sock.sendMessage(chat, {
          text: `❌ No direct download for *${book.title}*.\n_Read online:_ ${book.webUrl || 'not available'}`,
        }, { quoted: msg });
      }

      await sock.sendMessage(chat, { text: `📥 Downloading *${book.title}* (${book.format})…` }, { quoted: msg });
      const ext = book.format === 'epub' ? '.epub' : book.format === 'pdf' ? '.pdf' : '.txt';
      const safeName = (book.title || 'book').replace(/[^\w\s-]/g, '').trim().slice(0, 60) || 'book';
      await withTempFile(`book${ext}`, async (dest) => {
        await downloadToFile(book.url, dest, (CONFIG.media?.maxDownloadMB || 100) * 1024 * 1024, 10);
        const stat = fs.statSync(dest);
        await sock.sendMessage(chat, {
          document: fs.readFileSync(dest),
          fileName: `${safeName}${ext}`,
          mimetype: ext === '.pdf' ? 'application/pdf' : ext === '.epub' ? 'application/epub+zip' : 'text/plain',
          caption: `📚 *${book.title}*\n_by ${book.author}_${book.year ? ` · ${book.year}` : ''}\n_${(stat.size / 1024).toFixed(0)} KB_`,
        }, { quoted: msg });
      });
      return;
    }

    const query = (args || []).join(' ').trim();
    if (!query) {
      return sock.sendMessage(chat, {
        text: '📚 *book*\n\n`.book <title or author>` — search\n`.book dl <number>` — download from the last results',
      }, { quoted: msg });
    }
    const r = await searchBooks(query, 5);
    if (!r.ok || !r.books.length) return sock.sendMessage(chat, { text: `❌ No books found for *${query}*.` }, { quoted: msg });

    bookCache.set(chat, { time: Date.now(), query, books: r.books });

    const lines = [`📚 *books* — "${query}"`, ''];
    r.books.forEach((b, i) => {
      lines.push(`*${i + 1}.* ${b.title}`);
      lines.push(`   _${b.author}_${b.year ? ` · ${b.year}` : ''} · ${b.format ? b.format.toUpperCase() : 'online only'}`);
      if (b.url) lines.push(`   \`.book dl ${i + 1}\``);
      else if (b.webUrl) lines.push(`   _read: ${b.webUrl}_`);
    });
    lines.push('', `_Source: ${r.source}_`);
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
          await downloadToFile(img.url, dest, 20 * 1024 * 1024, 5);
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
      r.description ? `_${String(r.description).slice(0, 400)}${r.description.length > 400 ? '…' : ''}_` : '',
      '',
      `_Source: ${r.source}_`,
    ].filter(Boolean);

    if (r.poster) {
      try {
        await withTempFile('poster.jpg', async (dest) => {
          await downloadToFile(r.poster, dest, 5 * 1024 * 1024, 5);
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

// ── .songinfo (info only — `.song` remains the downloader) ─────────────────
export async function songCommand(sock, chat, msg, args) {
  try {
    const query = (args || []).join(' ').trim();
    if (!query) return sock.sendMessage(chat, { text: '🎵 *songinfo*\n\nUsage: `.songinfo <title> [artist]`' }, { quoted: msg });
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
      r.preview ? `_30s preview: ${r.preview}_` : '',
    ].filter(Boolean);

    if (r.cover) {
      try {
        await withTempFile('cover.jpg', async (dest) => {
          await downloadToFile(r.cover, dest, 5 * 1024 * 1024, 5);
          await sock.sendMessage(chat, { image: fs.readFileSync(dest), caption: lines.join('\n') }, { quoted: msg });
        });
        return;
      } catch {}
    }
    await sendChunked(sock, chat, msg, lines.join('\n'));
  } catch (e) {
    await sock.sendMessage(chat, { text: `⚠️ songinfo failed: ${e.message}` }, { quoted: msg }).catch(() => {});
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
    if (!r.ok) return sock.sendMessage(chat, { text: `❌ No lyrics found for *${title.trim()}* by *${artist.trim()}*.` }, { quoted: msg });
    await sendChunked(sock, chat, msg, `🎤 *${title.trim()}* — _${artist.trim()}_\n_${r.source}_\n\n${r.lyrics}`);
  } catch (e) {
    await sock.sendMessage(chat, { text: `⚠️ lyrics failed: ${e.message}` }, { quoted: msg }).catch(() => {});
  }
}

// ── .ppt ★ REAL .pptx (pptxgenjs, lazy-loaded; TXT outline as fallback) ─────
let pptxModule; // undefined = not tried, null = unavailable
async function getPptx() {
  if (pptxModule === undefined) {
    try { pptxModule = (await import('pptxgenjs')).default || null; }
    catch { pptxModule = null; }
  }
  return pptxModule;
}

async function fetchWikiSummary(topic) {
  try {
    const r = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(topic)}`);
    if (r.ok) {
      const d = await r.json();
      if (d?.extract) return { title: d.title || topic, extract: d.extract };
    }
  } catch {}
  try {
    const r = await fetch(`https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext&exsentences=20&titles=${encodeURIComponent(topic)}&format=json&origin=*`);
    if (r.ok) {
      const d = await r.json();
      const page = d?.query?.pages ? Object.values(d.query.pages)[0] : null;
      if (page?.extract) return { title: page.title || topic, extract: page.extract };
    }
  } catch {}
  return null;
}

export async function pptCommand(sock, chat, msg, args) {
  try {
    const topic = (args || []).join(' ').trim();
    if (!topic) return sock.sendMessage(chat, { text: '📊 *ppt*\n\nUsage: `.ppt <topic>`' }, { quoted: msg });

    await sock.sendMessage(chat, { text: `📊 Building presentation on *${topic}*…` }, { quoted: msg });

    const wiki = await fetchWikiSummary(topic);
    const title = wiki?.title || topic;
    const summary = wiki?.extract || `${topic} — an overview.`;
    const PptxGenJS = await getPptx();
    const safeName = title.replace(/[^\w\s-]/g, '').trim().slice(0, 40) || 'presentation';

    if (PptxGenJS) {
      const pptx = new PptxGenJS();
      pptx.defineLayout({ name: 'W', width: 10, height: 5.625 });
      pptx.layout = 'W';
      pptx.title = title;

      const s1 = pptx.addSlide();
      s1.background = { color: '1a1a2e' };
      s1.addText(title, { x: 0.5, y: 1.9, w: 9, h: 1.4, fontSize: 36, bold: true, align: 'center', color: 'FFFFFF' });
      s1.addText(`Generated by ${CONFIG.botName || 'WRAITH'}`, { x: 0.5, y: 3.4, w: 9, h: 0.5, fontSize: 14, align: 'center', color: 'AAAAAA' });

      const sentences = summary.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 10).slice(0, 16);
      for (let i = 0; i < sentences.length; i += 4) {
        const slide = pptx.addSlide();
        slide.addText(`${title} — ${Math.floor(i / 4) + 2}`, { x: 0.5, y: 0.3, w: 9, h: 0.7, fontSize: 22, bold: true, color: '1a1a2e' });
        slide.addText(
          sentences.slice(i, i + 4).map((s) => ({ text: s.trim(), options: { bullet: true, breakLine: true } })),
          { x: 0.6, y: 1.2, w: 8.8, h: 4, fontSize: 15, color: '333333', lineSpacing: 22 }
        );
      }

      await withTempFile('pres.pptx', async (dest) => {
        await pptx.writeFile({ fileName: dest });
        await sock.sendMessage(chat, {
          document: fs.readFileSync(dest),
          fileName: `${safeName}.pptx`,
          mimetype: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          caption: `📊 *${title}* — ${Math.ceil(sentences.length / 4) + 1} slides\n_Source: Wikipedia_`,
        }, { quoted: msg });
      });
      return;
    }

    // Fallback: TXT outline (kept so the command still answers without the lib)
    const lines = [`PRESENTATION: ${title}`, '='.repeat(60), '', ...summary.split('\n').filter(Boolean).slice(0, 12)];
    await sock.sendMessage(chat, {
      document: Buffer.from(lines.join('\n'), 'utf8'),
      fileName: `${safeName}_presentation.txt`,
      mimetype: 'text/plain',
      caption: `📊 *${title}* — outline\n_Install pptxgenjs for real .pptx files._`,
    }, { quoted: msg });
  } catch (e) {
    await sock.sendMessage(chat, { text: `⚠️ ppt failed: ${e.message}` }, { quoted: msg }).catch(() => {});
  }
}

// ── .couplepp (shape-flexible parser, clear failure message) ────────────────
const COUPLE_PP_SOURCES = [
  'https://raw.githubusercontent.com/PikaBotz/important-API/main/couple-API/couplepp.json',
];

export async function coupleppCommand(sock, chat, msg, args) {
  try {
    const count = Math.min(Math.max(parseInt(args?.[0] || '3', 10) || 3, 1), CONFIG.media?.maxCouplePairs || 5);
    let pairs = [];
    for (const url of COUPLE_PP_SOURCES) {
      try {
        const res = await fetch(url);
        if (!res.ok) continue;
        const data = await res.json();
        // ★ accept multiple JSON shapes: [...] | {data:[...]} | {couples:[...]}
        pairs = Array.isArray(data) ? data : (data?.data || data?.couples || []);
        if (pairs.length) break;
      } catch {}
    }
    if (!pairs.length) {
      return sock.sendMessage(chat, {
        text: '❌ Couple PP source is down.\n_No reliable free fallback exists right now (per your rule: skipped rather than faked)._',
      }, { quoted: msg });
    }

    const shuffled = [...pairs].sort(() => Math.random() - 0.5).slice(0, count);
    await sock.sendMessage(chat, { text: `💑 Sending ${shuffled.length} couple PP pair${shuffled.length > 1 ? 's' : ''}…` }, { quoted: msg });

    for (const pair of shuffled) {
      const urls = [pair?.male || pair?.boy || pair?.[0], pair?.female || pair?.girl || pair?.[1]].filter(Boolean);
      for (const imgUrl of urls) {
        try {
          await withTempFile('couple.jpg', async (dest) => {
            await downloadToFile(imgUrl, dest, 15 * 1024 * 1024, 5);
            await sock.sendMessage(chat, { image: fs.readFileSync(dest) }, { quoted: msg });
          });
        } catch {}
      }
    }
  } catch (e) {
    await sock.sendMessage(chat, { text: `⚠️ couplepp failed: ${e.message}` }, { quoted: msg }).catch(() => {});
  }
}
