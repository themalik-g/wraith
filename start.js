#!/usr/bin/env node
// start.js — WRAITH per-session bootstrap
//
//   invoked by the VPS launcher as:
//     node --preserve-symlinks --preserve-symlinks-main start.js \
//          --session <id> [--number <digits>]
//
//   cwd = instances/<id>/
//   session/, state/, vault/ are REAL folders (private per number)
//   everything else is a symlink back into the shared repo

import makeWASocket, {
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
  DisconnectReason,
  Browsers,
  delay
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import NodeCache from '@cacheable/node-cache';
import pino from 'pino';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import parsePhoneNumber from 'awesome-phonenumber';

import { CONFIG } from './config.js';
import { dispatch, dispatchStatus, dispatchUpdate } from './router.js';
import { trace } from './modules/debug.js';
import { startScheduler } from './modules/schedule.js';
import { startPresenceHeartbeat } from './modules/presence.js';

const here = path.dirname(fileURLToPath(import.meta.url));

// ── CLI ──
const argv = process.argv.slice(2);
const argVal = (name) => {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : null;
};

const sessionId     = argVal('--session') || process.env.WRAITH_SESSION_ID || 'main';
const rawNumber     = argVal('--number');
const pairingNumber = rawNumber ? rawNumber.replace(/\D/g, '') : null;

// ── per-session paths ──
const AUTH_DIR   = path.join(here, 'session');
const STATE_DIR  = path.join(here, 'state');
const OWNER_FILE = path.join(STATE_DIR, 'owner.json');

fs.mkdirSync(AUTH_DIR,  { recursive: true });
fs.mkdirSync(STATE_DIR, { recursive: true });

// persist this session's own owner + expose it to config.js
if (pairingNumber) {
  const pn = parsePhoneNumber('+' + pairingNumber);
  if (!pn?.valid) {
    console.error(`[${sessionId}] invalid number: ${rawNumber}`);
    process.exit(1);
  }
  fs.writeFileSync(OWNER_FILE, JSON.stringify({ owner: pairingNumber }, null, 2));
  CONFIG.owner = pairingNumber;
} else if (!CONFIG.owner && fs.existsSync(OWNER_FILE)) {
  try {
    const saved = JSON.parse(fs.readFileSync(OWNER_FILE, 'utf-8')).owner;
    if (saved) CONFIG.owner = saved;
  } catch {}
}

const log = pino({ level: 'silent' });

// ── terminal dye ──
const dye    = (c, s) => `\x1b[${c}m${s}\x1b[0m`;
const grey   = s => dye(90, s);
const cyan   = s => dye(36, s);
const green  = s => dye(32, s);
const yellow = s => dye(33, s);
const red    = s => dye(31, s);
const violet = s => dye(35, s);
const bold   = s => dye(1, s);

const tag = grey(`[${sessionId}]`);

// ── outgoing message cache (retry receipts) ──
const MESSAGE_STORE = new Map();
const MESSAGE_STORE_MAX = 1000;
function rememberMessage(msg) {
  if (!msg?.key?.id || !msg?.message) return;
  MESSAGE_STORE.set(msg.key.id, msg.message);
  if (MESSAGE_STORE.size > MESSAGE_STORE_MAX) {
    MESSAGE_STORE.delete(MESSAGE_STORE.keys().next().value);
  }
}

const msgRetryCounterCache = new NodeCache({ stdTTL: 100, checkperiod: 120 });

// ── pairing banner ──
function printPairBanner(code, number) {
  console.log();
  console.log(violet(` ╭─ ${sessionId} · pairing code ─────────────`));
  console.log(violet(' │ ') + grey('number  ') + cyan('+' + number));
  console.log(violet(' │ ') + grey('code    ') + bold(green(code)));
  console.log(violet(' │ ') + grey('how     ') + 'WhatsApp → Linked Devices → Link a Device');
  console.log(violet(' │ ') + grey('        ') + '→ "Link with phone number instead"');
  console.log(violet(' ╰───────────────────────────────────────'));
  console.log();
}

async function requestPairingCode(sock, number, attempt = 0) {
  try {
    let code = await sock.requestPairingCode(number);
    code = code?.match(/.{1,4}/g)?.join('-') || code;
    printPairBanner(code, number);
  } catch (err) {
    if (attempt < 4) {
      console.log(tag, yellow(`pairing not ready (${err.message}) · retry ${attempt + 1}/4 in 5s`));
      setTimeout(() => requestPairingCode(sock, number, attempt + 1), 5000);
    } else {
      console.log(tag, red(`pairing failed · delete ${AUTH_DIR} and restart`));
    }
  }
}

// ── IPC notify — the launcher waits for { type: 'wraith:linked' } ──
function notifyLinked() {
  try { process.send?.({ type: 'wraith:linked', sessionId }); } catch {}
}

// ── state ──
let isStarting = false;
let currentSock = null;
let reconnectAttempts = 0;
let pairingRequested = false;
let notifiedLinked = false;

function teardownSock() {
  if (!currentSock) return;
  const s = currentSock;
  currentSock = null;
  try { s.ev.removeAllListeners('connection.update'); } catch {}
  try { s.ev.removeAllListeners('creds.update');      } catch {}
  try { s.ev.removeAllListeners('messages.upsert');   } catch {}
  try { s.ev.removeAllListeners('messages.update');   } catch {}
  try { s.ev.removeAllListeners('messages.delete');   } catch {}
  try { s.ev.removeAllListeners('status.update');     } catch {}
  try { s.end(new Error('teardown'));                 } catch {}
}

async function ignite() {
  if (isStarting) return;
  isStarting = true;

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger: log,
    printQRInTerminal: false,
    browser: Browsers.ubuntu('Chrome'),
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, log)
    },
    markOnlineOnConnect: true,
    generateHighQualityLinkPreview: true,
    syncFullHistory: false,
    msgRetryCounterCache,
    defaultQueryTimeoutMs: 60000,
    connectTimeoutMs: 60000,
    keepAliveIntervalMs: 10000
  });

  currentSock = sock;

  const _origSend = sock.sendMessage.bind(sock);
  sock.sendMessage = async (jid, content, options) => {
    const sent = await _origSend(jid, content, options);
    try { rememberMessage(sent); } catch {}
    return sent;
  };

  sock.ev.on('connection.update', async (u) => {
    const { connection, lastDisconnect, qr } = u;

    if (qr && !sock.authState.creds.registered && !pairingRequested) {
      pairingRequested = true;
      const number = pairingNumber || CONFIG.owner || null;
      if (number) {
        setTimeout(() => requestPairingCode(sock, number), 800);
      } else {
        console.log(tag, red('no phone number available for pairing'));
      }
    }

    if (connection === 'connecting') {
      console.log(tag, grey('connecting…'));
    }

    if (connection === 'open') {
      isStarting = false;
      reconnectAttempts = 0;
      console.log(tag, green(`online as +${sock.user?.id?.split(':')[0]}`));

      if (pairingNumber && !notifiedLinked) {
        notifiedLinked = true;
        notifyLinked();
      }

      try { startScheduler(sock); }         catch {}
      try { startPresenceHeartbeat(sock); } catch {}
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error instanceof Boom
        ? lastDisconnect.error.output?.statusCode
        : 0;

      if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
        console.log(tag, red('logged out · wiping session'));
        teardownSock();
        try { fs.rmSync(AUTH_DIR, { recursive: true, force: true }); } catch {}
        try { fs.mkdirSync(AUTH_DIR, { recursive: true }); }          catch {}
        pairingRequested = false;
        notifiedLinked   = false;
        isStarting = false;
        reconnectAttempts = 0;
        setTimeout(ignite, 1500);
        return;
      }

      reconnectAttempts++;
      const base   = CONFIG.reconnectDelay || 2000;
      const waitMs = Math.min(base * Math.pow(2, reconnectAttempts - 1), 60000);
      console.log(tag, yellow(`reconnecting (${statusCode}) in ${waitMs / 1000}s · attempt ${reconnectAttempts}`));
      teardownSock();
      await delay(waitMs);
      isStarting = false;
      ignite();
    }
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messages.upsert', async (u) => {
    trace('messages.upsert', { session: sessionId, type: u.type, count: u.messages?.length });
    for (const m of u.messages || []) rememberMessage(m);

    try {
      if ((u.messages || []).some(m => m?.key?.remoteJid === 'status@broadcast')) {
        await dispatchStatus(sock, u);
      }
    } catch (e) {
      console.error('[dispatchStatus:upsert]', e);
    }

    await dispatch(sock, u, sessionId);
  });

  // ★ FIXED in router: dispatchUpdate now handles the ARRAY Baileys emits
  sock.ev.on('messages.update', (upd) => dispatchUpdate(sock, upd));

  // ★ welcome/goodbye — core/groupEvents.js (created in round 1)
  sock.ev.on('group-participants.update', async (update) => {
    const mod = await import('./core/groupEvents.js').catch(() => null);
    if (mod?.handleGroupParticipantUpdate) mod.handleGroupParticipantUpdate(sock, update);
  });

  // ★ REMOVED: dead `commands/anticall.js` block (feature lives in modules/group.js)
  // ★ REMOVED: wrong `messages.delete → dispatchStatus` wiring (lurk handles its own events)

  sock.ev.on('status.update', async (st) => {
    try { await dispatchStatus(sock, st); } catch (e) {
      console.error('[dispatchStatus:status.update]', e);
    }
  });
}

// ── graceful shutdown ──
function quiet(sig) {
  console.log(tag, grey(`${sig} — shutting down`));
  teardownSock();
  setTimeout(() => process.exit(0), 400);
}
process.on('SIGINT',  () => quiet('SIGINT'));
process.on('SIGTERM', () => quiet('SIGTERM'));

// ── go ──
ignite().catch(err => {
  console.error(tag, red('fatal:'), err);
  process.exit(1);
});
