// ─────────────────────────────────────────────
//  WRAITH · core/identity.js
//  Owner identification helpers.
// ─────────────────────────────────────────────
import { CONFIG } from '../config.js';

/**
 * Returns true if the given JID belongs to the configured owner.
 * Handles s.whatsapp.net, lid, and device-suffixed JIDs.
 *
 * @param {string} jid  e.g. "923001234567@s.whatsapp.net" or "923001234567:12@lid"
 * @returns {boolean}
 */
export function isOwner(jid) {
    if (!jid || typeof jid !== 'string') return false;

    const target = CONFIG.owner.replace(/\D/g, '');
    if (!target) return false;

    const bare = jid.split(':')[0].split('@')[0].replace(/\D/g, '');
    return bare === target;
}

/**
 * Returns the owner as a plain @s.whatsapp.net JID.
 * @returns {string}
 */
export function ownerJid() {
    return CONFIG.owner.replace(/\D/g, '') + '@s.whatsapp.net';
}

/**
 * Extract just the digits from any JID.
 * @param {string} jid
 * @returns {string}
 */
export function digitsOf(jid) {
    return (jid || '').split(':')[0].split('@')[0].replace(/\D/g, '');
}
/**
 * Returns true if the given JID is the owner's own DM chat.
 * Used to prevent ghost/peek from tracking their own reports
 * (which would cause an infinite report loop).
 */
export function isOwnerChat(jid) {
    if (!jid || typeof jid !== 'string') return false;
    const target = CONFIG.owner.replace(/\D/g, '');
    if (!target) return false;
    const bare = jid.split('@')[0].split(':')[0].replace(/\D/g, '');
    return bare === target;
}
