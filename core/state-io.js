// ─────────────────────────────────────────────
//  WRAITH · core/state-io.js
//  Crash-safe JSON state files (tmp + rename).
//  A crash mid-write can no longer corrupt state.
// ─────────────────────────────────────────────
import fs from 'fs';
import path from 'path';

export function readJson(file, fallback) {
    try {
        if (!fs.existsSync(file)) return fallback;
        return JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch {
        return fallback;
    }
}

export function writeJsonAtomic(file, data) {
    try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
        fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
        fs.renameSync(tmp, file);
        return true;
    } catch {
        return false;
    }
}
