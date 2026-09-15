// ─────────────────────────────────────────────
// WRAITH · lib/music-sources.js
// FULL-LENGTH keyless audio, priority:
//   TIER 1: SoundCloud FULL tracks via yt-dlp
//   TIER 2: legacy scdl package (optional)
//   TIER 3: Apple Music FULL via applemusic-core
//   TIER 4: Deezer FULL via gerdur-core
// ─────────────────────────────────────────────
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

async function fetchBuffer(url, timeoutMs = 30_000) {
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

export function detectAudioFormat(buf) {
    if (!buf || buf.length < 12) return { ext: 'mp3', mime: 'audio/mpeg' };
    const a4 = buf.toString('ascii', 4, 8);
    const a0 = buf.toString('ascii', 0, 4);
    if (a4 === 'ftyp') return { ext: 'm4a', mime: 'audio/mp4' };
    if (a0 === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) return { ext: 'mp3', mime: 'audio/mpeg' };
    if (a0 === 'OggS') return { ext: 'ogg', mime: 'audio/ogg; codecs=opus' };
    if (a0 === 'RIFF') return { ext: 'wav', mime: 'audio/wav' };
    return { ext: 'mp3', mime: 'audio/mpeg' };
}

let _decodeAudio = null, _lamejs = null;
async function getDecodeAudio() {
    if (_decodeAudio) return _decodeAudio;
    try { const mod = await import('audio-decode'); _decodeAudio = mod.default; return _decodeAudio; }
    catch (e) { console.warn('[audio] audio-decode not available:', e.message); return null; }
}
function getLamejs() {
    if (_lamejs) return _lamejs;
    try { _lamejs = require('lamejs'); return _lamejs; }
    catch (e) { console.warn('[audio] lamejs not available:', e.message); return null; }
}

export async function convertToMp3(buffer) {
    const decodeAudio = await getDecodeAudio();
    const lamejs = getLamejs();
    if (!decodeAudio || !lamejs) throw new Error('audio conversion libraries not installed');
    const audioBuffer = await decodeAudio(buffer);
    const channels = audioBuffer.numberOfChannels;
    const sampleRate = audioBuffer.sampleRate;
    const length = audioBuffer.length;
    if (!length) throw new Error('decoded audio is empty');
    const toInt16 = (f32) => {
        const out = new Int16Array(f32.length);
        for (let i = 0; i < f32.length; i++) {
            const s = Math.max(-1, Math.min(1, f32[i]));
            out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        return out;
    };
    const leftPcm = toInt16(audioBuffer.getChannelData(0));
    const rightPcm = channels > 1 ? toInt16(audioBuffer.getChannelData(1)) : null;
    const encoder = new lamejs.Mp3Encoder(channels, sampleRate, 192);
    const BLOCK = 1152, chunks = [];
    for (let i = 0; i < length; i += BLOCK) {
        const l = leftPcm.subarray(i, i + BLOCK);
        const r = rightPcm ? rightPcm.subarray(i, i + BLOCK) : undefined;
        const mp3buf = channels === 1 ? encoder.encodeBuffer(l) : encoder.encodeBuffer(l, r);
        if (mp3buf.length > 0) chunks.push(Buffer.from(mp3buf));
    }
    const flush = encoder.flush();
    if (flush.length > 0) chunks.push(Buffer.from(flush));
    const out = Buffer.concat(chunks);
    if (!out.length) throw new Error('MP3 encoding produced empty output');
    return out;
}

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

// ── TIER 1: SoundCloud FULL track via yt-dlp ──
export async function fetchFromSoundCloud(query, maxBytes, onStatus) {
    const { YtDlp } = await import('@choewy/yt-dlp');
    if (onStatus) onStatus('🎵 SoundCloud: fetching full track...');
    const outTemplate = path.join(os.tmpdir(), `wraith_song_${Date.now()}_%(title).80s.%(ext)s`);
    const ytDlp = new YtDlp({
        url: `scsearch10:${query}`,
        output: outTemplate,
        format: 'bestaudio/best',
        quiet: true, noWarnings: true, noProgress: true,
        playlist: false, retries: 3,
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
        if (onStatus) onStatus(`✅ SoundCloud full track · ${result.title || query} · ${(buffer.length / 1048576).toFixed(1)} MB`);
        return { buffer, title: result.title || query, artist: '', artwork: null, provider: 'soundcloud (full)', size: buffer.length, format: 'mp3', mimetype: 'audio/mpeg', preview: false };
    } finally { try { fs.unlinkSync(outFile); } catch {} }
}

// ── TIER 2: legacy scdl (optional) ──
export async function fetchFromSoundCloudScdl(query, maxBytes, onStatus) {
    let scdl;
    try { scdl = require('@snwfdhmp/soundcloud-downloader').default; }
    catch { throw new Error('scdl package not installed (optional)'); }
    if (onStatus) onStatus('🎵 searching SoundCloud (scdl)...');
    const results = await scdl.search({ query, resourceType: 'tracks', limit: 15 });
    const streamable = (results?.collection || []).filter((t) => t.streamable);
    if (!streamable.length) throw new Error('no streamable SoundCloud results');
    const best = pickBest(streamable, query, (t) => ({ title: t.title, artist: t.user?.username, duration: (t.duration || 0) / 1000 }));
    if (!best) throw new Error('no suitable SoundCloud track');
    const stream = await scdl.download(best.permalink_url);
    const chunks = []; let total = 0;
    for await (const chunk of stream) { chunks.push(chunk); total += chunk.length; if (total > maxBytes) throw new Error('SoundCloud file too large'); }
    const buffer = Buffer.concat(chunks);
    const fmt = detectAudioFormat(buffer);
    return { buffer, title: best.title, artist: best.user?.username || '', artwork: best.artwork_url || null, provider: 'soundcloud', size: buffer.length, format: fmt.ext, mimetype: fmt.mime, preview: false };
}

// ── TIER 3: Apple Music FULL via applemusic-core ──
export async function fetchFromAppleMusic(query, maxBytes, onStatus) {
    let am;
    try { am = require('applemusic-core'); }
    catch { throw new Error('applemusic-core not installed'); }

    if (onStatus) onStatus('🍎 Apple Music: searching...');

    const results = await am.search(query);
    const songs = (results || []).filter((r) => r.type === 'Song');
    if (!songs.length) throw new Error('no Apple Music results');

    const best = pickBest(songs, query, (t) => ({
        title: t.title,
        artist: t.artists,
        duration: 0,
    }));
    if (!best) throw new Error('no suitable Apple Music track');

    if (onStatus) onStatus(`🍎 Apple Music: downloading ${best.title}...`);
    const dl = await am.download(best.url);
    const buffer = Buffer.isBuffer(dl?.data) ? dl.data : Buffer.from(dl?.data || []);
    if (!buffer || buffer.length < 50_000) throw new Error('Apple Music returned empty');
    if (buffer.length > maxBytes) throw new Error('Apple Music file too large');

    const fmt = detectAudioFormat(buffer);
    if (onStatus) onStatus(`✅ Apple Music full: ${best.title}`);
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

    if (onStatus) onStatus('🎧 Deezer: searching...');

    // Public search — no auth needed
    const { searchPublicApi } = gerdur;
    const { data } = await searchPublicApi(query, { type: 'track', limit: 15 });
    if (!data?.length) throw new Error('no Deezer results');

    const best = pickBest(data, query, (t) => ({
        title: t.title,
        artist: t.artist?.name,
        duration: t.duration,
    }));
    if (!best) throw new Error('no suitable Deezer track');

    // Download requires ARL cookie
    const arl = process.env.GERDUR_ARL || process.env.DEEZER_ARL;
    if (!arl) throw new Error('Deezer ARL not set (GERDUR_ARL env or `npx gerdur setup`)');

    const { initDeezerApi, getTrackInfo, downloadTrackBuffer } = gerdur;
    await initDeezerApi(arl);
    const track = await getTrackInfo(String(best.id));
    if (!track) throw new Error('Deezer track not found');

    if (onStatus) onStatus(`🎧 Deezer: downloading ${best.title}...`);
    const audio = await downloadTrackBuffer(track, 3); // 3 = 320 kbps MP3
    if (!audio) throw new Error('Deezer: track unavailable for this account/region');

    const buffer = Buffer.isBuffer(audio) ? audio : Buffer.from(audio);
    if (buffer.length < 50_000) throw new Error('Deezer returned empty');
    if (buffer.length > maxBytes) throw new Error('Deezer file too large');

    if (onStatus) onStatus(`✅ Deezer full: ${best.title}`);
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

// ── Main entry: SoundCloud → Apple Music → Deezer ──
export async function fetchAudioFromAnySource(query, maxBytes, onStatus) {
    const errors = [];
    for (const [name, fn] of [
        ['sc-ytdlp', fetchFromSoundCloud],
        ['scdl',     fetchFromSoundCloudScdl],
        ['apple',    fetchFromAppleMusic],
        ['deezer',   fetchFromDeezer],
    ]) {
        try { return await fn(query, maxBytes, onStatus); }
        catch (e) { errors.push(`${name}: ${e.message}`); console.warn(`[music] ${name} failed:`, e.message); }
    }
    throw new Error(`all music sources failed — ${errors.join(' | ')}`);
        }
