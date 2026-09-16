# Commands Reference

All commands use the configurable prefix (default: `.`). In **private mode**, commands are owner-only. In **public mode**, non-critical commands are available to everyone.

---

## 👻 Ghost — anti-delete & anti-edit

| Command | Description |
|---|---|
| `.ghost` | Show current ghost status |
| `.ghost on` | Arm anti-delete |
| `.ghost off` | Disarm anti-delete |
| `.ghost edit on` | Arm anti-edit tracking |
| `.ghost edit off` | Disarm anti-edit tracking |

**How it works:** Inbound messages are stored in `state/ghost-ledger.json` with text and media (saved to `vault/`). When a message is deleted or edited, the original content is revealed.

---

## 👁️ Peek — view-once

| Command | Description |
|---|---|
| `.peek` (reply to view-once) | Reveal view-once media |
| `.peek auto on` | Auto-forward incoming view-once media |
| `.peek auto off` | Disable auto-peek |
| `.peek watch on` | Watch quoted replies to view-once messages |
| `.peek watch off` | Stop quoted watching |
| `.peek dest owner` | Direct reveals to owner DM (default) |
| `.peek dest same` | Direct reveals to originating chat |
| `.peek dest both` | Direct reveals to both owner DM and originating chat |

---

## 🌒 Lurk — status watcher

| Command | Description |
|---|---|
| `.lurk` | Show lurk status |
| `.lurk on` | Auto-view every status update |
| `.lurk off` | Disable auto-view |
| `.lurk react on` | React to status updates |
| `.lurk react off` | Disable status reactions |
| `.lurk download on` | Silently download status media to owner DM |
| `.lurk download off` | Stop status downloads |
| `.lurk emoji <emoji>` | Set custom reaction emoji |
| `.lurk emoji random` | Pick a random emoji per status |
| `.lurk emoji none` | Empty reaction (silent view) |

---

## 📅 Schedule — send later

**Usage:**
```
.schedule <message> <target> dd,mm,yy hour minute am/pm
.schedule <target> dd,mm,yy hour minute am/pm    (reply to a message)
.schedule open dd,mm,yy hour minute am/pm        (schedule group opening)
.schedule close dd,mm,yy hour minute am/pm       (schedule group closing)
```

**Target formats:**
- Phone number — `923001234567`
- @username — `@ali`
- JID — `923001234567@s.whatsapp.net`
- LID — `278713363128439@lid`
- Newsletter — `...@newsletter`

---

## ⬇️ Media & File Downloaders

| Command | Description |
|---|---|
| `.dl <url>` | Download video, audio, or image carousel (`yt-dlp` + `gallery-dl`) |
| `.mp3 <url>` | Extract MP3 audio from any video or audio URL |
| `.song <query>` | Download audio from SoundCloud, Apple Music, or Deezer |
| `.gitdl <github-url>` | Download GitHub repository as a ZIP archive |
| `.mfdl <mediafire-url>` | Resolve and download MediaFire files directly |
| `.ig <username\|url>` | Fetch Instagram user profile or download post/carousel |
| `.tiktok <username\|url>` | Fetch TikTok profile info or download photo post/video |
| `.fb <username\|url>` | Fetch Facebook profile info or download video post |

**Image Carousel Routing:**
URLs containing picture posts (e.g. Instagram `/p/`, TikTok `/photo/`, Pinterest) are routed directly to `gallery-dl`. If `yt-dlp` fails for any URL, `gallery-dl` is tried as a fallback.

---

## 📚 Media & Entertainment

| Command | Description |
|---|---|
| `.book <query>` | Search and download verified free books (Project Gutenberg / Archive.org) |
| `.img <query>` | Search stock images (Wikimedia Commons / Openverse / LoremFlickr) |
| `.movie <title>` | Search movie/show details (iTunes / TVmaze) |
| `.songinfo <query>` | Lookup song details & artwork (Deezer / MusicBrainz) |
| `.lyrics <artist> <title>` | Fetch plain lyrics (LRCLIB / lyrics.ovh) |
| `.ppt <topic>` | Generate a PowerPoint presentation file (.pptx) |
| `.couplepp` | Get matching couple profile pictures |

---

## 👥 Admin & Group Management

| Command | Description |
|---|---|
| `.open` | Open group so all members can send messages |
| `.close` | Close group so only admins can send messages |
| `.tagall [message]` | Mention all group members explicitly |
| `.hidetag [message]` | Mention all group members silently |
| `.setgpp` (reply image) | Change group profile picture |
| `.setgdesc <text>` | Change group description |
| `.kick` (reply / num) | Remove member from group |
| `.add <number>` | Add member by phone number |
| `.promote` (reply / num) | Promote member to admin |
| `.demote` (reply / num) | Demote admin to member |
| `.approveall` | Approve all pending group join requests |
| `.declineall` | Decline all pending group join requests |
| `.kickall` | Remove all non-admin members |
| `.kickcc <country_code>` | Remove all members from specific country code |
| `.mute` / `.unmute` | Mute/unmute group notifications |
| `.archive` / `.unarchive` | Archive/unarchive chat |
| `.clearchat` | Clear chat history |
| `.welcome on\|off` | Toggle welcome message on user join |
| `.goodbye on\|off` | Toggle goodbye message on user leave |
| `.antilink on\|off` | Block and delete link messages |
| `.antispam on\|off` | Block and delete message spam |
| `.antisticker on\|off` | Block and delete sticker spam |
| `.rejectcalls on\|off` | Auto-reject incoming calls |

---

## 👤 Owner & Settings

| Command | Description |
|---|---|
| `.block` (reply / num) | Block user |
| `.unblock` (reply / num) | Unblock user |
| `.blocklist` | Show blocked users list |
| `.unblockall` | Unblock all users |
| `.setstatus <text>` | Post status update to `status@broadcast` |
| `.getstatus <num>` | Fetch user's status bio |
| `.getpair <number>` | Generate pairing code session |
| `.setpp` (reply image) | Change bot profile picture |
| `.setabout <text>` | Change bot WhatsApp about bio |
| `.chatstats` | Show chat statistics |
| `.stalk <number>` | Track user online presence updates |
| `.mode public\|private` | Set bot access mode |
| `.prefix <char>` | Set command prefix (e.g. `.`, `!`, `#`) |
| `.update` | Trigger git pull & restart |

---

## 🖼️ Getpp — Profile Pictures

| Command | Description |
|---|---|
| `.getpp` | Get profile picture of current chat |
| `.getpp owner` | Send profile picture to owner DM |
| `.getpp chat` | Send profile picture to current chat |
| `.getpp <number>` | Get profile picture of user by phone number |
| `.getpp` (reply) | Get profile picture of replied user |

---

## 📌 Getjid — JID Resolver

| Command | Description |
|---|---|
| `.getjid` | Current chat JID |
| `.getjid` (reply) | Resolve PN + LID of replied message sender |
| `.getjid <number>` | Resolve phone number → PN + LID |
| `.getjid @username` | Resolve username → PN + LID |
| `.getjid <LID>` | Resolve LID → PN |
| `.getjid members` | List all group members with PN, LID, and admin status |
| `.getjid currentchat` | Detailed info for current chat (group, DM, channel) |
| `.getjid channels` | List joined WhatsApp channels |

---

## ⚙️ Presence Controls

| Command | Description |
|---|---|
| `.presence` | Show presence settings |
| `.presence online on\|off` | Toggle always online heartbeat |
| `.presence typing on\|off` | Toggle auto-typing indicator on inbound |
| `.presence recording on\|off` | Toggle auto-recording indicator on inbound |
| `.presence reads on\|off` | Toggle read receipts |

---

## 🛠️ Utility Tools

| Command | Description |
|---|---|
| `.weather <city>` | Fetch weather forecast and storm alerts |
| `.currency <amount> <from> <to>` | Real-time currency conversion |
| `.define <word>` | Dictionary definition lookup |
| `.pwned <password>` | Check if password has been leaked in breaches |
| `.qr <text>` | Generate QR code image |
| `.readqr` (reply image) | Read and decode QR code from image |
| `.url` (reply media) | Upload media to temp URL host |
| `.owner` | Show owner info |
| `.script` / `.repo` | View bot repository info |

---

## 📊 Activity & Ping

| Command | Description |
|---|---|
| `.activity` | Show chat activity dashboard (messages, media, top senders) |
| `.ping` | Measure RTT latency, memory usage, and uptime |
| `.help` / `.menu` | Render command help menu |
