// ─────────────────────────────────────────────
// WRAITH · lib/ppt/commandParser.js
// Parses command string: .ppt topic;subtopics;theme;slideCount
// ─────────────────────────────────────────────

export function parsePPTCommand(input) {
  if (!input || typeof input !== 'string') {
    return { topic: '', subtopics: '', theme: '', slideCount: null };
  }

  const parts = input.split(';').map(p => p.trim());
  const topic = parts[0] || '';
  const subtopics = parts[1] || '';
  const theme = parts[2] || '';
  let slideCount = null;

  if (parts[3]) {
    const parsedNum = parseInt(parts[3], 10);
    if (!isNaN(parsedNum) && parsedNum > 0 && parsedNum <= 25) {
      slideCount = parsedNum;
    }
  }

  return {
    topic,
    subtopics,
    theme,
    slideCount: slideCount || 6 // Default to 6 slides if unspecified
  };
}
