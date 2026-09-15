// ─────────────────────────────────────────────
// WRAITH · core/keys.js — single place for all API keys
// Reads keys.env from project root; process.env wins.
// ─────────────────────────────────────────────
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const KEYS_FILE = path.join(here, '..', 'keys.env');

let _keys = null;

function parseEnv(content) {
    const out = {};
    for (const raw of String(content).split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const eq = line.indexOf('=');
        if (eq < 1) continue;
        const k = line.slice(0, eq).trim();
        let v = line.slice(eq + 1).trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        if (k && v) out[k] = v;
    }
    return out;
}

function load() {
    if (_keys) return _keys;
    const fromFile = {};
    try {
        if (fs.existsSync(KEYS_FILE)) Object.assign(fromFile, parseEnv(fs.readFileSync(KEYS_FILE, 'utf8')));
    } catch (e) { console.warn('[keys] could not read keys.env:', e.message); }
    _keys = { ...fromFile };
    for (const [k, v] of Object.entries(process.env)) if (v) _keys[k] = v;
    return _keys;
}

export function getKey(name) { return load()[name] || null; }
