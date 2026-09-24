// ─────────────────────────────────────────────
// WRAITH · lib/ffmpeg-resolver.js
// Resolves system ffmpeg/ffprobe with fallback to static packages
// ─────────────────────────────────────────────

import { spawnSync } from 'node:child_process';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';

function resolveFfmpeg() {
  try {
    const res = spawnSync('ffmpeg', ['-version'], { timeout: 2000 });
    if (res.status === 0) {
      return 'ffmpeg';
    }
  } catch {}
  return ffmpegStatic;
}

function resolveFfprobe() {
  try {
    const res = spawnSync('ffprobe', ['-version'], { timeout: 2000 });
    if (res.status === 0) {
      return 'ffprobe';
    }
  } catch {}
  return ffprobeStatic?.path || ffprobeStatic;
}

export const ffmpegPath = resolveFfmpeg();
export const ffprobePath = resolveFfprobe();
