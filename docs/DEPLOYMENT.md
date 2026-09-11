# Deployment

## VPS (Ubuntu/Debian)

### 1. Install Node 20

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node --version   # v20.x
```

### 2. Install PM2

```bash
sudo npm install -g pm2
```

### 3. Clone and install

```bash
git clone https://github.com/themalik-g/wraith.git
cd wraith
npm install
```

### 4. Start with PM2

```bash
npm run pm2:start
pm2 save
pm2 startup   # follow the printed command
```

### 5. Logs

```bash
pm2 logs wraith
pm2 monit
```

---

## Docker (optional)

**Dockerfile:**

```dockerfile
FROM node:20-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .

VOLUME ["/app/session", "/app/state", "/app/vault"]

CMD ["node", "start.js"]
```

**Build and run:**

```bash
docker build -t wraith .
docker run -d \
  --name wraith \
  -v $(pwd)/session:/app/session \
  -v $(pwd)/state:/app/state \
  -v $(pwd)/vault:/app/vault \
  --restart unless-stopped \
  wraith
```

---

## Pairing over SSH

First run in a non-TTY context uses `CONFIG.owner` from `config.js`. For interactive pairing:

```bash
ssh -t user@host
cd wraith
npm start
```

Enter the number when prompted, then scan/enter the pairing code on your phone.

---

## Reverse Proxy (not needed)

WRAITH uses **outbound WebSockets only**. No ports to expose, no HTTPS, no Nginx needed.

---

## Backup

Back up these:

```bash
tar czf wraith-backup-$(date +%F).tar.gz \
  session/ \
  state/ \
  config.js \
  package.json \
  core/ \
  modules/ \
  start.js \
  router.js
```

**Do not back up:** `node_modules/`, `vault/`, `logs/`.

**Restore:** extract, `npm install`, `npm start`. Bot will reconnect with the same session — no re-pairing needed.

---

## Resource Usage

Typical footprint on a $5 VPS:

- **RAM:** 80–150 MB idle, up to 300 MB under load
- **CPU:** <5% idle
- **Disk:** session ~5 MB, ledger grows with messages (~1 KB per message)

If ledger grows large, lower `memoryTTL` in `config.js`.

---

## Health Checks

PM2 auto-restarts on crash. To monitor externally:

```bash
pm2 jlist | jq '.[0].pm2_env.status'
```

Returns `"online"` when healthy.
