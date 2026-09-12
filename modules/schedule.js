// ─────────────────────────────────────────────
//  WRAITH · modules/schedule.js
//  Scan-based date/time parser — works with LIDs.
//  FIX #6: retries + owner notice on failure,
//          .schedule list / .schedule cancel,
//          dates interpreted in CONFIG.timezone.
// ─────────────────────────────────────────────
import path from 'path';
import { fileURLToPath } from 'url';
import { isOwner, ownerJid } from '../core/identity.js';
import { readJson, writeJsonAtomic } from '../core/state-io.js';
import { resolveTargetUniversal } from '../core/jid-resolver.js';
import { CONFIG } from '../config.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const STATE = path.join(here, '..', 'state', 'schedule.json');
const DEBUG = process.env.WRAITH_DEBUG === '1';

function read() {
    return readJson(STATE, []);
}

function write(arr) {
    writeJsonAtomic(STATE, arr);
}

// ─────────────────────────────────────────────
//  FIX #6 — interpret the wall-clock in CONFIG.timezone
//  and convert it to a real UTC timestamp.
// ─────────────────────────────────────────────
function zonedTimeToUtc({ year, month, day, h24, minute }, timeZone) {
    const utcGuess = Date.UTC(year, month - 1, day, h24, minute, 0);

    const fmt = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hour12: false,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
    });

    const parts = Object.fromEntries(
        fmt.formatToParts(new Date(utcGuess)).map(p => [p.type, p.value])
    );

    let h = parseInt(parts.hour, 10);
    if (h === 24) h = 0; // some ICU builds emit 24 for midnight

    const localAsUTC = Date.UTC(
        +parts.year, +parts.month - 1, +parts.day, h, +parts.minute, +parts.second
    );

    return new Date(utcGuess - (localAsUTC - utcGuess));
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
            if (year < 100) year += 2000;
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
                if (year < 100) year += 2000;
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

    // FIX #6 — build the instant in the configured timezone
    const date = zonedTimeToUtc(
        { year, month, day, h24, minute },
        CONFIG.timezone || 'Asia/Karachi'
    );

    if (isNaN(date.getTime())) return { ok: false, error: 'Could not construct a valid date.' };
    if (date.getTime() <= Date.now()) return { ok: false, error: 'That time is in the past. Pick a future date/time.' };

    return { ok: true, date, dateIdx, dateTokensUsed };
}

// ─────────────────────────────────────────────
//  .schedule — command
// ─────────────────────────────────────────────
export async function scheduleCommand(sock, chat, msg, args) {
    const from = msg.key.participant || msg.key.remoteJid;

    if (!msg.key.fromMe && !isOwner(from)) {
        return sock.sendMessage(chat, { text: '⛔ Owner only.' }, { quoted: msg });
    }

    const a0 = (args?.[0] || '').toLowerCase();

    // ── FIX #6: .schedule list ──
    if (a0 === 'list') {
        const schedules = read();
        if (schedules.length === 0) {
            return sock.sendMessage(chat, { text: '📅 No pending schedules.' }, { quoted: msg });
        }
        const lines = [`📅 *pending schedules* · ${schedules.length}`, ''];
        for (const e of schedules.slice(0, 20)) {
            const when = new Date(e.sendAt).toLocaleString('en-GB', {
                hour12: true, timeZone: CONFIG.timezone || 'Asia/Karachi',
                day: '2-digit', month: 'short', year: 'numeric',
                hour: '2-digit', minute: '2-digit'
            });
            lines.push(`• \`${e.id}\``);
            lines.push(`  to · ${e.targetJid.split('@')[0]}`);
            lines.push(`  at · ${when}`);
            lines.push(`  msg · ${String(e.message).slice(0, 60)}${String(e.message).length > 60 ? '…' : ''}`);
        }
        return sock.sendMessage(chat, { text: lines.join('\n') }, { quoted: msg });
    }

    // ── FIX #6: .schedule cancel <id> ──
    if (a0 === 'cancel' || a0 === 'delete' || a0 === 'del') {
        const id = (args?.[1] || '').trim();
        if (!id) {
            return sock.sendMessage(chat, { text: '❌ Usage: `.schedule cancel <id>`' }, { quoted: msg });
        }
        const schedules = read();
        const remaining = schedules.filter(e => e.id !== id);
        if (remaining.length === schedules.length) {
            return sock.sendMessage(chat, { text: `❌ No schedule with ID \`${id}\`. Use _.schedule list_` }, { quoted: msg });
        }
        write(remaining);
        return sock.sendMessage(chat, { text: `✅ Schedule \`${id}\` cancelled.` }, { quoted: msg });
    }

    if (!args || args.length === 0) {
        return sock.sendMessage(chat, {
            text:
                `📅 *schedule* — send a message later\n\n` +
                `*Usage:*\n` +
                `  _.schedule <message> <target> dd,mm,yy hour minute am/pm_\n` +
                `  _.schedule <target> dd,mm,yy hour minute am/pm_  (replied message)\n\n` +
                `*Manage:*\n` +
                `  _.schedule list_   — show pending schedules\n` +
                `  _.schedule cancel <id>_ — cancel one\n\n` +
                `*Target:* phone number · @username · JID · newsletter JID\n` +
                `*Timezone:* ${CONFIG.timezone || 'Asia/Karachi'}\n\n` +
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
        const qm = ctx.quotedMessage;
        messageText = qm?.conversation ||
                      qm?.extendedTextMessage?.text ||
                      qm?.imageMessage?.caption ||
                      qm?.videoMessage?.caption || '';
        if (!messageText) {
            return sock.sendMessage(chat, {
                text: '❌ Scheduling media is not supported — reply to a *text* message, or type the message inline.'
            }, { quoted: msg });
        }
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

    // FIX #10 — shared resolver
    const target = await resolveTargetUniversal(sock, targetRaw);
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
        attempts: 0,
        createdAt: Date.now(),
        createdBy: from
    };

    schedules.push(entry);
    write(schedules);

    const stamp = dt.date.toLocaleString('en-GB', {
        hour12: true, timeZone: CONFIG.timezone || 'Asia/Karachi',
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });

    await sock.sendMessage(chat, {
        text:
            `📅 *scheduled*\n\n` +
            `*to ·* ${target.jid.split('@')[0]}\n` +
            `*when ·* ${stamp}\n` +
            `*message ·* ${messageText.trim().slice(0, 200)}${messageText.length > 200 ? '…' : ''}\n\n` +
            `_ID: ${entry.id}_\n` +
            `_Cancel with .schedule cancel ${entry.id}_`
    }, { quoted: msg });
}

// ─────────────────────────────────────────────
//  Scheduler loop
//  FIX #6 — failed sends are retried with backoff
//  (up to 3 attempts); after the final failure the
//  owner is notified instead of silently dropping.
// ─────────────────────────────────────────────
const MAX_ATTEMPTS = 3;

let schedulerTimer = null;

export function startScheduler(sock) {
    if (schedulerTimer) clearInterval(schedulerTimer);

    schedulerTimer = setInterval(async () => {
        try {
            const schedules = read();
            if (schedules.length === 0) return;

            const now = Date.now();
            const remaining = [];
            let mutated = false;

            for (const entry of schedules) {
                if (entry.sendAt > now) {
                    remaining.push(entry);
                    continue;
                }

                try {
                    await sock.sendMessage(entry.targetJid, { text: entry.message });
                    if (DEBUG) console.log(`[schedule] sent ${entry.id} to ${entry.targetJid}`);
                    mutated = true;
                    continue; // done — drop from list
                } catch (e) {
                    entry.attempts = (entry.attempts || 0) + 1;
                    mutated = true;

                    if (entry.attempts >= MAX_ATTEMPTS) {
                        console.error(`[schedule] gave up on ${entry.id}:`, e.message);
                        try {
                            await sock.sendMessage(ownerJid(), {
                                text:
                                    `⚠️ *scheduled message failed*\n\n` +
                                    `*id ·* ${entry.id}\n` +
                                    `*to ·* ${entry.targetJid.split('@')[0]}\n` +
                                    `*error ·* ${e.message}\n\n` +
                                    `_The message was dropped after ${MAX_ATTEMPTS} attempts._`
                            });
                        } catch {}
                        continue; // drop
                    }

                    // backoff: 1 min, 2 min, 4 min…
                    entry.sendAt = now + 60_000 * Math.pow(2, entry.attempts - 1);
                    if (DEBUG) console.log(`[schedule] retry ${entry.attempts}/${MAX_ATTEMPTS} for ${entry.id} at ${new Date(entry.sendAt).toISOString()}`);
                    remaining.push(entry);
                }
            }

            if (mutated || remaining.length !== schedules.length) write(remaining);
        } catch (e) {
            console.error('[schedule] loop error:', e.message);
        }
    }, 30_000);
}
