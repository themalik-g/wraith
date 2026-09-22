// ─────────────────────────────────────────────
// WRAITH · modules/logger.js
// Buffered, non-blocking per-session message logger.
// Lines are queued in memory and flushed asynchronously.
// ─────────────────────────────────────────────
import fs from 'node:fs';
import path from 'node:path';
import { logsPath } from '../core/paths.js';

const FLUSH_MS = 2000;

// filePath → string[] (pending lines)
const buffers = new Map();
let flushTimer = null;

const loggedMsgIds = new Set();
function isDuplicateMsg(msgId) {
  if (!msgId) return false;
  if (loggedMsgIds.has(msgId)) return true;
  loggedMsgIds.add(msgId);
  if (loggedMsgIds.size > 2000) loggedMsgIds.delete(loggedMsgIds.values().next().value);
  return false;
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(flushNow, FLUSH_MS);
  if (typeof flushTimer.unref === 'function') flushTimer.unref();
}

export function flushNow() {
  flushTimer = null;
  for (const [filePath, lines] of buffers) {
    if (!lines.length) continue;
    const data = lines.join('');
    lines.length = 0;
    try {
      fs.appendFile(filePath, data, (err) => {
        if (err) console.error('[logger] append failed:', err.message);
      });
    } catch (e) {
      console.error('[logger] append threw:', e.message);
    }
  }
}

export function flushSync() {
  for (const [filePath, lines] of buffers) {
    if (!lines.length) continue;
    try { fs.appendFileSync(filePath, lines.join('')); lines.length = 0; } catch {}
  }
}
process.on('SIGINT', flushSync);
process.on('SIGTERM', flushSync);

function formatIdentity(jid) {
  if (!jid) return 'N/A';
  const clean = String(jid).split(':')[0];
  const digits = clean.split('@')[0].replace(/\D/g, '');
  if (clean.endsWith('@s.whatsapp.net')) return digits ? `+${digits}` : clean;
  if (clean.endsWith('@lid')) return digits ? `+${digits}` : clean;
  if (clean.endsWith('@g.us')) return digits ? `Group(${digits})` : clean;
  if (digits.length >= 7) return `+${digits}`;
  return clean;
}

export function logMessageHistory({
  sessionId = 'main',
  direction = 'INCOMING',
  chatJid = '',
  senderJid = '',
  messageText = '',
  mediaType = null,
  mediaPath = null,
  timestamp = null,
  msgId = null,
}) {
  try {
    if (chatJid?.endsWith('@newsletter') || senderJid?.endsWith('@newsletter')) return;
    if (msgId && isDuplicateMsg(msgId)) return;

    const now = timestamp ? new Date(timestamp) : new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const dateStr = `${year}-${month}-${day}`;
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');

    const logFileName = `messages_${sessionId}_${dateStr}.txt`;
    const logFilePath = path.join(logsPath(), logFileName);

    const formattedSender = formatIdentity(senderJid);
    const formattedChat = formatIdentity(chatJid);

    let logLine = `[${dateStr}, ${hours}:${minutes}:${seconds}] ${formattedSender} -> ${formattedChat}`;
    if (direction) logLine += ` [${direction}]`;
    if (mediaType) logLine += ` <Media: ${mediaType}${mediaPath ? ` (${mediaPath})` : ''}>`;
    logLine += `: ${(messageText || '').replace(/\r?\n/g, ' ') || '(no text)'}\n`;

    let buf = buffers.get(logFilePath);
    if (!buf) { buf = []; buffers.set(logFilePath, buf); }
    buf.push(logLine);
    scheduleFlush();
  } catch (e) {
    try { console.error('[logger] Failed to write message log:', e?.message); } catch {}
  }
}
