// ─────────────────────────────────────────────
// WRAITH · modules/prefix.js
// .prefix        → show current prefix
// .prefix <sym>  → change prefix
// .prefix reset  → back to "."
// ─────────────────────────────────────────────
import { isOwner } from '../core/identity.js';
import { getPrefix, setPrefix } from '../core/settings.js';

export async function prefixCommand(sock, chat, msg, args) {
  const from = msg?.key?.participant || msg?.key?.remoteJid;
  if (!msg?.key?.fromMe && !isOwner(from)) {
    return sock.sendMessage(chat, { text: '⛔ Owner only.' }, { quoted: msg });
  }

  const current = getPrefix();
  const arg = Array.isArray(args) ? args.join(' ').trim() : '';

  // No argument → show info card
  if (!arg) {
    return sock.sendMessage(
      chat,
      {
        text: [
          '* WRAITH · PREFIX*',
          '',
          `Current prefix: \`${current}\``,
          '',
          `• \`${current}prefix <symbol>\` — change`,
          `• \`${current}prefix reset\` — back to \`.\``,
          '',
          '_Examples: `!`, `#`, `/`, `$`, `>>`_',
        ].join('\n'),
      },
      { quoted: msg }
    );
  }

  // Reset
  if (arg.toLowerCase() === 'reset') {
    if (current === '.') {
      return sock.sendMessage(
        chat,
        { text: `ℹ️ Prefix is already \`.\`` },
        { quoted: msg }
      );
    }
    setPrefix('.');
    return sock.sendMessage(
      chat,
      { text: `✅ Prefix reset to \`.\`` },
      { quoted: msg }
    );
  }

  // Validation
  if (arg.length > 3) {
    return sock.sendMessage(
      chat,
      { text: '❌ Prefix must be 1–3 characters.' },
      { quoted: msg }
    );
  }
  if (/[a-zA-Z0-9]/.test(arg)) {
    return sock.sendMessage(
      chat,
      { text: '❌ Prefix cannot contain letters or numbers.' },
      { quoted: msg }
    );
  }
  if (/\s/.test(arg)) {
    return sock.sendMessage(
      chat,
      { text: '❌ Prefix cannot contain spaces.' },
      { quoted: msg }
    );
  }
  if (arg === current) {
    return sock.sendMessage(
      chat,
      { text: `ℹ️ Prefix is already \`${current}\`` },
      { quoted: msg }
    );
  }

  setPrefix(arg);
  return sock.sendMessage(
    chat,
    {
      text: [
        `✅ Prefix changed`,
        `From: \`${current}\``,
        `To:   \`${arg}\``,
        '',
        `_Now try \`${arg}help\`_`,
      ].join('\n'),
    },
    { quoted: msg }
  );
}
