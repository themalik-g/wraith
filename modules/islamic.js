// ─────────────────────────────────────────────
// WRAITH · modules/islamic.js
// Islamic utilities: Prayer Times, Quran Verses, Surah, Para, Hadith & Quran Search
// ─────────────────────────────────────────────

import { sendWithCta } from '../lib/buttons.js';

// Surah Name Mapping (Names to Surah Number 1..114)
const SURAH_MAP = {
  'fatiha': 1, 'al-fatiha': 1, 'alfatiha': 1,
  'baqarah': 2, 'al-baqarah': 2, 'albaqarah': 2, 'baqara': 2, 'al-baqara': 2,
  'imran': 3, 'al-imran': 3, 'alimran': 3, 'aal-i-imraan': 3, 'ali-imran': 3,
  'nisa': 4, 'an-nisa': 4, 'annisa': 4,
  'maidah': 5, 'al-maidah': 5, 'almaidah': 5,
  'anam': 6, 'al-anam': 6, 'alanam': 6,
  'araf': 7, 'al-araf': 7, 'alaraf': 7,
  'anfal': 8, 'al-anfal': 8, 'alanfal': 8,
  'tawbah': 9, 'at-tawbah': 9, 'attawbah': 9, 'repentance': 9,
  'yunus': 10, 'younus': 10,
  'hud': 11,
  'yusuf': 12, 'yousef': 12,
  'rad': 13, 'ar-rad': 13,
  'ibrahim': 14,
  'hijr': 15, 'al-hijr': 15,
  'nahl': 16, 'an-nahl': 16,
  'isra': 17, 'al-isra': 17, 'bani-israil': 17,
  'kahf': 18, 'al-kahf': 18, 'alkahf': 18,
  'maryam': 19, 'mary': 19,
  'taha': 20, 'ta-ha': 20,
  'anbiya': 21, 'al-anbiya': 21,
  'hajj': 22, 'al-hajj': 22,
  'muminun': 23, 'al-muminun': 23,
  'nur': 24, 'an-nur': 24, 'noor': 24,
  'furqan': 25, 'al-furqan': 25,
  'shuara': 26, 'ash-shuara': 26,
  'naml': 27, 'an-naml': 27,
  'qasas': 28, 'al-qasas': 28,
  'ankabut': 29, 'al-ankabut': 29,
  'rum': 30, 'ar-rum': 30,
  'luqman': 31,
  'sajdah': 32, 'as-sajdah': 32,
  'ahzab': 33, 'al-ahzab': 33,
  'saba': 34,
   mefatir: 35, 'fatir': 35,
  'yasin': 36, 'yaseen': 36, 'ya-sin': 36,
  'saffat': 37, 'as-saffat': 37,
  'sad': 38,
  'zumar': 39, 'az-zumar': 39,
  'ghafir': 40, 'mumin': 40,
  'fussilat': 41,
  'shura': 42, 'ash-shura': 42,
  'zukhruf': 43, 'az-zukhruf': 43,
  'dukhan': 44, 'ad-dukhan': 44,
  'jathiyah': 45, 'al-jathiyah': 45,
  'ahqaf': 46, 'al-ahqaf': 46,
  'muhammad': 47,
  'fath': 48, 'al-fath': 48,
  'hujurat': 49, 'al-hujurat': 49,
  'qaf': 50,
  'dhariyat': 51, 'ad-dhariyat': 51,
  'tur': 52, 'at-tur': 52,
  'najm': 53, 'an-najm': 53,
  'qamar': 54, 'al-qamar': 54,
  'rahman': 55, 'ar-rahman': 55, 'ar-rahmaan': 55,
  'waqiah': 56, 'al-waqiah': 56, 'al-waqi\'a': 56,
  'hadid': 57, 'al-hadid': 57,
  'mujadila': 58, 'al-mujadila': 58,
  'hashr': 59, 'al-hashr': 59,
  'mumtahanah': 60, 'al-mumtahanah': 60,
  'saff': 61, 'as-saff': 61,
  'jumuah': 62, 'al-jumuah': 62, 'jummah': 62,
  'munafiqun': 63, 'al-munafiqun': 63,
  'taghabun': 64, 'at-taghabun': 64,
  'talaq': 65, 'at-talaq': 65,
  'tahrim': 66, 'at-tahrim': 66,
  'mulk': 67, 'al-mulk': 67, 'almulk': 67,
  'qalam': 68, 'al-qalam': 68,
  'haqqah': 69, 'al-haqqah': 69,
  'maarij': 70, 'al-maarij': 70,
  'nuh': 71, 'nooh': 71,
  'jinn': 72, 'al-jinn': 72,
  'muzzammil': 73, 'al-muzzammil': 73,
  'muddaththir': 74, 'al-muddaththir': 74,
  'qiyamah': 75, 'al-qiyamah': 75,
  'insan': 76, 'al-insan': 76, 'dahr': 76,
  'mursalat': 77, 'al-mursalat': 77,
  'naba': 78, 'an-naba': 78,
  'naziat': 79, 'an-naziat': 79,
  'abasa': 80,
  'takwir': 81, 'at-takwir': 81,
  'infitar': 82, 'al-infitar': 82,
  'mutaffifin': 83, 'al-mutaffifin': 83,
  'inshiqaq': 84, 'al-inshiqaq': 84,
  'buruj': 85, 'al-buruj': 85,
  'tariq': 86, 'at-tariq': 86,
  'ala': 87, 'al-ala': 87,
  'ghashiyah': 88, 'al-ghashiyah': 88,
  'fajr': 89, 'al-fajr': 89,
  'balad': 90, 'al-balad': 90,
  'shams': 91, 'ash-shams': 91,
  'layl': 92, 'al-layl': 92,
  'duha': 93, 'ad-duha': 93,
  'sharh': 94, 'ash-sharh': 94, 'inshirah': 94,
  'tin': 95, 'at-tin': 95,
  'alaq': 96, 'al-alaq': 96,
  'qadr': 97, 'al-qadr': 97,
  'bayyinah': 98, 'al-bayyinah': 98,
  'zalzalah': 99, 'az-zalzalah': 99, 'zilzal': 99,
  'adiyat': 100, 'al-adiyat': 100,
  'qariah': 101, 'al-qariah': 101,
  'takathur': 102, 'at-takathur': 102,
  'asr': 103, 'al-asr': 103,
  'humazah': 104, 'al-humazah': 104,
  'fil': 105, 'al-fil': 105,
  'quraysh': 106, 'quraish': 106,
  'maun': 107, 'al-maun': 107,
  'kawthar': 108, 'al-kawthar': 108, 'kauthar': 108,
  'kafirun': 109, 'al-kafirun': 109,
  'nasr': 110, 'an-nasr': 110,
  'masad': 111, 'al-masad': 111, 'lahab': 111,
  'ikhlas': 112, 'al-ikhlas': 112,
  'falaq': 113, 'al-falaq': 113,
  'nas': 114, 'an-nas': 114
};

function resolveSurahNumber(input) {
  if (!input) return null;
  const num = parseInt(input, 10);
  if (!isNaN(num) && num >= 1 && num <= 114) return num;

  const clean = input.toLowerCase().replace(/[^a-z0-9-]/g, '').trim();
  if (SURAH_MAP[clean]) return SURAH_MAP[clean];

  for (const [key, val] of Object.entries(SURAH_MAP)) {
    if (clean.includes(key) || key.includes(clean)) return val;
  }
  return null;
}

/**
 * .prayertimes <city> (alias .pts)
 */
export async function prayertimesCommand(sock, chat, msg, args) {
  const city = (args || []).join(' ').trim();
  if (!city) {
    return sendWithCta(sock, chat, `🕋 *Prayer Times*\n\n` +
      `*Usage:* \`.prayertimes <city_name>\` or \`.pts <city_name>\`\n` +
      `*Example:* \`.pts London\` or \`.prayertimes Makkah\``, { quoted: msg });
  }

  try {
    const url = `http://api.aladhan.com/v1/timingsByCity?city=${encodeURIComponent(city)}&country=`;
    const res = await fetch(url);
    const data = await res.json();

    if (data.code !== 200 || !data.data) {
      return sendWithCta(sock, chat, `❌ Could not fetch prayer times for *${city}*. Please check the city name.`, { quoted: msg });
    }

    const t = data.data.timings;
    const dateInfo = data.data.date;
    const meta = data.data.meta;

    const readableDate = dateInfo.readable || dateInfo.gregorian?.date || 'Today';
    const hijriDate = dateInfo.hijri ? `${dateInfo.hijri.day} ${dateInfo.hijri.month.en} ${dateInfo.hijri.year} AH` : '';
    const timezone = meta?.timezone || city;

    const reply = `┌──❮ 🕌 *PRAYER TIMES* ❯──
│ 📍 *Location:* ${city.toUpperCase()} (${timezone})
│ 📅 *Date:* ${readableDate}
│ 🌙 *Hijri:* ${hijriDate}
├───────────────────
│ 🌅 *Fajr:* ${t.Fajr}
│ ☀️ *Sunrise:* ${t.Sunrise}
│ ☀️ *Dhuhr:* ${t.Dhuhr}
│ 🌤️ *Asr:* ${t.Asr}
│ 🌅 *Maghrib:* ${t.Maghrib}
│ 🌙 *Isha:* ${t.Isha}
└───────────────────
Provided by 𝗪𝗥𝗔𝗜𝗧🇭`;

    await sendWithCta(sock, chat, reply, { quoted: msg });
  } catch (err) {
    console.error('[prayertimes] Error:', err);
    await sendWithCta(sock, chat, `❌ Error fetching prayer times: ${err.message}`, { quoted: msg });
  }
}

/**
 * .quran <surah:ayah> or <surah ayah>
 */
export async function quranCommand(sock, chat, msg, args) {
  const input = (args || []).join(' ').trim();
  if (!input) {
    return sendWithCta(sock, chat, `📖 *Quran Verse Lookup*\n\n` +
      `*Usage:* \`.quran <surah:ayah>\` or \`.quran <surah> <ayah>\`\n` +
      `*Examples:*\n` +
      `• \`.quran 11:24\`\n` +
      `• \`.quran 2 255\`\n` +
      `• \`.quran Yasin 1\``, { quoted: msg });
  }

  let surah = null;
  let ayah = null;

  if (input.includes(':')) {
    const parts = input.split(':');
    surah = resolveSurahNumber(parts[0].trim());
    ayah = parseInt(parts[1].trim(), 10);
  } else {
    const parts = input.split(/\s+/);
    if (parts.length >= 2) {
      surah = resolveSurahNumber(parts[0].trim());
      ayah = parseInt(parts[parts.length - 1].trim(), 10);
    }
  }

  if (!surah || isNaN(ayah) || ayah < 1) {
    return sendWithCta(sock, chat, `⚠️ *Invalid format or Surah name.*\n\nPlease use \`.quran <surah:ayah>\` (e.g. \`.quran 11:24\` or \`.quran Al-Baqarah 255\`).`, { quoted: msg });
  }

  try {
    const url = `https://api.alquran.cloud/v1/ayah/${surah}:${ayah}/editions/quran-uthmani,en.sahih`;
    const res = await fetch(url);
    const data = await res.json();

    if (data.code !== 200 || !data.data || data.data.length < 2) {
      return sendWithCta(sock, chat, `❌ Could not find verse *${surah}:${ayah}*. Please verify the Surah and Ayah number.`, { quoted: msg });
    }

    const arabicData = data.data[0];
    const englishData = data.data[1];

    const surahName = arabicData.surah.englishName;
    const surahTranslation = arabicData.surah.englishNameTranslation;

    const reply = `┌──❮ 📖 *HOLY QURAN* ❯──
│ 📌 *Surah:* ${surahName} (${surah}:${ayah})
│ 📑 *Meaning:* ${surahTranslation}
├───────────────────
│ 🕌 *Arabic:*
│ ${arabicData.text}
│
│ 🇬🇧 *English (Saheeh International):*
│ ${englishData.text}
└───────────────────
Provided by 𝗪𝗥𝗔𝗜𝗧🇭`;

    await sendWithCta(sock, chat, reply, { quoted: msg });
  } catch (err) {
    console.error('[quran] Error:', err);
    await sendWithCta(sock, chat, `❌ Error fetching Quran verse: ${err.message}`, { quoted: msg });
  }
}

/**
 * .sora <name_or_number>
 */
export async function soraCommand(sock, chat, msg, args) {
  const input = (args || []).join(' ').trim();
  if (!input) {
    return sendWithCta(sock, chat, `📖 *Full Surah Lookup*\n\n` +
      `*Usage:* \`.sora <surah_name_or_number>\`\n` +
      `*Examples:*\n` +
      `• \`.sora Al-Imran\`\n` +
      `• \`.sora 36\` or \`.sora Yasin\``, { quoted: msg });
  }

  const surahNum = resolveSurahNumber(input);
  if (!surahNum) {
    return sendWithCta(sock, chat, `⚠️ *Surah "${input}" not found.* Please provide a valid Surah name or number (1–114).`, { quoted: msg });
  }

  const paddedNum = String(surahNum).padStart(3, '0');

  // Fetch Surah metadata to get English / Arabic names
  let surahMeta = null;
  try {
    const metaRes = await fetch(`https://api.alquran.cloud/v1/surah/${surahNum}`);
    const metaData = await metaRes.json();
    if (metaData.code === 200 && metaData.data) {
      surahMeta = metaData.data;
    }
  } catch (e) {
    // Ignore metadata error
  }

  const surahTitle = surahMeta?.englishName || `Surah ${surahNum}`;
  const surahArabic = surahMeta?.name || '';
  const surahTrans = surahMeta?.englishNameTranslation ? ` (${surahMeta.englishNameTranslation})` : '';

  let surahFilename = null;
  try {
    const archiveMetaRes = await fetch(`https://archive.org/metadata/002SurahBaqarah`);
    const archiveMetaData = await archiveMetaRes.json();
    const pdfs = (archiveMetaData.files || []).filter(f => f.name.endsWith('.pdf') && !f.name.endsWith('_text.pdf'));
    const matchedFile = pdfs.find(f => f.name.startsWith(paddedNum));
    if (matchedFile) {
      surahFilename = matchedFile.name;
    }
  } catch (e) {
    // Ignore archive metadata error
  }

  if (!surahFilename) {
    return sendWithCta(sock, chat, `❌ Could not resolve document filename for Surah ${surahNum}.`, { quoted: msg });
  }

  const pdfUrl = `https://archive.org/download/002SurahBaqarah/${encodeURIComponent(surahFilename)}`;

  try {
    const pdfRes = await fetch(pdfUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (pdfRes.ok) {
      const arrayBuf = await pdfRes.arrayBuffer();
      const buffer = Buffer.from(arrayBuf);
      if (buffer.length > 1000) {
        const cleanName = surahFilename.replace(/[^a-zA-Z0-9._-]/g, '_');
        return await sock.sendMessage(chat, {
          document: buffer,
          fileName: cleanName,
          mimetype: 'application/pdf',
          caption: `📖 *Surah ${surahNum}: ${surahTitle}* ${surahArabic}${surahTrans}\n\nProvided by 𝗪𝗥𝗔𝗜𝗧🇭`
        }, { quoted: msg });
      }
    }
    return sendWithCta(sock, chat, `❌ Could not download PDF document for Surah ${surahNum}.`, { quoted: msg });
  } catch (err) {
    console.error('[sora] Error:', err);
    await sendWithCta(sock, chat, `❌ Error downloading Surah document: ${err.message}`, { quoted: msg });
  }
}

/**
 * .para <number> (1..30)
 */
export async function paraCommand(sock, chat, msg, args) {
  const numArg = (args || [])[0];
  const paraNum = parseInt(numArg, 10);

  if (isNaN(paraNum) || paraNum < 1 || paraNum > 30) {
    return sendWithCta(sock, chat, `📖 *Quran Para / Juz Lookup*\n\n` +
      `*Usage:* \`.para <number_1_to_30>\`\n` +
      `*Example:* \`.para 11\``, { quoted: msg });
  }

  const paddedPara = String(paraNum).padStart(2, '0');
  const pdfUrl = `https://archive.org/download/quran_para_no._1_to_30_aks/para_no._${paddedPara}_aks.pdf`;

  try {
    const pdfRes = await fetch(pdfUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (pdfRes.ok) {
      const arrayBuf = await pdfRes.arrayBuffer();
      const buffer = Buffer.from(arrayBuf);
      if (buffer.length > 1000) {
        return await sock.sendMessage(chat, {
          document: buffer,
          fileName: `Quran_Para_${paddedPara}.pdf`,
          mimetype: 'application/pdf',
          caption: `📖 *Quran Para / Juz ${paraNum} Document*\n\nProvided by 𝗪𝗥𝗔𝗜𝗧🇭`
        }, { quoted: msg });
      }
    }
    return sendWithCta(sock, chat, `❌ Could not download PDF document for Para ${paraNum}.`, { quoted: msg });
  } catch (err) {
    console.error('[para] Error:', err);
    await sendWithCta(sock, chat, `❌ Error downloading Para document: ${err.message}`, { quoted: msg });
  }
}

/**
 * Hadith Lookup Helper (Muslim & Bukhari)
 */
async function getHadith(editionKey, hadithNumber) {
  const araUrl = `https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1/editions/ara-${editionKey}.json`;
  const engUrl = `https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1/editions/eng-${editionKey}.json`;

  const [araRes, engRes] = await Promise.all([
    fetch(araUrl).then(r => r.json()),
    fetch(engUrl).then(r => r.json())
  ]);

  const targetNum = parseInt(hadithNumber, 10);

  const araMatch = araRes?.hadiths?.find(h => h.hadithnumber === targetNum || h.arabicnumber === targetNum);
  const engMatch = engRes?.hadiths?.find(h => h.hadithnumber === targetNum);

  return {
    arabic: araMatch?.text || null,
    english: engMatch?.text || null
  };
}

/**
 * .muslim <number>
 */
export async function muslimCommand(sock, chat, msg, args) {
  const num = (args || [])[0];
  if (!num || isNaN(parseInt(num, 10))) {
    return sendWithCta(sock, chat, `📜 *Sahih Muslim Hadith*\n\n` +
      `*Usage:* \`.muslim <hadith_number>\`\n` +
      `*Example:* \`.muslim 1\``, { quoted: msg });
  }

  try {
    const { arabic, english } = await getHadith('muslim', num);

    if (!arabic && !english) {
      return sendWithCta(sock, chat, `❌ Hadith #${num} not found in Sahih Muslim.`, { quoted: msg });
    }

    const reply = `┌──❮ 📜 *SAHIH MUSLIM* ❯──
│ 📌 *Hadith Number:* #${num}
├───────────────────
${arabic ? `│ 🕌 *Arabic:*\n│ ${arabic}\n│\n` : ''}${english ? `│ 🇬🇧 *English:*\n│ ${english}\n` : ''}└───────────────────
Provided by 𝗪𝗥𝗔𝗜𝗧🇭`;

    await sendWithCta(sock, chat, reply, { quoted: msg });
  } catch (err) {
    console.error('[muslim] Error:', err);
    await sendWithCta(sock, chat, `❌ Error fetching Hadith: ${err.message}`, { quoted: msg });
  }
}

/**
 * .bukhari <number>
 */
export async function bukhariCommand(sock, chat, msg, args) {
  const num = (args || [])[0];
  if (!num || isNaN(parseInt(num, 10))) {
    return sendWithCta(sock, chat, `📜 *Sahih Bukhari Hadith*\n\n` +
      `*Usage:* \`.bukhari <hadith_number>\`\n` +
      `*Example:* \`.bukhari 1\``, { quoted: msg });
  }

  try {
    const { arabic, english } = await getHadith('bukhari', num);

    if (!arabic && !english) {
      return sendWithCta(sock, chat, `❌ Hadith #${num} not found in Sahih Bukhari.`, { quoted: msg });
    }

    const reply = `┌──❮ 📜 *SAHIH BUKHARI* ❯──
│ 📌 *Hadith Number:* #${num}
├───────────────────
${arabic ? `│ 🕌 *Arabic:*\n│ ${arabic}\n│\n` : ''}${english ? `│ 🇬🇧 *English:*\n│ ${english}\n` : ''}└───────────────────
Provided by 𝗪𝗥𝗔𝗜𝗧🇭`;

    await sendWithCta(sock, chat, reply, { quoted: msg });
  } catch (err) {
    console.error('[bukhari] Error:', err);
    await sendWithCta(sock, chat, `❌ Error fetching Hadith: ${err.message}`, { quoted: msg });
  }
}

/**
 * .search quran <topic>
 */
export async function searchQuranCommand(sock, chat, msg, args) {
  const query = (args || []).join(' ').trim();
  if (!query) {
    return sendWithCta(sock, chat, `🔍 *Quran Topic Search*\n\n` +
      `*Usage:* \`.search quran <topic_or_keyword>\`\n` +
      `*Examples:*\n` +
      `• \`.search quran patience\`\n` +
      `• \`.search quran paradise\``, { quoted: msg });
  }

  try {
    const url = `https://api.alquran.cloud/v1/search/${encodeURIComponent(query)}/all/en.sahih`;
    const res = await fetch(url);
    const data = await res.json();

    if (data.code !== 200 || !data.data || !data.data.matches || data.data.matches.length === 0) {
      return sendWithCta(sock, chat, `❌ No Quranic verses found matching topic "*${query}*".`, { quoted: msg });
    }

    const matches = data.data.matches.slice(0, 5); // top 5 matches
    let reply = `┌──❮ 🔍 *QURAN SEARCH: ${query.toUpperCase()}* ❯──\n` +
      `│ 📊 *Total Matches Found:* ${data.data.count}\n` +
      `│ 📌 *Showing Top ${matches.length} Results:*\n` +
      `├───────────────────\n`;

    for (const m of matches) {
      reply += `📖 *${m.surah.englishName} (${m.surah.number}:${m.numberInSurah})*\n` +
        `"${m.text.trim()}"\n\n`;
    }

    reply += `└───────────────────\nProvided by 𝗪𝗥𝗔𝗜𝗧🇭`;

    await sendWithCta(sock, chat, reply, { quoted: msg });
  } catch (err) {
    console.error('[searchQuran] Error:', err);
    await sendWithCta(sock, chat, `❌ Error searching Quran: ${err.message}`, { quoted: msg });
  }
}
