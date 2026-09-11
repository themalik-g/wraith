<div align="center">

<!-- ANIMATED TYPING SVG HEADER -->
<img src="https://readme-typing-svg.herokuapp.com?font=Orbitron&size=40&duration=3000&pause=1000&color=00E5FF&center=true&vCenter=true&width=800&height=80&lines=🤖+𝙒𝙍𝘼𝙄𝙏𝙃+𝙒𝘼+𝘽𝙊𝙏;⚡+𝙏𝙝𝙚+𝙐𝙡𝙩𝙞𝙢𝙖𝙩𝙚+𝙒𝙝𝙖𝙩𝙨𝘼𝙥𝙥+𝘽𝙤𝙏;🚀+𝙋𝙤𝙬𝙚𝙧𝙚𝙙+𝙗𝙮+𝘽𝙖𝙞𝙡𝙚𝙮𝙨;🔥+24%2F7+𝙎𝙩𝙖𝙗𝙡𝙚+%26+𝙁𝙖𝙨𝙩" alt="Typing SVG" />

<!-- VIBRANT ELECTRIC OCEAN HEADER -->
<img src="https://capsule-render.vercel.app/api?type=waving&color=0:0052D4,50:1E88E5,100:00E5FF&height=200&section=header&text=WRAITH%20BOT&fontSize=70&fontColor=ffffff&animation=twinkling&fontAlignY=35" width="100%"/>

<!-- BADGES -->
<p>
  <img src="https://img.shields.io/badge/Version-2.0.0-0D47A1?style=for-the-badge&logo=github&logoColor=white&labelColor=000000"/>
  <img src="https://img.shields.io/badge/Node.js-18%2B-DC2626?style=for-the-badge&logo=node.js&logoColor=white&labelColor=000000"/>
  <img src="https://img.shields.io/badge/WhiskeySockets-baileys-Latest-0D47A1?style=for-the-badge&logo=whatsapp&logoColor=white&labelColor=000000"/>
  <img src="https://img.shields.io/badge/License-MIT-DC2626?style=for-the-badge&logo=opensourceinitiative&logoColor=white&labelColor=000000"/>
  <img src="https://img.shields.io/badge/Platform-WhatsApp-25D366?style=for-the-badge&logo=whatsapp&logoColor=white&labelColor=000000"/>
</p>
<div>
---

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

---
<!-- VIBRANT ELECTRIC OCEAN FOOTER -->
<img src="https://capsule-render.vercel.app/api?type=waving&color=0:00E5FF,50:1E88E5,100:0052D4&height=150&section=footer&text=Thanks%20For%20Visiting!&fontSize=40&fontColor=ffffff&animation=twinkling&fontAlignY=65" width="100%"/>

<img src="https://readme-typing-svg.herokuapp.com?font=Fira+Code&size=16&duration=3000&pause=1000&color=00E5FF&center=true&vCenter=true&width=600&lines=⭐+Star+this+repo+if+you+like+it!;🍴+Fork+to+contribute!;💬+Issues+and+PRs+are+welcome!" alt="Footer"/>

<br>

**Made with ❤️ by MALIK MEHTAB**

</div>

