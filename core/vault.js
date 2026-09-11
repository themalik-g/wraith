import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { CONFIG } from '../config.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const VAULT = path.join(here, '..', CONFIG.vaultDir);

// Ensure it exists
fs.mkdirSync(VAULT, { recursive: true });

const MAX_MB = 200;
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

export function purgeVault() {
    try {
        for (const f of fs.readdirSync(VAULT)) {
            fs.unlinkSync(path.join(VAULT, f));
        }
    } catch {}
}

export function dropFromVault(fp) {
    try {
        if (fp && fs.existsSync(fp)) fs.unlinkSync(fp);
    } catch {}
}

// Sweep periodically if the vault grows too large
setInterval(() => {
    if (vaultSizeMB() > MAX_MB) purgeVault();
}, SWEEP_MS);
