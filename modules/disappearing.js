// ─────────────────────────────────────────────
// WRAITH · modules/disappearing.js
// .disappearing command for turning on/off disappearing
// messages in any chat (off, 24h, 7d, 24d, 90d)
// ─────────────────────────────────────────────
import { sendWithCta } from '../lib/buttons.js';

export function parseDisappearingDuration(inputStr) {
  if (!inputStr) return null;
  const clean = inputStr.trim().toLowerCase().replace(/\s+/g, '');

  if (clean === 'off' || clean === 'disable' || clean === '0' || clean === 'false') {
    return { expiration: 0, label: 'OFF' };
  }
  if (
    clean === '24hours' || clean === '24hour' || clean === '24h' ||
    clean === '24hrs' || clean === '24hr' || clean === '1day' || clean === '1d' || clean === '24'
  ) {
    return { expiration: 86400, label: '24 Hours' };
  }
  if (
    clean === '7days' || clean === '7day' || clean === '7d' ||
    clean === '1week' || clean === '1w' || clean === '7'
  ) {
    return { expiration: 604800, label: '7 Days' };
  }
  if (
    clean === '24days' || clean === '24day' || clean === '24d'
  ) {
    return { expiration: 2073600, label: '24 Days' };
  }
  if (
    clean === '90days' || clean === '90day' || clean === '90d' || clean === '90'
  ) {
    return { expiration: 7776000, label: '90 Days' };
  }

  return null;
}

export async function disappearingCommand(sock, chat, msg, args) {
  const inputStr = (args || []).join(' ').trim();
  const matched = parseDisappearingDuration(inputStr);

  if (!matched) {
    const helpText =
      `⏳ *Disappearing Messages*\n\n` +
      `Apply disappearing messages in any chat.\n\n` +
      `*Usage:*\n` +
      `• \`.disappearing off\`\n` +
      `• \`.disappearing 24 hours\` (or \`24h\`)\n` +
      `• \`.disappearing 7 days\` (or \`7d\`)\n` +
      `• \`.disappearing 24 days\` (or \`24d\`)\n` +
      `• \`.disappearing 90 days\` (or \`90d\`)`;
    return sendWithCta(sock, chat, helpText, { quoted: msg });
  }

  const { expiration, label } = matched;

  try {
    if (chat.endsWith('@g.us')) {
      try {
        await sock.groupToggleEphemeral(chat, expiration);
      } catch (e) {
        console.error('[disappearingCommand:groupToggleEphemeral]', e.message);
      }
    }

    await sock.sendMessage(chat, { disappearingMessagesInChat: expiration }, { quoted: msg });

    const replyText = expiration === 0
      ? `✅ Disappearing messages turned *OFF* for this chat.`
      : `⏳ Disappearing messages set to *${label}* for this chat.`;

    await sendWithCta(sock, chat, replyText, { quoted: msg });
  } catch (e) {
    console.error('[disappearingCommand]', e);
    await sock.sendMessage(chat, { text: `❌ *Failed to update disappearing messages:* ${e.message}` }, { quoted: msg });
  }
}
