// ─────────────────────────────────────────────
// WRAITH · modules/utility.js
// Phase 1 utility commands + presence tracker backbone.
// All handlers crash-safe.
// ─────────────────────────────────────────────
import fs from 'node:fs';
import path from 'node:path';
import { downloadContentFromMessage } from '@whiskeysockets/baileys';
import { isOwner, ownerJid } from '../core/identity.js';
import { readJson, writeJsonAtomic } from '../core/state-io.js';
import { inState } from '../core/paths.js';
import { vaultPath, dropFromVault } from '../core/vault.js';
import { CONFIG } from '../config.js';
import { sendInteractive, createCtaUrl, createCtaCopy, sendWithCta } from '../lib/buttons.js';
import { chunkText, withTempFile } from '../lib/net.js';
import {
  fetchCurrency, defineWord, fetchWeather, checkPwned,
  generateQr, decodeQr, shortenUrl, fetchNews, fetchHackerNews,
  searchWikipedia, fetchJoke, fetchAdvice, fetchFact,
} from '../lib/apis.js';

const MODE_FILE = () => inState('mode.json');

// ── Mode ────────────────────────────────────────────────────────────────────
export function getMode() {
  const m = readJson(MODE_FILE(), { mode: 'private' });
  return m.mode === 'public' ? 'public' : 'private';
}
export function setMode(mode) {
  writeJsonAtomic(MODE_FILE(), { mode: mode === 'public' ? 'public' : 'private' });
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function fromOf(msg) {
  return msg.key.participant || msg.key.remoteJid;
}
function ownerOnly(sock, chat, msg) {
  const from = fromOf(msg);
  if (!msg.key.fromMe && !isOwner(from)) {
    sock.sendMessage(chat, { text: '⛔ Owner only.' }, { quoted: msg }).catch(() => {});
    return true;
  }
  return false;
}
async function sendChunked(sock, chat, msg, text) {
  for (const p of chunkText(text, 3800)) {
    await sock.sendMessage(chat, { text: p }, { quoted: msg });
  }
}
async function downloadQuotedMedia(msg) {
  const ctx = msg.message?.extendedTextMessage?.contextInfo;
  const quoted = ctx?.quotedMessage;
  if (!quoted) return null;
  const node = quoted.imageMessage || quoted.videoMessage || quoted.documentMessage;
  if (!node) return null;
  const kind = quoted.imageMessage ? 'image' : quoted.videoMessage ? 'video' : 'document';
  const stream = await downloadContentFromMessage(node, kind);
  const chunks = [];
  for await (const c of stream) chunks.push(c);
  return { buffer: Buffer.concat(chunks), kind, mimetype: node.mimetype || 'image/png' };
}

// ── .currency ───────────────────────────────────────────────────────────────
const ALIASES = {
  // Asia & Middle East
  pakistan: 'PKR', pkr: 'PKR', india: 'INR', inr: 'INR', nepal: 'NPR', npr: 'NPR',
  bangladesh: 'BDT', bdt: 'BDT', srilanka: 'LKR', lkr: 'LKR', afghanistan: 'AFN', afn: 'AFN',
  china: 'CNY', cny: 'CNY', rmb: 'CNY', japan: 'JPY', jpy: 'JPY',
  southkorea: 'KRW', korea: 'KRW', krw: 'KRW', northkorea: 'KPW',
  singapore: 'SGD', sgd: 'SGD', malaysia: 'MYR', myr: 'MYR', indonesia: 'IDR', idr: 'IDR',
  philippines: 'PHP', php: 'PHP', vietnam: 'VND', vnd: 'VND', thailand: 'THB', thb: 'THB',
  taiwan: 'TWD', twd: 'TWD', hongkong: 'HKD', hkd: 'HKD', macau: 'MOP', mop: 'MOP',
  myanmar: 'MMK', mmk: 'MMK', cambodia: 'KHR', khr: 'KHR', laos: 'LAK', lak: 'LAK',
  maldives: 'MVR', mvr: 'MVR', bhutan: 'BTN', btn: 'BTN',
  uae: 'AED', aed: 'AED', emirates: 'AED', dubai: 'AED',
  saudi: 'SAR', sar: 'SAR', ksa: 'SAR', saudiarabia: 'SAR',
  qatar: 'QAR', qar: 'QAR', kuwait: 'KWD', kwd: 'KWD',
  bahrain: 'BHD', bhd: 'BHD', oman: 'OMR', omr: 'OMR',
  iraq: 'IQD', iqd: 'IQD', iran: 'IRR', irr: 'IRR',
  jordan: 'JOD', jod: 'JOD', lebanon: 'LBP', lbp: 'LBP',
  syria: 'SYP', syp: 'SYP', yemen: 'YER', yer: 'YER',
  israel: 'ILS', ils: 'ILS', palestine: 'ILS',
  turkey: 'TRY', try: 'TRY', turkiye: 'TRY',

  // Americas
  usa: 'USD', us: 'USD', america: 'USD', usd: 'USD',
  canada: 'CAD', cad: 'CAD', mexico: 'MXN', mxn: 'MXN',
  brazil: 'BRL', brl: 'BRL', argentina: 'ARS', ars: 'ARS',
  colombia: 'COP', cop: 'COP', chile: 'CLP', clp: 'CLP',
  peru: 'PEN', pen: 'PEN', venezuela: 'VES', ves: 'VES',
  uruguay: 'UYU', uyu: 'UYU', bolivia: 'BOB', bob: 'BOB',
  paraguay: 'PYG', pyg: 'PYG', ecuador: 'USD',
  costarica: 'CRC', crc: 'CRC', panama: 'PAB', pab: 'PAB',
  guatemala: 'GTQ', gtq: 'GTQ', dominican: 'DOP', dop: 'DOP',
  cuba: 'CUP', cup: 'CUP', jamaica: 'JMD', jmd: 'JMD',

  // Europe
  uk: 'GBP', gb: 'GBP', gbp: 'GBP', britain: 'GBP', england: 'GBP',
  euro: 'EUR', eur: 'EUR', europe: 'EUR', germany: 'EUR', france: 'EUR',
  italy: 'EUR', spain: 'EUR', netherlands: 'EUR', belgium: 'EUR',
  austria: 'EUR', portugal: 'EUR', ireland: 'EUR', finland: 'EUR',
  greece: 'EUR', slovakia: 'EUR', slovenia: 'EUR', estonia: 'EUR',
  latvia: 'EUR', lithuania: 'EUR', cyprus: 'EUR', malta: 'EUR',
  switzerland: 'CHF', swiss: 'CHF', chf: 'CHF',
  russia: 'RUB', rub: 'RUB', ukraine: 'UAH', uah: 'UAH',
  sweden: 'SEK', sek: 'SEK', norway: 'NOK', nok: 'NOK', denmark: 'DKK', dkk: 'DKK',
  poland: 'PLN', pln: 'PLN', czech: 'CZK', czk: 'CZK', hungary: 'HUF', huf: 'HUF',
  romania: 'RON', ron: 'RON', bulgaria: 'BGN', bgn: 'BGN', croatia: 'EUR',
  serbia: 'RSD', rsd: 'RSD', iceland: 'ISK', isk: 'ISK',

  // Africa & Oceania
  australia: 'AUD', aud: 'AUD', newzealand: 'NZD', nzd: 'NZD', fiji: 'FJD', fjd: 'FJD',
  southafrica: 'ZAR', zar: 'ZAR', egypt: 'EGP', egp: 'EGP',
  nigeria: 'NGN', ngn: 'NGN', kenya: 'KES', kes: 'KES',
  morocco: 'MAD', mad: 'MAD', algeria: 'DZD', dzd: 'DZD', tunisia: 'TND', tnd: 'TND',
  ghana: 'GHS', ghs: 'GHS', ethiopia: 'ETB', etb: 'ETB', tanzania: 'TZS', tzs: 'TZS',
  uganda: 'UGX', ugx: 'UGX', sudan: 'SDG', sdg: 'SDG', libya: 'LYD', lyd: 'LYD',
  senegal: 'XOF', ivorycoast: 'XOF', cameroon: 'XAF', zimbabwe: 'ZWL',
  mauritius: 'MUR', mur: 'MUR', seychelles: 'SCR', scr: 'SCR',

  // Central Asia & Caucasus
  kazakhstan: 'KZT', kzt: 'KZT', uzbekistan: 'UZS', uzs: 'UZS',
  azerbaijan: 'AZN', azn: 'AZN', georgia: 'GEL', gel: 'GEL',
};
function resolveCurrency(s) {
  const k = String(s || '').trim().toLowerCase();
  return ALIASES[k] || k.toUpperCase();
}

export async function currencyCommand(sock, chat, msg, args) {
  try {
    const [fromRaw, toRaw, amountRaw] = args || [];
    if (!fromRaw || !toRaw) {
      return sock.sendMessage(chat, {
        text: '💱 *currency*\n\nUsage: `.currency USD PKR 100`\nAliases: country names or ISO codes.',
      }, { quoted: msg });
    }
    const amount = Number(amountRaw || 1);
    if (!Number.isFinite(amount) || amount <= 0) {
      return sock.sendMessage(chat, { text: '❌ Amount must be a positive number.' }, { quoted: msg });
    }
    const from = resolveCurrency(fromRaw);
    const to = resolveCurrency(toRaw);
    const r = await fetchCurrency(from, to);
    if (!r.ok) {
      return sock.sendMessage(chat, { text: `❌ Could not fetch rates for *${from} → ${to}*.` }, { quoted: msg });
    }
    const rate = r.rate;
    const converted = amount * rate;
    await sock.sendMessage(chat, {
      text: `💱 *currency*\n\n*${amount} ${from}*  →  *${converted.toFixed(4)} ${to}*\n_1 ${from} = ${rate} ${to}_\n_1 ${to} = ${(1 / rate).toFixed(6)} ${from}_\n\nProvided by 𝗪𝗥𝗔𝗜𝗧🇭`,
    }, { quoted: msg });
  } catch (e) {
    await sock.sendMessage(chat, { text: `⚠️ currency failed: ${e.message}` }, { quoted: msg }).catch(() => {});
  }
}

// ── .qr ─────────────────────────────────────────────────────────────────────
export async function qrCommand(sock, chat, msg, args) {
  try {
    const a0 = (args?.[0] || '').toLowerCase();
    if (a0 === 'read') {
      const media = await downloadQuotedMedia(msg).catch(() => null);
      if (!media || media.kind !== 'image') {
        return sock.sendMessage(chat, { text: '❌ Reply to a QR image with `.qr read`.' }, { quoted: msg });
      }
      const { decoded } = await decodeQr(media.buffer, media.mimetype);
      if (!decoded) return sock.sendMessage(chat, { text: '❌ No QR detected.' }, { quoted: msg });
      return sendChunked(sock, chat, msg, `🔍 *QR decoded*\n\n\`\`\`\n${decoded}\n\`\`\``);
    }

    const text = (args || []).join(' ').trim();
    if (!text) {
      return sock.sendMessage(chat, {
        text: '📱 *qr*\n\n`.qr <text>` — generate QR\n`.qr read` — reply to a QR image to decode it',
      }, { quoted: msg });
    }
    const r = await generateQr(text);
    if (!r.ok) throw new Error('QR generation failed');
    await sock.sendMessage(chat, {
      image: r.buffer,
      caption: `📱 QR for: _${text.slice(0, 80)}${text.length > 80 ? '…' : ''}_`,
    }, { quoted: msg });
  } catch (e) {
    await sock.sendMessage(chat, { text: `⚠️ qr failed: ${e.message}` }, { quoted: msg }).catch(() => {});
  }
}

// ── .define ─────────────────────────────────────────────────────────────────
export async function defineCommand(sock, chat, msg, args) {
  try {
    const word = (args || []).join(' ').trim();
    if (!word) return sendWithCta(sock, chat, '📖 *define*\n\nUsage: `.define <word>`', { quoted: msg });

    const r = await defineWord(word);
    if (!r.ok) return sock.sendMessage(chat, { text: `❌ No definition found for *${word}*.` }, { quoted: msg });

    const lines = [];
    if (r.entry) {
      const e = r.entry;
      lines.push(`📖 *${e.word}*${e.phonetic ? `  _${e.phonetic}_` : ''}`);
      lines.push('');
      let n = 0;
      for (const meaning of (e.meanings || []).slice(0, 4)) {
        lines.push(`*${meaning.partOfSpeech}*`);
        for (const def of (meaning.definitions || []).slice(0, 3)) {
          n++;
          lines.push(`${n}. ${def.definition}`);
          if (def.example) lines.push(`   _e.g. ${def.example}_`);
        }
        lines.push('');
      }
      const syns = e.meanings.flatMap((m) => m.definitions.flatMap((d) => d.synonyms || [])).slice(0, 10);
      if (syns.length) lines.push(`_synonyms:_ ${syns.join(', ')}`);
    } else if (r.wiktionary) {
      lines.push(`📖 *${word}*  _(Wiktionary)_`);
      lines.push('');
      r.wiktionary.slice(0, 5).forEach((d, i) => lines.push(`${i + 1}. ${d.definition.replace(/<[^>]+>/g, '')}`));
    }
    await sendChunked(sock, chat, msg, lines.join('\n'));
  } catch (e) {
    await sock.sendMessage(chat, { text: `⚠️ define failed: ${e.message}` }, { quoted: msg }).catch(() => {});
  }
}

// ── .weather ────────────────────────────────────────────────────────────────
const STORM_CODES = new Set([95, 96, 99]);
function codeLabel(c) {
  if (STORM_CODES.has(c)) return '⛈️ thunderstorm';
  if ([61, 63, 65, 80, 81, 82, 66, 67].includes(c)) return '🌧️ rain';
  if ([71, 73, 75, 77, 85, 86].includes(c)) return '❄️ snow';
  if ([45, 48].includes(c)) return '🌫️ fog';
  if (c === 0) return '☀️ clear';
  if (c <= 3) return '🌤️ partly cloudy';
  return '☁️ cloudy';
}

export async function weatherCommand(sock, chat, msg, args) {
  try {
    const city = (args || []).join(' ').trim();
    if (!city) return sendWithCta(sock, chat, '🌦️ *weather*\n\nUsage: `.weather <city>`\nWarns if rain/storm probability > 50%.', { quoted: msg });

    const r = await fetchWeather(city, CONFIG.weather?.stormThreshold || 50);
    if (!r.ok) return sock.sendMessage(chat, { text: `❌ Could not fetch weather for *${city}*.` }, { quoted: msg });

    const lines = [];
    const header = r.warned
      ? '⚠️ *WEATHER WARNING* — rain/storm probability above 50% detected.\n'
      : '✅ *weather check* — no heavy rain/storm expected above 50%.\n';
    lines.push(header);
    lines.push(`🌦️ *${r.label}*`);
    lines.push('');
    if (r.days) {
      for (const d of r.days) {
        const w = d.warn ? ' ⚠️' : '';
        lines.push(`• ${d.date} — ${codeLabel(d.weathercode)}${w}`);
        lines.push(`   rain ${d.pop}% · ${d.tmin}°C – ${d.tmax}°C`);
      }
    } else if (r.current) {
      lines.push(`• temp · ${r.current.temp}°C (feels ${r.current.feels}°C)`);
      lines.push(`• weather · ${r.current.desc}`);
      lines.push(`• humidity · ${r.current.humidity}%`);
      lines.push(`• wind · ${r.current.wind} km/h`);
    }
    lines.push('');
    lines.push('Provided by 𝗪𝗥𝗔𝗜𝗧🇭');
    await sendChunked(sock, chat, msg, lines.join('\n'));
  } catch (e) {
    await sock.sendMessage(chat, { text: `⚠️ weather failed: ${e.message}` }, { quoted: msg }).catch(() => {});
  }
}

// ── .pwned ──────────────────────────────────────────────────────────────────
export async function pwnedCommand(sock, chat, msg, args) {
  try {
    const pwd = (args || []).join(' ').trim();
    if (!pwd) return sendWithCta(sock, chat, '🔐 *pwned*\n\nUsage: `.pwned <password>`', { quoted: msg });
    const { count } = await checkPwned(pwd);
    if (count > 0) {
      await sock.sendMessage(chat, {
        text: `🚨 *PWNED*\n\nThat password appeared in *${count.toLocaleString()}* breaches.\n_Change it immediately — especially if reused._`,
      }, { quoted: msg });
    } else {
      await sock.sendMessage(chat, {
        text: `✅ *SAFE*\n\nThat password was not found in known breaches.\n_Tip: still use a password manager + 2FA._`,
      }, { quoted: msg });
    }
  } catch (e) {
    await sock.sendMessage(chat, { text: `⚠️ pwned check failed: ${e.message}` }, { quoted: msg }).catch(() => {});
  }
}

// ── .owner ──────────────────────────────────────────────────────────────────
export async function ownerCommand(sock, chat, msg, args) {
  try {
    const a0 = (args?.[0] || '').toLowerCase();
    if (a0 === 'list') {
      const { ownerlistCommand } = await import('./owner.js');
      return ownerlistCommand(sock, chat, msg);
    }
    if (!CONFIG.owner) return sock.sendMessage(chat, { text: '❌ Owner not configured.' }, { quoted: msg });
    const digits = CONFIG.owner.replace(/\D/g, '');
    const vcard = [
      'BEGIN:VCARD', 'VERSION:3.0',
      `FN:${CONFIG.codename || 'WRAITH'} Owner`,
      `TEL;type=CELL;type=VOICE;waid=${digits}:+${digits}`,
      `NOTE:${CONFIG.botName || 'WRAITH'} owner`,
      'END:VCARD',
    ].join('\n');
    await sock.sendMessage(chat, {
      contacts: { displayName: `${CONFIG.codename || 'WRAITH'} Owner`, contacts: [{ vcard }] },
    }, { quoted: msg });
  } catch (e) {
    await sock.sendMessage(chat, { text: `⚠️ owner card failed: ${e.message}` }, { quoted: msg }).catch(() => {});
  }
}

// ── .script / .repo ─────────────────────────────────────────────────────────
export async function scriptCommand(sock, chat, msg) {
  try {
    const url = CONFIG.repoUrl || 'https://github.com/themalik-g/wraith';
    await sendInteractive(
      sock,
      chat,
      {
        body: `📦 *WRAITH*\n\n_${CONFIG.codename || 'WRAITH'} v${CONFIG.version || ''} — a silent watcher for WhatsApp._\n\n${url}`,
        footer: 'Provided by 𝗪𝗥𝗔𝗜𝗧🇭',
        buttons: [
          createCtaUrl('🌐 GitHub Repository', url),
          createCtaCopy('📋 Copy Repo URL', url)
        ]
      },
      { quoted: msg }
    );
  } catch (e) {
    await sock.sendMessage(chat, { text: `⚠️ script failed: ${e.message}` }, { quoted: msg }).catch(() => {});
  }
}

// ── .mode ───────────────────────────────────────────────────────────────────
export async function modeCommand(sock, chat, msg, args) {
  if (ownerOnly(sock, chat, msg)) return;
  try {
    const a0 = (args?.[0] || '').toLowerCase();
    if (!a0) {
      const current = getMode();
      return sock.sendMessage(chat, {
        text: `⚙️ *mode*\n\ncurrent · *${current}*\n\n`.concat(
          current === 'public'
            ? '_Public: everyone can use non-critical commands. Owner-only commands still require owner._'
            : '_Private: only the owner can use any command._'
        ),
      }, { quoted: msg });
    }
    if (a0 !== 'public' && a0 !== 'private') {
      return sock.sendMessage(chat, { text: '❌ Use `.mode public` or `.mode private`.' }, { quoted: msg });
    }
    setMode(a0);
    await sock.sendMessage(chat, {
      text: a0 === 'public'
        ? '🌐 *Public mode enabled.*\nEveryone can use non-critical commands.\nOwner-only commands still require owner.'
        : '🔒 *Private mode enabled.*\nOnly the owner can use any command now.',
    }, { quoted: msg });
  } catch (e) {
    await sock.sendMessage(chat, { text: `⚠️ mode failed: ${e.message}` }, { quoted: msg }).catch(() => {});
  }
}

// ── .shorten / .tinyurl / .shorturl ───────────────────────────────────────
export async function shortenCommand(sock, chat, msg, args) {
  try {
    const url = (args || []).join(' ').trim();
    if (!url || !url.startsWith('http')) {
      return sendWithCta(sock, chat, '🔗 *shorten*\n\nUsage: `.shorten <http(s)://long-url>`', { quoted: msg });
    }

    const r = await shortenUrl(url);
    if (!r.ok) {
      return sock.sendMessage(chat, { text: '❌ Could not shorten URL. Please check the URL and try again.' }, { quoted: msg });
    }

    await sock.sendMessage(chat, {
      text: `🔗 *Shortened URL*\n\n*Original:* ${url}\n*Short:* ${r.shortUrl}\n\nProvided by 𝗪𝗥𝗔𝗜𝗧🇭`
    }, { quoted: msg });
  } catch (e) {
    await sock.sendMessage(chat, { text: `⚠️ shorten failed: ${e.message}` }, { quoted: msg }).catch(() => {});
  }
}

// ── .news ───────────────────────────────────────────────────────────────────
export async function newsCommand(sock, chat, msg, args) {
  try {
    const topic = (args || []).join(' ').trim();
    const r = await fetchNews(topic);
    if (!r.ok || !r.articles.length) {
      return sock.sendMessage(chat, { text: `❌ Could not fetch news${topic ? ` for *${topic}*` : ''}.` }, { quoted: msg });
    }

    const lines = [`📰 *News Headlines (${r.topic})*`, ''];
    r.articles.forEach((a, i) => {
      lines.push(`${i + 1}. *${a.title}*`);
      if (a.pubDate) lines.push(`   _${a.pubDate} · ${a.source}_`);
      lines.push(`   🔗 ${a.link}`);
      lines.push('');
    });
    lines.push('Provided by 𝗪𝗥𝗔𝗜𝗧🇭');

    await sendChunked(sock, chat, msg, lines.join('\n'));
  } catch (e) {
    await sock.sendMessage(chat, { text: `⚠️ news failed: ${e.message}` }, { quoted: msg }).catch(() => {});
  }
}

// ── .hackernews / .hn ───────────────────────────────────────────────────────
export async function hackernewsCommand(sock, chat, msg) {
  try {
    const r = await fetchHackerNews(8);
    if (!r.ok || !r.stories.length) {
      return sock.sendMessage(chat, { text: '❌ Could not fetch Hacker News top stories.' }, { quoted: msg });
    }

    const lines = ['🟧 *Hacker News — Top Stories*', ''];
    r.stories.forEach((s, i) => {
      lines.push(`${i + 1}. *${s.title}*`);
      lines.push(`   ▲ ${s.points} pts · by ${s.author} · 💬 ${s.comments} comments`);
      lines.push(`   🔗 ${s.url}`);
      lines.push('');
    });
    lines.push('Provided by 𝗪𝗥𝗔𝗜𝗧🇭');

    await sendChunked(sock, chat, msg, lines.join('\n'));
  } catch (e) {
    await sock.sendMessage(chat, { text: `⚠️ hackernews failed: ${e.message}` }, { quoted: msg }).catch(() => {});
  }
}

// ── .wiki / .wikipedia ──────────────────────────────────────────────────────
export async function wikiCommand(sock, chat, msg, args) {
  try {
    const query = (args || []).join(' ').trim();
    if (!query) {
      return sendWithCta(sock, chat, '🌐 *wikipedia*\n\nUsage: `.wiki <search topic>`', { quoted: msg });
    }

    const r = await searchWikipedia(query);
    if (!r.ok) {
      return sock.sendMessage(chat, { text: `❌ No Wikipedia article found for *${query}*.` }, { quoted: msg });
    }

    const text = `🌐 *Wikipedia: ${r.title}*\n_${r.description}_\n\n${r.extract}\n\n🔗 ${r.url}\n\nProvided by 𝗪𝗥𝗔𝗜𝗧🇭`;
    await sendChunked(sock, chat, msg, text);
  } catch (e) {
    await sock.sendMessage(chat, { text: `⚠️ wikipedia failed: ${e.message}` }, { quoted: msg }).catch(() => {});
  }
}

// ── .joke ───────────────────────────────────────────────────────────────────
export async function jokeCommand(sock, chat, msg) {
  try {
    const r = await fetchJoke();
    if (!r.ok) return sock.sendMessage(chat, { text: '❌ Could not fetch a joke right now.' }, { quoted: msg });
    await sock.sendMessage(chat, {
      text: `😂 *Joke*\n\n${r.joke}\n\nProvided by 𝗪𝗥𝗔𝗜𝗧🇭`
    }, { quoted: msg });
  } catch (e) {
    await sock.sendMessage(chat, { text: `⚠️ joke failed: ${e.message}` }, { quoted: msg }).catch(() => {});
  }
}

// ── .advice ─────────────────────────────────────────────────────────────────
export async function adviceCommand(sock, chat, msg) {
  try {
    const r = await fetchAdvice();
    if (!r.ok) return sock.sendMessage(chat, { text: '❌ Could not fetch advice right now.' }, { quoted: msg });
    await sock.sendMessage(chat, {
      text: `💡 *Advice*\n\n_"${r.advice}"_\n\nProvided by 𝗪𝗥𝗔𝗜𝗧🇭`
    }, { quoted: msg });
  } catch (e) {
    await sock.sendMessage(chat, { text: `⚠️ advice failed: ${e.message}` }, { quoted: msg }).catch(() => {});
  }
}

// ── .fact ───────────────────────────────────────────────────────────────────
export async function factCommand(sock, chat, msg) {
  try {
    const r = await fetchFact();
    if (!r.ok) return sock.sendMessage(chat, { text: '❌ Could not fetch a fact right now.' }, { quoted: msg });
    await sock.sendMessage(chat, {
      text: `🧠 *Random Fact*\n\n_${r.fact}_\n\nProvided by 𝗪𝗥𝗔𝗜𝗧🇭`
    }, { quoted: msg });
  } catch (e) {
    await sock.sendMessage(chat, { text: `⚠️ fact failed: ${e.message}` }, { quoted: msg }).catch(() => {});
  }
}
