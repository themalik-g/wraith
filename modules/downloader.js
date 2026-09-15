// ─────────────────────────────────────────────
// WRAITH · modules/downloader.js
// Phase 4: Git downloader, MediaFire downloader
// ─────────────────────────────────────────────
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isOwner } from '../core/identity.js';
import { CONFIG } from '../config.js';
import { downloadToFile, withTempFile, chunkText } from '../lib/net.js';

const here = path.dirname(fileURLToPath(import.meta.url));

function ownerOnly(sock, chat, msg) {
  const from = msg.key.participant || msg.key.remoteJid;
  if (!msg.key.fromMe && !isOwner(from)) {
    sock.sendMessage(chat, { text: '⛔ Owner only.' }, { quoted: msg }).catch(() => {});
    return true;
  }
  return false;
}

// ── .gitdl ──────────────────────────────────────────────────────────────────
export async function gitdlCommand(sock, chat, msg, args) {
  if (ownerOnly(sock, chat, msg)) return;
  try {
    const url = (args?.[0] || '').trim();
    if (!url) return sock.sendMessage(chat, { text: '📦 *gitdl*\n\nUsage: `.gitdl <github-repo-url>`' }, { quoted: msg });

    const match = url.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/|$)/);
    if (!match) return sock.sendMessage(chat, { text: '❌ Only GitHub repositories are supported.' }, { quoted: msg });

    const [, owner, repo] = match;
    const zipUrl = `https://api.github.com/repos/${owner}/${repo}/zipball`;
    const maxMB = CONFIG.media?.maxDownloadMB || 100;

    await sock.sendMessage(chat, { text: `📥 Downloading *${owner}/${repo}*…` }, { quoted: msg });

    await withTempFile(`${repo}.zip`, async (dest) => {
      await downloadToFile(zipUrl, dest, maxMB * 1024 * 1024, 10);
      const stat = fs.statSync(dest);
      await sock.sendMessage(chat, {
        document: fs.readFileSync(dest),
        fileName: `${repo}.zip`,
        mimetype: 'application/zip',
        caption: `📦 *${owner}/${repo}*\n_${(stat.size / 1024 / 1024).toFixed(1)} MB_`,
      }, { quoted: msg });
    });
  } catch (e) {
    await sock.sendMessage(chat, { text: `⚠️ gitdl failed: ${e.message}` }, { quoted: msg }).catch(() => {});
  }
}

// ── .mfdl ───────────────────────────────────────────────────────────────────
export async function mfdlCommand(sock, chat, msg, args) {
  if (ownerOnly(sock, chat, msg)) return;
  try {
    const url = (args?.[0] || '').trim();
    if (!url || !url.includes('mediafire.com')) {
      return sock.sendMessage(chat, { text: '📥 *mfdl*\n\nUsage: `.mfdl <mediafire-url>`' }, { quoted: msg });
    }

    const maxMB = CONFIG.media?.maxDownloadMB || 100;
    await sock.sendMessage(chat, { text: '📥 Resolving MediaFire link…' }, { quoted: msg });

    // ★ FIX: the page fetch now has a hard timeout — a hung MediaFire page
    //        returns an error instead of freezing the command
    let html;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20000);
      try {
        const r = await fetch(url, { signal: controller.signal });
        if (!r.ok) throw new Error(`MediaFire page HTTP ${r.status}`);
        html = await r.text();
      } finally { clearTimeout(timer); }
    } catch (e) {
      return sock.sendMessage(chat, { text: `❌ Could not reach MediaFire: ${e.message}` }, { quoted: msg });
    }

    // Resolve direct download link via MediaFire page scrape
    let directUrl = null;
    let fileName = 'mediafire_file';
    try {
      const dlMatch = html.match(/href="(https?:\/\/download[^"]+mediafire[^"]+)"/);
      if (dlMatch) directUrl = dlMatch[1].replace(/&amp;/g, '&');
      const nameMatch = html.match(/<title>([^<]+)<\/title>/);
      if (nameMatch) fileName = nameMatch[1].replace(/ MediaFire/gi, '').trim().slice(0, 60);
    } catch {}

    if (!directUrl) return sock.sendMessage(chat, { text: '❌ Could not resolve MediaFire link.' }, { quoted: msg });

    await withTempFile(fileName, async (dest) => {
      await downloadToFile(directUrl, dest, maxMB * 1024 * 1024, 10);
      const stat = fs.statSync(dest);
      await sock.sendMessage(chat, {
        document: fs.readFileSync(dest),
        fileName,
        mimetype: 'application/octet-stream',
        caption: `📥 *${fileName}*\n_${(stat.size / 1024 / 1024).toFixed(1)} MB_`,
      }, { quoted: msg });
    });
  } catch (e) {
    await sock.sendMessage(chat, { text: `⚠️ mfdl failed: ${e.message}` }, { quoted: msg }).catch(() => {});
  }
}
