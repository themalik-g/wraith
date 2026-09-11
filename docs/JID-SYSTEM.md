# Understanding WhatsApp's JID System

## The Two Identifiers

Every WhatsApp user has **two JIDs**:

| Type | Format | Role |
|---|---|---|
| **PN JID** | `923001234567@s.whatsapp.net` | Phone-number JID. Known, stable. |
| **LID** | `278713363128439@lid` | Linked Identity JID. Anonymous, permanent. |

**Mental model:**
- PN = home address (you know where it is)
- LID = PO box (private, permanent, used in groups)

---

## Why WhatsApp Introduced LIDs

In large groups, showing every member's phone number is a privacy risk. WhatsApp now uses LIDs — permanent anonymous IDs — so members can participate without exposing their numbers.

**Key properties:**
- **LID is permanent** — same user, same LID across all chats and groups
- **LID is unique** — no two users share a LID
- **LID is routable** — you can send messages directly to a LID
- **LID is not reversible** — WhatsApp does not expose LID → PN lookup

---

## The One-Way Rule

WhatsApp's API gives you:

| Direction | Available? |
|---|---|
| PN → LID | ✅ Yes (`getLIDForPN`) |
| LID → PN | ❌ No reverse lookup |

**Why?** Privacy. If you could reverse any LID, the anonymity would be meaningless.

---

## How WRAITH Resolves LIDs Anyway

Even though the API doesn't offer a reverse lookup, PN JIDs leak through **five different channels**:

### 1. Message keys (free)

Every inbound message may carry both JIDs:

```javascript
msg.key.participant       // LID (in groups)
msg.key.participantAlt    // matching PN
msg.key.remoteJid         // chat JID
msg.key.remoteJidAlt      // matching alt
```

If WhatsApp chose to include the twin, you get the PN for free.

### 2. Local cache

Baileys stores every PN↔LID pair it sees:

```javascript
sock.signalRepository.lidMapping.getPNForLID(lid)
```

Works only if the bot has previously seen the pair.

### 3. Group metadata

Every group participant has paired fields:

```javascript
{
  id: "278713363128439@lid",
  lid: "278713363128439@lid",
  phoneNumber: "923257853673@s.whatsapp.net"
}
```

Query via `sock.groupMetadata(groupJid)`.

### 4. Fork methods

Some Baileys forks expose:

- `sock.getPNForLID(lid)` — direct lookup
- `sock.getLIDForPN(pn)` — reverse
- `sock.findUserId(anyJid)` — returns `{ lid, phoneNumber }`

### 5. The nuclear option

Calling `groupParticipantsUpdate()` with a LID triggers a server response that **contains the PN** in the raw XML attributes:

```json
{
  "status": "200",
  "jid": "...@lid",
  "content": {
    "attrs": {
      "phone_number": "...@s.whatsapp.net"
    }
  }
}
```

This reveals PNs even for fresh LIDs that have no cache and no `participantAlt`.

---

## When You Can't Get the PN

**The hard wall:** A LID that satisfies all of:

- No prior inbound message from that user
- No `participantAlt` on the current message
- Not in any group the bot is in
- Cache is empty for this LID

→ **PN cannot be fetched.** This isn't a bug. It's WhatsApp's privacy model working as designed.

**Workaround:** If the user is in a group the bot moderates, use any admin action (kick/promote/demote) — the server response reveals the PN.

---

## What WRAITH Does with LIDs

| Operation | Uses |
|---|---|
| Sending a message | Sends **directly to the LID** (no conversion needed) |
| Group admin actions | Converts to PN via 5-strategy resolver |
| `.getjid` output | Returns both, or explains why one is unavailable |
| Mentions | Uses LID when present (works for display) |

---

## Sending to a LID — Session Warning

You **can** send to a LID directly, but only if the bot has an established Signal session with that LID. Otherwise the recipient sees:

> ⏳ "Waiting for this message. This may take a while."

**Fix:** Always reply to a LID message first. This establishes the session, and future direct sends work.

---

## Groups and Newsletters

- **Group JIDs** (`...@g.us`) — no LID equivalent. The group itself is the address.
- **Newsletter JIDs** (`...@newsletter`) — no LID equivalent. Channels are public.
- **Status broadcasts** (`status@broadcast`) — special virtual JID.

---

## Debugging JID Resolution

Set `WRAITH_DEBUG=1` to trace:

```
[jid-resolver] getPNForLID failed: ...
[jid-resolver] newsletterMetadata failed: ...
[admin] kick → 923257853673@s.whatsapp.net
```

Every resolution path logs its source:

- `participant` — from message key
- `lidMapping.getPNForLID` — from cache
- `groupMetadata.participant.phoneNumber` — from group roster
- `sock.getPNForLID` — from fork method
- `onWhatsApp` — from server lookup
- `constructed` — fallback (unverified)
