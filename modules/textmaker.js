// ─────────────────────────────────────────────
// WRAITH · modules/textmaker.js
// 30 popular Ephoto 360 textmaker commands
// ─────────────────────────────────────────────
import { EPHOTO_EFFECTS, createEphotoImage } from '../lib/ephoto360.js';
import { sendWithCta } from '../lib/buttons.js';

function parseTextArgs(args, isDual) {
  const raw = (args || []).join(' ').trim();
  if (!raw) return { text1: '', text2: '' };

  if (isDual) {
    if (raw.includes(';')) {
      const parts = raw.split(';');
      return { text1: parts[0].trim(), text2: parts.slice(1).join(';').trim() };
    }
    if (raw.includes('|')) {
      const parts = raw.split('|');
      return { text1: parts[0].trim(), text2: parts.slice(1).join('|').trim() };
    }
    const spaceIndex = raw.indexOf(' ');
    if (spaceIndex !== -1) {
      return { text1: raw.slice(0, spaceIndex).trim(), text2: raw.slice(spaceIndex + 1).trim() };
    }
    return { text1: raw, text2: 'WRAITH' };
  }

  return { text1: raw, text2: '' };
}

export async function handleTextmakerCommand(sock, chat, msg, effectKey, args) {
  const effect = EPHOTO_EFFECTS[effectKey];
  if (!effect) {
    return sock.sendMessage(chat, { text: `❌ Unknown textmaker effect: *${effectKey}*` }, { quoted: msg });
  }

  const { text1, text2 } = parseTextArgs(args, effect.dual);

  if (!text1) {
    const usage = effect.dual
      ? ` Usage: \`.${effectKey} text1 ; text2\` or \`.${effectKey} text1 | text2\` or \`.${effectKey} text1 text2\``
      : ` Usage: \`.${effectKey} text\``;
    return sendWithCta(sock, chat, `🎨 *Ephoto360 (${effectKey})* —${usage}`, { quoted: msg });
  }

  const statusMsg = await sock.sendMessage(chat, {
    text: `🎨 *Generating Ephoto360 text effect (${effectKey})…*`
  }, { quoted: msg });

  try {
    const buffer = await createEphotoImage(effectKey, text1, text2);
    await sock.sendMessage(chat, {
      image: buffer,
      caption: `🎨 *Ephoto360:* ${effectKey}\n💬 _${text1}${text2 ? ' | ' + text2 : ''}_\n\nProvided by 𝕎ℝI𝕋ℍ`
    }, { quoted: msg });

    await sock.sendMessage(chat, { text: '✅ *Done!*', edit: statusMsg.key }).catch(() => {});
  } catch (err) {
    console.error(`[Textmaker ${effectKey}]`, err.message);
    const errText = `❌ *Textmaker generation failed:* ${err.message}`;
    await sock.sendMessage(chat, { text: errText, edit: statusMsg.key }).catch(() => {
      sock.sendMessage(chat, { text: errText }, { quoted: msg }).catch(() => {});
    });
  }
}

export async function textmakerCommand(sock, chat, msg, args) {
  const sub = (args?.[0] || '').toLowerCase().trim();
  if (!sub || !EPHOTO_EFFECTS[sub]) {
    const available = Object.keys(EPHOTO_EFFECTS).map((k) => `• \`.${k}\``).join(' ');
    return sendWithCta(sock, chat, `🎨 *Ephoto360 Textmaker*\n\nUsage: \`.textmaker <effect> <text>\` or use direct shortcuts below:\n\n${available}`, { quoted: msg });
  }

  return handleTextmakerCommand(sock, chat, msg, sub, args.slice(1));
}
