// lib/net.js — WRAITH network helpers (zero dependency)
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';
import { URL } from 'node:url';

const USER_AGENT = 'WRAITH-Bot/1.0 (+https://github.com/themalik-g/wraith)';
const DEFAULT_TIMEOUT = 15000;
// ★ FIX: hard cap on how long a download connection may hang idle.
//        Without this a dead server could park a command forever.
const DOWNLOAD_TIMEOUT = 60000;

export async function httpGetJson(url, { timeout = DEFAULT_TIMEOUT, headers = {} } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json, */*', ...headers },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally { clearTimeout(timer); }
}

export async function httpGetText(url, { timeout = DEFAULT_TIMEOUT, headers = {} } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/plain, */*', ...headers },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally { clearTimeout(timer); }
}

export async function raceApis(entries, validator = () => true) {
  const errors = [];
  for (const entry of entries) {
    const url = typeof entry === 'string' ? entry : entry.url;
    const opts = typeof entry === 'string' ? {} : entry.opts || {};
    try {
      const data = await httpGetJson(url, opts);
      if (validator(data)) return { ok: true, source: url, data };
      errors.push({ url, reason: 'validator rejected' });
    } catch (e) { errors.push({ url, reason: e.message }); }
  }
  return { ok: false, errors };
}

export function downloadToFile(urlStr, destPath, maxBytes = 100 * 1024 * 1024, redirects = 5) {
  return new Promise((resolve, reject) => {
    let url;
    try { url = new URL(urlStr); } catch { return reject(new Error('Invalid URL')); }
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.get({
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      headers: { 'User-Agent': USER_AGENT, Accept: '*/*' },
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (redirects <= 0) return reject(new Error('Too many redirects'));
        return downloadToFile(new URL(res.headers.location, url).toString(), destPath, maxBytes, redirects - 1).then(resolve, reject);
      }
      if (res.statusCode < 200 || res.statusCode >= 300) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      const declared = parseInt(res.headers['content-length'] || '0', 10);
      if (declared && declared > maxBytes) {
        res.resume();
        return reject(new Error(`File too large: ${(declared / 1024 / 1024).toFixed(1)} MB`));
      }
      const ws = fs.createWriteStream(destPath);
      let written = 0; let aborted = false;
      const fail = (err) => {
        if (aborted) return;
        aborted = true;
        try { ws.destroy(); } catch {}
        try { req.destroy(); } catch {}
        try { fs.unlinkSync(destPath); } catch {}
        reject(err);
      };
      // ★ FIX: idle connections now fail fast instead of hanging forever
      res.setTimeout(DOWNLOAD_TIMEOUT, () => fail(new Error('Download timed out (idle connection)')));
      res.on('data', (chunk) => {
        written += chunk.length;
        if (written > maxBytes) {
          fail(new Error('Download exceeded size cap'));
        }
      });
      res.on('error', fail);
      res.pipe(ws);
      ws.on('finish', () => { if (!aborted) resolve(destPath); });
      ws.on('error', fail);
    });
    req.on('error', reject);
  });
}

export async function withTempFile(name, fn) {
  const dir = path.join(process.cwd(), 'vault', 'tmp');
  fs.mkdirSync(dir, { recursive: true });
  // ★ FIX: sanitize the caller-supplied name (keeps extension, blocks traversal)
  const safe = String(name).replace(/[^\w.\-]/g, '_').slice(-60);
  const fullPath = path.join(dir, `${Date.now()}_${Math.random().toString(36).slice(2)}_${safe}`);
  try { return await fn(fullPath); }
  finally { try { fs.unlinkSync(fullPath); } catch {} }
}

export function chunkText(text, size = 3800) {
  const out = []; let s = String(text ?? '');
  while (s.length > size) {
    let cut = s.lastIndexOf('\n', size);
    if (cut < size * 0.5) cut = size;
    out.push(s.slice(0, cut)); s = s.slice(cut);
  }
  if (s.length) out.push(s);
  return out;
}
