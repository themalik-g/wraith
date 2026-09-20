# Deployment Guide

## VPS Setup (Ubuntu / Debian)

### 1. Install Node.js 20+

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node --version   # Should output v20.x or higher
```

### 2. Install PM2

```bash
sudo npm install -g pm2
```

### 3. Clone Repository & Install Dependencies

```bash
git clone https://github.com/themalik-g/wraith.git
cd wraith
npm install
```

*Note:* `@postfetch/core` and `ffmpeg-static` are included as dependencies in `package.json`. No separate Python or authentication credentials are required.

### 4. Start with PM2

```bash
npm run pm2:start
pm2 save
pm2 startup
```

### 5. Monitor Logs

```bash
pm2 logs wraith
pm2 monit
```

---

## Docker Setup (Optional)

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

**Build & Run:**

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

## Interactive Pairing over SSH

First run will request your phone number in terminal and output a pairing code:

```bash
ssh -t user@your-vps-ip
cd wraith
npm start
```

Enter your phone number when prompted, then open WhatsApp on your phone:
> Settings → Linked Devices → Link a Device → Link with phone number instead

---

## Pterodactyl & Container Hosting Notes

When running WRAITH on containerized game/bot panels like Pterodactyl, the container may enforce strict thread or process limits (`pids.max` or `NPROC`).

To prevent Node `thread_create` assertion crashes when running multiple sessions simultaneously, WRAITH configures lightweight background thread defaults for spawned session processes:
- `UV_THREADPOOL_SIZE=2`
- `--v8-pool-size=2`

You can customize these variables in your panel environment settings or `.env` if needed:
```env
UV_THREADPOOL_SIZE=2
WRAITH_V8_POOL_SIZE=2
```

---

## Backup & Restoration

To create a backup:

```bash
tar czf wraith-backup-$(date +%F).tar.gz \
  session/ \
  state/ \
  config.js \
  package.json
```

**To restore:** Extract the tarball, run `npm install`, and start with `npm start` or `npm run pm2:start`. Re-pairing is not required if `session/` is preserved.
