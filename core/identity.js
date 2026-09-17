// ─────────────────────────────────────────────
//  WRAITH · core/identity.js
//  Owner identification & multi-owner helpers.
// ─────────────────────────────────────────────
import fs from 'fs';
import path from 'path';
import { CONFIG } from '../config.js';

const STATE_DIR = path.join(process.cwd(), 'state');
const OWNER_FILE = path.join(STATE_DIR, 'owner.json');

function readOwnerData() {
    try {
        if (fs.existsSync(OWNER_FILE)) {
            const raw = JSON.parse(fs.readFileSync(OWNER_FILE, 'utf-8'));
            return {
                owner: (raw.owner || CONFIG.owner || '').replace(/\D/g, ''),
                owners: Array.isArray(raw.owners) ? raw.owners.map(x => String(x).replace(/\D/g, '')).filter(Boolean) : []
            };
        }
    } catch {}
    const owner = (CONFIG.owner || '').replace(/\D/g, '');
    return { owner, owners: [] };
}

function saveOwnerData(data) {
    try {
        fs.mkdirSync(STATE_DIR, { recursive: true });
        fs.writeFileSync(OWNER_FILE, JSON.stringify(data, null, 2));
    } catch {}
}

/**
 * Returns true if the given JID belongs to the primary owner.
 */
export function isPrimaryOwner(jid) {
    if (!jid || typeof jid !== 'string') return false;
    const { owner } = readOwnerData();
    if (!owner) return false;
    const bare = jid.split(':')[0].split('@')[0].replace(/\D/g, '');
    return bare === owner;
}

/**
 * Returns true if the given JID belongs to the primary or any secondary owner.
 */
export function isOwner(jid) {
    if (!jid || typeof jid !== 'string') return false;
    const { owner, owners } = readOwnerData();
    const bare = jid.split(':')[0].split('@')[0].replace(/\D/g, '');
    if (!bare) return false;
    if (owner && bare === owner) return true;
    return owners.includes(bare);
}

/**
 * Returns the primary owner as a plain @s.whatsapp.net JID.
 */
export function ownerJid() {
    const { owner } = readOwnerData();
    return owner + '@s.whatsapp.net';
}

/**
 * Extract just the digits from any JID.
 */
export function digitsOf(jid) {
    return (jid || '').split(':')[0].split('@')[0].replace(/\D/g, '');
}

/**
 * Returns true if the given JID is an owner's DM chat.
 */
export function isOwnerChat(jid) {
    if (!jid || typeof jid !== 'string') return false;
    const { owner, owners } = readOwnerData();
    const bare = jid.split('@')[0].split(':')[0].replace(/\D/g, '');
    if (!bare) return false;
    return bare === owner || owners.includes(bare);
}

/**
 * Get object containing primary owner and secondary owners list.
 */
export function getOwnerDetails() {
    return readOwnerData();
}

/**
 * Adds a secondary owner (primary owner only permission).
 */
export function addSecondaryOwner(number) {
    const data = readOwnerData();
    const clean = String(number).replace(/\D/g, '');
    if (!clean) return { ok: false, reason: 'Invalid phone number.' };
    if (clean === data.owner) return { ok: false, reason: 'This number is already the primary owner.' };
    if (data.owners.includes(clean)) return { ok: false, reason: 'This number is already a secondary owner.' };
    data.owners.push(clean);
    saveOwnerData(data);
    return { ok: true, number: clean };
}

/**
 * Removes a secondary owner (primary owner only permission).
 */
export function delSecondaryOwner(number) {
    const data = readOwnerData();
    const clean = String(number).replace(/\D/g, '');
    if (!clean) return { ok: false, reason: 'Invalid phone number.' };
    if (clean === data.owner) return { ok: false, reason: 'Cannot remove the primary owner.' };
    if (!data.owners.includes(clean)) return { ok: false, reason: 'This number is not in the secondary owners list.' };
    data.owners = data.owners.filter(x => x !== clean);
    saveOwnerData(data);
    return { ok: true, number: clean };
}
