// ─────────────────────────────────────────────
//  WRAITH · core/jid-resolver.js
//  Shared JID resolution + newsletter metadata + channel cache.
// ─────────────────────────────────────────────
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const CACHE_FILE = path.join(here, '..', 'state', 'channel-cache.json');
const DEBUG = process.env.WRAITH_DEBUG === '1';

fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });

// ─────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────
export function stripDevice(jid) {
    if (!jid || typeof jid !== 'string') return jid;
    const atIdx = jid.indexOf('@');
    if (atIdx === -1) return jid;
    const userPart = jid.slice(0, atIdx);
    const serverPart = jid.slice(atIdx);
    const colonIdx = userPart.indexOf(':');
    if (colonIdx !== -1) return userPart.slice(0, colonIdx) + serverPart;
    return jid;
}

export function jidType(jid) {
    if (!jid || typeof jid !== 'string') return 'unknown';
    if (jid.endsWith('@lid')) return 'lid';
    if (jid.endsWith('@s.whatsapp.net')) return 'pn';
    if (jid.endsWith('@g.us')) return 'group';
    if (jid.endsWith('@newsletter')) return 'newsletter';
    if (jid.endsWith('@broadcast')) return 'broadcast';
    return 'unknown';
}

export function digitsOf(jid) {
    if (!jid || typeof jid !== 'string') return '';
    return stripDevice(jid).split('@')[0].replace(/\D/g, '');
}

// ─────────────────────────────────────────────
//  Newsletter metadata (official Baileys v7)
// ─────────────────────────────────────────────
export async function fetchNewsletterMeta(sock, jid) {
    if (typeof sock.newsletterMetadata !== 'function') return null;
    try {
        const meta = await sock.newsletterMetadata('jid', jid);
        if (!meta) return null;
        return {
            jid,
            name: meta.name || meta.subject || meta.thread_metadata?.name?.text || 'Unknown',
            subscribers: meta.subscribers || meta.subscriberCount || null,
            description: meta.description || null
        };
    } catch (e) {
        if (DEBUG) console.log('[jid-resolver] newsletterMetadata failed:', e.message);
        return null;
    }
}

// ─────────────────────────────────────────────
//  Channel cache — built from inbound messages
// ─────────────────────────────────────────────
export function cacheChannelFromMessage(msg) {
    if (!msg?.key?.remoteJid) return;
    const jid = msg.key.remoteJid;
    if (!jid.endsWith('@newsletter')) return;

    try {
        let cache = {};
        if (fs.existsSync(CACHE_FILE)) {
            cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
        }
        if (!cache[jid]) {
            cache[jid] = { jid, name: null, firstSeen: Date.now(), lastSeen: Date.now() };
        } else {
            cache[jid].lastSeen = Date.now();
        }
        fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
    } catch (e) {
        if (DEBUG) console.log('[channel-cache] failed:', e.message);
    }
}

export function getCachedChannels() {
    try {
        if (!fs.existsSync(CACHE_FILE)) return [];
        const cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
        return Object.values(cache);
    } catch { return []; }
}

// ─────────────────────────────────────────────
//  Bulk channel listing — fork methods + cache
// ─────────────────────────────────────────────
export async function fetchJoinedChannels(sock) {
    // newsletterSubscribed (itsliaaa, dnuzi, crysnovax forks)
    if (typeof sock.newsletterSubscribed === 'function') {
        try {
            const arr = await sock.newsletterSubscribed();
            if (Array.isArray(arr) && arr.length > 0) {
                const channels = arr.map(c => ({
                    jid: c.jid || c.id,
                    name: c.name || c.subject || 'Unknown'
                }));
                for (const ch of channels) {
                    if (ch.name === 'Unknown') {
                        const meta = await fetchNewsletterMeta(sock, ch.jid);
                        if (meta?.name) ch.name = meta.name;
                    }
                }
                return { ok: true, channels, source: 'newsletterSubscribed' };
            }
        } catch (e) {
            if (DEBUG) console.log('[jid-resolver] newsletterSubscribed failed:', e.message);
        }
    }

    // newsletterFetchAllParticipating (innovatorssoft)
    if (typeof sock.newsletterFetchAllParticipating === 'function') {
        try {
            const map = await sock.newsletterFetchAllParticipating();
            const out = [];
            for (const [jid, meta] of Object.entries(map || {})) {
                out.push({ jid, name: meta?.name || meta?.subject || 'Unknown' });
            }
            if (out.length > 0) return { ok: true, channels: out, source: 'newsletterFetchAllParticipating' };
        } catch (e) {
            if (DEBUG) console.log('[jid-resolver] newsletterFetchAllParticipating failed:', e.message);
        }
    }

    // getNewsletters (nazi-team fork)
    if (typeof sock.getNewsletters === 'function') {
        try {
            const arr = await sock.getNewsletters();
            if (Array.isArray(arr) && arr.length > 0) {
                return {
                    ok: true,
                    channels: arr.map(c => ({ jid: c.jid || c.id, name: c.name || 'Unknown' })),
                    source: 'getNewsletters'
                };
            }
        } catch (e) {
            if (DEBUG) console.log('[jid-resolver] getNewsletters failed:', e.message);
        }
    }

    // Fallback: local cache
    const cached = getCachedChannels();
    if (cached.length > 0) {
        for (const ch of cached) {
            if (!ch.name || ch.name === 'Unknown') {
                const meta = await fetchNewsletterMeta(sock, ch.jid);
                if (meta?.name) ch.name = meta.name;
            }
        }
        return {
            ok: true,
            channels: cached,
            source: 'local-cache',
            note: 'Channels cached since bot start.'
        };
    }

    return {
        ok: false,
        reason: 'Bulk channel listing not available on this Baileys build. ' +
                'Channels will appear over time via the local cache. ' +
                'Use `.getjid currentchat` inside a channel for immediate info.'
    };
}

// ─────────────────────────────────────────────
//  PN ↔ LID
// ─────────────────────────────────────────────
export async function resolvePnToLid(sock, pnJid) {
    const clean = stripDevice(pnJid);
    if (typeof sock.getLIDForPN === 'function') {
        try { const lid = await sock.getLIDForPN(clean); if (lid) return { lid, source: 'sock.getLIDForPN' }; } catch {}
    }
    try {
        const lid = await sock.signalRepository?.lidMapping?.getLIDForPN?.(clean);
        if (lid) return { lid, source: 'lidMapping.getLIDForPN' };
    } catch {}
    return { lid: null, source: null, reason: 'PN → LID mapping not available.' };
}

export async function resolveLidToPn(sock, lidJid, groupJid = null) {
    const clean = stripDevice(lidJid);
    try {
        const pn = await sock.signalRepository?.lidMapping?.getPNForLID?.(clean);
        if (pn) return { pn, source: 'lidMapping.getPNForLID' };
    } catch {}
    if (typeof sock.getPNForLID === 'function') {
        try { const pn = await sock.getPNForLID(clean); if (pn) return { pn, source: 'sock.getPNForLID' }; } catch {}
    }
    if (groupJid) {
        try {
            const meta = await sock.groupMetadata(groupJid);
            for (const p of meta.participants || []) {
                const pId = stripDevice(p.id || '');
                const pLid = stripDevice(p.lid || '');
                if (pId === clean || pLid === clean) {
                    const pn = p.phoneNumber || p.pn || null;
                    if (pn) return { pn, source: 'groupMetadata.participant.phoneNumber' };
                }
            }
        } catch {}
    }
    return { pn: null, source: null, reason: 'LID cannot be reversed — no cached mapping or group metadata.' };
}

export async function resolveNumber(sock, digits) {
    const clean = String(digits).replace(/\D/g, '');
    if (clean.length < 7) return { pn: null, reason: 'Number too short.' };
    try {
        const results = await sock.onWhatsApp(clean);
        if (results?.[0]?.jid) return { pn: results[0].jid, source: 'onWhatsApp' };
    } catch {}
    return { pn: clean + '@s.whatsapp.net', source: 'constructed', note: 'Number not verified.' };
}

export async function resolveUsername(sock, username) {
    const clean = username.replace(/^@/, '').trim();
    if (!clean) return { pn: null, reason: 'Empty username.' };
    if (typeof sock.findUserByUsername === 'function') {
        try { const user = await sock.findUserByUsername(clean); if (user?.jid) return { pn: user.jid, source: 'findUserByUsername' }; } catch {}
    }
    try { const results = await sock.onWhatsApp(clean); if (results?.[0]?.jid) return { pn: results[0].jid, source: 'onWhatsApp' }; } catch {}
    return { pn: null, reason: 'Username lookup not supported on this build.' };
}

export function resolveFromMessageKey(key) {
    if (!key) return { pn: null, lid: null, source: null };
    if (key.participant) {
        const p = stripDevice(key.participant);
        const alt = stripDevice(key.participantAlt || '');
        if (jidType(p) === 'lid') return { lid: p, pn: jidType(alt) === 'pn' ? alt : null, source: 'participant' };
        if (jidType(p) === 'pn') return { pn: p, lid: jidType(alt) === 'lid' ? alt : null, source: 'participant' };
    }
    if (key.remoteJid) {
        const r = stripDevice(key.remoteJid);
        const alt = stripDevice(key.remoteJidAlt || '');
        if (jidType(r) === 'lid') return { lid: r, pn: jidType(alt) === 'pn' ? alt : null, source: 'remoteJid' };
        if (jidType(r) === 'pn') return { pn: r, lid: jidType(alt) === 'lid' ? alt : null, source: 'remoteJid' };
        if (jidType(r) === 'group' || jidType(r) === 'newsletter') return { pn: null, lid: null, source: 'group', groupJid: r };
    }
    return { pn: null, lid: null, source: null };
}

export async function resolveFromGroup(sock, targetJid, groupJid) {
    try {
        const meta = await sock.groupMetadata(groupJid);
        const clean = stripDevice(targetJid);
        for (const p of meta.participants || []) {
            const pId = stripDevice(p.id || '');
            const pLid = stripDevice(p.lid || '');
            const pPhone = stripDevice(p.phoneNumber || '');
            if (pId === clean || pLid === clean || pPhone === clean) {
                return {
                    pn: pPhone || (jidType(pId) === 'pn' ? pId : null),
                    lid: pLid || (jidType(pId) === 'lid' ? pId : null),
                    source: 'groupMetadata',
                    admin: p.admin || null
                };
            }
        }
    } catch {}
    return { pn: null, lid: null, source: null };
}

export async function resolveAllGroupMembers(sock, groupJid) {
    try {
        const meta = await sock.groupMetadata(groupJid);
        const members = [];
        for (const p of meta.participants || []) {
            const pId = stripDevice(p.id || '');
            const pLid = stripDevice(p.lid || '');
            const pPhone = stripDevice(p.phoneNumber || '');
            members.push({
                pn: pPhone || (jidType(pId) === 'pn' ? pId : null),
                lid: pLid || (jidType(pId) === 'lid' ? pId : null),
                admin: p.admin || null,
                primary: pId
            });
        }
        return { ok: true, members, subject: meta.subject, size: members.length };
    } catch (e) {
        return { ok: false, reason: e.message };
    }
}

// ─────────────────────────────────────────────
//  Full resolver
// ─────────────────────────────────────────────
export async function resolveBoth(sock, input, ctx = {}) {
    const result = { pn: null, lid: null, source: null, reason: null, note: null };
    if (!input) { result.reason = 'No input provided.'; return result; }

    const clean = input.trim();

    if (ctx.msg?.key) {
        const fromMsg = resolveFromMessageKey(ctx.msg.key);
        if (fromMsg.pn || fromMsg.lid) {
            result.pn = fromMsg.pn;
            result.lid = fromMsg.lid;
            result.source = fromMsg.source;
        }
    }

    if (clean.includes('@')) {
        const type = jidType(clean);
        if (type === 'pn') {
            result.pn = stripDevice(clean);
            if (!result.lid) {
                const r = await resolvePnToLid(sock, clean);
                if (r.lid) { result.lid = r.lid; result.source = r.source; }
                else if (!result.reason) result.reason = r.reason;
            }
            return result;
        }
        if (type === 'lid') {
            result.lid = stripDevice(clean);
            if (!result.pn) {
                const r = await resolveLidToPn(sock, clean, ctx.groupJid);
                if (r.pn) { result.pn = r.pn; result.source = r.source; }
                else result.reason = r.reason;
            }
            return result;
        }
        if (type === 'group') {
            result.pn = clean; result.source = 'group';
            result.note = 'Group JIDs do not have LID equivalents.';
            return result;
        }
        if (type === 'newsletter') {
            result.pn = clean; result.source = 'newsletter';
            const meta = await fetchNewsletterMeta(sock, clean);
            if (meta) {
                result.note = `Channel: ${meta.name}`;
                result.channelName = meta.name;
                result.subscribers = meta.subscribers;
            } else {
                result.note = 'Newsletter/Channel JID.';
            }
            return result;
        }
        result.pn = clean; result.source = 'unknown'; result.reason = 'Unrecognized JID.';
        return result;
    }

    if (clean.startsWith('@')) {
        const r = await resolveUsername(sock, clean);
        if (r.pn) {
            result.pn = r.pn; result.source = r.source;
            if (!result.lid) {
                const lr = await resolvePnToLid(sock, r.pn);
                if (lr.lid) { result.lid = lr.lid; result.source = `${result.source} + ${lr.source}`; }
            }
        } else result.reason = r.reason;
        return result;
    }

    const digits = clean.replace(/\D/g, '');
    if (digits.length >= 7) {
        const r = await resolveNumber(sock, digits);
        if (r.pn) {
            result.pn = r.pn; result.source = r.source;
            if (r.note) result.note = r.note;
            if (!result.lid) {
                const lr = await resolvePnToLid(sock, r.pn);
                if (lr.lid) { result.lid = lr.lid; result.source = `${result.source} + ${lr.source}`; }
            }
        } else result.reason = r.reason;
        return result;
    }

    result.reason = 'Input is not a valid number, username, or JID.';
    return result;
}
