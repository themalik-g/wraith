// ─────────────────────────────────────────────
//  WRAITH · router.js
//  Unified message dispatcher.
// ─────────────────────────────────────────────
import {
    remember,
    revealDelete,
    revealEdit,
    revealSecretEdit,
    ghostCommand,
    classifyMessage
} from './modules/ghost.js';
import { peekCommand, autoPeek, watchQuotedViewOnce } from './modules/peek.js';
import { lurkCommand, lurkTick } from './modules/lurk.js';
import { pingCommand } from './modules/ping.js';
import { helpCommand } from './modules/help.js';
import { scheduleCommand } from './modules/schedule.js';
import { adminAction, toggleProtection, handleProtection } from './modules/admin.js';
import { getppCommand } from './modules/profile.js';
import { getjidCommand } from './modules/jid.js';
import { presenceCommand, shouldReadReceipts, applyAutoPresence } from './modules/presence.js';
import { activityCommand, trackActivity } from './modules/activity.js';
import { cacheChannelFromMessage } from './core/jid-resolver.js';

// ─────────────────────────────────────────────
//  Plain text extractor
// ─────────────────────────────────────────────
function plainText(msg) {
    return (
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        msg.message?.imageMessage?.caption ||
        msg.message?.videoMessage?.caption ||
        ''
    ).trim();
}

// ─────────────────────────────────────────────
//  Main dispatcher (messages.upsert)
// ─────────────────────────────────────────────
export async function dispatch(sock, update) {
    if (update.type && update.type !== 'notify' && update.type !== 'append') {
        return;
    }

    for (const msg of update.messages || []) {
        if (!msg?.message) continue;

        try {
            const chat = msg.key.remoteJid;
            if (!chat) continue;

            // ── Activity tracking ──
            try { trackActivity(chat, msg, plainText(msg)); } catch (e) {
                console.error('[router] trackActivity', e.message);
            }

            // ── Channel cache ──
            try { cacheChannelFromMessage(msg); } catch (e) {
                console.error('[router] cacheChannelFromMessage', e.message);
            }

            // ── Read receipts ──
            try {
                if (shouldReadReceipts() && !msg.key.fromMe && chat !== 'status@broadcast') {
                    await sock.readMessages([msg.key]);
                }
            } catch (e) {
                console.error('[router] readReceipts', e.message);
            }

            // ── Ghost classification ──
            const kind = classifyMessage(msg);

            if (kind === 'revoke') {
                await revealDelete(sock, msg);
                continue;
            }
            if (kind === 'edit') {
                await revealEdit(sock, msg);
                continue;
            }
            if (kind === 'secret_edit') {
                await revealSecretEdit(sock, msg);
                continue;
            }

            // ── Ledger + view-once ──
            try { await remember(sock, msg); } catch (e) {
                console.error('[router] remember', e.message);
            }
            try { await autoPeek(sock, msg); } catch (e) {
                console.error('[router] autoPeek', e.message);
            }
            try { await watchQuotedViewOnce(sock, msg); } catch (e) {
                console.error('[router] watchQuotedViewOnce', e.message);
            }

            // ── Statuses handled separately ──
            if (chat === 'status@broadcast') continue;

            // ── Auto presence ──
            try { await applyAutoPresence(sock, chat); } catch (e) {
                console.error('[router] applyAutoPresence', e.message);
            }

            // ── Group protection ──
            try {
                const blocked = await handleProtection(sock, chat, msg, plainText(msg));
                if (blocked) continue;
            } catch (e) {
                console.error('[router] handleProtection', e.message);
            }

            // ── Command parsing ──
            const text = plainText(msg);
            if (!text.startsWith('.')) continue;

            const firstSpace = text.indexOf(' ');
            const verb = (firstSpace === -1 ? text.slice(1) : text.slice(1, firstSpace)).toLowerCase();
            const rest = firstSpace === -1 ? [] : text.slice(firstSpace + 1).trim().split(/\s+/);

            switch (verb) {
                case 'ghost': await ghostCommand(sock, chat, msg, rest); break;
                case 'peek':  await peekCommand(sock, chat, msg, rest);  break;
                case 'lurk':  await lurkCommand(sock, chat, msg, rest);  break;
                case 'ping':  await pingCommand(sock, chat, msg);        break;
                case 'help':
                case 'menu':  await helpCommand(sock, chat, msg, rest);  break;

                case 'schedule':   await scheduleCommand(sock, chat, msg, rest); break;
                case 'kick':       await adminAction(sock, chat, msg, rest, 'remove');   break;
                case 'add':        await adminAction(sock, chat, msg, rest, 'add');     break;
                case 'promote':    await adminAction(sock, chat, msg, rest, 'promote'); break;
                case 'demote':     await adminAction(sock, chat, msg, rest, 'demote');  break;
                case 'antilink':   await toggleProtection(sock, chat, msg, rest, 'antilink');   break;
                case 'antispam':   await toggleProtection(sock, chat, msg, rest, 'antispam');   break;
                case 'antisticker': await toggleProtection(sock, chat, msg, rest, 'antisticker'); break;
                case 'getpp':      await getppCommand(sock, chat, msg, rest);  break;
                case 'getjid':     await getjidCommand(sock, chat, msg, rest); break;
                case 'presence':   await presenceCommand(sock, chat, msg, rest); break;
                case 'activity':   await activityCommand(sock, chat, msg, rest); break;

                default: break;
            }
        } catch (e) {
            console.error('[dispatch]', e);
        }
    }
}

// ─────────────────────────────────────────────
//  Update dispatcher (messages.update)
// ─────────────────────────────────────────────
export async function dispatchUpdate(sock, update) {
    if (!update?.key) return;

    const editNode =
        update.update?.message?.protocolMessage ||
        update.update?.message ||
        update.message?.protocolMessage;

    if (!editNode) return;

    const envelope = {
        key: update.key,
        participant: update.participant || update.key.participant,
        message: { protocolMessage: editNode }
    };

    const t = editNode.type;
    if (t === 14 || t === 'MESSAGE_EDIT') {
        await revealEdit(sock, envelope);
    } else if (t === 0 || t === 'REVOKE') {
        await revealDelete(sock, envelope);
    }
}

// ─────────────────────────────────────────────
//  Status event entry point
// ─────────────────────────────────────────────
export async function dispatchStatus(sock, payload) {
    try {
        await lurkTick(sock, payload);
    } catch (e) {
        console.error('[dispatchStatus]', e);
    }
}
