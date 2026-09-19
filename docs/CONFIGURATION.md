# Configuration

## `config.js`

```javascript
export const CONFIG = {
    owner: "923257853673",              // WhatsApp phone number, digits only
    codename: "WRAITH",                 // Shown in startup banner
    memoryTTL: 60 * 60 * 1000,          // Ledger message retention (1 hour)
    reconnectDelay: 3000,               // Auto-reconnect delay (ms)
    keepAliveInterval: 30_000           // Presence heartbeat interval (ms)
};
```

---

## Configuration & Session Management

Session state directories manage Baileys authentication state and connection credentials:
- `creds.json` — Signal protocol key credentials
- `app-state-sync-*.json` — App state sync files
- `lid-mapping-*.json` — LID ↔ PN local mappings

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
