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
            { cmd: '.ghost',          desc: 'watcher status' },
            { cmd: '.ghost on',       desc: 'arm antidelete' },
            { cmd: '.ghost off',      desc: 'disarm antidelete' },
            { cmd: '.ghost edit on',  desc: 'arm antiedit' },
            { cmd: '.ghost edit off', desc: 'disarm antiedit' }
        ]
    },
    {
        id: 'peek',
        icon: '👁️',
        title: 'ᴘᴇᴇᴋ',
        commands: [
            { cmd: '.peek',             desc: 'reply to a view-once to reveal' },
            { cmd: '.peek auto on',     desc: 'auto-forward incoming view-onces' },
            { cmd: '.peek auto off',    desc: 'disable auto-peek' },
            { cmd: '.peek dest owner',  desc: 'reveals to owner DM' },
            { cmd: '.peek dest same',   desc: 'reveals to same chat' },
            { cmd: '.peek dest both',   desc: 'reveals to both' }
        ]
    },
    {
        id: 'lurk',
        icon: '🌒',
        title: 'ʟᴜʀᴋ',
        commands: [
            { cmd: '.lurk',                desc: 'status watcher status' },
            { cmd: '.lurk on',             desc: 'auto-view every status' },
            { cmd: '.lurk off',            desc: 'stop auto-viewing' },
            { cmd: '.lurk react on',       desc: 'react to statuses' },
            { cmd: '.lurk download on',    desc: 'save statuses to DM' },
            { cmd: '.lurk download off',   desc: 'stop saving statuses' },
            { cmd: '.lurk emoji ❤️',       desc: 'set reaction emoji' },
            { cmd: '.lurk emoji random',   desc: 'random emoji per status' }
        ]
    },
    {
        id: 'schedule',
        icon: '📅',
        title: 'ꜱᴄʜᴇᴅᴜʟᴇ',
        commands: [
            { cmd: '.schedule',                     desc: 'schedule help' },
            { cmd: '.schedule <msg> <target> date', desc: 'schedule a message' },
            { cmd: '.schedule list',                desc: 'show pending schedules' },
            { cmd: '.schedule cancel <id>',         desc: 'cancel a schedule' }
        ]
    },
    {
        id: 'admin',
        icon: '👥',
        title: 'ᴀᴅᴍɪɴ',
        commands: [
            { cmd: '.kick @user',         desc: 'remove a member' },
            { cmd: '.add 923...',         desc: 'add a member' },
            { cmd: '.promote @user',      desc: 'make admin' },
            { cmd: '.demote @user',       desc: 'remove admin' },
            { cmd: '.antilink on|off',    desc: 'block links' },
            { cmd: '.antispam on|off',    desc: 'block spam' },
            { cmd: '.antisticker on|off', desc: 'block stickers' }
        ]
    },
    {
        id: 'tools',
        icon: '🛠️',
        title: 'ᴛᴏᴏʟꜱ',
        commands: [
            { cmd: '.getpp',              desc: 'profile pic of current chat' },
            { cmd: '.getpp <number>',     desc: 'profile pic of target' },
            { cmd: '.getjid',             desc: 'JID of current chat' },
            { cmd: '.getjid currentchat', desc: 'JID of this chat' },
            { cmd: '.getjid channels',    desc: 'list joined channels' },
            { cmd: '.getjid members',     desc: 'list group members' }
        ]
    },
    {
        id: 'presence',
        icon: '⚙️',
        title: 'ᴘʀᴇꜱᴇɴᴄᴇ',
        commands: [
            { cmd: '.presence',                desc: 'presence status' },
            { cmd: '.presence online on|off',  desc: 'always online' },
            { cmd: '.presence typing on|off',  desc: 'auto-typing' },
            { cmd: '.presence recording on|off', desc: 'auto-recording' },
            { cmd: '.presence reads on|off',   desc: 'read receipts' }
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
            { cmd: '.ping', desc: 'latency · memory · uptime' }
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
        `┌──❮ 👤 ${CONFIG.botName} ❯`,
        '│',
        `│ 🤖 ᴀʟʟ ᴄᴏᴍᴍᴀɴᴅꜱ ᴀʀᴇ ᴏᴡɴᴇʀ-ᴏɴʟʏ`,
        `│ 🔑 ᴘʀᴇꜰɪx · .`,
        '│',
        TAIL,
        '',
        ...sections,
        '',
        `_page: .menu <group> — e.g. .menu ghost_`
    ].join('\n');
}

function renderGroup(name) {
    const g = REGISTRY.find(x => x.id === name || x.title.replace(/[^a-z]/gi, '') === name);
    if (!g) return null;
    return renderBox(
        `${g.icon} ${g.title}`,
        g.commands.map(c => `${c.cmd} — ${c.desc}`)
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
