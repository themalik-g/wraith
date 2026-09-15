// lib/net.js — WRAITH network helpers (zero dependency)
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';
import { URL } from 'node:url';

const USER_AGENT = 'WRAITH-Bot/1.0 (+https://github.com/themalik-g/wraith)';
// Browser UA — Wikimedia/Instagram/Archive.org reject non-browser agents
const BROWSER_USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const DEFAULT_TIMEOUT = 15000;
const DOWNLOAD_TIMEOUT = 45000;

export { BROWSER_USER_AGENT };

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

// Race several GET endpoints IN PARALLEL — first valid response wins.
// (sequential racing made commands feel "really slow" when the first host hung)
export async function raceApisParallel(entries, validator = () => true) {
    const list = entries.map((entry) => {
        const url = typeof entry === 'string' ? entry : entry.url;
        const opts = typeof entry === 'string' ? {} : entry.opts || {};
        return (async () => {
            const data = await httpGetJson(url, opts);
            if (!validator(data)) throw new Error('validator rejected');
            return { ok: true, source: url, data };
        })();
    });
    try { return await Promise.any(list); }
    catch { return { ok: false }; }
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

export function downloadToFile(urlStr, destPath, maxBytes = 100 * 1024 * 1024, redirects = 5, extraHeaders = {}) {
    return new Promise((resolve, reject) => {
        let url;
        try { url = new URL(urlStr); } catch { return reject(new Error('Invalid URL')); }
        const lib = url.protocol === 'https:' ? https : http;
        const req = lib.get({
            hostname: url.hostname,
            port: url.port || (url.protocol === 'https:' ? 443 : 80),
            path: url.pathname + url.search,
            headers: { 'User-Agent': BROWSER_USER_AGENT, Accept: '*/*', ...extraHeaders },
        }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                res.resume();
                if (redirects <= 0) return reject(new Error('Too many redirects'));
                return downloadToFile(new URL(res.headers.location, url).toString(), destPath, maxBytes, redirects - 1, extraHeaders).then(resolve, reject);
            }
            if (res.statusCode < 200 || res.statusCode >= 300) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
            const declared = parseInt(res.headers['content-length'] || '0', 10);
            if (declared && declared > maxBytes) { res.resume(); return reject(new Error(`File too large: ${(declared / 1024 / 1024).toFixed(1)} MB`)); }
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
            res.setTimeout(DOWNLOAD_TIMEOUT, () => fail(new Error('Download timed out (idle connection)')));
            res.on('data', (chunk) => { written += chunk.length; if (written > maxBytes) fail(new Error('Download exceeded size cap')); });
            res.on('error', fail);
            res.pipe(ws);
            ws.on('finish', () => { if (!aborted) resolve(destPath); });
            ws.on('error', fail);
        });
        req.on('error', reject);
    });
}

export async function fetchBuffer(url, { timeout = 15000, headers = {}, maxBytes = 30 * 1024 * 1024 } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
        const res = await fetch(url, {
            headers: { 'User-Agent': BROWSER_USER_AGENT, Accept: '*/*', ...headers },
            signal: controller.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const len = parseInt(res.headers.get('content-length') || '0', 10);
        if (len && len > maxBytes) throw new Error('Response too large');
        return Buffer.from(await res.arrayBuffer());
    } finally { clearTimeout(timer); }
}

export async function withTempFile(name, fn) {
    const dir = path.join(process.cwd(), 'vault', 'tmp');
    fs.mkdirSync(dir, { recursive: true });
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
