// lib/apis.js — All external API wrappers with fallbacks
import { httpGetJson, httpGetText, raceApis, raceApisParallel, downloadToFile, BROWSER_USER_AGENT } from './net.js';

async function fetchBuffer(url, { timeout = 15000, method = 'GET', headers = {}, body = null } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      method,
      headers: { 'User-Agent': BROWSER_USER_AGENT, ...headers },
      body,
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

// ── URL SHORTENER ────────────────────────────────────────────────────────────

export async function shortenUrl(longUrl) {
  // 1. TinyURL
  try {
    const text = await httpGetText(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(longUrl)}`, { timeout: 10000 });
    if (text && text.startsWith('http')) {
      return { ok: true, shortUrl: text.trim(), service: 'TinyURL' };
    }
  } catch {}

  // 2. is.gd
  try {
    const res = await httpGetJson(`https://is.gd/create.php?format=json&url=${encodeURIComponent(longUrl)}`, { timeout: 10000 });
    if (res?.shorturl) {
      return { ok: true, shortUrl: res.shorturl, service: 'is.gd' };
    }
  } catch {}

  return { ok: false };
}

// ── NEWS ────────────────────────────────────────────────────────────────────

export async function fetchNews(topic = '') {
  try {
    const query = topic ? encodeURIComponent(topic) : '';
    const rssUrl = query
      ? `https://news.google.com/rss/search?q=${query}&hl=en-US&gl=US&ceid=US:en`
      : `https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en`;

    const api = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(rssUrl)}`;
    const data = await httpGetJson(api, { timeout: 12000 });

    if (data?.items && data.items.length > 0) {
      const articles = data.items.slice(0, 8).map((item) => ({
        title: (item.title || '').replace(/<[^>]+>/g, '').trim(),
        link: item.link || item.guid,
        pubDate: item.pubDate ? item.pubDate.slice(0, 16) : '',
        source: item.author || 'Google News',
      }));
      return { ok: true, topic: topic || 'Global Top Headlines', articles };
    }
  } catch {}

  return { ok: false };
}

// ── HACKER NEWS ─────────────────────────────────────────────────────────────

export async function fetchHackerNews(limit = 8) {
  try {
    const topIds = await httpGetJson('https://hacker-news.firebaseio.com/v0/topstories.json', { timeout: 10000 });
    if (Array.isArray(topIds) && topIds.length > 0) {
      const ids = topIds.slice(0, limit);
      const stories = [];

      for (const id of ids) {
        try {
          const item = await httpGetJson(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, { timeout: 5000 });
          if (item && item.title) {
            stories.push({
              title: item.title,
              url: item.url || `https://news.ycombinator.com/item?id=${id}`,
              points: item.score || 0,
              author: item.by || 'anonymous',
              comments: item.descendants || 0,
            });
          }
        } catch {}
      }

      if (stories.length > 0) {
        return { ok: true, stories };
      }
    }
  } catch {}

  return { ok: false };
}

// ── WIKIPEDIA ───────────────────────────────────────────────────────────────

export async function searchWikipedia(query) {
  try {
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query.replace(/\s+/g, '_'))}`;
    const data = await httpGetJson(url, { timeout: 10000, headers: { 'User-Agent': BROWSER_USER_AGENT } });

    if (data && data.title && data.extract) {
      return {
        ok: true,
        title: data.title,
        description: data.description || '',
        extract: data.extract,
        url: data.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(query)}`,
        thumbnail: data.thumbnail?.source || null,
      };
    }
  } catch {}

  return { ok: false };
}

// ── FUN UTILITIES (JOKE, ADVICE, FACT) ──────────────────────────────────────

export async function fetchJoke() {
  try {
    const data = await httpGetJson('https://v2.jokeapi.dev/joke/Any?blacklistFlags=nsfw,religious,political,racist,sexist,explicit', { timeout: 8000 });
    if (data) {
      if (data.type === 'single') return { ok: true, joke: data.joke };
      if (data.type === 'twopart') return { ok: true, joke: `${data.setup}\n\n_${data.delivery}_` };
    }
  } catch {}
  return { ok: false };
}

export async function fetchAdvice() {
  try {
    const data = await httpGetJson('https://api.adviceslip.com/advice', { timeout: 8000 });
    if (data?.slip?.advice) {
      return { ok: true, advice: data.slip.advice };
    }
  } catch {}
  return { ok: false };
}

export async function fetchFact() {
  try {
    const data = await httpGetJson('https://uselessfacts.jsph.pl/api/v2/facts/random', { timeout: 8000 });
    if (data?.text) {
      return { ok: true, fact: data.text };
    }
  } catch {}
  return { ok: false };
}

// ── BOOKS — Multi-Tier search with Gutenberg, Direct Internet Archive & Open Library ──

async function resolveArchiveDetails(ia) {
  try {
    const meta = await httpGetJson(`https://archive.org/metadata/${ia}`, { timeout: 8000 });
    const isRestricted = meta?.metadata?.['access-restricted-item'] === 'true';
    const files = meta?.files || [];

    const pdf =
      files.find(
        (f) =>
          /\.pdf$/i.test(f.name) &&
          !/scandata|djvu|text|epub|_bw\.|_text/i.test(f.name) &&
          f.private !== 'true'
      ) || files.find((f) => /\.pdf$/i.test(f.name) && f.private !== 'true');

    const epub = files.find((f) => /\.epub$/i.test(f.name) && f.private !== 'true');

    let downloadUrl = null;
    let format = 'pdf';

    if (!isRestricted) {
      if (pdf) {
        downloadUrl = `https://archive.org/download/${ia}/${encodeURIComponent(pdf.name)}`;
        format = 'pdf';
      } else if (epub) {
        downloadUrl = `https://archive.org/download/${ia}/${encodeURIComponent(epub.name)}`;
        format = 'epub';
      }
    }

    return {
      downloadUrl,
      format,
      isRestricted,
      webUrl: `https://archive.org/details/${ia}`,
    };
  } catch {}
  return null;
}

export async function searchBooks(query, limit = 8) {
  const books = [];
  const seenIds = new Set();

  // ── Tier 1: Direct Internet Archive Search (Best for Medical, Academic & MBBS/PharmD/BDS) ──
  try {
    const iaSearchUrl = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(
      query
    )}+AND+mediatype:texts&fl[]=identifier,title,creator,year&sort[]=downloads+desc&rows=${limit * 2}&page=1&output=json`;
    const iaRes = await httpGetJson(iaSearchUrl, { timeout: 12000 });
    const docs = iaRes?.response?.docs || [];

    for (const d of docs) {
      if (books.length >= limit) break;
      if (!d.identifier || seenIds.has(d.identifier)) continue;

      const details = await resolveArchiveDetails(d.identifier);
      if (!details) continue;

      seenIds.add(d.identifier);
      books.push({
        id: d.identifier,
        title: d.title || 'Unknown',
        author: Array.isArray(d.creator) ? d.creator.join(', ') : d.creator || 'Unknown',
        year: d.year || null,
        url: details.downloadUrl,
        format: details.format,
        webUrl: details.webUrl,
        isRestricted: details.isRestricted,
        source: 'Internet Archive',
      });
    }
  } catch (e) {
    console.warn('[books] Direct Internet Archive search failed:', e.message);
  }

  // ── Tier 2: Project Gutenberg (Classics / General Literature) ──
  if (books.length < limit) {
    try {
      const gutRes = await httpGetJson(
        `https://gutendex.com/books?search=${encodeURIComponent(query)}&languages=en`,
        { timeout: 10000, headers: { 'User-Agent': BROWSER_USER_AGENT } }
      );
      if (gutRes?.results?.length) {
        for (const b of gutRes.results) {
          if (books.length >= limit) break;
          const gutId = `gutenberg_${b.id}`;
          if (seenIds.has(gutId)) continue;

          const formats = b.formats || {};
          const epub = formats['application/epub+zip'];
          const pdf = formats['application/pdf'];
          const txt = formats['text/plain; charset=utf-8'] || formats['text/plain'];
          const url = epub || pdf || txt;

          seenIds.add(gutId);
          books.push({
            id: gutId,
            title: b.title,
            author: b.authors?.[0]?.name || 'Unknown',
            year: null,
            url: url || null,
            format: epub ? 'epub' : pdf ? 'pdf' : 'txt',
            webUrl: `https://www.gutenberg.org/ebooks/${b.id}`,
            isRestricted: false,
            source: 'Project Gutenberg',
          });
        }
      }
    } catch (e) {
      console.warn('[books] Gutenberg search failed:', e.message);
    }
  }

  // ── Tier 3: Open Library ──
  if (books.length < limit) {
    try {
      const openLibRes = await httpGetJson(
        `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=${limit * 2}`,
        { timeout: 10000 }
      );
      const docs = openLibRes?.docs || [];
      for (const d of docs) {
        if (books.length >= limit) break;
        const ia = Array.isArray(d.ia) ? d.ia[0] : null;
        if (!ia || seenIds.has(ia)) continue;

        const details = await resolveArchiveDetails(ia);
        if (!details) continue;

        seenIds.add(ia);
        books.push({
          id: (d.key || '').replace('/works/', '') || ia,
          title: d.title || 'Unknown',
          author: (d.author_name || ['Unknown']).join(', '),
          year: d.first_publish_year || null,
          url: details.downloadUrl,
          format: details.format,
          webUrl: details.webUrl,
          isRestricted: details.isRestricted,
          source: 'Open Library',
        });
      }
    } catch (e) {
      console.warn('[books] Open Library search failed:', e.message);
    }
  }

  if (!books.length) return { ok: false, books: [] };

  // Sort downloadable books first before returning
  books.sort((a, b) => (b.url ? 1 : 0) - (a.url ? 1 : 0));

  return { ok: true, books, source: 'Free Digital Libraries' };
}

// ── MOVIE ───────────────────────────────────────────────────────────────────

export async function searchMovie(query) {
  const r = await raceApis(
    [
      {
        url: `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=movie&limit=1`,
        opts: { timeout: 12000 },
      },
      {
        url: `https://api.tvmaze.com/search/shows?q=${encodeURIComponent(query)}`,
        opts: { timeout: 12000 },
      },
    ],
    (d) => (d.results && d.results.length > 0) || (Array.isArray(d) && d.length > 0)
  );

  if (!r.ok) return { ok: false };

  if (r.source.includes('itunes')) {
    const m = r.data.results[0];
    return {
      ok: true,
      title: m.trackName,
      director: m.artistName,
      year: m.releaseDate?.slice(0, 4),
      genre: m.primaryGenreName,
      description: m.longDescription || m.shortDescription,
      poster: m.artworkUrl100?.replace('100x100', '600x600'),
      rating: m.contentAdvisoryRating,
      source: 'iTunes',
    };
  }

  const s = r.data[0]?.show;
  if (!s) return { ok: false };
  return {
    ok: true,
    title: s.name,
    director: s.network?.name || '—',
    year: s.premiered?.slice(0, 4),
    genre: s.genres?.join(', '),
    description: (s.summary || '').replace(/<[^>]+>/g, ''),
    poster: s.image?.original,
    rating: s.rating?.average || '—',
    source: 'TVmaze',
  };
}

// ── SONG INFO ───────────────────────────────────────────────────────────────

export async function searchSong(query) {
  const r = await raceApis(
    [
      {
        url: `https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=1`,
        opts: { timeout: 12000 },
      },
      {
        url: `https://musicbrainz.org/ws/2/recording?query=${encodeURIComponent(query)}&fmt=json&limit=1`,
        opts: { timeout: 12000, headers: { 'User-Agent': 'WRAITH-Bot/1.0 (github.com/themalik-g/wraith)' } },
      },
    ],
    (d) => (d.data && d.data.length > 0) || (d.recordings && d.recordings.length > 0)
  );

  if (!r.ok) return { ok: false };

  if (r.source.includes('deezer')) {
    const t = r.data.data[0];
    return {
      ok: true,
      title: t.title,
      artist: t.artist?.name,
      album: t.album?.title,
      duration: t.duration,
      cover: t.album?.cover_xl || t.album?.cover_big,
      preview: t.preview,
      source: 'Deezer',
    };
  }

  const rec = r.data.recordings[0];
  if (!rec) return { ok: false };
  return {
    ok: true,
    title: rec.title,
    artist: (rec['artist-credit'] || []).map((a) => a.name).join(', ') || 'Unknown',
    album: rec.releases?.[0]?.title || '—',
    duration: rec.length ? Math.round(rec.length / 1000) : 0,
    cover: rec.releases?.[0]?.id
      ? `https://coverartarchive.org/release/${rec.releases[0].id}/front-250`
      : null,
    preview: null,
    source: 'MusicBrainz',
  };
}

// ── LYRICS ──────────────────────────────────────────────────────────────────

export async function fetchLyrics(artist, title) {
  const r = await raceApis(
    [
      {
        url: `https://lrclib.net/api/get?artist_name=${encodeURIComponent(artist)}&track_name=${encodeURIComponent(title)}`,
        opts: { timeout: 12000 },
      },
      {
        url: `https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`,
        opts: { timeout: 12000 },
      },
    ],
    (d) =>
      (d.plainLyrics && d.plainLyrics.length > 10) || (d.lyrics && d.lyrics.length > 10)
  );

  if (!r.ok) return { ok: false };
  return {
    ok: true,
    lyrics: r.data.plainLyrics || r.data.lyrics || '',
    source: r.source.includes('lrclib') ? 'LRCLIB' : 'lyrics.ovh',
  };
}

// ── STOCK IMAGES ────────────────────────────────────────────────────────────
// ★ FIX: Wikimedia Commons primary (fast, keyless) — Openverse was the
// "really slow" culprit since it was the only source tried first.

export async function searchImages(query, count = 5) {
  // 1) Wikimedia Commons
  try {
    const r = await httpGetJson(
      `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6&gsrsearch=${encodeURIComponent(query)}&gsrlimit=${count}&prop=imageinfo&iiprop=url|size&iiurlwidth=900&format=json`,
      { timeout: 12000, headers: { 'User-Agent': BROWSER_USER_AGENT } }
    );
    const pages = Object.values(r?.query?.pages || {}).sort(
      (a, b) => (a.index || 0) - (b.index || 0)
    );
    const imgs = pages
      .map((p) => ({
        url: p.imageinfo?.[0]?.thumburl || p.imageinfo?.[0]?.url,
        full: p.imageinfo?.[0]?.url,
        title: p.title || query,
        source: 'Wikimedia Commons',
      }))
      .filter((i) => i.url && /\.(jpe?g|png|webp)/i.test(i.full || i.url));
    if (imgs.length) return { ok: true, images: imgs.slice(0, count) };
  } catch {}

  // 2) Openverse
  try {
    const r = await httpGetJson(
      `https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}&page_size=${count}`,
      { timeout: 10000 }
    );
    const results = r?.results || [];
    if (results.length) {
      return {
        ok: true,
        images: results.slice(0, count).map((i) => ({
          url: i.url,
          thumb: i.thumbnail || i.url,
          full: i.url,
          title: i.title || query,
          source: 'Openverse',
        })),
      };
    }
  } catch {}

  // 3) LoremFlickr
  const images = [];
  const lockBase = Math.floor(Math.random() * 100000);
  for (let i = 0; i < Math.min(count, 10); i++) {
    images.push({
      url: `https://loremflickr.com/640/480/${encodeURIComponent(query)}?lock=${lockBase + i}`,
      full: null,
      thumb: null,
      title: query,
      source: 'LoremFlickr',
    });
  }
  return { ok: true, images };
}

// ── WEATHER ─────────────────────────────────────────────────────────────────

export async function fetchWeather(city, stormThreshold = 50) {
  let lat = null,
    lon = null,
    label = city;

  try {
    const geo = await httpGetJson(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`
    );
    const r = geo?.results?.[0];
    if (r) {
      lat = r.latitude;
      lon = r.longitude;
      label = `${r.name}, ${r.country || ''}`.trim();
    }
  } catch {}

  if (lat !== null) {
    try {
      const fc = await httpGetJson(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=precipitation_probability_max,weathercode,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=5`
      );
      const d = fc?.daily;
      if (d?.time) {
        const days = [];
        let warned = false;
        for (let i = 0; i < d.time.length; i++) {
          const pop = d.precipitation_probability_max?.[i] ?? 0;
          const wc = d.weathercode?.[i] ?? 0;
          const warn = pop >= stormThreshold || [95, 96, 99].includes(wc);
          if (warn) warned = true;
          days.push({
            date: d.time[i],
            pop,
            weathercode: wc,
            tmax: d.temperature_2m_max?.[i],
            tmin: d.temperature_2m_min?.[i],
            warn,
          });
        }
        return { ok: true, label, days, warned, source: 'Open-Meteo' };
      }
    } catch {}
  }

  try {
    const w = await httpGetJson(`https://wttr.in/${encodeURIComponent(city)}?format=j1`);
    const cur = w?.current_condition?.[0];
    if (cur) {
      label = w.nearest_area?.[0]?.areaName?.[0]?.value || city;
      return {
        ok: true,
        label,
        current: {
          temp: cur.temp_C,
          feels: cur.FeelsLikeC,
          desc: cur.weatherDesc?.[0]?.value,
          humidity: cur.humidity,
          wind: cur.windspeedKmph,
        },
        warned: false,
        source: 'wttr.in',
      };
    }
  } catch {}

  return { ok: false };
}

// ── CURRENCY ────────────────────────────────────────────────────────────────

export async function fetchCurrency(from, to) {
  const f = from.toUpperCase();
  const t = to.toUpperCase();

  const r = await raceApis(
    [
      {
        url: `https://open.er-api.com/v6/latest/${encodeURIComponent(f)}`,
        opts: { timeout: 12000 },
      },
      {
        url: `https://latest.currency-api.pages.dev/v1/currencies/${encodeURIComponent(f.toLowerCase())}.min.json`,
        opts: { timeout: 12000 },
      },
      {
        url: `https://api.frankfurter.app/latest?from=${encodeURIComponent(f)}&to=${encodeURIComponent(t)}`,
        opts: { timeout: 12000 },
      },
      {
        url: `https://api.exchangerate.fun/latest?base=${encodeURIComponent(f)}`,
        opts: { timeout: 12000 },
      },
    ],
    (d) => {
      const rates = d?.rates || d?.conversion_rates;
      if (rates && typeof rates[t] === 'number') return true;
      const sub = d?.[f.toLowerCase()];
      if (sub && typeof sub[t.toLowerCase()] === 'number') return true;
      return false;
    }
  );

  if (!r.ok) return { ok: false };

  const rates = r.data.rates || r.data.conversion_rates;
  if (rates && typeof rates[t] === 'number') return { ok: true, rate: rates[t], source: r.source };
  return { ok: true, rate: r.data[f.toLowerCase()][t.toLowerCase()], source: r.source };
}

// ── DEFINE ──────────────────────────────────────────────────────────────────
// ★ FIX: sources now race IN PARALLEL and carry a browser UA
// (Wiktionary was silently 403ing without one = "really slow")

export async function defineWord(word) {
  const r = await raceApisParallel(
    [
      {
        url: `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`,
        opts: { timeout: 9000 },
      },
      {
        url: `https://api.dictionaryapi.dev/api/v2/entries/en_US/${encodeURIComponent(word)}`,
        opts: { timeout: 9000 },
      },
      {
        url: `https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(word)}`,
        opts: { timeout: 9000, headers: { 'User-Agent': BROWSER_USER_AGENT } },
      },
    ],
    (d) =>
      (Array.isArray(d) && d.length > 0 && d[0].meanings) ||
      (d?.en?.[0]?.definitions?.length > 0)
  );

  if (r.ok) {
    if (Array.isArray(r.data)) return { ok: true, entry: r.data[0], source: 'dictionaryapi.dev' };
    return { ok: true, wiktionary: r.data.en[0].definitions, source: 'Wiktionary' };
  }
  return { ok: false };
}

// ── PWNED ───────────────────────────────────────────────────────────────────

export async function checkPwned(password) {
  const crypto = await import('node:crypto');
  const sha1 = crypto.createHash('sha1').update(password).digest('hex').toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);

  const body = await httpGetText(`https://api.pwnedpasswords.com/range/${prefix}`, {
    timeout: 15000,
    headers: { 'User-Agent': 'WRAITH-Bot/1.0' },
  });

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
      const buffer = await fetchBuffer(u, { timeout: 15000 });
      if (buffer.length > 100)
        return {
          ok: true,
          buffer,
          source: u.includes('qrserver') ? 'qrserver' : 'quickchart',
        };
    } catch {}
  }

  return { ok: false };
}

export async function decodeQr(imageBuffer, mimeType = 'image/png') {
  const form = new FormData();
  form.append('file', new Blob([imageBuffer], { type: mimeType }), 'qr.png');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch('https://api.qrserver.com/v1/read-qr-code/', {
      method: 'POST',
      body: form,
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`QR read HTTP ${res.status}`);
    const data = await res.json();
    return { decoded: data };
  } finally {
    clearTimeout(timer);
  }
}
