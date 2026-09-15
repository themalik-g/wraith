// config.js — WRAITH per-session config
//
// The VPS launcher spawns one node process per number with
// --preserve-symlinks --preserve-symlinks-main
// so `import.meta.url` points into the instance folder
// (instances/<id>/config.js → symlink to this file).
// That makes `./state/*` naturally per-session.
//
// Reads, in order of precedence:
//   instances/<id>/state/owner.json   → { owner: "92300..." }
//   instances/<id>/state/config.json  → { botName, timezone, ... }
//   BASE (below)

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));

const BASE = {
  owner: "",                       // filled from state/owner.json at load time
  codename: "WRAITH",
  botName: "WRAITH",
  version: "1.3.2",
  timezone: "Asia/Karachi",
  memoryTTL: 60 * 60 * 1000,
  vaultDir: "vault",
  vaultMaxMB: 200,
  reconnectDelay: 3000,
  repoUrl: "https://github.com/themalik-g/wraith",
};

function readJson(p, fallback) {
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {}
  return fallback;
}

function loadSessionConfig() {
  const stateDir = path.join(here, 'state');
  const ownerJson = readJson(path.join(stateDir, 'owner.json'), null);
  const overrides = readJson(path.join(stateDir, 'config.json'), {}) || {};
  const owner = (ownerJson?.owner || overrides.owner || "").replace(/\D/g, "");
  return { ...BASE, ...overrides, owner };
}

export const CONFIG = loadSessionConfig();

// commands can call this to persist a settings change for THIS session only
export function saveSessionConfig(patch = {}) {
  const stateDir = path.join(here, 'state');
  fs.mkdirSync(stateDir, { recursive: true });
  const target = path.join(stateDir, 'config.json');
  const current = readJson(target, {}) || {};
  const merged = { ...current, ...patch };
  fs.writeFileSync(target, JSON.stringify(merged, null, 2));
  Object.assign(CONFIG, patch);
  return CONFIG;
}
