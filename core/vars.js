// ─────────────────────────────────────────────
// WRAITH · core/vars.js
// Persistent per-session variable store.
// ─────────────────────────────────────────────
import fs from 'node:fs';
import path from 'node:path';

const VARS_FILE = path.join(process.cwd(), 'state', 'vars.json');

function loadVars() {
    try {
        if (fs.existsSync(VARS_FILE)) {
            return JSON.parse(fs.readFileSync(VARS_FILE, 'utf-8')) || {};
        }
    } catch (e) {
        try { console.error('[vars] loadVars error:', e.message); } catch {}
    }
    return {};
}

function saveVars(data) {
    try {
        const dir = path.dirname(VARS_FILE);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(VARS_FILE, JSON.stringify(data, null, 2));
    } catch (e) {
        try { console.error('[vars] saveVars error:', e.message); } catch {}
    }
}

export function getVar(key) {
    if (!key) return null;
    const store = loadVars();
    if (Object.prototype.hasOwnProperty.call(store, key)) {
        return store[key];
    }
    return process.env[key] || null;
}

export function setVar(key, value) {
    if (!key) return false;
    const store = loadVars();
    store[key] = value;
    saveVars(store);
    process.env[key] = value;
    return true;
}

export function delVar(key) {
    if (!key) return false;
    const store = loadVars();
    if (Object.prototype.hasOwnProperty.call(store, key)) {
        delete store[key];
        saveVars(store);
        delete process.env[key];
        return true;
    }
    return false;
}

export function getAllVars() {
    return loadVars();
}
