// ─────────────────────────────────────────────
// WRAITH · modules/owner.js
// Phase 3: Owner profile commands
// ─────────────────────────────────────────────
import fs from 'node:fs';
import { downloadContentFromMessage } from '@whiskeysockets/baileys';
import { isOwner } from '../core/identity.js';
import { CONFIG } from '../config.js';
import { withTempFile } from '../lib/net.js';

function ownerOnly(sock, chat, msg) {
  const from = msg.key.participant || msg.key.remoteJid;
  if (!msg.key.fromMe && !isOwner(from)) {
    sock.sendMessage(chat, { text: '⛔ Owner only.' }, { quoted: msg }).catch(() => {});
    return true;
  }
  return false;
}

// ── .setpp (bot profile picture) ────────────────────────────────────────────
export async function setppCommand(sock, chat, msg, args) {
  if (ownerOnly(sock, chat, msg)) return;
  try {
    const ctx = msg.message?.extendedTextMessage?.contextInfo;
    const quoted = ctx?.quotedMessage;
    if (!quoted?.imageMessage) {
      return sock.sendMessage(chat, { text: '❌ Reply to an image with `.setpp`.' }, { quoted: msg });
    }
    const stream = await downloadContentFromMessage(quoted.imageMessage, 'image');
    const chunks = [];
    for await (const c of stream) chunks.push(c);
    const buffer = Buffer.concat(chunks);

    await sock.updateProfilePicture(sock.user.id, buffer);
    await sock.sendMessage(chat, { text: '✅ Bot profile picture updated.' }, { quoted: msg });
  } catch (e) {
    await sock.sendMessage(chat, { text: `⚠️ setpp failed: ${e.message}` }, { quoted: msg }).catch(() => {});
  }
}

// ── .setabout ───────────────────────────────────────────────────────────────
export async function setaboutCommand(sock, chat, msg, args) {
  if (ownerOnly(sock, chat, msg)) return;
  try {
    const about = (args || []).join(' ').trim();
    if (!about) return sock.sendMessage(chat, { text: '❌ Provide status text.' }, { quoted: msg });
    await sock.updateProfileStatus(about);
    await sock.sendMessage(chat, { text: '✅ About updated.' }, { quoted: msg });
  } catch (e) {
    await sock.sendMessage(chat, { text: `⚠️ setabout failed: ${e.message}` }, { quoted: msg }).catch(() => {});
  }
}

// ── .chatstats ──────────────────────────────────────────────────────────────
export async function chatstatsCommand(sock, chat, msg, args) {
  try {
    const target = args?.[0] ? args[0].replace(/\D/g, '') + '@s.whatsapp.net' : null;
    if (!target) return sock.sendMessage(chat, { text: '📊 *chatstats*\n\nUsage: `.chatstats <number>`' }, { quoted: msg });

    // Use existing activity data from state/activity.json
    const path = await import('node:path');
    const { readJson } = await import('../core/state-io.js');
    const activityFile = path.join(process.cwd(), 'state', 'activity.json');
    const activity = readJson(activityFile, {});

    const chatData = activity[target] || activity[chat] || {};
    const totalMsgs = chatData.count || chatData.messages || 0;
    const mediaCount = chatData.media || 0;

    const lines = [
      `📊 *chatstats* — \`${target.split('@')[0]}\``,
      '',
      `• messages · ${totalMsgs}`,
      `• media · ${mediaCount}`,
      `• first seen · ${chatData.first || '—'}`,
      `• last seen · ${chatData.last || '—'}`,
      '',
      '_Data collected from bot activity logs._',
    ];
    await sock.sendMessage(chat, { text: lines.join('\n') }, { quoted: msg });
  } catch (e) {
    await sock.sendMessage(chat, { text: `⚠️ chatstats failed: ${e.message}` }, { quoted: msg }).catch(() => {});
  }
}
