// ─────────────────────────────────────────────
// WRAITH · test/video-converter.test.js
// ─────────────────────────────────────────────
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
import { probe, isPlayable, ensurePlayable } from '../lib/video-converter.js';

const testDir = path.resolve('data/tmp/test-video-converter');
fs.mkdirSync(testDir, { recursive: true });

async function runTests() {
  console.log('--- Testing lib/video-converter.js ---');

  // 1. Create a dummy test video using ffmpeg
  const sampleInput = path.join(testDir, 'test_input.mp4');
  const sampleOutput = path.join(testDir, 'test_output.mp4');

  try {
    execSync(`"${ffmpegPath}" -y -f lavfi -i testsrc=duration=1:size=320x240:rate=10 -c:v libx264 -profile:v baseline -pix_fmt yuv420p "${sampleInput}"`, { stdio: 'ignore' });

    // 2. Test probe
    const info = await probe(sampleInput);
    if (!info.video || info.video.codec_name !== 'h264') {
      throw new Error(`Probe failed: expected h264, got ${JSON.stringify(info)}`);
    }
    console.log('✅ Probe test passed');

    // 3. Test isPlayable
    const playable = await isPlayable(sampleInput);
    if (!playable) {
      throw new Error('isPlayable failed: expected true for baseline h264 yuv420p video');
    }
    console.log('✅ isPlayable test passed');

    // 4. Test ensurePlayable (remux path)
    const result = await ensurePlayable(sampleInput, sampleOutput);
    if (!fs.existsSync(result)) {
      throw new Error('ensurePlayable failed: output file does not exist');
    }
    console.log('✅ ensurePlayable test passed');

  } finally {
    // Cleanup
    try { fs.rmSync(testDir, { recursive: true, force: true }); } catch {}
  }

  console.log('✅ All video-converter tests passed successfully!');
}

runTests().catch(err => {
  console.error('❌ Video converter test failed:', err);
  process.exit(1);
});
