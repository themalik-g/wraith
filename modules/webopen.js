// modules/webopen.js — Keep webpage open for specified duration using Puppeteer
import puppeteer from 'puppeteer-core';
import fs from 'fs';

let sharedBrowser = null;
const activeSessions = new Map(); // id -> session object
let nextSessionId = 1;

function getChromePath() {
    if (process.env.CHROME_BIN && fs.existsSync(process.env.CHROME_BIN)) {
        return process.env.CHROME_BIN;
    }
    const possiblePaths = [
        '/usr/bin/google-chrome',
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
    ];
    for (const p of possiblePaths) {
        if (fs.existsSync(p)) return p;
    }
    return null;
}

async function getBrowserInstance() {
    if (sharedBrowser && sharedBrowser.connected) {
        return sharedBrowser;
    }
    const executablePath = getChromePath();
    if (!executablePath) {
        throw new Error('Chrome/Chromium binary not found on host system.');
    }
    sharedBrowser = await puppeteer.launch({
        executablePath,
        headless: 'new',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--window-size=1920,1080'
        ]
    });
    return sharedBrowser;
}

async function checkCloseBrowser() {
    if (activeSessions.size === 0 && sharedBrowser && sharedBrowser.connected) {
        try {
            await sharedBrowser.close();
        } catch (e) {
            console.error('[webopen] Error closing browser instance:', e.message);
        }
        sharedBrowser = null;
    }
}

export function parseDuration(text) {
    if (!text) return null;
    const str = text.trim().toLowerCase();

    // Match numbers and unit (e.g. 100m, 100 minutes, 2h, 30s, or plain number)
    const match = str.match(/^(\d+)\s*([a-z]*)$/);
    if (!match) return null;

    const value = parseInt(match[1], 10);
    if (isNaN(value) || value <= 0) return null;

    const unit = match[2];
    if (!unit || unit.startsWith('m')) {
        return value * 60 * 1000; // minutes (default)
    } else if (unit.startsWith('s')) {
        return value * 1000; // seconds
    } else if (unit.startsWith('h') || unit.startsWith('hr')) {
        return value * 60 * 60 * 1000; // hours
    } else if (unit.startsWith('d')) {
        return value * 24 * 60 * 60 * 1000; // days
    }

    return value * 60 * 1000; // default to minutes
}

export function formatTime(ms) {
    const totalSec = Math.floor(ms / 1000);
    const hours = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;

    const parts = [];
    if (hours > 0) parts.push(`${hours}h`);
    if (mins > 0 || hours > 0) parts.push(`${mins}m`);
    parts.push(`${secs}s`);
    return parts.join(' ');
}

export async function webopenCommand(sock, chat, msg, rest) {
    if (!rest || rest.length === 0) {
        await sock.sendMessage(chat, {
            text: '🌐 *Webpage Open Command*\n\nUsage:\n• `.webopen <url> <duration>`\n\nExamples:\n• `.webopen https://example.com 100` (100 minutes)\n• `.webopen https://example.com 100m`\n• `.webopen https://example.com 2 hours`\n• `.webopen https://example.com 30s`'
        }, { quoted: msg });
        return;
    }

    let urlInput = rest[0];
    let durationInput = rest.slice(1).join(' ');

    if (!urlInput.startsWith('http://') && !urlInput.startsWith('https://')) {
        urlInput = 'https://' + urlInput;
    }

    try {
        new URL(urlInput);
    } catch {
        await sock.sendMessage(chat, { text: '⚠️ *Invalid URL provided.* Please specify a valid web address.' }, { quoted: msg });
        return;
    }

    let durationMs = parseDuration(durationInput);
    if (!durationMs) {
        durationMs = 10 * 60 * 1000; // Default to 10 minutes if unspecified
    }

    const MAX_DURATION = 24 * 60 * 60 * 1000; // 24 hours max
    if (durationMs > MAX_DURATION) {
        await sock.sendMessage(chat, { text: '⚠️ *Duration limit exceeded.* Maximum allowed duration is 24 hours.' }, { quoted: msg });
        return;
    }

    const sessionId = nextSessionId++;
    const formattedDuration = formatTime(durationMs);

    let browser;
    let page;
    try {
        browser = await getBrowserInstance();
        page = await browser.newPage();

        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await page.setViewport({ width: 1920, height: 1080 });

        await sock.sendMessage(chat, {
            text: `⌛ *Opening Webpage...*\n\n• URL: ${urlInput}\n• Target Duration: *${formattedDuration}*\n• Session ID: *#${sessionId}*\n\nProvided by 𝗪𝗥𝗔𝗜𝗧🇭`
        }, { quoted: msg });

        // Navigate to URL
        await page.goto(urlInput, { waitUntil: 'domcontentloaded', timeout: 45000 });
        const pageTitle = (await page.title()) || 'No Title';

        const startTime = Date.now();
        const endTime = startTime + durationMs;

        const timer = setTimeout(async () => {
            await closeSession(sessionId, sock, true);
        }, durationMs);

        const sessionObj = {
            id: sessionId,
            chat,
            url: urlInput,
            title: pageTitle,
            startTime,
            endTime,
            durationMs,
            page,
            timer
        };

        activeSessions.set(sessionId, sessionObj);

        await sock.sendMessage(chat, {
            text: `✅ *Webpage Open & Active*\n\n• Session ID: *#${sessionId}*\n• Title: ${pageTitle}\n• URL: ${urlInput}\n• Time Remaining: *${formatTime(durationMs)}*\n\nThe webpage will stay open in the background for credit earning.\n\nProvided by 𝗪𝗥𝗔𝗜𝗧🇭`
        }, { quoted: msg });

    } catch (err) {
        if (page) {
            try { await page.close(); } catch {}
        }
        await checkCloseBrowser();
        await sock.sendMessage(chat, { text: `❌ *Failed to open webpage:*\n${err.message}` }, { quoted: msg });
    }
}

async function closeSession(sessionId, sock, isExpired = false) {
    const session = activeSessions.get(sessionId);
    if (!session) return false;

    clearTimeout(session.timer);
    activeSessions.delete(sessionId);

    try {
        if (session.page && !session.page.isClosed()) {
            await session.page.close();
        }
    } catch (e) {
        console.error(`[webopen] Error closing page for session #${sessionId}:`, e.message);
    }

    await checkCloseBrowser();

    if (sock && session.chat) {
        try {
            if (isExpired) {
                await sock.sendMessage(session.chat, {
                    text: `🔔 *Webpage Session Completed*\n\n• Session ID: *#${sessionId}*\n• URL: ${session.url}\n• Duration: *${formatTime(session.durationMs)}*\n\nThe target webpage session has expired and been closed.\n\nProvided by 𝗪𝗥𝗔𝗜𝗧🇭`
                });
            } else {
                await sock.sendMessage(session.chat, {
                    text: `🛑 *Webpage Session Closed*\n\n• Session ID: *#${sessionId}*\n• URL: ${session.url}\n\nWebpage session stopped manually.\n\nProvided by 𝗪𝗥𝗔𝗜𝗧🇭`
                });
            }
        } catch (e) {
            console.error(`[webopen] Failed to send closure notification for session #${sessionId}:`, e.message);
        }
    }

    return true;
}

export async function webstopCommand(sock, chat, msg, rest) {
    if (activeSessions.size === 0) {
        await sock.sendMessage(chat, { text: 'ℹ️ No active open webpage sessions.' }, { quoted: msg });
        return;
    }

    const arg = (rest[0] || '').toLowerCase().trim();

    if (!arg) {
        await sock.sendMessage(chat, {
            text: `⚠️ *Please specify a session ID to stop, or "all"*.\n\nExample:\n• \`.webstop 1\`\n• \`.webstop all\`\n\nUse \`.weblist\` to view active sessions.`
        }, { quoted: msg });
        return;
    }

    if (arg === 'all') {
        const sessionIds = Array.from(activeSessions.keys());
        for (const id of sessionIds) {
            await closeSession(id, sock, false);
        }
        await sock.sendMessage(chat, { text: `✅ Closed all ${sessionIds.length} active webpage sessions.` }, { quoted: msg });
        return;
    }

    const targetId = parseInt(arg.replace('#', ''), 10);
    if (isNaN(targetId) || !activeSessions.has(targetId)) {
        await sock.sendMessage(chat, { text: `⚠️ Session ID *#${arg}* not found. Use \`.weblist\` to see active sessions.` }, { quoted: msg });
        return;
    }

    await closeSession(targetId, sock, false);
}

export async function weblistCommand(sock, chat, msg) {
    if (activeSessions.size === 0) {
        await sock.sendMessage(chat, { text: 'ℹ️ No active webpage keep-open sessions running.' }, { quoted: msg });
        return;
    }

    const now = Date.now();
    let text = `🌐 *Active Open Webpages (${activeSessions.size})*\n\n`;

    for (const [id, session] of activeSessions.entries()) {
        const remainingMs = Math.max(0, session.endTime - now);
        text += `• *#${id}* — ${session.url}\n`;
        text += `  └ Title: ${session.title}\n`;
        text += `  └ Remaining: *${formatTime(remainingMs)}* / Total: ${formatTime(session.durationMs)}\n\n`;
    }

    text += `To close a session, use \`.webstop <id>\` or \`.webstop all\`\n\nProvided by 𝗪𝗥𝗔𝗜𝗧🇭`;

    await sock.sendMessage(chat, { text }, { quoted: msg });
}

// Cleanup all browser sessions on process exit
process.on('exit', () => {
    if (sharedBrowser) {
        try { sharedBrowser.close(); } catch {}
    }
});
