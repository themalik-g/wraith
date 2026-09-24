import { ffmpegPath, ffprobePath } from '../lib/ffmpeg-resolver.js';

console.log('--- Testing lib/ffmpeg-resolver.js ---');
console.log('Resolved ffmpegPath:', ffmpegPath);
console.log('Resolved ffprobePath:', ffprobePath);

if (!ffmpegPath) {
  throw new Error('ffmpegPath was not resolved');
}
if (!ffprobePath) {
  throw new Error('ffprobePath was not resolved');
}

console.log('✅ ffmpeg-resolver test passed successfully!');
