// ─────────────────────────────────────────────
// WRAITH · lib/uploadImage.js
// Shared image uploader — takes a Buffer, returns a public URL.
// Used by:
//   · modules/ai.js   → .remini (reply-to-image mode)
//   · modules/url.js  → .url
//
// Uses catbox.moe — no API key, permanent hosting, 200 MB limit.
// ─────────────────────────────────────────────

export async function uploadImage(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
        throw new Error('uploadImage: empty buffer');
    }

    const form = new FormData();
    form.append('reqtype', 'fileupload');
    form.append('fileToUpload', new Blob([buffer]), `wraith_${Date.now()}.jpg`);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);

    try {
        const res = await fetch('https://catbox.moe/user/api.php', {
            method: 'POST',
            body: form,
            signal: controller.signal,
        });

        if (!res.ok) throw new Error(`catbox HTTP ${res.status}`);

        const url = (await res.text()).trim();
        if (!url.startsWith('http')) {
            throw new Error(`catbox rejected: ${url.slice(0, 120)}`);
        }
        return url;
    } finally {
        clearTimeout(timer);
    }
}
