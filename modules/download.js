// ─────────────────────────────────────────────
// WRAITH · modules/download.js
// .song → SoundCloud → Deezer → Apple Music
//         + MP3 conversion for compatibility
// .dl   → non-YouTube platforms via @choewy/yt-dlp
// ─────────────────────────────────────────────

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { YtDlp } from '@choewy/yt-dlp';
import { isOwner } from '../core/identity.js';
import {
    fetchAudioFromAnySource,
    detectAudioFormat,
    convertToMp3,
} from '../lib/music-sources.js';

const require = createRequire(import.meta.url);

const AUDIO_MAX_BYTES = 15 * 1024 * 1024;
const VIDEO_MAX_BYTES = 128 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;

// ─── Queue ───
const _queue = [];
let _running = false;

function enqueue(task) {
    return new Promise((resolve, reject) => {
        _queue.push({ task, resolve, reject });
        _drain();
    });
}

async function _drain() {
    if (_running) return;
    const next = _queue.shift();
    if (!next) return;
    _running = true;
    try {
        next.resolve(await next.task());
    } catch (e) {
        next.reject(e);
    } finally {
        _running = false;
        setImmediate(_drain);
    }
}

// ─── Helpers ───
async function react(sock, chat, msg, emoji) {
    try {
        await sock.sendMessage(chat, { react: { text: emoji, key: msg.key } });
    } catch {}
}

function withTimeout(promise, ms, label = 'operation') {
    let timer;
    return Promise.race([
        promise.finally(() => clearTimeout(timer)),
        new Promise((_, rej) => {
            timer = setTimeout(
                () => rej(new Error(`${label} timeout after ${ms / 1000}s`)),
                ms
            );
        }),
    ]);
}

function isYouTubeUrl(u) {
    return /(?:youtube\.com|youtu\.be)/i.test(u);
}

// ─── Send audio (with MP3 conversion) ───
async function sendAudio(sock, chat, msg, result) {
    const title = result.title || 'song';
    const artist = result.artist || '';
    const safeTitle = title.replace(/[^\w\s-]/g, '').trim() || 'song';
    const displayName = artist ? `${artist} - ${title}` : title;

    if (!result.buffer || result.buffer.length < 2000) {
        throw new Error('downloaded audio is empty or too small');
    }

    // Send artwork first (best-effort)
    if (result.artwork) {
        try {
            await sock
                .sendMessage(
                    chat,
                    {
                        image: { url: result.artwork },
                        caption: `🎵 *${displayName}*\n_Source: ${result.provider}_`,
                    },
                    { quoted: msg }
                )
                .catch(() => {});
        } catch {}
    }

    // Detect actual format from buffer
    const detected = detectAudioFormat(result.buffer);

    let sendBuffer = result.buffer;
    let sendExt = detected.ext;
    let sendMime = detected.mime;

    // Always convert to MP3 for WhatsApp compatibility
    if (detected.ext !== 'mp3') {
        try {
            console.log(`[audio] converting ${detected.ext} → mp3...`);
            sendBuffer = await convertToMp3(result.buffer, detected.ext);
            sendExt = 'mp3';
            sendMime = 'audio/mpeg';
            console.log(`[audio] conversion complete: ${sendBuffer.length} bytes`);
        } catch (e) {
            console.warn('[audio] MP3 conversion failed, sending original:', e.message);
        }
    }

    console.log(`[audio] sending ${sendExt} (${sendMime}) — ${sendBuffer.length} bytes`);

    await sock.sendMessage(
        chat,
        {
            audio: sendBuffer,
            mimetype: sendMime,
            fileName: `${safeTitle}.${sendExt}`,
            ptt: false,
        },
        { quoted: msg }
    );

    await react(sock, chat, msg, '✅');
}

// ─── .song ───
export async function songCommand(sock, chat, msg, args) {
    return enqueue(async () => {
        try {
            const from = msg?.key?.participant || msg?.key?.remoteJid;
            if (!msg?.key?.fromMe && !isOwner(from)) {
                await react(sock, chat, msg, '❌');
                return sock.sendMessage(
                    chat,
                    { text: '⛔ Owner only.' },
                    { quoted: msg }
                );
            }

            const query = Array.isArray(args) ? args.join(' ').trim() : '';

            if (!query) {
                await react(sock, chat, msg, '❌');
                return sock.sendMessage(
                    chat,
                    {
                        text: [
                            '* WRAITH · SONG*',
                            '',
                            'Usage: `.song <song name>`',
                            '',
                            'Partial names work — e.g. `.song shape of`',
                            'Sources: SoundCloud → Deezer → Apple Music',
                        ].join('\n'),
                    },
                    { quoted: msg }
                );
            }

            const onStatus = (s) =>
                sock
                    .sendMessage(chat, { text: s }, { quoted: msg })
                    .catch(() => {});

            const result = await fetchAudioFromAnySource(
                query,
                AUDIO_MAX_BYTES,
                onStatus
            );

            return sendAudio(sock, chat, msg, result);
        } catch (err) {
            console.error('[song] error:', err?.message);
            await react(sock, chat, msg, '❌');
            await sock
                .sendMessage(
                    chat,
                    {
                        text:
                            `❌ Couldn't find that song.\n` +
                            `Tried SoundCloud, Deezer, and Apple Music.\n` +
                            `_${String(err?.message || err).slice(0, 160)}_`,
                    },
                    { quoted: msg }
                )
                .catch(() => {});
        }
    });
}

// ─── .dl (non-YouTube only) ───
export async function downloadCommand(sock, chat, msg, args) {
    const from = msg?.key?.participant || msg?.key?.remoteJid;
    if (!msg?.key?.fromMe && !isOwner(from)) {
        await react(sock, chat, msg, '❌');
        return sock.sendMessage(
            chat,
            { text: '⛔ Owner only.' },
            { quoted: msg }
        );
    }

    const arr = Array.isArray(args) ? [...args] : [];
    const urlIdx = arr.findIndex((p) => /^https?:\/\//i.test(p));

    if (urlIdx === -1) {
        await react(sock, chat, msg, '❌');
        return sock.sendMessage(
            chat,
            {
                text: [
                    '* WRAITH · DOWNLOAD*',
                    '',
                    'Supported (via yt-dlp):',
                    'Instagram, TikTok, X, Vimeo, Facebook, Reddit,',
                    'Pinterest, LinkedIn, Snapchat, Twitch, Dailymotion,',
                    'SoundCloud, Bandcamp, and 1000+ more.',
                    '',
                    'Usage:',
                    '• `.dl <url>` — auto (video)',
                    '• `.dl audio <url>` — audio only',
                    '• `.dl mp3 <url>` — mp3',
                    '',
                    '⚠️ YouTube is not supported. Use `.song <name>`.',
                ].join('\n'),
            },
            { quoted: msg }
        );
    }

    const url = arr.splice(urlIdx, 1)[0];

    if (isYouTubeUrl(url)) {
        await react(sock, chat, msg, '❌');
        return sock.sendMessage(
            chat,
            {
                text:
                    '❌ YouTube is not supported.\n' +
                    'Use `.song <song name>` to fetch music.',
            },
            { quoted: msg }
        );
    }

    let mode = 'video';
    let container = 'mp4';

    for (const p of arr.map((x) => String(x).toLowerCase())) {
        if (p === 'audio' || p === 'a') { mode = 'audio'; container = 'm4a'; }
        else if (p === 'mp3') { mode = 'audio'; container = 'mp3'; }
        else if (p === 'm4a') { mode = 'audio'; container = 'm4a'; }
        else if (p === 'video' || p === 'v') { mode = 'video'; container = 'mp4'; }
    }

    return downloadViaYtDlp(sock, chat, msg, url, mode, container);
}

// ─── Non-YouTube download via @choewy/yt-dlp ───
async function downloadViaYtDlp(sock, chat, msg, url, mode, container) {
    const prefix = `wraith_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const outTemplate = path.join(os.tmpdir(), `${prefix}.%(ext)s`);

    try {
        await sock.sendMessage(chat, { text: '⏳ downloading…' }, { quoted: msg });

        const ytDlp = new YtDlp({
            url,
            output: outTemplate,
            format:
                mode === 'audio'
                    ? 'bestaudio/best'
                    : 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
            quiet: true,
            noWarnings: true,
            noProgress: true,
            playlist: false,
            retries: 3,
        });

        const builder =
            mode === 'audio'
                ? ytDlp.audioFormat(container).audio()
                : ytDlp.mergeFormat('mp4').video();

        const result = await withTimeout(
            builder.download(),
            DOWNLOAD_TIMEOUT_MS,
            'yt-dlp download'
        );
        const outFile = result?.path;

        if (!outFile || !fs.existsSync(outFile)) throw new Error('no output file produced');

        const stat = fs.statSync(outFile);
        const cap = mode === 'audio' ? AUDIO_MAX_BYTES : VIDEO_MAX_BYTES;
        if (stat.size > cap) {
            try { fs.unlinkSync(outFile); } catch {}
            throw new Error(`File too large (${(stat.size / 1048576).toFixed(1)} MB)`);
        }

        const stream = fs.createReadStream(outFile);
        const cleanup = () => { try { fs.unlinkSync(outFile); } catch {} };
        stream.on('close', cleanup);
        stream.on('error', cleanup);

        const filename = path.basename(outFile);

        if (mode === 'audio') {
            await sock.sendMessage(
                chat,
                {
                    audio: { stream },
                    mimetype: 'audio/mpeg',
                    fileName: filename,
                    ptt: false,
                },
                { quoted: msg }
            );
        } else {
            await sock.sendMessage(
                chat,
                {
                    video: { stream },
                    mimetype: 'video/mp4',
                    fileName: filename,
                    caption: filename,
                },
                { quoted: msg }
            );
        }

        await react(sock, chat, msg, '✅');
    } catch (err) {
        console.error('[dl] error:', err?.message);
        await react(sock, chat, msg, '❌');
        await sock
            .sendMessage(
                chat,
                {
                    text: `❌ Download failed.\n${String(err?.message || err).slice(0, 180)}`,
                },
                { quoted: msg }
            )
            .catch(() => {});
    }
}
