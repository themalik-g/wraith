// ─────────────────────────────────────────────
//  WRAITH · start.js
//  Entry point · interactive pairing-code auth
// ─────────────────────────────────────────────
import makeWASocket, {
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    delay
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import parsePhoneNumber from 'awesome-phonenumber';
import { fileURLToPath } from 'url';

import { CONFIG } from './config.js';
import { dispatch, dispatchStatus, dispatchUpdate } from './router.js';
import { trace, traceLine } from './modules/debug.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const AUTH_DIR = path.join(here, 'session');
const OWNER_FILE = path.join(here, 'state', 'owner.json');

fs.mkdirSync(AUTH_DIR, { recursive: true });

const log = pino({ level: 'silent' });

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
${violet('            w r a i t h')}
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
//  Keep-alive
// ─────────────────────────────────────────────
let keepAliveTimer = null;
let isStarting = false;

function startKeepAlive(sock) {
    stopKeepAlive();
    keepAliveTimer = setInterval(() => {
        try { sock.sendPresenceUpdate('available').catch(() => {}); } catch {}
    }, CONFIG.keepAliveInterval);
}

function stopKeepAlive() {
    if (keepAliveTimer) {
        clearInterval(keepAliveTimer);
        keepAliveTimer = null;
    }
}

// ─────────────────────────────────────────────
//  Boot
// ─────────────────────────────────────────────
async function ignite() {
    if (isStarting) return;
    isStarting = true;

    try {
        const { version } = await fetchLatestBaileysVersion();
        const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

        const sock = makeWASocket({
            version,
            logger: log,
            printQRInTerminal: false,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, log)
            },
            browser: ['Ubuntu', 'Chrome', '20.0.04'],
            markOnlineOnConnect: true,
            generateHighQualityLinkPreview: false,
            syncFullHistory: false,
            getMessage: async () => undefined,
            defaultQueryTimeoutMs: 60000,
            connectTimeoutMs: 60000,
            keepAliveIntervalMs: 10000
        });

        // ── PAIRING ──
        if (!sock.authState.creds.registered) {
            const number = await resolveNumber();

            setTimeout(async () => {
                try {
                    let code = await sock.requestPairingCode(number);
                    code = code?.match(/.{1,4}/g)?.join('-') || code;
                    console.log(banner(code, number));
                } catch (err) {
                    console.error(red('pairing failed ·'), err.message);
                    console.error(grey('   try deleting ./session and restarting'));
                }
            }, 3000);
        }

        // ── connection lifecycle ──
        sock.ev.on('connection.update', async (u) => {
            const { connection, lastDisconnect } = u;

            if (connection === 'connecting') console.log(grey('  …connecting'));

            if (connection === 'open') {
                isStarting = false;
                console.log(green(`\n👻 wraith online as ${sock.user?.id?.split(':')[0]}\n`));
                startKeepAlive(sock);
            }

            if (connection === 'close') {
                stopKeepAlive();
                isStarting = false;

                const statusCode =
                    lastDisconnect?.error instanceof Boom
                        ? lastDisconnect.error.output?.statusCode
                        : 0;

                if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                    console.log(red('👻 logged out · wiping session'));
                    try { fs.rmSync(AUTH_DIR, { recursive: true, force: true }); } catch {}
                    return;
                }

                console.log(yellow(`👻 reconnecting (${statusCode})…`));
                await delay(3000);
                setTimeout(ignite, 100);
            }
        });

        sock.ev.on('creds.update', saveCreds);

        // ═════════════════════════════════════════
        //  MESSAGES.UPSERT — new messages + edits
        //  NOTE: we now pass EVERY update (not just
        //  type==='notify') so edits never get filtered
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

            await dispatch(sock, u);

            for (const m of u.messages || []) {
                if (m.key?.remoteJid === 'status@broadcast') {
                    await dispatchStatus(sock, { messages: [m] });
                }
            }
        });

        // ═════════════════════════════════════════
        //  MESSAGES.UPDATE — edits + delivery receipts
        //  This is the channel most bots forget.
        // ═════════════════════════════════════════
        sock.ev.on('messages.update', async (updates) => {
            trace('messages.update', updates);

            for (const u of updates || []) {
                // Route to the edit handler
                await dispatchUpdate(sock, u);

                // Route status updates to lurk
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
        setTimeout(ignite, CONFIG.reconnectDelay);
    }
}

// ─────────────────────────────────────────────
//  Graceful shutdown
// ─────────────────────────────────────────────
function shutdown(signal) {
    console.log(grey(`\n👻 ${signal} received · shutting down…`));
    stopKeepAlive();
    setTimeout(() => process.exit(0), 500);
}

process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException',  (e) => console.error('uncaught ·', e));
process.on('unhandledRejection', (e) => console.error('unhandled ·', e));

// ─────────────────────────────────────────────
//  Launch
// ─────────────────────────────────────────────
console.log(violet('\n👻  wraith · booting…\n'));
ignite();
