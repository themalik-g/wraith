# 👻 wraith

A silent watcher for WhatsApp.

Wraith remembers what was deleted, peeks at what was hidden, and quietly
lurks on statuses — all through a pairing-code login. No QR, no fuss.

---

## ✨ Features

- 👻 **ghost** — logs every message and reports it back to you when someone deletes it (including media).
- 👁️ **peek** — reveals view-once images and videos.
- 🌒 **lurk** — auto-views all contact statuses (optional auto-reactions).
- 🔐 **Pairing-code only** — no QR terminal spam.
- ♻️ **Auto-reconnect** — survives network drops.
- 🧹 **Auto-cleanup** — vault and ledger self-purge on a schedule.

---

## 📦 Requirements

- **Node.js 20 or newer**
- A WhatsApp account you're willing to link as a device
- (Optional) **PM2** for 24/7 background running

---

## 🚀 Installation

```bash
git clone https://github.com/themalik-g/wraith.git
cd wraith
npm install
