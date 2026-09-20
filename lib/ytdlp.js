// ─────────────────────────────────────────────
// WRAITH · lib/ytdlp.js
// ytdlp-nodejs utility wrapper using ffmpeg-static
// ─────────────────────────────────────────────
import fs from 'node:fs';
import path from 'node:path';
import { YtDlp } from 'ytdlp-nodejs';
import ffmpegPath from 'ffmpeg-static';

const DATA_ROOT = process.env.WRAITH_DATA_DIR || process.cwd();
const TMP_DIR = path.resolve(DATA_ROOT, 'data', 'tmp', 'wraith-ytdlp');
fs.mkdirSync(TMP_DIR, { recursive: true });

export const ytdlp = new YtDlp({
  ffmpegPath: ffmpegPath,
});

export function getTmpDir() {
  fs.mkdirSync(TMP_DIR, { recursive: true });
  return TMP_DIR;
}

export function cleanFile(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    if (filePath) {
      const partPath = `${filePath}.part`;
      if (fs.existsSync(partPath)) {
        fs.unlinkSync(partPath);
      }
      const ytdlPath = `${filePath}.ytdl`;
      if (fs.existsSync(ytdlPath)) {
        fs.unlinkSync(ytdlPath);
      }
    }
  } catch {}
}

export function cleanOldTmpFiles(maxAgeMs = 3 * 60 * 1000) {
  try {
    if (!fs.existsSync(TMP_DIR)) return;
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
