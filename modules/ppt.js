// ─────────────────────────────────────────────
// WRAITH · modules/ppt.js
// .ppt <topic>;<subtopics>;<theme>;<slides> — Gemini AI Presentation Generator
// ─────────────────────────────────────────────

import { generatePPT } from '../lib/ppt/index.js';
import { sendWithCta } from '../lib/buttons.js';

export async function pptCommand(sock, chat, msg, args) {
  const rawInput = (args || []).join(' ').trim();

  if (!rawInput) {
    return sendWithCta(sock, chat, `📊 *PPT Presentation Generator*\n\n` +
            `*Usage:* \`.ppt <topic>;<subtopics>;<theme keywords>;<number of slides>\`\n\n` +
            `*Examples:*\n` +
            `• \`.ppt atomic energy\`\n` +
            `• \`.ppt female reproductive system;ovaries, uterus, hormones;warm medical green;10\`\n` +
            `• \`.ppt cloud computing;;dark blue;8\``, { quoted: msg });
  }

  const status = await sock.sendMessage(chat, {
    text: `📊 *Generating AI Presentation with Gemini…*`
  }, { quoted: msg });

  try {
    const { buffer, title, slideCount } = await generatePPT(rawInput);

    const safeFilename = (title || 'presentation')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .slice(0, 40) || 'presentation';

    await sock.sendMessage(chat, {
      document: buffer,
      fileName: `${safeFilename}.pptx`,
      mimetype: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      caption: `📊 *${title}*\n_Slides: ${slideCount}_\n\nProvided by 𝗪𝗥𝗜𝗧🇭`
    }, { quoted: msg });

    await sock.sendMessage(chat, {
      text: `✅ *Presentation generated successfully!*`,
      edit: status.key
    }).catch(() => {});

  } catch (err) {
    console.error('[PPT] Command error:', err.message || err);

    let userMsg = `❌ *PPT generation failed:* ${err.message}`;

    if (err.message === 'GEMINI_API_KEY_MISSING') {
      userMsg = '⚠️ *Please add your GEMINI_API_KEY to environment variables (`.env`) to use the PPT feature.*';
    } else if (err.message === 'INVALID_TOPIC') {
      userMsg = `⚠️ *Please provide a valid topic for the presentation.*`;
    }

    await sock.sendMessage(chat, {
      text: userMsg,
      edit: status.key
    }).catch(() => {
      sock.sendMessage(chat, { text: userMsg }, { quoted: msg }).catch(() => {});
    });
  }
}
