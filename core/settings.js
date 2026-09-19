// core/settings.js — persistent JSON-backed settings store
import fs from 'node:fs';
import path from 'node:path';
import { storePath } from './paths.js';

const FILE = () => path.join(storePath(), 'settings.json');

const DEFAULTS = {
  prefix: '.',
};

let _cache = null;

function load() {
  if (_cache) return _cache;
  try {
    const raw = fs.readFileSync(FILE(), 'utf8');
    _cache = { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    _cache = { ...DEFAULTS };
  }
  return _cache;
}

function persist() {
  try {
    fs.mkdirSync(path.dirname(FILE()), { recursive: true });
    fs.writeFileSync(FILE(), JSON.stringify(_cache, null, 2));
  } catch (e) {
    console.error('[settings] persist failed:', e.message);
  }
}

export function getPrefix() {
  return load().prefix || '.';
}

export function setPrefix(p) {
  const s = load();
  s.prefix = p;
  persist();
}

export function getSetting(key) {
  return load()[key];
}

export function setSetting(key, value) {
  const s = load();
  s[key] = value;
  persist();
}

export function getReplyMode() {
  return load().replyMode || 'buttons';
}

export function setReplyMode(mode) {
  const s = load();
  s.replyMode = mode === 'text' ? 'text' : 'buttons';
  persist();
}
