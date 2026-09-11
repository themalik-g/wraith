# Troubleshooting

## Bot won't pair

**Symptom:** Pairing code shown but phone rejects it, or no code appears.

**Fix:**
1. Stop the bot
2. Delete `session/` folder
3. Restart — enter your number fresh
4. Enter the new code within 60 seconds

If the code still fails:
- Ensure `config.js` `owner` matches your WhatsApp number
- Ensure `state/owner.json` matches too
- Try unlinking all stale devices from WhatsApp → Linked Devices

---

## `internal-server-error` on admin actions

**Symptom:** `.kick`, `.promote`, `.demote` fails with "Internal Server Error".

**Cause:** WhatsApp's group API received a `@lid` JID. It requires `@s.whatsapp.net`.

**Fixes:**
1. **Bot must be admin** in the group
2. **Target's PN must be resolvable** — reply to their message first
3. **If reply doesn't work**, use their phone number: `.kick 923001234567`
4. **Target is group owner** — cannot be removed/demoted
5. **User recently left** — try adding them back first

---

## Channels command returns nothing

**Symptom:** `.getjid channels` says "not available" or returns empty.

**Cause:** Official `@whiskeysockets/baileys` v7 does not expose bulk channel listing.

**Fixes:**
- **Immediate:** `.getjid currentchat` inside a channel works via `newsletterMetadata`
- **Over time:** Bot caches channels as they send messages (check `state/channel-cache.json`)
- **Permanent:** Switch to `@itsliaaa/baileys` which has `newsletterSubscribed()`

---

## LID not resolving to PN

**Symptom:** `.getjid` shows LID but says "PN not found".

**Cause:** WhatsApp hasn't cached the PN↔LID mapping.

**Fixes:**
1. Reply to a message from that user in a group → PN often appears in `participantAlt`
2. Ensure bot has seen them message before
3. Perform any admin action (kick/promote) → server response leaks the PN
4. If in a group, use `.getjid members` to see all resolvable PNs

---

## Schedule says "not enough arguments"

**Symptom:** `.schedule` rejects a seemingly valid input.

**Check:**
- Date format: `dd,mm,yy` (commas) or `dd mm yy` (spaces)
- Time format: `hour minute am/pm` (three tokens)
- Total: at least 6 tokens after the message + target

**Example (valid):**
```
.schedule Hello 923001234567 25,12,26 10 30 am
```

**Example (invalid — only 5 tokens):**
```
.schedule Hello 923001234567 25,12,26 10 30
                                        ^ missing am/pm
```

---

## Presence commands don't work

**Symptom:** `.presence typing on` doesn't show typing indicator.

**Check:**
1. Send a message from someone else to trigger auto-presence
2. Set `WRAITH_DEBUG=1` to see `[presence] applyAutoPresence` logs
3. Confirm `state/presence.json` has `autoTyping: true`

**Note:** Typing indicators only appear in **DMs and groups** — not in status broadcasts or channels.

---

## Bot goes offline randomly

**Symptom:** Bot stops responding after a while.

**Fixes:**
1. Check `pm2 logs wraith` for errors
2. Confirm `session/` isn't corrupted — delete and re-pair if needed
3. Ensure VPS has stable network (Baileys needs persistent WebSocket)
4. Check `.presence online on` — if off, heartbeat stops

---

## Media not downloading

**Symptom:** Ghost/peek/lurk fails to download images/videos.

**Fixes:**
1. Check `vault/` exists and is writable
2. Check disk space (`df -h`)
3. Set `WRAITH_DEBUG=1` to see download errors
4. Old messages (past WhatsApp's retention window) cannot be downloaded

---

## Bot crashes on startup

**Symptom:** `npm start` exits with `ERR_MODULE_NOT_FOUND`.

**Cause:** Missing file, wrong import path.

**Fix:** Ensure these files exist:
```
core/jid-resolver.js
core/identity.js
core/vault.js
modules/ghost.js
modules/peek.js
modules/lurk.js
modules/schedule.js
modules/admin.js
modules/profile.js
modules/jid.js
modules/presence.js
modules/activity.js
modules/ping.js
modules/help.js
modules/debug.js
```

Paste the full error — it names the missing file.

---

## `unhandledRejection` spam in logs

**Symptom:** Console fills with `unhandled · ...`.

**Cause:** Non-critical promise rejections (e.g. a `sock.sendPresenceUpdate()` to a dead chat).

**Fix:** Usually harmless — bot continues working. To reduce noise, wrap noisy calls in `try/catch`. WRAITH does this internally, so most are from external libraries.

---

## Getting help

When filing an issue, include:

1. **Version:** `node --version`, Baileys version from `package.json`
2. **First 30 lines** of the error
3. **Command** that triggered it
4. **`WRAITH_DEBUG=1` output** if relevant
5. **NEVER include** `.env`, `session/`, or `state/owner.json`

Redact phone numbers and LIDs in screenshots.
