// ─────────────────────────────────────────────
// WRAITH · lib/ephoto360.js
// Scraper / API helper for Ephoto360 photo text effects
// ─────────────────────────────────────────────
import { fetchBuffer } from './net.js';

export const EPHOTO_EFFECTS = {
  neon: { url: 'https://ephoto360.com/tao-hieu-ung-chu-neon-phat-sang-truc-tuyen-1033.html', dual: false },
  glitch: { url: 'https://ephoto360.com/tao-hieu-ung-chu-digital-glitch-truc-tuyen-1027.html', dual: false },
  '3dgold': { url: 'https://ephoto360.com/tao-hieu-ung-chu-3d-vang-kim-loai-sang-trong-1025.html', dual: false },
  marvel: { url: 'https://ephoto360.com/tao-logo-phong-cach-marvel-3D-939.html', dual: true },
  pornhub: { url: 'https://ephoto360.com/tao-logo-phong-cach-pornhub-612.html', dual: true },
  cyberpunk: { url: 'https://ephoto360.com/tao-hieu-ung-chu-phong-cach-cyberpunk-2077-835.html', dual: false },
  graffiti: { url: 'https://ephoto360.com/tao-hieu-ung-chu-graffiti-mau-sac-truc-tuyen-1012.html', dual: false },
  blackpink: { url: 'https://ephoto360.com/tao-logo-phong-cach-blackpink-online-628.html', dual: false },
  naruto: { url: 'https://ephoto360.com/tao-hieu-ung-chu-phong-cach-naruto-shippuden-809.html', dual: false },
  galaxy: { url: 'https://ephoto360.com/tao-hieu-ung-chu-thien-ha-galaxy-dep-mat-truc-tuyen-1008.html', dual: false },
  blood: { url: 'https://ephoto360.com/tao-hieu-ung-chu-mau-kinh-di-truc-tuyen-1015.html', dual: false },
  hologram: { url: 'https://ephoto360.com/tao-hieu-ung-chu-3d-hologram-phat-sang-truc-tuyen-1029.html', dual: false },
  matrix: { url: 'https://ephoto360.com/tao-hieu-ung-chu-ma-tran-truc-tuyen-1018.html', dual: false },
  slice: { url: 'https://ephoto360.com/tao-hieu-ung-chu-bi-cat-3d-doc-dao-truc-tuyen-1022.html', dual: false },
  luxury: { url: 'https://ephoto360.com/tao-hieu-ung-chu-ma-vang-sang-trong-3d-1024.html', dual: false },
  vintage: { url: 'https://ephoto360.com/tao-hieu-ung-chu-co-dien-vintage-online-1005.html', dual: false },
  lightglow: { url: 'https://ephoto360.com/tao-hieu-ung-chu-light-glow-truc-tuyen-1030.html', dual: false },
  sand: { url: 'https://ephoto360.com/tao-hieu-ung-chu-viet-tren-cat-truc-tuyen-1002.html', dual: false },
  water: { url: 'https://ephoto360.com/tao-hieu-ung-chu-nuoc-3d-truc-tuyen-1010.html', dual: false },
  fire: { url: 'https://ephoto360.com/tao-hieu-ung-chu-lua-3d-doc-dao-truc-tuyen-1007.html', dual: false },
  metallic: { url: 'https://ephoto360.com/tao-hieu-ung-chu-kim-loai-3d-sang-bong-1026.html', dual: false },
  space: { url: 'https://ephoto360.com/tao-hieu-ung-chu-vu-tru-3d-truc-tuyen-1009.html', dual: false },
  neonlight: { url: 'https://ephoto360.com/tao-hieu-ung-chu-den-neon-truc-tuyen-1032.html', dual: false },
  glowing: { url: 'https://ephoto360.com/tao-hieu-ung-chu-phat-sang-truc-tuyen-1031.html', dual: false },
  captainamerica: { url: 'https://ephoto360.com/tao-logo-phong-cach-captain-america-3D-938.html', dual: true },
  wall: { url: 'https://ephoto360.com/tao-hieu-ung-chu-khap-tren-tuong-da-1003.html', dual: false },
  paper: { url: 'https://ephoto360.com/tao-hieu-ung-chu-cat-giay-3d-truc-tuyen-1021.html', dual: false },
  circuit: { url: 'https://ephoto360.com/tao-hieu-ung-chu-mach-dien-tu-3d-1020.html', dual: false },
  neondevil: { url: 'https://ephoto360.com/tao-hieu-ung-chu-mat-quỷ-neon-truc-tuyen-1034.html', dual: false },
  dragon: { url: 'https://ephoto360.com/tao-hieu-ung-chu-rong-lua-3d-truc-tuyen-1006.html', dual: false }
};

export async function createEphotoImage(effectKey, text1, text2 = '') {
  const effect = EPHOTO_EFFECTS[effectKey];
  if (!effect) throw new Error(`Unknown effect key: ${effectKey}`);

  // Fallback to primary public API endpoints for Ephoto360 generation
  const encodedText1 = encodeURIComponent(text1);
  const encodedText2 = encodeURIComponent(text2);

  const apiEndpoints = [
    `https://api.lolhuman.xyz/api/ephoto360/${effectKey}?apikey=GataDios&text=${encodedText1}${effect.dual ? `&text2=${encodedText2}` : ''}`,
    `https://api.vhtear.com/ephoto360?link=${encodeURIComponent(effect.url)}&text=${encodedText1}${effect.dual ? `&text2=${encodedText2}` : ''}&apikey=apikey`,
    `https://zenzapis.xyz/api/ephoto/${effectKey}?text=${encodedText1}${effect.dual ? `&text2=${encodedText2}` : ''}&apikey=0000000000`,
    `https://api.caliph.biz.id/api/ephoto?url=${encodeURIComponent(effect.url)}&text=${encodedText1}${effect.dual ? `&text2=${encodedText2}` : ''}&apikey=caliphkey`
  ];

  for (const endpoint of apiEndpoints) {
    try {
      const buffer = await fetchBuffer(endpoint, { timeout: 15000 });
      if (buffer && buffer.length > 2048) return buffer;
    } catch {}
  }

  // Direct scraping implementation for ephoto360.com
  try {
    const pageRes = await fetch(effect.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
      }
    });
    const html = await pageRes.text();

    const tokenMatch = html.match(/id="token"\s+value="([^"]+)"/);
    const token = tokenMatch ? tokenMatch[1] : '';

    const buildServerMatch = html.match(/id="build_server"\s+value="([^"]+)"/);
    const buildServer = buildServerMatch ? buildServerMatch[1] : 'https://ephoto360.com';

    const buildServerIdMatch = html.match(/id="build_server_id"\s+value="([^"]+)"/);
    const buildServerId = buildServerIdMatch ? buildServerIdMatch[1] : '1';

    const formData = new URLSearchParams();
    formData.append('text[]', text1);
    if (effect.dual) {
      formData.append('text[]', text2);
    }
    formData.append('submit', 'Tạo ảnh');
    formData.append('token', token);
    formData.append('build_server', buildServer);
    formData.append('build_server_id', buildServerId);

    const submitRes = await fetch(`${buildServer}/effect/create-image`, {
      method: 'POST',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': effect.url
      },
      body: formData.toString()
    });

    const submitJson = await submitRes.json();
    if (submitJson && submitJson.image) {
      const imageUrl = submitJson.image.startsWith('http') ? submitJson.image : `${buildServer}${submitJson.image}`;
      const imgBuffer = await fetchBuffer(imageUrl, { timeout: 20000 });
      if (imgBuffer && imgBuffer.length > 1024) return imgBuffer;
    }
  } catch (scrapeErr) {
    console.error('[Ephoto360 scraper error]:', scrapeErr.message);
  }

  throw new Error('Could not generate Ephoto360 image. Please try again later.');
}
