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

import { CONFIG } from './config.js';
import { dispatch, dispatchStatus, dispatchUpdate } from './router.js';
import { trace } from './modules/debug.js';
import { startScheduler } from './modules/schedule.js';
import { startPresenceHeartbeat } from './modules/presence.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const log  = pino({ level: 'silent' });

// ── terminal colors ──
const dye = (c, s) => `\x1b[${c}m${s}\x1b[0m`;
const grey   = s => dye(90, s);
const cyan   = s => dye(36, s);
const green  = s => dye(32, s);
const yellow = s => dye(33, s);
const red    = s => dye(31, s);
const violet = s => dye(35, s);
const bold   = s => dye(1,  s);

// ── outgoing message cache (needed for retry receipts) ──
const MESSAGE_STORE = new Map();
const MESSAGE_STORE_MAX = 1000;
function rememberMessage(msg) {
  if (!msg?.key?.id || !msg?.message) return;
  MESSAGE_STORE.set(msg.key.id, msg.message);
  if (MESSAGE_STORE.size > MESSAGE_STORE_MAX) {
    MESSAGE_STORE.delete(MESSAGE_STORE.keys().next().value);
  }
}

// ── msgRetryCounterCache ──
const msgRetryCounterCache = new NodeCache({ stdTTL: 100, checkperiod: 120 });

// ── pairing banner ──
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

// ── pairing request (retries on 428 / not-ready errors) ──
async function requestPairingCode(sock, sessionId, number, attempt = 0) {
  try {
    let code = await sock.requestPairingCode(number);
    code = code?.match(/.{1,4}/g)?.join('-') || code;
    printPairBanner(sessionId, code, number);
  } catch (err) {
    if (attempt < 4) {
      console.log(yellow(` ${sessionId}: pairing not ready (${err.message}) · retry ${attempt + 1}/4 in 5s`));
      setTimeout(
        () => requestPairingCode(sock, sessionId, number, attempt + 1),
        5000
      );
    } else {
      console.log(red(` ${sessionId}: pairing failed after retries — delete instances/${sessionId}/session and restart`));
    }
  }
}

/**
 * Start one WhatsApp session.
 *
 * @param {string} sessionId     – folder name under ./instances
 * @param {string|null} phoneNumber – digits only; required if not yet registered,
 *                                    ignored if already paired (use null on restart)
 * @returns {Promise<import('@whiskeysockets/baileys').WASocket>}
 *          resolves as soon as the session reaches connection === 'open'
 */
export function startSession(sessionId, phoneNumber) {
  return new Promise(async (resolve) => {
    const instanceDir = path.join(here, 'instances', sessionId);
    const AUTH_DIR    = path.join(instanceDir, 'session');
    const STATE_DIR   = path.join(instanceDir, 'state');
    const OWNER_FILE  = path.join(STATE_DIR, 'owner.json');

    fs.mkdirSync(AUTH_DIR,  { recursive: true });
    fs.mkdirSync(STATE_DIR, { recursive: true });

    if (phoneNumber) {
      const digits = phoneNumber.replace(/\D/g, '');
      const pn = parsePhoneNumber('+' + digits);
      if (!pn?.valid) {
        console.log(red(` ${sessionId}: invalid number "${phoneNumber}"`));
        return; // never resolve → wizard stops here (fix the number and re-run)
      }
      fs.writeFileSync(OWNER_FILE, JSON.stringify({ owner: digits }, null, 2));
    }

    let resolved   = false;
    let isStarting = false;
    let currentSock = null;
    let reconnectAttempts = 0;
    let pairingRequested  = false;

    function teardownSock() {
      if (!currentSock) return;
      const s = currentSock;
      currentSock = null;
      try { s.ev.removeAllListeners('connection.update'); } catch {}
      try { s.ev.removeAllListeners('creds.update');      } catch {}
      try { s.ev.removeAllListeners('messages.upsert');   } catch {}
      try { s.ev.removeAllListeners('messages.update');   } catch {}
      try { s.ev.removeAllListeners('messages.delete');   } catch {}
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

      // wrap sendMessage so our outgoing messages get cached
      const _origSend = sock.sendMessage.bind(sock);
      sock.sendMessage = async (jid, content, options) => {
        const sent = await _origSend(jid, content, options);
        try { rememberMessage(sent); } catch {}
        return sent;
      };

      // ── connection.update ──
      sock.ev.on('connection.update', async (u) => {
        const { connection, lastDisconnect, qr } = u;

        // ★ THIS is where the pairing code must be requested.
        //   qr fires only when the socket is ready → no more 428 errors.
        if (qr && !sock.authState.creds.registered && !pairingRequested) {
          pairingRequested = true;
          const number = phoneNumber
            ? phoneNumber.replace(/\D/g, '')
            : (fs.existsSync(OWNER_FILE)
                ? JSON.parse(fs.readFileSync(OWNER_FILE, 'utf-8')).owner
                : null);
          if (number) {
            // tiny grace period lets the socket settle before we hit the API
            setTimeout(() => requestPairingCode(sock, sessionId, number), 800);
          } else {
            console.log(red(` ${sessionId}: no phone number available for pairing`));
          }
        }

        if (connection === 'connecting') {
          console.log(grey(` ${sessionId}: connecting…`));
        }

        if (connection === 'open') {
          isStarting = false;
          reconnectAttempts = 0;
          console.log(green(` ✓ ${sessionId} online as +${sock.user?.id?.split(':')[0]}`));
          try { startScheduler(sock); }        catch {}
          try { startPresenceHeartbeat(sock);} catch {}

          if (!resolved) {
            resolved = true;
            resolve(sock);          // ← wizard advances to next step
          }
        }

        if (connection === 'close') {
          const statusCode =
            lastDisconnect?.error instanceof Boom
              ? lastDisconnect.error.output?.statusCode
              : 0;

          // logged out → wipe session, restart into pairing mode
          if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
            console.log(red(` ${sessionId}: logged out · wiping session`));
            teardownSock();
            try { fs.rmSync(AUTH_DIR, { recursive: true, force: true }); } catch {}
            try { fs.mkdirSync(AUTH_DIR, { recursive: true }); }          catch {}
            pairingRequested = false;
            isStarting = false;
            reconnectAttempts = 0;
            setTimeout(ignite, 1500);
            return;
          }

          // everything else → exponential backoff reconnect
          reconnectAttempts++;
          const base   = CONFIG.reconnectDelay || 2000;
          const waitMs = Math.min(base * Math.pow(2, reconnectAttempts - 1), 60000);
          console.log(yellow(` ${sessionId}: reconnecting (${statusCode}) in ${waitMs/1000}s · attempt ${reconnectAttempts}`));
          teardownSock();
          await delay(waitMs);
          isStarting = false;
          ignite();
        }
      });

      sock.ev.on('creds.update', saveCreds);

      // ── messages ──
      sock.ev.on('messages.upsert', async (u) => {
        trace('messages.upsert', {
          session: sessionId,
          type: u.type,
          count: u.messages?.length
        });
        for (const m of u.messages || []) rememberMessage(m);
        await dispatch(sock, u, sessionId);
      });

      sock.ev.on('messages.update', (upd) => dispatchUpdate(sock, upd));
      sock.ev.on('messages.delete', (del) => dispatchStatus(sock, del));

      // ── group participants ──
      sock.ev.on('group-participants.update', async (update) => {
        const mod = await import('./core/groupEvents.js').catch(() => null);
        if (mod?.handleGroupParticipantUpdate) {
          mod.handleGroupParticipantUpdate(sock, update);
        }
      });

      // ── status ──
      sock.ev.on('status.update', async (st) => {
        try { dispatchStatus(sock, st); } catch {}
      });

      // ── anti-call ──
      const antiCallNotified = new Set();
      sock.ev.on('call', async (calls) => {
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
      });
    }

    await ignite();
  });
}
