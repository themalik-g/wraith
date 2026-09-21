// ─────────────────────────────────────────────
// WRAITH · modules/theme.js
// Chat Wallpapers & Profile Picture (DP) commands
// ─────────────────────────────────────────────
import fs from 'node:fs';
import path from 'node:path';
import { downloadContentFromMessage } from '@whiskeysockets/baileys';
import { sendWithCta } from '../lib/buttons.js';
import { inState } from '../core/paths.js';

const WP_FILE = () => inState('chat_wallpapers.json');

// Preset Wallpaper configurations (High Resolution Curated Wallpapers)
export const WALLPAPER_PRESETS = [
  { id: 1, name: 'Aesthetic Mountain', url: 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=1080&q=80' },
  { id: 2, name: 'Neon Cyberpunk', url: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=1080&q=80' },
  { id: 3, name: 'Nature Forest', url: 'https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=1080&q=80' },
  { id: 4, name: 'Starry Galaxy', url: 'https://images.unsplash.com/photo-1519681393784-d120267933ba?w=1080&q=80' },
  { id: 5, name: 'Sunset Beach', url: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1080&q=80' },
  { id: 6, name: 'Dark Minimalist', url: 'https://images.unsplash.com/photo-1550684848-fac1c5b4e853?w=1080&q=80' },
  { id: 7, name: 'Deep Space', url: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=1080&q=80' },
  { id: 8, name: 'Neon Waves', url: 'https://images.unsplash.com/photo-1509114397022-ed747cca3f65?w=1080&q=80' },
  { id: 9, name: 'Forest Fog', url: 'https://images.unsplash.com/photo-1513836279014-a89f7a76ae86?w=1080&q=80' },
  { id: 10, name: 'Abstract Gradient', url: 'https://images.unsplash.com/photo-1541701494587-cb58502866ab?w=1080&q=80' },
];

function loadJson(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch (e) {
    console.error(`[theme] loadJson failed for ${filePath}:`, e.message);
  }
  return {};
}

function saveJson(filePath, data) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error(`[theme] saveJson failed for ${filePath}:`, e.message);
  }
}

async function extractQuotedImageBuffer(msg) {
  try {
    const q = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    const imageNode = q?.imageMessage || msg.message?.imageMessage;
    if (!imageNode) return null;

    const stream = await downloadContentFromMessage(imageNode, 'image');
    let buffer = Buffer.alloc(0);
    for await (const chunk of stream) {
      buffer = Buffer.concat([buffer, chunk]);
    }
    return buffer.length > 0 ? buffer : null;
  } catch (e) {
    console.error('[theme] extractQuotedImageBuffer failed:', e.message);
    return null;
  }
}

// ─────────────────────────────────────────────
// Wallpaper Handler — delivers wallpaper as image in chat
// ─────────────────────────────────────────────
export async function wpCommand(sock, chat, msg, args = [], indexOverride = null) {
  try {
    const argStr = args.join(' ').toLowerCase().trim();
    const isReset = argStr === 'reset' || indexOverride === 'reset';

    if (isReset) {
      const wps = loadJson(WP_FILE());
      delete wps[chat];
      saveJson(WP_FILE(), wps);

      return sendWithCta(sock, chat, `🖼️ *Chat Wallpaper Reset*\n\nRestored chat wallpaper preference to default.\n\nProvided by 𝗪𝗥𝗔𝗜𝗧🇭`, { quoted: msg });
    }

    // Check if replying to an image
    const imageBuffer = await extractQuotedImageBuffer(msg);
    if (imageBuffer) {
      const wps = loadJson(WP_FILE());
      wps[chat] = { custom: true, date: Date.now() };
      saveJson(WP_FILE(), wps);

      return sock.sendMessage(chat, {
        image: imageBuffer,
        caption: `🖼️ *Chat Wallpaper*\n\nHere is your requested wallpaper image.\n\nProvided by 𝗪𝗥𝗔𝗜𝗧🇭`
      }, { quoted: msg });
    }

    let idx = indexOverride ? parseInt(indexOverride, 10) : parseInt(args[0], 10);
    if (!idx || isNaN(idx) || idx < 1 || idx > WALLPAPER_PRESETS.length) {
      let listText = `🖼️ *Available Chat Wallpapers*\n\nUsage: \`.wp1\` to \`.wp10\` or reply to an image with \`.wp\`\n\n`;
      WALLPAPER_PRESETS.forEach((w) => {
        listText += `*${w.id}.* ${w.name}\n`;
      });
      listText += `\n*Photo Reply:* Reply to any image message with \`.wp\` to get it as wallpaper.\n*Reset Command:* \`.reset wp\` or \`.resetwp\`\n\nProvided by 𝗪𝗥𝗔𝗜𝗧🇭`;
      return sendWithCta(sock, chat, listText, { quoted: msg });
    }

    const preset = WALLPAPER_PRESETS[idx - 1];
    let presetBuffer = null;
    try {
      const response = await fetch(preset.url);
      if (!response.ok) {
        throw new Error(`Failed to fetch wallpaper image (HTTP ${response.status})`);
      }
      presetBuffer = Buffer.from(await response.arrayBuffer());
    } catch (e) {
      console.error('[wpCommand] fetch preset image failed:', e.message);
      return sendWithCta(sock, chat, `❌ *Wallpaper Download Failed:* ${e.message}\n\nProvided by 𝗪𝗥𝗔𝗜𝗧🇭`, { quoted: msg });
    }

    const wps = loadJson(WP_FILE());
    wps[chat] = preset;
    saveJson(WP_FILE(), wps);

    return sock.sendMessage(chat, {
      image: presetBuffer || { url: preset.url },
      caption: `🖼️ *Chat Wallpaper Preset #${preset.id}*\n\n• *Style:* ${preset.name}\n\nProvided by 𝗪𝗥𝗔𝗜𝗧🇭`
    }, { quoted: msg });
  } catch (e) {
    console.error('[wpCommand] error:', e.message);
    return sendWithCta(sock, chat, `❌ *Wallpaper Error:* ${e.message}\n\nProvided by 𝗪𝗥𝗔𝗜𝗧🇭`, { quoted: msg });
  }
}

// ─────────────────────────────────────────────
// Chat Profile Picture / DP Handler
// ─────────────────────────────────────────────
export async function dpCommand(sock, chat, msg, args = []) {
  try {
    const imageBuffer = await extractQuotedImageBuffer(msg);
    if (!imageBuffer) {
      return sendWithCta(sock, chat, `🖼️ *Usage:* Reply to an image with \`.dp\` to set it as profile photo.\n\nProvided by 𝗪𝗥𝗔𝗜𝗧🇭`, { quoted: msg });
    }

    const targetJid = chat.endsWith('@g.us') ? chat : (sock.user?.id ? sock.user.id.split(':')[0] + '@s.whatsapp.net' : chat);
    await sock.updateProfilePicture(targetJid, imageBuffer);

    return sock.sendMessage(chat, {
      image: imageBuffer,
      caption: `🖼️ *Profile Picture Updated*\n\nSuccessfully updated photo.\n\nProvided by 𝗪𝗥𝗔𝗜𝗧🇭`
    }, { quoted: msg });
  } catch (e) {
    console.error('[dpCommand] error:', e.message);
    return sendWithCta(sock, chat, `❌ *Profile Photo Error:* ${e.message}\n\nProvided by 𝗪𝗥𝗔𝗜𝗧🇭`, { quoted: msg });
  }
}
