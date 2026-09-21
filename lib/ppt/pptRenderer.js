// ─────────────────────────────────────────────
// WRAITH · lib/ppt/pptRenderer.js
// Renders structured JSON slide data to PptxGenJS Buffer (in-memory)
// ─────────────────────────────────────────────

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function sanitizeHex(colorStr, fallbackHex) {
  if (!colorStr || typeof colorStr !== 'string') return fallbackHex;
  const cleaned = colorStr.replace(/[^0-9A-Fa-f]/g, '');
  if (cleaned.length === 6) return cleaned.toUpperCase();
  if (cleaned.length === 3) {
    return cleaned.split('').map(c => c + c).join('').toUpperCase();
  }
  return fallbackHex;
}

export async function renderPPTBuffer(slideData) {
  let PptxGenJS;
  try {
    const mod = require('pptxgenjs');
    PptxGenJS = mod?.default || mod;
  } catch (err) {
    throw new Error('pptxgenjs library is not available');
  }

  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE'; // 16:9 ratio
  pptx.title = slideData.title || 'Presentation';

  const rawTheme = slideData.theme || {};
  const theme = {
    bgColor: sanitizeHex(rawTheme.backgroundColor, '1A1A2E'),
    textColor: sanitizeHex(rawTheme.primaryTextColor, 'FFFFFF'),
    accentColor: sanitizeHex(rawTheme.accentColor, '00ADB5'),
    cardColor: sanitizeHex(rawTheme.cardBackgroundColor, '16213E'),
    font: rawTheme.fontFamily || 'Arial'
  };

  const slides = slideData.slides || [];

  for (let idx = 0; idx < slides.length; idx++) {
    const sData = slides[idx];
    const slide = pptx.addSlide();
    slide.background = { color: theme.bgColor };

    if (sData.layout === 'title' || idx === 0) {
      // Title slide layout
      slide.addText(slideData.title || sData.title || 'Presentation', {
        x: 0.8,
        y: 2.2,
        w: 11.7,
        h: 1.8,
        fontSize: 38,
        bold: true,
        align: 'center',
        color: theme.textColor,
        fontFace: theme.font
      });

      slide.addText(slideData.subtitle || sData.subtitle || '', {
        x: 0.8,
        y: 4.1,
        w: 11.7,
        h: 0.8,
        fontSize: 20,
        align: 'center',
        color: theme.accentColor,
        fontFace: theme.font
      });

      slide.addText('Provided by 𝗪𝗥𝗔𝗜𝗧🇭', {
        x: 0.8,
        y: 6.2,
        w: 11.7,
        h: 0.5,
        fontSize: 12,
        align: 'center',
        color: '888888',
        fontFace: theme.font
      });
      continue;
    }

    // Header title for content slides
    slide.addText(sData.title || `Slide ${idx + 1}`, {
      x: 0.8,
      y: 0.5,
      w: 11.7,
      h: 0.8,
      fontSize: 26,
      bold: true,
      color: theme.accentColor,
      fontFace: theme.font
    });

    // Subtitle / Footer header bar line
    slide.addShape(pptx.shapes.RECTANGLE, {
      x: 0.8,
      y: 1.35,
      w: 11.7,
      h: 0.04,
      fill: { color: theme.accentColor }
    });

    if (sData.layout === 'two_column') {
      const leftBullets = sData.leftColumn || [];
      const rightBullets = sData.rightColumn || [];

      // Left Column Card
      slide.addShape(pptx.shapes.RECTANGLE, {
        x: 0.8, y: 1.6, w: 5.6, h: 4.8,
        fill: { color: theme.cardColor }
      });
      if (leftBullets.length > 0) {
        slide.addText(
          leftBullets.map(b => ({ text: b, options: { bullet: true, breakLine: true } })),
          {
            x: 1.0, y: 1.8, w: 5.2, h: 4.4,
            fontSize: 15, color: theme.textColor, fontFace: theme.font, lineSpacing: 22
          }
        );
      }

      // Right Column Card
      slide.addShape(pptx.shapes.RECTANGLE, {
        x: 6.9, y: 1.6, w: 5.6, h: 4.8,
        fill: { color: theme.cardColor }
      });
      if (rightBullets.length > 0) {
        slide.addText(
          rightBullets.map(b => ({ text: b, options: { bullet: true, breakLine: true } })),
          {
            x: 7.1, y: 1.8, w: 5.2, h: 4.4,
            fontSize: 15, color: theme.textColor, fontFace: theme.font, lineSpacing: 22
          }
        );
      }

    } else {
      // Content / Summary Layout
      const bullets = sData.bullets || [];

      slide.addShape(pptx.shapes.RECTANGLE, {
        x: 0.8, y: 1.6, w: 11.7, h: 4.8,
        fill: { color: theme.cardColor }
      });

      if (bullets.length > 0) {
        slide.addText(
          bullets.map(b => ({ text: b, options: { bullet: true, breakLine: true } })),
          {
            x: 1.1, y: 1.8, w: 11.1, h: 4.4,
            fontSize: 16, color: theme.textColor, fontFace: theme.font, lineSpacing: 24
          }
        );
      }
    }

    // Footer
    const footerText = sData.footer || `Provided by 𝗪𝗥𝗔𝗜𝗧🇭  |  Page ${idx + 1}`;
    slide.addText(footerText, {
      x: 0.8, y: 6.6, w: 11.7, h: 0.4,
      fontSize: 10, align: 'right', color: '777777', fontFace: theme.font
    });
  }

  // Generate output entirely in memory buffer
  const buffer = await pptx.write({ outputType: 'nodebuffer' });
  return buffer;
}
