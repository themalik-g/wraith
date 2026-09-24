// ─────────────────────────────────────────────
// WRAITH · lib/image-resize.js
// ffmpeg-based image crop/resize (no jimp dependency)
// ─────────────────────────────────────────────
import { spawn } from 'node:child_process';
import { ffmpegPath } from './ffmpeg-resolver.js';

/**
 * Resize an image Buffer into a square `size`x`size` JPEG Buffer.
 * Uses scale+crop for full coverage (no letterboxing).
 * @param {Buffer} buffer
 * @param {number} size
 * @returns {Promise<Buffer>}
 */
export function resizeSquare(buffer, size = 640) {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error('ffmpeg binary missing'));
    if (!Buffer.isBuffer(buffer) || buffer.length < 256) {
      return reject(new Error('input buffer too small'));
    }

    let ff;
    try {
      ff = spawn(ffmpegPath, [
        '-hide_banner', '-loglevel', 'error',
        '-i', 'pipe:0',
        '-vf', `scale=${size}:${size}:force_original_aspect_ratio=increase,crop=${size}:${size}`,
        '-frames:v', '1',
        '-f', 'image2',
        '-vcodec', 'mjpeg',
        '-q:v', '3',
        'pipe:1',
      ]);
    } catch (e) {
      return reject(new Error(`ffmpeg spawn failed: ${e.message}`));
    }

    const chunks = [];
    let err = '';
    let settled = false;
    const done = (fn, arg) => { if (!settled) { settled = true; fn(arg); } };

    ff.stdout.on('data', (c) => chunks.push(c));
    ff.stderr.on('data', (d) => { err += d.toString(); });
    ff.on('error', (e) => done(reject, new Error(`ffmpeg error: ${e.message}`)));
    ff.on('close', (code) => {
      if (code !== 0) return done(reject, new Error(`ffmpeg exit ${code}: ${err.slice(-200)}`));
      const out = Buffer.concat(chunks);
      if (out.length < 256) return done(reject, new Error('ffmpeg produced empty image'));
      done(resolve, out);
    });
    ff.stdin.on('error', () => {});
    try {
      ff.stdin.write(buffer);
      ff.stdin.end();
    } catch (e) {
      done(reject, new Error(`ffmpeg stdin failed: ${e.message}`));
    }
  });
}
