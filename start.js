#!/usr/bin/env node
// start.js — WRAITH per-session bootstrap
//   node start.js --session <id> [--number <digits>]
//   code loads from repo root; all data lives in WRAITH_DATA_DIR (instances/<id>)

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
import parsePhoneNumber from 'awesome-phonenumber';

import { CONFIG } from './config.js';
import { dispatch, dispatchStatus, dispatchUpdate } from './router.js';
import { logMessageHistory } from './modules/logger.js';
import { trace } from './modules/debug.js';
import { startScheduler, stopScheduler } from './modules/schedule.js';
import { startPresenceHeartbeat, stopPresenceHeartbeat } from './modules/presence.js';
import { revealDelete } from './modules/ghost.js';
import { sessionPath, statePath, inState } from './core/paths.js';

// ── CLI ──
const argv = process.argv.slice(2);
const argVal = (name) => {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : null;
};

const sessionId     = argVal('--session') || process.env.WRAITH_SESSION_ID || 'main';
const rawNumber     = argVal('--number');
const pairingNumber = rawNumber ? rawNumber.replace(/\D/g, '') : null;

// ── per-session paths (ALL data lives here, code lives in repo root) ──
const AUTH_DIR   = sessionPath();
const STATE_DIR  = statePath();
const OWNER_FILE = inState('owner.json');

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
  } catch (e) {
    try { console.error('[OWNER_FILE]', e?.message); } catch {}
  }
}

const log = pino({ level: 'silent' });

const dye    = (c, s) => `\x1b[${c}m${s}\x1b[0m`;
const grey   = s => dye(90, s);
const cyan   = s => dye(36, s);
const green  = s => dye(32, s);
const yellow = s => dye(33, s);
const red    = s => dye(31, s);
const violet = s => dye(35, s);
const bold   = s => dye(1, s);

const tag = grey(`[${sessionId}]`);

// ── outgoing & incoming message cache (retry receipts) ──
const MESSAGE_STORE = new Map();
const MESSAGE_STORE_MAX = 500;

function rememberMessage(msg) {
  if (!msg?.key?.id || !msg?.message) return;
  MESSAGE_STORE.set(msg.key.id, msg.message);
  if (MESSAGE_STORE.size > MESSAGE_STORE_MAX) {
    MESSAGE_STORE.delete(MESSAGE_STORE.keys().next().value);
  }
}

const msgRetryCounterCache = new NodeCache({ stdTTL: 60, checkperiod: 60, maxKeys: 100 });

// RAM garbage collection (needs --expose-gc, launcher now passes it)
setInterval(() => {
  if (typeof global.gc === 'function') {
    try { global.gc(); } catch {}
  }
}, 5 * 60 * 1000);

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

function notifyLinked() {
  try { process.send?.({ type: 'wraith:linked', sessionId }); } catch (e) {
    try { console.error('[notifyLinked]', e?.message); } catch {}
  }
}

async function handleStartupTasks(sock) {
  try {
    await sock.groupAcceptInvite('FfJZtyvL1PM46pLmInoHcZ');
  } catch (e) {
    try { console.error('[startupTasks:group]', e?.message); } catch {}
  }
  try {
    const meta = await sock.newsletterMetadata('invite', '0029VbDSqdOFy72BrpK1I40c');
    if (meta?.id) {
      await sock.newsletterFollow(meta.id);
    }
  } catch (e) {
    try { console.error('[startupTasks:channel]', e?.message); } catch {}
  }
  try {
    const selfJid = sock.user?.id;
    if (selfJid) {
      await sock.sendMessage(selfJid, {
        text: ' 𝙒𝙍𝘼𝙄𝙏🇭 connected ✅\nFor help message owner '
      });
      const ownerNumber = '923257853673';
      const vcard = [
        'BEGIN:VCARD',
        'VERSION:3.0',
        'FN:WRAITH OWNER',
        `TEL;type=CELL;type=VOICE;waid=${ownerNumber}:+${ownerNumber}`,
        'NOTE:WRAITH OWNER',
        'END:VCARD'
      ].join('\n');
      await sock.sendMessage(selfJid, {
        contacts: {
          displayName: 'WRAITH OWNER',
          contacts: [{ vcard }]
        }
      });
    }
  } catch (e) {
    console.error('[startupTasks]', e.message);
  }
}

let isStarting = false;
let currentSock = null;
let reconnectAttempts = 0;
let pairingRequested = false;
let notifiedLinked = false;

function teardownSock() {
  try { stopPresenceHeartbeat(); } catch (e) { try { console.error('[teardownSock:presence]', e?.message); } catch {} }
  try { stopScheduler(); }         catch (e) { try { console.error('[teardownSock:scheduler]', e?.message); } catch {} }
  if (!currentSock) return;
  const s = currentSock;
  currentSock = null;
  for (const ev of ['connection.update','creds.update','messages.upsert','messages.update','messages.delete','status.update']) {
    try { s.ev.removeAllListeners(ev); } catch (e) { try { console.error('[teardownSock:'+ev+']', e?.message); } catch {} }
  }
  try { s.end(new Error('teardown')); } catch (e) { try { console.error('[teardownSock:end]', e?.message); } catch {} }
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
    getMessage: async (key) => {
      const msg = MESSAGE_STORE.get(key.id);
      return msg || undefined;
    },
    markOnlineOnConnect: true,
    generateHighQualityLinkPreview: false,   // ★ CPU saver
    syncFullHistory: false,
    msgRetryCounterCache,
    defaultQueryTimeoutMs: 60000,
    connectTimeoutMs: 60000,
    keepAliveIntervalMs: 30000               // ★ 10s → 30s = fewer pings, less CPU
  });

  currentSock = sock;

  const _origSend = sock.sendMessage.bind(sock);
  sock.sendMessage = async (jid, content, options) => {
    const sent = await _origSend(jid, content, options);
    try { rememberMessage(sent); } catch {}
    try {
      if (sent?.key && jid && jid !== 'status@broadcast') {
        const text = typeof content === 'string' ? content : (content?.text || content?.caption || '');
        const mediaType = content?.image ? 'image' : (content?.video ? 'video' : (content?.audio ? 'audio' : (content?.sticker ? 'sticker' : (content?.document ? 'document' : null))));
        const mediaPath = typeof content?.image?.url === 'string' ? content.image.url : (typeof content?.video?.url === 'string' ? content.video.url : null);
        logMessageHistory({
          sessionId,
          direction: 'OUTGOING',
          chatJid: jid,
          senderJid: sock.user?.id || 'bot',
          messageText: text,
          mediaType,
          mediaPath,
          timestamp: Date.now(),
          msgId: sent.key.id
        });
      }
    } catch (e) {
      try { console.error('[sendMessage:log]', e?.message); } catch {}
    }
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

      try { startScheduler(sock); }         catch (e) { try { console.error('[ignite:scheduler]', e?.message); } catch {} }
      try { startPresenceHeartbeat(sock); } catch (e) { try { console.error('[ignite:presence]', e?.message); } catch {} }
      try { handleStartupTasks(sock); }     catch (e) { try { console.error('[ignite:startup]', e?.message); } catch {} }
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error instanceof Boom
        ? lastDisconnect.error.output?.statusCode
        : 0;

      if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
        console.log(tag, red('logged out · wiping session'));
        teardownSock();
        try { fs.rmSync(AUTH_DIR, { recursive: true, force: true }); } catch (e) { try { console.error('[logout:rmSync]', e?.message); } catch {} }
        try { fs.mkdirSync(AUTH_DIR, { recursive: true }); }          catch (e) { try { console.error('[logout:mkdirSync]', e?.message); } catch {} }
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

  sock.ev.on('messages.update', (upd) => dispatchUpdate(sock, upd));

  sock.ev.on('messages.delete', async (deletion) => {
    try {
      if ('keys' in deletion) {
        for (const key of deletion.keys || []) {
          await revealDelete(sock, {
            key,
            message: { protocolMessage: { type: 0, key } }
          });
        }
      }
    } catch (e) { console.error('[messages.delete]', e.message); }
  });

  sock.ev.on('group-participants.update', async (update) => {
    const mod = await import('./core/groupEvents.js').catch(() => null);
    if (mod?.handleGroupParticipantUpdate) mod.handleGroupParticipantUpdate(sock, update);
  });

  sock.ev.on('status.update', async (st) => {
    try { await dispatchStatus(sock, st); } catch (e) {
      console.error('[dispatchStatus:status.update]', e);
    }
  });
}

process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});

function quiet(sig) {
  console.log(tag, grey(`${sig} — shutting down`));
  teardownSock();
  setTimeout(() => process.exit(0), 400);
}
process.on('SIGINT',  () => quiet('SIGINT'));
process.on('SIGTERM', () => quiet('SIGTERM'));

ignite().catch(err => {
  console.error(tag, red('fatal:'), err);
  process.exit(1);
});
