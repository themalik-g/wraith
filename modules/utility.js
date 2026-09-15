// ─────────────────────────────────────────────
// WRAITH · modules/utility.js
// Phase 1 utility commands + presence tracker.
// All handlers are crash-safe: the router wraps them, and each has internal
// try/catch so a single bad reply never kills the process.
// ─────────────────────────────────────────────
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { downloadContentFromMessage } from '@whiskeysockets/baileys';
import { isOwner, ownerJid } from '../core/identity.js';
import { readJson, writeJsonAtomic } from '../core/state-io.js';
import { vaultPath, dropFromVault } from '../core/vault.js';
import { CONFIG } from '../config.js';
import { httpGetJson, httpGetText, raceApis, downloadToFile, withTempFile, chunkText } from '../lib/net.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const MODE_FILE = path.join(here, '..', 'state', 'mode.json');
const PRESENCE_FILE = path.join(here, '..', 'state', 'presence-track.json');

// ── Mode (feature #18) ─────────────────────────────────────────────────────
export function getMode() {
  const m = readJson(MODE_FILE, { mode: 'private' });
  return m.mode === 'public' ? 'public' : 'private';
}
export function setMode(mode) {
  writeJsonAtomic(MODE_FILE, { mode: mode === 'public' ? 'public' : 'private' });
}

// ── Shared helpers ─────────────────────────────────────────────────────────
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
function splitLong(text) {
  return chunkText(text, 3800);
}
async function sendChunked(sock, chat, msg, text) {
  const parts = splitLong(text);
  for (const p of parts) {
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

// ─────────────────────────────────────────────────────────────────────────────
// .currency <from> <to> [amount]
// ─────────────────────────────────────────────────────────────────────────────
export async function currencyCommand(sock, chat, msg, args) {
  try {
    const [fromRaw, toRaw, amountRaw] = args || [];
    if (!fromRaw || !toRaw) {
      return sock.sendMessage(chat, {
        text: '💱 *currency*\n\nUsage: `.currency USD PKR 100`\nAliases: country names or ISO codes (USD, PKR, INR, NPR, AED, SAR, GBP, EUR…)',
      }, { quoted: msg });
    }
    const amount = Number(amountRaw || 1);
    if (!Number.isFinite(amount) || amount <= 0) {
      return sock.sendMessage(chat, { text: '❌ Amount must be a positive number.' }, { quoted: msg });
    }

    // Alias resolution for common country names → ISO codes
    const ALIASES = {
      pakistan: 'PKR', pkr: 'PKR',
      india: 'INR', inr: 'INR', nepal: 'NPR', npr: 'NPR',
      usa: 'USD', us: 'USD', america: 'USD', usd: 'USD',
      uk: 'GBP', gb: 'GBP', gbp: 'GBP', britain: 'GBP', england: 'GBP',
      uae: 'AED', aed: 'AED', emirates: 'AED',
      saudi: 'SAR', sar: 'SAR', ksa: 'SAR',
      euro: 'EUR', eur: 'EUR', europe: 'EUR',
      japan: 'JPY', jpy: 'JPY', china: 'CNY', cny: 'CNY',
      bangladesh: 'BDT', bdt: 'BDT', srilanka: 'LKR', lkr: 'LKR',
      canada: 'CAD', cad: 'CAD', australia: 'AUD', aud: 'AUD',
      turkey: 'TRY', try: 'TRY', malaysia: 'MYR', myr: 'MYR',
      indonesia: 'IDR', idr: 'IDR', qatar: 'QAR', qar: 'QAR',
      kuwait: 'KWD', kwd: 'KWD', bahrain: 'BHD', bhd: 'BHD',
      oman: 'OMR', omr: 'OMR',
    };
    const resolve = (s) => {
      const k = String(s || '').trim().toLowerCase();
      return ALIASES[k] || k.toUpperCase();
    };
    const from = resolve(fromRaw);
    const to = resolve(toRaw);

    const result = await raceApis(
      [
        `https://open.er-api.com/v6/latest/${encodeURIComponent(from)}`,
        `https://api.exchangerate-api.com/v4/latest/${encodeURIComponent(from)}`,
        `https://api.frankfurter.app/latest?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      ],
      (d) => {
        const rates = d?.rates || d?.conversion_rates;
        return rates && typeof rates[to] === 'number';
      }
    );

    if (!result.ok) {
      return sock.sendMessage(chat, {
        text: `❌ Could not fetch rates for *${from} → ${to}*.\n_Tried ${result.errors.length} sources._`,
      }, { quoted: msg });
    }

    const data = result.data;
    const rates = data.rates || data.conversion_rates;
    const rate = rates[to];
    const converted = amount * rate;
    const updated = data.time_last_update_utc || data.date || data.time_last_updated || 'just now';

    const out = [
      `💱 *currency exchange*`,
      '',
      `*${amount} ${from}*  →  *${converted.toFixed(4)} ${to}*`,
      `_1 ${from} = ${rate} ${to}_`,
      `_1 ${to} = ${(1 / rate).toFixed(6)} ${from}_`,
      '',
      `_source: ${result.source.split('?')[0].replace('https://', '')}_`,
      `_updated: ${updated}_`,
    ].join('\n');
    await sock.sendMessage(chat, { text: out }, { quoted: msg });
  } catch (e) {
    await sock.sendMessage(chat, { text: `⚠️ currency failed: ${e.message}` }, { quoted: msg }).catch(() => {});
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// .qr <text> | .qr read   (reply to a QR image)
// ─────────────────────────────────────────────────────────────────────────────
export async function qrCommand(sock, chat, msg, args) {
  try {
    const a0 = (args?.[0] || '').toLowerCase();
    const sub = a0 === 'read' ? 'read' : 'generate';

    if (sub === 'read') {
      const media = await downloadQuotedMedia(msg).catch(() => null);
      if (!media || media.kind !== 'image') {
        return sock.sendMessage(chat, { text: '❌ Reply to a QR image with `.qr read`.' }, { quoted: msg });
      }
      const form = new FormData();
      form.append('file', new Blob([media.buffer], { type: media.mimetype }), 'qr.png');
      const res = await fetch('https://api.qrserver.com/v1/read-qr-code/', { method: 'POST', body: form });
      if (!res.ok) throw new Error(`QR read HTTP ${res.status}`);
      const data = await res.json();
      const decoded = data?.[0]?.symbol?.[0]?.data;
      if (!decoded) {
        return sock.sendMessage(chat, { text: '❌ No QR detected in that image.' }, { quoted: msg });
      }
      return sendChunked(sock, chat, msg, `🔍 *QR decoded*\n\n\`\`\`\n${decoded}\n\`\`\``);
    }

    const text = (args || []).join(' ').trim();
    if (!text) {
      return sock.sendMessage(chat, {
        text: '📱 *qr*\n\n`.qr <text>` — generate QR\n`.qr read` — reply to a QR image to decode it',
      }, { quoted: msg });
    }
    const urls = [
      `https://api.qrserver.com/v1/create-qr-code/?size=600x600&data=${encodeURIComponent(text)}`,
      `https://quickchart.io/qr?size=600&text=${encodeURIComponent(text)}`,
    ];
    const out = await withTempFile('qr.png', async (dest) => {
      let lastErr;
      for (const u of urls) {
        try {
          await downloadToFile(u, dest, 5 * 1024 * 1024);
          return dest;
        } catch (e) { lastErr = e; }
      }
      throw lastErr || new Error('QR generation failed');
    });
    await sock.sendMessage(chat, {
      image: fs.readFileSync(out),
      caption: `📱 QR for: _${text.slice(0, 80)}${text.length > 80 ? '…' : ''}_`,
    }, { quoted: msg });
  } catch (e) {
    await sock.sendMessage(chat, { text: `⚠️ qr failed: ${e.message}` }, { quoted: msg }).catch(() => {});
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// .define <word>
// ─────────────────────────────────────────────────────────────────────────────
export async function defineCommand(sock, chat, msg, args) {
  try {
    const word = (args || []).join(' ').trim();
    if (!word) {
      return sock.sendMessage(chat, { text: '📖 *define*\n\nUsage: `.define <word>`' }, { quoted: msg });
    }

    const result = await raceApis(
      [
        `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`,
        `https://api.dictionaryapi.dev/api/v2/entries/en_US/${encodeURIComponent(word)}`,
      ],
      (d) => Array.isArray(d) && d.length > 0 && d[0].meanings
    );

    let lines = [];
    if (result.ok) {
      const entry = result.data[0];
      lines.push(`📖 *${entry.word}*${entry.phonetic ? `  _${entry.phonetic}_` : ''}`);
      lines.push('');
      let n = 0;
      for (const meaning of (entry.meanings || []).slice(0, 4)) {
        lines.push(`*${meaning.partOfSpeech}*`);
        for (const def of (meaning.definitions || []).slice(0, 3)) {
          n++;
          lines.push(`${n}. ${def.definition}`);
          if (def.example) lines.push(`   _e.g. ${def.example}_`);
        }
        lines.push('');
      }
      const syns = entry.meanings.flatMap((m) => m.definitions.flatMap((d) => d.synonyms || [])).slice(0, 10);
      if (syns.length) lines.push(`_synonyms:_ ${syns.join(', ')}`);
    } else {
      // Fallback: Wiktionary
      try {
        const wk = await httpGetJson(`https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(word)}`);
        const defs = wk?.en?.[0]?.definitions || [];
        if (defs.length) {
          lines.push(`📖 *${word}*  _(Wiktionary)_`);
          lines.push('');
          defs.slice(0, 5).forEach((d, i) => lines.push(`${i + 1}. ${d.definition.replace(/<[^>]+>/g, '')}`));
        }
      } catch {}
    }

    if (!lines.length) {
      return sock.sendMessage(chat, { text: `❌ No definition found for *${word}*.` }, { quoted: msg });
    }
    await sendChunked(sock, chat, msg, lines.join('\n'));
  } catch (e) {
    await sock.sendMessage(chat, { text: `⚠️ define failed: ${e.message}` }, { quoted: msg }).catch(() => {});
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// .weather <city>  — warns if rain/storm probability > 50%
// ─────────────────────────────────────────────────────────────────────────────
const STORM_CODES = new Set([95, 96, 99]);
const RAIN_CODES = new Set([61, 63, 65, 80, 81, 82, 66, 67]);
function codeLabel(c) {
  if (STORM_CODES.has(c)) return '⛈️ thunderstorm';
  if (RAIN_CODES.has(c)) return '🌧️ rain';
  if (c === 71 || c === 73 || c === 75 || c === 77 || c === 85 || c === 86) return '❄️ snow';
  if (c === 45 || c === 48) return '🌫️ fog';
  if (c === 0) return '☀️ clear';
  if (c <= 3) return '🌤️ partly cloudy';
  return '☁️ cloudy';
}

export async function weatherCommand(sock, chat, msg, args) {
  try {
    const city = (args || []).join(' ').trim();
    if (!city) {
      return sock.sendMessage(chat, { text: '🌦️ *weather*\n\nUsage: `.weather <city>`\nWarns you if rain/storm probability is above 50% in the next few days.' }, { quoted: msg });
    }

    // Geocode
    let lat = null, lon = null, label = city;
    try {
      const geo = await httpGetJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`);
      const r = geo?.results?.[0];
      if (r) { lat = r.latitude; lon = r.longitude; label = `${r.name}, ${r.country || ''}`.trim(); }
    } catch {}

    let forecastLines = [];
    let warned = false;

    if (lat !== null && lon !== null) {
      const fc = await httpGetJson(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
        `&daily=precipitation_probability_max,weathercode,temperature_2m_max,temperature_2m_min` +
        `&timezone=auto&forecast_days=5`
      );
      const d = fc?.daily;
      if (d?.time) {
        forecastLines.push(`🌦️ *${label}* — next ${d.time.length} days`);
        forecastLines.push('');
        for (let i = 0; i < d.time.length; i++) {
          const date = d.time[i];
          const pop = d.precipitation_probability_max?.[i] ?? 0;
          const wc = d.weathercode?.[i] ?? 0;
          const tmax = d.temperature_2m_max?.[i];
          const tmin = d.temperature_2m_min?.[i];
          const warn = pop >= 50 || STORM_CODES.has(wc) ? ' ⚠️' : '';
          if (pop >= 50 || STORM_CODES.has(wc)) warned = true;
          forecastLines.push(`• ${date} — ${codeLabel(wc)}${warn}`);
          forecastLines.push(`   rain ${pop}% · ${tmin}°C – ${tmax}°C`);
        }
      }
    }

    if (!forecastLines.length) {
      // Fallback: wttr.in
      try {
        const w = await httpGetJson(`https://wttr.in/${encodeURIComponent(city)}?format=j1`);
        const cur = w?.current_condition?.[0];
        if (cur) {
          label = w.nearest_area?.[0]?.areaName?.[0]?.value || city;
          forecastLines.push(`🌦️ *${label}* — current`);
          forecastLines.push('');
          forecastLines.push(`• temp · ${cur.temp_C}°C (feels ${cur.FeelsLikeC}°C)`);
          forecastLines.push(`• weather · ${cur.weatherDesc?.[0]?.value || '—'}`);
          forecastLines.push(`• humidity · ${cur.humidity}%`);
          forecastLines.push(`• wind · ${cur.windspeedKmph} km/h`);
        }
      } catch {}
    }

    if (!forecastLines.length) {
      return sock.sendMessage(chat, { text: `❌ Could not fetch weather for *${city}*.` }, { quoted: msg });
    }

    const header = warned
      ? '⚠️ *WEATHER WARNING* — rain/storm probability above 50% detected.\n'
      : '✅ *weather check* — no heavy rain/storm expected above 50%.\n';

    await sendChunked(sock, chat, msg, header + '\n' + forecastLines.join('\n'));
  } catch (e) {
    await sock.sendMessage(chat, { text: `⚠️ weather failed: ${e.message}` }, { quoted: msg }).catch(() => {});
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// .pwned <password>   — HIBP k-anonymity check
// ─────────────────────────────────────────────────────────────────────────────
export async function pwnedCommand(sock, chat, msg, args) {
  try {
    const pwd = (args || []).join(' ').trim();
    if (!pwd) {
      return sock.sendMessage(chat, { text: '🔐 *pwned*\n\nUsage: `.pwned <password>`\nChecks Have I Been Pwned via k-anonymity (your password never leaves this device).' }, { quoted: msg });
    }
    const sha1 = crypto.createHash('sha1').update(pwd).digest('hex').toUpperCase();
    const prefix = sha1.slice(0, 5);
    const suffix = sha1.slice(5);

    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { 'User-Agent': 'WRAITH-Bot/1.0' },
    });
    if (!res.ok) throw new Error(`HIBP HTTP ${res.status}`);
    const body = await res.text();
    const line = body.split('\n').find((l) => l.startsWith(suffix));
    const count = line ? parseInt(line.split(':')[1], 10) : 0;

    if (count > 0) {
      await sock.sendMessage(chat, {
        text: `🚨 *PWNED*\n\nThat password has appeared in *${count.toLocaleString()}* data breaches.\n\n_Change it immediately — especially if you reuse it._`,
      }, { quoted: msg });
    } else {
      await sock.sendMessage(chat, {
        text: `✅ *SAFE*\n\nThat password was not found in any known breach.\n\n_Tip: still use a password manager and 2FA._`,
      }, { quoted: msg });
    }
  } catch (e) {
    await sock.sendMessage(chat, { text: `⚠️ pwned check failed: ${e.message}` }, { quoted: msg }).catch(() => {});
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// .owner — send owner's contact card
// ─────────────────────────────────────────────────────────────────────────────
export async function ownerCommand(sock, chat, msg) {
  try {
    if (!CONFIG.owner) {
      return sock.sendMessage(chat, { text: '❌ Owner not configured.' }, { quoted: msg });
    }
    const digits = CONFIG.owner.replace(/\D/g, '');
    const vcard = [
      'BEGIN:VCARD',
      'VERSION:3.0',
      `FN:${CONFIG.codename || 'WRAITH'} Owner`,
      `TEL;type=CELL;type=VOICE;waid=${digits}:+${digits}`,
      `NOTE:${CONFIG.botName || 'WRAITH'} owner`,
      'END:VCARD',
    ].join('\n');

    await sock.sendMessage(chat, {
      contacts: {
        displayName: `${CONFIG.codename || 'WRAITH'} Owner`,
        contacts: [{ vcard }],
      },
    }, { quoted: msg });
  } catch (e) {
    await sock.sendMessage(chat, { text: `⚠️ owner card failed: ${e.message}` }, { quoted: msg }).catch(() => {});
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// .script / .repo — return the repo URL
// ─────────────────────────────────────────────────────────────────────────────
export async function scriptCommand(sock, chat, msg) {
  try {
    const url = CONFIG.repoUrl || 'https://github.com/themalik-g/wraith';
    await sock.sendMessage(chat, {
      text: `📦 *WRAITH*\n\n_${CONFIG.codename || 'WRAITH'} v${CONFIG.version || ''} — a silent watcher for WhatsApp._\n\n${url}`,
    }, { quoted: msg });
  } catch (e) {
    await sock.sendMessage(chat, { text: `⚠️ script failed: ${e.message}` }, { quoted: msg }).catch(() => {});
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// .mode  (owner only) — show / set public|private
// ─────────────────────────────────────────────────────────────────────────────
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
        ? '🌐 *Public mode enabled.*\nEveryone can use non-critical commands.\nOwner-only commands (ghost/peek/lurk/schedule/admin/stalk/mode/…) still require owner.'
        : '🔒 *Private mode enabled.*\nOnly the owner can use any command now.',
    }, { quoted: msg });
  } catch (e) {
    await sock.sendMessage(chat, { text: `⚠️ mode failed: ${e.message}` }, { quoted: msg }).catch(() => {});
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Presence tracker (feature #12 backbone) + .stalk command
// Attach once from the router. Records presence transitions for subscribed JIDs.
// ─────────────────────────────────────────────────────────────────────────────
const MAX_EVENTS_PER_JID = 500;

function readPresence() { return readJson(PRESENCE_FILE, {}); }
function writePresence(o) { writeJsonAtomic(PRESENCE_FILE, o); }

export function attachPresenceTracker(sock) {
  sock.ev.on('presence.update', ({ id, presences }) => {
    try {
      if (!id || !presences) return;
      const store = readPresence();
      const now = Date.now();
      for (const [jid, p] of Object.entries(presences)) {
        if (!p?.lastKnownPresence) continue;
        if (!store[jid]) store[jid] = { events: [], onlineCount: 0, totalOnlineMs: 0, lastChange: 0 };
        const rec = store[jid];
        const status = p.lastKnownPresence; // 'available' | 'unavailable' | 'composing' | 'recording' | 'paused'
        const last = rec.events[rec.events.length - 1];
        if (last && last.status === status && now - last.time < 1000) continue;
        if (status === 'available' && (!last || last.status !== 'available')) rec.onlineCount += 1;
        if (last && last.status === 'available' && status !== 'available') rec.totalOnlineMs += now - last.time;
        rec.events.push({ time: now, status });
        if (rec.events.length > MAX_EVENTS_PER_JID) rec.events.splice(0, rec.events.length - MAX_EVENTS_PER_JID);
        rec.lastChange = now;
      }
      writePresence(store);
    } catch (e) {
      if (process.env.WRAITH_DEBUG === '1') console.log('[presence-track]', e.message);
    }
  });
}

export async function stalkCommand(sock, chat, msg, args) {
  if (ownerOnly(sock, chat, msg)) return;
  try {
    const a0 = (args?.[0] || '').toLowerCase();

    if (a0 === 'list') {
      const store = readPresence();
      const keys = Object.keys(store);
      if (!keys.length) return sock.sendMessage(chat, { text: ' No stalking data yet. Use `.stalk <number>` first.' }, { quoted: msg });
      const lines = [`👁️ *stalked contacts* · ${keys.length}`, ''];
      for (const jid of keys.slice(0, 30)) {
        const r = store[jid];
        lines.push(`• \`${jid.split('@')[0]}\` — ${r.onlineCount} online sessions`);
      }
      return sendChunked(sock, chat, msg, lines.join('\n'));
    }

    // Resolve target
    let targetJid = null;
    const ctx = msg.message?.extendedTextMessage?.contextInfo;
    if (ctx?.participant) {
      targetJid = ctx.participant;
    } else if (args?.[0]) {
      const digits = args[0].replace(/\D/g, '');
      if (digits.length >= 7) {
        try {
          const wa = await sock.onWhatsApp(digits);
          targetJid = wa?.[0]?.jid || `${digits}@s.whatsapp.net`;
        } catch { targetJid = `${digits}@s.whatsapp.net`; }
      }
    }
    if (!targetJid) {
      return sock.sendMessage(chat, { text: '👁️ *stalk*\n\nUsage: `.stalk <number>` or reply to a message with `.stalk`\n`.stalk list` — show all tracked contacts' }, { quoted: msg });
    }

    // Subscribe to presence
    try { await sock.presenceSubscribe(targetJid); } catch (e) {
      return sock.sendMessage(chat, { text: `❌ Could not subscribe to presence for \`${targetJid.split('@')[0]}\`.\n_They may have "Last Seen" hidden._` }, { quoted: msg });
    }

    // Give the tracker a moment, then show stats
    await new Promise((r) => setTimeout(r, 1500));
    const store = readPresence();
    const rec = store[targetJid];
    if (!rec || !rec.events.length) {
      return sock.sendMessage(chat, { text: `👁️ Now tracking \`${targetJid.split('@')[0]}\`.\n\n_No presence events recorded yet. WhatsApp only sends these if the user has "Last Seen" visible. Try again in a few minutes._` }, { quoted: msg });
    }

    const last = rec.events[rec.events.length - 1];
    const first = rec.events[0];
    const totalHrs = (rec.totalOnlineMs / 3_600_000).toFixed(2);
    const lines = [
      `👁️ *stalk* · \`${targetJid.split('@')[0]}\``,
      '',
      `• first seen · ${new Date(first.time).toLocaleString('en-GB', { timeZone: CONFIG.timezone || 'Asia/Karachi' })}`,
      `• last change · ${new Date(last.time).toLocaleString('en-GB', { timeZone: CONFIG.timezone || 'Asia/Karachi' })}`,
      `• current status · *${last.status}*`,
      `• online sessions · ${rec.onlineCount}`,
      `• total online time · ${totalHrs} h`,
      `• events recorded · ${rec.events.length}`,
      '',
      `_tracking continues in the background while the bot is running._`,
    ];
    await sendChunked(sock, chat, msg, lines.join('\n'));
  } catch (e) {
    await sock.sendMessage(chat, { text: `⚠️ stalk failed: ${e.message}` }, { quoted: msg }).catch(() => {});
  }
}
