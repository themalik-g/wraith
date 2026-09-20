// ─────────────────────────────────────────────
// WRAITH · lib/ephoto360.js
// Ephoto360 text effects helper using mumaker
// ─────────────────────────────────────────────
import mumaker from 'mumaker';
import { fetchBuffer } from './net.js';

export const EPHOTO_EFFECTS = {
  metallic: { url: 'https://en.ephoto360.com/impressive-decorative-3d-metal-text-effect-798.html', dual: false },
  ice: { url: 'https://en.ephoto360.com/ice-text-effect-online-101.html', dual: false },
  snow: { url: 'https://en.ephoto360.com/create-a-snow-3d-text-effect-free-online-621.html', dual: false },
  impressive: { url: 'https://en.ephoto360.com/create-3d-colorful-paint-text-effect-online-801.html', dual: false },
  matrix: { url: 'https://en.ephoto360.com/matrix-text-effect-154.html', dual: false },
  light: { url: 'https://en.ephoto360.com/light-text-effect-futuristic-technology-style-648.html', dual: false },
  neon: { url: 'https://en.ephoto360.com/create-colorful-neon-light-text-effects-online-797.html', dual: false },
  devil: { url: 'https://en.ephoto360.com/neon-devil-wings-text-effect-online-683.html', dual: false },
  purple: { url: 'https://en.ephoto360.com/purple-text-effect-online-100.html', dual: false },
  thunder: { url: 'https://en.ephoto360.com/thunder-text-effect-online-97.html', dual: false },
  leaves: { url: 'https://en.ephoto360.com/green-brush-text-effect-typography-maker-online-153.html', dual: false },
  '1917': { url: 'https://en.ephoto360.com/1917-style-text-effect-523.html', dual: false },
  arena: { url: 'https://en.ephoto360.com/create-cover-arena-of-valor-by-mastering-360.html', dual: false },
  hacker: { url: 'https://en.ephoto360.com/create-anonymous-hacker-avatars-cyan-neon-677.html', dual: false },
  sand: { url: 'https://en.ephoto360.com/write-names-and-messages-on-the-sand-online-582.html', dual: false },
  blackpink: { url: 'https://en.ephoto360.com/create-a-blackpink-style-logo-with-members-signatures-810.html', dual: false },
  glitch: { url: 'https://en.ephoto360.com/create-digital-glitch-text-effects-online-767.html', dual: false },
  fire: { url: 'https://en.ephoto360.com/flame-lettering-effect-372.html', dual: false },
  '3dgold': { url: 'https://en.ephoto360.com/create-a-3d-golden-metal-text-effect-802.html', dual: false },
  marvel: { url: 'https://en.ephoto360.com/create-a-marvel-studio-logo-style-text-effect-online-711.html', dual: true },
  pornhub: { url: 'https://en.ephoto360.com/create-pornhub-style-logos-online-free-549.html', dual: true },
  graffiti: { url: 'https://en.ephoto360.com/create-a-graffiti-text-effect-online-682.html', dual: false },
  naruto: { url: 'https://en.ephoto360.com/naruto-shippuden-logo-style-text-effect-online-808.html', dual: false },
  blood: { url: 'https://en.ephoto360.com/horror-blood-text-effect-online-784.html', dual: false },
  hologram: { url: 'https://en.ephoto360.com/create-3d-hologram-text-effects-online-768.html', dual: false },
  luxury: { url: 'https://en.ephoto360.com/luxury-gold-text-effect-208.html', dual: false },
  glowing: { url: 'https://en.ephoto360.com/create-glowing-neon-text-effects-online-794.html', dual: false },
  wall: { url: 'https://en.ephoto360.com/write-text-on-wet-glass-online-589.html', dual: false },
  circuit: { url: 'https://en.ephoto360.com/create-printed-circuit-board-text-effect-793.html', dual: false },
  neondevil: { url: 'https://en.ephoto360.com/neon-devil-wings-text-effect-online-683.html', dual: false },

  // Fixed & Expanded Effects
  dragon: { url: 'https://en.ephoto360.com/create-dragon-ball-style-text-effects-online-809.html', dual: false },
  space: { url: 'https://en.ephoto360.com/making-neon-light-text-effect-with-galaxy-style-521.html', dual: false },
  cyberpunk: { url: 'https://en.ephoto360.com/create-a-cyberpunk-light-effect-online-668.html', dual: false },
  galaxy: { url: 'https://en.ephoto360.com/create-galaxy-batman-text-effects-online-607.html', dual: false },
  vintage: { url: 'https://en.ephoto360.com/create-realistic-vintage-3d-light-bulb-608.html', dual: false },
  lightglow: { url: 'https://en.ephoto360.com/create-sunset-light-text-effects-online-807.html', dual: false },
  neonlight: { url: 'https://en.ephoto360.com/create-colorful-neon-light-text-effects-online-797.html', dual: false },
  captainamerica: { url: 'https://en.ephoto360.com/free-online-american-flag-3d-text-effect-generator-725.html', dual: false },
  comic: { url: 'https://en.ephoto360.com/create-online-3d-comic-style-text-effects-817.html', dual: false },
  titanium: { url: 'https://en.ephoto360.com/create-the-titanium-text-effect-to-introduce-iphone-15-812.html', dual: false },
  sunset: { url: 'https://en.ephoto360.com/create-sunset-light-text-effects-online-807.html', dual: false },
  balloon: { url: 'https://en.ephoto360.com/beautiful-3d-foil-balloon-effects-for-holidays-and-birthday-803.html', dual: false },
  silver: { url: 'https://en.ephoto360.com/create-glossy-silver-3d-text-effect-online-802.html', dual: false },
  paint: { url: 'https://en.ephoto360.com/create-3d-colorful-paint-text-effect-online-801.html', dual: false },
  xmas: { url: 'https://en.ephoto360.com/christmas-and-new-year-glittering-3d-golden-text-effect-794.html', dual: false },
  sparkle: { url: 'https://en.ephoto360.com/create-sparkles-3d-christmas-text-effect-online-727.html', dual: false },
  american: { url: 'https://en.ephoto360.com/free-online-american-flag-3d-text-effect-generator-725.html', dual: false },
  blueneon: { url: 'https://en.ephoto360.com/create-blue-neon-logo-online-507.html', dual: false },
  greenneon: { url: 'https://en.ephoto360.com/create-light-effects-green-neon-online-429.html', dual: false },
  goldletter: { url: 'https://en.ephoto360.com/write-gold-letters-online-285.html', dual: false },
  pubg: { url: 'https://en.ephoto360.com/lightning-pubg-video-logo-maker-online-615.html', dual: false },
  starwars: { url: 'https://en.ephoto360.com/create-a-star-wars-character-mascot-logo-online-707.html', dual: false },
  neonart: { url: 'https://en.ephoto360.com/create-multicolored-neon-light-signatures-591.html', dual: false },
  glitchneon: { url: 'https://en.ephoto360.com/create-impressive-neon-glitch-text-effects-online-768.html', dual: false },
};

export async function createEphotoImage(effectKey, text1, text2 = '') {
  const effect = EPHOTO_EFFECTS[effectKey];
  if (!effect) throw new Error(`Unknown effect key: ${effectKey}`);

  const payload = effect.dual ? [text1, text2 || 'WRAITH'] : text1;

  try {
    const res = await mumaker.ephoto(effect.url, payload);
    if (res && res.image) {
      const buffer = await fetchBuffer(res.image, { timeout: 20000 });
      if (buffer && buffer.length > 1024) return buffer;
    }
  } catch (err) {
    console.error(`[Ephoto360 mumaker error for ${effectKey}]:`, err.message);
  }

  throw new Error('Could not generate Ephoto360 image. Please try again later.');
}
