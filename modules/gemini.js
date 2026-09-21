// ─────────────────────────────────────────────
// WRAITH · modules/gemini.js
// .gemini <prompt> — Gemini AI simple text response
// .photo <prompt> — AI image generator (moved from .gemini)
// ─────────────────────────────────────────────
import { getKey } from '../core/keys.js';
import { fetchBuffer, httpGetText } from '../lib/net.js';
import { sendWithCta } from '../lib/buttons.js';

function getQuotedText(msg) {
  const ctx = msg.message?.extendedTextMessage?.contextInfo;
  if (!ctx?.quotedMessage) return '';
  const qm = ctx.quotedMessage;
  return (
    qm.conversation ||
    qm.extendedTextMessage?.text ||
    qm.interactiveMessage?.body?.text ||
    qm.imageMessage?.caption ||
    qm.videoMessage?.caption ||
    ''
  ).trim();
}

/**
 * .gemini <prompt> — Generates simple AI text response
 */
export async function geminiCommand(sock, chat, msg, args) {
  let userText = (args || []).join(' ').trim();
  const quoted = getQuotedText(msg);

  if (!userText && !quoted) {
    return sendWithCta(sock, chat, `🤖 *Gemini AI Assistant*\n\nUsage: \`.gemini <question or prompt>\`\nOr reply to a message with \`.gemini <question>\`\n\nExample: \`.gemini Explain quantum physics in simple terms\``, { quoted: msg });
  }

  let fullPrompt = userText;
  if (quoted) {
    fullPrompt = userText
      ? `Reference Message:\n"${quoted}"\n\nUser Request: ${userText}`
      : `Reference Message:\n"${quoted}"\n\nPlease summarize or analyze this text.`;
  }

  const apiKey = process.env.GEMINI_API_KEY || getKey('GEMINI_API_KEY');

  const statusMsg = await sock.sendMessage(chat, {
    text: `🤖 *Thinking with Gemini AI…*`
  }, { quoted: msg });

  try {
    let aiResponse = '';

    // 1. Try Gemini API if API key is configured
    if (apiKey) {
      const models = ['gemini-3.5-flash-lite', 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];
      for (const model of models) {
        try {
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: fullPrompt }] }]
            })
          });

          if (res.ok) {
            const json = await res.json();
            const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text) {
              aiResponse = text.trim();
              break;
            }
          }
        } catch (e) {
          console.warn(`[geminiCommand] ${model} API error:`, e.message);
        }
      }
    }

    // 2. Keyless AI Fallback if no API key or API call failed
    if (!aiResponse) {
      try {
        const fallbackUrl = `https://text.pollinations.ai/${encodeURIComponent(fullPrompt)}`;
        const text = await httpGetText(fallbackUrl, { timeout: 20000 });
        if (text && text.trim().length > 0) {
          aiResponse = text.trim();
        }
      } catch (e) {
        console.warn('[geminiCommand] Keyless AI fallback failed:', e.message);
      }
    }

    if (!aiResponse) {
      throw new Error('Unable to generate AI text response at this time.');
    }

    const replyText = `🤖 *Gemini AI*\n\n${aiResponse}\n\nProvided by 𝗪𝗥𝗔𝗜𝗧🇭`;

    await sock.sendMessage(chat, {
      text: replyText,
      edit: statusMsg.key
    }).catch(() => {
      sock.sendMessage(chat, { text: replyText }, { quoted: msg }).catch(() => {});
    });

  } catch (err) {
    console.error('[geminiCommand]', err.message);
    const errText = `❌ *Gemini AI Failed:* ${err.message}`;
    await sock.sendMessage(chat, {
      text: errText,
      edit: statusMsg.key
    }).catch(() => {
      sock.sendMessage(chat, { text: errText }, { quoted: msg }).catch(() => {});
    });
  }
}

/**
 * .photo <prompt> — Generates AI photo/image from prompt
 */
export async function photoCommand(sock, chat, msg, args) {
  const prompt = (args || []).join(' ').trim();

  if (!prompt) {
    return sendWithCta(sock, chat, `📸 *AI Photo Generator*\n\nUsage: \`.photo <image prompt>\`\n\nExample: \`.photo futuristic city with glowing neon skyscrapers at night\``, { quoted: msg });
  }

  const apiKey = process.env.GEMINI_API_KEY || getKey('GEMINI_API_KEY');

  const statusMsg = await sock.sendMessage(chat, {
    text: `📸 *Generating AI photo…*`
  }, { quoted: msg });

  try {
    let imageBuffer = null;

    // 1. Try Gemini Image Generation API if API key present
    if (apiKey) {
      const imageModels = [
        'gemini-3.1-flash-lite-image',
        'imagen-3.0-generate-002'
      ];
      for (const model of imageModels) {
        try {
          if (model.startsWith('gemini')) {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
            const res = await fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }]
              })
            });
            if (res.ok) {
              const json = await res.json();
              const parts = json?.candidates?.[0]?.content?.parts || [];
              for (const part of parts) {
                if (part.inlineData?.data) {
                  imageBuffer = Buffer.from(part.inlineData.data, 'base64');
                  break;
                }
              }
              if (imageBuffer) break;
            }
          } else {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:predict?key=${apiKey}`;
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
                break;
              }
            }
          }
        } catch (e1) {
          console.warn(`[photoCommand] ${model} API failed:`, e1.message);
        }
      }
    }

    // 2. Keyless Fallback Image APIs
    if (!imageBuffer) {
      const fallbackApis = [
        `https://gen.pollinations.ai/image/${encodeURIComponent(prompt)}?model=flux`,
        `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true`,
        `https://api.lolhuman.xyz/api/imagen?apikey=GataDios&text=${encodeURIComponent(prompt)}`
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
      throw new Error('Could not generate AI photo for this prompt.');
    }

    await sock.sendMessage(chat, {
      image: imageBuffer,
      caption: `📸 *AI Photo Generator*\n💬 _${prompt}_\n\nProvided by 𝗪𝗥𝗔𝗜𝗧🇭`
    }, { quoted: msg });

    await sock.sendMessage(chat, {
      text: '✅ *Photo generated successfully!*',
      edit: statusMsg.key
    }).catch(() => {});

  } catch (err) {
    console.error('[photoCommand]', err.message);
    const errText = `❌ *AI Photo Generation Failed:* ${err.message}`;
    await sock.sendMessage(chat, {
      text: errText,
      edit: statusMsg.key
    }).catch(() => {
      sock.sendMessage(chat, { text: errText }, { quoted: msg }).catch(() => {});
    });
  }
}
