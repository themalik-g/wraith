// ─────────────────────────────────────────────
// WRAITH · modules/theme.js
// Chat Themes, Wallpapers, and Chat Bubbles commands
// ─────────────────────────────────────────────
import fs from 'node:fs';
import path from 'node:path';
import { downloadContentFromMessage } from '@whiskeysockets/baileys';
import { sendWithCta } from '../lib/buttons.js';
import { inState } from '../core/paths.js';

const THEME_FILE = () => inState('chat_themes.json');
const WP_FILE = () => inState('chat_wallpapers.json');
const BUBBLE_FILE = () => inState('chat_bubbles.json');

// Preset Theme configurations
export const THEME_PRESETS = [
  { id: 'emerald', name: 'Emerald Green', color: '#005C4B' },
  { id: 'teal', name: 'Deep Teal', color: '#075E54' },
  { id: 'navy', name: 'Navy Blue', color: '#1B263B' },
  { id: 'midnight', name: 'Midnight Dark', color: '#0D1B2A' },
  { id: 'crimson', name: 'Crimson Red', color: '#800020' },
  { id: 'amethyst', name: 'Amethyst Purple', color: '#4A154B' },
  { id: 'sunset', name: 'Sunset Orange', color: '#CC5500' },
  { id: 'forest', name: 'Forest Green', color: '#1E3A2B' },
  { id: 'sakura', name: 'Sakura Pink', color: '#85144B' },
  { id: 'cyberpunk', name: 'Cyberpunk Neon', color: '#00F0FF' },
];

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

// Preset Bubble color configurations
export const BUBBLE_PRESETS = [
  { id: 1, name: 'Classic Emerald', hex: '#005C4B' },
  { id: 2, name: 'Deep Teal', hex: '#075E54' },
  { id: 3, name: 'Bright Teal', hex: '#128C7E' },
  { id: 4, name: 'WhatsApp Light Green', hex: '#25D366' },
  { id: 5, name: 'Sky Blue', hex: '#34B7F1' },
  { id: 6, name: 'Royal Purple', hex: '#6A1B9A' },
  { id: 7, name: 'Crimson Red', hex: '#D32F2F' },
  { id: 8, name: 'Vibrant Orange', hex: '#E65100' },
  { id: 9, name: 'Dark Onyx', hex: '#212121' },
  { id: 10, name: 'Neon Mint', hex: '#00E676' },
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
// Theme Handlers
// ─────────────────────────────────────────────
export async function themeCommand(sock, chat, msg, args = [], indexOverride = null) {
  try {
    const argStr = args.join(' ').toLowerCase().trim();
    const isReset = argStr === 'reset' || indexOverride === 'reset';

    if (isReset) {
      try {
        if (typeof sock.updateChatTheme === 'function') {
          await sock.updateChatTheme(chat, 'default');
        }
      } catch (e) {
        console.error('[themeCommand] updateChatTheme reset failed:', e.message);
      }
      const themes = loadJson(THEME_FILE());
      delete themes[chat];
      saveJson(THEME_FILE(), themes);

      return sendWithCta(sock, chat, `🎨 *Chat Theme Reset*\n\nRestored chat theme to default.\n\nProvided by 𝗪𝗥𝗜𝗧🇭`, { quoted: msg });
    }

    let idx = indexOverride ? parseInt(indexOverride, 10) : parseInt(args[0], 10);
    if (!idx || isNaN(idx) || idx < 1 || idx > THEME_PRESETS.length) {
      let listText = `🎨 *Available Chat Themes*\n\nUsage: \`.theme1\` to \`.theme10\` or \`.resettheme\`\n\n`;
      THEME_PRESETS.forEach((t, i) => {
        listText += `*${i + 1}.* ${t.name} (\`${t.id}\`) — Accent: ${t.color}\n`;
      });
      listText += `\n*Reset Command:* \`.reset theme\` or \`.resettheme\`\n\nProvided by 𝗪𝗥𝗜𝗧🇭`;
      return sendWithCta(sock, chat, listText, { quoted: msg });
    }

    const preset = THEME_PRESETS[idx - 1];
    try {
      if (typeof sock.updateChatTheme === 'function') {
        await sock.updateChatTheme(chat, preset.id);
      }
    } catch (e) {
      console.error('[themeCommand] updateChatTheme failed:', e.message);
    }

    const themes = loadJson(THEME_FILE());
    themes[chat] = preset;
    saveJson(THEME_FILE(), themes);

    const reply = `🎨 *Chat Theme Updated*\n\n• *Theme Preset:* #${idx} (${preset.name})\n• *Theme ID:* \`${preset.id}\`\n• *Accent Color:* \`${preset.color}\`\n\nProvided by 𝗪𝗥𝗜𝗧🇭`;
    return sendWithCta(sock, chat, reply, { quoted: msg });
  } catch (e) {
    console.error('[themeCommand] error:', e.message);
    return sendWithCta(sock, chat, `❌ *Theme Error:* ${e.message}\n\nProvided by 𝗪𝗥𝗜𝗧🇭`, { quoted: msg });
  }
}

// ─────────────────────────────────────────────
// Wallpaper Handlers
// ─────────────────────────────────────────────
export async function wpCommand(sock, chat, msg, args = [], indexOverride = null) {
  try {
    const argStr = args.join(' ').toLowerCase().trim();
    const isReset = argStr === 'reset' || indexOverride === 'reset';

    if (isReset) {
      try {
        if (typeof sock.updateChatWallpaper === 'function') {
          await sock.updateChatWallpaper(chat, { type: 'default' });
        }
      } catch (e) {
        console.error('[wpCommand] updateChatWallpaper reset failed:', e.message);
      }
      const wps = loadJson(WP_FILE());
      delete wps[chat];
      saveJson(WP_FILE(), wps);

      return sendWithCta(sock, chat, `🖼️ *Chat Wallpaper Reset*\n\nRestored chat wallpaper to default.\n\nProvided by 𝗪𝗥𝗜𝗧🇭`, { quoted: msg });
    }

    // Check if replying to an image
    const imageBuffer = await extractQuotedImageBuffer(msg);
    if (imageBuffer) {
      let uploadedUrl = null;
      try {
        if (typeof sock.waUploadToServer === 'function') {
          const uploaded = await sock.waUploadToServer(imageBuffer, { mediaType: 'image' });
          uploadedUrl = uploaded?.url || null;
        }
      } catch (e) {
        console.error('[wpCommand] waUploadToServer failed:', e.message);
      }

      if (uploadedUrl) {
        try {
          if (typeof sock.updateChatWallpaper === 'function') {
            await sock.updateChatWallpaper(chat, { type: 'custom', media: uploadedUrl, opacity: 1 });
          }
        } catch (e) {
          console.error('[wpCommand] updateChatWallpaper custom failed:', e.message);
        }
      }

      const wps = loadJson(WP_FILE());
      wps[chat] = { custom: true, date: Date.now() };
      saveJson(WP_FILE(), wps);

      return sock.sendMessage(chat, {
        image: imageBuffer,
        caption: `🖼️ *Custom Chat Wallpaper Set*\n\nSet replied image as wallpaper for this chat.\n\nProvided by 𝗪𝗥𝗜𝗧🇭`
      }, { quoted: msg });
    }

    let idx = indexOverride ? parseInt(indexOverride, 10) : parseInt(args[0], 10);
    if (!idx || isNaN(idx) || idx < 1 || idx > WALLPAPER_PRESETS.length) {
      let listText = `🖼️ *Available Chat Wallpapers*\n\nUsage: \`.wp1\` to \`.wp10\` or reply to an image with \`.wp\`\n\n`;
      WALLPAPER_PRESETS.forEach((w) => {
        listText += `*${w.id}.* ${w.name}\n`;
      });
      listText += `\n*Photo Reply:* Reply to any image message with \`.wp\` to set it as wallpaper.\n*Reset Command:* \`.reset wp\` or \`.resetwp\`\n\nProvided by 𝗪𝗥𝗜𝗧🇭`;
      return sendWithCta(sock, chat, listText, { quoted: msg });
    }

    const preset = WALLPAPER_PRESETS[idx - 1];
    try {
      if (typeof sock.updateChatWallpaper === 'function') {
        await sock.updateChatWallpaper(chat, { type: 'custom', media: preset.url, opacity: 1 });
      }
    } catch (e) {
      console.error('[wpCommand] updateChatWallpaper preset failed:', e.message);
    }

    const wps = loadJson(WP_FILE());
    wps[chat] = preset;
    saveJson(WP_FILE(), wps);

    return sock.sendMessage(chat, {
      image: { url: preset.url },
      caption: `🖼️ *Chat Wallpaper Preset #${preset.id}*\n\n• *Style:* ${preset.name}\n\nProvided by 𝗪𝗥𝗜𝗧🇭`
    }, { quoted: msg });
  } catch (e) {
    console.error('[wpCommand] error:', e.message);
    return sendWithCta(sock, chat, `❌ *Wallpaper Error:* ${e.message}\n\nProvided by 𝗪𝗥𝗜𝗧🇭`, { quoted: msg });
  }
}

// ─────────────────────────────────────────────
// Chat Profile Picture / DP Handler
// ─────────────────────────────────────────────
export async function dpCommand(sock, chat, msg, args = []) {
  try {
    const imageBuffer = await extractQuotedImageBuffer(msg);
    if (!imageBuffer) {
      return sendWithCta(sock, chat, `🖼️ *Usage:* Reply to an image with \`.dp\` to set it as profile photo.\n\nProvided by 𝗪𝗥𝗜𝗧🇭`, { quoted: msg });
    }

    const targetJid = chat.endsWith('@g.us') ? chat : (sock.user?.id ? sock.user.id.split(':')[0] + '@s.whatsapp.net' : chat);
    await sock.updateProfilePicture(targetJid, imageBuffer);

    return sock.sendMessage(chat, {
      image: imageBuffer,
      caption: `🖼️ *Profile Picture Updated*\n\nSuccessfully updated photo.\n\nProvided by 𝗪𝗥𝗜𝗧🇭`
    }, { quoted: msg });
  } catch (e) {
    console.error('[dpCommand] error:', e.message);
    return sendWithCta(sock, chat, `❌ *Profile Photo Error:* ${e.message}\n\nProvided by 𝗪𝗥𝗜𝗧🇭`, { quoted: msg });
  }
}

// ─────────────────────────────────────────────
// Chat Bubbles Handlers
// ─────────────────────────────────────────────
export async function chatbubbleCommand(sock, chat, msg, args = [], indexOverride = null) {
  try {
    const argStr = args.join(' ').toLowerCase().trim();
    const isReset = argStr === 'reset' || indexOverride === 'reset';

    if (isReset) {
      try {
        if (typeof sock.updateChatBubble === 'function') {
          await sock.updateChatBubble(chat, 'default');
        } else if (typeof sock.updateChatTheme === 'function') {
          await sock.updateChatTheme(chat, 'default');
        }
      } catch (e) {
        console.error('[chatbubbleCommand] reset failed:', e.message);
      }
      const bubbles = loadJson(BUBBLE_FILE());
      delete bubbles[chat];
      saveJson(BUBBLE_FILE(), bubbles);

      return sendWithCta(sock, chat, `💬 *Chat Bubble Style Reset*\n\nRestored chat bubble style to default.\n\nProvided by 𝗪𝗥𝗜𝗧🇭`, { quoted: msg });
    }

    let idx = indexOverride ? parseInt(indexOverride, 10) : parseInt(args[0], 10);
    if (!idx || isNaN(idx) || idx < 1 || idx > BUBBLE_PRESETS.length) {
      let listText = `💬 *Available Chat Bubble Styles*\n\nUsage: \`.chatbubble1\` to \`.chatbubble10\` or \`.resetbubble\`\n\n`;
      BUBBLE_PRESETS.forEach((b) => {
        listText += `*${b.id}.* ${b.name} — Color: \`${b.hex}\`\n`;
      });
      listText += `\n*Reset Command:* \`.resetbubble\` or \`.reset bubble\`\n\nProvided by 𝗪𝗥𝗜𝗧🇭`;
      return sendWithCta(sock, chat, listText, { quoted: msg });
    }

    const preset = BUBBLE_PRESETS[idx - 1];
    try {
      if (typeof sock.updateChatBubble === 'function') {
        await sock.updateChatBubble(chat, preset.hex);
      } else if (typeof sock.updateChatTheme === 'function') {
        await sock.updateChatTheme(chat, preset.hex);
      }
    } catch (e) {
      console.error('[chatbubbleCommand] update failed:', e.message);
    }

    const bubbles = loadJson(BUBBLE_FILE());
    bubbles[chat] = preset;
    saveJson(BUBBLE_FILE(), bubbles);

    const reply = `💬 *Chat Bubble Style Updated*\n\n• *Style Preset:* #${idx} (${preset.name})\n• *Bubble Color:* \`${preset.hex}\`\n\nProvided by 𝗪𝗥𝗜𝗧🇭`;
    return sendWithCta(sock, chat, reply, { quoted: msg });
  } catch (e) {
    console.error('[chatbubbleCommand] error:', e.message);
    return sendWithCta(sock, chat, `❌ *Bubble Error:* ${e.message}\n\nProvided by 𝗪𝗥𝗜𝗧🇭`, { quoted: msg });
  }
}
