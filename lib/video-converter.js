// ─────────────────────────────────────────────
// WRAITH · lib/video-converter.js
// WhatsApp video compatibility pipeline
// ─────────────────────────────────────────────
import { execFile } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';

const ffprobePath = ffprobeStatic?.path || ffprobeStatic;

/**
 * Helper to run child process with hard timeout and auto-kill
 */
function runWithTimeout(file, args, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    let child;
    let timer;

    try {
      child = execFile(file, args, (error, stdout, stderr) => {
        if (timer) clearTimeout(timer);
        if (error) {
          return reject(error);
        }
        resolve({ stdout, stderr });
      });

      timer = setTimeout(() => {
        if (child) {
          try { child.kill('SIGKILL'); } catch {}
        }
        reject(new Error(`Process ${file} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    } catch (err) {
      if (timer) clearTimeout(timer);
      reject(err);
    }
  });
}

/**
 * Probe video and audio streams of local file
 */
export async function probe(file, timeoutMs = 10000) {
  const { stdout: vOut } = await runWithTimeout(ffprobePath, [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=codec_name,profile,pix_fmt',
    '-of', 'json',
    file,
  ], timeoutMs);

  const parsedV = JSON.parse(vOut || '{}');
  const video = parsedV?.streams?.[0] || null;

  const { stdout: aOut } = await runWithTimeout(ffprobePath, [
    '-v', 'error',
    '-select_streams', 'a:0',
    '-show_entries', 'stream=codec_name',
    '-of', 'json',
    file,
  ], timeoutMs);

  const parsedA = JSON.parse(aOut || '{}');
  const audio = parsedA?.streams?.[0] || null;

  return { video, audio };
}

/**
 * Check if video is natively WhatsApp / Android compatible
 */
export async function isPlayable(file, timeoutMs = 10000) {
  const { video, audio } = await probe(file, timeoutMs);
  if (!video) return false;

  const vOk =
    video.codec_name === 'h264' &&
    ['Baseline', 'Constrained Baseline', 'Main'].includes(video.profile) &&
    video.pix_fmt === 'yuv420p';

  const aOk = !audio || audio.codec_name === 'aac';

  return vOk && aOk;
}

/**
 * Remux container when video streams are already compatible (-c copy)
 */
export async function remux(input, output, timeoutMs = 15000) {
  await runWithTimeout(ffmpegPath, [
    '-y',
    '-i', input,
    '-map', '0:v:0',
    '-map', '0:a:0?',
    '-c', 'copy',
    '-movflags', '+faststart',
    '-dn', '-sn',
    output,
  ], timeoutMs);
}

/**
 * Detect hardware encoders available in ffmpeg
 */
export async function getHwEncoder(timeoutMs = 5000) {
  try {
    const { stdout } = await runWithTimeout(ffmpegPath, ['-hide_banner', '-encoders'], timeoutMs);
    if (stdout.includes('h264_nvenc')) return 'h264_nvenc';
    if (stdout.includes('h264_qsv')) return 'h264_qsv';
    if (stdout.includes('h264_amf')) return 'h264_amf';
  } catch {}
  return null;
}

/**
 * Transcode video to WhatsApp-compliant format
 */
export async function transcode(input, output, hwEncoder, timeoutMs = 120000) {
  const videoArgs = hwEncoder
    ? ['-c:v', hwEncoder]
    : ['-c:v', 'libx264', '-preset', 'ultrafast'];

  await runWithTimeout(ffmpegPath, [
    '-y',
    '-i', input,
    ...videoArgs,
    '-profile:v', 'baseline',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-movflags', '+faststart',
    '-map', '0:v:0',
    '-map', '0:a:0?',
    '-dn', '-sn',
    output,
  ], timeoutMs);
}

/**
 * Main entry point: ensures file is WhatsApp playable.
 * Returns converted path if successful, or falls back to original input path on failure/timeout.
 */
export async function ensurePlayable(input, output) {
  try {
    if (await isPlayable(input, 10000)) {
      await remux(input, output, 15000);
      return output;
    }

    const hw = await getHwEncoder(5000);
    try {
      await transcode(input, output, hw, 120000);
    } catch (err) {
      if (hw) {
        // Hardware failed, fall back to software
        await transcode(input, output, null, 120000);
      } else {
        throw err;
      }
    }
    return output;
  } catch (err) {
    console.warn('[ensurePlayable] Video processing failed or timed out, falling back to original video:', err.message);
    return input;
  }
}
