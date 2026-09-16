# Architecture

## High-Level Flow

```
WhatsApp Server
       │
       │ WebSocket
       ▼
  makeWASocket (Baileys)
       │
       │ events (upsert, update, reaction, presence)
       ▼
   start.js ─────────────► scheduler loop
       │                  presence heartbeat
       │                  reject calls handler
       │
       │ dispatch(sock, update)
       ▼
   router.js
       │
       ├─ ghost  ──► state/ghost-ledger.json
       ├─ peek   ──► owner DM
       ├─ lurk   ──► status handling
       ├─ schedule ──► state/schedule.json
       ├─ admin / group ──► groupParticipantsUpdate
       ├─ download / social ──► @postfetch/core + yt-dlp media engine
       ├─ jid    ──► core/jid-resolver.js
       ├─ presence ──► state/presence.json
       ├─ activity ──► state/activity.json
       └─ help / ping / utility / media
```

---

## Core Modules & Responsibilities

### Core System (`core/`)

- `jid-resolver.js` — Centralized PN↔LID resolution, group member lookups, channel caching.
- `identity.js` — Owner validation (`isOwner`), owner JID resolution.
- `settings.js` — Prefix, mode, and global setting persistence.
- `vault.js` — Temporary media storage in `vault/` with automatic size purge.

### Libraries (`lib/`)

- `apis.js` — External API integration (books, stock images, movies, song info, lyrics, weather, currency, dictionary, QR, pwned).
- `net.js` — Robust HTTP client, chunking, downloading to file, temp file lifecycle.
- `music-sources.js` — SoundCloud, Apple Music, and Deezer music fetchers.
- `uploadImage.js` — Image host uploader.

### Modules (`modules/`)

- `download.js` — Native media downloader engine using `@postfetch/core` for image carousels & social post resolution, and `@choewy/yt-dlp` for video/audio streams. Also exposes `.pdl` and `.pdlzip`.
- `social.js` — Instagram, TikTok, and Facebook user search and direct post downloader routing.
- `downloader.js` — `.gitdl` (GitHub repository downloader) and `.mfdl` (MediaFire downloader).
- `ghost.js` — Message ledger tracking anti-delete, anti-edit, and secret edit events.
- `peek.js` — View-once extraction, auto-peek forwarding, quoted message watcher.
- `lurk.js` — WhatsApp status watcher with auto-view, reactions, and silent owner DM download.
- `schedule.js` — Schedule post delivery and automated group opening/closing.
- `group.js` — Advanced group management: welcome/goodbye messages, approve/decline requests, kickall, kickcc, open/close, tagall, hidetag.
- `admin.js` — Admin actions (kick, add, promote, demote) and protection enforcement (antilink, antispam, antisticker).
- `owner.js` — Blocklist management, bot profile picture/about settings, status updates, pairing session retrieval.
- `media.js` — Book search & verified download, stock images, movies, lyrics, song info, couple profile picture generator.
- `ppt.js` — PowerPoint presentation file (.pptx) generator.
- `utility.js` — Weather, currency conversion, dictionary definitions, QR code tools, password breach check.
- `jid.js` — JID resolution tool subcommands (`.getjid`).
- `presence.js` — Presence controls (always online, auto-typing, auto-recording, read receipts).
- `presence-track.js` — Stalk online/offline status updates for targets.
- `activity.js` — Per-chat activity tracking and statistics dashboard.
- `ping.js` — Latency RTT, memory, and uptime probe.
- `help.js` — Dynamic help registry.
- `debug.js` — Structured trace logging.

---

## Download Engine Architecture (`download.js`)

```
Inbound URL or Query
         │
         ├──► Is Post/Carousel URL? (Instagram /p/, TikTok /photo/, Pinterest, Twitter, FB)
         │           │
         │           ├── YES ──► @postfetch/core download
         │           │                │ (if fails) ──► yt-dlp fallback
         │           │
         │           └── NO  ──► yt-dlp download
         │                            │ (if fails) ──► fallback formats
         │
         ▼
Recursive Directory Scan / Stream Buffers
         │
         ▼
File Classification (Magic bytes via file-type)
         │
         ▼
Sequential Send (up to 20 files, video/audio/image limit checks) or ZIP archive (.pdlzip)
         │
         ▼
Cleanup & Sweep
```

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
| `admin.json` | admin | admin, router |
| `channel-cache.json` | jid-resolver | jid-resolver |
| `prefix.json` | settings | router, prefix |
| `mode.json` | settings | router, mode |

---

## Error Handling Philosophy

Every module isolates execution in `try-catch` blocks:

```javascript
try {
    // work
} catch (e) {
    console.error('[module]', e.message);
    // recover gracefully
}
```

No single failed request or unexpected media format is allowed to crash the WhatsApp process.
