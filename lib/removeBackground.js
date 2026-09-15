// ─────────────────────────────────────────────
// WRAITH · lib/removeBackground.js
// Uses @imgly/background-removal-node (already installed).
// Runs fully local — no API key, no network calls for inference.
// First run downloads the ONNX model (~40 MB) and caches it.
// ─────────────────────────────────────────────
import { removeBackground as imglyRemove } from '@imgly/background-removal-node';

export async function removeBg(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
        throw new Error('removeBg: empty buffer');
    }

    const blob = await imglyRemove(buffer, {
        output: {
            format: 'image/png',
            quality: 1.0,
            type: 'foreground',
        },
    });

    const out = Buffer.from(await blob.arrayBuffer());
    if (!out.length || out.length < 500) {
        throw new Error('removeBg: model produced empty output');
    }
    return out;
}
