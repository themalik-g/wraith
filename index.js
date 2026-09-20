#!/usr/bin/env node
// ─────────────────────────────────────────────
// WRAITH · bootstrap launcher (standalone, zero-dep)
// ─────────────────────────────────────────────

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─────────────────────────────────────────────
// 1. INLINE .env LOADER  (NO dotenv dependency)
//    Runs before anything else touches process.env.
//    If the same var is already set (panel/PM2/docker), we don't override.
// ─────────────────────────────────────────────
function loadEnvFile(file) {
  try {
    if (!fs.existsSync(file)) return;
    const text = fs.readFileSync(file, 'utf8');
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      if (!key) continue;
      let val = line.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = val;
    }
  } catch (e) {
    console.warn('[wraith] .env load skipped:', e.message);
  }
}

loadEnvFile(path.join(__dirname, '.env'));

// ─────────────────────────────────────────────
// 2. Container-safe default
// ─────────────────────────────────────────────
if (!process.env.UV_THREADPOOL_SIZE) {
  process.env.UV_THREADPOOL_SIZE = '2';
}

// ─────────────────────────────────────────────
// 3. Constants & styling (defined before use)
// ─────────────────────────────────────────────
const SOURCE = 'https://github.com/themalik-g/wraith.git';
const BRANCH = process.env.WRAITH_BRANCH || 'main';
const CLONE_TIMEOUT = 180_000;
const INSTALL_TIMEOUT = 300_000;
const LINK_WAIT_MS = 300_000;
const MAX_RESTARTS = 10;
const ADD_MODE =
  process.argv.includes('--add') || process.argv.includes('--setup');

const dye = (c, s) => `\x1b[${c}m${s}\x1b[0m`;
const grey = s => dye(90, s);
const cyan = s => dye(36, s);
const violet = s => dye(35, s);
const green = s => dye(32, s);
const yellow = s => dye(33, s);
const red = s => dye(31, s);
const clock = () => grey(new Date().toTimeString().slice(0, 8));
const say = (...p) => console.log(clock(), violet('❯'), ...p);

const veil = () => {
  console.log();
  console.log(violet(' · · · · · · · · · · ·'));
  console.log(violet(' w r a i t h'));
  console.log(violet(' · · · · · · · · · · ·'));
  console.log();
};

// ─────────────────────────────────────────────
// 4. Configured phone number resolution
//    Priority: CLI arg  >  env  >  null
// ─────────────────────────────────────────────
const PHONE_RE = /^\d{10,15}$/;

function resolveConfiguredPhone(argv = process.argv, env = process.env) {
  const cli = argv.find(
    a => a.startsWith('--phone=') || a.startsWith('--number=')
  );
  if (cli) {
    const digits = cli.split('=')[1].replace(/\D/g, '');
    if (PHONE_RE.test(digits)) return digits;
    console.warn(
      clock(),
      red(`ignoring invalid --phone value: ${cli.split('=')[1]}`)
    );
  }
  const fromEnv = (env.WRAITH_PHONE || env.WRAITH_NUMBER || '').replace(
    /\D/g,
    ''
  );
  if (PHONE_RE.test(fromEnv)) return fromEnv;
  return null;
}

const CONFIGURED_PHONE = resolveConfiguredPhone();

// ─────────────────────────────────────────────
// 5. Repo / instance helpers
// ─────────────────────────────────────────────
function repoRoot() {
  // If start.js sits next to us, we ARE the repo.
  if (fs.existsSync(path.join(__dirname, 'start.js'))) return __dirname;

  const dir = path.join(__dirname, 'wraith');
  if (!fs.existsSync(path.join(dir, 'start.js'))) {
    say(yellow('fetching wraith from origin…'));
    const res = spawnSync(
      'git',
      ['clone', '--depth', '1', '-b', BRANCH, SOURCE, dir],
      { stdio: 'inherit', timeout: CLONE_TIMEOUT }
    );
    if (res.status !== 0) {
      throw new Error('git clone failed – check network or repository access');
    }
  }
  return dir;
}

function installDeps(dir) {
  say(yellow('installing dependencies…'));
  const res = spawnSync('npm', ['install', '--omit=dev'], {
    cwd: dir,
    stdio: 'inherit',
    timeout: INSTALL_TIMEOUT,
  });
  if (res.status !== 0) {
    throw new Error('npm install failed – see output above');
  }
  say(green('✓ dependencies locked in'));
}

const instDir = (root, id) => path.join(root, 'instances', id);

function makeInstance(root, id) {
  const dir = instDir(root, id);
  for (const name of ['session', 'state', 'vault', 'logs', 'data']) {
    fs.mkdirSync(path.join(dir, name), { recursive: true });
  }
  return dir;
}

function migrateLegacy(root) {
  const main = instDir(root, 'main');
  for (const name of ['session', 'state', 'vault']) {
    const src = path.join(root, name);
    const dst = path.join(main, name);
    if (fs.existsSync(src) && !fs.existsSync(dst)) {
      say(yellow(`migrating legacy /${name} → instances/main/${name}`));
      try {
        fs.cpSync(src, dst, { recursive: true, force: false });
      } catch (e) {
        say(red(`migration warning: ${e.message}`));
      }
    }
  }
}

const isLinked = (root, id) =>
  fs.existsSync(path.join(root, 'instances', id, 'session', 'creds.json'));

function listExistingInstances(root) {
  const dir = path.join(root, 'instances');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter(n => {
      try {
        return fs.statSync(path.join(dir, n)).isDirectory();
      } catch {
        return false;
      }
    })
    .filter(n => isLinked(root, n))
    .sort();
}

function nextSessionId(root) {
  const dir = path.join(root, 'instances');
  if (!fs.existsSync(dir)) return 'main';

  const used = fs.readdirSync(dir).filter(n => {
    try {
      return fs.statSync(path.join(dir, n)).isDirectory() && isLinked(root, n);
    } catch {
      return false;
    }
  });

  if (used.length === 0 || !used.includes('main')) return 'main';
  let maxN = 1;
  for (const id of used) {
    const m = /^sess(\d+)$/.exec(id);
    if (m) maxN = Math.max(maxN, parseInt(m[1], 10));
  }
  return `sess${maxN + 1}`;
}

// ─────────────────────────────────────────────
// 6. Session spawning
// ─────────────────────────────────────────────
const children = new Map();
const restartingSessions = new Set();
let shuttingDown = false;
let rl = null;

const ask = q => new Promise(res => rl.question(q, a => res(a.trim())));

async function promptNumber(label = 'number') {
  console.log();
  console.log(violet(` ╭─ link a ${label} ─────────────────────╮`));
  console.log(violet(' │') + ' WhatsApp number, digits only ' + violet('│'));
  console.log(
    violet(' │') +
      grey(' country code + number · 923001234567 ') +
      violet('│')
  );
  console.log(violet(' ╰────────────────────────────────────────╯'));

  while (true) {
    const raw = await ask(violet(' ❯ ') + cyan(`${label}: `));
    const digits = raw.replace(/\D/g, '');
    if (!/^\d{10,15}$/.test(digits)) {
      console.log(red(' ✖ must be 10–15 digits'));
      continue;
    }
    return digits;
  }
}

function spawnSession(root, id, number) {
  const dir = makeInstance(root, id);
  const maxOldSpace = process.env.WRAITH_MAX_OLD_SPACE_SIZE || '256';
  const args = [`--max-old-space-size=${maxOldSpace}`, '--expose-gc'];
  if (process.env.WRAITH_V8_POOL_SIZE) {
    args.push(`--v8-pool-size=${process.env.WRAITH_V8_POOL_SIZE}`);
  }
  // IMPORTANT: run start.js FROM THE REPO so its node_modules resolve.
  args.push(path.join(root, 'start.js'), '--session', id);
  if (number) args.push('--number', number);

  const env = {
    ...process.env, // <-- .env already merged in via loadEnvFile()
    UV_THREADPOOL_SIZE: process.env.UV_THREADPOOL_SIZE || '2',
    WRAITH_REPO_ROOT: root,
    WRAITH_SESSION_ID: id,
    WRAITH_DATA_DIR: dir,
  };

  say(cyan(`starting session ${id}${number ? ' · +' + number : ''}`));
  const proc = spawn('node', args, {
    cwd: root,                       // <-- critical for dotenv resolution
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env,
  });

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
  const exitPromise = new Promise(r => (resolveExit = r));

  const rec = {
    number,
    proc,
    restarts: 0,
    resetTimer: null,
    resolveLinked,
    resolveExit,
    mute: () => {
      muted = true;
    },
    unmute: () => {
      muted = false;
      for (const [dest, chunk] of backlog) dest.write(chunk);
      backlog.length = 0;
    },
  };
  children.set(id, rec);

  proc.on('message', m => {
    if (m?.type === 'wraith:linked') {
      try {
        resolveLinked(true);
      } catch {}
    }
    if (m?.type === 'wraith:spawn_session' && m.sessionId) {
      if (children.has(m.sessionId)) {
        say(yellow(`session ${m.sessionId} is already running`));
      } else {
        say(
          green(
            `dynamic spawn request received for session ${m.sessionId}${
              m.number ? ' (+' + m.number + ')' : ''
            }`
          )
        );
        spawnSession(root, m.sessionId, m.number || null);
      }
    }
    if (m?.type === 'wraith:restart_all') {
      say(
        cyan(
          `multi-session update requested by ${id} — restarting all other sessions`
        )
      );
      for (const [otherId, otherRec] of children.entries()) {
        if (otherId !== id) {
          restartingSessions.add(otherId);
          try {
            otherRec.proc.kill('SIGTERM');
          } catch {}
        }
      }
    }
    if (m?.type === 'wraith:delete_session' && m.sessionId) {
      const targetId = m.sessionId;
      say(yellow(`delete session request received for ${targetId}`));
      if (children.has(targetId)) {
        const targetRec = children.get(targetId);
        try {
          targetRec.proc.kill('SIGTERM');
        } catch {}
        children.delete(targetId);
      }
      const targetDir = instDir(root, targetId);
      setTimeout(() => {
        try {
          fs.rmSync(targetDir, { recursive: true, force: true });
          say(green(`deleted session instance directory: ${targetId}`));
        } catch (e) {
          say(red(`failed to remove directory for ${targetId}: ${e.message}`));
        }
      }, 1500);
    }
  });

  proc.on('error', err =>
    console.error(clock(), red('spawn error:'), err.message)
  );

  proc.on('exit', (code, signal) => {
    children.delete(id);
    try {
      resolveExit({ code, signal });
    } catch {}

    if (shuttingDown) return;

    if (restartingSessions.has(id)) {
      restartingSessions.delete(id);
      say(cyan(`restarting session ${id} for update…`));
      setTimeout(() => {
        if (!shuttingDown) spawnSession(root, id, rec.number);
      }, 1000);
      return;
    }

    if (signal === 'SIGINT' || signal === 'SIGTERM') return;

    rec.restarts++;
    if (rec.restarts > MAX_RESTARTS) {
      say(red(`${id}: exceeded max restarts (${MAX_RESTARTS}) — giving up`));
      return;
    }

    const wait = Math.min(1500 * Math.pow(2, rec.restarts - 1), 30_000);
    const exitDetail =
      code !== null
        ? `code ${code}`
        : signal
        ? `signal ${signal}`
        : 'code null';
    const why =
      code === 0
        ? 'restarting for update/clean exit'
        : `crashed (${exitDetail})`;
    say(
      yellow(
        `${id}: ${why} · retry ${rec.restarts} in ${(wait / 1000).toFixed(1)}s`
      )
    );

    setTimeout(() => {
      if (!shuttingDown) spawnSession(root, id, rec.number);
    }, wait);
  });

  clearTimeout(rec.resetTimer);
  rec.resetTimer = setTimeout(() => {
    rec.restarts = 0;
  }, 20_000);

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
      setTimeout(
        () =>
          rej(
            new Error(
              `session ${id} link timeout after ${LINK_WAIT_MS / 1000}s`
            )
          ),
        LINK_WAIT_MS
      )
    ),
  ]);
}

function muteAll() {
  for (const rec of children.values()) rec.mute?.();
}
function unmuteAll() {
  for (const rec of children.values()) rec.unmute?.();
}

async function linkOne(root, label, presetNumber = null) {
  let number = presetNumber;

  if (number) {
    say(cyan(`using configured number +${number}`));
  } else if (!process.stdin.isTTY || !rl) {
    throw new Error(
      'no phone number available — set WRAITH_PHONE env or pass --phone=923001234567'
    );
  } else {
    number = await promptNumber(label);
  }

  const id = nextSessionId(root);
  say(grey(`spawning session ${id} for +${number} — waiting for pairing code…`));

  const result = spawnSession(root, id, number);
  try {
    await waitForLink(result, id);
    console.log(green(`\n ✔ ${id} linked (+${number})`));
    return true;
  } catch (e) {
    console.error(red(` ✖ ${e.message}`));
    return false;
  }
}

async function wizard(root) {
  console.log();
  console.log(violet(' ╭───────────────────────────────────────╮'));
  console.log(violet(' │') + ' WRAITH · pairing wizard ' + violet('│'));
  console.log(violet(' ╰───────────────────────────────────────╯'));

  const firstLabel = ADD_MODE ? 'new number' : 'first number';

  const ok1 = await linkOne(root, firstLabel, CONFIGURED_PHONE);
  if (!ok1) {
    say(red('first number failed — aborting wizard'));
    return;
  }

  while (true) {
    if (!process.stdin.isTTY) {
      console.log(grey(' non-interactive — running linked session(s).\n'));
      break;
    }
    muteAll();
    await new Promise(r => setTimeout(r, 250));
    process.stdout.write('\n');
    const ans = await ask(
      violet(' ❯ ') + 'link another number? ' + grey('[y/N]: ')
    );
    unmuteAll();
    if (!/^y(es)?$/i.test(ans)) {
      console.log(grey(' done — running linked session(s).\n'));
      break;
    }
    const ok = await linkOne(root, 'next number');
    if (!ok) {
      console.log(grey(' aborting further links.\n'));
      break;
    }
  }
}

function quiet(sig) {
  if (shuttingDown) return;
  shuttingDown = true;
  say(grey(`${sig} received — shutting down all sessions`));
  for (const { proc } of children.values()) {
    try {
      proc.kill('SIGTERM');
    } catch {}
  }
  setTimeout(() => process.exit(0), 800);
}

process.on('SIGINT', () => quiet('SIGINT'));
process.on('SIGTERM', () => quiet('SIGTERM'));

// ─────────────────────────────────────────────
// 7. Main entry
// ─────────────────────────────────────────────
(async () => {
  try {
    veil();
    const root = repoRoot();
    if (!fs.existsSync(path.join(root, 'node_modules'))) installDeps(root);
    makeInstance(root, 'main');
    migrateLegacy(root);

    const existing = listExistingInstances(root);

    // ── non-interactive (Pterodactyl, PM2, systemd, docker) ──
    if (!process.stdin.isTTY) {
      if (existing.length) {
        say(
          grey(
            `[non-interactive] resuming ${existing.length} session(s): ${existing.join(
              ', '
            )}`
          )
        );
        for (const id of existing) spawnSession(root, id, null);
        return;
      }

      if (CONFIGURED_PHONE) {
        say(
          grey(
            `[non-interactive] no sessions found — auto-pairing +${CONFIGURED_PHONE}`
          )
        );
        try {
          const ok = await linkOne(root, 'auto', CONFIGURED_PHONE);
          if (!ok) process.exit(0);
        } catch (e) {
          console.error(red(`auto-pair failed: ${e.message}`));
          process.exit(0);
        }
        return;
      }

      say(red('[non-interactive] no linked sessions and no WRAITH_PHONE set'));
      say(
        grey(
          '  → set WRAITH_PHONE=923001234567 in your env, or run once interactively'
        )
      );
      process.exit(0);
    }

    // ── interactive TTY ──
    rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

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
  } catch (err) {
    console.error(red('FATAL:'), err.message);
    process.exit(1);
  }
})();
