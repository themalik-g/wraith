// ─────────────────────────────────────────────
// WRAITH · lib/music-sources.js
// Keyless audio sources: SoundCloud, Deezer, Apple Music
// + Pure-JS MP3 conversion (audio-decode + lamejs)
// ─────────────────────────────────────────────

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

async function fetchBuffer(url, timeoutMs = 30_000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const res = await fetch(url, {
            signal: ctrl.signal,
            headers: {
                'User-Agent':
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
                    'Chrome/124.0.0.0 Safari/537.36',
                Accept: '*/*',
            },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return Buffer.from(await res.arrayBuffer());
    } finally {
        clearTimeout(timer);
    }
}

// ─── Detect audio format from magic bytes ───
export function detectAudioFormat(buf) {
    if (!buf || buf.length < 12) return { ext: 'mp3', mime: 'audio/mpeg' };

    const a4 = buf.toString('ascii', 4, 8);
    const a0 = buf.toString('ascii', 0, 4);

    if (a4 === 'ftyp') return { ext: 'm4a', mime: 'audio/mp4' };
    if (a0 === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) {
        return { ext: 'mp3', mime: 'audio/mpeg' };
    }
    if (a0 === 'OggS') return { ext: 'ogg', mime: 'audio/ogg; codecs=opus' };
    if (a0 === 'RIFF') return { ext: 'wav', mime: 'audio/wav' };

    return { ext: 'mp3', mime: 'audio/mpeg' };
}

// ─── Pure-JS MP3 Conversion ───
let _decodeAudio = null;
let _lamejs = null;

async function getDecodeAudio() {
    if (_decodeAudio) return _decodeAudio;
    try {
        const mod = await import('audio-decode');
        _decodeAudio = mod.default;
        return _decodeAudio;
    } catch (e) {
        console.warn('[audio] audio-decode not available:', e.message);
        return null;
    }
}

function getLamejs() {
    if (_lamejs) return _lamejs;
    try {
        _lamejs = require('lamejs');
        return _lamejs;
    } catch (e) {
        console.warn('[audio] lamejs not available:', e.message);
        return null;
    }
}

export async function convertToMp3(buffer, inputExt) {
    const decodeAudio = await getDecodeAudio();
    const lamejs = getLamejs();

    if (!decodeAudio || !lamejs) {
        throw new Error('audio conversion libraries not installed');
    }

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

    const kbps = 192;
    const encoder = new lamejs.Mp3Encoder(channels, sampleRate, kbps);

    const BLOCK = 1152;
    const chunks = [];

    for (let i = 0; i < length; i += BLOCK) {
        const l = leftPcm.subarray(i, i + BLOCK);
        const r = rightPcm ? rightPcm.subarray(i, i + BLOCK) : undefined;
        const mp3buf = channels === 1
            ? encoder.encodeBuffer(l)
            : encoder.encodeBuffer(l, r);
        if (mp3buf.length > 0) chunks.push(Buffer.from(mp3buf));
    }

    const flush = encoder.flush();
    if (flush.length > 0) chunks.push(Buffer.from(flush));

    const out = Buffer.concat(chunks);
    if (!out.length) throw new Error('MP3 encoding produced empty output');

    return out;
}

// ─── Score a track against the query ───
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
        if (words.length) {
            const hits = words.filter((w) => t.includes(w)).length;
            score += (hits / words.length) * 40;
        }
    }

    if (ar && q.includes(ar)) score += 35;
    else if (ar && ar.includes(q)) score += 25;

    if (dur >= 120 && dur <= 420) score += 30;
    else if (dur > 420) score += 10;
    else if (dur > 90 && dur < 120) score += 5;
    else if (dur < 60) score -= 40;
    else if (dur < 90) score -= 15;

    const bad = [
        'cover', 'remix', 'live', 'instrumental', 'karaoke',
        'reaction', 'sped up', 'slowed', 'nightcore', 'tribute', 'parody',
    ];
    for (const w of bad) if (t.includes(w)) score -= 25;

    return score;
}

function pickBest(tracks, query, mapFn) {
    if (!tracks?.length) return null;
    const scored = tracks
        .map((t) => ({ raw: t, meta: mapFn(t) }))
        .filter((x) => x.meta && x.meta.title)
        .map((x) => ({ ...x, score: scoreTrack(x.meta, query) }))
        .sort((a, b) => b.score - a.score);
    return scored[0]?.raw || null;
}

// ─────────────────────────────────────────────
// TIER 1: SoundCloud
// ─────────────────────────────────────────────
export async function fetchFromSoundCloud(query, maxBytes, onStatus) {
    const scdl = require('@snwfdhmp/soundcloud-downloader').default;

    if (onStatus) onStatus('🎵 searching SoundCloud...');

    const results = await scdl.search({
        query,
        resourceType: 'tracks',
        limit: 15,
    });

    const collection = results?.collection || [];
    if (!collection.length) throw new Error('no SoundCloud results');

    const streamable = collection.filter((t) => t.streamable);
    if (!streamable.length) throw new Error('no streamable SoundCloud results');

    const best = pickBest(streamable, query, (t) => ({
        title: t.title,
        artist: t.user?.username,
        duration: (t.duration || 0) / 1000,
    }));

    if (!best) throw new Error('no suitable SoundCloud track');

    if (onStatus) {
        onStatus(
            `⬇️ SoundCloud: ${best.user?.username || 'unknown'} — ${best.title}...`
        );
    }

    const stream = await scdl.download(best.permalink_url);

    const chunks = [];
    let total = 0;

    for await (const chunk of stream) {
        chunks.push(chunk);
        total += chunk.length;
        if (total > maxBytes) {
            throw new Error(`SoundCloud file too large (>${(maxBytes / 1048576).toFixed(0)} MB)`);
        }
    }

    const buffer = Buffer.concat(chunks);
    const fmt = detectAudioFormat(buffer);

    if (onStatus) {
        onStatus(`✅ SoundCloud complete (${(buffer.length / 1048576).toFixed(1)} MB · ${fmt.ext})`);
    }

    return {
        buffer,
        title: best.title,
        artist: best.user?.username || '',
        artwork: best.artwork_url || null,
        provider: 'soundcloud',
        size: buffer.length,
        format: fmt.ext,
        mimetype: fmt.mime,
    };
}

// ─────────────────────────────────────────────
// TIER 2: Deezer
// ─────────────────────────────────────────────
export async function fetchFromDeezer(query, maxBytes, onStatus) {
    if (onStatus) onStatus('🎧 searching Deezer...');

    const url = `https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=15`;

    const res = await fetch(url, {
        headers: {
            'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
                'Chrome/124.0.0.0 Safari/537.36',
        },
    });

    if (!res.ok) throw new Error(`Deezer HTTP ${res.status}`);

    const data = await res.json();
    const tracks = data?.data || [];

    const best = pickBest(tracks, query, (t) => ({
        title: t.title,
        artist: t.artist?.name,
        duration: t.duration,
    }));

    if (!best) throw new Error('no Deezer results');
    if (!best.preview) throw new Error('no preview URL in Deezer result');

    if (onStatus) {
        onStatus(`⬇️ Deezer preview: ${best.artist?.name || 'unknown'} — ${best.title}...`);
    }

    const buffer = await fetchBuffer(best.preview, 20_000);
    if (buffer.length > maxBytes) throw new Error('Deezer preview too large');

    const fmt = detectAudioFormat(buffer);

    if (onStatus) {
        onStatus(`✅ Deezer preview complete (${(buffer.length / 1048576).toFixed(1)} MB · ${fmt.ext})`);
    }

    return {
        buffer,
        title: best.title,
        artist: best.artist?.name || '',
        artwork: best.album?.cover_xl || best.album?.cover_big || null,
        provider: 'deezer',
        size: buffer.length,
        format: fmt.ext,
        mimetype: fmt.mime,
    };
}

// ─────────────────────────────────────────────
// TIER 3: Apple Music
// ─────────────────────────────────────────────
export async function fetchFromAppleMusic(query, maxBytes, onStatus) {
    if (onStatus) onStatus('🍎 searching Apple Music...');

    const url =
        `https://itunes.apple.com/search?term=${encodeURIComponent(query)}` +
        `&media=music&entity=song&limit=15`;

    const res = await fetch(url, {
        headers: {
            'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
                'Chrome/124.0.0.0 Safari/537.36',
        },
    });

    if (!res.ok) throw new Error(`iTunes HTTP ${res.status}`);

    const data = await res.json();
    const tracks = data?.results || [];

    const best = pickBest(tracks, query, (t) => ({
        title: t.trackName,
        artist: t.artistName,
        duration: (t.trackTimeMillis || 0) / 1000,
    }));

    if (!best) throw new Error('no Apple Music results');
    if (!best.previewUrl) throw new Error('no preview URL in Apple Music result');

    if (onStatus) {
        onStatus(`⬇️ Apple Music preview: ${best.artistName} — ${best.trackName}...`);
    }

    const buffer = await fetchBuffer(best.previewUrl, 20_000);
    if (buffer.length > maxBytes) throw new Error('Apple Music preview too large');

    const fmt = detectAudioFormat(buffer);

    if (onStatus) {
        onStatus(`✅ Apple Music preview complete (${(buffer.length / 1048576).toFixed(1)} MB · ${fmt.ext})`);
    }

    return {
        buffer,
        title: best.trackName,
        artist: best.artistName,
        artwork: (best.artworkUrl100 || '').replace('100x100', '600x600') || null,
        provider: 'apple-music',
        size: buffer.length,
        format: fmt.ext,
        mimetype: fmt.mime,
    };
}

// ─────────────────────────────────────────────
// Combined
// ─────────────────────────────────────────────
export async function fetchAudioFromAnySource(query, maxBytes, onStatus) {
    const errors = [];

    try {
        return await fetchFromSoundCloud(query, maxBytes, onStatus);
    } catch (e) {
        errors.push(`soundcloud: ${e.message}`);
        console.warn('[music] SoundCloud failed:', e.message);
    }

    try {
        return await fetchFromDeezer(query, maxBytes, onStatus);
    } catch (e) {
        errors.push(`deezer: ${e.message}`);
        console.warn('[music] Deezer failed:', e.message);
    }

    try {
        return await fetchFromAppleMusic(query, maxBytes, onStatus);
    } catch (e) {
        errors.push(`apple: ${e.message}`);
        console.warn('[music] Apple Music failed:', e.message);
    }

    throw new Error(`all music sources failed — ${errors.join(' | ')}`);
}
