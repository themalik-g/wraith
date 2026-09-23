import assert from 'node:assert';
import { parseDuration, formatTime, webopenCommand, weblistCommand, webstopCommand } from '../modules/webopen.js';

async function runTests() {
    console.log('Running webopen unit & integration tests...');

    // Test 1: Duration Parser
    assert.strictEqual(parseDuration('100'), 100 * 60 * 1000, 'Default to minutes when unit omitted');
    assert.strictEqual(parseDuration('100m'), 100 * 60 * 1000, 'Parse minutes with m suffix');
    assert.strictEqual(parseDuration('100 minutes'), 100 * 60 * 1000, 'Parse minutes with full word');
    assert.strictEqual(parseDuration('2h'), 2 * 60 * 60 * 1000, 'Parse hours');
    assert.strictEqual(parseDuration('30s'), 30 * 1000, 'Parse seconds');
    assert.strictEqual(parseDuration('invalid'), null, 'Invalid duration returns null');
    console.log('Test 1 passed: Duration parser verified');

    // Test 2: Time Formatter
    assert.strictEqual(formatTime(30 * 1000), '30s', 'Format seconds');
    assert.strictEqual(formatTime(100 * 60 * 1000), '1h 40m 0s', 'Format hours and minutes');
    console.log('Test 2 passed: Time formatter verified');

    // Test 3: Webopen Integration Test with Mock Socket
    const sentMessages = [];
    const mockSock = {
        async sendMessage(chat, content, opts) {
            sentMessages.push({ chat, content, opts });
            return { key: { id: 'test_msg_id' } };
        }
    };

    const mockChat = '1234567890@s.whatsapp.net';
    const mockMsg = { key: { remoteJid: mockChat, id: 'cmd_msg_id' } };

    // Test opening https://example.com for 5 seconds
    await webopenCommand(mockSock, mockChat, mockMsg, ['https://example.com', '5s']);

    assert.ok(sentMessages.length >= 2, 'Should send initial status and success confirmation messages');
    const successMsg = sentMessages.find(m => m.content.text && m.content.text.includes('Webpage Open & Active'));
    assert.ok(successMsg, 'Should contain active webpage status message');
    console.log('Test 3 passed: webopenCommand executed and page loaded');

    // Test 4: Weblist
    sentMessages.length = 0;
    await weblistCommand(mockSock, mockChat, mockMsg);
    assert.strictEqual(sentMessages.length, 1, 'weblist should send 1 response message');
    assert.ok(sentMessages[0].content.text.includes('Active Open Webpages'), 'weblist message title verified');
    assert.ok(sentMessages[0].content.text.includes('https://example.com'), 'weblist URL verified');
    console.log('Test 4 passed: weblistCommand listed active session');

    // Test 5: Webstop
    sentMessages.length = 0;
    await webstopCommand(mockSock, mockChat, mockMsg, ['all']);
    assert.ok(sentMessages.length >= 1, 'webstop should send confirmation message');
    const closedAllMsg = sentMessages.find(m => m.content.text && m.content.text.includes('Closed all'));
    assert.ok(closedAllMsg, 'webstop all confirmed');
    console.log('Test 5 passed: webstopCommand stopped all sessions');

    // Verify list is empty now
    sentMessages.length = 0;
    await weblistCommand(mockSock, mockChat, mockMsg);
    assert.ok(sentMessages[0].content.text.includes('No active webpage keep-open sessions'), 'No sessions remaining');
    console.log('Test 6 passed: list is empty after webstop');

    console.log('All webopen tests passed successfully!');
}

runTests().catch((err) => {
    console.error('Webopen test failed:', err);
    process.exit(1);
});
