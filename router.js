import {
    remember,
    revealDelete,
    revealEdit,
    revealEditFromUpdate,
    revealSecretEdit,
    ghostCommand,
    classifyMessage
} from './modules/ghost.js';
import { peekCommand, autoPeek, watchQuotedViewOnce } from './modules/peek.js';
import { lurkCommand, lurkTick } from './modules/lurk.js';
import { pingCommand } from './modules/ping.js';
import { helpCommand } from './modules/help.js';

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

            await remember(sock, msg);
            await autoPeek(sock, msg);
            await watchQuotedViewOnce(sock, msg);

            const chat = msg.key.remoteJid;
            if (chat === 'status@broadcast') continue;

            const body = plainText(msg).toLowerCase();
            if (!body.startsWith('.')) continue;

            const parts = body.slice(1).split(/\s+/);
            const verb = parts[0];
            const rest = parts.slice(1);

            switch (verb) {
                case 'ghost': await ghostCommand(sock, chat, msg, rest); break;
                case 'peek':  await peekCommand(sock, chat, msg, rest);  break;
                case 'lurk':  await lurkCommand(sock, chat, msg, rest);  break;
                case 'ping':  await pingCommand(sock, chat, msg);        break;
                case 'help':
                case 'menu':  await helpCommand(sock, chat, msg, rest);  break;
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
        message: {
            protocolMessage: editNode
        }
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
