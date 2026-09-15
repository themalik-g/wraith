// ─────────────────────────────────────────────
// WRAITH · modules/help.js
// Full command menu across all phases.
// ─────────────────────────────────────────────
import { CONFIG } from '../config.js';
import { getPrefix } from '../core/settings.js';
import { isOwner } from '../core/identity.js';
import { getMode } from './utility.js';
import { chunkText } from '../lib/net.js';

// ─────────────────────────────────────────────
// Command catalog — grouped for readability.
// Each entry: [command, short description]
// ─────────────────────────────────────────────
function catalog() {
  return {
    '🛡️ core': [
      ['ping', 'check bot latency'],
      ['help / menu', 'show this menu'],
      ['prefix', 'show/set command prefix'],
      ['mode', 'show/set public or private mode'],
      ['update', 'check for updates'],
      ['script / repo', 'repo URL'],
      ['owner', 'send owner contact card'],
    ],
    '🎭 ghost · peek · lurk': [
      ['ghost', 'ghost-mode configuration'],
      ['peek', 'reveal view-once / deleted media'],
      ['lurk', 'watch status updates'],
      ['schedule', 'schedule messages (reply to media to schedule it)'],
    ],
    '🔧 utility': [
      ['currency <from> <to> [amount]', 'live exchange rate (aliases ok)'],
      ['qr <text>', 'generate QR code'],
      ['qr read', 'reply to a QR image to decode'],
      ['define <word>', 'dictionary definition'],
      ['weather <city>', 'forecast + rain/storm warning'],
      ['pwned <password>', 'check if password leaked (HIBP)'],
    ],
    '📚 media': [
      ['book <query>', 'search Project Gutenberg / Open Library'],
      ['book dl <id>', 'download a book'],
      ['img <query> [count]', 'stock images (max 10)'],
      ['couplepp [count]', 'couple profile pictures (max 5)'],
      ['movie <title>', 'movie info'],
      ['song <title> [artist]', 'song info'],
      ['lyrics <artist> - <title>', 'song lyrics'],
      ['ppt <topic>', 'presentation outline'],
      ['rmbg', 'reply to image — remove background'],
    ],
    '⬇️ downloaders': [
      ['dl / download <url>', 'generic downloader'],
      ['song <query>', 'audio downloader'],
      ['gitdl <github-url>', 'download GitHub repo as zip'],
      ['mfdl <mediafire-url>', 'download from MediaFire'],
    ],
    '🔍 social search': [
      ['ig <username>', 'Instagram profile info'],
      ['tiktok <username>', 'TikTok profile info'],
      ['fb <username>', 'Facebook profile info'],
    ],
    '🤖 ai': [
      ['chatbot', 'show chatbot status'],
      ['chatbot on / off', 'enable/disable auto-reply'],
      ['chatbot set <instructions>', 'set custom AI instructions'],
    ],
    '👥 group admin': [
      ['welcome on / off', 'welcome messages'],
      ['goodbye on / off', 'goodbye messages'],
      ['kickall', 'remove all non-admin members'],
      ['kickcc <code>', 'remove members by country code'],
      ['setdesc <text>', 'set group description'],
      ['setgpp', 'reply to image — set group picture'],
      ['approveall', 'approve all pending join requests'],
      ['declineall', 'decline all pending join requests'],
      ['leave', 'leave the current group'],
      ['join <link>', 'join group via invite link'],
    ],
    '👤 owner profile': [
      ['setpp', 'reply to image — set bot profile picture'],
      ['setabout <text>', 'set bot about/status'],
      ['rejectcalls on / off', 'auto-reject incoming calls'],
      ['stalk <number>', 'presence tracker for a contact'],
      ['stalk list', 'list tracked contacts'],
      ['stalk stop <number>', 'stop tracking a contact'],
      ['chatstats <number>', 'chat statistics'],
    ],
    '💬 chat controls': [
      ['mute [8h|1d|forever]', 'mute this chat'],
      ['unmute', 'unmute this chat'],
      ['archive', 'archive this chat'],
      ['unarchive', 'unarchive this chat'],
      ['clearchat', 'clear this chat'],
    ],
    '🧭 jid / profile': [
      ['getjid', 'get JIDs of chats/users'],
      ['getpp', 'fetch profile picture'],
      ['presence', 'presence configuration'],
      ['activity', 'activity stats'],
    ],
  };
}

async function sendChunked(sock, chat, msg, text) {
  for (const p of chunkText(text, 3800)) await sock.sendMessage(chat, { text: p }, { quoted: msg });
}

// ─────────────────────────────────────────────
// .help / .menu  [category]
// ─────────────────────────────────────────────
export async function helpCommand(sock, chat, msg, args) {
  try {
    const prefix = getPrefix();
    const from = msg.key.participant || msg.key.remoteJid;
    const isOwnerUser = msg.key.fromMe || isOwner(from);
    const mode = getMode();
    const all = catalog();

    // Owner-only command set — used to tag/hide entries for non-owner in public mode.
    const OWNER_ONLY_VERBS = new Set([
      'ghost', 'peek', 'lurk', 'schedule',
      'kickall', 'kickcc', 'setdesc', 'setgpp',
      'approveall', 'declineall', 'leave', 'join',
      'mode', 'prefix', 'update', 'getjid', 'presence', 'activity',
      'stalk', 'chatbot', 'setpp', 'setabout', 'rejectcalls', 'chatstats',
      'ig', 'tiktok', 'fb', 'rmbg',
      'gitdl', 'mfdl',
      'mute', 'unmute', 'archive', 'unarchive', 'clearchat',
    ]);

    // Filter catalogue if user is not owner in public mode
    function filterForViewer(groups) {
      if (isOwnerUser) return groups;
      const out = {};
      for (const [groupName, cmds] of Object.entries(groups)) {
        const kept = cmds.filter(([cmd]) => {
          const verb = cmd.split(/\s+/)[0].toLowerCase();
          return !OWNER_ONLY_VERBS.has(verb);
        });
        if (kept.length) out[groupName] = kept;
      }
      return out;
    }

    // Optional: a specific category requested
    const requested = (args || []).join(' ').trim().toLowerCase();
    let groupsToShow = filterForViewer(all);

    if (requested) {
      const match = Object.keys(groupsToShow).find(
        (k) => k.toLowerCase().includes(requested) ||
               k.replace(/[^\w\s]/g, '').trim().toLowerCase() === requested
      );
      if (match) {
        groupsToShow = { [match]: groupsToShow[match] };
      } else {
        // no exact category — show list of categories
        const lines = [
          `📖 *help* — no category matching “${requested}”`,
          '',
          '*Available categories:*',
          ...Object.keys(all).map((k) => `• ${k}  _(use_ \`${prefix}help ${k.replace(/[^\w\s]/g, '').trim()}\`_`)`,
        ];
        return sendChunked(sock, chat, msg, lines.join('\n'));
      }
    }

    // Header
    const lines = [];
    lines.push(`╭━━━〔 *${CONFIG.botName || 'WRAITH'}* 〕━━━╮`);
    lines.push(`│  v${CONFIG.version || '1.3.2'} · mode *${mode}*`);
    lines.push(`│  prefix \`${prefix}\``);
    lines.push(`│  commands · ${Object.values(all).reduce((n, arr) => n + arr.length, 0)}`);
    lines.push(`╰━━━━━━━━━━━━━━━━━━╯`);
    lines.push('');

    // If no specific category: show condensed overview + category list
    if (!requested) {
      lines.push('*categories:*');
      for (const [name, cmds] of Object.entries(groupsToShow)) {
        lines.push(`• ${name}  ·  ${cmds.length} cmd${cmds.length > 1 ? 's' : ''}`);
      }
      lines.push('');
      lines.push(`_Type_ \`${prefix}help <category>\` _for details._`);
      lines.push(`_Example:_ \`${prefix}help media\``);

      // Owner quick access — dump everything if owner and no filter, in chunks
      if (isOwnerUser) {
        lines.push('');
        lines.push('_Owner: showing all categories below._');
        lines.push('');
        for (const [name, cmds] of Object.entries(groupsToShow)) {
          lines.push(`— *${name}* —`);
          for (const [cmd, desc] of cmds) {
            const ownerTag = OWNER_ONLY_VERBS.has(cmd.split(/\s+/)[0].toLowerCase()) ? ' 🔒' : '';
            lines.push(`  \`${prefix}${cmd}\`${ownerTag} — _${desc}_`);
          }
          lines.push('');
        }
      }
      return sendChunked(sock, chat, msg, lines.join('\n'));
    }

    // Specific category view
    for (const [name, cmds] of Object.entries(groupsToShow)) {
      lines.push(`— *${name}* —`);
      for (const [cmd, desc] of cmds) {
        const ownerTag = OWNER_ONLY_VERBS.has(cmd.split(/\s+/)[0].toLowerCase()) ? ' 🔒' : '';
        lines.push(`  \`${prefix}${cmd}\`${ownerTag} — _${desc}_`);
      }
      lines.push('');
    }
    lines.push('_🔒 = owner only._');
    return sendChunked(sock, chat, msg, lines.join('\n'));
  } catch (e) {
    try {
      await sock.sendMessage(chat, { text: `⚠️ help failed: ${e.message}` }, { quoted: msg });
    } catch {}
  }
}
