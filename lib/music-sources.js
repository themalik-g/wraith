// ─────────────────────────────────────────────
// WRAITH · lib/music-sources.js
// Keyless audio sources: SoundCloud, Apple Music, Deezer
// No YouTube, no cookies, no auth.
// ─────────────────────────────────────────────

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// ─── Fetch with timeout ───
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

// ─────────────────────────────────────────────
// TIER 1: SoundCloud (full tracks, no auth)
// ─────────────────────────────────────────────
export async function fetchFromSoundCloud(query, maxBytes, onStatus) {
    const scdl = require('@snwfdhmp/soundcloud-downloader').default;

    if (onStatus) onStatus('🎵 searching SoundCloud...');

    const results = await scdl.search({
        query,
        resourceType: 'tracks',
        limit: 5,
    });

    if (!results?.collection?.length) {
        throw new Error('no SoundCloud results');
    }

    const track =
        results.collection.find((t) => t.streamable) || results.collection[0];

    if (!track.streamable) {
        throw new Error('SoundCloud track not streamable');
    }

    if (onStatus) {
        onStatus(
            `⬇️ SoundCloud: ${track.user?.username || 'unknown'} — ${track.title}...`
        );
    }

    const stream = await scdl.download(track.permalink_url);

    const chunks = [];
    let total = 0;

    for await (const chunk of stream) {
        chunks.push(chunk);
        total += chunk.length;
        if (total > maxBytes) {
            throw new Error(
                `SoundCloud file too large (>${(maxBytes / 1048576).toFixed(0)} MB)`
            );
        }
    }

    const buffer = Buffer.concat(chunks);

    if (onStatus) {
        onStatus(
            `✅ SoundCloud complete (${(buffer.length / 1048576).toFixed(1)} MB)`
        );
    }

    return {
        buffer,
        title: track.title,
        artist: track.user?.username || '',
        artwork: track.artwork_url || null,
        provider: 'soundcloud',
        size: buffer.length,
    };
}

// ─────────────────────────────────────────────
// TIER 2: Apple Music preview (30s, keyless)
// ─────────────────────────────────────────────
export async function fetchFromAppleMusic(query, maxBytes, onStatus) {
    if (onStatus) onStatus('🍎 searching Apple Music...');

    const url =
        `https://itunes.apple.com/search?term=${encodeURIComponent(query)}` +
        `&media=music&entity=song&limit=1`;

    const res = await fetch(url, {
        headers: {
            'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
                'Chrome/124.0.0.0 Safari/537.36',
        },
    });

    if (!res.ok) throw new Error(`iTunes HTTP ${res.status}`);

    const data = await res.json();
    const track = data?.results?.[0];

    if (!track) throw new Error('no Apple Music results');
    if (!track.previewUrl) throw new Error('no preview URL in Apple Music result');

    if (onStatus) {
        onStatus(
            `⬇️ Apple Music preview: ${track.artistName} — ${track.trackName}...`
        );
    }

    const buffer = await fetchBuffer(track.previewUrl, 20_000);

    if (buffer.length > maxBytes) {
        throw new Error('Apple Music preview too large');
    }

    if (onStatus) {
        onStatus(
            `✅ Apple Music preview complete (${(buffer.length / 1048576).toFixed(1)} MB)`
        );
    }

    return {
        buffer,
        title: track.trackName,
        artist: track.artistName,
        artwork:
            (track.artworkUrl100 || '').replace('100x100', '600x600') || null,
        provider: 'apple-music',
        size: buffer.length,
    };
}

// ─────────────────────────────────────────────
// TIER 3: Deezer preview (30s, keyless)
// ─────────────────────────────────────────────
export async function fetchFromDeezer(query, maxBytes, onStatus) {
    if (onStatus) onStatus('🎧 searching Deezer...');

    const url =
        `https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=1`;

    const res = await fetch(url, {
        headers: {
            'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
                'Chrome/124.0.0.0 Safari/537.36',
        },
    });

    if (!res.ok) throw new Error(`Deezer HTTP ${res.status}`);

    const data = await res.json();
    const track = data?.data?.[0];

    if (!track) throw new Error('no Deezer results');
    if (!track.preview) throw new Error('no preview URL in Deezer result');

    if (onStatus) {
        onStatus(
            `⬇️ Deezer preview: ${track.artist?.name || 'unknown'} — ${track.title}...`
        );
    }

    const buffer = await fetchBuffer(track.preview, 20_000);

    if (buffer.length > maxBytes) {
        throw new Error('Deezer preview too large');
    }

    if (onStatus) {
        onStatus(
            `✅ Deezer preview complete (${(buffer.length / 1048576).toFixed(1)} MB)`
        );
    }

    return {
        buffer,
        title: track.title,
        artist: track.artist?.name || '',
        artwork: track.album?.cover_xl || track.album?.cover_big || null,
        provider: 'deezer',
        size: buffer.length,
    };
}

// ─────────────────────────────────────────────
// Combined: try all sources in order
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
        return await fetchFromAppleMusic(query, maxBytes, onStatus);
    } catch (e) {
        errors.push(`apple: ${e.message}`);
        console.warn('[music] Apple Music failed:', e.message);
    }

    try {
        return await fetchFromDeezer(query, maxBytes, onStatus);
    } catch (e) {
        errors.push(`deezer: ${e.message}`);
        console.warn('[music] Deezer failed:', e.message);
    }

    throw new Error(`all music sources failed — ${errors.join(' | ')}`);
}
