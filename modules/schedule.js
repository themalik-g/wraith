// ─────────────────────────────────────────────
//  WRAITH · modules/schedule.js
//  Schedule messages to be sent at a future time.
//  Format: .schedule <message> <target> dd,mm,yy hour minute am/pm
//  Or:     .schedule <target> dd,mm,yy hour minute am/pm  (replied message)
// ─────────────────────────────────────────────
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { isOwner, ownerJid } from '../core/identity.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const STATE = path.join(here, '..', 'state', 'schedule.json');
const DEBUG = process.env.WRAITH_DEBUG === '1';

fs.mkdirSync(path.dirname(STATE), { recursive: true });

// ─────────────────────────────────────────────
//  State
// ─────────────────────────────────────────────
function read() {
    try {
        if (!fs.existsSync(STATE)) return [];
        return JSON.parse(fs.readFileSync(STATE, 'utf-8'));
    } catch { return []; }
}

function write(arr) {
    try {
        fs.writeFileSync(STATE, JSON.stringify(arr, null, 2));
    } catch (e) {
        if (DEBUG) console.log('[schedule] write failed:', e.message);
    }
}

// ─────────────────────────────────────────────
//  Resolve target
// ─────────────────────────────────────────────
async function resolveTarget(sock, raw) {
    if (!raw) return null;
    const clean = raw.trim();

    if (clean.includes('@')) {
        if (clean.endsWith('@newsletter')) return { jid: clean, type: 'newsletter' };
        if (clean.endsWith('@g.us')) return { jid: clean, type: 'group' };
        if (clean.endsWith('@s.whatsapp.net') || clean.endsWith('@lid')) return { jid: clean, type: 'user' };

        try {
            const results = await sock.onWhatsApp(clean.replace('@', ''));
            if (results?.[0]?.jid) return { jid: results[0].jid, type: 'user' };
        } catch {}
    }

    const digits = clean.replace(/\D/g, '');
    if (digits.length >= 7) {
        try {
            const results = await sock.onWhatsApp(digits);
            if (results?.[0]?.jid) return { jid: results[0].jid, type: 'user' };
            return { jid: digits + '@s.whatsapp.net', type: 'user' };
        } catch {}
    }

    try {
        const results = await sock.onWhatsApp(clean);
        if (results?.[0]?.jid) return { jid: results[0].jid, type: 'user' };
    } catch {}

    return null;
}

// ─────────────────────────────────────────────
//  Parse date/time
// ─────────────────────────────────────────────
function parseDateTime(args) {
    // Expected: dd,mm,yy hour minute ampm  (6 tokens)
    // Or:       dd mm yy hour minute ampm  (6 tokens)
    if (args.length < 6) {
        return { ok: false, error: 'Missing date/time. Need: `dd,mm,yy hour minute am/pm`' };
    }

    let day, month, year;

    // Handle "dd,mm,yy" as one token or "dd mm yy" as three
    const datePart = args[0].replace(/,/g, ' ').split(/\s+/).filter(Boolean);

    if (datePart.length === 3) {
        [day, month, year] = datePart.map(Number);
    } else if (args.length >= 6 && args[1].includes(',')) {
        // Maybe "dd,mm" and "yy" split
        const parts = (args[0] + ' ' + args[1]).replace(/,/g, ' ').split(/\s+/).filter(Boolean);
        if (parts.length === 3) {
            [day, month, year] = parts.map(Number);
            args = args.slice(1); // consume extra token
        }
    } else {
        day = Number(args[0]);
        month = Number(args[1]);
        year = Number(args[2]);
    }

    if (!day || !month || !year || isNaN(day) || isNaN(month) || isNaN(year)) {
        return { ok: false, error: 'Invalid date. Use `dd,mm,yy` (e.g. `25,12,26`)' };
    }

    // Validate ranges
    if (day < 1 || day > 31) return { ok: false, error: `Invalid day: ${day}. Must be 1–31.` };
    if (month < 1 || month > 12) return { ok: false, error: `Invalid month: ${month}. Must be 1–12.` };
    if (year < 2026 || year > 2100) return { ok: false, error: `Invalid year: ${year}. Must be 2026–2100.` };

    // Time parsing — find the numeric tokens after the date
    const timeStartIdx = datePart.length === 3 ? 1 : 3;
    const timeArgs = args.slice(timeStartIdx);

    if (timeArgs.length < 3) {
        return { ok: false, error: 'Missing time. Need: `hour minute am/pm`' };
    }

    const hour = Number(timeArgs[0]);
    const minute = Number(timeArgs[1]);
    const ampm = (timeArgs[2] || '').toLowerCase();

    if (isNaN(hour) || hour < 1 || hour > 12) {
        return { ok: false, error: `Invalid hour: ${timeArgs[0]}. Must be 1–12.` };
    }
    if (isNaN(minute) || minute < 0 || minute > 59) {
        return { ok: false, error: `Invalid minute: ${timeArgs[1]}. Must be 0–59.` };
    }
    if (ampm !== 'am' && ampm !== 'pm') {
        return { ok: false, error: `Invalid am/pm: "${timeArgs[2]}". Must be "am" or "pm".` };
    }

    // Convert to 24-hour
    let h24 = hour % 12;
    if (ampm === 'pm') h24 += 12;

    const date = new Date(year, month - 1, day, h24, minute, 0);

    if (isNaN(date.getTime())) {
        return { ok: false, error: 'Could not construct a valid date from the given values.' };
    }

    if (date.getTime() <= Date.now()) {
        return { ok: false, error: 'That time is in the past. Pick a future date/time.' };
    }

    return { ok: true, date };
}

// ─────────────────────────────────────────────
//  .schedule — command
// ─────────────────────────────────────────────
export async function scheduleCommand(sock, chat, msg, args) {
    const from = msg.key.participant || msg.key.remoteJid;

    if (!msg.key.fromMe && !isOwner(from)) {
        return sock.sendMessage(chat, { text: '⛔ Owner only.' }, { quoted: msg });
    }

    // No args → show help
    if (!args || args.length === 0) {
        return sock.sendMessage(chat, {
            text:
                `📅 *schedule* — send a message later\n\n` +
                `*Usage:*\n` +
                `  _.schedule <message> <target> dd,mm,yy hour minute am/pm_\n` +
                `  _.schedule <target> dd,mm,yy hour minute am/pm_  (replied message)\n\n` +
                `*Target can be:*\n` +
                `  • phone number (923001234567)\n` +
                `  • WhatsApp username (@ali)\n` +
                `  • JID (923001234567@s.whatsapp.net)\n` +
                `  • newsletter JID (...@newsletter)\n\n` +
                `*Examples:*\n` +
                `  _.schedule Hey! 923001234567 25,12,26 10 30 am_\n` +
                `  _.schedule 25,12,26 10 30 am_  (reply to a message)`
        }, { quoted: msg });
    }

    // Detect if the last 6 tokens look like a date/time block
    const last6 = args.slice(-6);
    const hasDateTime = last6.length === 6 && /[,\/]/.test(last6[0] || '') === true ||
                        (last6.length === 6 && /\d/.test(last6[0]) && /\d/.test(last6[1]));

    // More robust: check if any token contains a comma or if we have enough numeric tokens
    let dateTimeOk = false;
    let dtArgs = null;

    // Try last 6 tokens
    if (args.length >= 6) {
        const candidate = args.slice(-6);
        const dt = parseDateTime(candidate);
        if (dt.ok) {
            dateTimeOk = true;
            dtArgs = dt;
        }
    }

    // Try last 7 tokens (in case message has a space)
    if (!dateTimeOk && args.length >= 7) {
        const candidate = args.slice(-7);
        const dt = parseDateTime(candidate);
        if (dt.ok) {
            dateTimeOk = true;
            dtArgs = dt;
        }
    }

    if (!dateTimeOk) {
        // Figure out what's missing
        if (args.length < 6) {
            return sock.sendMessage(chat, {
                text: `❌ Not enough arguments.\n\nYou gave: \`${args.join(' ')}\`\n\nNeed at least 6 tokens for date/time: \`dd,mm,yy hour minute am/pm\`\n\nType _.schedule_ for full help.`
            }, { quoted: msg });
        }
        return sock.sendMessage(chat, {
            text: `❌ Could not parse date/time from: \`${args.slice(-6).join(' ')}\`\n\nFormat: \`dd,mm,yy hour minute am/pm\`\nExample: \`25,12,26 10 30 am\`\n\nType _.schedule_ for full help.`
        }, { quoted: msg });
    }

    // Everything before the date-time block is message + target
    const beforeDateTime = args.slice(0, args.length - (args.length >= 7 && !parseDateTime(args.slice(-6)).ok ? 7 : 6));

    // Check for replied message
    const ctx = msg.message?.extendedTextMessage?.contextInfo;
    const hasQuote = !!ctx?.quotedMessage;

    let messageText = '';
    let targetRaw = '';

    if (hasQuote) {
        // Replied message + target from beforeDateTime
        messageText = ctx.quotedMessage?.conversation ||
                      ctx.quotedMessage?.extendedTextMessage?.text ||
                      ctx.quotedMessage?.imageMessage?.caption ||
                      ctx.quotedMessage?.videoMessage?.caption ||
                      '[media message]';
        targetRaw = beforeDateTime.join(' ').trim();
    } else {
        // Message + target from beforeDateTime
        // The target is the LAST token before the date-time block
        if (beforeDateTime.length < 2) {
            return sock.sendMessage(chat, {
                text: `❌ Missing message and/or target.\n\nYou need: _.schedule <message> <target> dd,mm,yy hour minute am/pm_\nOr reply to a message: _.schedule <target> dd,mm,yy hour minute am/pm_\n\nType _.schedule_ for full help.`
            }, { quoted: msg });
        }

        targetRaw = beforeDateTime[beforeDateTime.length - 1];
        messageText = beforeDateTime.slice(0, -1).join(' ');
    }

    if (!targetRaw) {
        return sock.sendMessage(chat, {
            text: `❌ Missing target. Who should receive this?\n\nYou can use: phone number, @username, JID, or newsletter JID.\n\nType _.schedule_ for full help.`
        }, { quoted: msg });
    }

    if (!messageText || messageText.trim() === '') {
        return sock.sendMessage(chat, {
            text: `❌ Missing message text.\n\nProvide a message before the target, or reply to a message.\n\nType _.schedule_ for full help.`
        }, { quoted: msg });
    }

    // Resolve target
    const target = await resolveTarget(sock, targetRaw);
    if (!target) {
        return sock.sendMessage(chat, {
            text: `❌ Could not resolve target: \`${targetRaw}\`\n\nMake sure it's a valid phone number, @username, or JID.`
        }, { quoted: msg });
    }

    // Save schedule
    const schedules = read();
    const entry = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        message: messageText.trim(),
        targetJid: target.jid,
        targetType: target.type,
        sendAt: dtArgs.date.getTime(),
        createdAt: Date.now(),
        createdBy: from
    };

    schedules.push(entry);
    write(schedules);

    const stamp = dtArgs.date.toLocaleString('en-GB', {
        hour12: true,
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
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
//  Scheduler loop — checks every 30 seconds
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

            if (remaining.length !== schedules.length) {
                write(remaining);
            }
        } catch (e) {
            console.error('[schedule] loop error:', e.message);
        }
    }, 30_000);
}
