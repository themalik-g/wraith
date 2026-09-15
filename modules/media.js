// ─────────────────────────────────────────────
// WRAITH · modules/media.js
// Books (downloadable-only) + PPT (DuckDuckGo AI)
// ─────────────────────────────────────────────
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { searchBooks } from '../lib/apis.js';

// ─── Book cache ───
const bookCache = new Map();
const BOOK_CACHE_TTL = 10 * 60 * 1000;

function getCachedBooks(chat) {
  const e = bookCache.get(chat);
  if (e && Date.now() - e.time < BOOK_CACHE_TTL) return e;
  return null;
}

// ─── Small helpers ───
function chunkText(text, size = 3800) {
  const out = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

async function sendChunked(sock, chat, msg, text) {
  for (const p of chunkText(text)) {
    await sock.sendMessage(chat, { text: p }, { quoted: msg });
  }
}

async function downloadToFile(url, dest, maxBytes = 100 * 1024 * 1024, timeoutSec = 30, extraHeaders = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutSec * 1000);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0', ...extraHeaders }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const reader = res.body.getReader();
    const ws = fs.createWriteStream(dest);
    let downloaded = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      downloaded += value.length;
      if (downloaded > maxBytes) {
        ws.destroy();
        throw new Error('File exceeds size limit');
      }
      if (!ws.write(Buffer.from(value))) {
        await new Promise((r) => ws.once('drain', r));
      }
    }
    await new Promise((r) => ws.end(r));
  } finally {
    clearTimeout(timer);
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
          60,
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
// DuckDuckGo free AI — bullet generator
// ─────────────────────────────────────────────
async function fetchDuckDuckGoBullets(topic, total = 20) {
  const prompt =
    `Give me exactly ${total} short factual presentation bullet points about "${topic}". ` +
    `Return ONLY the bullet points, one per line. No numbering, no markdown, no extra text.`;

  const models = [
    'gpt-4o-mini',
    'claude-3-haiku',
    'meta-llama/Llama-3-70b-chat-hf',
    'mistralai/Mixtral-8x7B-Instruct-v0.1'
  ];

  let lastErr;

  for (const model of models) {
    try {
      // Step 1: get vqd
      const vqdRes = await fetch('https://duckduckgo.com/duckchat/v1/status', {
        headers: { 'x-vqd-accept': '1', 'User-Agent': 'Mozilla/5.0' }
      });
      const vqd = vqdRes.headers.get('x-vqd-4');
      if (!vqd) throw new Error('No vqd token');

      // Step 2: POST chat
      const chatRes = await fetch('https://duckduckgo.com/duckchat/v1/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-vqd-4': vqd,
          'User-Agent': 'Mozilla/5.0'
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }]
        })
      });

      if (!chatRes.ok) throw new Error(`DDG ${chatRes.status}`);
      const text = await chatRes.text();

      // Parse SSE-style stream
      const parts = [];
      for (const line of text.split('\n')) {
        const t = line.trim();
        if (!t.startsWith('data:')) continue;
        const payload = t.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          const j = JSON.parse(payload);
          if (j.message) parts.push(j.message);
        } catch {}
      }

      const raw = parts.join('').trim();
      if (!raw) throw new Error('Empty DDG reply');

      const bullets = raw
        .split('\n')
        .map((l) => l.replace(/^[\-\*\u2022\d\.\)\s]+/, '').trim())
        .filter((l) => l.length > 3)
        .slice(0, total);

      if (!bullets.length) throw new Error('No bullets parsed');
      return bullets;

    } catch (e) {
      lastErr = e;
      console.warn(`[ppt] DDG model ${model} failed:`, e.message);
    }
  }

  throw lastErr || new Error('DuckDuckGo AI unavailable');
}

// ─────────────────────────────────────────────
// .ppt
// ─────────────────────────────────────────────
export async function pptCommand(sock, chat, msg, args) {
  const topic = (args || []).join(' ').trim();
  if (!topic) {
    return sock.sendMessage(chat, { text: '📊 *ppt*\n\nUsage: `.ppt <topic>`' }, { quoted: msg });
  }

  const status = await sock.sendMessage(chat, {
    text: `📊 *Building presentation on* ${topic}…`
  }, { quoted: msg });

  try {
    await sock.sendMessage(chat, {
      text: `📊 *Fetching content…*`,
      edit: status.key
    }).catch(() => {});

    const bullets = await fetchDuckDuckGoBullets(topic, 20);
    if (!bullets.length) throw new Error('No content returned');

    // ─── Lazy-load pptxgenjs (CJS) ───
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    let PptxGenJS;
    try {
      const mod = require('pptxgenjs');
      PptxGenJS = mod?.default || mod;
    } catch {
      throw new Error('pptxgenjs not installed');
    }

    const safeName = topic.replace(/[^\w\s-]/g, '').trim().slice(0, 40) || 'presentation';

    const pptx = new PptxGenJS();
    pptx.layout = 'LAYOUT_WIDE';
    pptx.title = topic;

    // Title slide
    const s1 = pptx.addSlide();
    s1.background = { color: '1a1a2e' };
    s1.addText(topic, {
      x: 0.5, y: 1.9, w: 12, h: 1.4,
      fontSize: 36, bold: true, align: 'center', color: 'FFFFFF'
    });
    s1.addText('Generated by WRAITH', {
      x: 0.5, y: 3.5, w: 12, h: 0.5,
      fontSize: 14, align: 'center', color: 'AAAAAA'
    });

    // Content slides — 4 bullets per slide
    for (let i = 0; i < bullets.length; i += 4) {
      const slide = pptx.addSlide();
      slide.background = { color: 'FFFFFF' };
      slide.addText(`${topic}`, {
        x: 0.5, y: 0.3, w: 12, h: 0.7,
        fontSize: 22, bold: true, color: '1a1a2e'
      });
      slide.addText(
        bullets.slice(i, i + 4).map((b) => ({
          text: b,
          options: { bullet: true, breakLine: true }
        })),
        {
          x: 0.6, y: 1.2, w: 11.8, h: 5,
          fontSize: 15, color: '333333', lineSpacing: 22
        }
      );
    }

    const total = Math.ceil(bullets.length / 4) + 1;
    const dest = path.join(os.tmpdir(), `wraith-ppt-${Date.now()}.pptx`);
    await pptx.writeFile({ fileName: dest });

    await sock.sendMessage(chat, {
      document: fs.readFileSync(dest),
      fileName: `${safeName}.pptx`,
      mimetype: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      caption: `📊 *${topic}* — ${total} slides\n_Source: DuckDuckGo AI_`
    }, { quoted: msg });

    try { fs.unlinkSync(dest); } catch {}

    await sock.sendMessage(chat, {
      text: `✅ *Done*`,
      edit: status.key
    }).catch(() => {});

  } catch (e) {
    console.error('[ppt]', e.message);
    await sock.sendMessage(chat, {
      text: `❌ *PPT failed:* ${e.message}`,
      edit: status.key
    }).catch(() => {});
  }
}
