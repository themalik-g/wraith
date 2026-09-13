// ─────────────────────────────────────────────
//  WRAITH · start.js (bulletproof · multi-session)
//  Entry point · interactive or CLI pairing-code auth
//  Launched per-session by index.js:
//    node --preserve-symlinks --preserve-symlinks-main start.js --session <id> [--number <digits>]
// ─────────────────────────────────────────────
import makeWASocket, {
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    Browsers,
    delay
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import NodeCache from '@cacheable/node-cache';
import pino from 'pino';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import parsePhoneNumber from 'awesome-phonenumber';
import { fileURLToPath } from 'url';

import { CONFIG } from './config.js';
import { dispatch, dispatchStatus, dispatchUpdate } from './router.js';
import { trace } from './modules/debug.js';
import { startScheduler, stopScheduler } from './modules/schedule.js';
import { startPresenceHeartbeat, stopPresenceHeartbeat } from './modules/presence.js';

// ── CLI args ──
const ARGS = {};
for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a === '--number')  ARGS.number  = process.argv[++i];
    if (a === '--session') ARGS.session = process.argv[++i];
}
const SESSION = ARGS.session || 'main';

const here = path.dirname(fileURLToPath(import.meta.url));

// Per-session folders — the launcher chdir()'d us into instances/<id>/
const SESSION_DIR = process.cwd();
const AUTH_DIR    = path.join(SESSION_DIR, 'session');
const STATE_DIR   = path.join(SESSION_DIR, 'state');
const OWNER_FILE  = path.join(STATE_DIR, 'owner.json');

fs.mkdirSync(AUTH_DIR,  { recursive: true });
fs.mkdirSync(STATE_DIR, { recursive: true });

const log = pino({ level: 'silent' });

// ─────────────────────────────────────────────
//  [FIX 1] Outgoing message store
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
//  [FIX 2] msgRetryCounterCache — TTL bumped to 300s
//  (was 100s — too short for slow networks; retries
//  looped and produced "Waiting for this message…")
// ─────────────────────────────────────────────
const msgRetryCounterCache = new NodeCache({
    stdTTL: 300,
    checkperiod: 360
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

const TAG = grey(`[${SESSION}]`);

const banner = (code, number) => `
${violet('     ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·')}
${violet(`            ${CONFIG.botName || CONFIG.codename}`)}
${violet('     ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·')}

   ${grey('pairing code →')}  ${bold(cyan(code))}

   ${grey('number ·')} ${cyan('+' + number)}
   ${grey('session ·')} ${cyan(SESSION)}
   ${grey('WhatsApp → Linked Devices → Link a Device')}
   ${grey('Then tap "Link with phone number instead" and enter the code.')}
`;

// ─────────────────────────────────────────────
//  Owner persistence (per-session)
// ─────────────────────────────────────────────
function saveOwner(digits) {
    try {
        fs.mkdirSync(path.dirname(OWNER_FILE), { recursive: true });
        fs.writeFileSync(OWNER_FILE, JSON.stringify({ owner: digits }, null, 2));
    } catch {}
}

function readOwner() {
    try {
        const raw = JSON.parse(fs.readFileSync(OWNER_FILE, 'utf-8'));
        return String(raw.owner || '').replace(/\D/g, '');
    } catch { return ''; }
}

// ─────────────────────────────────────────────
//  Interactive number prompt
// ─────────────────────────────────────────────
function ask(question) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(resolve => {
        rl.question(question, answer => { rl.close(); resolve(answer.trim()); });
    });
}

async function resolveNumber() {
    if (ARGS.number && /^\d{10,15}$/.test(ARGS.number.replace(/\D/g, ''))) {
        const digits = ARGS.number.replace(/\D/g, '');
        saveOwner(digits);
        CONFIG.owner = digits;
        console.log(TAG, green('✓ number accepted via launcher'));
        return digits;
    }

    const saved = readOwner();
    if (saved && !process.stdin.isTTY) {
        console.log(TAG, grey(`[non-interactive] using saved owner: ${saved}`));
        CONFIG.owner = saved;
        return saved;
    }

    if (!process.stdin.isTTY) {
        const fallback = CONFIG.owner.replace(/\D/g, '');
        console.log(TAG, grey(`[non-interactive] using number from config: ${fallback}`));
        return fallback;
    }

    console.log();
    console.log(violet('  ╭─ first-time setup ────────────────────╮'));
    console.log(violet('  │') + `  session · ${SESSION}`.padEnd(39) + violet('│'));
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

        saveOwner(digits);
        console.log(green('  ✓ saved to state/owner.json'));
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
            console.error(TAG, yellow(`pairing not ready · retry ${attempt + 1}/3 in 8s ·`), err.message);
            setTimeout(() => showPairingCode(sock, number, attempt + 1), 8000);
        } else {
            console.error(TAG, red('pairing failed ·'), err.message);
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

// [FIX 3] Fully tear down the old socket AND its timers
function teardownSock() {
    // stop module-level timers BEFORE clearing the socket
    try { stopScheduler(); } catch {}
    try { stopPresenceHeartbeat(); } catch {}

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

    teardownSock();

    try {
        const { version } = await fetchLatestBaileysVersion();
        const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

        const sock = makeWASocket({
            version,
            logger: log,
            printQRInTerminal: false,
            auth: {
                creds: state.creds,
                keys: state.keys
            },
            browser: Browsers.appropriate('Desktop'),
            markOnlineOnConnect: false,
            generateHighQualityLinkPreview: false,
            syncFullHistory: false,
            getMessage: async (key) => MESSAGE_STORE.get(key.id) || undefined,
            msgRetryCounterCache,
            defaultQueryTimeoutMs: 60000,
            connectTimeoutMs: 60000,
            keepAliveIntervalMs: 10000
        });

        currentSock = sock;

        if (!state.creds?.registered && !sock.authState.creds.registered) {
            const number = await resolveNumber();
            setTimeout(() => showPairingCode(sock, number), 3000);
        } else {
            const saved = readOwner();
            if (saved) CONFIG.owner = saved;
            console.log(TAG, grey('registered credentials found — reconnecting…'));
        }

        // ═════════════════════════════════════════
        //  CONNECTION.UPDATE
        // ═════════════════════════════════════════
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;

            trace('connection.update', { session: SESSION, connection });

            if (connection === 'connecting') console.log(TAG, grey('…connecting'));

            if (connection === 'open') {
                isStarting = false;
                reconnectAttempts = 0;
                console.log(green(`\n👻 ${CONFIG.botName || CONFIG.codename} online as ${sock.user?.id?.split(':')[0]}  · session ${bold(SESSION)}\n`));
                try { process.send?.({ type: 'wraith:linked', session: SESSION }); } catch {}
                startScheduler(sock);
                startPresenceHeartbeat(sock);
            }

            if (connection === 'close') {
                const statusCode =
                    lastDisconnect?.error instanceof Boom
                        ? lastDisconnect.error.output?.statusCode
                        : 0;

                if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                    console.log(TAG, red('👻 logged out · wiping this session'));
                    teardownSock();
                    try { fs.rmSync(AUTH_DIR, { recursive: true, force: true }); } catch {}
                    try { fs.mkdirSync(AUTH_DIR, { recursive: true }); } catch {}
                    console.log(TAG, yellow('👻 restarting into pairing mode…'));
                    isStarting = false;
                    reconnectAttempts = 0;
                    setTimeout(ignite, 1500);
                    return;
                }

                reconnectAttempts++;
                const baseDelay = CONFIG.reconnectDelay || 2000;
                const backoffDelay = Math.min(
                    baseDelay * Math.pow(2, reconnectAttempts - 1),
                    60000
                );

                console.log(TAG, yellow(`👻 reconnecting (${statusCode}) in ${backoffDelay/1000}s · attempt ${reconnectAttempts}`));
                teardownSock();
                await delay(backoffDelay);
                isStarting = false;
                ignite();
            }
        });

        sock.ev.on('creds.update', saveCreds);

        // ═════════════════════════════════════════
        //  MESSAGES.UPSERT
        // ═════════════════════════════════════════
        sock.ev.on('messages.upsert', async (u) => {
            trace('messages.upsert', {
                session: SESSION,
                type: u.type,
                count: u.messages?.length,
                firstKey: u.messages?.[0]?.key,
                firstMessageKeys: u.messages?.[0]?.message
                    ? Object.keys(u.messages[0].message)
                    : null
            });

            for (const m of u.messages || []) rememberMessage(m);

            for (const m of u.messages || []) {
                if (!m.message && !m.messageStubParameters) {
                    console.log(TAG, yellow(`[WRAITH] Incomplete message ${m.key?.id}, scheduling retry…`));
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
        //  MESSAGES.UPDATE
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

        sock.ev.on('messages.reaction', async (reactions) => {
            for (const r of reactions) {
                if (r.key?.remoteJid === 'status@broadcast') {
                    await dispatchStatus(sock, { reaction: r });
                }
            }
        });

    } catch (err) {
        isStarting = false;
        console.error(TAG, red('boot failure ·'), err.message);
        teardownSock();
        setTimeout(ignite, CONFIG.reconnectDelay);
    }
}

// ─────────────────────────────────────────────
//  Graceful shutdown
// ─────────────────────────────────────────────
function shutdown(signal) {
    console.log(grey(`\n👻 [${SESSION}] ${signal} received · shutting down…`));
    teardownSock();
    setTimeout(() => process.exit(0), 500);
}

process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException',  (e) => console.error(`[${SESSION}] uncaught ·`, e));
process.on('unhandledRejection', (e) => console.error(`[${SESSION}] unhandled ·`, e));

// ─────────────────────────────────────────────
//  Launch
// ─────────────────────────────────────────────
console.log(violet(`\n👻  ${CONFIG.codename} · booting…  session ${SESSION}\n`));
ignite();
