// ─────────────────────────────────────────────
//  WRAITH · modules/help.js
//  Styled boxed menu for 𝙒𝙍𝘼𝙄𝙏𝙃-𝘽𝙊𝙏.
//  .menu           → full menu
//  .menu <group>   → one section only
// ─────────────────────────────────────────────
import { isOwner } from '../core/identity.js';
import { CONFIG } from '../config.js';

const REGISTRY = [
    {
        id: 'ghost',
        icon: '👻',
        title: 'ɢʜᴏꜱᴛ',
        commands: [
            { cmd: '.ghost',          desc: 'check status' },
            { cmd: '.ghost on',       desc: 'to enable' },
            { cmd: '.ghost off',      desc: 'to disable' },
            { cmd: '.ghost edit on',  desc: 'to enable' },
            { cmd: '.ghost edit off', desc: 'to. disable' }
        ]
    },
    {
        id: 'peek',
        icon: '👁️',
        title: 'ᴘᴇᴇᴋ',
        commands: [
            { cmd: '.peek',             desc: 'reveals view-once' },
            { cmd: '.peek auto on',     desc: 'auto-save vv' },
            { cmd: '.peek auto off',    desc: 'disable avv' },
            { cmd: '.peek dest owner',  desc: 'owner DM' },
            { cmd: '.peek dest same',   desc: 'chat itself' },
            { cmd: '.peek dest both',   desc: 'both' }
        ]
    },
    {
        id: 'lurk',
        icon: '🌒',
        title: 'ʟᴜʀᴋ',
        commands: [
            { cmd: '.lurk',                desc: 'status watcher status' },
            { cmd: '.lurk on',             desc: 'auto-view status' },
            { cmd: '.lurk off',            desc: 'stop auto-viewing' },
            { cmd: '.lurk react on',       desc: 'status-react' },
            { cmd: '.lurk download on',    desc: 'save-status' },
            { cmd: '.lurk download off',   desc: 'stop s-saving' },
            { cmd: '.lurk emoji ',       desc: 'reaction emoji' },
            { cmd: '.lurk emoji random',   desc: 'random-react' }
        ]
    },
    {
    
        id: 'schedule',
        icon: '📅',
        title: 'ꜱᴄʜᴇᴅᴜʟᴇ',
        commands: [
            { cmd: '.schedule',                     desc: 'schedule help' },
            { cmd: '.schedule txt jid dd mm yy', desc: 'schedule a message' },
            { cmd: '.schedule list',                desc: 'show pending' },
            { cmd: '.schedule cancel <id>',         desc: '-' }
        ]
    },
    {
        id: 'admin',
        icon: '👥',
        title: 'ᴀᴅᴍɪɴ',
        commands: [
            { cmd: '.kick @user',         desc: 'remove a member' },
            { cmd: '.add 923...',         desc: 'add a member' },
            { cmd: '.promote @user',      desc: '-' },
            { cmd: '.demote @user',       desc: '-' },
            { cmd: '.antilink on|off',    desc: 'block links' },
            { cmd: '.antispam on|off',    desc: 'block spam' },
            { cmd: '.antisticker on|off', desc: 'no-sticker' }
        ]
    },
    {
        id: 'tools',
        icon: '🛠️',
        title: 'ᴛᴏᴏʟꜱ',
        commands: [
            { cmd: '.getpp',              desc: 'pp-currentchat' },
            { cmd: '.getpp <number>',     desc: 'pp-target' },
            { cmd: '.getjid',             desc: 'JID-repliedtuser' },
            { cmd: '.getjid currentchat', desc: 'JID-curremtchat' },
            { cmd: '.getjid channels',    desc: '-' },
            { cmd: '.getjid members',     desc: 'group members' }
        ]
    },
    {
        id: 'presence',
        icon: '⚙️',
        title: 'ᴘʀᴇꜱᴇɴᴄᴇ',
        commands: [
            { cmd: '.presence',                desc: 'presence status' },
            { cmd: '.presence online on|off',  desc: '-' },
            { cmd: '.presence typing on|off',  desc: '-' },
            { cmd: '.presence recording on|off', desc: '-' },
            { cmd: '.presence reads on|off',   desc: '-' }
        ]
    },
    {
        id: 'activity',
        icon: '📊',
        title: 'ᴀᴄᴛɪᴠɪᴛʏ',
        commands: [
            { cmd: '.activity',       desc: 'global dashboard' },
            { cmd: '.activity <jid>', desc: 'per-chat detail' }
        ]
    },
    {
        id: 'probe',
        icon: '🏓',
        title: 'ᴘʀᴏʙᴇ',
        commands: [
            { cmd: '.ping', desc: 'latency·memory·uptime' }
        ]
    }
];

// ─────────────────────────────────────────────
//  Box renderer — style:
//    ┌──❮ 👻 ɢʜᴏꜱᴛ ❯
//    │
//    │ ◈ .ghost — watcher status
//    │
//    └─────────────┈⚝
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
        renderBox(
            `${g.icon} ${g.title}`,
            g.commands.map(c => `${c.cmd} — ${c.desc}`)
        )
    );

    return [
        `┌──❮ 🤖 ${CONFIG.botName} ❯`,
        '│',
        `│  ᴄᴏᴍᴍᴀɴᴅꜱ ᴀʀᴇ ᴏᴡɴᴇʀ-ᴏɴʟʏ`,
        `│ 🔑 ᴘʀᴇꜰɪx · .`,
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
    return renderBox(
        `${g.icon} ${g.title}`,
        g.commands.map(c => `${c.cmd}`)
    );
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
