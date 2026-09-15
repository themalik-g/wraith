// ─────────────────────────────────────────────
// WRAITH · router.js
// Unified message dispatcher.
// Prefix is read dynamically from settings.
// ─────────────────────────────────────────────
import { remember, revealDelete, revealEdit, revealSecretEdit, ghostCommand, classifyMessage, } from './modules/ghost.js';
import { peekCommand, autoPeek, watchQuotedViewOnce } from './modules/peek.js';
import { lurkCommand, lurkTick } from './modules/lurk.js';
import { pingCommand } from './modules/ping.js';
import { helpCommand } from './modules/help.js';
import { scheduleCommand } from './modules/schedule.js';
import { adminAction, toggleProtection, handleProtection, } from './modules/admin.js';
import { getppCommand } from './modules/profile.js';
import { getjidCommand } from './modules/jid.js';
import { presenceCommand, shouldReadReceipts, applyAutoPresence, } from './modules/presence.js';
import { activityCommand, trackActivity } from './modules/activity.js';
import { updateCommand } from './modules/update.js';
import { prefixCommand } from './modules/prefix.js';
import { downloadCommand, songCommand, } from './modules/download.js';
import { cacheChannelFromMessage } from './core/jid-resolver.js';
import { getPrefix } from './core/settings.js';
import { isOwner } from './core/identity.js';
import {
  currencyCommand, qrCommand, defineCommand, weatherCommand, pwnedCommand,
  ownerCommand, scriptCommand, modeCommand, stalkCommand,
  getMode, attachPresenceTracker,
} from './modules/utility.js';

// Commands that are ALWAYS owner-only, even in public mode.
// Keep this list tight — anything that controls the bot or reveals private data.
const CRITICAL_COMMANDS = new Set([
  'ghost', 'peek', 'lurk', 'schedule',
  'kick', 'add', 'promote', 'demote',
  'antilink', 'antispam', 'antisticker',
  'getjid', 'presence', 'activity',
  'stalk', 'mode', 'prefix', 'update',
  'debug', 'mute', 'archive', 'leave', 'join', 'clearchat',
]);

let presenceTrackerAttached = false;

function plainText(msg) {
  return (
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.message?.imageMessage?.caption ||
    msg.message?.videoMessage?.caption ||
    ''
  ).trim();
}

export async function dispatch(sock, update) {
  // Attach the presence tracker exactly once per socket.
  if (!presenceTrackerAttached) {
    try {
      attachPresenceTracker(sock);
      presenceTrackerAttached = true;
    } catch (e) {
      console.error('[router] attachPresenceTracker failed:', e.message);
    }
  }

  if (update.type && update.type !== 'notify' && update.type !== 'append') return;

  for (const msg of update.messages || []) {
    if (!msg?.message) continue;
    try {
      const chat = msg.key.remoteJid;
      if (!chat) continue;

      try { trackActivity(chat, msg, plainText(msg)); } catch (e) { console.error('[router] trackActivity', e.message); }
      try { cacheChannelFromMessage(msg); } catch (e) { console.error('[router] cacheChannelFromMessage', e.message); }

      try {
        if (shouldReadReceipts() && !msg.key.fromMe && chat !== 'status@broadcast') {
          await sock.readMessages([msg.key]);
        }
      } catch (e) { console.error('[router] readReceipts', e.message); }

      const kind = classifyMessage(msg);
      if (kind === 'revoke') { await revealDelete(sock, msg); continue; }
      if (kind === 'edit') { await revealEdit(sock, msg); continue; }
      if (kind === 'secret_edit') { await revealSecretEdit(sock, msg); continue; }

      try { await remember(sock, msg); } catch (e) { console.error('[router] remember', e.message); }
      try { await autoPeek(sock, msg); } catch (e) { console.error('[router] autoPeek', e.message); }
      try { await watchQuotedViewOnce(sock, msg); } catch (e) { console.error('[router] watchQuotedViewOnce', e.message); }

      if (chat === 'status@broadcast') continue;

      try { await applyAutoPresence(sock, chat); } catch (e) { console.error('[router] applyAutoPresence', e.message); }

      try {
        const blocked = await handleProtection(sock, chat, msg, plainText(msg));
        if (blocked) continue;
      } catch (e) { console.error('[router] handleProtection', e.message); }

      const text = plainText(msg);
      const prefix = getPrefix();

      // Fast reject: doesn't start with the current prefix
      if (!text.startsWith(prefix)) continue;

      // Guard against bare prefix with no command (e.g. user just sent ".")
      const withoutPrefix = text.slice(prefix.length);
      if (!withoutPrefix.trim()) continue;

      const firstSpace = withoutPrefix.indexOf(' ');
      const verb = (firstSpace === -1 ? withoutPrefix : withoutPrefix.slice(0, firstSpace)).toLowerCase();
      const rest = firstSpace === -1 ? [] : withoutPrefix.slice(firstSpace + 1).trim().split(/\s+/);

      // ── Mode gate ──────────────────────────────────────────────────────
      // Private mode → only owner can run anything.
      // Public mode  → non-owner blocked only on CRITICAL commands.
      const sender = msg.key.participant || msg.key.remoteJid;
      const senderIsOwner = msg.key.fromMe || isOwner(sender);
      const mode = getMode();
      if (!senderIsOwner) {
        if (mode === 'private') continue;                    // silent ignore
        if (CRITICAL_COMMANDS.has(verb)) {
          try {
            await sock.sendMessage(chat, { text: '⛔ Owner only.' }, { quoted: msg });
          } catch {}
          continue;
        }
      }

      try {
        await sock.sendMessage(chat, { react: { text: '⌛', key: msg.key } });
      } catch (e) { console.error('[router] react', e.message); }

      try {
        switch (verb) {
          case 'ghost': await ghostCommand(sock, chat, msg, rest); break;
          case 'peek': await peekCommand(sock, chat, msg, rest); break;
          case 'lurk': await lurkCommand(sock, chat, msg, rest); break;
          case 'ping': await pingCommand(sock, chat, msg); break;
          case 'dl':
          case 'download': await downloadCommand(sock, chat, msg, rest); break;
          case 'song': await songCommand(sock, chat, msg, rest); break;
          case 'prefix': await prefixCommand(sock, chat, msg, rest); break;
          case 'help':
          case 'menu': await helpCommand(sock, chat, msg, rest); break;
          case 'schedule': await scheduleCommand(sock, chat, msg, rest); break;
          case 'kick': await adminAction(sock, chat, msg, rest, 'remove'); break;
          case 'add': await adminAction(sock, chat, msg, rest, 'add'); break;
          case 'promote': await adminAction(sock, chat, msg, rest, 'promote'); break;
          case 'demote': await adminAction(sock, chat, msg, rest, 'demote'); break;
          case 'antilink': await toggleProtection(sock, chat, msg, rest, 'antilink'); break;
          case 'antispam': await toggleProtection(sock, chat, msg, rest, 'antispam'); break;
          case 'antisticker': await toggleProtection(sock, chat, msg, rest, 'antisticker'); break;
          case 'getpp': await getppCommand(sock, chat, msg, rest); break;
          case 'getjid': await getjidCommand(sock, chat, msg, rest); break;
          case 'presence': await presenceCommand(sock, chat, msg, rest); break;
          case 'activity': await activityCommand(sock, chat, msg, rest); break;
          case 'update': await updateCommand(sock, chat, msg, rest); break;

          // ── Phase 1 additions ──
          case 'currency': await currencyCommand(sock, chat, msg, rest); break;
          case 'qr': await qrCommand(sock, chat, msg, rest); break;
          case 'define': await defineCommand(sock, chat, msg, rest); break;
          case 'weather': await weatherCommand(sock, chat, msg, rest); break;
          case 'pwned': await pwnedCommand(sock, chat, msg, rest); break;
          case 'owner': await ownerCommand(sock, chat, msg); break;
          case 'script':
          case 'repo': await scriptCommand(sock, chat, msg); break;
          case 'mode': await modeCommand(sock, chat, msg, rest); break;
          case 'stalk': await stalkCommand(sock, chat, msg, rest); break;

          default: break;
        }
      } catch (e) {
        console.error('[dispatch]', verb, e);
        try {
          await sock.sendMessage(chat, {
            text: `⚠️ *command failed*\n\n\`${verb}\` — ${e.message}`,
          }, { quoted: msg });
        } catch {}
      }
    } catch (e) {
      console.error('[dispatch:outer]', e);
    }
  }
}

export async function dispatchUpdate(sock, update) {
  if (!update?.key) return;
  const editNode =
    update.update?.message?.protocolMessage ||
    update.update?.message ||
    update.message?.protocolMessage;
  if (!editNode) return;
  const envelope = {
    key: update.key,
    participant: update.participant || update.key.participant,
    message: { protocolMessage: editNode },
  };
  const t = editNode.type;
  if (t === 14 || t === 'MESSAGE_EDIT') await revealEdit(sock, envelope);
  else if (t === 0 || t === 'REVOKE') await revealDelete(sock, envelope);
}

export async function dispatchStatus(sock, payload) {
  try { await lurkTick(sock, payload); } catch (e) { console.error('[dispatchStatus]', e); }
}
