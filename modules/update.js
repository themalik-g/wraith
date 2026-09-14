// ─────────────────────────────────────────────
//  WRAITH · modules/update.js
//  .update — re-fetch bot files from the repo,
//  keep session/state folders untouched,
//  auto-install if dependencies changed,
//  then restart cleanly (launcher auto-reboots).
// ─────────────────────────────────────────────
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { isOwner } from '../core/identity.js';

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));

let _busy = false;

// The launcher (index.js) passes WRAITH_REPO_ROOT explicitly.
// Fallback: one level up from modules/ → repo root.
function repoRoot() {
    if (process.env.WRAITH_REPO_ROOT && fs.existsSync(process.env.WRAITH_REPO_ROOT)) {
        return process.env.WRAITH_REPO_ROOT;
    }
    return path.resolve(here, '..');
}

function hash(file) {
    try { return crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex'); }
    catch { return ''; }
}

// ── async subprocess helpers (non-blocking) ──
function run(cmd, args, opts = {}) {
    return execFileAsync(cmd, args, {
        cwd: opts.cwd ?? repoRoot(),
        encoding: 'utf-8',
        timeout: opts.timeout ?? 120_000,
        maxBuffer: 8 * 1024 * 1024,
        // never hang on an interactive git credential prompt
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
}

async function tryRun(cmd, args, opts = {}) {
    try {
        const { stdout, stderr } = await run(cmd, args, opts);
        return { ok: true, stdout: stdout || '', stderr: stderr || '' };
    } catch (e) {
        return { ok: false, error: e.message, stdout: e.stdout || '', stderr: e.stderr || '' };
    }
}

async function withRetry(fn, attempts = 3, gapMs = 1500) {
    let last;
    for (let i = 1; i <= attempts; i++) {
        try { return await fn(); }
        catch (e) {
            last = e;
            if (i < attempts) await new Promise(r => setTimeout(r, gapMs * i));
        }
    }
    throw last;
}

async function currentBranch() {
    const r = await tryRun('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
    return r.ok ? r.stdout.trim() : 'main';
}

async function isDirty() {
    const r = await tryRun('git', ['status', '--porcelain']);
    return r.ok && r.stdout.split('\n').some(l => l.trim());
}

export async function updateCommand(sock, chat, msg) {
    const from = msg.key.participant || msg.key.remoteJid;

    if (!msg.key.fromMe && !isOwner(from)) {
        return sock.sendMessage(chat, { text: '⛔ Owner only.' }, { quoted: msg });
    }

    if (_busy) {
        return sock.sendMessage(chat, { text: '⏳ update already in progress.' }, { quoted: msg });
    }
    _busy = true;

    const send = t => sock.sendMessage(chat, { text: t }, { quoted: msg });
    const root = repoRoot();

    try {
        await send('🔄 *update* — fetching latest files from repository…');

        if (!fs.existsSync(path.join(root, '.git'))) {
            return send('❌ this deployment is not a git clone — update is only available for git-based installs.');
        }

        const branch = await currentBranch();
        const pkgBefore  = hash(path.join(root, 'package.json'));
        const lockBefore = hash(path.join(root, 'package-lock.json'));

        // 1) fetch with retry (handles transient network blips)
        try {
            await withRetry(async () => {
                const r = await tryRun('git', ['fetch', '--prune', 'origin', branch]);
                if (!r.ok) throw new Error((r.stderr || r.error || 'fetch failed').trim());
                return r;
            }, 3, 1500);
        } catch (e) {
            return send(`❌ fetch failed after retries:\n\`\`\`\n${String(e.message).slice(0, 400)}\n\`\`\``);
        }

        // 2) stash local changes so pull doesn't abort on a dirty tree
        let stashed = false;
        if (await isDirty()) {
            await send('📦 local changes detected — stashing…');
            const s = await tryRun('git', ['stash', 'push', '-u', '-m', `wraith-auto-${Date.now()}`]);
            if (s.ok && !/No local changes/i.test(s.stdout)) stashed = true;
        }

        // 3) pull with fallback chain: ff-only → rebase → hard reset
        let pull = await tryRun('git', ['pull', '--ff-only', 'origin', branch]);
        if (!pull.ok) pull = await tryRun('git', ['pull', '--rebase', 'origin', branch]);
        if (!pull.ok) pull = await tryRun('git', ['reset', '--hard', `origin/${branch}`]);

        if (!pull.ok) {
            if (stashed) await tryRun('git', ['stash', 'pop']);
            const err = ((pull.stderr || '') + '\n' + (pull.stdout || '') + '\n' + (pull.error || '')).trim();
            return send(
                `❌ update failed:\n\`\`\`\n${err.slice(0, 600)}\n\`\`\`\n\n` +
                `manual fix:\n\`git -C ${root} reset --hard origin/${branch}\``
            );
        }

        // 4) restore stash
        if (stashed) {
            const pop = await tryRun('git', ['stash', 'pop']);
            if (!pop.ok) {
                await send('⚠️ stash restore had conflicts — your edits are safe in `git stash list`.');
            }
        }

        const out = (pull.stdout || '').trim();

        // 5) install deps if package.json OR package-lock.json changed
        const pkgAfter  = hash(path.join(root, 'package.json'));
        const lockAfter = hash(path.join(root, 'package-lock.json'));

        if (pkgBefore !== pkgAfter || lockBefore !== lockAfter) {
            await send('📦 dependencies changed — installing…');
            const inst = await tryRun(
                'npm',
                ['install', '--omit=dev', '--no-audit', '--no-fund', '--loglevel=error'],
                { timeout: 300_000 }
            );
            if (!inst.ok) {
                return send('⚠️ code updated but dependency install failed — check logs, then restart manually.');
            }
        } else if (/already up to date/i.test(out)) {
            return send('✅ wraith is already up to date.');
        }

        await send(
            `✅ *update complete*\n\n` +
            `\`\`\`\n${(out || 'pulled latest').slice(0, 500)}\n\`\`\`\n\n` +
            `sessions & settings untouched · restarting…`
        );

        setTimeout(() => process.exit(0), 5000);
    } catch (e) {
        console.error('[update] error:', e?.message);
        await send(`❌ update error: ${String(e?.message || e).slice(0, 200)}`).catch(() => {});
    } finally {
        _busy = false;
    }
}
