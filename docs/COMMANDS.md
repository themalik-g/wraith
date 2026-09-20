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

**How it works:** Inbound messages are recorded with text and media in encrypted session memory. When a message is deleted or edited, the original content is revealed.

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
| `.dl <url>` | Download video, audio, or post carousel (`@postfetch/core` + `yt-dlp`) |
| `.pdl <post-url>` | Download post/carousel media items directly via `@postfetch/core` |
| `.pdlzip <post-url>` | Download post/carousel items as a single ZIP archive |
| `.mp3 <url>` | Extract MP3 audio from any video or audio URL |
| `.song <query>` | Download audio from SoundCloud, Apple Music, or Deezer |
| `.gitdl <github-url>` | Download GitHub repository as a ZIP archive |
| `.mfdl <mediafire-url>` | Resolve and download MediaFire files directly |
| `.ig <username\|url>` | Fetch Instagram user profile or download post/carousel |
| `.tiktok <username\|url>` | Fetch TikTok profile info or download photo post/video |
| `.fb <username\|url>` | Fetch Facebook profile info or download video/post |

**Post Carousel Routing:**
URLs containing picture posts or carousels (e.g. Instagram `/p/`, TikTok `/photo/`, Pinterest, Facebook posts) are routed directly to `@postfetch/core`. If `yt-dlp` fails for any URL, `@postfetch/core` is tried as a fallback where appropriate.

---

## 📚 Media & Entertainment

| Command | Description |
|---|---|
| `.book <query>` | Search and download verified free books (Project Gutenberg / Archive.org) |
| `.img <query>` | Search stock images (Wikimedia Commons / Openverse / LoremFlickr) |
| `.gemini <prompt>` | Ask Gemini AI for simple text answers & explanations (or reply to text) |
| `.photo <prompt>` | Generate AI photo from image prompt (Imagen 3 / Pollinations) |
| `.movie <title>` | Search movie/show details (iTunes / TVmaze) |
| `.songinfo <query>` | Lookup song details & artwork (Deezer / MusicBrainz) |
| `.lyrics <artist> <title>` | Fetch plain lyrics (LRCLIB / lyrics.ovh) |
| `.ppt <topic>;<subtopics>;<theme>;<slides>` | AI-powered PowerPoint presentation generator (Gemini) |
| `.couplepp` | Get matching couple profile pictures |
| `.textmaker <effect> <text>` | Generate 54 Ephoto360 text effects (`.dragon`, `.space`, `.cyberpunk`, etc.) |

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
| `.setsession [number]` | Add new session instance by replying to a `creds.json` document (main session only) |
| `.addsession <number>` | Initialize and pair new session instance by phone number (main session only) |
| `.delsession <session_id>` | Terminate and delete session instance (main session only) |
| `.setvar <key> <value>` | Set persistent per-session environment variable (e.g. `.setvar GEMINI_API_KEY ...`) |
| `.getvar <key\|all>` | View session variable(s) |
| `.delvar <key>` | Delete session variable |
| `.setpp` (reply image) | Change bot profile picture |
| `.setabout <text>` | Change bot WhatsApp about bio |
| `.chatstats` | Show chat statistics |
| `.stalk <number>` | Track user online presence updates |
| `.addowner <number>` | Add secondary owner (primary owner only) |
| `.delowner <number>` | Remove secondary owner (primary owner only) |
| `.owner list` / `.ownerlist` | List all configured bot owners |
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

## 🛠️ Utility Tools & Manual

| Command | Description |
|---|---|
| `.usermanual` | Generate and receive PDF user manual document (`WRAITH_User_Manual.pdf`) |
| `.weather <city>` | Fetch weather forecast and storm alerts |
| `.currency <amount> <from> <to>` | Real-time currency conversion |
| `.define <word>` | Dictionary definition lookup |
| `.pwned <password>` | Check if password has been leaked in breaches |
| `.qr <text>` | Generate QR code image |
| `.readqr` (reply image) | Read and decode QR code from image |
| `.url` (reply media) | Upload media to temp URL host |
| `.shorten <url>` | Shorten long URL using TinyURL / is.gd (`.tinyurl` / `.shorturl`) |
| `.news [topic]` | Top news headlines by topic or global top news |
| `.hackernews` | Top technology stories & discussions from Hacker News (`.hn`) |
| `.wiki <query>` | Search Wikipedia summaries and articles (`.wikipedia`) |
| `.joke` | Fetch a random clean joke |
| `.advice` | Fetch a random piece of life advice |
| `.fact` | Fetch a random trivia fact |
| `.reqlocation` | Request user location with interactive share location button |
| `.owner` | Show owner info |
| `.script` / `.repo` | View bot repository info |

---

## 📊 Activity & Ping

| Command | Description |
|---|---|
| `.activity` | Show chat activity dashboard (messages, media, top senders) |
| `.ping` | Measure RTT latency, memory usage, and uptime |
| `.alive` | Check if WRAITH is alive (`𝗪𝗥𝗔𝗜𝗧𝗛 𝗜𝗦 𝗔𝗟𝗜𝗩𝗘 ✅`) |
| `.uptime` | Check current bot uptime |
| `.restart` | Restart WRAITH server process (owner only) |
| `.help` / `.menu` | Render command help menu |
