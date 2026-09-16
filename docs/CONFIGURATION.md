# Configuration

## `config.js`

```javascript
export const CONFIG = {
    owner: "923257853673",              // WhatsApp phone number, digits only
    codename: "WRAITH",                 // Shown in startup banner
    memoryTTL: 60 * 60 * 1000,          // Ledger message retention (1 hour)
    vaultDir: "vault",                  // Temp media folder
    vaultMaxMB: 200,                    // Auto-purge threshold
    reconnectDelay: 3000,               // Auto-reconnect delay (ms)
    keepAliveInterval: 30_000           // Presence heartbeat interval (ms)
};
```

---

## State Files

All state files are stored in `state/`:

| File | Purpose | Auto-created |
|---|---|---|
| `owner.json` | Owner phone number | On first startup |
| `ghost.json` | Anti-delete / anti-edit settings | On first run |
| `ghost-ledger.json` | Inbound message history for reveals | On first message |
| `lurk.json` | Status watcher settings | On first run |
| `peek.json` | View-once reveal settings | On first run |
| `presence.json` | Online & typing toggles | On first run |
| `schedule.json` | Pending scheduled tasks | On first schedule |
| `activity.json` | Per-chat activity metrics | On first message |
| `admin.json` | Per-group protection settings | On first group setting toggle |
| `channel-cache.json` | Cached channel JIDs | On first channel message |
| `prefix.json` | Current command prefix | On first run |
| `mode.json` | Access mode (`public` or `private`) | On first run |

---

## Directories

### `session/`

Baileys authentication state directory. **Never commit or delete** unless re-pairing device.

Contains:
- `creds.json` — Signal protocol key credentials
- `app-state-sync-*.json` — App state sync files
- `lid-mapping-*.json` — LID ↔ PN local mappings

### `vault/`

Temporary media storage during processing. Purged automatically when size exceeds `vaultMaxMB`.

### `logs/`

Process and PM2 log files. Safe to prune.

---

## Environment Variables

| Var | Default | Purpose |
|---|---|---|
| `NODE_ENV` | `production` | Node environment |
| `WRAITH_DEBUG` | unset | Set to `1` for verbose trace logs |

Set `WRAITH_DEBUG=1` to enable verbose trace output:
- Ghost ledger storage events
- View-once extraction steps
- JID resolution paths
- Download execution logs

---

## PM2 Configuration (`ecosystem.config.cjs`)

Key settings:

- `autorestart: true` — restart process on unexpected termination
- `max_memory_restart: 500M` — restart if RAM exceeds 500 MB
- `max_restarts: 20` — cap retries to avoid continuous crash loops
- `kill_timeout: 5000` — graceful shutdown window
