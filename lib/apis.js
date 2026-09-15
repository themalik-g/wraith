// lib/apis.js — All external API wrappers with fallbacks
import { httpGetJson, httpGetText, raceApis, downloadToFile } from './net.js';

// ── BOOKS ───────────────────────────────────────────────────────────────────
export async function searchBooks(query, limit = 5) {
  const r = await raceApis([
    { url: `https://gutendex.com/books?search=${encodeURIComponent(query)}&languages=en`, opts: { timeout: 12000 } },
    { url: `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=${limit}`, opts: { timeout: 12000 } },
  ], (d) => (d.results && d.results.length > 0) || (d.docs && d.docs.length > 0));

  if (!r.ok) return { ok: false, books: [] };

  // Normalize to common shape
  const books = [];
  if (r.source.includes('gutendex')) {
    for (const b of (r.data.results || []).slice(0, limit)) {
      const epub = (b.formats || {})['application/epub+zip'];
      const txt = (b.formats || {})['text/plain; charset=utf-8'] || (b.formats || {})['text/plain'];
      books.push({ id: b.id, title: b.title, author: (b.authors?.[0]?.name) || 'Unknown', year: b.authors?.[0]?.birth_year ? null : null, url: epub || txt || null, format: epub ? 'epub' : 'txt', downloadCount: b.download_count || 0 });
    }
  } else {
    for (const d of (r.data.docs || []).slice(0, limit)) {
      books.push({ id: d.key?.replace('/works/', ''), title: d.title, author: (d.author_name?.[0]) || 'Unknown', year: d.first_publish_year, url: d.ia ? `https://archive.org/download/${d.ia[0]}/${d.ia[0]}.pdf` : null, format: 'pdf', downloadCount: d.ia?.length ? 1 : 0 });
    }
  }
  return { ok: true, books, source: r.source };
}

// ── MOVIE ───────────────────────────────────────────────────────────────────
export async function searchMovie(query) {
  const r = await raceApis([
    { url: `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=movie&limit=1`, opts: { timeout: 12000 } },
    { url: `https://api.tvmaze.com/search/shows?q=${encodeURIComponent(query)}`, opts: { timeout: 12000 } },
  ], (d) => (d.results && d.results.length > 0) || (Array.isArray(d) && d.length > 0));

  if (!r.ok) return { ok: false };

  if (r.source.includes('itunes')) {
    const m = r.data.results[0];
    return { ok: true, title: m.trackName, director: m.artistName, year: m.releaseDate?.slice(0, 4), genre: m.primaryGenreName, description: m.longDescription || m.shortDescription, poster: m.artworkUrl100?.replace('100x100', '600x600'), rating: m.contentAdvisoryRating, source: 'iTunes' };
  } else {
    const s = r.data[0]?.show;
    if (!s) return { ok: false };
    return { ok: true, title: s.name, director: s.network?.name || '—', year: s.premiered?.slice(0, 4), genre: s.genres?.join(', '), description: (s.summary || '').replace(/<[^>]+>/g, ''), poster: s.image?.original, rating: s.rating?.average || '—', source: 'TVmaze' };
  }
}

// ── SONG ────────────────────────────────────────────────────────────────────
export async function searchSong(query) {
  const r = await raceApis([
    { url: `https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=1`, opts: { timeout: 12000 } },
    { url: `https://musicbrainz.org/ws/2/recording?query=${encodeURIComponent(query)}&fmt=json&limit=1`, opts: { timeout: 12000, headers: { 'User-Agent': 'WRAITH-Bot/1.0' } } },
  ], (d) => (d.data && d.data.length > 0) || (d.recordings && d.recordings.length > 0));

  if (!r.ok) return { ok: false };

  if (r.source.includes('deezer')) {
    const t = r.data.data[0];
    return { ok: true, title: t.title, artist: t.artist?.name, album: t.album?.title, duration: t.duration, cover: t.album?.cover_xl || t.album?.cover_big, preview: t.preview, source: 'Deezer' };
  } else {
    const rec = r.data.recordings[0];
    if (!rec) return { ok: false };
    const artistCredit = rec['artist-credit']?.map((a) => a.name).join(', ') || 'Unknown';
    return { ok: true, title: rec.title, artist: artistCredit, album: rec.releases?.[0]?.title || '—', duration: rec.length ? Math.round(rec.length / 1000) : 0, cover: `https://coverartarchive.org/release/${rec.releases?.[0]?.id}/front-250` || null, preview: null, source: 'MusicBrainz' };
  }
}

// ── LYRICS ──────────────────────────────────────────────────────────────────
export async function fetchLyrics(artist, title) {
  const r = await raceApis([
    { url: `https://lrclib.net/api/get?artist_name=${encodeURIComponent(artist)}&track_name=${encodeURIComponent(title)}`, opts: { timeout: 12000 } },
    { url: `https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`, opts: { timeout: 12000 } },
  ], (d) => (d.plainLyrics && d.plainLyrics.length > 10) || (d.lyrics && d.lyrics.length > 10));

  if (!r.ok) return { ok: false };
  const lyrics = r.data.plainLyrics || r.data.lyrics || '';
  return { ok: true, lyrics, source: r.source.includes('lrclib') ? 'LRCLIB' : 'lyrics.ovh' };
}

// ── STOCK IMAGES ────────────────────────────────────────────────────────────
export async function searchImages(query, count = 5) {
  const r = await raceApis([
    { url: `https://tteg-api-53227342417.asia-south1.run.app/search?q=${encodeURIComponent(query)}&count=${count}`, opts: { timeout: 15000 } },
    { url: `https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}&page_size=${count}`, opts: { timeout: 15000 } },
  ], (d) => (d.results && d.results.length > 0) || (d.photos && d.photos.length > 0) || (Array.isArray(d) && d.length > 0));

  if (!r.ok) return { ok: false, images: [] };

  const images = [];
  const data = r.data;
  const list = data.results || data.photos || (Array.isArray(data) ? data : []);
  for (const item of list.slice(0, count)) {
    images.push({ url: item.url || item.thumb || item.download_url, thumb: item.thumb || item.url, title: item.title || query, source: r.source.includes('tteg') ? 'Unsplash' : 'Openverse' });
  }
  return { ok: true, images };
}

// ── WEATHER ─────────────────────────────────────────────────────────────────
export async function fetchWeather(city, stormThreshold = 50) {
  let lat = null, lon = null, label = city;
  try {
    const geo = await httpGetJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`);
    const r = geo?.results?.[0];
    if (r) { lat = r.latitude; lon = r.longitude; label = `${r.name}, ${r.country || ''}`.trim(); }
  } catch {}

  if (lat !== null) {
    try {
      const fc = await httpGetJson(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=precipitation_probability_max,weathercode,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=5`);
      const d = fc?.daily;
      if (d?.time) {
        const days = [];
        let warned = false;
        for (let i = 0; i < d.time.length; i++) {
          const pop = d.precipitation_probability_max?.[i] ?? 0;
          const wc = d.weathercode?.[i] ?? 0;
          const warn = pop >= stormThreshold || [95, 96, 99].includes(wc);
          if (warn) warned = true;
          days.push({ date: d.time[i], pop, weathercode: wc, tmax: d.temperature_2m_max?.[i], tmin: d.temperature_2m_min?.[i], warn });
        }
        return { ok: true, label, days, warned, source: 'Open-Meteo' };
      }
    } catch {}
  }

  // Fallback: wttr.in
  try {
    const w = await httpGetJson(`https://wttr.in/${encodeURIComponent(city)}?format=j1`);
    const cur = w?.current_condition?.[0];
    if (cur) {
      label = w.nearest_area?.[0]?.areaName?.[0]?.value || city;
      return { ok: true, label, current: { temp: cur.temp_C, feels: cur.FeelsLikeC, desc: cur.weatherDesc?.[0]?.value, humidity: cur.humidity, wind: cur.windspeedKmph }, warned: false, source: 'wttr.in' };
    }
  } catch {}

  return { ok: false };
}

// ── CURRENCY ────────────────────────────────────────────────────────────────
export async function fetchCurrency(from, to) {
  const r = await raceApis([
    { url: `https://api.exchangerate.fun/latest?base=${encodeURIComponent(from)}`, opts: { timeout: 12000 } },
    { url: `https://open.er-api.com/v6/latest/${encodeURIComponent(from)}`, opts: { timeout: 12000 } },
    { url: `https://api.frankfurter.app/latest?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, opts: { timeout: 12000 } },
  ], (d) => {
    const rates = d?.rates || d?.conversion_rates;
    return rates && typeof rates[to] === 'number';
  });

  if (!r.ok) return { ok: false };
  const rates = r.data.rates || r.data.conversion_rates;
  return { ok: true, rate: rates[to], source: r.source };
}

// ── DEFINE ──────────────────────────────────────────────────────────────────
export async function defineWord(word) {
  const r = await raceApis([
    { url: `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`, opts: { timeout: 10000 } },
    { url: `https://api.dictionaryapi.dev/api/v2/entries/en_US/${encodeURIComponent(word)}`, opts: { timeout: 10000 } },
  ], (d) => Array.isArray(d) && d.length > 0 && d[0].meanings);

  if (r.ok) return { ok: true, entry: r.data[0], source: 'dictionaryapi.dev' };

  try {
    const wk = await httpGetJson(`https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(word)}`);
    const defs = wk?.en?.[0]?.definitions || [];
    if (defs.length) return { ok: true, wiktionary: defs, source: 'Wiktionary' };
  } catch {}

  return { ok: false };
}

// ── PWNED ───────────────────────────────────────────────────────────────────
export async function checkPwned(password) {
  const crypto = await import('node:crypto');
  const sha1 = crypto.createHash('sha1').update(password).digest('hex').toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);
  const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
    headers: { 'User-Agent': 'WRAITH-Bot/1.0' },
  });
  if (!res.ok) throw new Error(`HIBP HTTP ${res.status}`);
  const body = await res.text();
  const line = body.split('\n').find((l) => l.startsWith(suffix));
  return { count: line ? parseInt(line.split(':')[1], 10) : 0 };
}

// ── QR ──────────────────────────────────────────────────────────────────────
export async function generateQr(text) {
  const urls = [
    `https://api.qrserver.com/v1/create-qr-code/?size=600x600&data=${encodeURIComponent(text)}`,
    `https://quickchart.io/qr?size=600&text=${encodeURIComponent(text)}`,
  ];
  for (const u of urls) {
    try {
      const buf = await fetch(u).then((r) => r.arrayBuffer());
      return { ok: true, buffer: Buffer.from(buf), source: u.includes('qrserver') ? 'qrserver' : 'quickchart' };
    } catch {}
  }
  return { ok: false };
}

export async function decodeQr(imageBuffer, mimeType = 'image/png') {
  const form = new FormData();
  form.append('file', new Blob([imageBuffer], { type: mimeType }), 'qr.png');
  const res = await fetch('https://api.qrserver.com/v1/read-qr-code/', { method: 'POST', body: form });
  if (!res.ok) throw new Error(`QR read HTTP ${res.status}`);
  const data = await res.json();
  return { decoded: data?.[0]?.symbol?.[0]?.data || null };
}
