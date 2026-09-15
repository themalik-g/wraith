// ─────────────────────────────────────────────
// WRAITH · modules/ai.js
// Phase 2: Auto Chatbot (keyless AI + optional keys)
// ─────────────────────────────────────────────
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isOwner } from '../core/identity.js';
import { readJson, writeJsonAtomic } from '../core/state-io.js';
import { getPrefix } from '../core/settings.js';
import { CONFIG } from '../config.js';
import { getKey } from '../core/keys.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const CHATBOT_FILE = path.join(here, '..', 'state', 'chatbot.json');

function getChatbot() {
    return readJson(CHATBOT_FILE, {
        enabled: false,
        groups: false,
        instructions: CONFIG.chatbot?.instructions || 'You are WRAITH, a helpful WhatsApp assistant.',
        cooldownMs: CONFIG.chatbot?.cooldownMs || 5000,
    });
}
function saveChatbot(data) { writeJsonAtomic(CHATBOT_FILE, data); }

// Small per-chat conversation memory (last 6 turns) so the bot feels alive
const history = new Map();
const HISTORY_MAX = 6;
function pushHistory(chat, role, content) {
    if (!history.has(chat)) history.set(chat, []);
    const h = history.get(chat);
    h.push({ role, content });
    if (h.length > HISTORY_MAX * 2) h.splice(0, h.length - HISTORY_MAX * 2);
    if (history.size > 500) history.delete(history.keys().next().value);
}

async function timedFetch(url, options = {}, timeout = 20000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try { return await fetch(url, { ...options, signal: controller.signal }); }
    finally { clearTimeout(timer); }
}

async function askPollinationsPost(messages) {
    // ★ FIX: anonymous Pollinations calls are heavily throttled WITHOUT a
    //        referrer — that is what made the chatbot silently stop working.
    const body = { model: 'openai', messages, private: true, referrer: 'wraith-bot' };
    const res = await timedFetch('https://text.pollinations.ai/openai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', referrer: 'wraith-bot' },
        body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`pollinations POST ${res.status}`);
    const data = await res.json();
    const reply = data?.choices?.[0]?.message?.content;
    if (!reply || !String(reply).trim()) throw new Error('empty reply');
    return String(reply).trim();
}

async function askPollinationsGet(userMessage, systemPrompt) {
    const prompt = encodeURIComponent(userMessage.slice(0, 1500));
    const system = encodeURIComponent(systemPrompt.slice(0, 500));
    const res = await timedFetch(`https://text.pollinations.ai/${prompt}?model=openai&system=${system}&referrer=wraith-bot`);
    if (!res.ok) throw new Error(`pollinations GET ${res.status}`);
    const text = (await res.text()).trim();
    if (!text || /^\s*<html/i.test(text)) throw new Error('bad reply');
    return text;
}

async function askKeyed(messages) {
    // LAST RESORT only (per your rule): uses keys from keys.env if present
    const openai = getKey('OPENAI_API_KEY');
    if (openai) {
        const res = await timedFetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openai}` },
            body: JSON.stringify({ model: 'gpt-4o-mini', messages, max_tokens: 400 }),
        });
        if (res.ok) {
            const data = await res.json();
            const reply = data?.choices?.[0]?.message?.content;
            if (reply) return { reply: String(reply).trim(), source: 'openai' };
        }
    }
    const router = getKey('OPENROUTER_API_KEY');
    if (router) {
        const res = await timedFetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${router}` },
            body: JSON.stringify({ model: 'openrouter/free', messages, max_tokens: 400 }),
        });
        if (res.ok) {
            const data = await res.json();
            const reply = data?.choices?.[0]?.message?.content;
            if (reply) return { reply: String(reply).trim(), source: 'openrouter' };
        }
    }
    return null;
}

async function askAi(userMessage, systemPrompt, chat) {
    const h = history.get(chat) || [];
    const messages = [
        { role: 'system', content: systemPrompt },
        ...h,
        { role: 'user', content: userMessage },
    ];

    try { return { ok: true, reply: await askPollinationsPost(messages), source: 'pollinations' }; }
    catch (e) { if (process.env.WRAITH_DEBUG === '1') console.log('[chatbot] POST:', e.message); }

    try { return { ok: true, reply: await askPollinationsGet(userMessage, systemPrompt), source: 'pollinations-get' }; }
    catch (e) { if (process.env.WRAITH_DEBUG === '1') console.log('[chatbot] GET:', e.message); }

    const keyed = await askKeyed(messages).catch(() => null);
    if (keyed) return { ok: true, ...keyed };

    return { ok: false };
}

const cooldowns = new Map();
const MAX_COOLDOWN = 500;

export async function maybeAutoReply(sock, chat, msg) {
    try {
        const cfg = getChatbot();
        if (!cfg.enabled) return false;
        if (msg.key.fromMe) return false;

        const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
        if (!text) return false;
        if (text.startsWith(getPrefix())) return false;

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
        if (cooldowns.size > MAX_COOLDOWN) cooldowns.delete(cooldowns.keys().next().value);

        const r = await askAi(text, cfg.instructions || CONFIG.chatbot?.instructions, chat);
        if (r.ok) {
            pushHistory(chat, 'user', text);
            pushHistory(chat, 'assistant', r.reply);
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
                text: `🤖 *chatbot*\n\nstatus · *${cfg.enabled ? 'ON' : 'OFF'}*\ngroups · *${cfg.groups ? 'ON' : 'OFF'}*\n`.concat(
                    '`.chatbot on` — enable\n`.chatbot off` — disable\n`.chatbot groups on|off`\n`.chatbot set <instructions>`'
                ),
            }, { quoted: msg });
        }
        if (a0 === 'on') { cfg.enabled = true; saveChatbot(cfg); return sock.sendMessage(chat, { text: '🤖 Chatbot *enabled*.' }, { quoted: msg }); }
        if (a0 === 'off') { cfg.enabled = false; saveChatbot(cfg); return sock.sendMessage(chat, { text: '🤖 Chatbot *disabled*.' }, { quoted: msg }); }
        if (a0 === 'groups') {
            const a1 = (args?.[1] || '').toLowerCase();
            if (a1 !== 'on' && a1 !== 'off') return sock.sendMessage(chat, { text: '❌ Use `.chatbot groups on` or `.chatbot groups off`.' }, { quoted: msg });
            cfg.groups = a1 === 'on'; saveChatbot(cfg);
            return sock.sendMessage(chat, { text: cfg.groups ? '🤖 Group replies *enabled* (only when @mentioned).' : '🤖 Group replies *disabled*.' }, { quoted: msg });
        }
        if (a0 === 'set') {
            const instructions = args.slice(1).join(' ').trim();
            if (!instructions) return sock.sendMessage(chat, { text: '❌ Provide instructions.' }, { quoted: msg });
            cfg.instructions = instructions; saveChatbot(cfg);
            return sock.sendMessage(chat, { text: `🤖 Instructions updated.` }, { quoted: msg });
        }
        await sock.sendMessage(chat, { text: '❌ Use `.chatbot on|off|groups on|off|set <instructions>`' }, { quoted: msg });
    } catch (e) {
        await sock.sendMessage(chat, { text: `⚠️ chatbot failed: ${e.message}` }, { quoted: msg }).catch(() => {});
    }
}
