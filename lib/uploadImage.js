// ─────────────────────────────────────────────
// WRAITH · lib/uploadImage.js
// Shared image uploader — Buffer → public URL.
// Primary: picrd.com  (permanent, no key, 10MB, PNG/JPG/WebP/GIF)
// Fallback: 0x0.st    (permanent-ish, no key, 512MB)
// ─────────────────────────────────────────────

async function uploadToPicrd(buffer) {
    const form = new FormData();
    form.append('file', new Blob([buffer]), `wraith_${Date.now()}.jpg`);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
        const res = await fetch('https://picrd.com/api/upload', {
            method: 'POST',
            body: form,
            signal: controller.signal,
        });
        if (!res.ok) throw new Error(`picrd HTTP ${res.status}`);
        const data = await res.json();
        if (!data?.image_url) throw new Error('picrd returned no image_url');
        return data.image_url;
    } finally {
        clearTimeout(timer);
    }
}

async function uploadTo0x0(buffer) {
    const form = new FormData();
    form.append('file', new Blob([buffer]), `wraith_${Date.now()}.jpg`);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
        const res = await fetch('https://0x0.st', {
            method: 'POST',
            body: form,
            signal: controller.signal,
        });
        if (!res.ok) throw new Error(`0x0 HTTP ${res.status}`);
        const url = (await res.text()).trim();
        if (!url.startsWith('http')) throw new Error(`0x0 rejected: ${url.slice(0, 120)}`);
        return url;
    } finally {
        clearTimeout(timer);
    }
}

export async function uploadImage(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
        throw new Error('uploadImage: empty buffer');
    }

    const errors = [];

    try {
        return await uploadToPicrd(buffer);
    } catch (e) {
        errors.push(`picrd: ${e.message}`);
    }

    try {
        return await uploadTo0x0(buffer);
    } catch (e) {
        errors.push(`0x0: ${e.message}`);
    }

    throw new Error(`all upload hosts failed — ${errors.join(' | ')}`);
}
