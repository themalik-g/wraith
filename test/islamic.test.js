import { prayertimesCommand, quranCommand, soraCommand, paraCommand, muslimCommand, bukhariCommand, searchQuranCommand, quransearchCommand, hadeessearchCommand, islamsearchCommand } from '../modules/islamic.js';
import { reqlocationCommand } from '../modules/location.js';

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

  console.log('\n8. Testing .quransearch without GEMINI_API_KEY');
  await quransearchCommand(mockSock, '12345@s.whatsapp.net', mockMsg, ['patience']);

  console.log('\n9. Testing .hadeessearch without GEMINI_API_KEY');
  await hadeessearchCommand(mockSock, '12345@s.whatsapp.net', mockMsg, ['seeking knowledge']);

  console.log('\n10. Testing .islamsearch without GEMINI_API_KEY');
  await islamsearchCommand(mockSock, '12345@s.whatsapp.net', mockMsg, ['charity']);

  console.log('\n11. Testing .relocation / .reqlocation');
  await reqlocationCommand(mockSock, '12345@s.whatsapp.net', mockMsg);

  console.log('\n12. Testing .islamsearch with mock Gemini API key & mocked Gemini response');
  process.env.GEMINI_API_KEY = 'test_key';
  const originalFetch = global.fetch;
  global.fetch = async (url, opts) => {
    if (typeof url === 'string' && url.includes('generativelanguage.googleapis.com')) {
      return {
        ok: true,
        json: async () => ({
          candidates: [{
            content: {
              parts: [{
                text: JSON.stringify({
                  quran_references: [{ surah: 2, ayah: 255 }],
                  hadith_references: [{ book: 'bukhari', hadith_number: 1 }]
                })
              }]
            }
          }]
        })
      };
    }
    return originalFetch(url, opts);
  };

  await islamsearchCommand(mockSock, '12345@s.whatsapp.net', mockMsg, ['Ayat al Kursi and Intention']);
  global.fetch = originalFetch;
  delete process.env.GEMINI_API_KEY;

  console.log('\n--- All Islamic & Location Command Tests Completed ---');
}

runTests().catch(console.error);
