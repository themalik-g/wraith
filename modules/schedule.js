// ─────────────────────────────────────────────
//  WRAITH · modules/schedule.js
//  Scan-based date/time parser — works with LIDs.
// ─────────────────────────────────────────────
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { isOwner } from '../core/identity.js';
import { stripDevice } from '../core/jid-resolver.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const STATE = path.join(here, '..', 'state', 'schedule.json');
const DEBUG = process.env.WRAITH_DEBUG === '1';

fs.mkdirSync(path.dirname(STATE), { recursive: true });

function read() {
    try {
        if (!fs.existsSync(STATE)) return [];
        return JSON.parse(fs.readFileSync(STATE, 'utf-8'));
    } catch { return []; }
}

function write(arr) {
    try { fs.writeFileSync(STATE, JSON.stringify(arr, null, 2)); } catch {}
}

// ─────────────────────────────────────────────
//  Scan-based date/time parser
// ─────────────────────────────────────────────
function parseDateTime(tokens) {
    if (tokens.length < 4) {
        return { ok: false, error: 'Missing date/time. Need: `dd,mm,yy hour minute am/pm`' };
    }

    let dateIdx = -1;
    let day, month, year;
    let dateTokensUsed = 0;

    // Scan for combined date token (e.g. "11,09,26" or "11/09/26" or "11-09-26")
    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        if (/^\d{1,2}[,\/\-]\d{1,2}[,\/\-]\d{2,4}$/.test(t)) {
            const parts = t.split(/[,\/\-]/).map(Number);
            [day, month, year] = parts;
            dateIdx = i;
            dateTokensUsed = 1;
            break;
        }
    }

    // Fallback: 3 consecutive numeric tokens
    if (dateIdx === -1) {
        for (let i = 0; i < tokens.length - 2; i++) {
            const a = tokens[i], b = tokens[i + 1], c = tokens[i + 2];
            if (/^\d{1,2}$/.test(a) && /^\d{1,2}$/.test(b) && /^\d{2,4}$/.test(c)) {
                day = Number(a); month = Number(b); year = Number(c);
                dateIdx = i;
                dateTokensUsed = 3;
                break;
            }
        }
    }

    if (dateIdx === -1) {
        return { ok: false, error: 'Could not find a date. Use `dd,mm,yy` (e.g. `25,12,26`).' };
    }

    if (day < 1 || day > 31) return { ok: false, error: `Invalid day: ${day}. Must be 1–31.` };
    if (month < 1 || month > 12) return { ok: false, error: `Invalid month: ${month}. Must be 1–12.` };
    if (year < 2026 || year > 2100) return { ok: false, error: `Invalid year: ${year}. Must be 2026–2100.` };

    const timeIdx = dateIdx + dateTokensUsed;
    const timeTokens = tokens.slice(timeIdx, timeIdx + 3);

    if (timeTokens.length < 3) {
        return { ok: false, error: 'Missing time. Need: `hour minute am/pm` after the date.' };
    }

    const [hStr, mStr, ap] = timeTokens;
    const hour = Number(hStr);
    const minute = Number(mStr);
    const ampm = (ap || '').toLowerCase();

    if (isNaN(hour) || hour < 1 || hour > 12) return { ok: false, error: `Invalid hour: ${hStr}. Must be 1–12.` };
    if (isNaN(minute) || minute < 0 || minute > 59) return { ok: false, error: `Invalid minute: ${mStr}. Must be 0–59.` };
    if (ampm !== 'am' && ampm !== 'pm') return { ok: false, error: `Invalid am/pm: "${ap}". Must be "am" or "pm".` };

    let h24 = hour % 12;
    if (ampm === 'pm') h24 += 12;

    const date = new Date(year, month - 1, day, h24, minute, 0);
    if (isNaN(date.getTime())) return { ok: false, error: 'Could not construct a valid date.' };
    if (date.getTime() <= Date.now()) return { ok: false, error: 'That time is in the past. Pick a future date/time.' };

    return { ok: true, date, dateIdx, dateTokensUsed };
}

// ─────────────────────────────────────────────
//  Target resolver
// ─────────────────────────────────────────────
async function resolveTarget(sock, raw) {
    if (!raw) return null;
    const clean = raw.trim();

    if (clean.includes('@')) {
        if (clean.endsWith('@newsletter')) return { jid: clean, type: 'newsletter' };
        if (clean.endsWith('@g.us')) return { jid: clean, type: 'group' };
        if (clean.endsWith('@s.whatsapp.net')) return { jid: stripDevice(clean), type: 'user' };
        if (clean.endsWith('@lid')) {
            try {
                const pn = await sock.signalRepository?.lidMapping?.getPNForLID?.(stripDevice(clean));
                if (pn) return { jid: pn, type: 'user' };
            } catch {}
            return { jid: stripDevice(clean), type: 'lid' };
        }
        if (clean.startsWith('@')) {
            const username = clean.slice(1);
            if (typeof sock.findUserByUsername === 'function') {
                try {
                    const user = await sock.findUserByUsername(username);
                    if (user?.jid) return { jid: user.jid, type: 'user' };
                } catch {}
            }
            try {
                const wa = await sock.onWhatsApp(username);
                if (wa?.[0]?.jid) return { jid: wa[0].jid, type: 'user' };
            } catch {}
            return null;
        }
        return { jid: clean, type: 'unknown' };
    }

    if (clean.startsWith('@')) {
        const username = clean.slice(1);
        if (typeof sock.findUserByUsername === 'function') {
            try {
                const user = await sock.findUserByUsername(username);
                if (user?.jid) return { jid: user.jid, type: 'user' };
            } catch {}
        }
        try {
            const wa = await sock.onWhatsApp(username);
            if (wa?.[0]?.jid) return { jid: wa[0].jid, type: 'user' };
        } catch {}
        return null;
    }

    const digits = clean.replace(/\D/g, '');
    if (digits.length >= 7) {
        try {
            const wa = await sock.onWhatsApp(digits);
            if (wa?.[0]?.jid) return { jid: wa[0].jid, type: 'user' };
        } catch {}
        return { jid: digits + '@s.whatsapp.net', type: 'user' };
    }

    return null;
}

// ─────────────────────────────────────────────
//  .schedule — command
// ─────────────────────────────────────────────
export async function scheduleCommand(sock, chat, msg, args) {
    const from = msg.key.participant || msg.key.remoteJid;

    if (!msg.key.fromMe && !isOwner(from)) {
        return sock.sendMessage(chat, { text: '⛔ Owner only.' }, { quoted: msg });
    }

    if (!args || args.length === 0) {
        return sock.sendMessage(chat, {
            text:
                `📅 *schedule* — send a message later\n\n` +
                `*Usage:*\n` +
                `  _.schedule <message> <target> dd,mm,yy hour minute am/pm_\n` +
                `  _.schedule <target> dd,mm,yy hour minute am/pm_  (replied message)\n\n` +
                `*Target:* phone number · @username · JID · newsletter JID\n\n` +
                `*Examples:*\n` +
                `  _.schedule Hey! 923001234567 25,12,26 10 30 am_\n` +
                `  _.schedule 25,12,26 10 30 am_  (reply to a message)`
        }, { quoted: msg });
    }

    const dt = parseDateTime(args);

    if (!dt.ok) {
        return sock.sendMessage(chat, {
            text: `❌ ${dt.error}\n\nYou gave: \`${args.join(' ')}\`\n\nType _.schedule_ for full help.`
        }, { quoted: msg });
    }

    const beforeDateTime = args.slice(0, dt.dateIdx);

    const ctx = msg.message?.extendedTextMessage?.contextInfo;
    const hasQuote = !!ctx?.quotedMessage;

    let messageText = '';
    let targetRaw = '';

    if (hasQuote) {
        messageText = ctx.quotedMessage?.conversation ||
                      ctx.quotedMessage?.extendedTextMessage?.text ||
                      ctx.quotedMessage?.imageMessage?.caption ||
                      ctx.quotedMessage?.videoMessage?.caption ||
                      '[media message]';
        targetRaw = beforeDateTime.join(' ').trim();
    } else {
        if (beforeDateTime.length < 2) {
            return sock.sendMessage(chat, {
                text: `❌ Missing message and/or target.\n\nUse: _.schedule <message> <target> dd,mm,yy hour minute am/pm_\nOr reply: _.schedule <target> dd,mm,yy hour minute am/pm_`
            }, { quoted: msg });
        }
        targetRaw = beforeDateTime[beforeDateTime.length - 1];
        messageText = beforeDateTime.slice(0, -1).join(' ');
    }

    if (!targetRaw) {
        return sock.sendMessage(chat, {
            text: `❌ Missing target. Use: phone number, @username, JID, or newsletter JID.`
        }, { quoted: msg });
    }

    if (!messageText || messageText.trim() === '') {
        return sock.sendMessage(chat, {
            text: `❌ Missing message text. Provide a message before the target, or reply to a message.`
        }, { quoted: msg });
    }

    const target = await resolveTarget(sock, targetRaw);
    if (!target) {
        return sock.sendMessage(chat, {
            text: `❌ Could not resolve target: \`${targetRaw}\``
        }, { quoted: msg });
    }

    const schedules = read();
    const entry = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        message: messageText.trim(),
        targetJid: target.jid,
        targetType: target.type,
        sendAt: dt.date.getTime(),
        createdAt: Date.now(),
        createdBy: from
    };

    schedules.push(entry);
    write(schedules);

    const stamp = dt.date.toLocaleString('en-GB', {
        hour12: true, day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });

    await sock.sendMessage(chat, {
        text:
            `📅 *scheduled*\n\n` +
            `*to ·* ${target.jid.split('@')[0]}\n` +
            `*when ·* ${stamp}\n` +
            `*message ·* ${messageText.trim().slice(0, 200)}${messageText.length > 200 ? '…' : ''}\n\n` +
            `_ID: ${entry.id}_`
    }, { quoted: msg });
}

// ─────────────────────────────────────────────
//  Scheduler loop
// ─────────────────────────────────────────────
let schedulerTimer = null;

export function startScheduler(sock) {
    if (schedulerTimer) clearInterval(schedulerTimer);

    schedulerTimer = setInterval(async () => {
        try {
            const schedules = read();
            if (schedules.length === 0) return;

            const now = Date.now();
            const remaining = [];

            for (const entry of schedules) {
                if (entry.sendAt <= now) {
                    try {
                        await sock.sendMessage(entry.targetJid, { text: entry.message });
                        if (DEBUG) console.log(`[schedule] sent ${entry.id} to ${entry.targetJid}`);
                    } catch (e) {
                        console.error(`[schedule] failed to send ${entry.id}:`, e.message);
                    }
                } else {
                    remaining.push(entry);
                }
            }

            if (remaining.length !== schedules.length) write(remaining);
        } catch (e) {
            console.error('[schedule] loop error:', e.message);
        }
    }, 30_000);
        }
