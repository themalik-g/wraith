// ─────────────────────────────────────────────
//  WRAITH · modules/schedule.js
//  Scan-based date/time parser — works with LIDs.
//  · retries + owner notice on failure
//  · .schedule list / .schedule cancel
//  · dates interpreted in CONFIG.timezone
//  · ★ NEW: schedule MEDIA — reply to image/video/doc/audio
// ─────────────────────────────────────────────
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { downloadContentFromMessage } from '@whiskeysockets/baileys';
import { isOwner, ownerJid } from '../core/identity.js';
import { readJson, writeJsonAtomic } from '../core/state-io.js';
import { resolveTargetUniversal } from '../core/jid-resolver.js';
import { CONFIG } from '../config.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const STATE = path.join(here, '..', 'state', 'schedule.json');
const MEDIA_DIR = path.join(here, '..', 'state', 'schedule-media');
const DEBUG = process.env.WRAITH_DEBUG === '1';

fs.mkdirSync(MEDIA_DIR, { recursive: true });

// ★ Sweep stale media files on boot (crash leftovers) — async non-blocking
(async () => {
  try {
    const files = await fs.promises.readdir(MEDIA_DIR);
    const now = Date.now();
    for (const f of files) {
      const fp = path.join(MEDIA_DIR, f);
      try {
        const st = await fs.promises.stat(fp);
        if (now - st.mtimeMs > 24 * 3600 * 1000) {
          await fs.promises.unlink(fp);
        }
      } catch {}
    }
  } catch {}
})();

function read() { return readJson(STATE, []); }
function write(arr) { writeJsonAtomic(STATE, arr); }

// ── timezone-aware wall-clock → UTC ─────────────────────────────────────────
function zonedTimeToUtc({ year, month, day, h24, minute }, timeZone) {
  const utcGuess = Date.UTC(year, month - 1, day, h24, minute, 0);
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date(utcGuess)).map(p => [p.type, p.value]));
  let h = parseInt(parts.hour, 10);
  if (h === 24) h = 0;
  const localAsUTC = Date.UTC(+parts.year, +parts.month - 1, +parts.day, h, +parts.minute, +parts.second);
  return new Date(utcGuess - (localAsUTC - utcGuess));
}

// ── Scan-based date/time parser ─────────────────────────────────────────────
function parseDateTime(tokens) {
  if (tokens.length < 4) {
    return { ok: false, error: 'Missing date/time. Need: `dd,mm,yy hour minute am/pm`' };
  }

  let dateIdx = -1;
  let day, month, year;
  let dateTokensUsed = 0;

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

  const date = zonedTimeToUtc({ year, month, day, h24, minute }, CONFIG.timezone || 'Asia/Karachi');
  if (isNaN(date.getTime())) return { ok: false, error: 'Could not construct a valid date.' };
  if (date.getTime() <= Date.now()) return { ok: false, error: 'That time is in the past. Pick a future date/time.' };

  return { ok: true, date, dateIdx, dateTokensUsed };
}

// ── ★ NEW: extract + save quoted media ──────────────────────────────────────
async function saveQuotedMedia(quoted, id) {
  const node = quoted?.imageMessage || quoted?.videoMessage || quoted?.documentMessage || quoted?.audioMessage || quoted?.stickerMessage;
  if (!node) return null;
  const kind = quoted.imageMessage ? 'image' : quoted.videoMessage ? 'video' : quoted.documentMessage ? 'document' : quoted.audioMessage ? 'audio' : 'sticker';
  const maxMB = CONFIG.media?.maxDownloadMB || 100;
  if (node.fileLength && Number(node.fileLength) > maxMB * 1024 * 1024) {
    throw new Error(`Media exceeds the ${maxMB} MB cap.`);
  }
  const stream = await downloadContentFromMessage(node, kind);
  const chunks = [];
  for await (const c of stream) chunks.push(c);
  const buffer = Buffer.concat(chunks);
  const extMap = { image: '.jpg', video: '.mp4', document: '', audio: '.ogg', sticker: '.webp' };
  const fileName = node.fileName || `${kind}${extMap[kind] || ''}`;
  const dest = path.join(MEDIA_DIR, `${id}${path.extname(fileName) || extMap[kind] || ''}`);
  fs.writeFileSync(dest, buffer);
  return { path: dest, mimetype: node.mimetype || 'application/octet-stream', fileName, kind };
}

// ── .schedule ───────────────────────────────────────────────────────────────
export async function scheduleCommand(sock, chat, msg, args) {
  const from = msg.key.participant || msg.key.remoteJid;

  if (!msg.key.fromMe && !isOwner(from)) {
    return sock.sendMessage(chat, { text: '⛔ Owner only.' }, { quoted: msg });
  }

  const a0 = (args?.[0] || '').toLowerCase();

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
      lines.push(`  to · ${String(e.targetJid).split('@')[0]}`);
      lines.push(`  at · ${when}`);
      // ★ media entries display differently
      lines.push(`  msg · ${e.media ? `[media: ${e.media.kind} — ${e.media.fileName}]` : `${String(e.message).slice(0, 60)}${String(e.message).length > 60 ? '…' : ''}`}`);
    }
    return sock.sendMessage(chat, { text: lines.join('\n') }, { quoted: msg });
  }

  if (a0 === 'open' || a0 === 'close') {
    const action = a0;
    const restArgs = args.slice(1);
    if (!restArgs.length) {
      return sock.sendMessage(chat, {
        text: `❌ Usage: \`.schedule ${action} [groupJid] dd,mm,yy hour minute am/pm\`\nExample: \`.schedule ${action} 25,12,26 10 30 am\` (in group)`
      }, { quoted: msg });
    }

    let targetGroupJid = chat;
    let timeArgs = restArgs;

    if (restArgs[0].endsWith('@g.us')) {
      targetGroupJid = restArgs[0];
      timeArgs = restArgs.slice(1);
    }

    if (!targetGroupJid.endsWith('@g.us')) {
      return sock.sendMessage(chat, { text: '❌ Scheduled open/close commands must target a group.' }, { quoted: msg });
    }

    const dt = parseDateTime(timeArgs);
    if (!dt.ok) {
      return sock.sendMessage(chat, {
        text: `❌ ${dt.error}\n\nYou gave: \`${timeArgs.join(' ')}\`\n\nUsage: \`.schedule ${action} [groupJid] dd,mm,yy hour minute am/pm\``
      }, { quoted: msg });
    }

    const schedules = read();
    const entry = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      action: `group_${action}`,
      targetJid: targetGroupJid,
      targetType: 'group',
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

    return sock.sendMessage(chat, {
      text:
        `📅 *scheduled group ${action}*\n\n` +
        `*group ·* ${targetGroupJid.split('@')[0]}\n` +
        `*when ·* ${stamp}\n\n` +
        `_ID: ${entry.id}_\n` +
        `_Cancel with .schedule cancel ${entry.id}_`
    }, { quoted: msg });
  }

  if (a0 === 'cancel' || a0 === 'delete' || a0 === 'del') {
    const id = (args?.[1] || '').trim();
    if (!id) {
      return sock.sendMessage(chat, { text: '❌ Usage: `.schedule cancel <id>`' }, { quoted: msg });
    }
    const schedules = read();
    const victim = schedules.find(e => e.id === id);
    const remaining = schedules.filter(e => e.id !== id);
    if (!victim) {
      return sock.sendMessage(chat, { text: `❌ No schedule with ID \`${id}\`. Use _.schedule list_` }, { quoted: msg });
    }
    // ★ delete attached media file
    if (victim.media?.path) { try { fs.unlinkSync(victim.media.path); } catch {} }
    write(remaining);
    return sock.sendMessage(chat, { text: `✅ Schedule \`${id}\` cancelled.` }, { quoted: msg });
  }

  if (!args || args.length === 0) {
    return sock.sendMessage(chat, {
      text:
        `📅 *schedule* — send a message later\n\n` +
        `*Usage:*\n` +
        `  _.schedule <message> <target> dd,mm,yy hour minute am/pm_\n` +
        `  _.schedule <target> dd,mm,yy hour minute am/pm_  (reply to text)\n` +
        `  _.schedule <target> dd,mm,yy hour minute am/pm_  (reply to ★media★)\n\n` +
        `*Manage:*\n` +
        `  _.schedule list_ — show pending schedules\n` +
        `  _.schedule cancel <id>_ — cancel one\n\n` +
        `*Target:* phone number · @username · JID · newsletter JID\n` +
        `*Timezone:* ${CONFIG.timezone || 'Asia/Karachi'}\n\n` +
        `*Examples:*\n` +
        `  _.schedule Hey! 923001234567 25,12,26 10 30 am_\n` +
        `  _.schedule 25,12,26 10 30 am_  (reply to anything)`
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
  let media = null;

  if (hasQuote) {
    const qm = ctx.quotedMessage;
    // ★ NEW: media reply → schedule the media itself
    if (qm?.imageMessage || qm?.videoMessage || qm?.documentMessage || qm?.audioMessage || qm?.stickerMessage) {
      targetRaw = beforeDateTime.join(' ').trim();
      if (!targetRaw) {
        return sock.sendMessage(chat, { text: '❌ Missing target. Use: phone number, @username, JID, or newsletter JID.' }, { quoted: msg });
      }
      const tmpId = 'pending_' + Date.now().toString(36);
      try {
        media = await saveQuotedMedia(qm, tmpId);
      } catch (e) {
        return sock.sendMessage(chat, { text: `❌ Media error: ${e.message}` }, { quoted: msg });
      }
      messageText = qm.imageMessage?.caption || qm.videoMessage?.caption || qm.documentMessage?.caption || media.fileName;
    } else {
      messageText = qm?.conversation || qm?.extendedTextMessage?.text || '';
      if (!messageText) {
        return sock.sendMessage(chat, { text: '❌ Nothing to schedule in that reply.' }, { quoted: msg });
      }
      targetRaw = beforeDateTime.join(' ').trim();
    }
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
    return sock.sendMessage(chat, { text: `❌ Missing target. Use: phone number, @username, JID, or newsletter JID.` }, { quoted: msg });
  }
  if (!messageText || messageText.trim() === '') {
    return sock.sendMessage(chat, { text: `❌ Missing message text.` }, { quoted: msg });
  }

  const target = await resolveTargetUniversal(sock, targetRaw);
  if (!target) {
    if (media?.path) { try { fs.unlinkSync(media.path); } catch {} }
    return sock.sendMessage(chat, { text: `❌ Could not resolve target: \`${targetRaw}\`` }, { quoted: msg });
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
  if (media) {
    // rename media file to the final entry id for clean bookkeeping
    const finalPath = path.join(MEDIA_DIR, `${entry.id}${path.extname(media.path)}`);
    try { fs.renameSync(media.path, finalPath); media.path = finalPath; } catch {}
    entry.media = media;
  }

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
      `*content ·* ${entry.media ? `[media: ${entry.media.kind}]` : messageText.trim().slice(0, 200)}${!entry.media && messageText.length > 200 ? '…' : ''}\n\n` +
      `_ID: ${entry.id}_\n` +
      `_Cancel with .schedule cancel ${entry.id}_`
  }, { quoted: msg });
}

// ── ★ send helper (text or media), always cleans up the file ────────────────
async function sendEntry(sock, entry) {
  if (entry.action === 'group_open') {
    await sock.groupSettingUpdate(entry.targetJid, 'not_announcement');
    await sock.sendMessage(entry.targetJid, { text: '🔓 Scheduled group open executed.' });
    return;
  }
  if (entry.action === 'group_close') {
    await sock.groupSettingUpdate(entry.targetJid, 'announcement');
    await sock.sendMessage(entry.targetJid, { text: '🔒 Scheduled group close executed.' });
    return;
  }
  if (!entry.media) {
    await sock.sendMessage(entry.targetJid, { text: entry.message });
    return;
  }
  const { path: mediaPath, mimetype, fileName, kind } = entry.media;
  try {
    const buffer = fs.readFileSync(mediaPath);
    if (kind === 'image') await sock.sendMessage(entry.targetJid, { image: buffer, caption: entry.message });
    else if (kind === 'video') await sock.sendMessage(entry.targetJid, { video: buffer, caption: entry.message });
    else if (kind === 'audio') await sock.sendMessage(entry.targetJid, { audio: buffer, mimetype });
    else if (kind === 'sticker') await sock.sendMessage(entry.targetJid, { sticker: buffer });
    else await sock.sendMessage(entry.targetJid, { document: buffer, mimetype, fileName: fileName || 'file' });
  } finally {
    try { fs.unlinkSync(mediaPath); } catch {}
  }
}

// ── Scheduler loop ──────────────────────────────────────────────────────────
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
          await sendEntry(sock, entry);
          if (DEBUG) console.log(`[schedule] sent ${entry.id} to ${entry.targetJid}`);
          mutated = true;
          continue;
        } catch (e) {
          entry.attempts = (entry.attempts || 0) + 1;
          mutated = true;

          if (entry.attempts >= MAX_ATTEMPTS) {
            console.error(`[schedule] gave up on ${entry.id}:`, e.message);
            if (entry.media?.path) { try { fs.unlinkSync(entry.media.path); } catch {} } // ★ free space
            try {
              await sock.sendMessage(ownerJid(), {
                text:
                  `⚠️ *scheduled ${entry.media ? 'media ' : ''}message failed*\n\n` +
                  `*id ·* ${entry.id}\n` +
                  `*to ·* ${entry.targetJid.split('@')[0]}\n` +
                  `*error ·* ${e.message}\n\n` +
                  `_Dropped after ${MAX_ATTEMPTS} attempts._`
              });
            } catch {}
            continue;
          }

          entry.sendAt = now + 60_000 * Math.pow(2, entry.attempts - 1);
          if (DEBUG) console.log(`[schedule] retry ${entry.attempts}/${MAX_ATTEMPTS} for ${entry.id}`);
          remaining.push(entry);
        }
      }

      if (mutated || remaining.length !== schedules.length) write(remaining);
    } catch (e) {
      console.error('[schedule] loop error:', e.message);
    }
  }, 30_000);
}

export function stopScheduler() {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
}
