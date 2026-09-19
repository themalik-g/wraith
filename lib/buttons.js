// ─────────────────────────────────────────────
// WRAITH · lib/buttons.js
// Interactive Baileys Buttons & Native Flow Helper
// ─────────────────────────────────────────────
import { generateWAMessageFromContent } from '@whiskeysockets/baileys';
import gifted from 'gifted-btns';
import { getReplyMode } from '../core/settings.js';

export const NEWSLETTER_JID = '120363409689492071@newsletter';
export const NEWSLETTER_CONTEXT = {
  newsletterJid: NEWSLETTER_JID,
  newsletterName: '𝕎ℝⒶⒾⓉℍ',
  serverMessageId: 100,
};

/**
 * Helper constructors for all Baileys native flow interactive button types
 */
export function createQuickReply(displayText, id) {
  return {
    name: 'quick_reply',
    buttonParamsJson: JSON.stringify({
      display_text: displayText,
      id: id,
    }),
  };
}

export function createCtaUrl(displayText, url, merchantUrl) {
  return {
    name: 'cta_url',
    buttonParamsJson: JSON.stringify({
      display_text: displayText,
      url: url,
      merchant_url: merchantUrl || url,
    }),
  };
}

export function createCtaCopy(displayText, copyCode) {
  return {
    name: 'cta_copy',
    buttonParamsJson: JSON.stringify({
      display_text: displayText,
      copy_code: copyCode,
    }),
  };
}

export function createCtaCall(displayText, phoneNumber) {
  return {
    name: 'cta_call',
    buttonParamsJson: JSON.stringify({
      display_text: displayText,
      phone_number: phoneNumber,
    }),
  };
}

export function createCtaCatalog(businessPhoneNumber) {
  return {
    name: 'cta_catalog',
    buttonParamsJson: JSON.stringify({
      business_phone_number: businessPhoneNumber,
    }),
  };
}

export function createSingleSelect(title, sections) {
  return {
    name: 'single_select',
    buttonParamsJson: JSON.stringify({
      title: title,
      sections: sections,
    }),
  };
}

export function createOpenWebview(title, link) {
  return {
    name: 'open_webview',
    buttonParamsJson: JSON.stringify({
      title: title,
      link: link,
    }),
  };
}

export function createLocationRequest(displayText = 'Share Location') {
  return {
    name: 'send_location',
    buttonParamsJson: JSON.stringify({
      display_text: displayText,
    }),
  };
}

export function createAddressRequest(displayText = 'Share Address') {
  return {
    name: 'address_message',
    buttonParamsJson: JSON.stringify({
      display_text: displayText,
    }),
  };
}

export function createReminder(displayText = 'Remind Me') {
  return {
    name: 'cta_reminder',
    buttonParamsJson: JSON.stringify({
      display_text: displayText,
    }),
  };
}

/**
 * Extract button response ID or list row ID from incoming Baileys WAMessage
 */
export function extractInteractiveResponse(msg) {
  if (!msg?.message) return null;
  const m = msg.message;

  // 1. Quick Reply / Legacy buttonsResponseMessage
  if (m.buttonsResponseMessage?.selectedButtonId) {
    return m.buttonsResponseMessage.selectedButtonId;
  }

  // 2. Modern Interactive / Native Flow Response
  if (m.interactiveResponseMessage) {
    const flowReply = m.interactiveResponseMessage.nativeFlowResponseMessage;
    if (flowReply) {
      try {
        const params = JSON.parse(flowReply.paramsJson || '{}');
        if (params.id) return params.id;
        if (params.row_id) return params.row_id;
      } catch {}
      if (flowReply.name) return flowReply.name;
    }
  }

  // 3. Single Select List Response
  if (m.listResponseMessage?.singleSelectReply?.selectedRowId) {
    return m.listResponseMessage.singleSelectReply.selectedRowId;
  }

  // 4. Template Button Reply Response
  if (m.templateButtonReplyMessage?.selectedId) {
    return m.templateButtonReplyMessage.selectedId;
  }

  return null;
}

export function createGalaxyFlow(mode, flowId, flowToken, flowCta, flowAction, flowActionPayload) {
  return {
    name: 'galaxy_message',
    buttonParamsJson: JSON.stringify({
      mode: mode || 'navigate',
      flow_id: flowId,
      flow_token: flowToken,
      flow_cta: flowCta,
      flow_action: flowAction || 'navigate',
      flow_action_payload: flowActionPayload || { screen: 'QUESTION_ONE', params: {} },
    }),
  };
}

/**
 * Normalize input buttons array into Baileys button objects
 */
function normalizeButtons(buttons) {
  if (!Array.isArray(buttons)) return [];
  return buttons.map((b) => {
    if (b && typeof b === 'object' && b.name && b.buttonParamsJson) {
      return b;
    }
    if (b && typeof b === 'object' && b.type) {
      switch (b.type) {
        case 'quick_reply': return createQuickReply(b.text || b.display_text, b.id);
        case 'url': return createCtaUrl(b.text || b.display_text, b.url);
        case 'copy': return createCtaCopy(b.text || b.display_text, b.code || b.copy_code);
        case 'call': return createCtaCall(b.text || b.display_text, b.phone || b.phone_number);
        case 'select': return createSingleSelect(b.title, b.sections);
        default: break;
      }
    }
    return b;
  });
}

/**
 * Send interactive message with automatic fallback
 *
 * @param {Object} sock - Baileys socket object
 * @param {string} jid - Destination JID
 * @param {Object} options - Message parameters ({ body, footer, header, buttons })
 * @param {Object} [opts] - Extra send options e.g. { quoted: msg }
 */
export async function sendInteractive(sock, jid, options = {}, opts = {}) {
  const { body = '', footer = '', header = '', buttons = [] } = options;
  const mode = getReplyMode();

  // If text mode is forced by user setting (.replymode text), skip interactive buttons
  if (mode === 'text') {
    return sendFallbackText(sock, jid, options, opts);
  }

  const normalizedButtons = normalizeButtons(buttons);

  // 1. Native Baileys relay Message (v7.0.0-rc14)
  try {
    const waMsg = generateWAMessageFromContent(
      jid,
      {
        viewOnceMessage: {
          message: {
            messageContextInfo: {
              deviceListMetadata: {},
              deviceListMetadataVersion: 2,
            },
            interactiveMessage: {
              body: { text: body },
              footer: footer ? { text: footer } : undefined,
              header: header ? { title: header, hasMediaAttachment: false } : undefined,
              contextInfo: NEWSLETTER_CONTEXT,
              nativeFlowMessage: {
                buttons: normalizedButtons,
              },
            },
          },
        },
      },
      { quoted: opts.quoted }
    );

    if (sock.relayMessage) {
      await sock.relayMessage(jid, waMsg.message, { messageId: waMsg.key.id });
      return;
    } else {
      await sock.sendMessage(jid, waMsg.message, { quoted: opts.quoted });
      return;
    }
  } catch (e) {
    try {
      console.warn('[sendInteractive] native relay failed, trying gifted-btns:', e?.message || e);
    } catch {}
  }

  // 2. Try gifted-btns wrapper as secondary option
  try {
    if (gifted && typeof gifted.sendButtons === 'function') {
      const giftedPayload = {
        text: body,
        body: body,
        footer: footer,
        header: header,
        buttons: normalizedButtons,
        contextInfo: NEWSLETTER_CONTEXT,
      };
      await gifted.sendButtons(sock, jid, giftedPayload, opts);
      return;
    }
  } catch (e) {
    try {
      console.warn('[sendInteractive] gifted-btns failed:', e?.message || e);
    } catch {}
  }

  // 3. Fallback to standard text message if interactive sending fails
  return sendFallbackText(sock, jid, options, opts);
}

/**
 * Fallback plain text renderer when replymode is text or interactive relay fails
 */

function sendFallbackText(sock, jid, options, opts) {
  const { body = '', footer = '', buttons = [] } = options;
  let fullText = body;

  const normalized = normalizeButtons(buttons);
  if (normalized.length > 0) {
    const buttonTexts = [];
    for (const b of normalized) {
      try {
        const params = JSON.parse(b.buttonParamsJson || '{}');
        if (params.display_text) {
          const cmdHint = params.id ? ` (Command: ${params.id})` : '';
          buttonTexts.push(`👉 *${params.display_text}*${cmdHint}`);
        } else if (params.title) {
          buttonTexts.push(`📋 *${params.title}*`);
          if (Array.isArray(params.sections)) {
            for (const sec of params.sections) {
              if (sec.title) buttonTexts.push(`  ── ${sec.title} ──`);
              if (Array.isArray(sec.rows)) {
                for (const row of sec.rows) {
                  buttonTexts.push(`  • ${row.title}${row.id ? ` [${row.id}]` : ''}${row.description ? ` - ${row.description}` : ''}`);
                }
              }
            }
          }
        }
      } catch {}
    }
    if (buttonTexts.length > 0) {
      fullText += '\n\n' + buttonTexts.join('\n');
    }
  }

  if (footer) fullText += `\n\n_${footer}_`;

  return sock.sendMessage(
    jid,
    {
      text: fullText,
      contextInfo: NEWSLETTER_CONTEXT,
    },
    { quoted: opts.quoted }
  );
}
