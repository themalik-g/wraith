# WRAITH — fixed build (𝙒𝙍𝘼𝙄𝙏𝙃-𝘽𝙊𝙏)

## Files in this archive (replace these in your project)
- config.js                    → botName + timezone options
- start.js                     → FIX 1 (auto re-pair after logout), FIX 8 (single keep-alive)
- core/state-io.js             → NEW — atomic JSON writes (tmp+rename)
- core/vault.js                → FIX 11 (honors CONFIG.vaultMaxMB, safe purge)
- core/jid-resolver.js         → FIX 10 (shared resolveTargetUniversal), atomic cache writes
- modules/ghost.js             → FIX 2 (reveal dedupe), FIX 7 (skip status/fromMe, media only for antidelete), atomic writes, gated logs
- modules/schedule.js          → FIX 6 (retries + owner notice, .schedule list/cancel, CONFIG.timezone)
- modules/activity.js          → FIX 11 (.activity <jid> detail + atomic writes)
- modules/presence.js          → FIX 8 (silent by default, single heartbeat)
- modules/help.js              → new boxed menu style with bot name

## After replacing
1. Copy files over your existing ones (keep the same folder structure).
2. Edit config.js → set your owner number.
3. Delete old state files if you want a clean slate: state/*.json (optional).
4. npm start

## New commands
- .schedule list
- .schedule cancel <id>
- .activity <jid>
- .menu <group>  (e.g. .menu ghost)
