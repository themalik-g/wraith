// ─────────────────────────────────────────────
// WRAITH · modules/pin.js
// .pinchat / .unpinchat — Pin or unpin chat to top
// ─────────────────────────────────────────────
import { isOwner } from '../core/identity.js';

function ownerOnly(sock, chat, msg) {
  const from = msg.key.participant || msg.key.remoteJid;
  if (!msg.key.fromMe && !isOwner(from)) {
    sock.sendMessage(chat, { text: '⛔ Owner only.' }, { quoted: msg }).catch(() => {});
    return true;
  }
  return false;
}

export async function pinchatCommand(sock, chat, msg) {
  if (ownerOnly(sock, chat, msg)) return;
  try {
    await sock.chatModify({ pin: true }, chat);
    await sock.sendMessage(chat, { text: '📌 *Chat pinned to top.*' }, { quoted: msg });
  } catch (e) {
    console.error('[pinchatCommand]', e.message);
    await sock.sendMessage(chat, { text: `⚠️ *pinchat failed:* ${e.message}` }, { quoted: msg }).catch(() => {});
  }
}

export async function unpinchatCommand(sock, chat, msg) {
  if (ownerOnly(sock, chat, msg)) return;
  try {
    await sock.chatModify({ pin: false }, chat);
    await sock.sendMessage(chat, { text: '📍 *Chat unpinned.*' }, { quoted: msg });
  } catch (e) {
    console.error('[unpinchatCommand]', e.message);
    await sock.sendMessage(chat, { text: `⚠️ *unpinchat failed:* ${e.message}` }, { quoted: msg }).catch(() => {});
  }
}
