// ─────────────────────────────────────────────
//  WRAITH · modules/help.js
//  Central registry of every command.
//  Add a new entry here whenever you add a module.
// ─────────────────────────────────────────────
import { isOwner } from '../core/identity.js';

// ─────────────────────────────────────────────
//  Command registry
//  Every command the bot understands lives here.
//  ownerOnly: true  → only CONFIG.owner can run it
// ─────────────────────────────────────────────
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
            { cmd: '.lurk emoji ❤️',         desc: 'set a custom reaction emoji' },
            { cmd: '.lurk emoji random',     desc: 'pick a random emoji per status' },
            { cmd: '.lurk emoji none',       desc: 'revert to empty reaction' }
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

// ─────────────────────────────────────────────
//  Render
// ─────────────────────────────────────────────
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

// ─────────────────────────────────────────────
//  .help command
// ─────────────────────────────────────────────
export async function helpCommand(sock, chat, msg, args) {
    const from = msg.key.participant || msg.key.remoteJid;

    if (!msg.key.fromMe && !isOwner(from)) {
        return sock.sendMessage(chat, { text: '⛔ Owner only.' }, { quoted: msg });
    }

    const target = (args?.[0] || '').toLowerCase().trim();

    if (!target) {
        return sock.sendMessage(chat, { text: renderAll() }, { quoted: msg });
    }

    // Strip emojis and non-letters from group name query, match loosely
    const wanted = target.replace(/[^a-z]/g, '');
    const rendered = renderGroup(wanted);

    if (!rendered) {
        return sock.sendMessage(chat, {
            text: `👻 no group called _${target}_.\nAvailable: ghost · peek · lurk · probe · system`
        }, { quoted: msg });
    }

    return sock.sendMessage(chat, { text: rendered }, { quoted: msg });
}
