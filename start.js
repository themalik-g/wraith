// start.js — WRAITH per-session bot bootstrap
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

import { CONFIG, sessionStore, loadSessionConfig } from './config.js';
import { dispatch, dispatchStatus, dispatchUpdate } from './router.js';
import { trace } from './modules/debug.js';
import { startScheduler } from './modules/schedule.js';
import { startPresenceHeartbeat } from './modules/presence.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const log = pino({ level: 'silent' });

// ── terminal colors ──
const dye = (c, s) => `\x1b[${c}m${s}\x1b[0m`;
const grey = s => dye(90, s);
const cyan = s => dye(36, s);
const green = s => dye(32, s);
const yellow = s => dye(33, s);
const red = s => dye(31, s);
const violet = s => dye(35, s);
const bold = s => dye(1, s);

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

function printPairBanner(sessionId, code, number) {
  console.log();
  console.log(violet(` ╭─ ${sessionId} · pairing code ─────────────`));
  console.log(violet(' │ ') + grey('number  ') + cyan('+' + number));
  console.log(violet(' │ ') + grey('code    ') + bold(green(code)));
  console.log(violet(' │ ') + grey('how     ') + 'WhatsApp → Linked Devices → Link a Device');
  console.log(violet(' │ ') + grey('        ') + '→ "Link with phone number instead"');
  console.log(violet(' ╰───────────────────────────────────────'));
  console.log();
}

async function requestPairingCode(sock, sessionId, number, attempt = 0) {
  try {
    let code = await sock.requestPairingCode(number);
    code = code?.match(/.{1,4}/g)?.join('-') || code;
    printPairBanner(sessionId, code, number);
  } catch (err) {
    if (attempt < 4) {
      console.log(yellow(` ${sessionId}: pairing not ready (${err.message}) · retry ${attempt + 1}/4 in 5s`));
      setTimeout(() => requestPairingCode(sock, sessionId, number, attempt + 1), 5000);
    } else {
      console.log(red(` ${sessionId}: pairing failed — delete instances/${sessionId}/session and restart`));
    }
  }
}

export function startSession(sessionId, phoneNumber) {
  return new Promise(async (resolve) => {
    const instanceDir = path.join(here, 'instances', sessionId);
    const AUTH_DIR = path.join(instanceDir, 'session');
    const STATE_DIR = path.join(instanceDir, 'state');
    const OWNER_FILE = path.join(STATE_DIR, 'owner.json');

    fs.mkdirSync(AUTH_DIR, { recursive: true });
    fs.mkdirSync(STATE_DIR, { recursive: true });

    if (phoneNumber) {
      const digits = phoneNumber.replace(/\D/g, '');
      const pn = parsePhoneNumber('+' + digits);
      if (!pn?.valid) {
        console.log(red(` ${sessionId}: invalid number "${phoneNumber}"`));
        return;
      }
      fs.writeFileSync(OWNER_FILE, JSON.stringify({ owner: digits }, null, 2));
    }

    // ── load this session's own config (base + instances/<id>/state/config.json + owner.json) ──
    const sessionCfg = loadSessionConfig(sessionId);

    if (phoneNumber) {
      sessionCfg.owner = phoneNumber.replace(/\D/g, '');
    } else if (!sessionCfg.owner && fs.existsSync(OWNER_FILE)) {
      try {
        const saved = JSON.parse(fs.readFileSync(OWNER_FILE, 'utf-8')).owner;
        if (saved) sessionCfg.owner = saved;
      } catch {}
    }

    // ── ALS wrapper: every callback below runs with its OWN session context ──
    const run = (fn) => (...args) => sessionStore.run(sessionCfg, () => fn(...args));

    let resolved = false;
    let isStarting = false;
    let currentSock = null;
    let reconnectAttempts = 0;
    let pairingRequested = false;

    function teardownSock() {
      if (!currentSock) return;
      const s = currentSock;
      currentSock = null;
      try { s.ev.removeAllListeners('connection.update'); } catch {}
      try { s.ev.removeAllListeners('creds.update'); } catch {}
      try { s.ev.removeAllListeners('messages.upsert'); } catch {}
      try { s.ev.removeAllListeners('messages.update'); } catch {}
      try { s.ev.removeAllListeners('messages.delete'); } catch {}
      try { s.end(new Error('teardown')); } catch {}
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

      sock.ev.on('connection.update', run(async (u) => {
        const { connection, lastDisconnect, qr } = u;

        if (qr && !sock.authState.creds.registered && !pairingRequested) {
          pairingRequested = true;
          const number = sessionCfg.owner
            || (fs.existsSync(OWNER_FILE)
                ? JSON.parse(fs.readFileSync(OWNER_FILE, 'utf-8')).owner
                : null);
          if (number) {
            setTimeout(() => requestPairingCode(sock, sessionId, number), 800);
          } else {
            console.log(red(` ${sessionId}: no owner number available for pairing`));
          }
        }

        if (connection === 'connecting') {
          console.log(grey(` ${sessionId}: connecting…`));
        }

        if (connection === 'open') {
          isStarting = false;
          reconnectAttempts = 0;
          console.log(green(` ✓ ${sessionId} online as +${sock.user?.id?.split(':')[0]}`));
          try { startScheduler(sock); } catch {}
          try { startPresenceHeartbeat(sock); } catch {}

          if (!resolved) {
            resolved = true;
            resolve(sock);
          }
        }

        if (connection === 'close') {
          const statusCode = lastDisconnect?.error instanceof Boom
            ? lastDisconnect.error.output?.statusCode
            : 0;

          if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
            console.log(red(` ${sessionId}: logged out · wiping session`));
            teardownSock();
            try { fs.rmSync(AUTH_DIR, { recursive: true, force: true }); } catch {}
            try { fs.mkdirSync(AUTH_DIR, { recursive: true }); } catch {}
            pairingRequested = false;
            isStarting = false;
            reconnectAttempts = 0;
            setTimeout(ignite, 1500);
            return;
          }

          reconnectAttempts++;
          const base = sessionCfg.reconnectDelay || 2000;
          const waitMs = Math.min(base * Math.pow(2, reconnectAttempts - 1), 60000);
          console.log(yellow(` ${sessionId}: reconnecting (${statusCode}) in ${waitMs / 1000}s · attempt ${reconnectAttempts}`));
          teardownSock();
          await delay(waitMs);
          isStarting = false;
          ignite();
        }
      }));

      sock.ev.on('creds.update', run(saveCreds));

      sock.ev.on('messages.upsert', run(async (u) => {
        trace('messages.upsert', {
          session: sessionId,
          type: u.type,
          count: u.messages?.length
        });
        for (const m of u.messages || []) rememberMessage(m);
        await dispatch(sock, u, sessionId);
      }));

      sock.ev.on('messages.update', run((upd) => dispatchUpdate(sock, upd)));
      sock.ev.on('messages.delete', run((del) => dispatchStatus(sock, del)));

      sock.ev.on('group-participants.update', run(async (update) => {
        const mod = await import('./core/groupEvents.js').catch(() => null);
        if (mod?.handleGroupParticipantUpdate) {
          mod.handleGroupParticipantUpdate(sock, update);
        }
      }));

      sock.ev.on('status.update', run(async (st) => {
        try { dispatchStatus(sock, st); } catch {}
      }));

      const antiCallNotified = new Set();
      sock.ev.on('call', run(async (calls) => {
        try {
          const { readState } = await import('./commands/anticall.js').catch(() => ({}));
          if (!readState || !readState().enabled) return;
          for (const call of calls) {
            const caller = call.from || call.peerJid || call.chatId;
            if (!caller) continue;
            try {
              if (typeof sock.rejectCall === 'function' && call.id) {
                await sock.rejectCall(call.id, caller);
              }
            } catch {}
            if (!antiCallNotified.has(caller)) {
              antiCallNotified.add(caller);
              setTimeout(() => antiCallNotified.delete(caller), 60000);
              try {
                await sock.sendMessage(caller, {
                  text: '📵 Anticall is enabled. Your call was rejected and you will be blocked.'
                });
              } catch {}
            }
            setTimeout(async () => {
              try { await sock.updateBlockStatus(caller, 'block'); } catch {}
            }, 800);
          }
        } catch {}
      }));
    }

    await ignite();
  });
}
