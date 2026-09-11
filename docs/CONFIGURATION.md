# Configuration

## `config.js`

```javascript
export const CONFIG = {
    owner: "923257853673",              // WhatsApp number, digits only
    codename: "WRAITH",                 // Shown in startup logs
    memoryTTL: 60 * 60 * 1000,          // Ledger retention (1 hour)
    vaultDir: "vault",                  // Temp media folder
    vaultMaxMB: 200,                    // Auto-purge threshold
    reconnectDelay: 3000,               // Auto-reconnect delay (ms)
    keepAliveInterval: 30_000           // Presence heartbeat (ms)
};
```

⚠️ `owner` **must match** `state/owner.json`.

---

## State Files

All in `state/`:

| File | Purpose | Auto-created |
|---|---|---|
| `owner.json` | Owner number | On first run |
| `ghost.json` | Anti-delete/anti-edit toggles | On first run |
| `ghost-ledger.json` | Message history | On first message |
| `lurk.json` | Lurk settings | On first run |
| `peek.json` | Peek settings | On first run |
| `presence.json` | Presence toggles | On first run |
| `schedule.json` | Pending scheduled messages | On first schedule |
| `activity.json` | Chat activity stats | On first message |
| `admin.json` | Per-group protection toggles | On first toggle |
| `channel-cache.json` | Channels seen from inbound messages | On first channel message |

### Example: `state/lurk.json`

```json
{
  "on": true,
  "react": true,
  "emoji": "🇵🇰",
  "download": false
}
```

### Example: `state/presence.json`

```json
{
  "alwaysOnline": true,
  "autoTyping": false,
  "autoRecording": false,
  "readReceipts": true
}
```

---

## Directories

### `session/`

Baileys auth state. **Never delete** unless you want to re-pair.

Contains:
- `creds.json` — Signal credentials
- `app-state-sync-*.json`
- `lid-mapping-*.json` — LID↔PN cache

### `vault/`

Temp storage for media during processing. Auto-purged when total size exceeds `vaultMaxMB`.

### `logs/`

PM2 output. Safe to delete.

---

## Environment Variables

| Var | Default | Purpose |
|---|---|---|
| `NODE_ENV` | `production` | Standard Node env |
| `WRAITH_DEBUG` | unset | Set to `1` for verbose debug logs |

Set `WRAITH_DEBUG=1` when troubleshooting to see:
- Ledger operations
- Peek extraction details
- Edit detection
- JID resolution paths

---

## PM2 Ecosystem (`ecosystem.config.cjs`)

Key settings:

- `autorestart: true` — restart on crash
- `max_memory_restart: 500M` — restart if RAM exceeds 500 MB
- `max_restarts: 20` — stop retrying after 20 crashes
- `kill_timeout: 5000` — graceful shutdown window
