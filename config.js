// config.js — WRAITH per-session config
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));

const BASE = {
  owner: "",
  codename: "WRAITH",
  botName: "WRAITH",
  version: "1.3.2",
  timezone: "Asia/Karachi",
  memoryTTL: 60 * 60 * 1000,
  vaultDir: "vault",
  vaultMaxMB: 200,
  reconnectDelay: 3000,
  repoUrl: "https://github.com/themalik-g/wraith",
  // Feature-specific defaults
  stalk: {
    maxEventsPerJid: 500,
  },
  weather: {
    stormThreshold: 50, // percent
  },
  media: {
    maxImages: 10,
    maxCouplePairs: 5,
    maxDownloadMB: 100,
  },
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
