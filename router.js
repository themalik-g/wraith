// router.js — WRAITH full router
import { remember, revealDelete, revealEdit, revealSecretEdit, ghostCommand, classifyMessage, getLedgerEntry } from './modules/ghost.js';
import { logMessageHistory } from './modules/logger.js';
import { peekCommand, autoPeek, watchQuotedViewOnce } from './modules/peek.js';
import { lurkCommand, lurkTick } from './modules/lurk.js';
import { pingCommand, aliveCommand, uptimeCommand, restartCommand } from './modules/ping.js';
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
import {
  ytdlCommand as dlCommand, mp3Command, pdlCommand, pdlzipCommand,
  twitterCommand, pinterestCommand, threadsCommand, redditCommand,
  soundcloudCommand, spotifyCommand, youtubeCommand,
} from './modules/download.js';
import { urlCommand } from './modules/url.js';
import { cacheChannelFromMessage } from './core/jid-resolver.js';
import { getPrefix, getReplyMode, setReplyMode } from './core/settings.js';
import { isOwner } from './core/identity.js';
import { CONFIG, saveSessionConfig } from './config.js';
import { reqlocationCommand, handleIncomingLocation } from './modules/location.js';
import { WAMessageStubType } from '@whiskeysockets/baileys';
import { usermanualCommand } from './modules/usermanual.js';
import {
  currencyCommand, qrCommand, defineCommand, weatherCommand, pwnedCommand,
  ownerCommand, scriptCommand, modeCommand, getMode,
  shortenCommand, newsCommand, hackernewsCommand, wikiCommand,
  jokeCommand, adviceCommand, factCommand,
} from './modules/utility.js';
import {
  bookCommand, imageCommand, movieCommand, songCommand as songInfoCommand, lyricsCommand,
  coupleppCommand,
} from './modules/media.js';
import { pptCommand } from './modules/ppt.js';
import {
  welcomeCommand, goodbyeCommand, kickallCommand, kickccCommand,
  setdescCommand as setgdescCommand, setgppCommand, approveallCommand, declineallCommand,
  leaveCommand, joinCommand, openCommand, closeCommand, tagallCommand, hidetagCommand, muteCommand, unmuteCommand,
  archiveCommand, unarchiveCommand, clearchatCommand,
  rejectcallsCommand, attachCallRejector, pddCommand
} from './modules/group.js';
import { setppCommand, setaboutCommand, chatstatsCommand, blockCommand, unblockCommand, blocklistCommand, unblockallCommand, setstatusCommand, getstatusCommand, getpairCommand, setsessionCommand, addsessionCommand, delsessionCommand, setvarCommand, getvarCommand, delvarCommand, addownerCommand, delownerCommand, ownerlistCommand } from './modules/owner.js';
import { gitdlCommand, mfdlCommand } from './modules/downloader.js';
import { igCommand, tiktokCommand, fbCommand } from './modules/social.js';
import { attachPresenceTracker, stalkCommand } from './modules/presence-track.js';
import { extractInteractiveResponse, matchChoice } from './lib/buttons.js';
import { textmakerCommand, handleTextmakerCommand } from './modules/textmaker.js';
import { EPHOTO_EFFECTS } from './lib/ephoto360.js';
import { geminiCommand, photoCommand } from './modules/gemini.js';
import { pinchatCommand, unpinchatCommand } from './modules/pin.js';
import { disappearingCommand } from './modules/disappearing.js';
import { playCommand, ytvCommand, ytdlCommand } from './modules/ytdlp-commands.js';
import { wpCommand, dpCommand } from './modules/theme.js';

const CRITICAL_COMMANDS = new Set([
  'ghost', 'peek', 'lurk', 'schedule', 'disappearing',
  'kick', 'add', 'promote', 'demote',
  'antilink', 'antispam', 'antisticker',
  'presence', 'activity',
  'stalk', 'mode', 'prefix', 'update',
  'kickall', 'kickcc', 'setdesc', 'setgpp',
  'approveall', 'declineall', 'leave', 'join',
  'mute', 'unmute', 'archive', 'unarchive', 'clearchat',
  'rejectcalls', 'setpp', 'setabout', 'chatstats', 'setsession',
  'addsession', 'delsession', 'replymode',
  'setvar', 'getvar', 'delvar',
  'addowner', 'delowner', 'ownerlist',
  'gitdl', 'mfdl', 'url', 'pdl', 'pdlzip', 'restart', 'pinchat', 'unpinchat', 'pdd', 'tag',
]);

const attachedSockets = new WeakSet();

function attachBackground(sock) {
  if (!sock || attachedSockets.has(sock)) return;
  attachedSockets.add(sock);
  try { attachPresenceTracker(sock); } catch (e) { console.error('[router] attachPresenceTracker', e.message); }
  try { attachCallRejector(sock); } catch (e) { console.error('[router] attachCallRejector', e.message); }
}

function extractQuotedText(msg) {
  const ctx = msg.message?.extendedTextMessage?.contextInfo;
  if (!ctx?.quotedMessage) return '';
  const qm = ctx.quotedMessage;
  return (
    qm.conversation ||
    qm.extendedTextMessage?.text ||
    qm.interactiveMessage?.body?.text ||
    qm.viewOnceMessage?.message?.interactiveMessage?.body?.text ||
    qm.imageMessage?.caption ||
    qm.videoMessage?.caption ||
    ''
  ).trim();
}

function plainText(msg) {
  const direct = (
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.message?.imageMessage?.caption ||
    msg.message?.videoMessage?.caption ||
    ''
  ).trim();

  const prefix = getPrefix();

  if (direct) {
    if (direct.startsWith(prefix)) return direct;

    const quotedText = extractQuotedText(msg);
    if (quotedText) {
      const lowerQ = quotedText.toLowerCase();
      const lowerD = direct.toLowerCase().trim();

      if (lowerQ.includes('ghost')) {
        if (lowerD === 'on' || lowerD === 'off') return `${prefix}ghost ${lowerD}`;
        if (lowerD === 'edit on' || lowerD === 'edit off') return `${prefix}ghost ${lowerD}`;
      }
      if (lowerQ.includes('lurk')) {
        if (lowerD === 'on' || lowerD === 'off') return `${prefix}lurk ${lowerD}`;
        if (lowerD.startsWith('react ') || lowerD.startsWith('download ') || lowerD.startsWith('emoji ')) {
          return `${prefix}lurk ${lowerD}`;
        }
      }
      if (lowerQ.includes('peek')) {
        if (lowerD === 'on' || lowerD === 'off') return `${prefix}peek auto ${lowerD}`;
        if (lowerD.startsWith('auto ') || lowerD.startsWith('watch ') || lowerD.startsWith('dest ')) {
          return `${prefix}peek ${lowerD}`;
        }
      }
      if (lowerQ.includes('books') || lowerQ.includes('book')) {
        const match = lowerD.match(/^(?:dl\s*)?(\d+)$/i);
        if (match) return `${prefix}book dl ${match[1]}`;
      }
    }
    return direct;
  }

  const interactiveId = extractInteractiveResponse(msg);
  if (interactiveId) {
    if (interactiveId.startsWith('book_dl_')) {
      return `${prefix}book dl ${interactiveId.replace('book_dl_', '')}`;
    }
    if (interactiveId.startsWith('menu_')) {
      return `${prefix}help ${interactiveId.replace('menu_', '')}`;
    }
    if (interactiveId.startsWith('.')) {
      return prefix === '.' ? interactiveId : prefix + interactiveId.slice(1);
    }
    if (!interactiveId.startsWith(prefix)) {
      return `${prefix}${interactiveId}`;
    }
    return interactiveId;
  }

  return '';
}

function extractEditKeyId(update) {
  const msg = update.update?.message || update.message;
  const protoKey = msg?.protocolMessage?.key;
  if (protoKey?.id) return protoKey.id;
  const editedKey = msg?.editedMessage?.key;
  if (editedKey?.id) return editedKey.id;
  return update.key?.id || null;
}

const processedCommands = new Set();
function markCommandProcessed(msgId) {
  if (!msgId) return false;
  if (processedCommands.has(msgId)) return true;
  processedCommands.add(msgId);
  if (processedCommands.size > 1000) {
    processedCommands.delete(processedCommands.values().next().value);
  }
  return false;
}

export async function dispatch(sock, update, sessionId = 'main') {
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
      const isProtoEdit = msg.message?.protocolMessage?.type === 14;

      if (kind === 'revoke') { await revealDelete(sock, msg); continue; }
      if (kind === 'edit' || isProtoEdit) {
        const protoKey = msg.message?.protocolMessage?.key;
        if (protoKey?.id && (!msg.key.id || msg.key.id === '')) {
          msg.key = { ...msg.key, id: protoKey.id };
        }
        await revealEdit(sock, msg);
        continue;
      }
      if (kind === 'secret_edit') { await revealSecretEdit(sock, msg); continue; }

      try { await remember(sock, msg); } catch (e) { console.error('[router] remember', e.message); }
      try { await autoPeek(sock, msg); } catch (e) { console.error('[router] autoPeek', e.message); }
      try { await watchQuotedViewOnce(sock, msg); } catch (e) { console.error('[router] watchQuotedViewOnce', e.message); }

      try {
        const msgId = msg.key?.id;
        const ledgerRec = getLedgerEntry(msgId);
        const sender = msg.key.participant || msg.key.remoteJid || 'N/A';
        const direction = msg.key.fromMe ? 'OUTGOING' : 'INCOMING';
        const text = plainText(msg) || ledgerRec?.text || '';
        const mediaType = ledgerRec?.media || (
          msg.message?.imageMessage ? 'image' :
          msg.message?.videoMessage ? 'video' :
          msg.message?.audioMessage ? 'audio' :
          msg.message?.stickerMessage ? 'sticker' :
          msg.message?.documentMessage ? 'document' : null
        );
        const mediaPath = ledgerRec?.file || null;
        const timestamp = msg.messageTimestamp ? (Number(msg.messageTimestamp) * 1000) : Date.now();

        logMessageHistory({
          sessionId, direction, chatJid: chat, senderJid: sender,
          messageText: text, mediaType, mediaPath, timestamp, msgId
        });
      } catch (e) { console.error('[router] logMessageHistory', e.message); }

      if (chat === 'status@broadcast') continue;

      try { await applyAutoPresence(sock, chat); } catch (e) { console.error('[router] applyAutoPresence', e.message); }

      try {
        const blocked = await handleProtection(sock, chat, msg, plainText(msg));
        if (blocked) continue;
      } catch (e) { console.error('[router] handleProtection', e.message); }

      if (msg.message?.locationMessage || msg.message?.liveLocationMessage) {
        try { await handleIncomingLocation(sock, chat, msg); } catch (e) { console.error('[router] handleIncomingLocation', e.message); }
      }

      const prefix = getPrefix();
      let text = plainText(msg);

      const msgSender = msg.key.participant || msg.key.remoteJid;
      const senderIsOwner = msg.key.fromMe || isOwner(msgSender);

      if (text && !text.startsWith(prefix)) {
        const chosenId = matchChoice(chat, msgSender, text);
        if (chosenId) {
          text = chosenId.startsWith(prefix) ? chosenId : `${prefix}${chosenId}`;
        }
      }

      if (!text.startsWith(prefix)) continue;

      const withoutPrefix = text.slice(prefix.length);
      if (!withoutPrefix.trim()) continue;

      if (msg.key?.id && markCommandProcessed(msg.key.id)) continue;

      const firstSpace = withoutPrefix.indexOf(' ');
      const verb = (firstSpace === -1 ? withoutPrefix : withoutPrefix.slice(0, firstSpace)).toLowerCase();
      const rest = firstSpace === -1 ? [] : withoutPrefix.slice(firstSpace + 1).trim().split(/\s+/);

      const mode = getMode();
      if (!senderIsOwner) {
        if (mode === 'private') continue;
        if (CRITICAL_COMMANDS.has(verb)) {
          try { await sock.sendMessage(chat, { text: '⛔ Owner only.' }, { quoted: msg }); } catch {}
          continue;
        }
      }

      const EPHOTO_LIST = [...Object.keys(EPHOTO_EFFECTS), 'textmaker'];

      const KNOWN = new Set([...CRITICAL_COMMANDS, ...EPHOTO_LIST,
        'dl', 'download', 'mp3', 'song', 'songinfo', 'help', 'menu', 'ping', 'usermanual',
        'currency', 'qr', 'define', 'weather', 'pwned', 'owner', 'script', 'repo',
        'book', 'books', 'img', 'image', 'movie', 'lyrics', 'ppt', 'couplepp',
        'welcome', 'goodbye', 'getpp', 'ig', 'tiktok', 'fb',
        'igpost', 'tiktokpost', 'fbpost', 'pdl', 'pdlzip', 'postdl',
        'alive', 'uptime', 'restart', 'replymode', 'reqlocation',
        'twitter', 'tw', 'pinterest', 'pin', 'threads', 'reddit', 'soundcloud', 'sc', 'spotify', 'spot', 'youtube', 'yt',
        'gemini', 'photo', 'pinchat', 'unpinchat', 'pdd', 'tag', 'disappearing', 'play', 'ytv', 'ytdl',
        'shorten', 'tinyurl', 'shorturl', 'news', 'hackernews', 'hn', 'wiki', 'wikipedia', 'joke', 'advice', 'fact',
        'wp', 'dp', 'resetwp'
      ]);

      if (KNOWN.has(verb)) {
        try { await sock.sendMessage(chat, { react: { text: '⌛', key: msg.key } }); } catch (e) { console.error('[router] react', e.message); }
      }

      const csock = sock;

      if (EPHOTO_LIST.includes(verb) && verb !== 'textmaker') {
        await handleTextmakerCommand(csock, chat, msg, verb, rest);
        continue;
      }

      if (/^wp\d+$/i.test(verb)) {
        const num = verb.replace(/\D/g, '');
        await wpCommand(csock, chat, msg, rest, num);
        continue;
      }

      try {
        switch (verb) {
          case 'ghost': await ghostCommand(csock, chat, msg, rest); break;
          case 'peek': await peekCommand(csock, chat, msg, rest); break;
          case 'lurk': await lurkCommand(csock, chat, msg, rest); break;
          case 'ping': await pingCommand(csock, chat, msg); break;
          case 'alive': await aliveCommand(csock, chat, msg); break;
          case 'uptime': await uptimeCommand(csock, chat, msg); break;
          case 'restart': await restartCommand(csock, chat, msg); break;
          case 'reset': {
            const target = (rest[0] || '').toLowerCase();
            if (target === 'wp' || target === 'wallpaper') {
              await wpCommand(csock, chat, msg, rest, 'reset');
            } else {
              await restartCommand(csock, chat, msg);
            }
            break;
          }
          case 'wp':
            if ((rest[0] || '').toLowerCase() === 'reset') {
              await wpCommand(csock, chat, msg, rest, 'reset');
            } else {
              await wpCommand(csock, chat, msg, rest);
            }
            break;
          case 'dp':
            await dpCommand(csock, chat, msg, rest);
            break;
          case 'resetwp':
            await wpCommand(csock, chat, msg, rest, 'reset');
            break;
          case 'song': await songCommand(csock, chat, msg, rest); break;
          case 'play': await playCommand(csock, chat, msg, rest); break;
          case 'ytv': await ytvCommand(csock, chat, msg, rest); break;
          case 'ytdl': await ytdlCommand(csock, chat, msg, rest); break;
          case 'disappearing': await disappearingCommand(csock, chat, msg, rest); break;
          case 'dl':
          case 'download': await dlCommand(csock, chat, msg, rest); break;
          case 'mp3': await mp3Command(csock, chat, msg, rest); break;
          case 'pdl':
          case 'postdl': await pdlCommand(csock, chat, msg, rest); break;
          case 'pdlzip': await pdlzipCommand(csock, chat, msg, rest); break;
          case 'twitter':
          case 'tw': await twitterCommand(csock, chat, msg, rest); break;
          case 'pinterest':
          case 'pin': await pinterestCommand(csock, chat, msg, rest); break;
          case 'threads': await threadsCommand(csock, chat, msg, rest); break;
          case 'reddit': await redditCommand(csock, chat, msg, rest); break;
          case 'soundcloud':
          case 'sc': await soundcloudCommand(csock, chat, msg, rest); break;
          case 'spotify':
          case 'spot': await spotifyCommand(csock, chat, msg, rest); break;
          case 'youtube':
          case 'yt': await youtubeCommand(csock, chat, msg, rest); break;
          case 'textmaker': await textmakerCommand(csock, chat, msg, rest); break;
          case 'gemini': await geminiCommand(csock, chat, msg, rest); break;
          case 'photo': await photoCommand(csock, chat, msg, rest); break;
          case 'pinchat': await pinchatCommand(csock, chat, msg); break;
          case 'unpinchat': await unpinchatCommand(csock, chat, msg); break;
          case 'pdd': await pddCommand(csock, chat, msg, rest); break;
          case 'songinfo': await songInfoCommand(csock, chat, msg, rest); break;
          case 'prefix': await prefixCommand(csock, chat, msg, rest); break;
          case 'help':
          case 'menu': await helpCommand(csock, chat, msg, rest); break;
          case 'usermanual': await usermanualCommand(csock, chat, msg); break;
          case 'schedule': await scheduleCommand(csock, chat, msg, rest); break;
          case 'kick': await adminAction(csock, chat, msg, rest, 'remove'); break;
          case 'add': await adminAction(csock, chat, msg, rest, 'add'); break;
          case 'promote': await adminAction(csock, chat, msg, rest, 'promote'); break;
          case 'demote': await adminAction(csock, chat, msg, rest, 'demote'); break;
          case 'antilink': await toggleProtection(csock, chat, msg, rest, 'antilink'); break;
          case 'antispam': await toggleProtection(csock, chat, msg, rest, 'antispam'); break;
          case 'antisticker': await toggleProtection(csock, chat, msg, rest, 'antisticker'); break;
          case 'getpp': await getppCommand(csock, chat, msg, rest); break;
          case 'getjid': await getjidCommand(csock, chat, msg, rest); break;
          case 'presence': await presenceCommand(csock, chat, msg, rest); break;
          case 'activity': await activityCommand(csock, chat, msg, rest); break;
          case 'update': await updateCommand(csock, chat, msg, rest); break;
          case 'currency': await currencyCommand(csock, chat, msg, rest); break;
          case 'qr': await qrCommand(csock, chat, msg, rest); break;
          case 'define': await defineCommand(csock, chat, msg, rest); break;
          case 'weather': await weatherCommand(csock, chat, msg, rest); break;
          case 'shorten':
          case 'tinyurl':
          case 'shorturl': await shortenCommand(csock, chat, msg, rest); break;
          case 'news': await newsCommand(csock, chat, msg, rest); break;
          case 'hackernews':
          case 'hn': await hackernewsCommand(csock, chat, msg); break;
          case 'wiki':
          case 'wikipedia': await wikiCommand(csock, chat, msg, rest); break;
          case 'joke': await jokeCommand(csock, chat, msg); break;
          case 'advice': await adviceCommand(csock, chat, msg); break;
          case 'fact': await factCommand(csock, chat, msg); break;
          case 'pwned': await pwnedCommand(csock, chat, msg, rest); break;
          case 'owner': await ownerCommand(csock, chat, msg, rest); break;
          case 'addowner': await addownerCommand(csock, chat, msg, rest); break;
          case 'delowner': await delownerCommand(csock, chat, msg, rest); break;
          case 'ownerlist': await ownerlistCommand(csock, chat, msg); break;
          case 'script':
          case 'repo': await scriptCommand(csock, chat, msg); break;
          case 'mode': await modeCommand(csock, chat, msg, rest); break;
          case 'replymode': {
            if (!senderIsOwner) {
              await sock.sendMessage(chat, { text: '⛔ Owner only.' }, { quoted: msg });
              break;
            }
            const modeArg = (rest[0] || '').toLowerCase();
            if (modeArg === 'text' || modeArg === 'buttons') {
              setReplyMode(modeArg);
              await sock.sendMessage(chat, { text: `✅ Reply mode set to *${modeArg}*` }, { quoted: msg });
            } else {
              const cur = getReplyMode();
              await sock.sendMessage(chat, { text: `ℹ️ Current reply mode: *${cur}*\n\nUsage:\n• \`${prefix}replymode buttons\`\n• \`${prefix}replymode text\`` }, { quoted: msg });
            }
            break;
          }
          case 'reqlocation': await reqlocationCommand(csock, chat, msg); break;
          case 'book':
          case 'books': await bookCommand(csock, chat, msg, rest); break;
          case 'img':
          case 'image': await imageCommand(csock, chat, msg, rest); break;
          case 'movie': await movieCommand(csock, chat, msg, rest); break;
          case 'lyrics': await lyricsCommand(csock, chat, msg, rest); break;
          case 'ppt': await pptCommand(csock, chat, msg, rest); break;
          case 'couplepp': await coupleppCommand(csock, chat, msg, rest); break;
          case 'welcome': await welcomeCommand(csock, chat, msg, rest); break;
          case 'goodbye': await goodbyeCommand(csock, chat, msg, rest); break;
          case 'kickall': await kickallCommand(csock, chat, msg, rest); break;
          case 'kickcc': await kickccCommand(csock, chat, msg, rest); break;
          case 'setdesc':
          case 'setgdesc': await setgdescCommand(csock, chat, msg, rest); break;
          case 'setgpp': await setgppCommand(csock, chat, msg, rest); break;
          case 'open': await openCommand(csock, chat, msg); break;
          case 'close': await closeCommand(csock, chat, msg); break;
          case 'tag':
          case 'tagall': await tagallCommand(csock, chat, msg, rest); break;
          case 'hidetag': await hidetagCommand(csock, chat, msg, rest); break;
          case 'approveall': await approveallCommand(csock, chat, msg, rest); break;
          case 'declineall': await declineallCommand(csock, chat, msg, rest); break;
          case 'leave': await leaveCommand(csock, chat, msg, rest); break;
          case 'join': await joinCommand(csock, chat, msg, rest); break;
          case 'mute': await muteCommand(csock, chat, msg, rest); break;
          case 'unmute': await unmuteCommand(csock, chat, msg); break;
          case 'archive': await archiveCommand(csock, chat, msg); break;
          case 'unarchive': await unarchiveCommand(csock, chat, msg); break;
          case 'clearchat': await clearchatCommand(csock, chat, msg); break;
          case 'rejectcalls': await rejectcallsCommand(csock, chat, msg, rest); break;
          case 'getpair': await getpairCommand(csock, chat, msg, rest); break;
          case 'setsession': await setsessionCommand(csock, chat, msg, rest); break;
          case 'addsession': await addsessionCommand(csock, chat, msg, rest); break;
          case 'delsession': await delsessionCommand(csock, chat, msg, rest); break;
          case 'setvar': await setvarCommand(csock, chat, msg, rest); break;
          case 'getvar': await getvarCommand(csock, chat, msg, rest); break;
          case 'delvar': await delvarCommand(csock, chat, msg, rest); break;
          case 'block': await blockCommand(csock, chat, msg, rest); break;
          case 'unblock': await unblockCommand(csock, chat, msg, rest); break;
          case 'blocklist': await blocklistCommand(csock, chat, msg); break;
          case 'unblockall': await unblockallCommand(csock, chat, msg); break;
          case 'setstatus': await setstatusCommand(csock, chat, msg, rest); break;
          case 'getstatus': await getstatusCommand(csock, chat, msg, rest); break;
          case 'setpp': await setppCommand(csock, chat, msg, rest); break;
          case 'setabout': await setaboutCommand(csock, chat, msg, rest); break;
          case 'chatstats': await chatstatsCommand(csock, chat, msg, rest); break;
          case 'gitdl': await gitdlCommand(csock, chat, msg, rest); break;
          case 'mfdl': await mfdlCommand(csock, chat, msg, rest); break;
          case 'ig':
          case 'igpost': await igCommand(csock, chat, msg, rest); break;
          case 'tiktok':
          case 'tiktokpost': await tiktokCommand(csock, chat, msg, rest); break;
          case 'fb':
          case 'fbpost': await fbCommand(csock, chat, msg, rest); break;
          case 'stalk': await stalkCommand(csock, chat, msg, rest); break;
          case 'url': await urlCommand(csock, chat, msg, rest); break;
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
      const upd = u.update || {};
      const outerMsg = upd.message || u.message;
      if (upd.messageStubType === WAMessageStubType.REVOKE || upd.message === null) {
        await revealDelete(sock, {
          key: u.key,
          participant: u.participant || u.key.participant,
          message: { protocolMessage: { type: 0, key: u.key } }
        });
        continue;
      }
      if (!outerMsg) continue;
      if (outerMsg.secretEncryptedMessage?.secretEncType === 2) {
        await revealSecretEdit(sock, {
          key: u.key,
          participant: u.participant || u.key.participant,
          message: { secretEncryptedMessage: outerMsg.secretEncryptedMessage }
        });
        continue;
      }
      if (outerMsg.protocolMessage) {
        const pm = outerMsg.protocolMessage;
        const envelope = {
          key: u.key,
          participant: u.participant || u.key.participant,
          message: { protocolMessage: pm }
        };
        if (pm.type === 14 || pm.type === 'MESSAGE_EDIT') {
          await revealEdit(sock, envelope);
        } else if (pm.type === 0 || pm.type === 'REVOKE') {
          await revealDelete(sock, envelope);
        }
        continue;
      }
      const editedWrapper = outerMsg.editedMessage;
      if (editedWrapper) {
        const recoveredId = editedWrapper.key?.id || u.key?.id || null;
        const originalKey = { ...u.key, id: recoveredId };
        await revealEdit(sock, {
          key: originalKey,
          participant: u.participant || u.key.participant,
          message: {
            protocolMessage: {
              type: 14,
              key: originalKey,
              editedMessage: editedWrapper.message || editedWrapper
            }
          }
        });
      }
    } catch (e) { console.error('[dispatchUpdate]', e.message); }
  }
}

export async function dispatchStatus(sock, payload) {
  try { await lurkTick(sock, payload); } catch (e) { console.error('[dispatchStatus]', e); }
}
