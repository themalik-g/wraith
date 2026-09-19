// ─────────────────────────────────────────────
// WRAITH · lib/ppt/pptGenerator.js
// Calls Gemini API with structured JSON output and system instructions
// ─────────────────────────────────────────────

import { GEMINI_SYSTEM_PROMPT } from './geminiSystemPrompt.js';
import { SLIDE_SCHEMA } from './slideSchema.js';
import { getVar } from '../../core/vars.js';

export async function generateSlideData(parsedInput) {
  const apiKey = getVar('GEMINI_API_KEY') || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    const err = new Error('GEMINI_API_KEY_MISSING');
    err.userFriendly = true;
    throw err;
  }

  const { topic, subtopics, theme, slideCount } = parsedInput;

  const promptContent = `Generate a PowerPoint presentation structure for:
- Topic: ${topic}
- Key Subtopics to cover: ${subtopics || 'General overview and key details'}
- Desired Visual Theme Style: ${theme || 'Modern, clean, professional'}
- Target Slide Count: ${slideCount || 6}`;

  const payload = {
    contents: [
      {
        role: 'user',
        parts: [{ text: promptContent }]
      }
    ],
    systemInstruction: {
      parts: [{ text: GEMINI_SYSTEM_PROMPT }]
    },
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: SLIDE_SCHEMA,
      temperature: 0.7
    }
  };

  const models = ['gemini-3.5-flash', 'gemini-2.5-flash'];
  let lastError = null;

  for (const model of models) {
    try {
      console.log(`[PPT] Calling Gemini API using model ${model}...`);
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Gemini HTTP ${res.status}: ${errText}`);
      }

      const json = await res.json();
      const rawText = json.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!rawText) {
        throw new Error('Gemini returned an empty response candidate');
      }

      const parsedData = JSON.parse(rawText);
      return parsedData;
    } catch (err) {
      console.error(`[PPT] Error calling ${model}:`, err.message);
      lastError = err;
    }
  }

  throw lastError || new Error('Failed to generate slide content with Gemini API');
}
