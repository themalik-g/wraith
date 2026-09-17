// ─────────────────────────────────────────────
// WRAITH · modules/usermanual.js
// Generates a comprehensive PDF user manual using PDFKit
// ─────────────────────────────────────────────
import PDFDocument from 'pdfkit';

let cachedPdfBuffer = null;

export function buildUserManualBuffer() {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margin: 40,
        bufferPages: true,
      });

      const buffers = [];
      doc.on('data', (chunk) => buffers.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', (err) => reject(err));

      const PRIMARY = '#0D47A1';
      const ACCENT = '#00E5FF';
      const DARK = '#1E293B';
      const GRAY = '#64748B';
      const LIGHT_BG = '#F8FAFC';

      // ── Title Header ──
      doc.rect(0, 0, doc.page.width, 100).fill(PRIMARY);
      doc.fillColor('#FFFFFF').fontSize(26).font('Helvetica-Bold').text('WRAITH BOT — USER MANUAL', 40, 25, { align: 'left' });
      doc.fillColor(ACCENT).fontSize(12).font('Helvetica').text('Comprehensive Official Guide & Feature Documentation', 40, 60);
      doc.fillColor('#FFFFFF').fontSize(10).text('Provided by 𝕎ℝ𝔸I𝕋ℍ · Version 2.1.0', 40, 78, { align: 'right' });

      doc.y = 120;

      const sections = [
        {
          title: '1. Overview & System Features',
          content: [
            'WRAITH is a silent, high-performance WhatsApp bot built on Baileys v7 with full LID-aware JID resolution.',
            '• Dual Operational Modes: Private (Owner-only execution) and Public (Public features accessible to all users).',
            '• LID-Aware Architecture: Seamless handling of WhatsApp Linked Identity (LID) and Phone Number (PN) JIDs.',
            '• Automated Media Processing: Deep integration with @postfetch/core and yt-dlp for carousels, videos, and music.',
          ],
        },
        {
          title: '2. Core & System Commands',
          content: [
            '• .ping — Check bot round-trip latency, memory usage, and uptime.',
            '• .help / .menu [category] — Display command menu boxes or detailed category help.',
            '• .usermanual — Generate and receive this PDF user manual document.',
            '• .prefix <char> — Change global command prefix (Owner only).',
            '• .mode <public|private> — Switch bot operational mode (Owner only).',
            '• .update — Pull latest updates from Git repository and restart (Owner only).',
            '• .script / .repo — Display bot repository source information.',
            '• .owner — Display owner contact details.',
          ],
        },
        {
          title: '3. Ghost (Anti-Delete & Anti-Edit)',
          content: [
            '• .ghost — Display current ghost status and configuration.',
            '• .ghost on / off — Enable or disable anti-delete message tracking.',
            '• .ghost edit on / off — Enable or disable anti-edit message tracking.',
            'How it works: Ghost silently ledgers inbound messages and media vault items. When a message is deleted or edited by any user, WRAITH reveals the original deleted message or edit history directly to the owner or chat.',
          ],
        },
        {
          title: '4. Peek (View-Once Revealer)',
          content: [
            '• .peek — Reply to any view-once image, video, or voice message to reveal it.',
            '• .peek auto on / off — Automatically intercept and forward incoming view-once media.',
            '• .peek watch on / off — Watch quoted replies to view-once messages.',
            '• .peek dest <owner|same|both> — Set destination for revealed view-once media.',
          ],
        },
        {
          title: '5. Lurk (Status Watcher & Auto-Reaction)',
          content: [
            '• .lurk — Display status lurking state.',
            '• .lurk on / off — Automatically mark all status updates as viewed.',
            '• .lurk react on / off — Enable or disable auto-reactions on status updates.',
            '• .lurk download on / off — Automatically download status media to owner DM.',
            '• .lurk emoji <emoji|random|none> — Set status reaction emoji preference.',
          ],
        },
        {
          title: '6. Schedule (Automated Scheduled Messaging)',
          content: [
            '• .schedule <msg> <target> <date> <time> <am/pm> — Schedule a text or media message.',
            '• .schedule open <date> <time> <am/pm> — Schedule automatic group opening.',
            '• .schedule close <date> <time> <am/pm> — Schedule automatic group closing.',
            '• .schedule list — List all active scheduled tasks.',
            '• .schedule cancel <id> — Cancel a scheduled task by ID.',
          ],
        },
        {
          title: '7. Media & Social Downloaders',
          content: [
            '• .dl <url> / .download <url> — Multi-platform downloader (yt-dlp + postfetch).',
            '• .mp3 <url> / .dl audio <url> — Extract MP3 audio from any link.',
            '• .pdl <post-url> — Directly download social media carousels & slideshow posts.',
            '• .pdlzip <post-url> — Package multi-media carousel posts into a ZIP archive.',
            '• .song <query> — Search & download music (SoundCloud, Apple Music, Deezer).',
            '• .gitdl <github-url> — Download GitHub repository ZIP archives.',
            '• .mfdl <mediafire-url> — Resolve and download MediaFire files.',
            '• .ig <username|url> — Instagram profile lookup and post/reel downloader.',
            '• .tiktok <username|url> — TikTok profile lookup and photo/video downloader.',
            '• .fb <username|url> — Facebook video and profile downloader.',
          ],
        },
        {
          title: '8. Group Administration & Protection',
          content: [
            '• .open / .close — Set group permission to allow all members or admins only to send messages.',
            '• .kick (reply / num) / .add <number> — Remove or add group members.',
            '• .promote (reply / num) / .demote (reply / num) — Change member admin permissions.',
            '• .tagall [msg] / .hidetag [msg] — Tag all members explicitly or silently.',
            '• .setgdesc <text> / .setgpp (reply image) — Update group description or group icon.',
            '• .welcome on / off | .goodbye on / off — Toggle join and leave greeting notifications.',
            '• .antilink on / off | .antispam on / off | .antisticker on / off — Toggle automated group security enforcement.',
            '• .kickall — Remove all non-admin members from the group.',
            '• .kickcc <code> — Remove members with specific country phone code.',
            '• .approveall / .declineall — Bulk manage pending group join requests.',
            '• .leave / .join <link> — Manage bot group participation.',
          ],
        },
        {
          title: '9. Utility & Entertainment Tools',
          content: [
            '• .currency <amount> <from> <to> — Live currency exchange rate calculation.',
            '• .qr <text> / .readqr (reply image) — Generate or read QR codes.',
            '• .define <word> / .weather <city> — Dictionary lookups and weather forecasts.',
            '• .pwned <password> — Check password leakage against data breaches.',
            '• .url (reply media) — Upload media to temporary CDN link.',
            '• .book <query> / .book dl <id> — Search & download free books (Gutenberg/Archive.org).',
            '• .img <query> [count] — Search high-resolution stock images.',
            '• .movie <title> / .songinfo <query> / .lyrics <artist> - <title> — Media metadata.',
            '• .ppt <topic> — Generate PowerPoint (.pptx) presentation decks automatically.',
            '• .couplepp — Generate matching profile picture pairs.',
          ],
        },
        {
          title: '10. Owner, Profile & JID Resolution',
          content: [
            '• .setpp / .setabout <text> — Change bot profile picture or WhatsApp bio.',
            '• .setstatus <text> — Post WhatsApp status update.',
            '• .getstatus <num> / .getpair <num> / .setsession — Manage profiles and sessions.',
            '• .block / .unblock / .blocklist / .unblockall — User blocklist management.',
            '• .rejectcalls on / off — Automatically reject incoming audio/video calls.',
            '• .stalk <number> / .stalk list / .stalk stop — Track target online/offline timestamps.',
            '• .chatstats — View message distribution and chat analytics.',
            '• .getjid [num|@user|LID|members|currentchat|channels] — Complete JID resolution engine.',
            '• .getpp [num|owner|chat] — Download profile picture in high resolution.',
            '• .presence [online|typing|recording|reads on/off] — Presence state toggles.',
            '• .activity — Detailed chat activity analytics dashboard.',
            '• .mute / .unmute / .archive / .unarchive / .clearchat — Chat state controls.',
          ],
        },
      ];

      for (const sec of sections) {
        if (doc.y > 680) doc.addPage();

        doc.fillColor(PRIMARY).fontSize(14).font('Helvetica-Bold').text(sec.title, { paragraphGap: 6 });
        doc.fillColor(DARK).fontSize(9.5).font('Helvetica');

        for (const item of sec.content) {
          if (doc.y > 720) doc.addPage();
          doc.text(item, { indent: 10, lineGap: 3 });
        }
        doc.moveDown(0.8);
      }

      // Add footer to pages
      const range = doc.bufferedPageRange();
      for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i);
        doc.fillColor(GRAY).fontSize(8).font('Helvetica').text(
          `WRAITH User Manual — Page ${i + 1} of ${range.count} · Provided by 𝕎ℝ𝔸I𝕋ℍ`,
          40,
          doc.page.height - 30,
          { align: 'center', width: doc.page.width - 80 }
        );
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

export async function usermanualCommand(sock, chat, msg) {
  try {
    if (!cachedPdfBuffer) {
      cachedPdfBuffer = await buildUserManualBuffer();
    }

    await sock.sendMessage(
      chat,
      {
        document: cachedPdfBuffer,
        mimetype: 'application/pdf',
        fileName: 'WRAITH_User_Manual.pdf',
        caption: '📄 *WRAITH Bot — Complete User Manual*\n\nDetailed operational documentation and command reference.\nProvided by 𝕎ℝ𝔸I𝕋ℍ',
      },
      { quoted: msg }
    );
  } catch (e) {
    console.error('[usermanualCommand]', e);
    try {
      await sock.sendMessage(
        chat,
        { text: `⚠️ Failed to generate user manual: ${e.message}` },
        { quoted: msg }
      );
    } catch {}
  }
}
