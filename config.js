// config.js — WRAITH per-session config
import fs from 'fs';
import { statePath, inState } from './core/paths.js';

const BASE = {
  owner: "",
  codename: "WRAITH",
  botName: "WRAITH",
  version: "1.3.2",
  timezone: "Asia/Karachi",
  memoryTTL: 24 * 60 * 60 * 1000,
  vaultDir: "vault",
  vaultMaxMB: 200,
  reconnectDelay: 3000,
  repoUrl: "https://github.com/themalik-g/wraith",
  bannerChannelJid: "",   // ★ set with .setchannel <jid> — every command response is forwarded here
  stalk: { maxEventsPerJid: 500 },
  weather: { stormThreshold: 50 },
  media: { maxImages: 10, maxCouplePairs: 5, maxDownloadMB: 100 },
};

function readJson(p, fallback) {
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {}
  return fallback;
}

function loadSessionConfig() {
  const ownerJson = readJson(inState('owner.json'), null);
  const overrides = readJson(inState('config.json'), {}) || {};
  const owner = (ownerJson?.owner || overrides.owner || "").replace(/\D/g, "");
  return { ...BASE, ...overrides, owner };
}

export const CONFIG = loadSessionConfig();

export function saveSessionConfig(patch = {}) {
  statePath(); // ensure state dir exists
  const target = inState('config.json');
  const current = readJson(target, {}) || {};
  const merged = { ...current, ...patch };
  fs.writeFileSync(target, JSON.stringify(merged, null, 2));
  Object.assign(CONFIG, patch);
  return CONFIG;
}
