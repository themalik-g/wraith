import { renderPPTBuffer } from '../lib/ppt/pptRenderer.js';

console.log('--- Testing PPT on-demand installation & rendering ---');

const dummySlideData = {
  title: 'Test Presentation',
  subtitle: 'Testing on-demand pptxgenjs',
  slides: [
    { layout: 'title', title: 'Test Presentation', subtitle: 'On Demand' },
    { layout: 'content', title: 'Slide 1', bullets: ['Bullet 1', 'Bullet 2'] }
  ]
};

const buffer = await renderPPTBuffer(dummySlideData);
console.log('PPT Buffer created successfully, size:', buffer.length, 'bytes');

if (!Buffer.isBuffer(buffer) || buffer.length < 100) {
  throw new Error('PPT Buffer generation failed or buffer is too small');
}

console.log('✅ PPT on-demand test passed successfully!');
