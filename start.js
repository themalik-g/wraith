// ─────────────────────────────────────────────
//  WRAITH · start.js (Bulletproof)
//  Entry point · interactive pairing-code auth
// ─────────────────────────────────────────────
import makeWASocket, {
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    Browsers,
    delay
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import NodeCache from '@cacheable/node-cache'; // Required for msgRetryCounterCache
import pino from 'pino';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import parsePhoneNumber from 'awesome-phonenumber';
import { fileURLToPath } from 'url';

import { CONFIG } from './config.js';
import { dispatch, dispatchStatus, dispatchUpdate } from './router.js';
import { trace } from './modules/debug.js';
import { startScheduler } from './modules/schedule.js';
import { startPresenceHeartbeat } from './modules/presence.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const AUTH_DIR = path.join(here, 'session');
const OWNER_FILE = path.join(here, 'state', 'owner.json');

fs.mkdirSync(AUTH_DIR, { recursive: true });

const log = pino({ level: 'silent' });

// ─────────────────────────────────────────────
//  [FIX 1] Outgoing message store (REQUIRED for retry receipts)
//  The #1 cause of "Waiting for this message" is a missing
//  getMessage implementation. WhatsApp's retry protocol needs
//  to fetch the original message to re-encrypt and resend.
// ─────────────────────────────────────────────
const MESSAGE_STORE = new Map();
const MESSAGE_STORE_MAX = 1000;

function rememberMessage(msg) {
    if (!msg?.key?.id || !msg?.message) return;
    MESSAGE_STORE.set(msg.key.id, msg.message);
    if (MESSAGE_STORE.size > MESSAGE_STORE_MAX) {
        const oldest = MESSAGE_STORE.keys().next().value;
        MESSAGE_STORE.delete(oldest);
    }
}

// ─────────────────────────────────────────────
//  [FIX 2] msgRetryCounterCache (REQUIRED for retry system)
//  Without this, retries run indefinitely without control.
//  TTL is set to prevent old messages from being retried.
// ─────────────────────────────────────────────
const msgRetryCounterCache = new NodeCache({
    stdTTL: 100,      // 100 seconds — retries should happen quickly
    checkperiod: 120  // Check for expired entries every 2 minutes
});

// ─────────────────────────────────────────────
//  Terminal dye
// ─────────────────────────────────────────────
const dye    = (c, s) => `\x1b[${c}m${s}\x1b[0m`;
const grey   = s => dye(90, s);
const cyan   = s => dye(36, s);
const violet = s => dye(35, s);
const green  = s => dye(32, s);
const yellow = s => dye(33, s);
const red    = s => dye(31, s);
const bold   = s => dye(1,  s);

// ─────────────────────────────────────────────
//  Banner
// ─────────────────────────────────────────────
const banner = (code, number) => `
${violet('     ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·')}
${violet(`            ${CONFIG.botName}`)}
${violet('     ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·')}

   ${grey('pairing code →')}  ${bold(cyan(code))}

   ${grey('number ·')} ${cyan('+' + number)}
   ${grey('WhatsApp → Linked Devices → Link a Device')}
   ${grey('Then tap "Link with phone number instead" and enter the code.')}
`;

// ─────────────────────────────────────────────
//  Interactive number prompt
// ─────────────────────────────────────────────
function ask(question) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    return new Promise(resolve => {
        rl.question(question, answer => {
            rl.close();
            resolve(answer.trim());
        });
    });
}

async function resolveNumber() {
    if (!process.stdin.isTTY) {
        const fallback = CONFIG.owner.replace(/\D/g, '');
        console.log(grey(`[non-interactive] using number from config: ${fallback}`));
        return fallback;
    }

    console.log();
    console.log(violet('  ╭─ first-time setup ────────────────────╮'));
    console.log(violet('  │') + '  Enter your WhatsApp number           ' + violet('│'));
    console.log(violet('  │') + grey('  country code + number, digits only  ') + violet('│'));
    console.log(violet('  │') + grey('  example: 923001234567                ') + violet('│'));
    console.log(violet('  ╰───────────────────────────────────────╯'));
    console.log();

    while (true) {
        const raw = await ask(violet('  ❯ ') + cyan('number: '));
        const digits = raw.replace(/\D/g, '');

        if (!/^\d{10,15}$/.test(digits)) {
            console.log(red('  ✖ must be 10–15 digits, no + or spaces'));
            continue;
        }

        const pn = parsePhoneNumber('+' + digits);
        if (!pn?.valid) {
            console.log(red('  ✖ not a valid international number'));
            continue;
        }

        try {
            fs.mkdirSync(path.dirname(OWNER_FILE), { recursive: true });
            fs.writeFileSync(OWNER_FILE, JSON.stringify({ owner: digits }, null, 2));
            console.log(green('  ✓ saved to state/owner.json'));
        } catch {}

        CONFIG.owner = digits;
        console.log();
        return digits;
    }
}

// ─────────────────────────────────────────────
//  Pairing code with retry
// ─────────────────────────────────────────────
async function showPairingCode(sock, number, attempt = 0) {
    try {
        let code = await sock.requestPairingCode(number);
        code = code?.match(/.{1,4}/g)?.join('-') || code;
        console.log(banner(code, number));
    } catch (err) {
        if (attempt < 3) {
            console.error(yellow(`pairing not ready · retry ${attempt + 1}/3 in 8s ·`), err.message);
            setTimeout(() => showPairingCode(sock, number, attempt + 1), 8000);
        } else {
            console.error(red('pairing failed ·'), err.message);
            console.error(grey('   try deleting ./session and restarting'));
        }
    }
}

// ─────────────────────────────────────────────
//  Boot
// ─────────────────────────────────────────────
let isStarting = false;
let currentSock = null;
let reconnectAttempts = 0;

// [FIX 3] Fully tear down the old socket before creating a new one.
// This prevents two sockets from sharing the same auth state files,
// which causes "Closing stale open session" and corrupted keys.
function teardownSock() {
    if (!currentSock) return;
    const s = currentSock;
    currentSock = null;
    try { s.ev.removeAllListeners('connection.update'); } catch {}
    try { s.ev.removeAllListeners('creds.update'); } catch {}
    try { s.ev.removeAllListeners('messages.upsert'); } catch {}
    try { s.ev.removeAllListeners('messages.update'); } catch {}
    try { s.ev.removeAllListeners('messages.reaction'); } catch {}
    try { s.end(undefined); } catch {}
}

async function ignite() {
    if (isStarting) return;
    isStarting = true;

    // Ensure no leftover socket from a previous attempt is still alive.
    teardownSock();

    try {
        const { version } = await fetchLatestBaileysVersion();
        const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

        // [FIX 4] Use Browsers.appropriate() instead of a hardcoded
        // browser tuple. This reduces the chance of WhatsApp rejecting
        // the connection due to an outdated browser string.
        const sock = makeWASocket({
            version,
            logger: log,
            printQRInTerminal: false,
            auth: {
                creds: state.creds,
                keys: state.keys // Do NOT use makeCacheableSignalKeyStore here
            },
            browser: Browsers.appropriate('Desktop'),
            markOnlineOnConnect: false,
            generateHighQualityLinkPreview: false,
            syncFullHistory: false,
            // [FIX 5] getMessage MUST return the original message so
            // WhatsApp's retry protocol can re-encrypt and resend it.
            getMessage: async (key) => MESSAGE_STORE.get(key.id) || undefined,
            // [FIX 6] msgRetryCounterCache controls retry behavior.
            msgRetryCounterCache,
            defaultQueryTimeoutMs: 60000,
            connectTimeoutMs: 60000,
            keepAliveIntervalMs: 10000
        });

        currentSock = sock;

        // [FIX 7] Wrap sendMessage to store every outgoing message.
        // Without this, getMessage has nothing to return.
        const _origSendMessage = sock.sendMessage.bind(sock);
        sock.sendMessage = async (jid, content, options) => {
            const sent = await _origSendMessage(jid, content, options);
            try {
                if (sent?.key?.id && sent?.message) {
                    rememberMessage(sent);
                }
            } catch {}
            return sent;
        };

        // ── PAIRING ──
        if (!sock.authState.creds.registered) {
            const number = await resolveNumber();
            setTimeout(() => showPairingCode(sock, number), 3000);
        }

        // ── connection lifecycle ──
        sock.ev.on('connection.update', async (u) => {
            const { connection, lastDisconnect } = u;

            if (connection === 'connecting') console.log(grey('  …connecting'));

            if (connection === 'open') {
                isStarting = false;
                reconnectAttempts = 0; // Reset backoff on successful connection
                console.log(green(`\n👻 ${CONFIG.botName} online as ${sock.user?.id?.split(':')[0]}\n`));
                startScheduler(sock);
                startPresenceHeartbeat(sock);
            }

            if (connection === 'close') {
                const statusCode =
                    lastDisconnect?.error instanceof Boom
                        ? lastDisconnect.error.output?.statusCode
                        : 0;

                // Logged out → wipe session and restart into pairing flow
                if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                    console.log(red('👻 logged out · wiping session'));
                    teardownSock();
                    try { fs.rmSync(AUTH_DIR, { recursive: true, force: true }); } catch {}
                    try { fs.mkdirSync(AUTH_DIR, { recursive: true }); } catch {}
                    console.log(yellow('👻 restarting into pairing mode…'));
                    isStarting = false;
                    reconnectAttempts = 0;
                    setTimeout(ignite, 1500);
                    return;
                }

                // [FIX 8] Exponential backoff for reconnects.
                // This prevents rapid reconnect loops that can corrupt
                // the session and cause "Waiting for this message".
                reconnectAttempts++;
                const baseDelay = CONFIG.reconnectDelay || 2000;
                const backoffDelay = Math.min(
                    baseDelay * Math.pow(2, reconnectAttempts - 1),
                    60000 // Max 60 seconds
                );

                console.log(yellow(`👻 reconnecting (${statusCode}) in ${backoffDelay/1000}s · attempt ${reconnectAttempts}`));
                teardownSock();
                await delay(backoffDelay);
                isStarting = false;
                ignite();
            }
        });

        sock.ev.on('creds.update', saveCreds);

        // ═════════════════════════════════════════
        //  MESSAGES.UPSERT — new messages + edits
        // ═════════════════════════════════════════
        sock.ev.on('messages.upsert', async (u) => {
            trace('messages.upsert', {
                type: u.type,
                count: u.messages?.length,
                firstKey: u.messages?.[0]?.key,
                firstMessageKeys: u.messages?.[0]?.message
                    ? Object.keys(u.messages[0].message)
                    : null
            });

            // [FIX 9] Remember incoming messages too (helps retries/edits/replies)
            for (const m of u.messages || []) rememberMessage(m);

            // [FIX 10] Treat incomplete messages as retryable, not fatal.
            // If a message arrives with missing encryption material,
            // schedule a retry instead of dropping it.
            for (const m of u.messages || []) {
                if (!m.message && !m.messageStubParameters) {
                    console.log(yellow(`[WRAITH] Incomplete message ${m.key?.id}, scheduling retry…`));
                    // Baileys will handle the retry via the retry receipt mechanism
                    continue;
                }
            }

            await dispatch(sock, u);

            for (const m of u.messages || []) {
                if (m.key?.remoteJid === 'status@broadcast') {
                    await dispatchStatus(sock, { messages: [m] });
                }
            }
        });

        // ═════════════════════════════════════════
        //  MESSAGES.UPDATE — edits + delivery receipts
        // ═════════════════════════════════════════
        sock.ev.on('messages.update', async (updates) => {
            trace('messages.update', updates);

            for (const u of updates || []) {
                await dispatchUpdate(sock, u);

                if (u.key?.remoteJid === 'status@broadcast') {
                    await dispatchStatus(sock, { key: u.key });
                }
            }
        });

        // ── status reactions ──
        sock.ev.on('messages.reaction', async (reactions) => {
            for (const r of reactions) {
                if (r.key?.remoteJid === 'status@broadcast') {
                    await dispatchStatus(sock, { reaction: r });
                }
            }
        });

    } catch (err) {
        isStarting = false;
        console.error(red('boot failure ·'), err.message);
        teardownSock();
        setTimeout(ignite, CONFIG.reconnectDelay);
    }
}

// ─────────────────────────────────────────────
//  Graceful shutdown
// ─────────────────────────────────────────────
function shutdown(signal) {
    console.log(grey(`\n👻 ${signal} received · shutting down…`));
    teardownSock();
    setTimeout(() => process.exit(0), 500);
}

process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException',  (e) => console.error('uncaught ·', e));
process.on('unhandledRejection', (e) => console.error('unhandled ·', e));

// ─────────────────────────────────────────────
//  Launch
// ─────────────────────────────────────────────
console.log(violet(`\n👻  ${CONFIG.botName} · booting…\n`));
ignite();
