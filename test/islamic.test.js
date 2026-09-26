import { prayertimesCommand, quranCommand, soraCommand, paraCommand, muslimCommand, bukhariCommand, searchQuranCommand } from '../modules/islamic.js';

async function runTests() {
  console.log('--- Testing Islamic Commands ---');

  const mockSock = {
    sendMessage: async (chat, content, options) => {
      console.log(`[mockSock.sendMessage] to: ${chat}`);
      if (content.text) console.log('Message text preview:\n', content.text.slice(0, 300));
      if (content.document) console.log('Document sent:', content.fileName, 'bytes:', content.document.length);
      return { key: { id: 'test_msg_id' } };
    }
  };

  const mockMsg = { key: { remoteJid: '12345@s.whatsapp.net', fromMe: false } };

  console.log('\n1. Testing .prayertimes London');
  await prayertimesCommand(mockSock, '12345@s.whatsapp.net', mockMsg, ['London']);

  console.log('\n2. Testing .quran 11:24');
  await quranCommand(mockSock, '12345@s.whatsapp.net', mockMsg, ['11:24']);

  console.log('\n3. Testing .sora Al-Imran');
  await soraCommand(mockSock, '12345@s.whatsapp.net', mockMsg, ['Al-Imran']);

  console.log('\n4. Testing .para 11');
  await paraCommand(mockSock, '12345@s.whatsapp.net', mockMsg, ['11']);

  console.log('\n5. Testing .muslim 1');
  await muslimCommand(mockSock, '12345@s.whatsapp.net', mockMsg, ['1']);

  console.log('\n6. Testing .bukhari 1');
  await bukhariCommand(mockSock, '12345@s.whatsapp.net', mockMsg, ['1']);

  console.log('\n7. Testing .search quran patience');
  await searchQuranCommand(mockSock, '12345@s.whatsapp.net', mockMsg, ['patience']);

  console.log('\n--- All Islamic Command Tests Completed ---');
}

runTests().catch(console.error);
