// ─────────────────────────────────────────────
// WRAITH · modules/usermanual.js
// Dynamic PDF downloader for official bot user manual
// ─────────────────────────────────────────────
import fs from 'node:fs';
import path from 'node:path';
import { fetchBuffer } from '../lib/net.js';
import { inData } from '../core/paths.js';

const MANUAL_URL = 'https://raw.githubusercontent.com/themalik-g/wraith_manual/main/wraith_manual.pdf';
const CACHE_FILE = () => inData('wraith_manual.pdf');

export async function usermanualCommand(sock, chat, msg) {
  const statusMsg = await sock.sendMessage(chat, {
    text: '📄 *Fetching WRAITH User Manual PDF…*'
  }, { quoted: msg });

  try {
    let pdfBuffer = null;
    const cachePath = CACHE_FILE();

    // Check if we can fetch fresh PDF from GitHub repo
    try {
      pdfBuffer = await fetchBuffer(MANUAL_URL, { timeout: 20000, maxBytes: 50 * 1024 * 1024 });
      if (pdfBuffer && pdfBuffer.length > 1024) {
        // Cache locally for fallback or offline use
        fs.writeFileSync(cachePath, pdfBuffer);
      }
    } catch (fetchErr) {
      console.warn('[usermanualCommand] Fetch error, attempting cache fallback:', fetchErr.message);
      if (fs.existsSync(cachePath)) {
        pdfBuffer = fs.readFileSync(cachePath);
      } else {
        throw new Error(`Failed to download manual from repository and no local cache was found (${fetchErr.message})`);
      }
    }

    if (!pdfBuffer || pdfBuffer.length < 1024) {
      throw new Error('Downloaded PDF manual is empty or invalid.');
    }

    await sock.sendMessage(
      chat,
      {
        document: pdfBuffer,
        mimetype: 'application/pdf',
        fileName: 'wraith_manual.pdf',
        caption: '📄 *WRAITH Bot — Official User Manual*\n\nDownloaded from: `https://github.com/themalik-g/wraith_manual.git`\n\nProvided by 𝕎ℝI𝕋ℍ',
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
