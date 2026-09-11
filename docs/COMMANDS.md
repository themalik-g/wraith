# Commands Reference

All commands are **owner-only**. Prefix is a dot: `.`

---

## 👻 Ghost — anti-delete & anti-edit

| Command | Description |
|---|---|
| `.ghost` | Show current status |
| `.ghost on` | Arm anti-delete |
| `.ghost off` | Disarm anti-delete |
| `.ghost edit on` | Arm anti-edit |
| `.ghost edit off` | Disarm anti-edit |

**How it works:** Every inbound message is stored in `state/ghost-ledger.json` with text and media (saved to `vault/`). When a message is deleted or edited, the bot sends you the original.

---

## 👁️ Peek — view-once

| Command | Description |
|---|---|
| `.peek` (reply to view-once) | Reveal it |
| `.peek auto on` | Auto-forward every incoming view-once |
| `.peek auto off` | Disable auto-peek |
| `.peek watch on` | Watch quoted replies to view-once |
| `.peek watch off` | Stop watching |
| `.peek dest owner` | Reveals go to owner DM (default) |
| `.peek dest same` | Reveals go to originating chat |
| `.peek dest both` | Reveals go to both |

**How it works:** WhatsApp embeds the real content in `contextInfo.quotedMessage` when someone replies to a view-once. The quoted-watcher extracts it silently.

---

## 🌒 Lurk — status watcher

| Command | Description |
|---|---|
| `.lurk` | Show status |
| `.lurk on` | Auto-view every status |
| `.lurk off` | Stop auto-viewing |
| `.lurk react on` | React to statuses |
| `.lurk react off` | Stop reacting |
| `.lurk download on` | Download statuses to owner DM silently |
| `.lurk download off` | Stop downloading |
| `.lurk emoji ❤️` | Set custom reaction emoji |
| `.lurk emoji random` | Pick a random emoji per status |
| `.lurk emoji none` | Empty reaction (silent) |

**Silent download:** When `download=on` and `auto=off` and `react=off`, statuses are captured **without** sending a read receipt or reaction.

---

## 📅 Schedule — send later

**Usage:**
```
.schedule <message> <target> dd,mm,yy hour minute am/pm
.schedule <target> dd,mm,yy hour minute am/pm    (reply to a message)
```

**Target formats:**
- Phone number — `923001234567`
- @username — `@ali`
- JID — `923001234567@s.whatsapp.net`
- LID — `278713363128439@lid`
- Newsletter — `...@newsletter`

**Examples:**
```
.schedule Hey! 923001234567 25,12,26 10 30 am
.schedule 25,12,26 10 30 am        (reply to a message)
```

**Date formats supported:** `dd,mm,yy`, `dd/mm/yy`, `dd-mm-yy`, or `dd mm yy` (3 tokens).

---

## 👥 Admin — group management

### Member actions

| Command | Description |
|---|---|
| `.kick` (reply) | Remove the replied user |
| `.kick 923001234567` | Remove by number |
| `.add 923001234567` | Add by number |
| `.promote` (reply) | Make admin |
| `.demote` (reply) | Remove admin |

**Note:** WhatsApp's group API requires PN JIDs. WRAITH converts LID → PN via cache, group metadata, or fallback.

### Protection toggles

| Command | Description |
|---|---|
| `.antilink on\|off` | Block links |
| `.antispam on\|off` | Block spam |
| `.antisticker on\|off` | Block stickers |

**Behavior:** Violating messages are deleted and the sender is mentioned.

---

## 🖼️ Getpp — profile pictures

| Command | Description |
|---|---|
| `.getpp` | Get profile pic of current chat |
| `.getpp owner` | Send to owner DM |
| `.getpp chat` | Send to this chat |
| `.getpp <number>` | Get of a specific user |
| `.getpp` (reply) | Get of the replied user |

---

## 📌 Getjid — JID resolver

### Basic lookups

| Command | Description |
|---|---|
| `.getjid` | Current chat JID |
| `.getjid` (reply) | Both PN + LID of replied sender |
| `.getjid 923001234567` | Resolve a number → PN + LID |
| `.getjid @ali` | Resolve a username → PN + LID |
| `.getjid 278713363128439@lid` | Try to resolve a LID → PN |

### Group tools

| Command | Description |
|---|---|
| `.getjid members` | List all group members with PN + LID + admin status |
| `.getjid group <groupJid> <targetJid>` | Resolve a specific member |
| `.getjid currentchat` | Current chat details (works in group, DM, channel) |

### Channels

| Command | Description |
|---|---|
| `.getjid channels` | List all joined channels with names |
| `.getjid currentchat` (in a channel) | Get channel JID + name + subscribers |

**Note:** Bulk channel listing requires a fork with `newsletterSubscribed()` or `newsletterFetchAllParticipating()`. Official Baileys v7 falls back to a local cache built from inbound channel messages.

### Owner lookup

| Command | Description |
|---|---|
| `.getjid owner <target>` | Resolve any number/username/JID |

---

## ⚙️ Presence — online control

| Command | Description |
|---|---|
| `.presence` | Show status |
| `.presence online on\|off` | Always online toggle |
| `.presence typing on\|off` | Auto-typing indicator |
| `.presence recording on\|off` | Auto-recording indicator |
| `.presence reads on\|off` | Read receipts |

**Default:** Always online **on**, read receipts **on**, typing/recording **off**.

**Note:** `typing` and `recording` are mutually exclusive.

---

## 📊 Activity — dashboard

| Command | Description |
|---|---|
| `.activity` | Global dashboard: total chats, messages, top chats |

Tracks per-chat: total messages, text count, media count, last active, top senders.

---

## 🏓 Probe

| Command | Description |
|---|---|
| `.ping` | WhatsApp RTT + event-loop lag + memory + uptime |

---

## ⚙️ System

| Command | Description |
|---|---|
| `.help` | Full command index |
| `.help <group>` | One group only (e.g. `.help ghost`) |
| `.menu` | Alias for `.help` |
