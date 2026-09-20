// modules/location.js — location request + handler
import { sendInteractive, createLocationRequest, NEWSLETTER_CONTEXT } from '../lib/buttons.js';
import { digitsOf } from '../core/identity.js';

export async function reqlocationCommand(sock, chat, msg) {
  try {
    // sendInteractive auto-registers a numbered fallback, so this works
    // even when the send_location button doesn't render (or on own number)
    await sendInteractive(
      sock,
      chat,
      {
        body: '📍 *Location Request*\n\nShare your location using the button, or just send your location manually (attachment → location).',
        footer: 'Provided by 𝗪𝗥𝗜𝗧🇭',
        buttons: [createLocationRequest('📍 Share Location')],
      },
      { quoted: msg, sender: msg.key.participant || msg.key.remoteJid }
    );
  } catch (e) {
    await sock.sendMessage(chat, {
      text: `⚠️ reqlocation failed: ${e.message}`,
      contextInfo: NEWSLETTER_CONTEXT,
    }, { quoted: msg }).catch(() => {});
  }
}

export async function handleIncomingLocation(sock, chat, msg) {
  try {
    const loc = msg.message?.locationMessage || msg.message?.liveLocationMessage;
    if (!loc) return;
    const sender = msg.key.participant || msg.key.remoteJid;
    const lat = loc.degreesLatitude;
    const lng = loc.degreesLongitude;
    const name = loc.name || loc.address || 'Shared Location';
    const text = [
      '📍 *Location Received*',
      '',
      `• *From:* @${digitsOf(sender)}`,
      `• *Latitude:* \`${lat}\``,
      `• *Longitude:* \`${lng}\``,
      name !== 'Shared Location' ? `• *Label:* ${name}` : '',
      `• *Google Maps:* https://maps.google.com/?q=${lat},${lng}`,
      '',
      'Provided by 𝗪𝗥𝗜𝗧🇭',
    ].filter(Boolean).join('\n');

    await sock.sendMessage(
      chat,
      { text, mentions: [sender], contextInfo: NEWSLETTER_CONTEXT },
      { quoted: msg }
    );
  } catch (e) {
    console.error('[handleIncomingLocation]', e.message);
  }
}
