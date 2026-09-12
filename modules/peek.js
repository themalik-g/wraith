import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
    downloadContentFromMessage,
    generateWAMessageFromContent
} from '@whiskeysockets/baileys';

import { isOwner, ownerJid, digitsOf, isOwnerChat } from '../core/identity.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const STATE = path.join(here, '..', 'state', 'peek.json');

const DEBUG = process.env.WRAITH_DEBUG === '1';

// ─────────────────────────────────────────────
//  State file bootstrap
// ─────────────────────────────────────────────
fs.mkdirSync(path.dirname(STATE), { recursive: true });
if (!fs.existsSync(STATE)) {
    fs.writeFileSync(STATE, JSON.stringify({
        auto: false,
        dest: 'owner',
        watchQuoted: true
    }));
}

// ─────────────────────────────────────────────
//  State helpers
// ─────────────────────────────────────────────
function read() {
    try {
        const raw = JSON.parse(fs.readFileSync(STATE, 'utf-8'));
        return {
            auto: raw.auto === true,
            dest: raw.dest || 'owner',
            watchQuoted: raw.watchQuoted !== false
        };
    } catch {
        return { auto: false, dest: 'owner', watchQuoted: true };
    }
}
function write(o) {
    try { fs.writeFileSync(STATE, JSON.stringify(o, null, 2)); } catch {}
}

// ─────────────────────────────────────────────
//  Dedupe — prevents the same view-once being
//  captured twice when multiple people reply to it.
// ─────────────────────────────────────────────
const seenQuoted = new Map(); // stanzaId → timestamp

setInterval(() => {
    const cutoff = Date.now() - 10 * 60 * 1000;
    for (const [id, ts] of seenQuoted.entries()) {
        if (ts < cutoff) seenQuoted.delete(id);
    }
}, 60 * 1000);

// ─────────────────────────────────────────────
//  View-once extractor
//  Works on any message envelope, returns:
//    { node, type, contentKey }
// ─────────────────────────────────────────────
function extractViewOnce(msg) {
    if (!msg || !msg.message) return null;

    const m = msg.message;

    // Direct media
    if (m.imageMessage) return { node: m.imageMessage, type: 'image', contentKey: 'imageMessage' };
    if (m.videoMessage) return { node: m.videoMessage, type: 'video', contentKey: 'videoMessage' };
    if (m.audioMessage) return { node: m.audioMessage, type: 'audio', contentKey: 'audioMessage' };

    // Wrapped shapes
    const wrapped =
        m.viewOnceMessageV2?.message ||
        m.viewOnceMessageV2Extension?.message ||
        m.viewOnceMessage?.message;

    if (wrapped) {
        if (wrapped.imageMessage) return { node: wrapped.imageMessage, type: 'image', contentKey: 'imageMessage' };
        if (wrapped.videoMessage) return { node: wrapped.videoMessage, type: 'video', contentKey: 'videoMessage' };
        if (wrapped.audioMessage) return { node: wrapped.audioMessage, type: 'audio', contentKey: 'audioMessage' };
    }

    // Ephemeral wrappers
    const eph = m.ephemeralMessage?.message;
    if (eph) {
        if (eph.imageMessage) return { node: eph.imageMessage, type: 'image', contentKey: 'imageMessage' };
        if (eph.videoMessage) return { node: eph.videoMessage, type: 'video', contentKey: 'videoMessage' };

        const ephWrapped =
            eph.viewOnceMessageV2?.message ||
            eph.viewOnceMessageV2Extension?.message ||
            eph.viewOnceMessage?.message;
        if (ephWrapped) {
            if (ephWrapped.imageMessage) return { node: ephWrapped.imageMessage, type: 'image', contentKey: 'imageMessage' };
            if (ephWrapped.videoMessage) return { node: ephWrapped.videoMessage, type: 'video', contentKey: 'videoMessage' };
        }
    }

    return null;
}

export { extractViewOnce };

// ─────────────────────────────────────────────
//  Send strategies
// ─────────────────────────────────────────────

// Method 1 — Forward the media node with viewOnce flag stripped
async function forwardStripped(sock, targetChat, originalMsg, vo, opts = {}) {
    const { quotedMsg = null, mentionSender = null, prefix = '' } = opts;
    if (!vo || !vo.node) return false;

    try {
        const cleanNode = { ...vo.node };
        delete cleanNode.viewOnce;

        const cleanContent = { [vo.contentKey]: cleanNode };

        if (originalMsg?.message?.messageContextInfo) {
            cleanContent.messageContextInfo = originalMsg.message.messageContextInfo;
        }

        if (DEBUG) {
            console.log('[peek:forward] has URL:', !!cleanNode.url,
                '| has mediaKey:', !!cleanNode.mediaKey);
        }

        const waMsg = generateWAMessageFromContent(targetChat, cleanContent, {
            userJid: sock.user?.id,
            quoted: quotedMsg || originalMsg
        });

        // Caption goes as a separate message so it doesn't interfere
        if (prefix || mentionSender) {
            const captionText = [
                prefix,
                mentionSender ? `from @${digitsOf(mentionSender)}` : ''
            ].filter(Boolean).join('\n').trim();
            const mentions = mentionSender ? [mentionSender] : [];

            try {
                await sock.sendMessage(targetChat, { text: captionText, mentions });
            } catch {}
        }

        await sock.relayMessage(targetChat, waMsg.message, {
            messageId: waMsg.key.id
        });

        if (DEBUG) console.log('[peek:forward] ✅ to', targetChat);
        return true;
    } catch (e) {
        if (DEBUG) console.log('[peek:forward] ❌', e.message);
        return false;
    }
}

// Method 2 — Download the media and re-upload it
async function downloadAndSend(sock, targetChat, vo, opts = {}) {
    const { quotedMsg = null, mentionSender = null, prefix = '' } = opts;
    if (!vo || !vo.node) return false;

    try {
        const stream = await downloadContentFromMessage(vo.node, vo.type);
        const chunks = [];
        for await (const c of stream) chunks.push(c);
        const buf = Buffer.concat(chunks);

        if (DEBUG) console.log('[peek:download] got', buf.length, 'bytes');

        const caption = [
            prefix,
            vo.node.caption || '',
            mentionSender ? `from @${digitsOf(mentionSender)}` : ''
        ].filter(Boolean).join('\n').trim();

        const mentions = mentionSender ? [mentionSender] : [];
        const sendOpts = { caption, mentions };
        if (quotedMsg) sendOpts.quoted = quotedMsg;

        if (vo.type === 'image') {
            await sock.sendMessage(targetChat, { image: buf, ...sendOpts });
        } else if (vo.type === 'video') {
            await sock.sendMessage(targetChat, { video: buf, ...sendOpts });
        } else if (vo.type === 'audio') {
            await sock.sendMessage(targetChat, {
                audio: buf,
                mimetype: vo.node.mimetype || 'audio/mpeg',
                ptt: false,
                ...sendOpts
            });
        } else {
            return false;
        }

        if (DEBUG) console.log('[peek:download] ✅ to', targetChat);
        return true;
    } catch (e) {
        if (DEBUG) console.log('[peek:download] ❌', e.message);
        return false;
    }
}

// Try forward first, fall back to download
async function revealViewOnce(sock, targetChat, originalMsg, vo, opts = {}) {
    const forwarded = await forwardStripped(sock, targetChat, originalMsg, vo, opts);
    if (forwarded) return { method: 'forward', ok: true };

    if (DEBUG) console.log('[peek] falling back to download');
    const downloaded = await downloadAndSend(sock, targetChat, vo, opts);
    return { method: 'download', ok: downloaded };
}

// ─────────────────────────────────────────────
//  .peek command
// ─────────────────────────────────────────────
export async function peekCommand(sock, chat, msg, args) {
    const from = msg.key.participant || msg.key.remoteJid;
    const a0 = (args?.[0] || '').toLowerCase();
    const a1 = (args?.[1] || '').toLowerCase();

    const ctx = msg.message?.extendedTextMessage?.contextInfo;
    const quoted = ctx?.quotedMessage;
    const hasQuote = !!quoted;

    // ── Settings commands ──
    const isSettingsCmd = a0 === 'auto' || a0 === 'dest' || a0 === 'watch' ||
                          a0 === 'on' || a0 === 'off';

    if (isSettingsCmd || (!hasQuote && a0)) {
        if (!msg.key.fromMe && !isOwner(from)) {
            return sock.sendMessage(chat, { text: '⛔ Owner only.' }, { quoted: msg });
        }
        const s = read();

        if (a0 === 'auto' || a0 === 'on' || a0 === 'off') {
            const wantOn = a0 === 'on' || a1 === 'on';
            if (a0 === 'auto' && a1 !== 'on' && a1 !== 'off') {
                return sock.sendMessage(chat, {
                    text: '👁️ use _.peek auto on_ or _.peek auto off_'
                }, { quoted: msg });
            }
            s.auto = wantOn;
            write(s);
            return sock.sendMessage(chat, {
                text: s.auto ? '👁️ auto-peek armed.' : '👁️ auto-peek disarmed.'
            }, { quoted: msg });
        }

        if (a0 === 'watch') {
            if (a1 !== 'on' && a1 !== 'off') {
                return sock.sendMessage(chat, {
                    text: '👁️ use _.peek watch on_ or _.peek watch off_'
                }, { quoted: msg });
            }
            s.watchQuoted = a1 === 'on';
            write(s);
            return sock.sendMessage(chat, {
                text: s.watchQuoted
                    ? '👁️ quoted-watcher armed. Every reply to a view-once gets captured.'
                    : '👁️ quoted-watcher disarmed.'
            }, { quoted: msg });
        }

        if (a0 === 'dest') {
            if (!['owner', 'same', 'both'].includes(a1)) {
                return sock.sendMessage(chat, {
                    text: '👁️ destination must be one of: owner, same, both'
                }, { quoted: msg });
            }
            s.dest = a1;
            write(s);
            return sock.sendMessage(chat, {
                text: `👁️ peek destination set to *${a1}*.`
            }, { quoted: msg });
        }

        return sock.sendMessage(chat, { text: `👁️ unknown option _${a0}_.` }, { quoted: msg });
    }

    // ── Status card ──
    if (!hasQuote) {
        const s = read();
        return sock.sendMessage(chat, {
            text:
                `👁️ *peek*\n\n` +
                `auto-peek    · ${s.auto ? 'on' : 'off'}\n` +
                `quoted-watch · ${s.watchQuoted ? 'on' : 'off'}\n` +
                `destination  · ${s.dest}\n\n` +
                `Reply to a view-once with _.peek_ to reveal it.\n` +
                `_.peek auto on|off_\n` +
                `_.peek watch on|off_\n` +
                `_.peek dest owner|same|both_`
        }, { quoted: msg });
    }

    // ── Manual reveal ──
    const pseudoMsg = { message: quoted };
    const vo = extractViewOnce(pseudoMsg);

    if (DEBUG) {
        console.log('[peek:cmd] quoted keys:', quoted ? Object.keys(quoted) : null);
        console.log('[peek:cmd] extract →', vo ? vo.type : 'null');
    }

    if (!vo) {
        return sock.sendMessage(chat, {
            text: '👁️ that message is not a view-once (or content has expired).'
        }, { quoted: msg });
    }

    const originalMsg = { key: msg.key, message: quoted };
    const result = await revealViewOnce(sock, chat, originalMsg, vo, { quotedMsg: msg });

    if (!result.ok) {
        return sock.sendMessage(chat, {
            text: "👁️ couldn't retrieve that view-once — content may have expired."
        }, { quoted: msg });
    }

    if (DEBUG) console.log('[peek:cmd] succeeded via', result.method);
}

// ─────────────────────────────────────────────
//  Auto-peek — attempts to catch view-onces
//  as they arrive (usually only works for
//  direct/forwarded view-onces with content).
// ─────────────────────────────────────────────
export async function autoPeek(sock, msg) {
    const s = read();
    if (!s.auto) return;

    // ── Skip owner DM — prevents spam loop ──
    if (isOwnerChat(msg.key?.remoteJid)) return;

    if (msg.key?.isViewOnce === true && !msg.message) {
        if (DEBUG) console.log('[peek:auto] stub without content — skipped');
        return;
    }

    const vo = extractViewOnce({ message: msg.message });
    if (DEBUG) {
        console.log('[peek:auto] incoming', msg.key?.id,
            '| isViewOnce:', msg.key?.isViewOnce,
            '→', vo ? vo.type : 'not view-once');
    }
    if (!vo) return;

    const originChat = msg.key.remoteJid;
    const sender = msg.key.participant || msg.key.remoteJid;
    const prefix = `👁️ *auto-peek · ${vo.type}*`;

    const targets = [];
    if (s.dest === 'owner' || s.dest === 'both') targets.push(ownerJid());
    if (s.dest === 'same'  || s.dest === 'both') targets.push(originChat);

    for (const target of targets) {
        const result = await revealViewOnce(sock, target, msg, vo, {
            mentionSender: sender,
            prefix
        });
        if (DEBUG) console.log('[peek:auto]', target, '→', result.method, result.ok);
    }
}

// ─────────────────────────────────────────────
//  NEW — Passive quoted watcher
//
//  Runs on EVERY inbound message. If the message
//  quotes a view-once, their phone embedded the
//  real content in contextInfo.quotedMessage.
//  We extract it and send it straight to your DM.
//
//  This is the only way to reliably catch view-onces
//  on a linked device — the original stub never
//  reveals itself, but any reply to it does.
// ─────────────────────────────────────────────
export async function watchQuotedViewOnce(sock, msg) {
    const s = read();
    if (!s.watchQuoted) return;

    // Skip commands — the user is handling it manually
    const body = (
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        msg.message?.imageMessage?.caption ||
        msg.message?.videoMessage?.caption ||
        ''
    ).trim();
    if (body.startsWith('.')) return;

    // Look for quoted content in any media type
    const ctx =
        msg.message?.extendedTextMessage?.contextInfo ||
        msg.message?.imageMessage?.contextInfo ||
        msg.message?.videoMessage?.contextInfo ||
        msg.message?.audioMessage?.contextInfo ||
        msg.message?.documentMessage?.contextInfo;

    if (!ctx?.quotedMessage) return;

    const quotedId = ctx.stanzaId;
    if (!quotedId) return;
    if (seenQuoted.has(quotedId)) return;

    // Extract the view-once from the quote
    const vo = extractViewOnce({ message: ctx.quotedMessage });
    if (!vo) return;

    // Mark BEFORE the async work to avoid races
    seenQuoted.set(quotedId, Date.now());

    // Original sender of the quoted view-once
    const originalSender = ctx.participant || msg.key.participant || msg.key.remoteJid;

    // Always send to owner DM — the passive watcher is silent
    try {
        const result = await revealViewOnce(sock, ownerJid(), msg, vo, {
            mentionSender: originalSender,
            prefix: `👁️ *peek · captured from quoted reply*`
        });

        console.log(
            `[peek:watch] captured ${quotedId} (${vo.type}) via ${result.method} → owner DM`
        );
    } catch (e) {
        if (DEBUG) console.log('[peek:watch] ❌', e.message);
    }
                }
