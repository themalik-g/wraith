// ─────────────────────────────────────────────
//  WRAITH · runtime configuration
// ─────────────────────────────────────────────

export const CONFIG = {
    // Your WhatsApp number — country code + number, digits only.
    // Example: "923001234567"
    // ⚠️  MUST match state/owner.json
    owner: "923257853673",

    // Shown in menus, banners and startup logs
    codename: "WRAITH",
    botName: "𝙒𝙍𝘼𝙄𝙏𝙃-𝘽𝙊𝙏",

    // Timezone used for schedule parsing and ghost timestamps
    // e.g. "Asia/Karachi", "Asia/Dubai", "Europe/London"
    timezone: "Asia/Karachi",

    // How long a captured message stays in memory (ms). Default: 1 hour.
    memoryTTL: 60 * 60 * 1000,

    // Where captured media is temporarily stored before delivery
    vaultDir: "vault",

    // Max size of vault folder in MB before it gets auto-purged
    vaultMaxMB: 200,

    // Auto-reconnect delay (ms)
    reconnectDelay: 3000
};
