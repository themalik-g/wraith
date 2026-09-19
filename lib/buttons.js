// lib/buttons.js — interactive buttons + short-reply fallback engine
import { generateWAMessageFromContent } from '@whiskeysockets/baileys';
import qadeerBtns from '@qadeerxtech/qadeer-btns';
import gifted from 'gifted-btns';
import { getReplyMode } from '../core/settings.js';

export const NEWSLETTER_JID = '120363409689492071@newsletter';
export const NEWSLETTER_CONTEXT = {
  newsletterJid: NEWSLETTER_JID,
  newsletterName: '𝕎ℝⒶⒾⓉℍ',
  serverMessageId: 100,
};

// ─────────────────────────────────────────────────────────────
// ★ PENDING-CHOICE REGISTRY — lets users answer menus with
//   plain short replies: "1", "2", "3", "on", "off", etc.
//   (works when buttons don't render, expire after one tap,
//    and work from the bot's own number chat)
// ─────────────────────────────────────────────────────────────
const pendingChoices = new Map(); // chatJid → { sender, exp, choices:[{num,id,keywords[]}] }
const PENDING_TTL_MS = 2 * 60 * 1000;

function keywordsFrom(id = '', display = '') {
  const words = new Set();
  for (const src of [id, display]) {
    for (const w of String(src).toLowerCase().split(/[^a-z0-9]+/)) {
      if (w && w.length >= 2 && w.length <= 12) words.add(w);
    }
  }
  // strip verbs that make keywords collide
  for (const stop of ['ghost', 'peek', 'lurk', 'auto', 'cmd', 'command', 'btn', 'button']) words.delete(stop);
  return [...words];
}

export function registerChoices(chatJid, senderJid, buttons = []) {
  const choices = [];
  let num = 1;
  for (const b of buttons || []) {
    try {
      const params = JSON.parse(b?.buttonParamsJson || '{}');
      if (!params.display_text) continue; // only quick-reply style buttons
      choices.push({
        num: String(num++),
        id: params.id || params.display_text,
        keywords: keywordsFrom(params.id, params.display_text),
      });
    } catch {}
  }
  if (!choices.length) return;
  pendingChoices.set(chatJid, { sender: senderJid, exp: Date.now() + PENDING_TTL_MS, choices });
}

export function clearChoices(chatJid) {
  pendingChoices.delete(chatJid);
}

/**
 * Match a short plain-text reply against the pending menu of a chat.
 * Returns the button id (e.g. "ghost on") or null.
 */
export function matchChoice(chatJid, senderJid, text = '') {
  const rec = pendingChoices.get(chatJid);
  if (!rec) return null;
  if (Date.now() > rec.exp) { pendingChoices.delete(chatJid); return null; }
  // fromMe messages and the user who opened the menu may answer
  const t = String(text).trim().toLowerCase();
  if (!t || t.length > 24) return null;
  let hit = null;
  if (/^\d{1,2}$/.test(t)) {
    hit = rec.choices.find(c => c.num === t);
  }
  if (!hit) {
    hit = rec.choices.find(c => c.keywords.length && c.keywords.some(k => t === k));
  }
  if (!hit) return null;
  pendingChoices.delete(chatJid); // one-shot, like a real button tap
  return hit.id;
}

// ── button constructors ──
export function createQuickReply(displayText, id) {
  return {
    name: 'quick_reply',
    buttonParamsJson: JSON.stringify({ display_text: displayText, id }),
  };
}

export function createCtaUrl(displayText, url, merchantUrl) {
  return {
    name: 'cta_url',
    buttonParamsJson: JSON.stringify({ display_text: displayText, url, merchant_url: merchantUrl || url }),
  };
}

export function createCtaCopy(displayText, copyCode) {
  return {
    name: 'cta_copy',
    buttonParamsJson: JSON.stringify({ display_text: displayText, copy_code: copyCode }),
  };
}

export function createCtaCall(displayText, phoneNumber) {
  return {
    name: 'cta_call',
    buttonParamsJson: JSON.stringify({ display_text: displayText, phone_number: phoneNumber }),
  };
}

export function createCtaCatalog(businessPhoneNumber) {
  return {
    name: 'cta_catalog',
    buttonParamsJson: JSON.stringify({ business_phone_number: businessPhoneNumber }),
  };
}

export function createSingleSelect(title, sections) {
  return {
    name: 'single_select',
    buttonParamsJson: JSON.stringify({ title, sections }),
  };
}

export function createOpenWebview(title, link) {
  return {
    name: 'open_webview',
    buttonParamsJson: JSON.stringify({ title, link }),
  };
}

export function createLocationRequest(displayText = 'Share Location') {
  return {
    name: 'send_location',
    buttonParamsJson: JSON.stringify({ display_text: displayText }),
  };
}

export function createAddressRequest(displayText = 'Share Address') {
  return {
    name: 'address_message',
    buttonParamsJson: JSON.stringify({ display_text: displayText }),
  };
}

export function createReminder(displayText = 'Remind Me') {
  return {
    name: 'cta_reminder',
    buttonParamsJson: JSON.stringify({ display_text: displayText }),
  };
}

export function extractInteractiveResponse(msg) {
  if (!msg?.message) return null;
  const m = msg.message;
  if (m.buttonsResponseMessage?.selectedButtonId) {
    return m.buttonsResponseMessage.selectedButtonId;
  }
  if (m.interactiveResponseMessage) {
    const flowReply = m.interactiveResponseMessage.nativeFlowResponseMessage;
    if (flowReply) {
      try {
        const params = JSON.parse(flowReply.paramsJson || '{}');
        if (params.id) return params.id;
      } catch {}
    }
    const btnReply = m.interactiveResponseMessage.buttonsResponseMessage;
    if (btnReply?.selectedButtonId) return btnReply.selectedButtonId;
  }
  const inner = m.viewOnceMessage?.message?.interactiveResponseMessage
    || m.ephemeralMessage?.message?.interactiveResponseMessage
    || m.documentWithCaptionMessage?.message?.interactiveResponseMessage;
  if (inner?.nativeFlowResponseMessage) {
    try {
      const params = JSON.parse(inner.nativeFlowResponseMessage.paramsJson || '{}');
      if (params.id) return params.id;
    } catch {}
  }
  if (m.listResponseMessage?.singleSelectReply?.selectedRowId) {
    return m.listResponseMessage.singleSelectReply.selectedRowId;
  }
  return null;
}

function normalizeButtons(buttons = []) {
  return (buttons || []).map(b => {
    if (typeof b === 'object' && b?.buttonParamsJson) return b;
    if (b?.quickReply) {
      return createQuickReply(b.quickReply.displayText, b.quickReply.id);
    }
    return b;
  }).filter(Boolean);
}

export async function sendInteractive(sock, jid, options = {}, opts = {}) {
  const { body = '', footer = '', header = '', buttons = [], image, video, document } = options;
  const normalizedButtons = normalizeButtons(buttons);
  const senderOf = opts.quoted?.key?.participant || opts.quoted?.key?.remoteJid
    || opts.sender || jid;
  registerChoices(jid, senderOf, normalizedButtons);

  if (getReplyMode() === 'text') {
    return sendFallbackText(sock, jid, { body, footer, buttons: normalizedButtons }, opts);
  }

  // 1. qadeer-btns
  try {
    if (qadeerBtns && typeof qadeerBtns.sendInteractiveMessage === 'function') {
      const qadeerContent = {
        text: body,
        body,
        footer,
        header,
        buttons: normalizedButtons,
        contextInfo: NEWSLETTER_CONTEXT,
        aimode: true,
      };
      if (image) qadeerContent.image = image;
      if (video) qadeerContent.video = video;
      if (document) qadeerContent.document = document;
      await qadeerBtns.sendInteractiveMessage(sock, jid, qadeerContent, { quoted: opts.quoted });
      return;
    }
  } catch (e) {
    try { console.warn('[sendInteractive] qadeer-btns failed, native relay fallback:', e?.message || e); } catch {}
  }

  // 2. native relay with additionalNodes
  try {
    const isGroup = jid.endsWith('@g.us');
    const additionalNodes = [
      {
        tag: 'biz',
        attrs: {},
        content: [
          {
            tag: 'interactive',
            attrs: { type: 'native_flow', v: '1' },
            content: [{ tag: 'native_flow', attrs: { name: 'mixed', v: '9' } }],
          },
        ],
      },
    ];
    if (!isGroup) additionalNodes.push({ tag: 'bot', attrs: { biz_bot: '1' } });

    const waMsg = generateWAMessageFromContent(
      jid,
      {
        viewOnceMessage: {
          message: {
            messageContextInfo: { deviceListMetadata: {}, deviceListMetadataVersion: 2 },
            interactiveMessage: {
              body: { text: body },
              footer: footer ? { text: footer } : undefined,
              header: header ? { title: header, hasMediaAttachment: false } : undefined,
              contextInfo: NEWSLETTER_CONTEXT,
              nativeFlowMessage: { buttons: normalizedButtons },
            },
          },
        },
      },
      { quoted: opts.quoted }
    );

    if (sock.relayMessage) {
      await sock.relayMessage(jid, waMsg.message, { messageId: waMsg.key.id, additionalNodes });
      return;
    }

    await sock.sendMessage(jid, waMsg.message, { quoted: opts.quoted });
    return;
  } catch (e) {
    try { console.warn('[sendInteractive] native relay failed, gifted-btns fallback:', e?.message || e); } catch {}
  }

  // 3. gifted-btns
  try {
    if (gifted && typeof gifted.sendButtons === 'function') {
      await gifted.sendButtons(sock, jid, {
        text: body, body, footer, header,
        buttons: normalizedButtons,
        contextInfo: NEWSLETTER_CONTEXT,
      }, opts);
      return;
    }
  } catch (e) {
    try { console.warn('[sendInteractive] gifted-btns failed:', e?.message || e); } catch {}
  }

  // 4. numbered text fallback — ALWAYS lands, works on every client + own number
  return sendFallbackText(sock, jid, { body, footer, buttons: normalizedButtons }, opts);
}

function sendFallbackText(sock, jid, options, opts) {
  const { body = '', footer = '', buttons = [] } = options;
  const normalized = normalizeButtons(buttons);
  let fullText = body;

  if (normalized.length > 0) {
    const lines = [];
    let num = 1;
    for (const b of normalized) {
      try {
        const params = JSON.parse(b.buttonParamsJson || '{}');
        if (params.display_text) {
          lines.push(`${num}. ${params.display_text}`);
          num++;
        } else if (params.title) {
          lines.push(`📋 *${params.title}*`);
          if (Array.isArray(params.sections)) {
            for (const sec of params.sections) {
              if (sec.title) lines.push(`  ── ${sec.title} ──`);
              if (Array.isArray(sec.rows)) {
                for (const row of sec.rows) {
                  lines.push(`  ${num}. ${row.title}${row.description ? ` — ${row.description}` : ''}`);
                  num++;
                }
              }
            }
          }
        }
      } catch {}
    }
    if (lines.length > 0) {
      fullText += '\n\n' + lines.join('\n')
        + '\n\n_Reply with the number or option name._';
    }
  }

  if (footer) fullText += `\n\n_${footer}_`;

  return sock.sendMessage(
    jid,
    { text: fullText, contextInfo: NEWSLETTER_CONTEXT },
    { quoted: opts.quoted }
  );
}
