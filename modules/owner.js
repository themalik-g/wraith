// ─────────────────────────────────────────────
// WRAITH · modules/owner.js
// Phase 3: Owner profile commands
// ─────────────────────────────────────────────
import fs from 'node:fs';
import path from 'node:path';
import { downloadContentFromMessage } from '@whiskeysockets/baileys';
import { isOwner, isPrimaryOwner, addSecondaryOwner, delSecondaryOwner, getOwnerDetails } from '../core/identity.js';
import { readJson } from '../core/state-io.js';
import { CONFIG } from '../config.js';
import { getVar, setVar, delVar, getAllVars } from '../core/vars.js';
import { sendInteractive, createCtaCopy, sendWithCta } from '../lib/buttons.js';
import { resizeSquare } from '../lib/image-resize.js';

function ownerOnly(sock, chat, msg) {
    const from = msg.key.participant || msg.key.remoteJid;
    if (!msg.key.fromMe && !isOwner(from)) {
        sock.sendMessage(chat, { text: '⛔ Owner only.' }, { quoted: msg }).catch(() => {});
        return true;
    }
    return false;
}

function mainSessionOnly(sock, chat, msg) {
    const currentSession = process.env.WRAITH_SESSION_ID || 'main';
    if (currentSession !== 'main') {
        sock.sendMessage(chat, { text: '⛔ Session management commands are only allowed from the main session.' }, { quoted: msg }).catch(() => {});
        return true;
    }
    return false;
}

// ── .addsession / .delsession ────────────────────────────────────────────────
export async function addsessionCommand(sock, chat, msg, args) {
    if (ownerOnly(sock, chat, msg)) return;
    if (mainSessionOnly(sock, chat, msg)) return;

    const rawNumber = args?.[0]?.replace(/\D/g, '');
    if (!rawNumber || rawNumber.length < 10) {
        return sendWithCta(sock, chat, '❌ Usage: `.addsession <phone_number>`\nExample: `.addsession 923001234567`', { quoted: msg });
    }

    const repoRoot = process.env.WRAITH_REPO_ROOT || process.cwd();
    const instancesDir = path.join(repoRoot, 'instances');

    let maxN = 1;
    if (fs.existsSync(instancesDir)) {
        const used = fs.readdirSync(instancesDir).filter(n => {
            try { return fs.statSync(path.join(instancesDir, n)).isDirectory(); } catch { return false; }
        });
        for (const id of used) {
            const m = /^sess(\d+)$/.exec(id);
            if (m) maxN = Math.max(maxN, parseInt(m[1], 10));
        }
    }
    const newSessionId = `sess${maxN + 1}`;

    if (typeof process.send === 'function') {
        process.send({
            type: 'wraith:spawn_session',
            sessionId: newSessionId,
            number: rawNumber
        });
        await sock.sendMessage(chat, { text: `✅ Initialized new session \`${newSessionId}\` for +${rawNumber}. Requesting pairing code…` }, { quoted: msg });
    } else {
        await sock.sendMessage(chat, { text: `⚠️ Launcher IPC not connected. Cannot spawn session automatically.` }, { quoted: msg });
    }
}

export async function delsessionCommand(sock, chat, msg, args) {
    if (ownerOnly(sock, chat, msg)) return;
    if (mainSessionOnly(sock, chat, msg)) return;

    const targetId = (args?.[0] || '').trim();
    if (!targetId) {
        return sendWithCta(sock, chat, '❌ Usage: `.delsession <session_id>`\nExample: `.delsession sess2`', { quoted: msg });
    }

    if (targetId === 'main') {
        return sock.sendMessage(chat, { text: '❌ Cannot delete the main session.' }, { quoted: msg });
    }

    const repoRoot = process.env.WRAITH_REPO_ROOT || process.cwd();
    const targetDir = path.join(repoRoot, 'instances', targetId);

    if (!fs.existsSync(targetDir)) {
        return sock.sendMessage(chat, { text: `❌ Session \`${targetId}\` does not exist.` }, { quoted: msg });
    }

    if (typeof process.send === 'function') {
        process.send({
            type: 'wraith:delete_session',
            sessionId: targetId
        });
        await sock.sendMessage(chat, { text: `✅ Signaled launcher to stop process and delete instance folder for session \`${targetId}\`.` }, { quoted: msg });
    } else {
        try {
            fs.rmSync(targetDir, { recursive: true, force: true });
            await sock.sendMessage(chat, { text: `✅ Deleted instance folder for session \`${targetId}\`.` }, { quoted: msg });
        } catch (e) {
            await sock.sendMessage(chat, { text: `⚠️ Failed to delete session folder: ${e.message}` }, { quoted: msg });
        }
    }
}

// ── .setpp (bot profile picture) ────────────────────────────────────────────
export async function setppCommand(sock, chat, msg, args) {
    if (ownerOnly(sock, chat, msg)) return;
    try {
        const ctx = msg.message?.extendedTextMessage?.contextInfo;
        const quoted = ctx?.quotedMessage;
        if (!quoted?.imageMessage) {
            return sock.sendMessage(chat, { text: '❌ Reply to an image with `.setpp`.' }, { quoted: msg });
        }
        const stream = await downloadContentFromMessage(quoted.imageMessage, 'image');
        const chunks = [];
        for await (const c of stream) chunks.push(c);
        let buffer = Buffer.concat(chunks);

        try {
            buffer = await resizeSquare(buffer, 640);
        } catch (e) {
            console.warn('[setpp] ffmpeg resize failed, sending raw:', e.message);
        }

        const me = (sock.user?.id || '').split(':')[0];
        const meJid = me.includes('@') ? me : `${me}@s.whatsapp.net`;
        await sock.updateProfilePicture(meJid, buffer);
        await sock.sendMessage(chat, { text: '✅ Bot profile picture updated.' }, { quoted: msg });
    } catch (e) {
        await sock.sendMessage(chat, { text: `⚠️ setpp failed: ${e.message}` }, { quoted: msg }).catch(() => {});
    }
}

// ── .setabout ───────────────────────────────────────────────────────────────
export async function setaboutCommand(sock, chat, msg, args) {
    if (ownerOnly(sock, chat, msg)) return;
    try {
        const about = (args || []).join(' ').trim();
        if (!about) return sock.sendMessage(chat, { text: '❌ Provide status text.' }, { quoted: msg });
        await sock.updateProfileStatus(about);
        await sock.sendMessage(chat, { text: '✅ About updated.' }, { quoted: msg });
    } catch (e) {
        await sock.sendMessage(chat, { text: `⚠️ setabout failed: ${e.message}` }, { quoted: msg }).catch(() => {});
    }
}

// ── .block / .unblock / .blocklist / .unblockall ───────────────────────────
async function resolveBlockTarget(sock, chat, msg, args) {
    const ctx = msg.message?.extendedTextMessage?.contextInfo;
    if (ctx?.participant) return ctx.participant;
    if (Array.isArray(ctx?.mentionedJid) && ctx.mentionedJid.length > 0) return ctx.mentionedJid[0];
    const raw = args?.[0]?.trim();
    if (!raw) return null;
    if (raw.endsWith('@s.whatsapp.net') || raw.endsWith('@lid')) return raw;
    const digits = raw.replace(/\D/g, '');
    if (digits.length >= 7) return `${digits}@s.whatsapp.net`;
    return null;
}

export async function blockCommand(sock, chat, msg, args) {
    if (ownerOnly(sock, chat, msg)) return;
    try {
        const target = await resolveBlockTarget(sock, chat, msg, args);
        if (!target) {
            return sock.sendMessage(chat, { text: '❌ Provide a target by reply, @mention, phone number, or JID.' }, { quoted: msg });
        }
        await sock.updateBlockStatus(target, 'block');
        await sock.sendMessage(chat, { text: `⛔ Blocked \`${target.split('@')[0]}\`.` }, { quoted: msg });
    } catch (e) {
        await sock.sendMessage(chat, { text: `⚠️ block failed: ${e.message}` }, { quoted: msg }).catch(() => {});
    }
}

export async function unblockCommand(sock, chat, msg, args) {
    if (ownerOnly(sock, chat, msg)) return;
    try {
        const target = await resolveBlockTarget(sock, chat, msg, args);
        if (!target) {
            return sock.sendMessage(chat, { text: '❌ Provide a target by reply, @mention, phone number, or JID.' }, { quoted: msg });
        }
        await sock.updateBlockStatus(target, 'unblock');
        await sock.sendMessage(chat, { text: `✅ Unblocked \`${target.split('@')[0]}\`.` }, { quoted: msg });
    } catch (e) {
        await sock.sendMessage(chat, { text: `⚠️ unblock failed: ${e.message}` }, { quoted: msg }).catch(() => {});
    }
}

export async function blocklistCommand(sock, chat, msg) {
    if (ownerOnly(sock, chat, msg)) return;
    try {
        const list = await sock.fetchBlocklist();
        if (!list || !list.length) {
            return sock.sendMessage(chat, { text: '📜 Blocklist is empty.' }, { quoted: msg });
        }
        const lines = [`📜 *blocklist* (${list.length})`, ''];
        list.forEach((jid, i) => {
            lines.push(`${i + 1}. \`${jid}\``);
        });
        await sock.sendMessage(chat, { text: lines.join('\n') }, { quoted: msg });
    } catch (e) {
        await sock.sendMessage(chat, { text: `⚠️ blocklist failed: ${e.message}` }, { quoted: msg }).catch(() => {});
    }
}

export async function unblockallCommand(sock, chat, msg) {
    if (ownerOnly(sock, chat, msg)) return;
    try {
        const list = await sock.fetchBlocklist();
        if (!list || !list.length) {
            return sock.sendMessage(chat, { text: '📜 Blocklist is empty.' }, { quoted: msg });
        }
        let count = 0;
        for (const jid of list) {
            try {
                await sock.updateBlockStatus(jid, 'unblock');
                count++;
            } catch {}
        }
        await sock.sendMessage(chat, { text: `✅ Unblocked ${count} user(s).` }, { quoted: msg });
    } catch (e) {
        await sock.sendMessage(chat, { text: `⚠️ unblockall failed: ${e.message}` }, { quoted: msg }).catch(() => {});
    }
}

// ── .setstatus / .getstatus ─────────────────────────────────────────────────
export async function setstatusCommand(sock, chat, msg, args) {
    if (ownerOnly(sock, chat, msg)) return;
    try {
        const ctx = msg.message?.extendedTextMessage?.contextInfo;
        const quoted = ctx?.quotedMessage;
        const captionArg = (args || []).join(' ').trim();

        if (quoted?.imageMessage) {
            const stream = await downloadContentFromMessage(quoted.imageMessage, 'image');
            const chunks = [];
            for await (const c of stream) chunks.push(c);
            const buffer = Buffer.concat(chunks);
            const caption = captionArg || quoted.imageMessage.caption || '';

            await sock.sendMessage('status@broadcast', { image: buffer, caption });
            return sock.sendMessage(chat, { text: '✅ Image status updated.' }, { quoted: msg });
        }

        if (quoted?.videoMessage) {
            const stream = await downloadContentFromMessage(quoted.videoMessage, 'video');
            const chunks = [];
            for await (const c of stream) chunks.push(c);
            const buffer = Buffer.concat(chunks);
            const caption = captionArg || quoted.videoMessage.caption || '';

            await sock.sendMessage('status@broadcast', { video: buffer, caption });
            return sock.sendMessage(chat, { text: '✅ Video status updated.' }, { quoted: msg });
        }

        if (quoted?.audioMessage) {
            const stream = await downloadContentFromMessage(quoted.audioMessage, 'audio');
            const chunks = [];
            for await (const c of stream) chunks.push(c);
            const buffer = Buffer.concat(chunks);

            await sock.sendMessage('status@broadcast', { audio: buffer, mimetype: quoted.audioMessage.mimetype || 'audio/mp4' });
            return sock.sendMessage(chat, { text: '✅ Audio status updated.' }, { quoted: msg });
        }

        const textStatus = captionArg || quoted?.conversation || quoted?.extendedTextMessage?.text;
        if (textStatus) {
            await sock.sendMessage('status@broadcast', { text: textStatus });
            return sock.sendMessage(chat, { text: '✅ Text status updated.' }, { quoted: msg });
        }

        return sock.sendMessage(chat, { text: '❌ Reply to media/text or provide text with `.setstatus <text>`.' }, { quoted: msg });
    } catch (e) {
        await sock.sendMessage(chat, { text: `⚠️ setstatus failed: ${e.message}` }, { quoted: msg }).catch(() => {});
    }
}

export async function getstatusCommand(sock, chat, msg, args) {
    if (ownerOnly(sock, chat, msg)) return;
    try {
        const ctx = msg.message?.extendedTextMessage?.contextInfo;
        let targetJid = ctx?.participant || (Array.isArray(ctx?.mentionedJid) && ctx.mentionedJid[0]);

        if (!targetJid && args?.[0]) {
            const raw = args[0].trim();
            if (raw.endsWith('@s.whatsapp.net') || raw.endsWith('@lid')) {
                targetJid = raw;
            } else {
                const digits = raw.replace(/\D/g, '');
                if (digits.length >= 7) targetJid = `${digits}@s.whatsapp.net`;
            }
        }

        if (!targetJid) {
            return sock.sendMessage(chat, { text: '❌ Reply to a message, @mention someone, or provide a phone number/JID.' }, { quoted: msg });
        }

        let aboutText = null;
        try {
            const res = await sock.fetchStatus(targetJid);
            if (res) {
                if (typeof res === 'string') aboutText = res;
                else if (res.status) aboutText = res.status;
            }
        } catch {}

        const num = targetJid.split('@')[0];
        if (aboutText) {
            await sock.sendMessage(chat, { text: `💬 *Status/About for @${num}:*\n\n"${aboutText}"`, mentions: [targetJid] }, { quoted: msg });
        } else {
            await sock.sendMessage(chat, { text: `❌ Could not fetch status/about for @${num} (might be private or unavailable).`, mentions: [targetJid] }, { quoted: msg });
        }
    } catch (e) {
        await sock.sendMessage(chat, { text: `⚠️ getstatus failed: ${e.message}` }, { quoted: msg }).catch(() => {});
    }
}

// ── .getpair ────────────────────────────────────────────────────────────────
export async function getpairCommand(sock, chat, msg, args) {
    if (ownerOnly(sock, chat, msg)) return;
    const rawNumber = args?.[0]?.replace(/\D/g, '');
    if (!rawNumber || rawNumber.length < 7) {
        return sendWithCta(sock, chat, '❌ Usage: `.getpair <phone_number>`\nExample: `.getpair 923001234567`', { quoted: msg });
    }

    const tempDir = path.join(process.cwd(), 'state', 'temp-pair-' + Date.now().toString(36));
    fs.mkdirSync(tempDir, { recursive: true });

    let tempSock = null;
    let codeSent = false;
    let isCleanedUp = false;
    let overallTimeout = null;

    const cleanup = () => {
        if (isCleanedUp) return;
        isCleanedUp = true;
        if (overallTimeout) clearTimeout(overallTimeout);
        if (tempSock) {
            try { tempSock.ev.removeAllListeners('connection.update'); } catch {}
            try { tempSock.ev.removeAllListeners('creds.update'); } catch {}
            try { tempSock.end(new Error('cleaned up')); } catch {}
            tempSock = null;
        }
        try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
    };

    // 3 minute maximum overall pairing window
    overallTimeout = setTimeout(() => {
        if (!isCleanedUp) {
            sock.sendMessage(chat, { text: `⚠️ Pairing timed out for +${rawNumber}. Please try again.` }, { quoted: msg }).catch(() => {});
            cleanup();
        }
    }, 180000);

    try {
        await sock.sendMessage(chat, { text: `⏳ Generating pairing code for \`+${rawNumber}\`…` }, { quoted: msg });

        const makeWASocket = (await import('@whiskeysockets/baileys')).default;
        const {
            useMultiFileAuthState,
            makeCacheableSignalKeyStore,
            fetchLatestBaileysVersion,
            DisconnectReason,
            Browsers,
            delay
        } = await import('@whiskeysockets/baileys');
        const { Boom } = await import('@hapi/boom');
        const NodeCache = (await import('@cacheable/node-cache')).default;
        const pino = (await import('pino')).default;

        const log = pino({ level: 'silent' });
        const msgRetryCounterCache = new NodeCache({ stdTTL: 100, checkperiod: 120 });

        const startTempPairSock = async () => {
            if (isCleanedUp) return;

            const { state, saveCreds } = await useMultiFileAuthState(tempDir);
            const { version } = await fetchLatestBaileysVersion();

            tempSock = makeWASocket({
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

            tempSock.ev.on('creds.update', saveCreds);

            tempSock.ev.on('connection.update', async (u) => {
                const { connection, lastDisconnect, qr } = u;

                if (qr && !tempSock.authState.creds.registered && !codeSent) {
                    codeSent = true;
                    try {
                        let code = await tempSock.requestPairingCode(rawNumber);
                        code = code?.match(/.{1,4}/g)?.join('-') || code;
                        await sendInteractive(
                            sock,
                            chat,
                            {
                                body: `🔑 *Pairing Code for +${rawNumber}:*\n\n\`\`\`${code}\`\`\`\n\nEnter this code in WhatsApp → Linked Devices.`,
                                footer: 'Provided by 𝗪𝗥Ã🇮🇹🇭',
                                buttons: [
                                    createCtaCopy('📋 Copy Code', code)
                                ]
                            },
                            { quoted: msg }
                        );
                    } catch (err) {
                        await sock.sendMessage(chat, { text: `❌ Failed to request pairing code: ${err.message}` }, { quoted: msg });
                        cleanup();
                        return;
                    }
                }

                if (connection === 'open') {
                    await sock.sendMessage(chat, { text: `✅ Linked successfully with +${rawNumber}! Sending \`creds.json\`…` }, { quoted: msg });
                    const credsFile = path.join(tempDir, 'creds.json');
                    if (fs.existsSync(credsFile)) {
                        await sock.sendMessage(chat, {
                            document: fs.readFileSync(credsFile),
                            fileName: 'creds.json',
                            mimetype: 'application/json',
                            caption: `📄 *creds.json* for +${rawNumber}`
                        }, { quoted: msg });
                    } else {
                        await sock.sendMessage(chat, { text: '⚠️ Connection opened but creds.json file was not found.' }, { quoted: msg });
                    }
                    setTimeout(() => {
                        cleanup();
                    }, 3000);
                }

                if (connection === 'close') {
                    if (isCleanedUp) return;
                    const statusCode = lastDisconnect?.error instanceof Boom
                        ? lastDisconnect.error.output?.statusCode
                        : (lastDisconnect?.error?.output?.statusCode || 0);

                    if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                        await sock.sendMessage(chat, { text: `❌ Linking failed or logged out for +${rawNumber}.` }, { quoted: msg }).catch(() => {});
                        cleanup();
                        return;
                    }

                    // Reconnect on restart required / socket disconnects during login handshake
                    console.log(`[getpair] tempSock closed (${statusCode}), reconnecting to finish linking…`);
                    try { tempSock.end(new Error('reconnecting')); } catch {}
                    await delay(2000);
                    if (!isCleanedUp) {
                        await startTempPairSock();
                    }
                }
            });
        };

        await startTempPairSock();

    } catch (e) {
        await sock.sendMessage(chat, { text: `⚠️ getpair failed: ${e.message}` }, { quoted: msg }).catch(() => {});
        cleanup();
    }
}

// ── .setsession ─────────────────────────────────────────────────────────────
export async function setsessionCommand(sock, chat, msg, args) {
    if (ownerOnly(sock, chat, msg)) return;
    if (mainSessionOnly(sock, chat, msg)) return;
    try {
        const apn = await import('awesome-phonenumber');
        const parsePhoneNumber = apn.parsePhoneNumber || apn.default;
        const ctx = msg.message?.extendedTextMessage?.contextInfo;
        const quoted = ctx?.quotedMessage;
        const doc = quoted?.documentMessage || quoted?.documentWithCaptionMessage?.message?.documentMessage;

        const rawNumber = args?.[0]?.replace(/\D/g, '');
        if (!rawNumber) {
            return sock.sendMessage(chat, { text: '❌ Please provide the owner phone number. Usage: reply to a `creds.json` document with `.setsession <owner_number>`' }, { quoted: msg });
        }

        if (!doc) {
            return sock.sendMessage(chat, { text: '❌ Reply to a `creds.json` file document with `.setsession <owner_number>`.' }, { quoted: msg });
        }

        const fileName = doc.fileName || '';
        if (fileName && !fileName.endsWith('.json') && doc.mimetype !== 'application/json' && doc.mimetype !== 'text/plain') {
            return sock.sendMessage(chat, { text: '❌ The quoted document must be a `creds.json` file.' }, { quoted: msg });
        }

        const stream = await downloadContentFromMessage(doc, 'document');
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        const buffer = Buffer.concat(chunks);
        const jsonStr = buffer.toString('utf-8');

        let credsData;
        try {
            credsData = JSON.parse(jsonStr);
        } catch {
            return sock.sendMessage(chat, { text: '❌ Invalid JSON format in document.' }, { quoted: msg });
        }

        if (!credsData || typeof credsData !== 'object' || (!credsData.noiseKey && !credsData.me)) {
            return sock.sendMessage(chat, { text: '❌ Provided JSON does not appear to be a valid Baileys `creds.json` file.' }, { quoted: msg });
        }

        const pn = parsePhoneNumber('+' + rawNumber);
        if (!pn?.valid) {
            return sock.sendMessage(chat, { text: `❌ Invalid phone number format: \`+${rawNumber}\`. Please retry with \`.setsession <owner_number>\`` }, { quoted: msg });
        }
        const validatedNumber = (pn.number?.e164 || (typeof pn.getNumber === 'function' ? pn.getNumber('e164') : null) || `+${rawNumber}`).replace('+', '');

        // Check root path
        const repoRoot = process.env.WRAITH_REPO_ROOT || process.cwd();
        const instancesDir = path.join(repoRoot, 'instances');

        // Determine next session ID
        let maxN = 1;
        if (fs.existsSync(instancesDir)) {
            const used = fs.readdirSync(instancesDir).filter(n => {
                try { return fs.statSync(path.join(instancesDir, n)).isDirectory(); } catch { return false; }
            });
            for (const id of used) {
                const m = /^sess(\d+)$/.exec(id);
                if (m) maxN = Math.max(maxN, parseInt(m[1], 10));
            }
        }
        const newSessionId = `sess${maxN + 1}`;
        const newInstDir = path.join(instancesDir, newSessionId);
        const newSessionDir = path.join(newInstDir, 'session');
        const newStateDir = path.join(newInstDir, 'state');

        fs.mkdirSync(newSessionDir, { recursive: true });
        fs.mkdirSync(newStateDir, { recursive: true });

        // Save creds.json and owner.json
        fs.writeFileSync(path.join(newSessionDir, 'creds.json'), JSON.stringify(credsData, null, 2));
        fs.writeFileSync(path.join(newStateDir, 'owner.json'), JSON.stringify({ owner: validatedNumber }, null, 2));

        // Signal launcher via IPC to spawn session
        if (typeof process.send === 'function') {
            process.send({
                type: 'wraith:spawn_session',
                sessionId: newSessionId,
                number: null
            });
            await sock.sendMessage(chat, { text: `✅ Created new session \`${newSessionId}\` for +${validatedNumber} and signaled launcher to start it!` }, { quoted: msg });
        } else {
            await sock.sendMessage(chat, { text: `✅ Created new session \`${newSessionId}\` for +${validatedNumber}.\n(Note: Launcher IPC not connected. Restart index.js to auto-resume).` }, { quoted: msg });
        }

    } catch (e) {
        await sock.sendMessage(chat, { text: `⚠️ setsession failed: ${e.message}` }, { quoted: msg }).catch(() => {});
    }
}

// ── .setvar / .getvar / .delvar ─────────────────────────────────────────────
export async function setvarCommand(sock, chat, msg, args) {
    if (ownerOnly(sock, chat, msg)) return;
    try {
        const key = (args?.[0] || '').trim();
        const value = (args || []).slice(1).join(' ').trim();
        if (!key || !value) {
            return sendWithCta(sock, chat, '❌ Usage: `.setvar <KEY> <VALUE>`\nExample: `.setvar GEMINI_API_KEY your_key_here`', { quoted: msg });
        }
        setVar(key, value);
        await sock.sendMessage(chat, { text: `✅ Variable \`${key}\` set successfully.` }, { quoted: msg });
    } catch (e) {
        await sock.sendMessage(chat, { text: `⚠️ setvar failed: ${e.message}` }, { quoted: msg }).catch(() => {});
    }
}

export async function getvarCommand(sock, chat, msg, args) {
    if (ownerOnly(sock, chat, msg)) return;
    try {
        const key = (args?.[0] || '').trim();
        if (!key || key.toLowerCase() === 'all') {
            const all = getAllVars();
            const keys = Object.keys(all);
            if (!keys.length) {
                return sock.sendMessage(chat, { text: '⚙️ No variables set for this session.' }, { quoted: msg });
            }
            const lines = ['⚙️ *Session Variables:*', ''];
            for (const k of keys) {
                const val = all[k] || '';
                const maskedVal = (k.includes('KEY') || k.includes('TOKEN') || k.includes('SECRET') || k.includes('PASS'))
                    ? (val.length > 8 ? `${val.slice(0, 4)}...${val.slice(-4)}` : '••••••••')
                    : val;
                lines.push(`• \`${k}\`: ${maskedVal}`);
            }
            return sock.sendMessage(chat, { text: lines.join('\n') }, { quoted: msg });
        }

        const value = getVar(key);
        if (value === null || value === undefined) {
            return sock.sendMessage(chat, { text: `❌ Variable \`${key}\` is not set.` }, { quoted: msg });
        }

        const isSensitive = key.includes('KEY') || key.includes('TOKEN') || key.includes('SECRET') || key.includes('PASS');
        const displayVal = isSensitive && value.length > 8
            ? `${value.slice(0, 4)}...${value.slice(-4)}`
            : value;

        await sock.sendMessage(chat, { text: `⚙️ *Variable \`${key}\`:* ${displayVal}` }, { quoted: msg });
    } catch (e) {
        await sock.sendMessage(chat, { text: `⚠️ getvar failed: ${e.message}` }, { quoted: msg }).catch(() => {});
    }
}

export async function delvarCommand(sock, chat, msg, args) {
    if (ownerOnly(sock, chat, msg)) return;
    try {
        const key = (args?.[0] || '').trim();
        if (!key) {
            return sendWithCta(sock, chat, '❌ Usage: `.delvar <KEY>`\nExample: `.delvar GEMINI_API_KEY`', { quoted: msg });
        }
        const removed = delVar(key);
        if (removed) {
            await sock.sendMessage(chat, { text: `✅ Deleted variable \`${key}\`.` }, { quoted: msg });
        } else {
            await sock.sendMessage(chat, { text: `❌ Variable \`${key}\` was not set.` }, { quoted: msg });
        }
    } catch (e) {
        await sock.sendMessage(chat, { text: `⚠️ delvar failed: ${e.message}` }, { quoted: msg }).catch(() => {});
    }
}

// ── .addowner / .delowner / .owner list ─────────────────────────────────────
function primaryOwnerOnly(sock, chat, msg) {
    const from = msg.key.participant || msg.key.remoteJid;
    if (!msg.key.fromMe && !isPrimaryOwner(from)) {
        sock.sendMessage(chat, { text: '⛔ Primary owner only.' }, { quoted: msg }).catch(() => {});
        return true;
    }
    return false;
}

export async function addownerCommand(sock, chat, msg, args) {
    if (primaryOwnerOnly(sock, chat, msg)) return;
    try {
        const target = await resolveBlockTarget(sock, chat, msg, args);
        if (!target) {
            return sock.sendMessage(chat, { text: '❌ Provide a target by reply, @mention, phone number, or JID.' }, { quoted: msg });
        }
        const digits = target.replace(/\D/g, '');
        const res = addSecondaryOwner(digits);
        if (!res.ok) {
            return sock.sendMessage(chat, { text: `❌ ${res.reason}` }, { quoted: msg });
        }
        await sock.sendMessage(chat, { text: `✅ Added @${res.number} as secondary owner.`, mentions: [`${res.number}@s.whatsapp.net`] }, { quoted: msg });
    } catch (e) {
        await sock.sendMessage(chat, { text: `⚠️ addowner failed: ${e.message}` }, { quoted: msg }).catch(() => {});
    }
}

export async function delownerCommand(sock, chat, msg, args) {
    if (primaryOwnerOnly(sock, chat, msg)) return;
    try {
        const target = await resolveBlockTarget(sock, chat, msg, args);
        if (!target) {
            return sock.sendMessage(chat, { text: '❌ Provide a target by reply, @mention, phone number, or JID.' }, { quoted: msg });
        }
        const digits = target.replace(/\D/g, '');
        const res = delSecondaryOwner(digits);
        if (!res.ok) {
            return sock.sendMessage(chat, { text: `❌ ${res.reason}` }, { quoted: msg });
        }
        await sock.sendMessage(chat, { text: `✅ Removed @${res.number} from secondary owners.`, mentions: [`${res.number}@s.whatsapp.net`] }, { quoted: msg });
    } catch (e) {
        await sock.sendMessage(chat, { text: `⚠️ delowner failed: ${e.message}` }, { quoted: msg }).catch(() => {});
    }
}

export async function ownerlistCommand(sock, chat, msg) {
    if (ownerOnly(sock, chat, msg)) return;
    try {
        const { owner, owners } = getOwnerDetails();
        const mentions = [];
        const lines = ['👑 *WRAITH Owners*', ''];
        if (owner) {
            lines.push(`• *Primary Owner:* @${owner}`);
            mentions.push(`${owner}@s.whatsapp.net`);
        } else {
            lines.push('• *Primary Owner:* _Not configured_');
        }

        if (owners.length > 0) {
            lines.push('', '*Secondary Owners:*');
            owners.forEach((num, i) => {
                lines.push(`${i + 1}. @${num}`);
                mentions.push(`${num}@s.whatsapp.net`);
            });
        } else {
            lines.push('', '*Secondary Owners:* _None_');
        }

        await sock.sendMessage(chat, { text: lines.join('\n'), mentions }, { quoted: msg });
    } catch (e) {
        await sock.sendMessage(chat, { text: `⚠️ ownerlist failed: ${e.message}` }, { quoted: msg }).catch(() => {});
    }
}

// ── .chatstats ──────────────────────────────────────────────────────────────
export async function chatstatsCommand(sock, chat, msg, args) {
    try {
        const digits = (args?.[0] || '').replace(/\D/g, '');
        if (!digits) {
            return sendWithCta(sock, chat, '📊 *chatstats*\n\nUsage: `.chatstats <number>`\nShows aggregated activity for that contact across every chat the bot has seen.', { quoted: msg });
        }
        const activity = readJson(path.join(process.cwd(), 'state', 'activity.json'), {});
        let total = 0, firstSeen = 0, lastActive = 0;
        const groupBreakdown = [];
        for (const [jid, rec] of Object.entries(activity)) {
            const contacts = rec?.contacts || {};
            const hit = Object.entries(contacts).find(([sender]) => sender.replace(/\D/g, '').includes(digits));
            if (!hit) continue;
            const [, c] = hit;
            total += c.count || 0;
            if (!firstSeen || (rec.firstSeen && rec.firstSeen < firstSeen)) firstSeen = rec.firstSeen;
            if ((c.last || 0) > lastActive) lastActive = c.last;
            groupBreakdown.push({ jid, count: c.count || 0, last: c.last || 0 });
        }
        const dmRec = activity[`${digits}@s.whatsapp.net`] || activity[`${digits}@lid`];
        const dmTotal = dmRec?.total || 0;
        if (!total && !dmTotal) {
            return sock.sendMessage(chat, { text: `❌ No recorded activity for \`${digits}\`.` }, { quoted: msg });
        }
        groupBreakdown.sort((a, b) => b.count - a.count);
        const lines = [
            `📊 *chatstats* — \`${digits}\``, '',
            `• messages (in groups) · *${total}*`,
            `• messages (DM with bot) · *${dmTotal}*`,
        ];
        if (firstSeen) lines.push(`• first seen · ${new Date(firstSeen).toLocaleDateString('en-GB', { timeZone: CONFIG.timezone || 'Asia/Karachi' })}`);
        if (lastActive) lines.push(`• last active · ${new Date(lastActive).toLocaleString('en-GB', { timeZone: CONFIG.timezone || 'Asia/Karachi' })}`);
        if (groupBreakdown.length) {
            lines.push('', '*active in:*');
            for (const g of groupBreakdown.slice(0, 10)) lines.push(`  \`${g.jid.split('@')[0]}\` — ${g.count} msgs`);
        }
        await sock.sendMessage(chat, { text: lines.join('\n') }, { quoted: msg });
    } catch (e) {
        await sock.sendMessage(chat, { text: `⚠️ chatstats failed: ${e.message}` }, { quoted: msg }).catch(() => {});
    }
}
