// ─────────────────────────────────────────────
// WRAITH · modules/usermanual.js
// Dynamic PDF downloader for official bot user manual
// ─────────────────────────────────────────────
import { fetchBuffer } from '../lib/net.js';

const MANUAL_URL = 'https://raw.githubusercontent.com/themalik-g/wraith_manual/main/wraith_manual.pdf';

export async function usermanualCommand(sock, chat, msg) {
  const statusMsg = await sock.sendMessage(chat, {
    text: '📄 *Fetching WRAITH User Manual PDF…*'
  }, { quoted: msg });

  try {
    const pdfBuffer = await fetchBuffer(MANUAL_URL, { timeout: 20000, maxBytes: 50 * 1024 * 1024 });

    if (!pdfBuffer || pdfBuffer.length < 1024) {
      throw new Error('Downloaded PDF manual is empty or invalid.');
    }

    await sock.sendMessage(
      chat,
      {
        document: pdfBuffer,
        mimetype: 'application/pdf',
        fileName: 'wraith_manual.pdf',
        caption: '📄 *WRAITH Bot — Official User Manual*\n\nDownloaded from: `https://github.com/themalik-g/wraith_manual.git`\n\nProvided by 𝗪𝗥𝗜𝗧🇭',
      },
      { quoted: msg }
    );

    await sock.sendMessage(chat, {
      text: '✅ *User Manual sent successfully!*',
      edit: statusMsg.key
    }).catch(() => {});

  } catch (e) {
    console.error('[usermanualCommand]', e);
    const errText = `⚠️ *Failed to download user manual:* ${e.message}`;
    await sock.sendMessage(chat, {
      text: errText,
      edit: statusMsg.key
    }).catch(() => {
      sock.sendMessage(chat, { text: errText }, { quoted: msg }).catch(() => {});
    });
  }
}
