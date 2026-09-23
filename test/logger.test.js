import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { logMessageHistory, flushSync } from '../modules/logger.js';

async function runTests() {
  console.log('Testing modules/logger.js...');

  const logsDir = path.join(process.cwd(), 'logs');
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const dateStr = `${year}-${month}-${day}`;

  const testSession = 'unittest';
  const expectedLogFile = path.join(logsDir, `messages_${testSession}_${dateStr}.txt`);

  // Cleanup old test file if present
  if (fs.existsSync(expectedLogFile)) {
    fs.unlinkSync(expectedLogFile);
  }

  // Test 1: Log incoming text message
  logMessageHistory({
    sessionId: testSession,
    direction: 'INCOMING',
    chatJid: '1234567890@s.whatsapp.net',
    senderJid: '9876543210@s.whatsapp.net',
    messageText: 'Hello WRAITH bot!',
    msgId: 'TEST_MSG_1'
  });
  flushSync();

  assert.strictEqual(fs.existsSync(expectedLogFile), true, 'Log file should be created');
  let content = fs.readFileSync(expectedLogFile, 'utf-8');
  assert.ok(content.includes('[INCOMING]'), 'Should contain [INCOMING]');
  assert.ok(content.includes('+9876543210 -> +1234567890'), 'Should contain formatted phone numbers');
  assert.ok(content.includes('Hello WRAITH bot!'), 'Should contain message text');

  // Test 2: Log duplicate message ID (should be skipped)
  logMessageHistory({
    sessionId: testSession,
    direction: 'INCOMING',
    chatJid: '1234567890@s.whatsapp.net',
    senderJid: '9876543210@s.whatsapp.net',
    messageText: 'Hello WRAITH bot!',
    msgId: 'TEST_MSG_1'
  });
  flushSync();

  const lines = fs.readFileSync(expectedLogFile, 'utf-8').trim().split('\n');
  assert.strictEqual(lines.length, 1, 'Duplicate msgId should not create extra log lines');

  // Test 3: Log outgoing media message with vault location
  logMessageHistory({
    sessionId: testSession,
    direction: 'OUTGOING',
    chatJid: '1234567890@s.whatsapp.net',
    senderJid: '1111111111@s.whatsapp.net',
    messageText: 'Check out this photo',
    mediaType: 'image',
    mediaPath: '/path/to/vault/TEST_MSG_2.jpg',
    msgId: 'TEST_MSG_2'
  });
  flushSync();

  content = fs.readFileSync(expectedLogFile, 'utf-8');
  assert.ok(content.includes('[OUTGOING]'), 'Should contain [OUTGOING]');
  assert.ok(content.includes('<Media: image (/path/to/vault/TEST_MSG_2.jpg)>'), 'Should contain media tag with path');

  // Clean up test file
  if (fs.existsSync(expectedLogFile)) {
    fs.unlinkSync(expectedLogFile);
  }

  console.log('✅ All logger tests passed!');
}

runTests().catch(err => {
  console.error('❌ Logger test failed:', err);
  process.exit(1);
});
