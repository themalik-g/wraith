// ─────────────────────────────────────────────
//  WRAITH · PM2 ecosystem config
//  Usage: pm2 start ecosystem.config.cjs
// ─────────────────────────────────────────────
module.exports = {
    apps: [
        {
            name: 'wraith',
            script: 'index.js',
            cwd: __dirname,
            interpreter: 'node',
            autorestart: true,
            watch: false,
            max_memory_restart: '500M',
            restart_delay: 4000,
            max_restarts: 20,
            min_uptime: '30s',
            output: './logs/out.log',
            error: './logs/error.log',
            merge_logs: true,
            time: true,
            env: { NODE_ENV: 'production' },
            kill_timeout: 5000,
            wait_ready: false,
            listen_timeout: 10000
        }
    ]
};
