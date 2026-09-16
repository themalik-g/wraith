// ─────────────────────────────────────────────
// WRAITH · router.js — Full router with all phases
// ─────────────────────────────────────────────
import { remember, revealDelete, revealEdit, revealSecretEdit, ghostCommand, classifyMessage } from './modules/ghost.js';
import { peekCommand, autoPeek, watchQuotedViewOnce } from './modules/peek.js';
import { lurkCommand, lurkTick } from './modules/lurk.js';
import { pingCommand } from './modules/ping.js';
import { helpCommand } from './modules/help.js';
import { scheduleCommand } from './modules/schedule.js';
import { adminAction, toggleProtection, handleProtection } from './modules/admin.js';
import { getppCommand } from './modules/profile.js';
import { getjidCommand } from './modules/jid.js';
import { presenceCommand, shouldReadReceipts, applyAutoPresence } from './modules/presence.js';
import { activityCommand, trackActivity } from './modules/activity.js';
import { updateCommand } from './modules/update.js';
import { prefixCommand } from './modules/prefix.js';
import { songCommand } from './modules/song.js';
import { ytdlCommand, mp3Command, pdlCommand, pdlzipCommand } from './modules/download.js';
import { urlCommand } from './modules/url.js';
import { cacheChannelFromMessage } from './core/jid-resolver.js';
import { getPrefix } from './core/settings.js';
import { isOwner } from './core/identity.js';
import { CONFIG } from './config.js';

// ── Phase 1 ──
import {
  currencyCommand, qrCommand, defineCommand, weatherCommand, pwnedCommand,
  ownerCommand, scriptCommand, modeCommand, getMode,
} from './modules/utility.js';

// ── Phase 2 ──
import {
  bookCommand, imageCommand, movieCommand, songCommand as songInfoCommand, lyricsCommand,
  coupleppCommand,
} from './modules/media.js';
import { pptCommand } from './modules/ppt.js';

// ── Phase 3 ──
import {
  welcomeCommand, goodbyeCommand, kickallCommand, kickccCommand,
  setdescCommand as setgdescCommand, setdescCommand, setgppCommand, approveallCommand, declineallCommand,
  leaveCommand, joinCommand, openCommand, closeCommand, tagallCommand, hidetagCommand, muteCommand, unmuteCommand,
  archiveCommand, unarchiveCommand, clearchatCommand,
  rejectcallsCommand, attachCallRejector, getWelcomeConfig,
} from './modules/group.js';
import { setppCommand, setaboutCommand, chatstatsCommand, blockCommand, unblockCommand, blocklistCommand, unblockallCommand, setstatusCommand, getstatusCommand, getpairCommand, setsessionCommand } from './modules/owner.js';

// ── Phase 4 ──
import { gitdlCommand, mfdlCommand } from './modules/downloader.js';
import { igCommand, tiktokCommand, fbCommand } from './modules/social.js';

// ── Phase 5 ──
import { attachPresenceTracker, stalkCommand } from './modules/presence-track.js';

const CRITICAL_COMMANDS = new Set([
  'ghost', 'peek', 'lurk', 'schedule',
  'kick', 'add', 'promote', 'demote',
  'antilink', 'antispam', 'antisticker',
  'getjid', 'presence', 'activity',
  'stalk', 'mode', 'prefix', 'update',
  'kickall', 'kickcc', 'setdesc', 'setgpp',
  'approveall', 'declineall', 'leave', 'join',
  'mute', 'unmute', 'archive', 'unarchive', 'clearchat',
  'rejectcalls', 'setpp', 'setabout', 'chatstats', 'setsession',
  'gitdl', 'mfdl', 'url', 'pdl', 'pdlzip',
]);

const attachedSockets = new WeakSet();
function attachBackground(sock) {
  if (!sock || attachedSockets.has(sock)) return;
  attachedSockets.add(sock);
  try { attachPresenceTracker(sock); } catch (e) { console.error('[router] attachPresenceTracker', e.message); }
  try { attachCallRejector(sock); } catch (e) { console.error('[router] attachCallRejector', e.message); }
}

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
  attachBackground(sock);
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

      if (!text.startsWith(prefix)) {
        continue;
      }

      const withoutPrefix = text.slice(prefix.length);
      if (!withoutPrefix.trim()) continue;

      const firstSpace = withoutPrefix.indexOf(' ');
      const verb = (firstSpace === -1 ? withoutPrefix : withoutPrefix.slice(0, firstSpace)).toLowerCase();
      const rest = firstSpace === -1 ? [] : withoutPrefix.slice(firstSpace + 1).trim().split(/\s+/);

      const sender = msg.key.participant || msg.key.remoteJid;
      const senderIsOwner = msg.key.fromMe || isOwner(sender);
      const mode = getMode();
      if (!senderIsOwner) {
        if (mode === 'private') continue;
        if (CRITICAL_COMMANDS.has(verb)) {
          try { await sock.sendMessage(chat, { text: '⛔ Owner only.' }, { quoted: msg }); } catch {}
          continue;
        }
      }

      const KNOWN = new Set([...CRITICAL_COMMANDS,
        'dl', 'download', 'mp3', 'song', 'songinfo', 'help', 'menu', 'ping',
        'currency', 'qr', 'define', 'weather', 'pwned', 'owner', 'script', 'repo',
        'book', 'books', 'img', 'image', 'movie', 'lyrics', 'ppt', 'couplepp',
        'welcome', 'goodbye', 'getpp', 'ig', 'tiktok', 'fb',
        'igpost', 'tiktokpost', 'fbpost', 'pdl', 'pdlzip', 'postdl',
      ]);
      if (KNOWN.has(verb)) {
        try { await sock.sendMessage(chat, { react: { text: '⌛', key: msg.key } }); } catch (e) { console.error('[router] react', e.message); }
      }

      try {
        switch (verb) {
          // ── Existing ──
          case 'ghost': await ghostCommand(sock, chat, msg, rest); break;
          case 'peek': await peekCommand(sock, chat, msg, rest); break;
          case 'lurk': await lurkCommand(sock, chat, msg, rest); break;
          case 'ping': await pingCommand(sock, chat, msg); break;

          // ── Song (SoundCloud → Apple → Deezer) ──
          case 'song': await songCommand(sock, chat, msg, rest); break;

          // ── Download (yt-dlp, all platforms) ──
          case 'dl':
          case 'download': await ytdlCommand(sock, chat, msg, rest); break;
          case 'mp3': await mp3Command(sock, chat, msg, rest); break;
          case 'pdl':
          case 'postdl': await pdlCommand(sock, chat, msg, rest); break;
          case 'pdlzip': await pdlzipCommand(sock, chat, msg, rest); break;

          case 'songinfo': await songInfoCommand(sock, chat, msg, rest); break;
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

          // ── Phase 1 ──
          case 'currency': await currencyCommand(sock, chat, msg, rest); break;
          case 'qr': await qrCommand(sock, chat, msg, rest); break;
          case 'define': await defineCommand(sock, chat, msg, rest); break;
          case 'weather': await weatherCommand(sock, chat, msg, rest); break;
          case 'pwned': await pwnedCommand(sock, chat, msg, rest); break;
          case 'owner': await ownerCommand(sock, chat, msg); break;
          case 'script':
          case 'repo': await scriptCommand(sock, chat, msg); break;
          case 'mode': await modeCommand(sock, chat, msg, rest); break;

          // ── Phase 2 ──
          case 'book':
          case 'books': await bookCommand(sock, chat, msg, rest); break;
          case 'img':
          case 'image': await imageCommand(sock, chat, msg, rest); break;
          case 'movie': await movieCommand(sock, chat, msg, rest); break;
          case 'lyrics': await lyricsCommand(sock, chat, msg, rest); break;
          case 'ppt': await pptCommand(sock, chat, msg, rest); break;
          case 'couplepp': await coupleppCommand(sock, chat, msg, rest); break;

          // ── Phase 3 ──
          case 'welcome': await welcomeCommand(sock, chat, msg, rest); break;
          case 'goodbye': await goodbyeCommand(sock, chat, msg, rest); break;
          case 'kickall': await kickallCommand(sock, chat, msg, rest); break;
          case 'kickcc': await kickccCommand(sock, chat, msg, rest); break;
          case 'setdesc':
          case 'setgdesc': await setgdescCommand(sock, chat, msg, rest); break;
          case 'setgpp': await setgppCommand(sock, chat, msg, rest); break;
          case 'open': await openCommand(sock, chat, msg); break;
          case 'close': await closeCommand(sock, chat, msg); break;
          case 'tagall': await tagallCommand(sock, chat, msg, rest); break;
          case 'hidetag': await hidetagCommand(sock, chat, msg, rest); break;
          case 'approveall': await approveallCommand(sock, chat, msg, rest); break;
          case 'declineall': await declineallCommand(sock, chat, msg, rest); break;
          case 'leave': await leaveCommand(sock, chat, msg, rest); break;
          case 'join': await joinCommand(sock, chat, msg, rest); break;
          case 'mute': await muteCommand(sock, chat, msg, rest); break;
          case 'unmute': await unmuteCommand(sock, chat, msg); break;
          case 'archive': await archiveCommand(sock, chat, msg); break;
          case 'unarchive': await unarchiveCommand(sock, chat, msg); break;
          case 'clearchat': await clearchatCommand(sock, chat, msg); break;
          case 'rejectcalls': await rejectcallsCommand(sock, chat, msg, rest); break;
          case 'setpp': await setppCommand(sock, chat, msg, rest); break;
          case 'setabout': await setaboutCommand(sock, chat, msg, rest); break;
          case 'chatstats': await chatstatsCommand(sock, chat, msg, rest); break;
          case 'setstatus': await setstatusCommand(sock, chat, msg, rest); break;
          case 'getstatus': await getstatusCommand(sock, chat, msg, rest); break;
          case 'getpair': await getpairCommand(sock, chat, msg, rest); break;
          case 'setsession': await setsessionCommand(sock, chat, msg, rest); break;
          case 'block': await blockCommand(sock, chat, msg, rest); break;
          case 'unblock': await unblockCommand(sock, chat, msg, rest); break;
          case 'blocklist': await blocklistCommand(sock, chat, msg); break;
          case 'unblockall': await unblockallCommand(sock, chat, msg); break;

          // ── Phase 4 ──
          case 'gitdl': await gitdlCommand(sock, chat, msg, rest); break;
          case 'mfdl': await mfdlCommand(sock, chat, msg, rest); break;
          case 'ig':
          case 'igpost': await igCommand(sock, chat, msg, rest); break;
          case 'tiktok':
          case 'tiktokpost': await tiktokCommand(sock, chat, msg, rest); break;
          case 'fb':
          case 'fbpost': await fbCommand(sock, chat, msg, rest); break;

          // ── Phase 5 ──
          case 'stalk': await stalkCommand(sock, chat, msg, rest); break;

          // ── url ──
          case 'url': await urlCommand(sock, chat, msg, rest); break;

          default: break;
        }
      } catch (e) {
        console.error('[dispatch]', verb, e);
        try { await sock.sendMessage(chat, { text: `⚠️ *command failed*\n\n\`${verb}\` — ${e.message}` }, { quoted: msg }); } catch {}
      }
    } catch (e) { console.error('[dispatch:outer]', e); }
  }
}

export async function dispatchUpdate(sock, update) {
  const list = Array.isArray(update) ? update : [update];
  for (const u of list) {
    try {
      if (!u?.key) continue;
      const editNode = u.update?.message?.protocolMessage || u.update?.message || u.message?.protocolMessage;
      if (!editNode) continue;
      const envelope = { key: u.key, participant: u.participant || u.key.participant, message: { protocolMessage: editNode } };
      const t = editNode.type;
      if (t === 14 || t === 'MESSAGE_EDIT') await revealEdit(sock, envelope);
      else if (t === 0 || t === 'REVOKE') await revealDelete(sock, envelope);
    } catch (e) { console.error('[dispatchUpdate]', e.message); }
  }
}

export async function dispatchStatus(sock, payload) {
  try { await lurkTick(sock, payload); } catch (e) { console.error('[dispatchStatus]', e); }
}
