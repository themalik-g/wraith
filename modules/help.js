// ─────────────────────────────────────────────
//  WRAITH · modules/help.js
//  Central registry of every command.
// ─────────────────────────────────────────────
import { isOwner } from '../core/identity.js';

const REGISTRY = [
    {
        group: '👻  ghost',
        subtitle: 'silent watcher · remembers everything',
        commands: [
            { cmd: '.ghost',                 desc: 'show ghost status' },
            { cmd: '.ghost on',              desc: 'arm antidelete' },
            { cmd: '.ghost off',             desc: 'disarm antidelete' },
            { cmd: '.ghost edit on',         desc: 'arm antiedit (report message edits)' },
            { cmd: '.ghost edit off',        desc: 'disarm antiedit' }
        ]
    },
    {
        group: '👁️  peek',
        subtitle: 'view-once retriever',
        commands: [
            { cmd: '.peek',                  desc: 'reply to a view-once to reveal it' },
            { cmd: '.peek auto on',          desc: 'auto-forward every incoming view-once' },
            { cmd: '.peek auto off',         desc: 'disable auto-peek' },
            { cmd: '.peek dest owner',       desc: 'reveals go to owner DM (default)' },
            { cmd: '.peek dest same',        desc: 'reveals go to originating chat' },
            { cmd: '.peek dest both',        desc: 'reveals go to both' }
        ]
    },
    {
        group: '🌒  lurk',
        subtitle: 'status watcher',
        commands: [
            { cmd: '.lurk',                  desc: 'show lurk status' },
            { cmd: '.lurk on',               desc: 'auto-view every status' },
            { cmd: '.lurk off',              desc: 'stop auto-viewing' },
            { cmd: '.lurk react on',         desc: 'react to statuses' },
            { cmd: '.lurk react off',        desc: 'stop reacting' },
            { cmd: '.lurk download on',      desc: 'download statuses to owner DM silently' },
            { cmd: '.lurk download off',     desc: 'stop downloading statuses' },
            { cmd: '.lurk emoji ❤️',         desc: 'set a custom reaction emoji' },
            { cmd: '.lurk emoji random',     desc: 'pick a random emoji per status' },
            { cmd: '.lurk emoji none',       desc: 'revert to empty reaction' }
        ]
    },
    {
        group: '📅  schedule',
        subtitle: 'send messages later',
        commands: [
            { cmd: '.schedule',              desc: 'show schedule help' },
            { cmd: '.schedule <msg> <target> dd,mm,yy h mm am/pm', desc: 'schedule a new message' },
            { cmd: '.schedule <target> dd,mm,yy h mm am/pm',       desc: 'schedule a replied message' }
        ]
    },
    {
        group: '👥  admin',
        subtitle: 'group management',
        commands: [
            { cmd: '.kick @user',            desc: 'remove a member (reply or mention)' },
            { cmd: '.add 923...',            desc: 'add a member' },
            { cmd: '.promote @user',         desc: 'make admin' },
            { cmd: '.demote @user',          desc: 'remove admin' },
            { cmd: '.antilink on|off',       desc: 'block links in group' },
            { cmd: '.antispam on|off',       desc: 'block spam in group' },
            { cmd: '.antisticker on|off',    desc: 'block stickers in group' }
        ]
    },
    {
        group: '🖼️  getpp',
        subtitle: 'profile pictures',
        commands: [
            { cmd: '.getpp',                 desc: 'get profile pic of current chat' },
            { cmd: '.getpp owner',           desc: 'send profile pic to owner DM' },
            { cmd: '.getpp chat',            desc: 'send profile pic to this chat' },
            { cmd: '.getpp <number>',        desc: 'get profile pic of target' }
        ]
    },
    {
        group: '📌  getjid',
        subtitle: 'JID resolver',
        commands: [
            { cmd: '.getjid',                desc: 'get JID of current chat' },
            { cmd: '.getjid currentchat',    desc: 'get JID of this chat' },
            { cmd: '.getjid owner <target>', desc: 'resolve a number/username to JID' },
            { cmd: '.getjid channels',       desc: 'list joined channels with JIDs' }
        ]
    },
    {
        group: '⚙️  presence',
        subtitle: 'online & typing control',
        commands: [
            { cmd: '.presence',              desc: 'show presence status' },
            { cmd: '.presence online on|off', desc: 'always online' },
            { cmd: '.presence typing on|off', desc: 'auto-typing indicator' },
            { cmd: '.presence recording on|off', desc: 'auto-recording indicator' },
            { cmd: '.presence reads on|off', desc: 'read receipts' }
        ]
    },
    {
        group: '📊  activity',
        subtitle: 'chat activity dashboard',
        commands: [
            { cmd: '.activity',              desc: 'show global activity dashboard' }
        ]
    },
    {
        group: '🏓  probe',
        subtitle: 'latency & vitals',
        commands: [
            { cmd: '.ping',                  desc: 'measure round-trip, memory, uptime' }
        ]
    },
    {
        group: '⚙️  system',
        subtitle: 'bot information',
        commands: [
            { cmd: '.help',                  desc: 'show this list' },
            { cmd: '.help <group>',          desc: 'show only one group (e.g. .help ghost)' },
            { cmd: '.menu',                  desc: 'alias for .help' }
        ]
    }
];

function renderAll() {
    const lines = [];
    lines.push(`👻 *wraith · command index*`);
    lines.push('');

    for (const g of REGISTRY) {
        lines.push(`*${g.group}*  _${g.subtitle}_`);
        for (const c of g.commands) {
            lines.push(`  \`${c.cmd}\` — ${c.desc}`);
        }
        lines.push('');
    }

    lines.push(`_All commands are owner-only._`);
    lines.push(`_Prefix is a dot: ._`);
    return lines.join('\n');
}

function renderGroup(name) {
    const g = REGISTRY.find(x => x.group.toLowerCase().includes(name));
    if (!g) return null;

    const lines = [];
    lines.push(`*${g.group}*  _${g.subtitle}_`);
    lines.push('');
    for (const c of g.commands) {
        lines.push(`  \`${c.cmd}\` — ${c.desc}`);
    }
    return lines.join('\n');
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
            text: `👻 no group called _${target}_.\nAvailable: ghost · peek · lurk · schedule · admin · getpp · getjid · presence · activity · probe · system`
        }, { quoted: msg });
    }

    return sock.sendMessage(chat, { text: rendered }, { quoted: msg });
}
