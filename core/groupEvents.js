// ─────────────────────────────────────────────
// WRAITH · core/groupEvents.js
// Welcome / goodbye messages on membership changes.
// Wired in start.js → 'group-participants.update'
// ─────────────────────────────────────────────
import { getPrefix } from '../core/settings.js';
import { getWelcomeConfig } from '../modules/group.js';

function mentionText(participants) {
  return participants
    .map((p) => '@' + String(p).split('@')[0].split(':')[0])
    .join(' ');
}

export function handleGroupParticipantUpdate(sock, update) {
  try {
    const chat = update?.id;
    const action = update?.action;
    const participants = (update?.participants || []).filter(Boolean);
    if (!chat || !action || !participants.length) return;
    if (!String(chat).endsWith('@g.us')) return;

    const cfg = getWelcomeConfig()[chat];
    if (!cfg) return;

    if (action === 'add' && cfg.welcome) {
      const text =
        `👋 Welcome ${mentionText(participants)}!\n` +
        `Enjoy your stay. Type \`${getPrefix()}help\` to see what the bot can do.`;
      sock.sendMessage(chat, { text, mentions: participants }).catch(() => {});
      return;
    }

    if ((action === 'remove' || action === 'leave') && cfg.goodbye) {
      const text = `👋 Goodbye ${mentionText(participants)}.`;
      sock.sendMessage(chat, { text, mentions: participants }).catch(() => {});
      return;
    }
  } catch (e) {
    console.error('[groupEvents]', e.message);
  }
}
