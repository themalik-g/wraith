// ─────────────────────────────────────────────
// WRAITH · modules/ai.js
// Phase 2: Auto Chatbot (keyless AI)
// ─────────────────────────────────────────────
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isOwner } from '../core/identity.js';
import { readJson, writeJsonAtomic } from '../core/state-io.js';
import { CONFIG } from '../config.js';
import { chunkText } from '../lib/net.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const CHATBOT_FILE = path.join(here, '..', 'state', 'chatbot.json');

function getChatbot() {
  return readJson(CHATBOT_FILE, {
    enabled: false,
    instructions: CONFIG.chatbot?.instructions || 'You are WRAITH, a helpful WhatsApp assistant.',
    cooldownMs: CONFIG.chatbot?.cooldownMs || 5000,
  });
}
function saveChatbot(data) { writeJsonAtomic(CHATBOT_FILE, data); }

// Keyless AI endpoints (no API key, no signup)
const AI_ENDPOINTS = [
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
  {
    name: 'Free-GPT4-Web',
    url: 'https://free-gpt4-web-api.vercel.app/api/chat',
    build: (messages) => ({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages }),
    }),
    parse: (d) => d?.response || d?.content || d?.message,
  },
];

async function askAi(userMessage, systemPrompt) {
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ];
  for (const ep of AI_ENDPOINTS) {
    try {
      const res = await fetch(ep.url, ep.build(messages));
      if (!res.ok) continue;
      const data = await res.json();
      const reply = ep.parse(data);
      if (reply && reply.length > 0) return { ok: true, reply, source: ep.name };
    } catch {}
  }
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
    if (!text || text.startsWith('.') || text.startsWith('!')) return false;

    const from = msg.key.participant || msg.key.remoteJid;
    const now = Date.now();
    const last = cooldowns.get(from);
    if (last && now - last < cfg.cooldownMs) return false;
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
        text: `🤖 *chatbot*\n\nstatus · *${cfg.enabled ? 'ON' : 'OFF'}*\ninstructions · _${cfg.instructions.slice(0, 200)}…_\n\n`.concat(
          '`.chatbot on` — enable\n`.chatbot off` — disable\n`.chatbot set <instructions>` — set custom instructions'
        ),
      }, { quoted: msg });
    }

    if (a0 === 'on') {
      cfg.enabled = true;
      saveChatbot(cfg);
      return sock.sendMessage(chat, { text: '🤖 Chatbot *enabled*. It will auto-reply to non-command messages.' }, { quoted: msg });
    }
    if (a0 === 'off') {
      cfg.enabled = false;
      saveChatbot(cfg);
      return sock.sendMessage(chat, { text: '🤖 Chatbot *disabled*.' }, { quoted: msg });
    }
    if (a0 === 'set') {
      const instructions = args.slice(1).join(' ').trim();
      if (!instructions) return sock.sendMessage(chat, { text: '❌ Provide instructions.' }, { quoted: msg });
      cfg.instructions = instructions;
      saveChatbot(cfg);
      return sock.sendMessage(chat, { text: `🤖 Instructions updated.\n\n_${instructions}_` }, { quoted: msg });
    }
    await sock.sendMessage(chat, { text: '❌ Use `.chatbot on|off|set <instructions>`' }, { quoted: msg });
  } catch (e) {
    await sock.sendMessage(chat, { text: `⚠️ chatbot failed: ${e.message}` }, { quoted: msg }).catch(() => {});
  }
}
