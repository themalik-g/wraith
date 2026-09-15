// ─────────────────────────────────────────────
// WRAITH · lib/music-sources.js
// .song source chain — CONCURRENT RACE:
//   SoundCloud · Apple Music · Deezer all start at once.
//   First success wins. Losers are ignored once settled.
//
//  · Tight timeouts (15–20s per source) — no long waits
//  · Every result normalised to MP3 (in memory, ffmpeg pipes)
//  · No files left on disk; buffers live only in RAM
// ─────────────────────────────────────────────
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import ffmpegPath from 'ffmpeg-static';

const require = createRequire(import.meta.url);

// ── Aggressive timeouts (ms) ──
const TIMEOUTS = {
    'sc-ytdlp': 20_000,
    'scdl':     15_000,
    'apple':    20_000,
    'deezer':   20_000,
};
const MP3_CONVERT_TIMEOUT = 30_000;

// ── Generic timeout wrapper ──
function withTimeout(promise, ms, label) {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(
            () => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)),
            ms
        );
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// ── fetch() with AbortController + timeout ──
async function fetchBuffer(url, timeoutMs = 15_000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const res = await fetch(url, {
            signal: ctrl.signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
                Accept: '*/*',
            },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return Buffer.from(await res.arrayBuffer());
    } finally { clearTimeout(timer); }
}

// ── Format sniffing ──
export function detectAudioFormat(buf) {
    if (!buf || buf.length < 12) return { ext: 'mp3', mime: 'audio/mpeg' };
    const a4 = buf.toString('ascii', 4, 8);
    const a0 = buf.toString('ascii', 0, 4);
    if (a4 === 'ftyp') return { ext: 'm4a', mime: 'audio/mp4' };
    if (a0 === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) return { ext: 'mp3', mime: 'audio/mpeg' };
    if (a0 === 'OggS') return { ext: 'ogg', mime: 'audio/ogg; codecs=opus' };
    if (a0 === 'RIFF') return { ext: 'wav', mime: 'audio/wav' };
    if (a0 === 'fLaC') return { ext: 'flac', mime: 'audio/flac' };
    return { ext: 'mp3', mime: 'audio/mpeg' };
}

// ── In-memory audio → MP3 via ffmpeg pipes (NO disk I/O) ──
function bufferToMp3(inputBuffer, bitrate = 192) {
    return new Promise((resolve, reject) => {
        if (!ffmpegPath) return reject(new Error('ffmpeg-static binary missing'));
        if (!inputBuffer || inputBuffer.length < 1024) return reject(new Error('input buffer too small'));

        const ff = spawn(ffmpegPath, [
            '-hide_banner', '-loglevel', 'error',
            '-i', 'pipe:0',
            '-vn',
            '-codec:a', 'libmp3lame',
            '-b:a', `${bitrate}k`,
            '-f', 'mp3',
            'pipe:1',
        ]);

        const chunks = [];
        let err = '';

        ff.stdout.on('data', (c) => chunks.push(c));
        ff.stderr.on('data', (d) => { err += d.toString(); });
        ff.on('error', (e) => reject(new Error(`ffmpeg spawn: ${e.message}`)));
        ff.on('close', (code) => {
            if (code !== 0) return reject(new Error(`ffmpeg ${code}: ${err.slice(-200)}`));
            const out = Buffer.concat(chunks);
            if (out.length < 1024) return reject(new Error('ffmpeg produced empty mp3'));
            resolve(out);
        });

        ff.stdin.on('error', () => {});
        ff.stdin.write(inputBuffer);
        ff.stdin.end();
    });
}

// ── Ensure a source result is MP3 (converts in memory if needed) ──
async function ensureMp3(result, onStatus) {
    if (!result?.buffer?.length) throw new Error('empty buffer from source');

    const fmt = detectAudioFormat(result.buffer);
    if (fmt.ext === 'mp3') {
        return { ...result, format: 'mp3', mimetype: 'audio/mpeg' };
    }

    if (onStatus) onStatus(`⚙️ converting ${fmt.ext} → mp3…`);
    const converted = await withTimeout(
        bufferToMp3(result.buffer, 192),
        MP3_CONVERT_TIMEOUT,
        'mp3 conversion'
    );

    return {
        ...result,
        buffer: converted,
        size: converted.length,
        format: 'mp3',
        mimetype: 'audio/mpeg',
    };
}

// ── Scoring ──
function scoreTrack({ title, artist, duration }, query) {
    const q = String(query || '').toLowerCase().trim();
    const t = String(title || '').toLowerCase();
    const ar = String(artist || '').toLowerCase();
    const dur = Number(duration) || 0;
    let score = 0;
    if (t === q) score += 120;
    else if (t.startsWith(q)) score += 80;
    else if (t.includes(q)) score += 60;
    else {
        const words = q.split(/\s+/).filter(Boolean);
        if (words.length) score += (words.filter((w) => t.includes(w)).length / words.length) * 40;
    }
    if (ar && q.includes(ar)) score += 35;
    else if (ar && ar.includes(q)) score += 25;
    if (dur >= 120 && dur <= 420) score += 30;
    else if (dur > 420) score += 10;
    else if (dur > 90 && dur < 120) score += 5;
    else if (dur < 60) score -= 40;
    else if (dur < 90) score -= 15;
    for (const w of ['cover','remix','live','instrumental','karaoke','reaction','sped up','slowed','nightcore','tribute','parody'])
        if (t.includes(w)) score -= 25;
    return score;
}

function pickBest(tracks, query, mapFn) {
    if (!tracks?.length) return null;
    return tracks.map((t) => ({ raw: t, meta: mapFn(t) }))
        .filter((x) => x.meta && x.meta.title)
        .map((x) => ({ ...x, score: scoreTrack(x.meta, query) }))
        .sort((a, b) => b.score - a.score)[0]?.raw || null;
}

// ── TIER 1: SoundCloud FULL via yt-dlp ──
export async function fetchFromSoundCloud(query, maxBytes, onStatus) {
    const { YtDlp } = await import('@choewy/yt-dlp');
    if (onStatus) onStatus('🎵 SoundCloud…');

    const outTemplate = path.join(os.tmpdir(), `wraith_song_${Date.now()}_%(title).80s.%(ext)s`);
    const ytDlp = new YtDlp({
        url: `scsearch5:${query}`,             // was scsearch10 — fewer results, faster
        output: outTemplate,
        format: 'bestaudio/best',
        quiet: true, noWarnings: true, noProgress: true,
        playlist: false,
        retries: 1,                             // was 3 — one retry is enough
        socketTimeout: 8,                       // abort stale sockets fast
        concurrentFragments: 4,                 // parallel fragment download
        noPart: true,
        noCheckCertificates: true,
    });

    let result;
    try { result = await ytDlp.audioFormat('mp3').audio().download(); }
    catch (e) { throw new Error(`yt-dlp soundcloud: ${e.message}`); }

    const outFile = result?.path;
    if (!outFile || !fs.existsSync(outFile)) throw new Error('yt-dlp produced no file');

    try {
        const stat = fs.statSync(outFile);
        if (stat.size > maxBytes) throw new Error(`track too large (${(stat.size / 1048576).toFixed(1)} MB)`);
        if (stat.size < 50_000) throw new Error('downloaded track is empty');

        const buffer = fs.readFileSync(outFile);
        if (onStatus) onStatus(`✅ SoundCloud: ${result.title || query}`);
        return {
            buffer,
            title: result.title || query,
            artist: '',
            artwork: null,
            provider: 'soundcloud (full)',
            size: buffer.length,
            format: 'mp3',
            mimetype: 'audio/mpeg',
            preview: false,
        };
    } finally {
        try { fs.unlinkSync(outFile); } catch {}
    }
}

// ── TIER 2: legacy scdl (optional) ──
export async function fetchFromSoundCloudScdl(query, maxBytes, onStatus) {
    let scdl;
    try { scdl = require('@snwfdhmp/soundcloud-downloader').default; }
    catch { throw new Error('scdl package not installed (optional)'); }

    if (onStatus) onStatus('🎵 SoundCloud (scdl)…');
    const results = await scdl.search({ query, resourceType: 'tracks', limit: 10 });
    const streamable = (results?.collection || []).filter((t) => t.streamable);
    if (!streamable.length) throw new Error('no streamable SoundCloud results');

    const best = pickBest(streamable, query, (t) => ({
        title: t.title,
        artist: t.user?.username,
        duration: (t.duration || 0) / 1000,
    }));
    if (!best) throw new Error('no suitable SoundCloud track');

    const stream = await scdl.download(best.permalink_url);
    const chunks = [];
    let total = 0;
    for await (const chunk of stream) {
        chunks.push(chunk);
        total += chunk.length;
        if (total > maxBytes) throw new Error('SoundCloud file too large');
    }
    const buffer = Buffer.concat(chunks);
    const fmt = detectAudioFormat(buffer);

    return {
        buffer,
        title: best.title,
        artist: best.user?.username || '',
        artwork: best.artwork_url || null,
        provider: 'soundcloud (scdl)',
        size: buffer.length,
        format: fmt.ext,
        mimetype: fmt.mime,
        preview: false,
    };
}

// ── TIER 3: Apple Music FULL via applemusic-core ──
export async function fetchFromAppleMusic(query, maxBytes, onStatus) {
    let am;
    try { am = require('applemusic-core'); }
    catch { throw new Error('applemusic-core not installed'); }

    if (onStatus) onStatus('🍎 Apple Music…');

    const results = await am.search(query);
    const songs = (results || []).filter((r) => r.type === 'Song');
    if (!songs.length) throw new Error('no Apple Music results');

    const best = pickBest(songs, query, (t) => ({
        title: t.title,
        artist: t.artists,
        duration: 0,
    }));
    if (!best) throw new Error('no suitable Apple Music track');

    if (onStatus) onStatus(`🍎 Apple Music: downloading ${best.title}…`);
    const dl = await am.download(best.url);
    const buffer = Buffer.isBuffer(dl?.data) ? dl.data : Buffer.from(dl?.data || []);
    if (!buffer || buffer.length < 50_000) throw new Error('Apple Music returned empty');
    if (buffer.length > maxBytes) throw new Error('Apple Music file too large');

    const fmt = detectAudioFormat(buffer);
    if (onStatus) onStatus(`✅ Apple Music: ${best.title}`);
    return {
        buffer,
        title: dl.title || best.title,
        artist: dl.artists || best.artists || '',
        artwork: dl.image || best.cover || null,
        provider: 'apple-music (full)',
        size: buffer.length,
        format: fmt.ext,
        mimetype: fmt.mime,
        preview: false,
    };
}

// ── TIER 4: Deezer FULL via gerdur-core ──
export async function fetchFromDeezer(query, maxBytes, onStatus) {
    let gerdur;
    try { gerdur = require('gerdur-core'); }
    catch { throw new Error('gerdur-core not installed'); }

    if (onStatus) onStatus('🎧 Deezer…');

    const { searchPublicApi } = gerdur;
    const { data } = await searchPublicApi(query, { type: 'track', limit: 10 });
    if (!data?.length) throw new Error('no Deezer results');

    const best = pickBest(data, query, (t) => ({
        title: t.title,
        artist: t.artist?.name,
        duration: t.duration,
    }));
    if (!best) throw new Error('no suitable Deezer track');

    const arl = process.env.GERDUR_ARL || process.env.DEEZER_ARL;
    if (!arl) throw new Error('Deezer ARL not set (run `npx gerdur setup`)');

    const { initDeezerApi, getTrackInfo, downloadTrackBuffer } = gerdur;
    await initDeezerApi(arl);
    const track = await getTrackInfo(String(best.id));
    if (!track) throw new Error('Deezer track not found');

    if (onStatus) onStatus(`🎧 Deezer: downloading ${best.title}…`);
    const audio = await downloadTrackBuffer(track, 3);
    if (!audio) throw new Error('Deezer: track unavailable');

    const buffer = Buffer.isBuffer(audio) ? audio : Buffer.from(audio);
    if (buffer.length < 50_000) throw new Error('Deezer returned empty');
    if (buffer.length > maxBytes) throw new Error('Deezer file too large');

    if (onStatus) onStatus(`✅ Deezer: ${best.title}`);
    return {
        buffer,
        title: best.title,
        artist: best.artist?.name || '',
        artwork: best.album?.cover_xl || best.album?.cover_big || null,
        provider: 'deezer (full)',
        size: buffer.length,
        format: 'mp3',
        mimetype: 'audio/mpeg',
        preview: false,
    };
}

// ─────────────────────────────────────────────
//  Main entry — CONCURRENT RACE
//  All sources start at once. First success wins.
//  Losers keep running in the background but their
//  results are discarded once the race is settled.
// ─────────────────────────────────────────────
export async function fetchAudioFromAnySource(query, maxBytes, onStatus) {
    if (onStatus) onStatus('🎵 racing SoundCloud · Apple · Deezer…');

    const sources = [
        { name: 'soundcloud', fn: fetchFromSoundCloud,     timeout: TIMEOUTS['sc-ytdlp'] },
        { name: 'apple',      fn: fetchFromAppleMusic,     timeout: TIMEOUTS.apple },
        { name: 'deezer',     fn: fetchFromDeezer,         timeout: TIMEOUTS.deezer },
    ];

    const errors = [];

    return new Promise((resolve, reject) => {
        let settled = false;
        let pending = sources.length;
        const startedAt = Date.now();

        for (const { name, fn, timeout } of sources) {
            withTimeout(
                Promise.resolve().then(() => fn(query, maxBytes, null)),
                timeout,
                name
            )
                .then(async (raw) => {
                    if (settled) return;              // someone already won
                    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);

                    let result;
                    try {
                        result = await ensureMp3(raw, onStatus);
                    } catch (e) {
                        errors.push(`${name} (convert): ${e.message}`);
                        console.warn(`[music] ${name} convert failed:`, e.message);
                        if (--pending === 0 && !settled) {
                            reject(new Error(`all sources failed — ${errors.join(' | ')}`));
                        }
                        return;
                    }

                    settled = true;
                    if (onStatus) onStatus(`✅ ${result.provider}: ${result.title} (${elapsed}s)`);
                    resolve(result);
                })
                .catch((e) => {
                    errors.push(`${name}: ${e.message}`);
                    console.warn(`[music] ${name} failed:`, e.message);
                    if (--pending === 0 && !settled) {
                        reject(new Error(`all sources failed — ${errors.join(' | ')}`));
                    }
                });
        }
    });
}
