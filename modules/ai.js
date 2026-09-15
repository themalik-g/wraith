// ─────────────────────────────────────────────
// WRAITH · modules/ai.js
// Phase 2: Auto Chatbot (keyless AI)
// ─────────────────────────────────────────────
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isOwner } from '../core/identity.js';
import { readJson, writeJsonAtomic } from '../core/state-io.js';
import { getPrefix } from '../core/settings.js';
import { CONFIG } from '../config.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const CHATBOT_FILE = path.join(here, '..', 'state', 'chatbot.json');

function getChatbot() {
  return readJson(CHATBOT_FILE, {
    enabled: false,
    groups: false, // ★ default: DMs only — prevents group spam
    instructions: CONFIG.chatbot?.instructions || 'You are WRAITH, a helpful WhatsApp assistant.',
    cooldownMs: CONFIG.chatbot?.cooldownMs || 5000,
  });
}
function saveChatbot(data) { writeJsonAtomic(CHATBOT_FILE, data); }

// Keyless / free AI endpoints, most reliable first.
const AI_ENDPOINTS = [
  {
    name: 'Pollinations',
    // Free, keyless, OpenAI-compatible. Works from datacenter IPs.
    url: 'https://text.pollinations.ai/openai',
    build: (messages) => ({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'openai', messages, private: true }),
    }),
    parse: (d) => d?.choices?.[0]?.message?.content,
  },
  {
    name: 'Pollinations-GET',
    // Simplest possible fallback: plain-text GET.
    url: null, // built dynamically in askAi
    build: null,
    parse: null,
  },
  {
    name: 'KeylessAI',
    url: 'https://keylessai.th3hacker.workers.dev/v1/chat/completions',
    build: (messages) => ({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-3.5-turbo', messages, temperature: 0.7, max_tokens: 500 }),
    }),
    parse: (d) => d?.choices?.[0]?.message?.content,
  },
];

async function askAi(userMessage, systemPrompt) {
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ];
  // 1) OpenAI-style POST endpoints
  for (const ep of AI_ENDPOINTS) {
    if (!ep.url || !ep.build) continue;
    try {
      const res = await fetch(ep.url, ep.build(messages));
      if (!res.ok) continue;
      const data = await res.json();
      const reply = ep.parse(data);
      if (reply && String(reply).trim().length > 0) return { ok: true, reply: String(reply).trim(), source: ep.name };
    } catch {}
  }
  // 2) Plain-text GET fallback
  try {
    const prompt = encodeURIComponent(userMessage);
    const system = encodeURIComponent(systemPrompt);
    const res = await fetch(`https://text.pollinations.ai/${prompt}?system=${system}&model=openai`);
    if (res.ok) {
      const text = (await res.text()).trim();
      if (text && text.length > 0 && !/^\s*<html/i.test(text)) return { ok: true, reply: text, source: 'Pollinations-GET' };
    }
  } catch {}
  return { ok: false };
}

// Cooldown map (per JID)
const cooldowns = new Map();
const MAX_COOLDOWN = 500;

export async function maybeAutoReply(sock, chat, msg) {
  try {
    const cfg = getChatbot();
    if (!cfg.enabled) return false;
    if (msg.key.fromMe) return false;

    const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
    if (!text) return false;
    // ★ respect the configured prefix, not just '.' / '!'
    if (text.startsWith(getPrefix())) return false;

    // ★ group guard: only reply in groups when explicitly enabled,
    //   and only when the bot is @mentioned there
    if (chat.endsWith('@g.us')) {
      if (!cfg.groups) return false;
      const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
      const me = (sock.user?.id || '').split(':')[0];
      if (!mentioned.some((j) => j.replace(/\D/g, '').includes(me.replace(/\D/g, '')))) return false;
    }

    const from = msg.key.participant || msg.key.remoteJid;
    const now = Date.now();
    const last = cooldowns.get(from);
    if (last && now - last < (cfg.cooldownMs || 5000)) return false;
    cooldowns.set(from, now);
    if (cooldowns.size > MAX_COOLDOWN) {
      cooldowns.delete(cooldowns.keys().next().value);
    }

    const r = await askAi(text, cfg.instructions || CONFIG.chatbot?.instructions);
    if (r.ok) {
      await sock.sendMessage(chat, { text: r.reply }, { quoted: msg });
      return true;
    }
    return false;
  } catch (e) {
    if (process.env.WRAITH_DEBUG === '1') console.log('[chatbot]', e.message);
    return false;
  }
}

// ── .chatbot ────────────────────────────────────────────────────────────────
export async function chatbotCommand(sock, chat, msg, args) {
  try {
    const from = msg.key.participant || msg.key.remoteJid;
    if (!msg.key.fromMe && !isOwner(from)) {
      return sock.sendMessage(chat, { text: '⛔ Owner only.' }, { quoted: msg });
    }
    const cfg = getChatbot();
    const a0 = (args?.[0] || '').toLowerCase();

    if (!a0) {
      return sock.sendMessage(chat, {
        text: `🤖 *chatbot*\n\nstatus · *${cfg.enabled ? 'ON' : 'OFF'}*\ngroups · *${cfg.groups ? 'ON' : 'OFF'}*\ninstructions · _${cfg.instructions.slice(0, 200)}${cfg.instructions.length > 200 ? '…' : ''}_\n\n`.concat(
          '`.chatbot on` — enable\n`.chatbot off` — disable\n`.chatbot groups on|off` — reply in groups (only when @mentioned)\n`.chatbot set <instructions>` — set custom instructions'
        ),
      }, { quoted: msg });
    }

    if (a0 === 'on') {
      cfg.enabled = true;
      saveChatbot(cfg);
      return sock.sendMessage(chat, { text: '🤖 Chatbot *enabled*. It will auto-reply to DMs.' }, { quoted: msg });
    }
    if (a0 === 'off') {
      cfg.enabled = false;
      saveChatbot(cfg);
      return sock.sendMessage(chat, { text: '🤖 Chatbot *disabled*.' }, { quoted: msg });
    }
    if (a0 === 'groups') {
      const a1 = (args?.[1] || '').toLowerCase();
      if (a1 !== 'on' && a1 !== 'off') {
        return sock.sendMessage(chat, { text: '❌ Use `.chatbot groups on` or `.chatbot groups off`.' }, { quoted: msg });
      }
      cfg.groups = a1 === 'on';
      saveChatbot(cfg);
      return sock.sendMessage(chat, {
        text: cfg.groups
          ? '🤖 Group replies *enabled* — the bot will reply only when @mentioned in groups.'
          : '🤖 Group replies *disabled* — bot auto-replies in DMs only.',
      }, { quoted: msg });
    }
    if (a0 === 'set') {
      const instructions = args.slice(1).join(' ').trim();
      if (!instructions) return sock.sendMessage(chat, { text: '❌ Provide instructions.' }, { quoted: msg });
      cfg.instructions = instructions;
      saveChatbot(cfg);
      return sock.sendMessage(chat, { text: `🤖 Instructions updated.\n\n_${instructions}_` }, { quoted: msg });
    }
    await sock.sendMessage(chat, { text: '❌ Use `.chatbot on|off|groups on|off|set <instructions>`' }, { quoted: msg });
  } catch (e) {
    await sock.sendMessage(chat, { text: `⚠️ chatbot failed: ${e.message}` }, { quoted: msg }).catch(() => {});
  }
}
