// ─────────────────────────────────────────────
// WRAITH · modules/social.js
// Phase 4: Social search + Background removal
// ─────────────────────────────────────────────
import fs from 'node:fs';
import { downloadContentFromMessage } from '@whiskeysockets/baileys';
import { isOwner } from '../core/identity.js';
import { withTempFile, downloadToFile, BROWSER_USER_AGENT } from '../lib/net.js';
import { getKey } from '../core/keys.js';
import { removeBg } from '../lib/removeBackground.js';

function ownerOnly(sock, chat, msg) {
    const from = msg.key.participant || msg.key.remoteJid;
    if (!msg.key.fromMe && !isOwner(from)) {
        sock.sendMessage(chat, { text: '⛔ Owner only.' }, { quoted: msg }).catch(() => {});
        return true;
    }
    return false;
}

async function timedFetchJson(url, headers, timeout = 15000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
        const res = await fetch(url, { headers: { 'User-Agent': BROWSER_USER_AGENT, ...headers }, signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
    } finally { clearTimeout(timer); }
}
async function timedFetchText(url, headers, timeout = 15000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
        const res = await fetch(url, { headers: { 'User-Agent': BROWSER_USER_AGENT, ...headers }, signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.text();
    } finally { clearTimeout(timer); }
}

// ── Social search helpers ───────────────────────────────────────────────────
async function searchInstagram(username) {
    const headers = {
        'X-IG-App-ID': '936619743392459',
        'X-ASBD-ID': '198387',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
        'Referer': `https://www.instagram.com/${username}/`,
    };
    const sessionid = getKey('IG_SESSIONID');
    if (sessionid) headers['Cookie'] = `sessionid=${sessionid}`;

    for (const host of ['https://www.instagram.com', 'https://i.instagram.com']) {
        try {
            const data = await timedFetchJson(`${host}/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`, headers);
            const u = data?.data?.user;
            if (!u) continue;
            return {
                ok: true, platform: 'Instagram', username: u.username, fullName: u.full_name,
                biography: u.biography,
                followers: u.edge_followed_by?.count ?? u.follower_count,
                following: u.edge_follow?.count ?? u.following_count,
                posts: u.edge_owner_to_timeline_media?.count ?? u.media_count,
                profilePic: u.profile_pic_url_hd || u.profile_pic_url,
                verified: u.is_verified,
            };
        } catch {}
    }
    return { ok: false };
}

async function searchTikTok(username) {
    try {
        const data = await timedFetchJson(`https://www.tikwm.com/api/user/info?unique_id=${encodeURIComponent(username)}`, {});
        const st = data?.data?.stats;
        if (data?.code === 0 && st) {
            return {
                ok: true, platform: 'TikTok', username,
                fullName: data.data.user?.nickname || username,
                biography: data.data.user?.signature || '—',
                followers: st.followerCount, following: st.followingCount,
                likes: st.heartCount, videos: st.videoCount,
            };
        }
    } catch {}
    try {
        const html = await timedFetchText(`https://www.tiktok.com/@${encodeURIComponent(username)}`, {});
        const followers = html.match(/"followerCount":(\d+)/)?.[1];
        const nick = html.match(/"nickname":"((?:[^"\\]|\\.)*)"/)?.[1];
        if (!nick && !followers) return { ok: false };
        return {
            ok: true, platform: 'TikTok', username,
            fullName: nick ? nick.replace(/\\u002F/g, '/') : username,
            biography: (html.match(/"signature":"((?:[^"\\]|\\.)*)"/)?.[1] || '—').replace(/\\n/g, ' '),
            followers: followers ? parseInt(followers) : '—',
            following: html.match(/"followingCount":(\d+)/)?.[1] ?? '—',
            likes: html.match(/"heartCount":(\d+)/)?.[1] ?? '—',
            videos: html.match(/"videoCount":(\d+)/)?.[1] ?? '—',
        };
    } catch { return { ok: false }; }
}

async function searchFacebook(username) {
    try {
        const html = await timedFetchText(`https://www.facebook.com/${encodeURIComponent(username)}`, {});
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
                text: `❌ Could not fetch *${username}*.\n_The platform may be rate-limiting your server's IP. Retrying later or adding IG_SESSIONID to keys.env may help._`,
            }, { quoted: msg });
        }
        const lines = [
            `${r.platform === 'Instagram' ? '📸' : r.platform === 'TikTok' ? '🎵' : '📘'} *${r.platform}* — @${r.username}`, '',
            `• *name* · ${r.fullName || '—'}`,
            `• *bio* · ${String(r.biography || '—').slice(0, 200)}`,
            `• *followers* · ${r.followers ?? '—'}`,
            `• *following* · ${r.following ?? '—'}`,
            r.posts ? `• *posts* · ${r.posts}` : '',
            r.likes ? `• *likes* · ${Number(r.likes).toLocaleString()}` : '',
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

// ── .rmbg — local AI background removal ─────────────────────────────────────
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

        await sock.sendMessage(chat, { text: '🖼️ Removing background… _(first run may download a one-time model)_' }, { quoted: msg });

        const stream = await downloadContentFromMessage(quoted.imageMessage, 'image');
        const chunks = [];
        for await (const c of stream) chunks.push(c);
        const buffer = Buffer.concat(chunks);

        const out = await removeBg(buffer);

        await sock.sendMessage(chat, {
            image: out,
            caption: '🖼️ Background removed.'
        }, { quoted: msg });
    } catch (e) {
        console.error('[rmbg]', e.message);
        await sock.sendMessage(chat, { text: `⚠️ rmbg failed: ${e.message}` }, { quoted: msg }).catch(() => {});
    }
}
