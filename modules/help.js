// ─────────────────────────────────────────────
//  WRAITH · modules/help.js
//  Styled boxed menu — command list ONLY.
//  Typing a command bare (e.g. ".ghost") shows its
//  dedicated usage guide (handled in each module).
//  .menu / .help        → full menu
//  .menu <group>        → one section only
// ─────────────────────────────────────────────
import { isOwner } from '../core/identity.js';
import { CONFIG } from '../config.js';

const REGISTRY = [
    {
        id: 'ghost',
        icon: '👻',
        title: 'ɢʜᴏꜱᴛ',
        commands: ['.ghost', '.ghost on', '.ghost off', '.ghost edit on', '.ghost edit off']
    },
    {
        id: 'peek',
        icon: '👁️',
        title: 'ᴘᴇᴇᴋ',
        commands: ['.peek', '.peek auto on', '.peek auto off', '.peek dest owner', '.peek dest same', '.peek dest both']
    },
    {
        id: 'lurk',
        icon: '🌒',
        title: 'ʟᴜʀᴋ',
        commands: [
            '.lurk',
            '.lurk on', '.lurk off',
            '.lurk react on', '.lurk react off',
            '.lurk download on', '.lurk download off',
            '.lurk emoji ❤️', '.lurk emoji random', '.lurk emoji none'
        ]
    },
    {
        id: 'schedule',
        icon: '📅',
        title: 'ꜱᴄʜᴇᴅᴜʟᴇ',
        commands: ['.schedule', '.schedule txt date am/pm', '.schedule list', '.schedule cancel <id>']
    },
    {
        id: 'admin',
        icon: '👥',
        title: 'ᴀᴅᴍɪɴ',
        commands: ['.kick @user', '.add 923…', '.promote @user', '.demote @user', '.antilink on|off', '.antispam on|off', '.antisticker on|off']
    },
    {
        id: 'tools',
        icon: '🛠️',
        title: 'ᴛᴏᴏʟꜱ',
        commands: ['.getpp', '.getpp <number>', '.getjid', '.getjid currentchat', '.getjid channels', '.getjid members']
    },
    {
        id: 'presence',
        icon: '⚙️',
        title: 'ᴘʀᴇꜱᴇɴᴄᴇ',
        commands: ['.presence', '.presence online on|off', '.presence typing on|off', '.presence recording on|off', '.presence reads on|off']
    },
    {
        id: 'activity',
        icon: '📊',
        title: 'ᴀᴄᴛɪᴠɪᴛʏ',
        commands: ['.activity', '.activity <jid>']
    },
    {
        id: 'probe',
        icon: '🏓',
        title: 'ᴘʀᴏʙᴇ',
        commands: ['.ping']
    },
    {
        id: 'system',
        icon: '🔄',
        title: 'sʏsᴛᴇᴍ',
        commands: ['.update']
    }
];

// ─────────────────────────────────────────────
//  Box renderer
// ─────────────────────────────────────────────
const TAIL = '└─────────────┈⚝';

function renderBox(title, rows) {
    const lines = [];
    lines.push(`┌──❮ ${title} ❯`);
    lines.push('│');
    for (const r of rows) {
        lines.push(`│ ◈ ${r}`);
    }
    lines.push('│');
    lines.push(TAIL);
    return lines.join('\n');
}

function renderAll() {
    const sections = REGISTRY.map(g =>
        renderBox(`${g.icon} ${g.title}`, g.commands)
    );

    return [
        `┌──❮ 🤖 ${CONFIG.botName || CONFIG.codename} ❯`,
        '│',
        `│  ᴄᴏᴍᴍᴀɴᴅꜱ ᴀʀᴇ ᴏᴡɴᴇʀ-ᴏɴʟʏ`,
        `│ 🔑 ᴘʀᴇꜰɪx · .`,
        `│ ℹ️ .ᴄᴏᴍᴍᴀɴᴅ ꜰᴏʀ ɢᴜɪᴅᴇ`,
        '│',
        TAIL,
        '',
        ...sections,
        '',
        `ⓌⓇⒶⒾⓉⒽ`
    ].join('\n');
}

function renderGroup(name) {
    const g = REGISTRY.find(x => x.id === name || x.title.replace(/[^a-z]/gi, '') === name);
    if (!g) return null;
    return renderBox(`${g.icon} ${g.title}`, g.commands);
}

export async function helpCommand(sock, chat, msg, args) {
    const from = msg.key.participant || msg.key.remoteJid;

    if (!msg.key.fromMe && !isOwner(from)) {
        return sock.sendMessage(chat, { text: '⛔ Owner only.' }, { quoted: msg });
    }

    const target = (args?.[0] || '').toLowerCase().trim();

    if (!target) {
        return sock.sendMessage(chat, { text: renderAll() }, { quoted: msg });
    }

    const wanted = target.replace(/[^a-z]/g, '');
    const rendered = renderGroup(wanted);

    if (!rendered) {
        return sock.sendMessage(chat, {
            text: `👻 no menu page called _${target}_.\n\n${REGISTRY.map(g => `• ${g.id}`).join(' · ')}`
        }, { quoted: msg });
    }

    return sock.sendMessage(chat, { text: rendered }, { quoted: msg });
}
