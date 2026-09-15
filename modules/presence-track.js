// ─────────────────────────────────────────────
// WRAITH · modules/presence-track.js
// Phase 5: Stalk feature + presence tracking
// ─────────────────────────────────────────────
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isOwner } from '../core/identity.js';
import { readJson, writeJsonAtomic } from '../core/state-io.js';
import { CONFIG } from '../config.js';
import { chunkText } from '../lib/net.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PRESENCE_FILE = path.join(here, '..', 'state', 'presence-track.json');

function readStore() { return readJson(PRESENCE_FILE, {}); }
function writeStore(o) { writeJsonAtomic(PRESENCE_FILE, o); }

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

export function attachPresenceTracker(sock) {
  sock.ev.on('presence.update', ({ id, presences }) => {
    try {
      if (!id || !presences) return;
      const store = readStore();
      const now = Date.now();
      const maxEvents = CONFIG.stalk?.maxEventsPerJid || 500;

      for (const [jid, p] of Object.entries(presences)) {
        if (!p?.lastKnownPresence) continue;
        if (!store[jid]) store[jid] = { events: [], onlineCount: 0, totalOnlineMs: 0, lastChange: 0, subscribed: true };
        const rec = store[jid];
        // ★ FIX: `.stalk stop` now genuinely pauses recording for this contact
        if (rec.subscribed === false) continue;
        const status = p.lastKnownPresence;
        const last = rec.events[rec.events.length - 1];
        if (last && last.status === status && now - last.time < 1000) continue;

        if (status === 'available' && (!last || last.status !== 'available')) rec.onlineCount += 1;
        if (last && last.status === 'available' && status !== 'available') rec.totalOnlineMs += now - last.time;

        rec.events.push({ time: now, status });
        if (rec.events.length > maxEvents) rec.events.splice(0, rec.events.length - maxEvents);
        rec.lastChange = now;
      }
      writeStore(store);
    } catch (e) {
      if (process.env.WRAITH_DEBUG === '1') console.log('[presence-track]', e.message);
    }
  });
}

// ── .stalk ──────────────────────────────────────────────────────────────────
export async function stalkCommand(sock, chat, msg, args) {
  if (ownerOnly(sock, chat, msg)) return;
  try {
    const a0 = (args?.[0] || '').toLowerCase();

    if (a0 === 'list') {
      const store = readStore();
      const keys = Object.keys(store);
      if (!keys.length) return sock.sendMessage(chat, { text: '👁️ No stalking data yet.' }, { quoted: msg });
      const lines = [`👁️ *stalked contacts* · ${keys.length}`, ''];
      for (const jid of keys.slice(0, 30)) {
        const r = store[jid];
        const state = r.subscribed === false ? ' · ⏸️ paused' : '';
        lines.push(`• \`${jid.split('@')[0]}\` — ${r.onlineCount} online sessions${state}`);
      }
      return sendChunked(sock, chat, msg, lines.join('\n'));
    }

    if (a0 === 'stop') {
      const digits = (args?.[1] || '').replace(/\D/g, '');
      if (!digits) return sock.sendMessage(chat, { text: '❌ Usage: `.stalk stop <number>`' }, { quoted: msg });
      const store = readStore();
      let stopped = false;
      for (const jid of Object.keys(store)) {
        if (jid.replace(/\D/g, '').includes(digits)) {
          store[jid].subscribed = false; // ★ FIX: tracker now honours this flag
          stopped = true;
        }
      }
      if (stopped) writeStore(store);
      return sock.sendMessage(chat, { text: stopped ? `👁️ Stopped tracking \`${digits}\`.` : `❌ \`${digits}\` was not being tracked.` }, { quoted: msg });
    }

    // Resolve target
    let targetJid = null;
    const ctx = msg.message?.extendedTextMessage?.contextInfo;
    if (ctx?.participant) targetJid = ctx.participant;
    else if (args?.[0]) {
      const digits = args[0].replace(/\D/g, '');
      if (digits.length >= 7) {
        try { const wa = await sock.onWhatsApp(digits); targetJid = wa?.[0]?.jid || `${digits}@s.whatsapp.net`; }
        catch { targetJid = `${digits}@s.whatsapp.net`; }
      }
    }
    if (!targetJid) {
      return sock.sendMessage(chat, { text: '👁️ *stalk*\n\nUsage: `.stalk <number>` or reply to a message\n`.stalk list` — show tracked\n`.stalk stop <number>` — stop tracking' }, { quoted: msg });
    }

    try { await sock.presenceSubscribe(targetJid); } catch (e) {
      return sock.sendMessage(chat, { text: `❌ Could not subscribe to presence for \`${targetJid.split('@')[0]}\`.\n_They may have "Last Seen" hidden._` }, { quoted: msg });
    }

    // ★ FIX: re-activate tracking when the owner stalks a paused contact again
    const store = readStore();
    if (store[targetJid]) {
      store[targetJid].subscribed = true;
      writeStore(store);
    }

    await new Promise((r) => setTimeout(r, 1500));
    const rec = readStore()[targetJid];
    if (!rec || !rec.events.length) {
      return sock.sendMessage(chat, { text: `👁️ Now tracking \`${targetJid.split('@')[0]}\`.\n\n_No presence events yet. WhatsApp only sends these if the user has "Last Seen" visible._` }, { quoted: msg });
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
      '_tracking continues in background while bot runs._',
    ];
    await sendChunked(sock, chat, msg, lines.join('\n'));
  } catch (e) {
    await sock.sendMessage(chat, { text: `⚠️ stalk failed: ${e.message}` }, { quoted: msg }).catch(() => {});
  }
}
