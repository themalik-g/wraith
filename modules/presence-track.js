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

function tz() { return CONFIG.timezone || 'Asia/Karachi'; }
function fmt(ms) { return new Date(ms).toLocaleString('en-GB', { timeZone: tz() }); }
function fmtTime(ms) { return new Date(ms).toLocaleTimeString('en-GB', { timeZone: tz() }); }
function dur(ms) {
    const m = Math.round(ms / 60000);
    if (m < 60) return `${m}m`;
    return `${Math.floor(m / 60)}h ${m % 60}m`;
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

// Build a list of online→offline sessions (most recent last)
function buildSessions(events) {
    const sessions = [];
    let start = null;
    for (const e of events) {
        if (e.status === 'available') { if (!start) start = e.time; }
        else if (start) { sessions.push({ start, end: e.time }); start = null; }
    }
    if (start) sessions.push({ start, end: null }); // still online
    return sessions;
}

// ── .stalk ──────────────────────────────────────────────────────────────────
export async function stalkCommand(sock, chat, msg, args) {
    if (ownerOnly(sock, chat, msg)) return;
    try {
        const a0 = (args?.[0] || '').toLowerCase();

        // ★ FIX: list now shows EXACT dates/times, not just session counts
        if (a0 === 'list') {
            const store = readStore();
            const keys = Object.keys(store);
            if (!keys.length) return sock.sendMessage(chat, { text: '👁️ No stalking data yet.' }, { quoted: msg });
            const lines = [`👁️ *stalked contacts* · ${keys.length}`, ''];
            for (const jid of keys.slice(0, 30)) {
                const r = store[jid];
                const last = r.events?.[r.events.length - 1];
                const sessions = buildSessions(r.events || []);
                const lastSess = sessions[sessions.length - 1];
                const state = r.subscribed === false ? ' · ⏸️ paused' : '';
                lines.push(`• \`${jid.split('@')[0]}\`${state}`);
                lines.push(`   ${r.onlineCount} sessions · ${(r.totalOnlineMs / 3_600_000).toFixed(1)}h total online`);
                if (last) lines.push(`   last change · *${last.status}* at ${fmt(last.time)}`);
                if (lastSess) {
                    if (lastSess.end) lines.push(`   last online · ${fmt(lastSess.start)} → offline ${fmtTime(lastSess.end)} (${dur(lastSess.end - lastSess.start)})`);
                    else lines.push(`   🟢 online RIGHT NOW · since ${fmt(lastSess.start)}`);
                }
            }
            lines.push('', `_Times in ${tz()}_`);
            return sendChunked(sock, chat, msg, lines.join('\n'));
        }

        if (a0 === 'stop') {
            const digits = (args?.[1] || '').replace(/\D/g, '');
            if (!digits) return sock.sendMessage(chat, { text: '❌ Usage: `.stalk stop <number>`' }, { quoted: msg });
            const store = readStore();
            let stopped = false;
            for (const jid of Object.keys(store)) {
                if (jid.replace(/\D/g, '').includes(digits)) { store[jid].subscribed = false; stopped = true; }
            }
            if (stopped) writeStore(store);
            return sock.sendMessage(chat, { text: stopped ? `👁️ Stopped tracking \`${digits}\`.` : `❌ \`${digits}\` was not being tracked.` }, { quoted: msg });
        }

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

        try { await sock.presenceSubscribe(targetJid); } catch {
            return sock.sendMessage(chat, { text: `❌ Could not subscribe to presence for \`${targetJid.split('@')[0]}\`.\n_They may have "Last Seen" hidden._` }, { quoted: msg });
        }

        const store = readStore();
        if (store[targetJid]) { store[targetJid].subscribed = true; writeStore(store); }

        await new Promise((r) => setTimeout(r, 1500));
        const rec = readStore()[targetJid];
        if (!rec || !rec.events.length) {
            return sock.sendMessage(chat, { text: `👁️ Now tracking \`${targetJid.split('@')[0]}\`.\n\n_No presence events yet. WhatsApp only sends these if the user has "Last Seen" visible._` }, { quoted: msg });
        }

        const last = rec.events[rec.events.length - 1];
        const first = rec.events[0];
        const sessions = buildSessions(rec.events);
        const lines = [
            `👁️ *stalk* · \`${targetJid.split('@')[0]}\``, '',
            `• tracking since · ${fmt(first.time)}`,
            `• last change · *${last.status}* at ${fmt(last.time)}`,
            `• online sessions · ${rec.onlineCount}`,
            `• total online time · ${dur(rec.totalOnlineMs)}`,
            '',
            `*recent sessions* (newest last) · _${tz()}_`,
        ];
        const recent = sessions.slice(-8);
        if (!recent.length) lines.push('_no complete sessions recorded yet_');
        for (const s of recent) {
            if (s.end) lines.push(`🟢 ${fmtTime(s.start)} → ⚪ ${fmtTime(s.end)} · ${dur(s.end - s.start)}`);
            else lines.push(`🟢 ${fmt(s.start)} → *online now*`);
        }
        lines.push('', '_tracking continues in background while bot runs._');
        await sendChunked(sock, chat, msg, lines.join('\n'));
    } catch (e) {
        await sock.sendMessage(chat, { text: `⚠️ stalk failed: ${e.message}` }, { quoted: msg }).catch(() => {});
    }
}
