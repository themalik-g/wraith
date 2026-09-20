// ─────────────────────────────────────────────
// WRAITH · modules/help.js
// Clean single-message plain text list menu
// ─────────────────────────────────────────────
import { isOwner } from '../core/identity.js';
import { getPrefix } from '../core/settings.js';
import { NEWSLETTER_CONTEXT } from '../lib/buttons.js';

const c = (cmd, ownerOnly = false) => ({ cmd, ownerOnly });

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
      c('.update', true),
      c('.script'),
      c('.repo'),
      c('.owner'),
    ],
  },
  {
    id: 'ghost',
    icon: '👻',
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
    title: 'LURK',
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
    title: 'SCHEDULE',
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
    title: 'UTILITY',
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
    title: 'MEDIA & AI',
    commands: [
      c('.book <query>'),
      c('.book dl <number>'),
      c('.img <query> [count]'),
      c('.gemini <prompt>'),
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
    id: 'textmaker',
    aliases: ['ephoto'],
    icon: '🎨',
    title: 'TEXTMAKER / EPHOTO',
    commands: [
      c('.textmaker <effect> <text>'),
      c('.metallic <text>'),
      c('.ice <text>'),
      c('.snow <text>'),
      c('.impressive <text>'),
      c('.matrix <text>'),
      c('.light <text>'),
      c('.neon <text>'),
      c('.devil <text>'),
      c('.purple <text>'),
      c('.thunder <text>'),
      c('.leaves <text>'),
      c('.1917 <text>'),
      c('.arena <text>'),
      c('.hacker <text>'),
      c('.sand <text>'),
      c('.blackpink <text>'),
      c('.glitch <text>'),
      c('.fire <text>'),
      c('.3dgold <text>'),
      c('.marvel <text1 ; text2>'),
      c('.pornhub <text1 ; text2>'),
      c('.graffiti <text>'),
      c('.naruto <text>'),
      c('.blood <text>'),
      c('.hologram <text>'),
      c('.luxury <text>'),
      c('.glowing <text>'),
      c('.wall <text>'),
      c('.circuit <text>'),
      c('.neondevil <text>'),
    ],
  },
  {
    id: 'social',
    aliases: ['socialsearch'],
    icon: '🔍',
    title: 'SOCIAL SEARCH & DL',
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
    title: 'GROUP ADMIN',
    commands: [
      c('.open', true),
      c('.close', true),
      c('.kick (reply/num)', true),
      c('.add <number>', true),
      c('.promote (reply/num)', true),
      c('.demote (reply/num)', true),
      c('.tagall [msg]', true),
      c('.tag admin [msg]', true),
      c('.hidetag [msg]', true),
      c('.hidetag admin [msg]', true),
      c('.pdd <on/off>'),
      c('.pinchat', true),
      c('.unpinchat', true),
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
    title: 'OWNER PROFILE',
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
    title: 'CHAT CONTROLS',
    commands: [
      c('.mute [8h|1d|forever]', true),
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
    title: 'JID / PROFILE',
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

function renderAllPlainText(prefix, isOwnerUser) {
  const groups = visibleRegistry(isOwnerUser);
  const lines = [];

  lines.push('🤖 *𝕎ℝ𝔸𝕀𝕋ℍ COMMAND MENU*');
  lines.push(`• *Prefix:* ${prefix}`);
  lines.push('');

  for (const group of groups) {
    lines.push(`${group.icon} *${group.title}*`);
    for (const item of group.commands) {
      lines.push(`  • ${applyPrefix(item.cmd, prefix)}`);
    }
    lines.push('');
  }

  lines.push('Provided by 𝕎ℝ𝔸𝕀𝕋ℍ');
  return lines.join('\n');
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
      return await sock.sendMessage(chat, { text, contextInfo: NEWSLETTER_CONTEXT }, { quoted: msg });
    }

    const group = findGroup(target);

    if (!group) {
      const avail = visibleRegistry(isOwnerUser)
        .map((g) => `• ${g.id}`)
        .join(' · ');
      return await sock.sendMessage(
        chat,
        { text: `❓ Unknown menu category: *${target}*\n\nAvailable categories:\n${avail}`, contextInfo: NEWSLETTER_CONTEXT },
        { quoted: msg }
      );
    }

    const visible = isOwnerUser
      ? group.commands
      : group.commands.filter((x) => !x.ownerOnly);

    if (!visible.length) {
      return await sock.sendMessage(
        chat,
        { text: `🔒 Category *${group.title}* is owner-only.`, contextInfo: NEWSLETTER_CONTEXT },
        { quoted: msg }
      );
    }

    const lines = [`${group.icon} *${group.title}*`, ''];
    for (const item of visible) {
      lines.push(`  • ${applyPrefix(item.cmd, prefix)}`);
    }
    lines.push('\nProvided by 𝕎ℝ𝔸𝕀𝕋ℍ');

    return await sock.sendMessage(
      chat,
      { text: lines.join('\n'), contextInfo: NEWSLETTER_CONTEXT },
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
