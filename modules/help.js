// ─────────────────────────────────────────────
// WRAITH · modules/help.js
// Clean single-message plain text list menu with box layout
// ─────────────────────────────────────────────
import { isOwner } from '../core/identity.js';
import { getPrefix } from '../core/settings.js';
import { NEWSLETTER_CONTEXT, sendWithCta } from '../lib/buttons.js';

const c = (cmd, ownerOnly = false) => ({ cmd, ownerOnly });

const SMALL_CAPS = {
  a: 'ᴀ', b: 'ʙ', c: 'ᴄ', d: 'ᴅ', e: 'ᴇ', f: 'ꜰ', g: 'ɢ', h: 'ʜ', i: 'ɪ',
  j: 'ᴊ', k: 'ᴋ', l: 'ʟ', m: 'ᴍ', n: 'ɴ', o: 'ᴏ', p: 'ᴘ', q: 'ꞯ', r: 'ʀ',
  s: 'ꜱ', t: 'ᴛ', u: 'ᴜ', v: 'ᴠ', w: 'ᴡ', x: 'x', y: 'ʏ', z: 'ᴢ'
};

function toSmallCaps(str) {
  return str.toLowerCase().split('').map((ch) => SMALL_CAPS[ch] || ch).join('');
}

const REGISTRY = [
  {
    id: 'core',
    icon: '🛡️',
    title: 'CORE',
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
      c('.replymode <buttons|text>', true),
      c('.update', true),
      c('.script'),
      c('.repo'),
      c('.owner'),
    ],
  },
  {
    id: 'ghost',
    icon: '🎭',
    title: 'GHOST',
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
    title: 'PEEK',
    commands: [
      c('.peek', true),
      c('.peek auto on|off', true), 
      c('.peek watch on|off', true),
      c('.peek dest owner', true),
      c('.peek dest same', true),
      c('.peek dest both', true),
    ],
  },
  {
    id: 'lurk',
    icon: '🕵️',
    title: 'LURK',
    commands: [
      c('.lurk', true),
      c('.lurk on|off', true),
      c('.lurk react on|off', true),
      c('.lurk download on|off', true),
      c('.lurk emoji ❤️', true),
      c('.lurk emoji random', true),
      c('.lurk emoji none', true),
    ],
  },
  {
    id: 'schedule',
    icon: '⏰',
    title: 'SCHEDULE',
    commands: [
      c('.schedule', true),
      c('.schedule txt date am|pm', true), 
      c('.schedule list', true),
      c('.schedule cancel <id>', true),
      c('.schedule media', true),
    ],
  },
  {
    id: 'utility',
    aliases: ['tools'],
    icon: '🛠',
    title: 'UTILITY',
    commands: [
      c('.currency'),
      c('.qr <text>'),
      c('.qr read'),
      c('.define <word>'),
      c('.weather <city>'),
      c('.pwned <password>'),
      c('.url (reply to media)'),
      c('.reqlocation'),
      c('.shorten <url>'),
      c('.news [topic]'),
      c('.hackernews'),
      c('.wiki <topic>'),
      c('.joke'),
      c('.advice'),
      c('.fact'),
    ],
  },
  {
    id: 'media',
    icon: '📚',
    title: 'MEDIA & AI',
    commands: [
      c('.book <query>'),
      c('.book dl <number>'),
      c('.img <query> [count]'),
      c('.gemini <prompt>'),
      c('.photo <prompt>'),
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
    title: 'DOWNLOAD',
    commands: [
      c('.dl <url>'),
      c('.dl audio <url>'),
      c('.dl mp3 <url>'),
      c('.play <query>'),
      c('.ytv <query/url>'),
      c('.ytdl <url>'),
      c('.pdl <post-url>'),
      c('.pdlzip <post-url>'),
      c('.download <url>'),
      c('.song <query>'),
      c('.twitter <url>'),
      c('.pinterest <url>'),
      c('.threads <url>'),
      c('.reddit <url>'),
      c('.soundcloud <url>'),
      c('.spotify <url>'),
      c('.youtube <url>'),
      c('.gitdl <github-url>', true),
      c('.mfdl <mediafire-url>', true),
    ],
  },
  {
    id: 'display',
    aliases: ['wallpaper', 'wp', 'dp'],
    icon: '🖼️',
    title: 'WALLPAPERS',
    commands: [
      c('.wp1 ... .wp10'),
      c('.wp (reply photo)'),
      c('.dp (reply photo)'),
      c('.reset wp'),
    ],
  },
  {
    id: 'textmaker',
    aliases: ['ephoto', 'logo'],
    icon: '🪄',
    title: 'TEXT→PHOTO',
    commands: [
      c('.textmaker <effect> <text>'),
      c('.neon <text>'),
      c('.glitch <text>'),
      c('.3dgold <text>'),
      c('.marvel <text1 ; text2>'),
      c('.pornhub <text1 ; text2>'),
      c('.cyberpunk <text>'),
      c('.graffiti <text>'),
      c('.blackpink <text>'),
      c('.naruto <text>'),
      c('.galaxy <text>'),
      c('.blood <text>'),
      c('.hologram <text>'),
      c('.matrix <text>'),
      c('.slice <text>'),
      c('.luxury <text>'),
      c('.vintage <text>'),
      c('.lightglow <text>'),
      c('.sand <text>'),
      c('.water <text>'),
      c('.fire <text>'),
      c('.metallic <text>'),
      c('.space <text>'),
      c('.neonlight <text>'),
      c('.glowing <text>'),
      c('.captainamerica <text>'),
      c('.wall <text>'),
      c('.paper <text>'),
      c('.circuit <text>'),
      c('.neondevil <text>'),
      c('.dragon <text>'),
      c('.comic <text>'),
      c('.titanium <text>'),
      c('.sunset <text>'),
      c('.balloon <text>'),
      c('.silver <text>'),
      c('.paint <text>'),
      c('.xmas <text>'),
      c('.sparkle <text>'),
      c('.american <text>'),
      c('.blueneon <text>'),
      c('.greenneon <text>'),
      c('.goldletter <text>'),
      c('.pubg <text>'),
      c('.starwars <text>'),
      c('.neonart <text>'),
      c('.glitchneon <text>'),
    ],
  },
  {
    id: 'social',
    aliases: ['social,search'],
    icon: '📥',
    title: 'SEARCH|DL',
    commands: [
      c('.ig <username/url>'),
      c('.tiktok <username/url>'),
      c('.fb <username/url>'),
    ],
  },
  {
    id: 'group',
    aliases: ['admin', 'groupadmin'],
    icon: '👨‍👩‍👧‍👧',
    title: 'GROUP ADMIN',
    commands: [
      c('.open', true),
      c('.close', true),
      c('.schedule open date time', true),
      c('.schedule close date time', true),
      c('.kick (reply|num)', true),
      c('.add <number>', true),
      c('.promote (reply|num)', true),
      c('.demote (reply|num)', true),
      c('.tag [msg]', true),
      c('.tagall [msg]', true),
      c('.tag admin [msg]', true),
      c('.hidetag [msg]', true),
      c('.hidetag admin [msg]', true),
      c('.pdd <on|off>'),
      c('.pinchat', true),
      c('.unpinchat', true),
      c('.setgdesc <text>', true),
      c('.setgpp', true),
      c('.welcome on'),
      c('.welcome off'),
      c('.goodbye on'),
      c('.goodbye off'),
      c('.antilink on|off', true),
      c('.antispam on|off', true),
      c('.antisticker on|off', true),
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
    aliases: ['profile', 'only-owner'],
    icon: '⛔',
    title: 'OWNER PROFILE',
    commands: [
      c('.setpp', true),
      c('.setabout <text>', true),
      c('.setstatus reply|text', true),
      c('.getstatus <number|jid>', true),
      c('.replymode buttons|txt', true),
      c('.getpair <number>', true),
      c('.setsession ownernumber', true),
      c('.addsession <number>', true),
      c('.delsession <id>', true),
      c('.setvar <key> <value>', true),
      c('.getvar <key|all>', true),
      c('.delvar <key>', true),
      c('.block (reply|num)', true),
      c('.unblock (reply|num)', true),
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
    title: 'CHAT CONTROLS',
    commands: [
      c('.disappearing 24h|7d|90d'),
      c('.mute 8h|1d|forever', true),
      c('.unmute', true),
      c('.archive', true),
      c('.unarchive', true),
      c('.clearchat', true),
      c('.pinchat', true),
      c('.unpinchat', true),
    ],
  },
  {
    id: 'jid',
    aliases: ['jidprofile'],
    icon: '🧭',
    title: 'JID|PROFILE',
    commands: [
      c('.getjid'),
      c('.getpp'),
      c('.presence', true),
      c('.presence online on|off', true),
      c('.presence typing on|off', true),
      c('.presence recording on|off', true),
      c('.presence reads on|off', true),
      c('.activity', true),
    ],
  },
];

function applyPrefix(cmd, prefix) {
  if (prefix === '.') return cmd;
  return cmd.startsWith('.') ? prefix + cmd.slice(1) : cmd;
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

function renderHeaderBox(prefix, isOwnerUser) {
  const ownerText = isOwnerUser ? toSmallCaps('COMMANDS ARE OWNER-ONLY') : toSmallCaps('COMMANDS ARE PUBLIC');
  const guideCmd = applyPrefix('.ᴄᴏᴍᴍᴀɴᴅ ꜰᴏʀ ɢᴜɪᴅᴇ', prefix);
  return [
    '     【  𝗪𝗥𝗔𝗜𝗧🇭 】',
    '│',
    `│ ${ownerText}`,
    `│ ${toSmallCaps('PREFIX')} · ${prefix}`,
    `│ ℹ️ ${guideCmd}`,
    '│',
    '└──────────────────┈⚝',
  ].join('\n');
}

function renderCategoryBox(group, prefix, isOwnerUser) {
  const visible = isOwnerUser
    ? group.commands
    : group.commands.filter((x) => !x.ownerOnly);

  if (!visible.length) return null;

  const lines = [
    `     _*【 ${group.icon} ${toSmallCaps(group.title)} 】*_`,
    '┌──────────────────┈⚝',
  ];

  for (const item of visible) {
    lines.push(`│ ◈ ${applyPrefix(item.cmd, prefix)}`);
  }

  lines.push('└──────────────────┈⚝');

  return lines.join('\n');
}

function renderAllPlainText(prefix, isOwnerUser) {
  const header = renderHeaderBox(prefix, isOwnerUser);
  const groups = visibleRegistry(isOwnerUser);
  const categoryBoxes = [];

  for (const group of groups) {
    const box = renderCategoryBox(group, prefix, isOwnerUser);
    if (box) categoryBoxes.push(box);
  }

  return [header, ...categoryBoxes].join('\n');
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

export async function helpCommand(sock, chat, msg, args) {
  try {
    const from = msg.key.participant || msg.key.remoteJid;
    const isOwnerUser = msg.key.fromMe || isOwner(from);
    const prefix = getPrefix();

    const target = (args?.[0] || '').toLowerCase().trim();

    if (!target) {
      const text = renderAllPlainText(prefix, isOwnerUser);
      return await sendWithCta(sock, chat, text, { quoted: msg });
    }

    const group = findGroup(target);

    if (!group) {
      const avail = visibleRegistry(isOwnerUser)
        .map((g) => `• ${g.id}`)
        .join(' · ');
      return await sendWithCta(
        sock,
        chat,
        `❓ Unknown menu category: *${target}*\n\nAvailable categories:\n${avail}`,
        { quoted: msg }
      );
    }

    const box = renderCategoryBox(group, prefix, isOwnerUser);

    if (!box) {
      return await sendWithCta(
        sock,
        chat,
        `🔒 Category *${group.title}* is owner-only.`,
        { quoted: msg }
      );
    }

    const text = [renderHeaderBox(prefix, isOwnerUser), box].join('\n');

    return await sendWithCta(
      sock,
      chat,
      text,
      { quoted: msg }
    );
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
