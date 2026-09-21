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

// Ensure process temporary environment points to project data storage
if (!process.env.TMPDIR || process.env.TMPDIR.startsWith('/tmp')) {
  process.env.TMPDIR = TMP_DIR;
  process.env.TEMP = TMP_DIR;
  process.env.TMP = TMP_DIR;
}

export const ytdlp = new YtDlp({
  ffmpegPath: ffmpegPath,
});

export function getTmpDir() {
  fs.mkdirSync(TMP_DIR, { recursive: true });
  return TMP_DIR;
}

export function configureDownload(dl, outputDir = getTmpDir()) {
  fs.mkdirSync(outputDir, { recursive: true });
  if (dl?.extraArgs) {
    dl.extraArgs.paths = { temp: outputDir, home: outputDir };
  }
  return dl;
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

export function cleanPrefix(prefix, dir = getTmpDir()) {
  try {
    if (!prefix || !fs.existsSync(dir)) return;
    const doClean = () => {
      for (const f of fs.readdirSync(dir)) {
        if (f.startsWith(prefix) || f.includes(prefix)) {
          const fullPath = path.join(dir, f);
          try {
            if (fs.statSync(fullPath).isDirectory()) {
              fs.rmSync(fullPath, { recursive: true, force: true });
            } else {
              fs.unlinkSync(fullPath);
            }
          } catch {}
        }
      }
    };
    doClean();
    // Secondary delayed cleanup pass in case of brief file handle locks
    setTimeout(() => {
      try { doClean(); } catch {}
    }, 1000);
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
