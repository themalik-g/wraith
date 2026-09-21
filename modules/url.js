// ─────────────────────────────────────────────
// WRAITH · modules/url.js
// .url — reply to an image (or send image with .url caption)
//        → bot uploads it → replies with a public URL.
// ─────────────────────────────────────────────
import { downloadContentFromMessage } from '@whiskeysockets/baileys';
import { isOwner } from '../core/identity.js';
import { uploadImage } from '../lib/uploadImage.js';

export async function urlCommand(sock, chat, msg, args) {
    const from = msg.key.participant || msg.key.remoteJid;

    if (!msg.key.fromMe && !isOwner(from)) {
        return sock.sendMessage(chat, { text: '⛔ Owner only.' }, { quoted: msg });
    }

    try {
        const ctx = msg.message?.extendedTextMessage?.contextInfo;
        const quoted = ctx?.quotedMessage;

        // image can come from: replied-to message OR direct image with `.url` as caption
        const imgNode = quoted?.imageMessage || msg.message?.imageMessage;

        if (!imgNode) {
            return sock.sendMessage(chat, {
                text:
                    '🔗 *url*\n\n' +
                    'Reply to an image with `.url` to get a public URL,\n' +
                    'or send an image with `.url` as its caption.'
            }, { quoted: msg });
        }

        await sock.sendMessage(chat, { text: '🔗 Uploading image…' }, { quoted: msg });

        const stream = await downloadContentFromMessage(imgNode, 'image');
        const chunks = [];
        for await (const c of stream) chunks.push(c);
        const buffer = Buffer.concat(chunks);

        const url = await uploadImage(buffer);

        await sock.sendMessage(chat, {
            text:
                '🔗 *public url*\n\n' +
                `${url}\n\n` +
                `_size: ${(buffer.length / 1024).toFixed(1)} KB_\n\n` +
                'Provided by 𝗪𝗥𝗜𝗧🇭'
        }, { quoted: msg });
    } catch (e) {
        await sock.sendMessage(chat, { text: `⚠️ url failed: ${e.message}` }, { quoted: msg }).catch(() => {});
    }
}
