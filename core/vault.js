import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { CONFIG } from '../config.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const VAULT = path.join(here, '..', CONFIG.vaultDir);

// Ensure it exists
fs.mkdirSync(VAULT, { recursive: true });

const MAX_MB = typeof CONFIG.vaultMaxMB === 'number' && CONFIG.vaultMaxMB > 0
    ? CONFIG.vaultMaxMB
    : 200;
const SWEEP_MS = 60 * 1000;

export function vaultPath(name) {
    return path.join(VAULT, name);
}

export function vaultSizeMB() {
    try {
        let total = 0;
        for (const f of fs.readdirSync(VAULT)) {
            const fp = path.join(VAULT, f);
            const st = fs.statSync(fp);
            if (st.isFile()) total += st.size;
        }
        return total / (1024 * 1024);
    } catch {
        return 0;
    }
}

export function purgeVault(olderThanMs = 0) {
    try {
        const cutoff = Date.now() - olderThanMs;
        for (const f of fs.readdirSync(VAULT)) {
            const fp = path.join(VAULT, f);
            try {
                const st = fs.statSync(fp);
                if (!st.isFile()) continue;
                // olderThanMs = 0 → purge everything; otherwise only stale files
                if (olderThanMs > 0 && st.mtimeMs > cutoff) continue;
                fs.unlinkSync(fp);
            } catch {}
        }
    } catch {}
}

export function dropFromVault(fp) {
    try {
        if (fp && fs.existsSync(fp)) fs.unlinkSync(fp);
    } catch {}
}

// Sweep periodically if the vault grows too large.
// Only files idle for 5+ minutes are purged so we never
// unlink media that is actively being sent.
setInterval(() => {
    if (vaultSizeMB() > MAX_MB) purgeVault(5 * 60 * 1000);
}, SWEEP_MS);
