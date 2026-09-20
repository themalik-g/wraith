// ─────────────────────────────────────────────
// WRAITH · modules/gemini.js
// .gemini <prompt> — Gemini AI image generation command
// ─────────────────────────────────────────────
import { getKey } from '../core/keys.js';
import { fetchBuffer } from '../lib/net.js';

export async function geminiCommand(sock, chat, msg, args) {
  const prompt = (args || []).join(' ').trim();

  if (!prompt) {
    return sock.sendMessage(chat, {
      text: `🎨 *Gemini AI Image Generator*\n\nUsage: \`.gemini <image prompt>\`\n\nExample: \`.gemini hyperrealistic futuristic cyberpunk city at night with neon rain\``
    }, { quoted: msg });
  }

  const apiKey = process.env.GEMINI_API_KEY || getKey('GEMINI_API_KEY');
  if (!apiKey) {
    return sock.sendMessage(chat, {
      text: '⚠️ *GEMINI_API_KEY is not configured in environment variables or session vars.*'
    }, { quoted: msg });
  }

  const statusMsg = await sock.sendMessage(chat, {
    text: `🎨 *Generating image with Gemini AI…*`
  }, { quoted: msg });

  try {
    let imageBuffer = null;

    // 1. Try Imagen 3 API via Gemini Google REST endpoint
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${apiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instances: [{ prompt }],
          parameters: { sampleCount: 1, aspectRatio: '1:1', outputOptions: { mimeType: 'image/jpeg' } }
        })
      });

      if (res.ok) {
        const json = await res.json();
        const base64Data = json?.predictions?.[0]?.bytesBase64Encoded;
        if (base64Data) {
          imageBuffer = Buffer.from(base64Data, 'base64');
        }
      }
    } catch (e1) {
      console.warn('[geminiCommand] Imagen REST API failed:', e1.message);
    }

    // 2. Fallback to Gemini 2.0 Flash / Imagen API generation endpoints
    if (!imageBuffer) {
      const fallbackApis = [
        `https://api.lolhuman.xyz/api/imagen?apikey=GataDios&text=${encodeURIComponent(prompt)}`,
        `https://gen.pollinations.ai/image/${encodeURIComponent(prompt)}?model=flux`,
        `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true`
      ];

      for (const apiUrl of fallbackApis) {
        try {
          const buf = await fetchBuffer(apiUrl, { timeout: 25000 });
          if (buf && buf.length > 2048) {
            imageBuffer = buf;
            break;
          }
        } catch {}
      }
    }

    if (!imageBuffer || imageBuffer.length < 1024) {
      throw new Error('Could not generate image from Gemini API for this prompt.');
    }

    await sock.sendMessage(chat, {
      image: imageBuffer,
      caption: `🤖 *Gemini Image Generator*\n💬 _${prompt}_\n\nProvided by 𝕎ℝI𝕋ℍ`
    }, { quoted: msg });

    await sock.sendMessage(chat, {
      text: '✅ *Image generated successfully!*',
      edit: statusMsg.key
    }).catch(() => {});

  } catch (err) {
    console.error('[geminiCommand]', err.message);
    const errText = `❌ *Gemini Image Generation Failed:* ${err.message}`;
    await sock.sendMessage(chat, {
      text: errText,
      edit: statusMsg.key
    }).catch(() => {
      sock.sendMessage(chat, { text: errText }, { quoted: msg }).catch(() => {});
    });
  }
}
