#!/usr/bin/env node
// ─────────────────────────────────────────────
//  WRAITH · multi-session launcher  (ESM)
// ─────────────────────────────────────────────
//  · single entry point for VPS / pm2 / terminal
//  · fetches repo automatically if dropped alone
//  · links multiple WhatsApp numbers (isolated
//    state/session per number, shared bot files)
//  · auto-resumes EVERY linked number on restart
//  · auto-restarts children (crash + .update)
//
//  flags:
//    --add / --setup   resume existing + open wizard
// ─────────────────────────────────────────────
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ══════════════════════════════════════════════════
//  constants
// ══════════════════════════════════════════════════
const SOURCE          = 'https://github.com/themalik-g/wraith.git';
const BRANCH          = process.env.WRAITH_BRANCH || 'main';
const EXCLUDE         = new Set([
  'node_modules', '.git', 'instances',
  'state', 'session', 'vault',
  'index.js', 'package-lock.json'
]);
const CLONE_TIMEOUT   = 180_000;
const INSTALL_TIMEOUT = 300_000;
const LINK_WAIT_MS    = 300_000;   // 5 min per number

const ADD_MODE = process.argv.includes('--add') || process.argv.includes('--setup');

// ══════════════════════════════════════════════════
//  terminal dye
// ══════════════════════════════════════════════════
const dye    = (c, s) => `\x1b[${c}m${s}\x1b[0m`;
const grey   = s => dye(90, s);
const cyan   = s => dye(36, s);
const violet = s => dye(35, s);
const green  = s => dye(32, s);
const yellow = s => dye(33, s);
const red    = s => dye(31, s);

const clock = () => grey(new Date().toTimeString().slice(0, 8));
const say   = (...p) => console.log(clock(), violet('❯'), ...p);

const veil = () => {
  console.log();
  console.log(violet('     ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·'));
  console.log(violet('           w r a i t h'));
  console.log(violet('     ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·'));
  console.log();
};

// ══════════════════════════════════════════════════
//  locate / fetch the repo
// ══════════════════════════════════════════════════
function repoRoot() {
  if (fs.existsSync(path.join(__dirname, 'start.js'))) return __dirname;
  const dir = path.join(__dirname, 'wraith');
  if (!fs.existsSync(path.join(dir, 'start.js'))) {
    say(yellow('fetching wraith from origin…'));
    const res = spawnSync('git', ['clone', '--depth', '1', '-b', BRANCH, SOURCE, dir], {
      stdio: 'inherit', timeout: CLONE_TIMEOUT
    });
    if (res.status !== 0) { console.error(red('✖ clone failed')); process.exit(1); }
  }
  return dir;
}

function installDeps(dir) {
  say(yellow('installing dependencies…'));
  const res = spawnSync('npm', ['install', '--omit=dev'], {
    cwd: dir, stdio: 'inherit', timeout: INSTALL_TIMEOUT
  });
  if (res.status !== 0) { console.error(red('✖ npm install failed')); process.exit(1); }
  say(green('✓ dependencies locked in'));
}

// ══════════════════════════════════════════════════
//  per-session instance folders (symlinks + real state)
// ══════════════════════════════════════════════════
const instDir = (root, id) => path.join(root, 'instances', id);

function safeSymlink(target, link, type) {
  try {
    const existing = fs.lstatSync(link, { throwIfNoEntry: false });
    if (existing) return;
  } catch {}
  try {
    fs.symlinkSync(target, link, type);
  } catch (e) {
    if (e.code !== 'EEXIST') {
      console.error(clock(), red(`symlink failed: ${link} → ${target}: ${e.message}`));
    }
  }
}

function makeInstance(root, id) {
  const dir = instDir(root, id);
  fs.mkdirSync(dir, { recursive: true });

  for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
    if (EXCLUDE.has(ent.name)) continue;
    const target = path.join(root, ent.name);
    const link   = path.join(dir, ent.name);
    safeSymlink(target, link, ent.isDirectory() ? 'junction' : 'file');
  }

  fs.mkdirSync(path.join(dir, 'state'),   { recursive: true });
  fs.mkdirSync(path.join(dir, 'session'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'vault'),   { recursive: true });
  return dir;
}

function migrateLegacy(root) {
  const main = instDir(root, 'main');
  for (const name of ['session', 'state', 'vault']) {
    const src = path.join(root, name);
    const dst = path.join(main, name);
    if (fs.existsSync(src) && !fs.existsSync(dst)) {
      say(yellow(`migrating legacy /${name} → instances/main/${name}`));
      try { fs.cpSync(src, dst, { recursive: true, force: false }); }
      catch (e) { say(red(`migration warning: ${e.message}`)); }
    }
  }
}

// ══════════════════════════════════════════════════
//  instance discovery
// ══════════════════════════════════════════════════
// "linked" = has session/creds.json (i.e. really paired)
function isLinked(root, id) {
  return fs.existsSync(path.join(root, 'instances', id, 'session', 'creds.json'));
}

function listExistingInstances(root) {
  const dir = path.join(root, 'instances');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(n => {
      try { return fs.statSync(path.join(dir, n)).isDirectory(); }
      catch { return false; }
    })
    .filter(n => isLinked(root, n))
    .sort();
}

// FIX: only count LINKED instances, and never skip `main`
function nextSessionId(root) {
  const dir = path.join(root, 'instances');
  if (!fs.existsSync(dir)) return 'main';

  const used = fs.readdirSync(dir).filter(n => {
    try {
      return fs.statSync(path.join(dir, n)).isDirectory() && isLinked(root, n);
    } catch { return false; }
  });

  if (used.length === 0) return 'main';
  if (!used.includes('main')) return 'main';

  let maxN = 1;
  for (const id of used) {
    const m = /^sess(\d+)$/.exec(id);
    if (m) maxN = Math.max(maxN, parseInt(m[1], 10));
  }
  return `sess${maxN + 1}`;
}

// ══════════════════════════════════════════════════
//  children
// ══════════════════════════════════════════════════
const children = new Map();
let shuttingDown = false;
let rl = null;

const ask = q => new Promise(res => rl.question(q, a => res(a.trim())));

async function promptNumber(label = 'number') {
  console.log();
  console.log(violet(`  ╭─ link a ${label} ─────────────────────╮`));
  console.log(violet('  │') + '  WhatsApp number, digits only           ' + violet('│'));
  console.log(violet('  │') + grey('  country code + number · 923001234567  ') + violet('│'));
  console.log(violet('  ╰────────────────────────────────────────╯'));
  while (true) {
    const raw = await ask(violet('  ❯ ') + cyan(`${label}: `));
    const digits = raw.replace(/\D/g, '');
    if (!/^\d{10,15}$/.test(digits)) { console.log(red('  ✖ must be 10–15 digits')); continue; }
    return digits;
  }
}

function spawnSession(root, id, number) {
  const dir  = makeInstance(root, id);
  const args = ['--preserve-symlinks', '--preserve-symlinks-main', 'start.js', '--session', id];
  if (number) args.push('--number', number);

  const env = { ...process.env, WRAITH_REPO_ROOT: root, WRAITH_SESSION_ID: id };

  say(cyan(`starting session ${id}${number ? ' · +' + number : ''}`));

  // FIX: stdin is 'ignore' so the child can NEVER steal keystrokes from the wizard.
  // stdout/stderr are piped so we can mute them while prompting.
  const proc = spawn('node', args, {
    cwd: dir,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env
  });

  // output forwarding with mute support
  let muted = false;
  const backlog = [];
  const route = (stream, dest) => {
    stream.on('data', chunk => {
      if (muted) backlog.push([dest, chunk]);
      else dest.write(chunk);
    });
  };
  route(proc.stdout, process.stdout);
  route(proc.stderr, process.stderr);

  let resolveLinked, resolveExit;
  const linkedPromise = new Promise(r => (resolveLinked = r));
  const exitPromise   = new Promise(r => (resolveExit   = r));

  const rec = {
    number, proc, restarts: 0, resetTimer: null,
    resolveLinked, resolveExit,
    mute:   () => { muted = true; },
    unmute: () => {
      muted = false;
      for (const [dest, chunk] of backlog) dest.write(chunk);
      backlog.length = 0;
    }
  };
  children.set(id, rec);

  proc.on('message', m => {
    if (m?.type === 'wraith:linked') { try { resolveLinked(true); } catch {} }
  });

  proc.on('error', err => console.error(clock(), red('spawn error:'), err.message));

  proc.on('exit', (code, signal) => {
    children.delete(id);
    try { resolveExit({ code, signal }); } catch {}

    if (shuttingDown) return;
    if (signal === 'SIGINT' || signal === 'SIGTERM') return;

    rec.restarts++;
    const wait = Math.min(1500 * Math.pow(2, rec.restarts - 1), 30_000);
    const why  = code === 0 ? 'restarting for update/clean exit' : `crashed (code ${code})`;
    say(yellow(`${id}: ${why} · retry ${rec.restarts} in ${(wait / 1000).toFixed(1)}s`));
    setTimeout(() => { if (!shuttingDown) spawnSession(root, id, rec.number); }, wait);
  });

  clearTimeout(rec.resetTimer);
  rec.resetTimer = setTimeout(() => { rec.restarts = 0; }, 20_000);

  return { proc, linkedPromise, exitPromise };
}

async function waitForLink(spawnResult, id) {
  return Promise.race([
    spawnResult.linkedPromise.then(() => 'linked'),
    spawnResult.exitPromise.then(({ code }) => {
      if (code === 0) return 'exited';
      throw new Error(`session ${id} exited early with code ${code}`);
    }),
    new Promise((_, rej) =>
      setTimeout(() => rej(new Error(`session ${id} link timeout after ${LINK_WAIT_MS / 1000}s`)), LINK_WAIT_MS)
    )
  ]);
}

// ══════════════════════════════════════════════════
//  wizard
// ══════════════════════════════════════════════════
function muteAll() {
  for (const rec of children.values()) rec.mute?.();
}
function unmuteAll() {
  for (const rec of children.values()) rec.unmute?.();
}

async function linkOne(root, label) {
  const number = await promptNumber(label);
  const id     = nextSessionId(root);
  const result = spawnSession(root, id, number);

  try {
    await waitForLink(result, id);
    console.log(green(`\n  ✔ ${id} linked (+${number})`));
    return true;
  } catch (e) {
    console.error(red(`  ✖ ${e.message}`));
    return false;
  }
}

async function wizard(root) {
  console.log();
  console.log(violet(' ╭───────────────────────────────────────╮'));
  console.log(violet(' │') + '        WRAITH · pairing wizard        ' + violet('│'));
  console.log(violet(' ╰───────────────────────────────────────╯'));

  const firstLabel = ADD_MODE ? 'new number' : 'first number';
  const ok1 = await linkOne(root, firstLabel);
  if (!ok1) {
    say(red('first number failed — aborting wizard'));
    return;
  }

  while (true) {
    // FIX: silence every child's output while we ask, so the prompt is visible
    muteAll();
    await new Promise(r => setTimeout(r, 250));       // let the terminal settle
    process.stdout.write('\n');                        // clear line
    const ans = await ask(violet('  ❯ ') + 'link another number? ' + grey('[y/N]: '));
    unmuteAll();

    if (!/^y(es)?$/i.test(ans)) {
      console.log(grey('  done — running linked session(s).\n'));
      break;
    }

    const ok = await linkOne(root, 'next number');
    if (!ok) {
      console.log(grey('  aborting further links.\n'));
      break;
    }
  }
}

// ══════════════════════════════════════════════════
//  signals
// ══════════════════════════════════════════════════
function quiet(sig) {
  if (shuttingDown) return;
  shuttingDown = true;
  say(grey(`${sig} received — shutting down all sessions`));
  for (const { proc } of children.values()) { try { proc.kill('SIGTERM'); } catch {} }
  setTimeout(() => process.exit(0), 800);
}
process.on('SIGINT',  () => quiet('SIGINT'));
process.on('SIGTERM', () => quiet('SIGTERM'));

// ══════════════════════════════════════════════════
//  go
// ══════════════════════════════════════════════════
(async () => {
  veil();
  const root = repoRoot();
  if (!fs.existsSync(path.join(root, 'node_modules'))) installDeps(root);

  makeInstance(root, 'main');
  migrateLegacy(root);

  const existing = listExistingInstances(root);

  // ── non-interactive (pm2 / systemd / docker) ──
  if (!process.stdin.isTTY) {
    if (existing.length) {
      say(grey(`[non-interactive] resuming ${existing.length} session(s): ${existing.join(', ')}`));
      for (const id of existing) spawnSession(root, id, null);
    } else {
      say(red('[non-interactive] no linked sessions found — run interactively once to pair'));
      process.exit(1);
    }
    return;
  }

  rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  if (ADD_MODE) {
    for (const id of existing) spawnSession(root, id, null);
    await wizard(root);
    return;
  }

  if (existing.length) {
    say(grey(`resuming ${existing.length} session(s): ${existing.join(', ')}`));
    for (const id of existing) spawnSession(root, id, null);
    return;
  }

  await wizard(root);
})();
