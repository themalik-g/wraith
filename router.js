// ─────────────────────────────────────────────
// WRAITH · modules/help.js
// Styled boxed menu — command list ONLY.
// Renders commands with the CURRENT prefix.
// ─────────────────────────────────────────────
import { isOwner } from '../core/identity.js';
import { getPrefix } from '../core/settings.js';

const REGISTRY = [
  {
    id: 'ghost',
    icon: '👻',
    title: 'ɢʜᴏꜱᴛ',
    commands: [
      '.ghost',
      '.ghost on',
      '.ghost off',
      '.ghost edit on',
      '.ghost edit off',
    ],
  },
  {
    id: 'peek',
    icon: '👀',
    title: 'ᴘᴇᴇᴋ',
    commands: [
      '.peek',
      '.peek auto on',
      '.peek auto off',
      '.peek dest owner',
      '.peek dest same',
      '.peek dest both',
    ],
  },
  {
    id: 'lurk',
    icon: '🕵️',
    title: 'ʟᴜʀᴋ',
    commands: [
      '.lurk',
      '.lurk on',
      '.lurk off',
      '.lurk react on',
      '.lurk react off',
      '.lurk download on',
      '.lurk download off',
      '.lurk emoji ❤️',
      '.lurk emoji random',
      '.lurk emoji none',
    ],
  },
  {
    id: 'schedule',
    icon: '⏰',
    title: 'ꜱᴄʜᴇᴅᴜʟᴇ',
    commands: [
      '.schedule',
      '.schedule txt date am/pm',
      '.schedule list',
      '.schedule cancel <id>',
    ],
  },
  {
    id: 'download',
    icon: '⬇️',
    title: 'ᴅᴏᴡɴʟᴏᴀᴅ',
    commands: [
      '.dl <url>',
      '.dl audio <url>',
      '.dl mp3 <url>',
      '.song <query>',
      '.video <query>',
    ],
  },
  {
    id: 'admin',
    icon: '🛡️',
    title: 'ᴀᴅᴍɪɴ',
    commands: [
      '.kick @user',
      '.add 923…',
      '.promote @user',
      '.demote @user',
      '.antilink on|off',
      '.antispam on|off',
      '.antisticker on|off',
    ],
  },
  {
    id: 'tools',
    icon: '🔧',
    title: 'ᴛᴏᴏʟꜱ',
    commands: [
      '.getpp',
      '.getpp <number>',
      '.getjid',
      '.getjid currentchat',
      '.getjid channels',
      '.getjid members',
    ],
  },
  {
    id: 'presence',
    icon: '⚙️',
    title: 'ᴘʀᴇꜱᴇɴᴄᴇ',
    commands: [
      '.presence',
      '.presence online on|off',
      '.presence typing on|off',
      '.presence recording on|off',
      '.presence reads on|off',
    ],
  },
  {
    id: 'activity',
    icon: '📊',
    title: 'ᴀᴄᴛɪᴠɪᴛʏ',
    commands: ['.activity', '.activity <chat>'],
  },
  {
    id: 'prefix',
    icon: '🔣',
    title: 'ᴘʀᴇꜰɪx',
    commands: ['.prefix', '.prefix <symbol>', '.prefix reset'],
  },
  {
    id: 'probe',
    icon: '📡',
    title: 'ᴘʀᴏʙᴇ',
    commands: ['.ping'],
  },
  {
    id: 'system',
    icon: '⚡',
    title: 'sʏsᴛᴇᴍ',
    commands: ['.update'],
  },
];

const TAIL = '└─────────────┈⚝';

// Replace leading "." with the current prefix
function applyPrefix(cmd, prefix) {
  if (prefix === '.') return cmd;
  return cmd.startsWith('.') ? prefix + cmd.slice(1) : cmd;
}

function renderBox(title, rows, prefix) {
  const lines = [];
  lines.push(`┌──❮ ${title} ❯`);
  lines.push('│');
  for (const r of rows) lines.push(`│ ◈ ${applyPrefix(r, prefix)}`);
  lines.push('│');
  lines.push(TAIL);
  return lines.join('\n');
}

function renderAll(prefix) {
  const sections = REGISTRY.map((g) =>
    renderBox(`${g.icon} ${g.title}`, g.commands, prefix)
  );
  return [
    '┌──❮ ⓌⓇⒶⒾⓉⒽ ❯',
    '│',
    '│ ᴄᴏᴍᴍᴀɴᴅꜱ ᴀʀᴇ ᴏᴡɴᴇʀ-ᴏɴʟʏ',
    `│ ᴘʀᴇꜰɪx · ${prefix}`,
    `│ ℹ️ ${prefix}ᴄᴏᴍᴍᴀɴᴅ ꜰᴏʀ ɢᴜɪᴅᴇ`,
    '│',
    TAIL,
    '',
    ...sections,
    '',
    'ⓌⓇⒶⒾⓉⒽ',
  ].join('\n');
}

function renderGroup(name, prefix) {
  const g = REGISTRY.find(
    (x) => x.id === name || x.title.replace(/[^a-z]/gi, '') === name
  );
  if (!g) return null;
  return renderBox(`${g.icon} ${g.title}`, g.commands, prefix);
}

export async function helpCommand(sock, chat, msg, args) {
  const from = msg.key.participant || msg.key.remoteJid;
  if (!msg.key.fromMe && !isOwner(from)) {
    return sock.sendMessage(
      chat,
      { text: '⛔ Owner only.' },
      { quoted: msg }
    );
  }

  const prefix = getPrefix();
  const target = (args?.[0] || '').toLowerCase().trim();

  if (!target) {
    return sock.sendMessage(
      chat,
      { text: renderAll(prefix) },
      { quoted: msg }
    );
  }

  const wanted = target.replace(/[^a-z]/g, '');
  const rendered = renderGroup(wanted, prefix);

  if (!rendered) {
    return sock.sendMessage(
      chat,
      {
        text: `❓ no menu page called _${target}_.\n\n${REGISTRY.map(
          (g) => `• ${g.id}`
        ).join(' · ')}`,
      },
      { quoted: msg }
    );
  }

  return sock.sendMessage(
    chat,
    { text: rendered },
    { quoted: msg }
  );
}
