// config.js — WRAITH per-session config resolver
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { AsyncLocalStorage } from 'async_hooks';

const here = path.dirname(fileURLToPath(import.meta.url));
const INSTANCES = path.join(here, 'instances');

// ── base defaults (used when a session has no config.json) ──
const BASE = {
  owner: "",
  codename: "WRAITH",
  botName: "WRAITH",
  timezone: "Asia/Karachi",
  memoryTTL: 60 * 60 * 1000,
  vaultDir: "vault",
  vaultMaxMB: 200,
  reconnectDelay: 3000
};

// ── the current session's config is stored here ──
export const sessionStore = new AsyncLocalStorage();
const sessionCache = new Map();

export function loadSessionConfig(sessionId) {
  if (sessionCache.has(sessionId)) return sessionCache.get(sessionId);

  const stateDir = path.join(INSTANCES, sessionId, 'state');
  let owner = "";
  let overrides = {};

  try {
    const p = path.join(stateDir, 'owner.json');
    if (fs.existsSync(p)) owner = JSON.parse(fs.readFileSync(p, 'utf-8')).owner || "";
  } catch {}

  try {
    const p = path.join(stateDir, 'config.json');
    if (fs.existsSync(p)) overrides = JSON.parse(fs.readFileSync(p, 'utf-8')) || {};
  } catch {}

  const merged = {
    ...BASE,
    ...overrides,
    owner: owner || overrides.owner || "",
    sessionId
  };
  sessionCache.set(sessionId, merged);
  return merged;
}

export function reloadSessionConfig(sessionId) {
  sessionCache.delete(sessionId);
  return loadSessionConfig(sessionId);
}

export function saveSessionConfig(sessionId, overrides = {}) {
  const stateDir = path.join(INSTANCES, sessionId, 'state');
  fs.mkdirSync(stateDir, { recursive: true });
  const target = path.join(stateDir, 'config.json');
  const current = fs.existsSync(target)
    ? JSON.parse(fs.readFileSync(target, 'utf-8'))
    : {};
  const merged = { ...current, ...overrides };
  fs.writeFileSync(target, JSON.stringify(merged, null, 2));
  reloadSessionConfig(sessionId);
}

// ── CONFIG proxy: reads from current session, falls back to BASE ──
export const CONFIG = new Proxy(BASE, {
  get(target, prop) {
    const sc = sessionStore.getStore();
    if (sc && prop in sc) return sc[prop];
    return target[prop];
  },
  set(target, prop, value) {
    const sc = sessionStore.getStore();
    if (sc) { sc[prop] = value; return true; }
    target[prop] = value;
    return true;
  },
  has(target, prop) {
    const sc = sessionStore.getStore();
    return (sc && prop in sc) || prop in target;
  },
  ownKeys(target) {
    const sc = sessionStore.getStore();
    return sc
      ? [...new Set([...Reflect.ownKeys(sc), ...Reflect.ownKeys(target)])]
      : Reflect.ownKeys(target);
  },
  getOwnPropertyDescriptor(target, prop) {
    const sc = sessionStore.getStore();
    if (sc && prop in sc) {
      return { configurable: true, enumerable: true, value: sc[prop], writable: true };
    }
    return Object.getOwnPropertyDescriptor(target, prop);
  }
});
