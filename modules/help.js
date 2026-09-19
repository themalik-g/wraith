// ─────────────────────────────────────────────
// WRAITH · modules/help.js
// Styled boxed menu — command list ONLY.
// ─────────────────────────────────────────────
import { CONFIG } from '../config.js';
import { isOwner } from '../core/identity.js';
import { getPrefix } from '../core/settings.js';
import { getMode } from './utility.js';
import { NEWSLETTER_CONTEXT } from '../lib/buttons.js';

const c = (cmd, ownerOnly = false) => ({ cmd, ownerOnly });

const REGISTRY = [
  {
    id: 'core',
    icon: '🛡️',
    title: 'ᴄᴏʀᴇ',
    commands: [
      c('.alive'),
      c('.ping'),
      c('.uptime'),
      c('.restart', true),
      c('.help'),
      c('.menu'),
      c('.usermanual'),
      c('.prefix', true),
      c('.mode', true),
      c('.update', true),
      c('.script'),
      c('.repo'),
      c('.owner'),
    ],
  },
  {
    id: 'ghost',
    icon: '👻',
    title: 'ɢʜᴏꜱᴛ',
    commands: [
      c('.ghost', true),
      c('.ghost on', true),
      c('.ghost off', true),
      c('.ghost edit on', true),
      c('.ghost edit off', true),
    ],
  },
  {
    id: 'peek',
    icon: '👀',
    title: 'ᴘᴇᴇᴋ',
    commands: [
      c('.peek', true),
      c('.peek auto on', true),
      c('.peek auto off', true),
      c('.peek watch on', true),
      c('.peek watch off', true),
      c('.peek dest owner', true),
      c('.peek dest same', true),
      c('.peek dest both', true),
    ],
  },
  {
    id: 'lurk',
    icon: '🕵️',
    title: 'ʟᴜʀᴋ',
    commands: [
      c('.lurk', true),
      c('.lurk on', true),
      c('.lurk off', true),
      c('.lurk react on', true),
      c('.lurk react off', true),
      c('.lurk download on', true),
      c('.lurk download off', true),
      c('.lurk emoji ❤️', true),
      c('.lurk emoji random', true),
      c('.lurk emoji none', true),
    ],
  },
  {
    id: 'schedule',
    icon: '⏰',
    title: 'ꜱᴄʜᴇᴅᴜʟᴇ',
    commands: [
      c('.schedule', true),
      c('.schedule txt date am/pm', true),
      c('.schedule open date am/pm', true),
      c('.schedule close date am/pm', true),
      c('.schedule list', true),
      c('.schedule cancel <id>', true),
      c('.schedule media date am/pm (reply)', true),
    ],
  },
  {
    id: 'utility',
    aliases: ['tools'],
    icon: '🔧',
    title: 'ᴜᴛɪʟɪᴛʏ',
    commands: [
      c('.currency <from> <to> [amount]'),
      c('.qr <text>'),
      c('.qr read'),
      c('.define <word>'),
      c('.weather <city>'),
      c('.pwned <password>'),
      c('.url (reply media)'),
      c('.reqlocation'),
    ],
  },
  {
    id: 'media',
    icon: '📚',
    title: 'ᴍᴇᴅɪᴀ',
    commands: [
      c('.book <query>'),
      c('.book dl <number>'),
      c('.img <query> [count]'),
      c('.couplepp [count]'),
      c('.movie <title>'),
      c('.songinfo <title> [artist]'),
      c('.lyrics <artist> - <title>'),
      c('.ppt <topic>'),
    ],
  },
  {
    id: 'download',
    aliases: ['dl'],
    icon: '⬇️',
    title: 'ᴅᴏᴡɴʟᴏᴀᴅ',
    commands: [
      c('.dl <url>'),
      c('.dl audio <url>'),
      c('.dl mp3 <url>'),
      c('.pdl <post-url>'),
      c('.pdlzip <post-url>'),
      c('.download <url>'),
      c('.song <query>'),
      c('.gitdl <github-url>', true),
      c('.mfdl <mediafire-url>', true),
    ],
  },
  {
    id: 'social',
    aliases: ['socialsearch'],
    icon: '🔍',
    title: 'ꜱᴏᴄɪᴀʟ ꜱᴇᴀʀᴄʜ / ᴅᴏᴡɴʟᴏᴀᴅ',
    commands: [
      c('.ig <username/url>'),
      c('.tiktok <username/url>'),
      c('.fb <username/url>'),
    ],
  },
  {
    id: 'group',
    aliases: ['admin', 'groupadmin'],
    icon: '👥',
    title: 'ɢʀᴏᴜᴘ ᴀᴅᴍɪɴ',
    commands: [
      c('.open', true),
      c('.close', true),
      c('.kick (reply/num)', true),
      c('.add <number>', true),
      c('.promote (reply/num)', true),
      c('.demote (reply/num)', true),
      c('.tagall [msg]', true),
      c('.hidetag [msg]', true),
      c('.setgdesc <text>', true),
      c('.setgpp', true),
      c('.welcome on'),
      c('.welcome off'),
      c('.goodbye on'),
      c('.goodbye off'),
      c('.antilink on/off', true),
      c('.antispam on/off', true),
      c('.antisticker on/off', true),
      c('.kickall', true),
      c('.kickcc <code>', true),
      c('.approveall', true),
      c('.declineall', true),
      c('.leave', true),
      c('.join <link>', true),
    ],
  },
  {
    id: 'owner',
    aliases: ['profile', 'ownerprofile'],
    icon: '👤',
    title: 'ᴏᴡɴᴇʀ ᴘʀᴏꜰɪʟᴇ',
    commands: [
      c('.setpp', true),
      c('.setabout <text>', true),
      c('.setstatus (reply/text)', true),
      c('.getstatus <number/jid>', true),
      c('.replymode <buttons/text>', true),
      c('.getpair <number>', true),
      c('.setsession [number]', true),
      c('.addsession <number>', true),
      c('.delsession <id>', true),
      c('.setvar <key> <val>', true),
      c('.getvar <key/all>', true),
      c('.delvar <key>', true),
      c('.block (reply/num)', true),
      c('.unblock (reply/num)', true),
      c('.blocklist', true),
      c('.unblockall', true),
      c('.rejectcalls on', true),
      c('.rejectcalls off', true),
      c('.stalk <number>', true),
      c('.stalk list', true),
      c('.stalk stop <number>', true),
      c('.chatstats <number>', true),
      c('.addowner <number>', true),
      c('.delowner <number>', true),
      c('.owner list', true),
    ],
  },
  {
    id: 'chat',
    aliases: ['chatcontrols'],
    icon: '💬',
    title: 'ᴄʜᴀᴛ ᴄᴏɴᴛʀᴏʟꜱ',
    commands: [
      c('.mute [8h|1d|forever]', true),
      c('.unmute', true),
      c('.archive', true),
      c('.unarchive', true),
      c('.clearchat', true),
    ],
  },
  {
    id: 'jid',
    aliases: ['jidprofile'],
    icon: '🧭',
    title: 'ᴊɪᴅ / ᴘʀᴏꜰɪʟᴇ',
    commands: [
      c('.getjid', true),
      c('.getpp'),
      c('.presence', true),
      c('.presence online on/off', true),
      c('.presence typing on/off', true),
      c('.presence recording on/off', true),
      c('.presence reads on/off', true),
      c('.activity', true),
    ],
  },
];

const TAIL = '└─────────────┈⚝';

function applyPrefix(cmd, prefix) {
  if (prefix === '.') return cmd;
  return cmd.startsWith('.') ? prefix + cmd.slice(1) : cmd;
}

function renderBox(icon, title, rows, prefix) {
  const lines = [];
  lines.push(`┌──❮ ${icon} ${title} ❯`);
  lines.push('│');
  for (const r of rows) lines.push(`│ ◈ ${applyPrefix(r, prefix)}`);
  lines.push('│');
  lines.push(TAIL);
  return lines.join('\n');
}

function visibleRegistry(isOwnerUser) {
  if (isOwnerUser) return REGISTRY;
  return REGISTRY
    .map((g) => ({
      ...g,
      commands: g.commands.filter((x) => !x.ownerOnly),
    }))
    .filter((g) => g.commands.length > 0);
}

function renderAll(prefix, isOwnerUser, mode) {
  const groups = visibleRegistry(isOwnerUser);

  const headerLines = [
    '┌──❮ ⓌⓇⒶⒾⓉⒽ ❯',
    '│',
  ];

  if (isOwnerUser || mode !== 'public') {
    headerLines.push('│ ᴄᴏᴍᴍᴀɴᴅꜱ ᴀʀᴇ ᴏᴡɴᴇʀ-ᴏɴʟʏ');
  } else {
    headerLines.push('│ ᴘᴜʙʟɪᴄ ᴍᴏᴅᴇ · ꜱᴏᴍᴇ ᴄᴏᴍᴍᴀɴᴅꜱ ʜɪᴅᴅᴇɴ');
  }

  headerLines.push(`│ ᴘʀᴇꜰɪx · ${prefix}`);
  headerLines.push(`│ ℹ️ ${prefix}ᴄᴏᴍᴍᴀɴᴅ ꜰᴏʀ ɢᴜɪᴅᴇ`);
  headerLines.push('│');
  headerLines.push(TAIL);

  const header = headerLines.join('\n');

  const sections = groups.map((g) =>
    renderBox(g.icon, g.title, g.commands.map((x) => x.cmd), prefix)
  );

  return [header, ...sections, '', 'ⓌⓇⒶⒾⓉ⓽'].join('\n');
}

function findGroup(name) {
  const wanted = String(name || '').toLowerCase().replace(/[^a-z]/g, '');
  if (!wanted) return null;
  return (
    REGISTRY.find((g) => {
      const ids = [g.id, ...(g.aliases || [])];
      if (ids.some((x) => x.toLowerCase() === wanted)) return true;
      const cleanedTitle = g.title.replace(/[^a-z]/gi, '').toLowerCase();
      return cleanedTitle === wanted;
    }) || null
  );
}

async function sendSafe(sock, chat, msg, text) {
  const MAX = 3500;
  if (text.length <= MAX) {
    return sock.sendMessage(chat, { text, contextInfo: NEWSLETTER_CONTEXT }, { quoted: msg });
  }
  const parts = [];
  let buf = '';
  for (const line of text.split('\n')) {
    if ((buf + '\n' + line).length > MAX) {
      if (buf) parts.push(buf);
      buf = line;
    } else {
      buf = buf ? buf + '\n' + line : line;
    }
  }
  if (buf) parts.push(buf);
  for (const p of parts) {
    await sock.sendMessage(chat, { text: p, contextInfo: NEWSLETTER_CONTEXT }, { quoted: msg });
  }
}

export async function helpCommand(sock, chat, msg, args) {
  try {
    const from = msg.key.participant || msg.key.remoteJid;
    const isOwnerUser = msg.key.fromMe || isOwner(from);
    const prefix = getPrefix();

    let mode = 'private';
    try { mode = getMode(); } catch {}

    const target = (args?.[0] || '').toLowerCase().trim();

    if (!target) {
      const text = renderAll(prefix, isOwnerUser, mode);
      return sendSafe(sock, chat, msg, text);
    }

    const group = findGroup(target);

    if (!group) {
      const avail = visibleRegistry(isOwnerUser)
        .map((g) => `• ${g.id}`)
        .join(' · ');
      return sock.sendMessage(
        chat,
        { text: `❓ no menu page called _${target}_.\n\n${avail}`, contextInfo: NEWSLETTER_CONTEXT },
        { quoted: msg }
      );
    }

    const visible = isOwnerUser
      ? group.commands.map((x) => x.cmd)
      : group.commands.filter((x) => !x.ownerOnly).map((x) => x.cmd);

    if (!visible.length) {
      return sock.sendMessage(
        chat,
        { text: `🔒 _${group.title}_ is owner-only.`, contextInfo: NEWSLETTER_CONTEXT },
        { quoted: msg }
      );
    }

    const box = renderBox(group.icon, group.title, visible, prefix);
    return sendSafe(sock, chat, msg, box);
  } catch (e) {
    try {
      await sock.sendMessage(
        chat,
        { text: `⚠️ help failed: ${e.message}`, contextInfo: NEWSLETTER_CONTEXT },
        { quoted: msg }
      );
    } catch {}
  }
}
