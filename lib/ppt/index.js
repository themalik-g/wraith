// ─────────────────────────────────────────────
// WRAITH · lib/ppt/index.js
// Entry module for PowerPoint presentation generation
// ─────────────────────────────────────────────

import { parsePPTCommand } from './commandParser.js';
import { generateSlideData } from './pptGenerator.js';
import { renderPPTBuffer } from './pptRenderer.js';

/**
 * Parses user input string, queries Gemini for structured slide content & theme,
 * and renders a styled PowerPoint presentation into an in-memory Buffer.
 *
 * @param {string} inputString - Command input (e.g. "topic;subtopics;theme;slides")
 * @returns {Promise<{ buffer: Buffer, title: string, slideCount: number, parsedInput: object }>}
 */
export async function generatePPT(inputString) {
  const parsedInput = parsePPTCommand(inputString);
  if (!parsedInput.topic) {
    const err = new Error('INVALID_TOPIC');
    err.userFriendly = true;
    throw err;
  }

  const slideData = await generateSlideData(parsedInput);
  const buffer = await renderPPTBuffer(slideData);

  return {
    buffer,
    title: slideData.title || parsedInput.topic,
    slideCount: slideData.slides?.length || parsedInput.slideCount,
    parsedInput
  };
}

export { parsePPTCommand, generateSlideData, renderPPTBuffer };
