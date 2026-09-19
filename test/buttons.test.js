import {
  createQuickReply,
  createCtaUrl,
  createCtaCopy,
  createCtaCall,
  createSingleSelect,
  createLocationRequest,
  extractInteractiveResponse,
  sendInteractive,
} from '../lib/buttons.js';
import assert from 'assert';

console.log('--- Testing lib/buttons.js ---');

// 1. Test button creation helpers
const qr = createQuickReply('Test Button', '.ping');
assert.strictEqual(qr.name, 'quick_reply');
assert.deepStrictEqual(JSON.parse(qr.buttonParamsJson), { display_text: 'Test Button', id: '.ping' });

const urlBtn = createCtaUrl('Visit Site', 'https://example.com');
assert.strictEqual(urlBtn.name, 'cta_url');
assert.deepStrictEqual(JSON.parse(urlBtn.buttonParamsJson), { display_text: 'Visit Site', url: 'https://example.com', merchant_url: 'https://example.com' });

const locBtn = createLocationRequest('Share Location');
assert.strictEqual(locBtn.name, 'send_location');
assert.deepStrictEqual(JSON.parse(locBtn.buttonParamsJson), { display_text: 'Share Location' });

// 2. Test response extraction
// Quick Reply
const msg1 = {
  message: {
    buttonsResponseMessage: {
      selectedButtonId: '.ghost on'
    }
  }
};
assert.strictEqual(extractInteractiveResponse(msg1), '.ghost on');

// Modern Interactive Native Flow Response
const msg2 = {
  message: {
    interactiveResponseMessage: {
      nativeFlowResponseMessage: {
        name: 'quick_reply',
        paramsJson: JSON.stringify({ id: '.lurk on' })
      }
    }
  }
};
assert.strictEqual(extractInteractiveResponse(msg2), '.lurk on');

// Single Select List Response
const msg3 = {
  message: {
    listResponseMessage: {
      singleSelectReply: {
        selectedRowId: 'menu_ghost'
      }
    }
  }
};
assert.strictEqual(extractInteractiveResponse(msg3), 'menu_ghost');

// 3. Test sendInteractive mock socket
let calledRelay = false;
let mockJid = null;
let mockMsg = null;
let mockOptions = null;

const mockSock = {
  relayMessage: async (jid, msg, options) => {
    calledRelay = true;
    mockJid = jid;
    mockMsg = msg;
    mockOptions = options;
  },
  sendMessage: async (jid, content, options) => {}
};

await sendInteractive(mockSock, '1234567890@s.whatsapp.net', {
  body: 'Hello world',
  buttons: [
    createQuickReply('Ping', '.ping'),
    createLocationRequest('Share Location')
  ]
});

assert.strictEqual(calledRelay, true);
assert.strictEqual(mockJid, '1234567890@s.whatsapp.net');
assert.ok(mockOptions?.additionalNodes?.length > 0);

console.log('✅ All lib/buttons.js tests passed successfully!');
