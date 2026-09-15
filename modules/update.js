// ─────────────────────────────────────────────
//  WRAITH · modules/update.js
//  .update — re-fetch bot files from the repo,
//  keep session/state folders untouched,
//  auto-install if dependencies changed,
//  then restart cleanly.
//
//  On Pterodactyl / pm2, exit code 0 = clean stop
//  and the panel does NOT restart. We exit with
//  a non-zero code to force a restart.
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

function run(cmd, args, opts = {}) {
    return execFileAsync(cmd, args, {
        cwd: opts.cwd ?? repoRoot(),
        encoding: 'utf-8',
        timeout: opts.timeout ?? 120_000,
        maxBuffer: 8 * 1024 * 1024,
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
            _busy = false;
            return send('❌ this deployment is not a git clone — update is only available for git-based installs.');
        }

        const branch = await currentBranch();
        const pkgBefore  = hash(path.join(root, 'package.json'));
        const lockBefore = hash(path.join(root, 'package-lock.json'));

        // 1) fetch with retry
        try {
            await withRetry(async () => {
                const r = await tryRun('git', ['fetch', '--prune', 'origin', branch]);
                if (!r.ok) throw new Error((r.stderr || r.error || 'fetch failed').trim());
                return r;
            }, 3, 1500);
        } catch (e) {
            _busy = false;
            return send(`❌ fetch failed after retries:\n\`\`\`\n${String(e.message).slice(0, 400)}\n\`\`\``);
        }

        // 2) stash local changes
        let stashed = false;
        if (await isDirty()) {
            await send('📦 local changes detected — stashing…');
            const s = await tryRun('git', ['stash', 'push', '-u', '-m', `wraith-auto-${Date.now()}`]);
            if (s.ok && !/No local changes/i.test(s.stdout)) stashed = true;
        }

        // 3) pull with fallback chain
        let pull = await tryRun('git', ['pull', '--ff-only', 'origin', branch]);
        if (!pull.ok) pull = await tryRun('git', ['pull', '--rebase', 'origin', branch]);
        if (!pull.ok) pull = await tryRun('git', ['reset', '--hard', `origin/${branch}`]);

        if (!pull.ok) {
            if (stashed) await tryRun('git', ['stash', 'pop']);
            _busy = false;
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
        const depsChanged = pkgBefore !== pkgAfter || lockBefore !== lockAfter;

        if (depsChanged) {
            await send('📦 dependencies changed — installing (this may take a minute)…');
            const inst = await tryRun(
                'npm',
                ['install', '--omit=dev', '--no-audit', '--no-fund', '--loglevel=error'],
                { timeout: 300_000 }
            );
            if (!inst.ok) {
                _busy = false;
                return send('⚠️ code updated but dependency install failed — check logs, then restart manually.');
            }
        } else if (/already up to date/i.test(out) && !depsChanged) {
            // Nothing changed. Don't restart — avoid pointless downtime.
            _busy = false;
            return send('✅ wraith is already up to date. Nothing to restart.');
        }

        // 6) Tell the user what happens next, THEN trigger restart
        await send(
            `✅ *update complete*\n\n` +
            `\`\`\`\n${(out || 'pulled latest').slice(0, 500)}\n\`\`\`\n\n` +
            `_sessions & settings untouched_\n` +
            `_restarting in 6 seconds — the panel will bring the bot back automatically_`
        );

        // 7) Give time for message delivery, then exit non-zero so the
        //    panel / pm2 treats it as a crash and auto-restarts.
        //
        //    Pterodactyl: exit 0 = "stopped on purpose, don't restart".
        //                 exit != 0 = "crashed, restart me".
        //    pm2:         always restarts by default.
        setTimeout(() => {
            try { process.exit(1); }
            catch {
                try { process.kill(process.pid, 'SIGTERM'); }
                catch { process.exit(1); }
            }
        }, 6000);

    } catch (e) {
        console.error('[update] error:', e?.message);
        _busy = false;
        await send(`❌ update error: ${String(e?.message || e).slice(0, 200)}`).catch(() => {});
    }
}
