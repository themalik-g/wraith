import fs from 'fs';
import path from 'path';
import { logsPath } from '../core/paths.js';

const LOGS_DIR = logsPath();

const loggedMsgIds = new Set();
function isDuplicateMsg(msgId) {
  if (!msgId) return false;
  if (loggedMsgIds.has(msgId)) return true;
  loggedMsgIds.add(msgId);
  if (loggedMsgIds.size > 2000) {
    const first = loggedMsgIds.values().next().value;
    loggedMsgIds.delete(first);
  }
  return false;
}

/**
 * Appends a message log entry to logs/messages_<sessionId>_<YYYY-MM-DD>.txt
 *
 * @param {Object} opts
 * @param {string} [opts.sessionId='main'] - Session ID
 * @param {'INCOMING'|'OUTGOING'} opts.direction - Message direction
 * @param {string} opts.chatJid - Remote chat JID
 * @param {string} opts.senderJid - Sender JID
 * @param {string} [opts.messageText=''] - Plain text or caption
 * @param {string} [opts.mediaType] - Optional media type ('image', 'video', 'audio', etc.)
 * @param {string} [opts.mediaPath] - Optional local filepath reference where media is saved
 * @param {Date|number} [opts.timestamp] - Optional message timestamp
 */
function formatIdentity(jid) {
  if (!jid) return 'N/A';
  const clean = String(jid).split(':')[0];
  const digits = clean.split('@')[0].replace(/\D/g, '');

  if (clean.endsWith('@s.whatsapp.net')) {
    return digits ? `+${digits}` : clean;
  }
  if (clean.endsWith('@lid')) {
    return digits ? `+${digits}` : clean;
  }
  if (clean.endsWith('@g.us')) {
    return digits ? `Group(${digits})` : clean;
  }
  if (digits.length >= 7) {
    return `+${digits}`;
  }
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
  msgId = null
}) {
  try {
    if (chatJid?.endsWith('@newsletter') || senderJid?.endsWith('@newsletter')) {
      return;
    }
    if (msgId && isDuplicateMsg(msgId)) {
      return;
    }
    const now = timestamp ? new Date(timestamp) : new Date();

    // YYYY-MM-DD for log filename
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const dateStr = `${year}-${month}-${day}`;

    // HH:mm:ss for timestamp in log entry
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');

    const logsDirectory = logsPath();

    const logFileName = `messages_${sessionId}_${dateStr}.txt`;
    const logFilePath = path.join(logsDirectory, logFileName);

    const formattedSender = formatIdentity(senderJid);
    const formattedChat = formatIdentity(chatJid);

    let logLine = `[${dateStr}, ${hours}:${minutes}:${seconds}] ${formattedSender} -> ${formattedChat}`;
    if (direction) {
      logLine += ` [${direction}]`;
    }
    if (mediaType) {
      logLine += ` <Media: ${mediaType}${mediaPath ? ` (${mediaPath})` : ''}>`;
    }
    const cleanText = (messageText || '').replace(/\r?\n/g, ' ');
    logLine += `: ${cleanText || '(no text)'}\n`;

    fs.appendFileSync(logFilePath, logLine, 'utf-8');
  } catch (e) {
    try {
      console.error('[logger] Failed to write message log:', e?.message);
    } catch {}
  }
}
