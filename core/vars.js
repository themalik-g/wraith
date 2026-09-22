// ─────────────────────────────────────────────
// WRAITH · core/vars.js
// Persistent per-session variable store (cached).
// ─────────────────────────────────────────────
import fs from 'node:fs';
import { inState, statePath } from './paths.js';

const VARS_FILE = () => inState('vars.json');

let _cache = null;

function loadVars() {
    if (_cache) return _cache;
    try {
        const file = VARS_FILE();
        if (fs.existsSync(file)) {
            _cache = JSON.parse(fs.readFileSync(file, 'utf-8')) || {};
        } else {
            _cache = {};
        }
    } catch (e) {
        try { console.error('[vars] loadVars error:', e.message); } catch {}
        _cache = {};
    }
    return _cache;
}

function saveVars(data) {
    try {
        const file = VARS_FILE();
        statePath();
        fs.writeFileSync(file, JSON.stringify(data, null, 2));
        _cache = data;
    } catch (e) {
        try { console.error('[vars] saveVars error:', e.message); } catch {}
    }
}

export function getVar(key) {
    if (!key) return null;
    const store = loadVars();
    if (Object.prototype.hasOwnProperty.call(store, key)) return store[key];
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
