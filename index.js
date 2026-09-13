// index.js — WRAITH guided multi-session launcher
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';
import { startSession } from './start.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const INSTANCES = path.join(here, 'instances');

// ── terminal colors ──
const dye = (c, s) => `\x1b[${c}m${s}\x1b[0m`;
const grey   = s => dye(90, s);
const cyan   = s => dye(36, s);
const green  = s => dye(32, s);
const yellow = s => dye(33, s);
const red    = s => dye(31, s);
const violet = s => dye(35, s);
const bold   = s => dye(1,  s);

// ── helpers ──
function ask(q) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise(res => rl.question(q, a => { rl.close(); res(a.trim()); }));
}

async function askNumber(label) {
  while (true) {
    const raw = await ask(label);
    const digits = raw.replace(/\D/g, '');
    if (!/^\d{10,15}$/.test(digits)) {
      console.log(red('   ✖ enter 10–15 digits, no + or spaces'));
      continue;
    }
    return digits;
  }
}

function listInstances() {
  if (!fs.existsSync(INSTANCES)) return [];
  return fs.readdirSync(INSTANCES)
    .filter(f => fs.statSync(path.join(INSTANCES, f)).isDirectory());
}

function ensureInstance(id) {
  const base = path.join(INSTANCES, id);
  fs.mkdirSync(path.join(base, 'session'), { recursive: true });
  fs.mkdirSync(path.join(base, 'state'),   { recursive: true });
  return base;
}

// ── interactive first-run wizard ──
async function runWizard() {
  console.log();
  console.log(violet(' ╭───────────────────────────────────────╮'));
  console.log(violet(' │') + bold('        WRAITH · first-time setup      ') + violet('│'));
  console.log(violet(' ╰───────────────────────────────────────╯'));
  console.log(grey('  Type your WhatsApp number in full international'));
  console.log(grey('  format without + or spaces  →  example: 923001234567'));
  console.log();

  const sessions = [];

  // ── number 1 (always) ──
  const n1 = await askNumber(cyan(' ❯ first number: '));
  ensureInstance('sess1');
  sessions.push({ id: 'sess1', phone: n1 });

  console.log();
  console.log(green(` ✓ saved sess1 · pairing code will appear in a moment`));
  console.log();

  // Start session 1 and wait until it actually connects
  await startSession('sess1', n1);

  // ── optional second number ──
  console.log();
  const wantsSecond = (await ask(
    yellow(' ❯ link a second WhatsApp number as well? (yes/no): ')
  )).toLowerCase();

  if (wantsSecond === 'y' || wantsSecond === 'yes') {
    const n2 = await askNumber(cyan(' ❯ second number: '));
    ensureInstance('sess2');
    sessions.push({ id: 'sess2', phone: n2 });

    console.log();
    console.log(green(` ✓ saved sess2 · pairing code will appear in a moment`));
    console.log();

    await startSession('sess2', n2);
  } else {
    console.log(grey('  skipped · running with one session only'));
  }

  console.log();
  console.log(green(' ✓ all sessions online'));
  console.log();
  return sessions;
}

// ── boot ──
async function main() {
  const existing = listInstances();

  if (existing.length === 0) {
    // very first run → guided wizard
    await runWizard();
  } else {
    // restart → just launch every existing session, no prompts
    console.log(grey(` found ${existing.length} session(s): ${existing.join(', ')}`));
    for (const id of existing) {
      // phone arg only used if the session is not yet registered
      await startSession(id, null);
    }
  }

  console.log();
  console.log(green(' WRAITH is up · all sessions running'));
}

main().catch(err => {
  console.error(red(' fatal launcher error:'), err);
  process.exit(1);
});
