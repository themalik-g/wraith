// ─────────────────────────────────────────────
// WRAITH · modules/cobalt.js
// Cobalt API client — backup/primary downloader
// ─────────────────────────────────────────────

import fs from 'node:fs';
import path from 'node:path';

// Cobalt API endpoint — override with COBALT_API_URL env var
// Default: public instance (may be rate-limited). Self-host for production.
const COBALT_API_URL =
  process.env.COBALT_API_URL || 'https://api.cobalt.tools/';

// Platforms supported by Cobalt (domain suffixes)
const COBALT_SUPPORTED_DOMAINS = [
  'youtube.com', 'youtu.be', 'music.youtube.com',
  'instagram.com', 'tiktok.com', 'twitter.com', 'x.com',
  'facebook.com', 'fb.watch', 'reddit.com', 'redd.it',
  'vimeo.com', 'dailymotion.com', 'twitch.tv',
  'soundcloud.com', 'pinterest.com', 'tumblr.com',
  'snapchat.com', 'bilibili.com', 'weibo.com',
  'rutube.ru', 'vk.com', 'ok.ru', 'odnoklassniki.ru',
  'streamable.com', 'imgur.com', 'gfycat.com',
  'coub.com', 'nicovideo.jp', 'bandcamp.com',
];

export function isCobaltSupported(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return COBALT_SUPPORTED_DOMAINS.some(
      (d) => host === d || host.endsWith('.' + d)
    );
  } catch {
    return false;
  }
}

export async function cobaltRequest(url, options = {}) {
  const body = { url, ...options };

  const res = await fetch(COBALT_API_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `Cobalt HTTP ${res.status}: ${text.slice(0, 200) || res.statusText}`
    );
  }

  const data = await res.json();

  if (data.status === 'error') {
    const msg = data.text || data.error?.code || 'unknown error';
    throw new Error(`Cobalt: ${msg}`);
  }

  return data;
}

export async function cobaltDownload(url, outputPath, options = {}) {
  const data = await cobaltRequest(url, options);

  let downloadUrl;
  let filename = 'media';

  switch (data.status) {
    case 'tunnel':
    case 'redirect':
      downloadUrl = data.url;
      filename = data.filename || filename;
      break;

    case 'local-processing': {
      const tunnels = Array.isArray(data.tunnel) ? data.tunnel : [data.tunnel];
      downloadUrl = tunnels.find(Boolean);
      filename = data.output?.filename || filename;
      break;
    }

    case 'picker':
      if (Array.isArray(data.picker) && data.picker.length > 0) {
        downloadUrl = data.picker[0].url;
        filename = data.picker[0].filename || filename;
      } else {
        throw new Error('Cobalt picker returned no items');
      }
      break;

    default:
      throw new Error(`Cobalt unsupported status: ${data.status}`);
  }

  if (!downloadUrl) throw new Error('Cobalt returned no download URL');

  const fileRes = await fetch(downloadUrl);
  if (!fileRes.ok) {
    throw new Error(`Cobalt file download failed: HTTP ${fileRes.status}`);
  }

  const buffer = Buffer.from(await fileRes.arrayBuffer());
  await fs.promises.writeFile(outputPath, buffer);

  return { path: outputPath, filename: path.basename(filename) };
}

export async function cobaltDownloadAudio(url, outputPath, opts = {}) {
  return cobaltDownload(url, outputPath, {
    downloadMode: 'audio',
    audioFormat: opts.audioFormat || 'mp3',
    audioBitrate: opts.audioBitrate || '128',
    ...opts,
  });
}

export async function cobaltDownloadVideo(url, outputPath, opts = {}) {
  return cobaltDownload(url, outputPath, {
    downloadMode: 'auto',
    videoQuality: opts.videoQuality || '720',
    ...opts,
  });
          }
