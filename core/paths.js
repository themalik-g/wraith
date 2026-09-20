// core/paths.js — single source of truth for per-session data locations
import fs from 'node:fs';
import path from 'node:path';

export function dataDir() {
  const d = path.resolve(process.env.WRAITH_DATA_DIR || process.cwd());
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function sub(name) {
  const p = path.join(dataDir(), name);
  fs.mkdirSync(p, { recursive: true });
  return p;
}

export const sessionPath   = () => sub('session');
export const statePath     = () => sub('state');
export const vaultPathRoot = () => sub('vault');
export const storePath     = () => sub('data');
export const logsPath      = () => sub('logs');

export const inState = (...n) => path.join(statePath(), ...n);
export const inStore = (...n) => path.join(storePath(), ...n);
export const inData  = (...n) => path.join(storePath(), ...n);
