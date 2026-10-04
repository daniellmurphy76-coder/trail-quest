// Gentle palette adjustments for the Kenney models that stay in the game, shared by the preview and the real pass.
// A "color map" tweak works on a 512 px swatch texture (city kit); a "remap" swaps the few flat vertex colors
// of the nature-kit leftovers (tents, fences, bridge, path pieces).
import { s2l, l2s } from './lib.mjs';

// ---- HSL helpers (sRGB 0..1) ------------------------------------------------------------------------
export function rgb2hsl(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}
export function hsl2rgb(h, s, l) {
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
}

/**
 * City kit swatch adjustment: a little less saturated, greens pulled from mint toward leaf green, and a faint warm
 * cast on the cool greys. `c` is sRGB 0..1; returns sRGB 0..1.
 */
export function tuneCity(c) {
  let [h, s, l] = rgb2hsl(...c);
  s *= 0.9;
  if (h >= 100 && h <= 190) h -= (h - 100) * 0.4; // mint (150) -> about 130, still clearly a green wall
  let out = hsl2rgb(h, s, l);
  // faint warm cast, strongest on low-saturation (grey) swatches so the colored walls keep their identity
  const warm = 0.035 * (1 - Math.min(1, s * 2));
  out = [out[0] + warm * (1 - out[0]) * 0.8, out[1] + warm * (1 - out[1]) * 0.3, out[2] - warm * out[2] * 0.6];
  return out.map((v) => Math.min(1, Math.max(0, v)));
}

export const hexToS = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255].map((v) => v / 255);

/** Flat-color swaps for the nature-kit leftovers, keyed by file. Source colors are the kit's pastel peach/salmon/mint. */
export const KENNEY_REMAP = {
  // tents: salmon canvas becomes terracotta, peach poles and flaps become warm canvas tan
  tent: { ffc5a7: 0xeed3a0, f19398: 0xde7a40, e27f84: 0xb85c36 },
  // fences: pastel peach planks become weathered wood in the new bark range
  fence: { ffc5a7: 0xd99a5b, f2be9e: 0xc98a4e, e3af94: 0xb87843, dbab8e: 0xb07040 },
  // bridge: planks like the fences, the pale deck becomes a lighter plank tone
  bridge: { ffc5a7: 0xd99a5b, f2be9e: 0xc98a4e, ddf2f5: 0xe3b983 },
  // trail path pieces: dirt peach to warm earth, the mint verge to grass green
  path: { ffc5a7: 0xd9a76a, f2be9e: 0xcf9a5e, dbab8e: 0xbd8650, e3af94: 0xc89258, '73eddd': 0x6db03c, '70e6d6': 0x6db03c },
};
export const remapKey = (file) => {
  const n = file.toLowerCase();
  if (n.includes('tent')) return 'tent';
  if (n.includes('fence')) return 'fence';
  if (n.includes('bridge')) return 'bridge';
  if (n.includes('path') || n.includes('ground_path')) return 'path';
  return null;
};
export { s2l, l2s };
