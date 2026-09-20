// ─────────────────────────────────────────────
// WRAITH · lib/ytdlp.js
// ytdlp-nodejs utility wrapper using ffmpeg-static
// ─────────────────────────────────────────────
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { YtDlp } from 'ytdlp-nodejs';
import ffmpegPath from 'ffmpeg-static';

const TMP_DIR = path.join(os.tmpdir(), 'wraith-ytdlp');
fs.mkdirSync(TMP_DIR, { recursive: true });

export const ytdlp = new YtDlp({
  ffmpegPath: ffmpegPath,
});

export function getTmpDir() {
  return TMP_DIR;
}

export function cleanFile(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {}
}

export function cleanOldTmpFiles(maxAgeMs = 15 * 60 * 1000) {
  try {
    const now = Date.now();
    for (const f of fs.readdirSync(TMP_DIR)) {
      const fullPath = path.join(TMP_DIR, f);
      try {
        const stat = fs.statSync(fullPath);
        if (now - stat.mtimeMs > maxAgeMs) {
          fs.unlinkSync(fullPath);
        }
      } catch {}
    }
  } catch {}
}
