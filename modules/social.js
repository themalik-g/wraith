// ─────────────────────────────────────────────
// WRAITH · modules/social.js
// Phase 4: Social search + Background removal
// ─────────────────────────────────────────────
import fs from 'node:fs';
import { downloadContentFromMessage } from '@whiskeysockets/baileys';
import { isOwner } from '../core/identity.js';
import { withTempFile, downloadToFile } from '../lib/net.js';

function ownerOnly(sock, chat, msg) {
  const from = msg.key.participant || msg.key.remoteJid;
  if (!msg.key.fromMe && !isOwner(from)) {
    sock.sendMessage(chat, { text: '⛔ Owner only.' }, { quoted: msg }).catch(() => {});
    return true;
  }
  return false;
}

// ★ FIX: timed fetch helpers — a blocked platform now errors out instead of
//        parking the command forever
async function timedFetchJson(url, headers, timeout = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally { clearTimeout(timer); }
}
async function timedFetchText(url, headers, timeout = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally { clearTimeout(timer); }
}

// ── Social search helpers ───────────────────────────────────────────────────
async function searchInstagram(username) {
  try {
    const data = await timedFetchJson(
      `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`,
      {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'x-ig-app-id': '936619743392459',
      }
    );
    const u = data?.data?.user;
    if (!u) return { ok: false };
    return {
      ok: true,
      platform: 'Instagram',
      username: u.username,
      fullName: u.full_name,
      biography: u.biography,
      followers: u.edge_followed_by?.count,
      following: u.edge_follow?.count,
      posts: u.edge_owner_to_timeline_media?.count,
      profilePic: u.profile_pic_url_hd || u.profile_pic_url,
      verified: u.is_verified,
    };
  } catch { return { ok: false }; }
}

async function searchTikTok(username) {
  try {
    const data = await timedFetchText(
      `https://www.tiktok.com/@${encodeURIComponent(username)}`,
      { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    );
    const followers = data.match(/"followerCount":(\d+)/)?.[1];
    const following = data.match(/"followingCount":(\d+)/)?.[1];
    const likes = data.match(/"heartCount":(\d+)/)?.[1];
    const videos = data.match(/"videoCount":(\d+)/)?.[1];
    const bio = data.match(/"signature":"((?:[^"\\]|\\.)*)"/)?.[1];
    const nick = data.match(/"nickname":"((?:[^"\\]|\\.)*)"/)?.[1];
    if (!nick && !followers) return { ok: false };
    return {
      ok: true,
      platform: 'TikTok',
      username,
      fullName: nick ? nick.replace(/\\u002F/g, '/') : username,
      biography: bio ? bio.replace(/\\n/g, ' ') : '—',
      followers: followers ? parseInt(followers) : '—',
      following: following ? parseInt(following) : '—',
      likes: likes ? parseInt(likes) : '—',
      videos: videos ? parseInt(videos) : '—',
    };
  } catch { return { ok: false }; }
}

async function searchFacebook(username) {
  try {
    const html = await timedFetchText(
      `https://www.facebook.com/${encodeURIComponent(username)}`,
      { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    );
    const title = html.match(/<title>([^<]+)<\/title>/)?.[1] || '';
    if (!title || /log in|login|facebook$/i.test(title)) return { ok: false };
    return { ok: true, platform: 'Facebook', username, fullName: title.replace(/ \| Facebook.*$/, ''), biography: '—', followers: '—', following: '—' };
  } catch { return { ok: false }; }
}

async function socialSearch(sock, chat, msg, args, fn, label) {
  if (ownerOnly(sock, chat, msg)) return;
  try {
    const username = (args?.[0] || '').replace(/^@/, '').trim();
    if (!username) return sock.sendMessage(chat, { text: `❌ Usage: \`.${label} <username>\`` }, { quoted: msg });
    const r = await fn(username);
    if (!r.ok) {
      return sock.sendMessage(chat, {
        text: `❌ Could not fetch *${username}*.\n_The platform may be blocking server requests — these endpoints work best from residential IPs._`,
      }, { quoted: msg });
    }

    const lines = [
      `${r.platform === 'Instagram' ? '📸' : r.platform === 'TikTok' ? '🎵' : '📘'} *${r.platform}* — @${r.username}`,
      '',
      `• *name* · ${r.fullName || '—'}`,
      `• *bio* · ${String(r.biography || '—').slice(0, 200)}`,
      `• *followers* · ${r.followers ?? '—'}`,
      `• *following* · ${r.following ?? '—'}`,
      r.posts ? `• *posts* · ${r.posts}` : '',
      r.likes ? `• *likes* · ${r.likes.toLocaleString?.() ?? r.likes}` : '',
      r.videos ? `• *videos* · ${r.videos}` : '',
      r.verified ? '✅ verified account' : '',
    ].filter(Boolean);

    if (r.profilePic) {
      try {
        await withTempFile('pfp.jpg', async (dest) => {
          await downloadToFile(r.profilePic, dest, 5 * 1024 * 1024);
          await sock.sendMessage(chat, { image: fs.readFileSync(dest), caption: lines.join('\n') }, { quoted: msg });
        });
        return;
      } catch {}
    }
    await sock.sendMessage(chat, { text: lines.join('\n') }, { quoted: msg });
  } catch (e) {
    await sock.sendMessage(chat, { text: `⚠️ ${label} failed: ${e.message}` }, { quoted: msg }).catch(() => {});
  }
}

export async function igCommand(sock, chat, msg, args) { return socialSearch(sock, chat, msg, args, searchInstagram, 'ig'); }
export async function tiktokCommand(sock, chat, msg, args) { return socialSearch(sock, chat, msg, args, searchTikTok, 'tiktok'); }
export async function fbCommand(sock, chat, msg, args) { return socialSearch(sock, chat, msg, args, searchFacebook, 'fb'); }

// ── .rmbg ───────────────────────────────────────────────────────────────────
// No reliable keyless background-removal API exists for production use,
// so these two work with FREE keys:
//   BRIA_API_KEY  → https://bria.ai (free tier, no card)
//   HF_TOKEN      → https://huggingface.co (free, raises rate limits)
async function removeBackground(buffer) {
  // 1) Bria RMBG (official API, free tier)
  const briaKey = process.env.BRIA_API_KEY;
  if (briaKey) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30000);
      let data;
      try {
        const res = await fetch('https://api.bria.ai/api/v1/image/edit/remove_background', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${briaKey}` },
          body: JSON.stringify({ image: buffer.toString('base64') }),
          signal: controller.signal,
        });
        if (res.ok) data = await res.json();
      } finally { clearTimeout(timer); }
      const b64 = data?.image || data?.result;
      if (b64) return Buffer.from(b64, 'base64');
    } catch {}
  }
  // 2) Hugging Face Inference — public RMBG-1.4 model
  try {
    const hfToken = process.env.HF_TOKEN;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45000);
    try {
      const res = await fetch('https://api-inference.huggingface.co/models/briaai/RMBG-1.4', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          ...(hfToken ? { Authorization: `Bearer ${hfToken}` } : {}),
        },
        body: buffer,
        signal: controller.signal,
      });
      if (res.ok) {
        const out = Buffer.from(await res.arrayBuffer());
        if (out.length > 500) return out;
      }
    } finally { clearTimeout(timer); }
  } catch {}
  return null;
}

export async function rmbgCommand(sock, chat, msg, args) {
  if (ownerOnly(sock, chat, msg)) return;
  try {
    const ctx = msg.message?.extendedTextMessage?.contextInfo;
    const quoted = ctx?.quotedMessage;
    if (!quoted?.imageMessage) {
      return sock.sendMessage(chat, { text: '🖼️ *rmbg*\n\nReply to an image with `.rmbg` to remove its background.' }, { quoted: msg });
    }

    if (quoted.imageMessage.fileLength && Number(quoted.imageMessage.fileLength) > 15 * 1024 * 1024) {
      return sock.sendMessage(chat, { text: '❌ Image too large (max 15 MB).' }, { quoted: msg });
    }

    await sock.sendMessage(chat, { text: '🖼️ Removing background…' }, { quoted: msg });
    const stream = await downloadContentFromMessage(quoted.imageMessage, 'image');
    const chunks = [];
    for await (const c of stream) chunks.push(c);
    const buffer = Buffer.concat(chunks);

    const out = await removeBackground(buffer);
    if (!out) {
      return sock.sendMessage(chat, {
        text: '❌ Background removal unavailable right now.\n\nNo dependable *keyless* API exists. Add a free key to enable it:\n• `BRIA_API_KEY` from bria.ai (free tier)\n• `HF_TOKEN` from huggingface.co (free)',
      }, { quoted: msg });
    }
    await sock.sendMessage(chat, { image: out, caption: '🖼️ Background removed.' }, { quoted: msg });
  } catch (e) {
    await sock.sendMessage(chat, { text: `⚠️ rmbg failed: ${e.message}` }, { quoted: msg }).catch(() => {});
  }
}
