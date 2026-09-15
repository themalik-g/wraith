// ─────────────────────────────────────────────
// WRAITH · modules/social.js
// Phase 4: Social search + Background removal
// ─────────────────────────────────────────────
import fs from 'node:fs';
import { downloadContentFromMessage } from '@whiskeysockets/baileys';
import { isOwner } from '../core/identity.js';
import { withTempFile, downloadToFile, chunkText } from '../lib/net.js';
import { CONFIG } from '../config.js';

function ownerOnly(sock, chat, msg) {
  const from = msg.key.participant || msg.key.remoteJid;
  if (!msg.key.fromMe && !isOwner(from)) {
    sock.sendMessage(chat, { text: '⛔ Owner only.' }, { quoted: msg }).catch(() => {});
    return true;
  }
  return false;
}

// ── Social search helpers (keyless scrapers) ────────────────────────────────
async function searchInstagram(username) {
  try {
    const data = await fetch(`https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'x-ig-app-id': '936619743392459',
      },
    }).then((r) => r.json());
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
    const data = await fetch(`https://www.tiktok.com/@${encodeURIComponent(username)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    }).then((r) => r.text());
    // Basic extraction from embedded JSON
    const uname = username;
    const followers = data.match(/"followerCount":(\d+)/)?.[1];
    const following = data.match(/"followingCount":(\d+)/)?.[1];
    const likes = data.match(/"heartCount":(\d+)/)?.[1];
    const videos = data.match(/"videoCount":(\d+)/)?.[1];
    const bio = data.match(/"signature":"([^"]+)"/)?.[1];
    const nick = data.match(/"nickname":"([^"]+)"/)?.[1];
    return {
      ok: true,
      platform: 'TikTok',
      username: uname,
      fullName: nick || uname,
      biography: bio || '—',
      followers: followers ? parseInt(followers) : '—',
      following: following ? parseInt(following) : '—',
      likes: likes ? parseInt(likes) : '—',
      videos: videos ? parseInt(videos) : '—',
    };
  } catch { return { ok: false }; }
}

async function searchFacebook(username) {
  // Facebook public profile scraping is heavily restricted.
  // We return basic info from the page title.
  try {
    const html = await fetch(`https://www.facebook.com/${encodeURIComponent(username)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    }).then((r) => r.text());
    const title = html.match(/<title>([^<]+)<\/title>/)?.[1] || username;
    return { ok: true, platform: 'Facebook', username, fullName: title.replace(/ \| Facebook/, ''), biography: '—', followers: '—', following: '—' };
  } catch { return { ok: false }; }
}

// ── .ig / .tiktok / .fb ─────────────────────────────────────────────────────
async function socialSearch(sock, chat, msg, args, fn, label) {
  if (ownerOnly(sock, chat, msg)) return;
  try {
    const username = (args?.[0] || '').replace('@', '').trim();
    if (!username) return sock.sendMessage(chat, { text: `❌ Usage: \`.${label} <username>\`` }, { quoted: msg });
    const r = await fn(username);
    if (!r.ok) return sock.sendMessage(chat, { text: `❌ Could not fetch ${label} profile for *${username}*.` }, { quoted: msg });

    const lines = [
      `${r.platform === 'Instagram' ? '📸' : r.platform === 'TikTok' ? '🎵' : '📘'} *${r.platform}* — @${r.username}`,
      '',
      `• *name* · ${r.fullName || '—'}`,
      `• *bio* · ${r.biography || '—'}`,
      `• *followers* · ${r.followers ?? '—'}`,
      `• *following* · ${r.following ?? '—'}`,
      r.posts ? `• *posts* · ${r.posts}` : '',
      r.likes ? `• *likes* · ${r.likes}` : '',
      r.videos ? `• *videos* · ${r.videos}` : '',
      r.verified ? '✅ verified' : '',
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

// ── .rmbg (background removal) ──────────────────────────────────────────────
export async function rmbgCommand(sock, chat, msg, args) {
  if (ownerOnly(sock, chat, msg)) return;
  try {
    const ctx = msg.message?.extendedTextMessage?.contextInfo;
    const quoted = ctx?.quotedMessage;
    if (!quoted?.imageMessage) {
      return sock.sendMessage(chat, { text: '🖼️ *rmbg*\n\nReply to an image with `.rmbg` to remove its background.' }, { quoted: msg });
    }

    const stream = await downloadContentFromMessage(quoted.imageMessage, 'image');
    const chunks = [];
    for await (const c of stream) chunks.push(c);
    const buffer = Buffer.concat(chunks);

    // Try Bria RMBG-2.0 Sandbox (no signup required for single images)
    const form = new FormData();
    form.append('image', new Blob([buffer], { type: 'image/png' }), 'input.png');
    const res = await fetch('https://api.bria.ai/api/v1/image/edit/remove_background', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: buffer.toString('base64') }),
    });

    if (res.ok) {
      const data = await res.json();
      const outBuffer = data?.image ? Buffer.from(data.image, 'base64') : null;
      if (outBuffer) {
        await sock.sendMessage(chat, { image: outBuffer, caption: '🖼️ Background removed — _Bria RMBG-2.0_' }, { quoted: msg });
        return;
      }
    }

    // Fallback: try withoutbg-style public endpoint
    throw new Error('Background removal service unavailable. Try again later.');
  } catch (e) {
    await sock.sendMessage(chat, { text: `⚠️ rmbg failed: ${e.message}` }, { quoted: msg }).catch(() => {});
  }
}
