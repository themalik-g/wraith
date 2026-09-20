# Troubleshooting

## Bot won't pair

**Symptom:** Pairing code shown but phone rejects it, or no code appears.

**Fix:**
1. Stop the bot
2. Delete `session/` folder
3. Restart — enter your phone number fresh
4. Enter the new pairing code within 60 seconds

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

---

## Media download fails (`.dl` / `.mp3` / `.pdl`)

**Symptom:** Command reports failure or no media downloaded.

**Fixes:**
1. **Image Posts & Carousels:** Ensure `@postfetch/core` is installed (`npm install`). Try `.pdl <url>` or `.pdlzip <url>` directly for post extraction.
2. **Non-Post URLs in `.pdl`:** If `.pdl` fails on a standard video or profile link, use `.dl`, `.ig`, or `.tiktok` instead.
3. **Video Size Limit:** Videos exceeding 60 MB are skipped to prevent WhatsApp upload failures.
4. **Private Content:** Private Instagram/TikTok posts are login-gated and cannot be fetched without authentication.

---

## Channels command returns nothing

**Symptom:** `.getjid channels` returns empty or unavailable.

**Fixes:**
- `.getjid currentchat` inside a channel works via `newsletterMetadata`
- The bot caches channels as messages arrive (`state/channel-cache.json`)

---

## LID not resolving to PN

**Symptom:** `.getjid` shows LID but says "PN not found".

**Fixes:**
1. Reply to a message from that user in a group
2. Ensure bot has seen them message before
3. Perform an admin action (kick/promote) to trigger server resolution
4. Use `.getjid members` in group chats

---

## `Assertion failed: thread_create` / Node Platform Crash

**Symptom:** Bot crashes with `node_platform.cc:68 Assertion failed: thread_create(t.get(), start_thread, this))` on Pterodactyl panels, Docker, or limited VPS containers.

**Cause:** The host or container limits the maximum number of processes/threads (`NPROC` or CGroup `pids.max`). When running multiple sessions, V8 and libuv background thread allocation exceeds the container thread ceiling.

**Fix:**
WRAITH defaults `--v8-pool-size=2` and `UV_THREADPOOL_SIZE=2` for spawned session processes. If running many concurrent sessions on tight host limits, set `UV_THREADPOOL_SIZE` and `WRAITH_V8_POOL_SIZE` in your environment or `.env`:
```bash
UV_THREADPOOL_SIZE=2
WRAITH_V8_POOL_SIZE=2
```

---

## Schedule says "not enough arguments"

**Check:**
- Date format: `dd,mm,yy` (commas) or `dd mm yy` (spaces)
- Time format: `hour minute am/pm` (three tokens)

**Example:**
```
.schedule Hello 923001234567 25,12,26 10 30 am
```

---

## Getting Help

When submitting issues:
1. Version: `node --version`, Baileys version in `package.json`
2. Error trace output
3. Command used
4. **NEVER share** `session/`, `.env`, or `state/owner.json`
