// router.js — WRAITH full router (lazy cold commands)
import { remember, revealDelete, revealEdit, revealSecretEdit, ghostCommand, classifyMessage, getLedgerEntry } from './modules/ghost.js';
import { logMessageHistory } from './modules/logger.js';
import { peekCommand, autoPeek, watchQuotedViewOnce } from './modules/peek.js';
import { lurkCommand, lurkTick } from './modules/lurk.js';
import { adminAction, toggleProtection, handleProtection } from './modules/admin.js';
import { presenceCommand, shouldReadReceipts, applyAutoPresence } from './modules/presence.js';
import { activityCommand, trackActivity } from './modules/activity.js';
import { scheduleCommand } from './modules/schedule.js';
import { cacheChannelFromMessage } from './core/jid-resolver.js';
import { getPrefix, getReplyMode, setReplyMode } from './core/settings.js';
import { isOwner } from './core/identity.js';
import { CONFIG } from './config.js';
import { reqlocationCommand, handleIncomingLocation } from './modules/location.js';
import { WAMessageStubType } from '@whiskeysockets/baileys';
import { extractInteractiveResponse, matchChoice } from './lib/buttons.js';

// ─────────────────────────────────────────────
//  Lazy loader for cold command handlers
// ─────────────────────────────────────────────
function lazy(modPath, fnName) {
    let cached = null;
    return async function (...args) {
        if (!cached) {
            const mod = await import(modPath);
            const fn = mod[fnName];
            if (typeof fn !== 'function') {
                throw new Error(`[router] ${modPath} has no export ${fnName}`);
            }
            cached = fn;
        }
        return cached.apply(this, args);
    };
}

// ── Cold handlers (only loaded when the command is invoked) ──
const pingCommand     = lazy('./modules/ping.js', 'pingCommand');
const aliveCommand    = lazy('./modules/ping.js', 'aliveCommand');
const uptimeCommand   = lazy('./modules/ping.js', 'uptimeCommand');
const restartCommand  = lazy('./modules/ping.js', 'restartCommand');
const helpCommand     = lazy('./modules/help.js', 'helpCommand');
const getppCommand    = lazy('./modules/profile.js', 'getppCommand');
const getjidCommand   = lazy('./modules/jid.js', 'getjidCommand');
const updateCommand   = lazy('./modules/update.js', 'updateCommand');
const prefixCommand   = lazy('./modules/prefix.js', 'prefixCommand');
const dlCommand       = lazy('./modules/download.js', 'ytdlCommand');
const mp3Command      = lazy('./modules/download.js', 'mp3Command');
const pdlCommand      = lazy('./modules/download.js', 'pdlCommand');
const pdlzipCommand   = lazy('./modules/download.js', 'pdlzipCommand');
const twitterCommand  = lazy('./modules/download.js', 'twitterCommand');
const pinterestCommand= lazy('./modules/download.js', 'pinterestCommand');
const threadsCommand  = lazy('./modules/download.js', 'threadsCommand');
const redditCommand   = lazy('./modules/download.js', 'redditCommand');
const youtubeCommand  = lazy('./modules/download.js', 'youtubeCommand');
const urlCommand      = lazy('./modules/url.js', 'urlCommand');
const usermanualCommand = lazy('./modules/usermanual.js', 'usermanualCommand');

const currencyCommand = lazy('./modules/utility.js', 'currencyCommand');
const qrCommand       = lazy('./modules/utility.js', 'qrCommand');
const defineCommand   = lazy('./modules/utility.js', 'defineCommand');
const weatherCommand  = lazy('./modules/utility.js', 'weatherCommand');
const pwnedCommand    = lazy('./modules/utility.js', 'pwnedCommand');
const ownerCommand    = lazy('./modules/utility.js', 'ownerCommand');
const scriptCommand   = lazy('./modules/utility.js', 'scriptCommand');
const modeCommand     = lazy('./modules/utility.js', 'modeCommand');
const shortenCommand  = lazy('./modules/utility.js', 'shortenCommand');
const newsCommand     = lazy('./modules/utility.js', 'newsCommand');
const hackernewsCommand = lazy('./modules/utility.js', 'hackernewsCommand');
const wikiCommand     = lazy('./modules/utility.js', 'wikiCommand');
const jokeCommand     = lazy('./modules/utility.js', 'jokeCommand');
const adviceCommand   = lazy('./modules/utility.js', 'adviceCommand');
const factCommand     = lazy('./modules/utility.js', 'factCommand');

const bookCommand     = lazy('./modules/media.js', 'bookCommand');
const imageCommand    = lazy('./modules/media.js', 'imageCommand');
const movieCommand    = lazy('./modules/media.js', 'movieCommand');
const songInfoCommand = lazy('./modules/media.js', 'songCommand');
const lyricsCommand   = lazy('./modules/media.js', 'lyricsCommand');
const coupleppCommand = lazy('./modules/media.js', 'coupleppCommand');
const pptCommand      = lazy('./modules/ppt.js', 'pptCommand');

const welcomeCommand    = lazy('./modules/group.js', 'welcomeCommand');
const goodbyeCommand    = lazy('./modules/group.js', 'goodbyeCommand');
const kickallCommand    = lazy('./modules/group.js', 'kickallCommand');
const kickccCommand     = lazy('./modules/group.js', 'kickccCommand');
const setgdescCommand   = lazy('./modules/group.js', 'setdescCommand');
const setgppCommand     = lazy('./modules/group.js', 'setgppCommand');
const approveallCommand = lazy('./modules/group.js', 'approveallCommand');
const declineallCommand = lazy('./modules/group.js', 'declineallCommand');
const leaveCommand      = lazy('./modules/group.js', 'leaveCommand');
const joinCommand       = lazy('./modules/group.js', 'joinCommand');
const openCommand       = lazy('./modules/group.js', 'openCommand');
const closeCommand      = lazy('./modules/group.js', 'closeCommand');
const tagallCommand     = lazy('./modules/group.js', 'tagallCommand');
const hidetagCommand    = lazy('./modules/group.js', 'hidetagCommand');
const muteCommand       = lazy('./modules/group.js', 'muteCommand');
const unmuteCommand     = lazy('./modules/group.js', 'unmuteCommand');
const archiveCommand    = lazy('./modules/group.js', 'archiveCommand');
const unarchiveCommand  = lazy('./modules/group.js', 'unarchiveCommand');
const clearchatCommand  = lazy('./modules/group.js', 'clearchatCommand');
const rejectcallsCommand= lazy('./modules/group.js', 'rejectcallsCommand');
const pddCommand        = lazy('./modules/group.js', 'pddCommand');

const setppCommand      = lazy('./modules/owner.js', 'setppCommand');
const setaboutCommand   = lazy('./modules/owner.js', 'setaboutCommand');
const chatstatsCommand  = lazy('./modules/owner.js', 'chatstatsCommand');
const blockCommand      = lazy('./modules/owner.js', 'blockCommand');
const unblockCommand    = lazy('./modules/owner.js', 'unblockCommand');
const blocklistCommand  = lazy('./modules/owner.js', 'blocklistCommand');
const unblockallCommand = lazy('./modules/owner.js', 'unblockallCommand');
const setstatusCommand  = lazy('./modules/owner.js', 'setstatusCommand');
const getstatusCommand  = lazy('./modules/owner.js', 'getstatusCommand');
const getpairCommand    = lazy('./modules/owner.js', 'getpairCommand');
const setsessionCommand = lazy('./modules/owner.js', 'setsessionCommand');
const addsessionCommand = lazy('./modules/owner.js', 'addsessionCommand');
const delsessionCommand = lazy('./modules/owner.js', 'delsessionCommand');
const setvarCommand     = lazy('./modules/owner.js', 'setvarCommand');
const getvarCommand     = lazy('./modules/owner.js', 'getvarCommand');
const delvarCommand     = lazy('./modules/owner.js', 'delvarCommand');
const addownerCommand   = lazy('./modules/owner.js', 'addownerCommand');
const delownerCommand   = lazy('./modules/owner.js', 'delownerCommand');
const ownerlistCommand  = lazy('./modules/owner.js', 'ownerlistCommand');

const gitdlCommand = lazy('./modules/downloader.js', 'gitdlCommand');
const mfdlCommand  = lazy('./modules/downloader.js', 'mfdlCommand');
const igCommand    = lazy('./modules/social.js', 'igCommand');
const tiktokCommand= lazy('./modules/social.js', 'tiktokCommand');
const fbCommand    = lazy('./modules/social.js', 'fbCommand');
const stalkCommand = lazy('./modules/presence-track.js', 'stalkCommand');
const textmakerCommand = lazy('./modules/textmaker.js', 'textmakerCommand');
const handleTextmakerCommand = lazy('./modules/textmaker.js', 'handleTextmakerCommand');
const geminiCommand = lazy('./modules/gemini.js', 'geminiCommand');
const photoCommand  = lazy('./modules/gemini.js', 'photoCommand');
const pinchatCommand   = lazy('./modules/pin.js', 'pinchatCommand');
const unpinchatCommand = lazy('./modules/pin.js', 'unpinchatCommand');
const disappearingCommand = lazy('./modules/disappearing.js', 'disappearingCommand');
const playCommand   = lazy('./modules/ytdlp-commands.js', 'playCommand');
const ytvCommand    = lazy('./modules/ytdlp-commands.js', 'ytvCommand');
const videoCommand  = lazy('./modules/ytdlp-commands.js', 'videoCommand');
const ytdlCommand   = lazy('./modules/ytdlp-commands.js', 'ytdlCommand');
const wpCommand     = lazy('./modules/theme.js', 'wpCommand');
const dpCommand     = lazy('./modules/theme.js', 'dpCommand');

// getMode + EPHOTO list, resolved lazily via cached promises
let _getModePromise = null;
function getModeLazy() {
    if (!_getModePromise) {
        _getModePromise = import('./modules/utility.js').then(m => m.getMode);
    }
    return _getModePromise.then(fn => fn());
}

let _ephotoListPromise = null;
function getEphotoList() {
    if (!_ephotoListPromise) {
        _ephotoListPromise = import('./lib/ephoto360.js').then(m => [...Object.keys(m.EPHOTO_EFFECTS), 'textmaker']);
    }
    return _ephotoListPromise;
}

// ─────────────────────────────────────────────
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

async function attachBackground(sock) {
  if (!sock || attachedSockets.has(sock)) return;
  attachedSockets.add(sock);
  try {
    const m = await import('./modules/presence-track.js');
    if (m?.attachPresenceTracker) m.attachPresenceTracker(sock);
  } catch (e) { console.error('[router] attachPresenceTracker', e.message); }
  try {
    const m = await import('./modules/group.js');
    if (m?.attachCallRejector) m.attachCallRejector(sock);
  } catch (e) { console.error('[router] attachCallRejector', e.message); }
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
    if (interactiveId.startsWith('book_dl_')) return `${prefix}book dl ${interactiveId.replace('book_dl_', '')}`;
    if (interactiveId.startsWith('menu_')) return `${prefix}help ${interactiveId.replace('menu_', '')}`;
    if (interactiveId.startsWith('.')) return prefix === '.' ? interactiveId : prefix + interactiveId.slice(1);
    if (!interactiveId.startsWith(prefix)) return `${prefix}${interactiveId}`;
    return interactiveId;
  }

  return '';
}

const processedCommands = new Set();
function markCommandProcessed(msgId) {
  if (!msgId) return false;
  if (processedCommands.has(msgId)) return true;
  processedCommands.add(msgId);
  if (processedCommands.size > 1000) processedCommands.delete(processedCommands.values().next().value);
  return false;
}

export async function dispatch(sock, update, sessionId = 'main') {
  await attachBackground(sock);
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
        logMessageHistory({ sessionId, direction, chatJid: chat, senderJid: sender, messageText: text, mediaType, mediaPath, timestamp, msgId });
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
        if (chosenId) text = chosenId.startsWith(prefix) ? chosenId : `${prefix}${chosenId}`;
      }

      if (!text.startsWith(prefix)) continue;
      const withoutPrefix = text.slice(prefix.length);
      if (!withoutPrefix.trim()) continue;
      if (msg.key?.id && markCommandProcessed(msg.key.id)) continue;

      const firstSpace = withoutPrefix.indexOf(' ');
      const verb = (firstSpace === -1 ? withoutPrefix : withoutPrefix.slice(0, firstSpace)).toLowerCase();
      const rest = firstSpace === -1 ? [] : withoutPrefix.slice(firstSpace + 1).trim().split(/\s+/);

      let mode = 'public';
      try { mode = await getModeLazy(); } catch { mode = 'public'; }
      if (!senderIsOwner) {
        if (mode === 'private') continue;
        if (CRITICAL_COMMANDS.has(verb)) {
          try { await sock.sendMessage(chat, { text: '⛔ Owner only.' }, { quoted: msg }); } catch {}
          continue;
        }
      }

      let EPHOTO_LIST = [];
      try { EPHOTO_LIST = await getEphotoList(); } catch { EPHOTO_LIST = ['textmaker']; }

      const KNOWN = new Set([...CRITICAL_COMMANDS, ...EPHOTO_LIST,
        'dl', 'download', 'mp3', 'songinfo', 'help', 'menu', 'ping', 'usermanual',
        'currency', 'qr', 'define', 'weather', 'pwned', 'owner', 'script', 'repo',
        'book', 'books', 'img', 'image', 'movie', 'lyrics', 'ppt', 'couplepp',
        'welcome', 'goodbye', 'getpp', 'ig', 'tiktok', 'fb',
        'igpost', 'tiktokpost', 'fbpost', 'pdl', 'pdlzip', 'postdl',
        'alive', 'uptime', 'restart', 'replymode', 'reqlocation',
        'twitter', 'tw', 'pinterest', 'pin', 'threads', 'reddit', 'youtube', 'yt',
        'gemini', 'photo', 'pinchat', 'unpinchat', 'disappearing', 'play', 'ytv', 'video', 'ytdl',
        'shorten', 'tinyurl', 'shorturl', 'news', 'hackernews', 'hn', 'wiki', 'wikipedia', 'joke', 'advice', 'fact',
        'wp', 'dp', 'resetwp',
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
            if (target === 'wp' || target === 'wallpaper') await wpCommand(csock, chat, msg, rest, 'reset');
            else await restartCommand(csock, chat, msg);
            break;
          }
          case 'wp':
            if ((rest[0] || '').toLowerCase() === 'reset') await wpCommand(csock, chat, msg, rest, 'reset');
            else await wpCommand(csock, chat, msg, rest);
            break;
          case 'dp': await dpCommand(csock, chat, msg, rest); break;
          case 'resetwp': await wpCommand(csock, chat, msg, rest, 'reset'); break;
          case 'play': await playCommand(csock, chat, msg, rest); break;
          case 'ytv':
          case 'video': await ytvCommand(csock, chat, msg, rest); break;
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
            if (!senderIsOwner) { await sock.sendMessage(chat, { text: '⛔ Owner only.' }, { quoted: msg }); break; }
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
        await revealDelete(sock, { key: u.key, participant: u.participant || u.key.participant, message: { protocolMessage: { type: 0, key: u.key } } });
        continue;
      }
      if (!outerMsg) continue;
      if (outerMsg.secretEncryptedMessage?.secretEncType === 2) {
        await revealSecretEdit(sock, { key: u.key, participant: u.participant || u.key.participant, message: { secretEncryptedMessage: outerMsg.secretEncryptedMessage } });
        continue;
      }
      if (outerMsg.protocolMessage) {
        const pm = outerMsg.protocolMessage;
        const envelope = { key: u.key, participant: u.participant || u.key.participant, message: { protocolMessage: pm } };
        if (pm.type === 14 || pm.type === 'MESSAGE_EDIT') await revealEdit(sock, envelope);
        else if (pm.type === 0 || pm.type === 'REVOKE') await revealDelete(sock, envelope);
        continue;
      }
      const editedWrapper = outerMsg.editedMessage;
      if (editedWrapper) {
        const recoveredId = editedWrapper.key?.id || u.key?.id || null;
        const originalKey = { ...u.key, id: recoveredId };
        await revealEdit(sock, { key: originalKey, participant: u.participant || u.key.participant, message: { protocolMessage: { type: 14, key: originalKey, editedMessage: editedWrapper.message || editedWrapper } } });
      }
    } catch (e) { console.error('[dispatchUpdate]', e.message); }
  }
}

export async function dispatchStatus(sock, payload) {
  try { await lurkTick(sock, payload); } catch (e) { console.error('[dispatchStatus]', e); }
}
