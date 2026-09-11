# Architecture

## High-Level Flow

```
WhatsApp Server
       │
       │ WebSocket
       ▼
  makeWASocket (Baileys)
       │
       │ events
       ▼
   start.js ─────────────► scheduler loop
       │                  presence heartbeat
       │
       │ dispatch(sock, update)
       ▼
   router.js
       │
       ├─ ghost  ──► state/ghost-ledger.json
       ├─ peek   ──► owner DM
       ├─ lurk   ──► status handling
       ├─ schedule ──► state/schedule.json
       ├─ admin  ──► groupParticipantsUpdate
       ├─ jid    ──► core/jid-resolver.js
       ├─ presence ──► state/presence.json
       ├─ activity ──► state/activity.json
       └─ help / ping
```

---

## Module Responsibilities

### `start.js`

- Boots Baileys socket
- Handles pairing code flow
- Manages reconnect on disconnect
- Registers `messages.upsert`, `messages.update`, `messages.reaction` handlers
- Calls `dispatch()` and `dispatchStatus()`
- Starts background loops: scheduler, presence heartbeat

### `router.js`

- Single entry point for all inbound messages
- Order of operations:
  1. Track activity
  2. Cache channel (if newsletter)
  3. Send read receipt (if enabled)
  4. Ghost classification (revoke/edit)
  5. Store in ledger
  6. Auto-peek
  7. Watch quoted view-once
  8. Auto-presence
  9. Group protection (antilink/etc.)
  10. Command parsing + dispatch

### `core/jid-resolver.js`

- Centralized JID utilities
- PN↔LID resolution with 5 fallbacks
- Newsletter metadata + cache
- Group member resolution
- Message key extraction

### `core/identity.js`

- `isOwner(jid)` — owner check
- `ownerJid()` — returns `owner@s.whatsapp.net`
- `digitsOf(jid)` — strips server

### `core/vault.js`

- Temp media storage in `vault/`
- Auto-purge when total size > `vaultMaxMB`
- Sweeps every 60s

### `modules/ghost.js`

- Ledger (Map) loaded from `state/ghost-ledger.json`
- `classifyMessage()` — detects revoke/edit/secret_edit
- `remember()` — stores message + media
- `revealDelete()` — sends original back to owner
- `revealEdit()` — before/after diff
- `revealSecretEdit()` — handles encrypted edits (v7)

### `modules/peek.js`

- `extractViewOnce()` — finds view-once in any wrapper
- `autoPeek()` — fires on every inbound
- `watchQuotedViewOnce()` — extracts from `contextInfo.quotedMessage`
- Two send strategies: forward stripped, download+reupload

### `modules/lurk.js`

- Status watcher with auto-view, react, download
- Silent download mode (no seen, no react)
- Random emoji pool

### `modules/schedule.js`

- Scan-based date parser (robust to LIDs)
- 30s tick loop
- Persists to `state/schedule.json`

### `modules/admin.js`

- `resolveToPnJid()` — LID→PN conversion for group API
- `adminAction()` — kick/add/promote/demote
- `toggleProtection()` — per-group settings
- `handleProtection()` — antilink/antispam/antisticker enforcement

### `modules/profile.js`

- `.getpp` — profile picture fetch
- Supports owner/chat/current targets

### `modules/jid.js`

- `.getjid` subcommands: owner, members, group, channels, currentchat
- Delegates all resolution to `core/jid-resolver.js`

### `modules/presence.js`

- Heartbeat sends `available` every 8s if `alwaysOnline`
- `applyAutoPresence()` — composing/recording on inbound
- `shouldReadReceipts()` — checked by router

### `modules/activity.js`

- Tracks per-chat: total, texts, media, lastActive, contacts
- Dashboard aggregator

### `modules/ping.js`

- Sends placeholder, measures RTT, edits placeholder with result

### `modules/help.js`

- Static registry of all commands
- Renders grouped or full list

### `modules/debug.js`

- `trace(tag, data)` — colored structured logging
- `traceLine(tag, msg)` — colored single-line

---

## State Persistence

| File | Written by | Read by |
|---|---|---|
| `ghost-ledger.json` | ghost | ghost |
| `lurk.json` | lurk | lurk |
| `peek.json` | peek | peek |
| `presence.json` | presence | presence, router |
| `schedule.json` | schedule | schedule (loop) |
| `activity.json` | activity | activity |
| `admin.json` | admin | admin |
| `channel-cache.json` | jid-resolver | jid-resolver |

---

## Error Handling Philosophy

Every module follows the same pattern:

```javascript
try {
    // do work
} catch (e) {
    console.error('[module] context', e.message);
    // continue, don't crash
}
```

**Never let one bad message kill the bot.** The router wraps every dispatch call. Modules wrap every file write. Background loops wrap every iteration.

---

## Adding a New Command

1. Create `modules/yourcommand.js`:

```javascript
import { isOwner } from '../core/identity.js';

export async function yourCommand(sock, chat, msg, args) {
    const from = msg.key.participant || msg.key.remoteJid;
    if (!msg.key.fromMe && !isOwner(from)) {
        return sock.sendMessage(chat, { text: '⛔ Owner only.' }, { quoted: msg });
    }
    // your logic
}
```

2. Import in `router.js`:

```javascript
import { yourCommand } from './modules/yourcommand.js';
```

3. Add to switch:

```javascript
case 'yourcmd': await yourCommand(sock, chat, msg, rest); break;
```

4. Add to `modules/help.js` registry.

That's it. Hot-reload is not supported — restart the bot.
