// ─────────────────────────────────────────────
//  WRAITH · modules/update.js
//  .update — re-fetch bot files from the repo,
//  keep session/state folders untouched,
//  auto-install if dependencies changed,
//  then restart cleanly (launcher auto-reboots).
// ─────────────────────────────────────────────
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { isOwner } from '../core/identity.js';

const here = path.dirname(fileURLToPath(import.meta.url));

// The launcher (index.js) passes WRAITH_REPO_ROOT explicitly.
// Fallback: two levels up from modules/ → repo root (works when
// running directly without the launcher).
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

export async function updateCommand(sock, chat, msg) {
    const from = msg.key.participant || msg.key.remoteJid;

    if (!msg.key.fromMe && !isOwner(from)) {
        return sock.sendMessage(chat, { text: '⛔ Owner only.' }, { quoted: msg });
    }

    const send = t => sock.sendMessage(chat, { text: t }, { quoted: msg });
    const root = repoRoot();

    await send('🔄 *update* — fetching latest files from repository…');

    if (!fs.existsSync(path.join(root, '.git'))) {
        return send('❌ this deployment is not a git clone — update is only available for git-based installs.');
    }

    const pkgBefore = hash(path.join(root, 'package.json'));

    let pulled;
    try {
        pulled = spawnSync('git', ['pull', '--ff-only'], {
            cwd: root, encoding: 'utf-8', timeout: 120_000
        });
    } catch (e) {
        return send(`❌ git error: ${e.message}`);
    }

    if (pulled.error || pulled.status !== 0) {
        const err = ((pulled.stderr || '') + '\n' + (pulled.stdout || '')).trim();
        return send(
            `❌ update failed:\n\`\`\`\n${err.slice(0, 600)}\n\`\`\`\n\n` +
            `manual fix:\n\`git -C ${root} reset --hard origin/main\``
        );
    }

    const out = (pulled.stdout || '').trim();
    if (/already up to date/i.test(out)) {
        return send('✅ wraith is already up to date.');
    }

    const pkgAfter = hash(path.join(root, 'package.json'));
    if (pkgBefore !== pkgAfter) {
        await send('📦 package.json changed — installing dependencies…');
        const inst = spawnSync('npm', ['install', '--omit=dev'], {
            cwd: root, encoding: 'utf-8', timeout: 300_000
        });
        if (inst.status !== 0) {
            return send('⚠️ code updated but dependency install failed — check logs, then restart manually.');
        }
    }

    await send(
        `✅ *update complete*\n\n` +
        `\`\`\`\n${out.slice(0, 500)}\n\`\`\`\n\n` +
        `sessions & settings untouched · restarting…`
    );

    // [FIX] 5 seconds — enough for WhatsApp to ack a slow send
    setTimeout(() => process.exit(0), 5000);
}
