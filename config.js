// config.js — WRAITH base config (per-session overrides optional)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));

const BASE = {
  codename: "WRAITH",
  botName:  "WRAITH",
  timezone: "Asia/Karachi",
  memoryTTL: 60 * 60 * 1000,
  vaultDir:  "vault",
  vaultMaxMB: 200,
  reconnectDelay: 3000
};

function loadOverrides() {
  try {
    // We do not know which session we're on yet at import time,
    // so this only loads a global override (optional).
    const p = path.join(here, 'config-overrides.json');
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {}
  return {};
}

export const CONFIG = { ...BASE, ...loadOverrides() };
