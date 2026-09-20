<div align="center">

<!-- ANIMATED TYPING SVG HEADER -->
<img src="https://readme-typing-svg.herokuapp.com?font=Orbitron&size=40&duration=3000&pause=1000&color=00E5FF&center=true&vCenter=true&width=800&height=80&lines=🤖+𝙒𝙍𝘼𝙄𝙏🇭+𝙒𝘼+𝘽𝙊𝙏;⚡+𝙏𝙝𝙚+𝙐𝙡𝙩𝙞𝙢𝙖𝙩𝙚+𝙒𝙝𝙖𝙩𝙨𝘼𝙥p+𝘽o𝙏;🚀+𝙋𝙤𝙬𝙚𝙧𝙚𝙙+𝙗𝙮+𝘽𝙖𝙞𝙡𝙚𝙮𝙨;🔥+24%2F7+𝙎𝙩𝙖𝙗𝙡𝙚+%26+𝙁𝙖𝙨𝙩" alt="Typing SVG" />

<!-- VIBRANT ELECTRIC OCEAN HEADER -->
<img src="https://capsule-render.vercel.app/api?type=waving&color=0:0052D4,50:1E88E5,100:00E5FF&height=200&section=header&text=WRAITH%20BOT&fontSize=70&fontColor=ffffff&animation=twinkling&fontAlignY=35" width="100%"/>

<!-- BADGES -->
<p>
  <img src="https://img.shields.io/badge/Version-2.1.0-0D47A1?style=for-the-badge&logo=github&logoColor=white&labelColor=000000"/>
  <img src="https://img.shields.io/badge/Node.js-20%2B-DC2626?style=for-the-badge&logo=node.js&logoColor=white&labelColor=000000"/>
  <img src="https://img.shields.io/badge/official--baileys-Latest-0D47A1?style=for-the-badge&logo=whatsapp&logoColor=white&labelColor=000000"/>
  <img src="https://img.shields.io/badge/License-MIT-DC2626?style=for-the-badge&logo=opensourceinitiative&logoColor=white&labelColor=000000"/>
  <img src="https://img.shields.io/badge/Platform-WhatsApp-25D366?style=for-the-badge&logo=whatsapp&logoColor=white&labelColor=000000"/>
</p>
</div>

> A silent, high-performance watcher for WhatsApp — remembers deleted/edited messages, peeks at view-once media, lurks on status updates, schedules posts, downloads videos, music, and image carousels, and manages groups effortlessly.

Built on [Baileys v7](https://github.com/WhiskeySockets/Baileys) with full LID-aware JID resolution and integrated `@postfetch/core` + `yt-dlp` media extractors.

---

## ✨ Features

| Module | What it does |
|---|---|
| 👻 **Ghost** | Anti-delete, anti-edit, & secret edit tracking. Logs deleted/edited messages with media back to owner. |
| 👁️ **Peek** | Reveals view-once images, videos, audio, with auto-peek and quoted message detection. |
| 🌒 **Lurk** | Auto-view statuses, auto-react with custom/random emojis, silent download to owner DM. |
| 📅 **Schedule** | Send any message or schedule group opening/closing for a future time. |
| ⬇️ **Media Downloader** | Integrated `@postfetch/core` + `yt-dlp` engine (`.dl`, `.mp3`, `.pdl`, `.pdlzip`) for videos, audio, and image carousels (Instagram `/p/`, TikTok `/photo/`, Pinterest, Twitter, Facebook). |
| 📦 **File & Social Downloader** | GitHub repo downloader (`.gitdl`), MediaFire downloader (`.mfdl`), social profile search & media downloading (`.ig`, `.tiktok`, `.fb`), song downloader (`.song`). |
| 📚 **Media & Entertainment** | Verified book search & download (Gutenberg/Archive.org), stock image search (`.img`), Gemini AI text assistant (`.gemini`), AI photo generator (`.photo`), 54 Ephoto360 textmaker effects (`.textmaker`), song info, lyrics, movie search, PowerPoint presentation generator (`.ppt`), couple profile pictures (`.couplepp`). |
| 👥 **Admin & Group** | Group management (`.open`, `.close`, `.kick`, `.add`, `.promote`, `.demote`, `.approveall`, `.declineall`, `.kickall`, `.kickcc`, `.tagall`, `.hidetag`, `.setgpp`, `.setgdesc`, `.mute`, `.unmute`, `.welcome`, `.goodbye`), plus protection (`.antilink`, `.antispam`, `.antisticker`, `.rejectcalls`). |
| 👤 **Owner & Profile** | Multi-owner management (`.addowner`, `.delowner`, `.owner list`), block/unblock management, `.setstatus`, `.getstatus`, `.getpair` pairing code generator, `.setsession` session importer, `.setpp`, `.setabout`, `.chatstats`, `.stalk` online tracking, `.mode` public/private, `.prefix` control. |
| 📄 **User Manual** | Pure PDF manual generator (`.usermanual`) delivering complete feature documentation as a WhatsApp PDF document. |
| 🛠️ **Utility Tools** | Weather forecast (`.weather`), Currency converter (`.currency`), Dictionary (`.define`), Password pwned check (`.pwned`), QR generator/decoder (`.qr`), URL uploader (`.url`), URL shortener (`.shorten`), News headlines (`.news`), Hacker News (`.hackernews`), Wikipedia (`.wiki`), Jokes (`.joke`), Advice (`.advice`), Facts (`.fact`). |
| 🖼️ **Getpp** | Fetch profile pictures of any user, group, or chat. |
| 📌 **Getjid** | PN + LID resolver, channel list, group member roster with admin roles. |
| ⚙️ **Presence** | Always online, auto-typing, auto-recording, read receipts configuration. |
| 📊 **Activity & Ping** | Chat activity dashboard (messages, media counts) and RTT/memory latency probe. |

---

## 🚀 Quick Start

### Requirements

- **Node.js 20+**
- A WhatsApp account you're willing to link as a device
- (Optional) **PM2** for 24/7 background operation

### Installation

```bash
git clone https://github.com/themalik-g/wraith.git
cd wraith
npm install
npm start
```

First run prompts for your WhatsApp phone number, then generates a **pairing code**:

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
| [docs/COMMANDS.md](./docs/COMMANDS.md) | Complete index of all commands with examples |
| [docs/CONFIGURATION.md](./docs/CONFIGURATION.md) | Config settings, state files, and variables |
| [docs/JID-SYSTEM.md](./docs/JID-SYSTEM.md) | Deep dive into PN, LID, and JID resolution |
| [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md) | VPS, Docker, PM2, and server setups |
| [docs/TROUBLESHOOTING.md](./docs/TROUBLESHOOTING.md) | Solutions for common errors |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | System layout, module design, and router flow |

---

## 🧠 The JID System

Every WhatsApp user has **two JIDs**:

- **PN JID** — `923001234567@s.whatsapp.net` (phone number)
- **LID** — `278713363128439@lid` (Linked Identity, permanent anonymous ID)

WRAITH is **LID-aware** — resolves both, sends messages to LIDs directly, and utilizes 5 fallback strategies to resolve PNs when hidden.

→ Full details: [docs/JID-SYSTEM.md](./docs/JID-SYSTEM.md)

---

## 🛠️ Configuration

```javascript
// config.js
export const CONFIG = {
    owner: "923257853673",
    codename: "WRAITH",
    memoryTTL: 60 * 60 * 1000,
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
│   ├── settings.js
│   └── jid-resolver.js
├── lib/
│   ├── apis.js
│   ├── music-sources.js
│   ├── net.js
│   └── uploadImage.js
├── modules/
│   ├── activity.js
│   ├── admin.js
│   ├── debug.js
│   ├── download.js
│   ├── downloader.js
│   ├── ghost.js
│   ├── group.js
│   ├── help.js
│   ├── jid.js
│   ├── lurk.js
│   ├── media.js
│   ├── owner.js
│   ├── peek.js
│   ├── ping.js
│   ├── ppt.js
│   ├── prefix.js
│   ├── presence-track.js
│   ├── presence.js
│   ├── profile.js
│   ├── schedule.js
│   ├── social.js
│   ├── song.js
│   ├── update.js
│   ├── url.js
│   ├── usermanual.js
│   └── utility.js
└── session/
```

---

## 🔐 Security & Privacy

- **Never commit** `session/`, `.env`, `keys.env`, or local credentials/state.

---

## 🐛 Quick Troubleshooting

| Problem | Fix |
|---|---|
| Bot won't pair | Delete `session/`, restart, re-enter number |
| `internal-server-error` on admin | Bot must be admin; target PN may be uncached |
| Image post download failed | Use `.pdl <url>` or `.pdlzip <url>` for direct postfetch download |
| LID not resolving to PN | Reply to their message in a group first |

Full guide: [docs/TROUBLESHOOTING.md](./docs/TROUBLESHOOTING.md)

---

## 📜 License

MIT

---

## 🙏 Credits

- [Baileys](https://github.com/WhiskeySockets/Baileys) — WhatsApp Web API
- Built by [@themalik-g](https://github.com/themalik-g)

---
<div align="center">
<!-- VIBRANT ELECTRIC OCEAN FOOTER -->
<img src="https://capsule-render.vercel.app/api?type=waving&color=0:00E5FF,50:1E88E5,100:0052D4&height=150&section=footer&text=Thanks%20For%20Visiting!&fontSize=40&fontColor=ffffff&animation=twinkling&fontAlignY=65" width="100%"/>

<img src="https://readme-typing-svg.herokuapp.com?font=Fira+Code&size=16&duration=3000&pause=1000&color=00E5FF&center=true&vCenter=true&width=600&lines=⭐+Star+this+repo+if+you+like+it!;🍴+Fork+to+contribute!;💬+Issues+and+PRs+are+welcome!" alt="Footer"/>

<br>

**Made with ❤️ by MALIK MEHTAB**

</div>
