// ─────────────────────────────────────────────
// WRAITH · modules/location.js
// Location Request Button & Handler
// ─────────────────────────────────────────────
import { sendInteractive, createLocationRequest, NEWSLETTER_CONTEXT } from '../lib/buttons.js';
import { digitsOf } from '../core/identity.js';

export async function reqlocationCommand(sock, chat, msg) {
  try {
    await sendInteractive(
      sock,
      chat,
      {
        body: '📍 *Location Request*\n\nPlease tap the button below to share your location.',
        footer: 'Provided by 𝕎ℝⒶⒾⓉℍ',
        buttons: [
          createLocationRequest('📍 Share Location')
        ]
      },
      { quoted: msg }
    );
  } catch (e) {
    await sock.sendMessage(chat, { text: `⚠️ reqlocation failed: ${e.message}` }, { quoted: msg }).catch(() => {});
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
      'Provided by 𝕎ℝⒶⒾⓉℍ',
    ].filter(Boolean).join('\n');

    await sock.sendMessage(
      chat,
      {
        text,
        mentions: [sender],
        contextInfo: NEWSLETTER_CONTEXT,
      },
      { quoted: msg }
    );
  } catch (e) {
    console.error('[handleIncomingLocation]', e.message);
  }
}
