// ─────────────────────────────────────────────
//  WRAITH · runtime configuration
//
//  MULTI-SESSION NOTE
//  ─────────────────
//  Every session runs inside instances/<id>/.
//  This file reads optional per-session overrides
//  from  <session>/state/config-overrides.json
//  (process.cwd() is set by the launcher).
//
//  Example  instances/sess2/state/config-overrides.json:
//  {
//    "timezone": "Europe/London",
//    "botName": "SPECTRE",
//    "memoryTTL": 1800000
//  }
//
//  The `owner` field is intentionally ignored here —
//  it is loaded per-session from <session>/state/owner.json
//  by start.js so two numbers can never share an owner.
// ─────────────────────────────────────────────
import fs from 'fs';
import path from 'path';

const BASE = {
    // Your WhatsApp number — country code + number, digits only.
    // ⚠️ MUST match state/owner.json on first run.
    owner: "923257853673",

    codename: "WRAITH",
    botName: "-",

    // Timezone used for schedule parsing and ghost timestamps
    // e.g. "Asia/Karachi", "Asia/Dubai", "Europe/London"
    timezone: "Asia/Karachi",

    // How long a captured message stays in memory (ms). Default: 1 hour.
    memoryTTL: 60 * 60 * 1000,

    // Where captured media is temporarily stored before delivery
    vaultDir: "vault",

    // Max size of vault folder in MB before it gets auto-purged
    vaultMaxMB: 200,

    // Auto-reconnect delay (ms)
    reconnectDelay: 3000
};

function loadOverrides() {
    try {
        const p = path.join(process.cwd(), 'state', 'config-overrides.json');
        if (fs.existsSync(p)) {
            const raw = JSON.parse(fs.readFileSync(p, 'utf-8'));
            // owner is always per-session via state/owner.json — never override here
            delete raw.owner;
            return raw;
        }
    } catch {}
    return {};
}

export const CONFIG = { ...BASE, ...loadOverrides() };
