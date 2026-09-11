# 👻 WRAITH

> A silent watcher for WhatsApp — remembers what was deleted, peeks at what was hidden, lurks on statuses, schedules messages, and manages groups.

Built on [Baileys v7](https://github.com/WhiskeySockets/Baileys) with LID-aware JID resolution.

---

## ✨ Features

| Module | What it does |
|---|---|
| 👻 **Ghost** | Anti-delete + anti-edit. Reports deleted/edited messages with media. |
| 👁️ **Peek** | Reveals view-once images, videos, audio. |
| 🌒 **Lurk** | Auto-view statuses, auto-react, silent download to owner DM. |
| 📅 **Schedule** | Send any message later — numbers, @usernames, JIDs, newsletters. |
| 👥 **Admin** | Kick, add, promote, demote + antilink, antispam, antisticker. |
| 🖼️ **Getpp** | Fetch profile pictures of any user, group, or chat. |
| 📌 **Getjid** | PN + LID resolver, channel list, group members, current chat. |
| ⚙️ **Presence** | Always online, auto-typing, auto-recording, read receipts. |
| 📊 **Activity** | Chat activity dashboard — messages, media, top chats. |
| 🏓 **Ping** | Latency + memory + uptime probe. |

---

## 🚀 Quick Start

### Requirements

- **Node.js 20+**
- A WhatsApp account you're willing to link as a device
- (Optional) **PM2** for 24/7 running

### Installation

```bash
git clone https://github.com/themalik-g/wraith.git
cd wraith
npm install
npm start
```

First run prompts for your WhatsApp number, then shows a **pairing code**:

> WhatsApp → Settings → Linked Devices → Link a Device → Link with phone number instead

### Run with PM2

```bash
npm run pm2:start
npm run pm2:logs
npm run pm2:restart
```

---

## 📚 Documentation

| File | Topic |
|---|---|
| [docs/COMMANDS.md](./docs/COMMANDS.md) | All commands with examples |
| [docs/CONFIGURATION.md](./docs/CONFIGURATION.md) | Config, state files |
| [docs/JID-SYSTEM.md](./docs/JID-SYSTEM.md) | PN, LID, JID resolution |
| [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md) | VPS, Docker, PM2 |
| [docs/TROUBLESHOOTING.md](./docs/TROUBLESHOOTING.md) | Common fixes |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | Module layout |

---

## 🧠 The JID System

Every WhatsApp user has **two JIDs**:

- **PN JID** — `923001234567@s.whatsapp.net` (home address)
- **LID** — `278713363128439@lid` (PO box, permanent, anonymous)

WRAITH is **LID-aware** — resolves both, sends to LIDs directly, uses 5 fallback strategies to recover PNs when hidden.

→ Full deep dive: [docs/JID-SYSTEM.md](./docs/JID-SYSTEM.md)

---

## 🛠️ Configuration

```javascript
// config.js
export const CONFIG = {
    owner: "923257853673",
    codename: "WRAITH",
    memoryTTL: 60 * 60 * 1000,
    vaultDir: "vault",
    vaultMaxMB: 200,
    reconnectDelay: 3000,
    keepAliveInterval: 30_000
};
```

---

## 📁 Project Structure

```
wraith/
├── start.js
├── router.js
├── config.js
├── ecosystem.config.cjs
├── core/
│   ├── identity.js
│   ├── vault.js
│   └── jid-resolver.js
├── modules/
│   ├── ghost.js
│   ├── peek.js
│   ├── lurk.js
│   ├── schedule.js
│   ├── admin.js
│   ├── profile.js
│   ├── jid.js
│   ├── presence.js
│   ├── activity.js
│   ├── ping.js
│   ├── help.js
│   └── debug.js
├── state/
├── session/
└── vault/
```

---

## 🔐 Security

- **Never commit** `session/`, `.env`, `state/owner.json`
- `state/ghost-ledger.json` contains message history — sensitive

---

## 🐛 Quick Troubleshooting

| Problem | Fix |
|---|---|
| Bot won't pair | Delete `session/`, restart, re-enter number |
| `internal-server-error` on admin | Bot must be admin; target PN may be uncached |
| Channels empty | Use fork with `newsletterSubscribed()` or wait for cache |
| LID not resolving to PN | Reply to their message first |

Full guide: [docs/TROUBLESHOOTING.md](./docs/TROUBLESHOOTING.md)

---

## 📜 License

MIT

---

## 🙏 Credits

- [Baileys](https://github.com/WhiskeySockets/Baileys) — WhatsApp Web API
- Built by [@themalik-g](https://github.com/themalik-g)
