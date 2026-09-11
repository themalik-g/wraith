// ─────────────────────────────────────────────
//  WRAITH · PM2 ecosystem config
//  Usage:  pm2 start ecosystem.config.cjs
// ─────────────────────────────────────────────
module.exports = {
    apps: [
        {
            name: 'wraith',
            script: 'start.js',
            cwd: __dirname,
            interpreter: 'node',

            // Restart strategy
            autorestart: true,
            watch: false,
            max_memory_restart: '500M',
            restart_delay: 4000,
            max_restarts: 20,
            min_uptime: '30s',

            // Logs
            output: './logs/out.log',
            error: './logs/error.log',
            merge_logs: true,
            time: true,

            // Environment
            env: {
                NODE_ENV: 'production'
            },

            // Graceful shutdown
            kill_timeout: 5000,
            wait_ready: false,
            listen_timeout: 10000
        }
    ]
};
