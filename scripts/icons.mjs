// Generates the Trail Quest app icons as PNG files, with no dependencies.
//
// Usage:   node scripts/icons.mjs
//          (add "icons": "node scripts/icons.mjs" to package.json to run it as `npm run icons`)
//
// Writes into public/icons/:
//   icon-192.png            192x192  rounded green square, transparent corners (manifest, purpose "any")
//   icon-512.png            512x512  same, larger (manifest, purpose "any")
//   apple-touch-icon.png    180x180  full-bleed and opaque (iOS adds its own rounded corners)
//   maskable-512.png        512x512  full-bleed, with the mark inside the central 80% circle so any
//                                    Android mask shape can crop it (manifest, purpose "maskable")
//
// The mark is original artwork: a wooden signpost with two plank signs on a forest-green square,
// the same picture as public/favicon.svg. It is drawn here by a tiny signed-distance-field
// rasterizer (rounded rectangles and polygons, filled and stroked, anti-aliased) and written as
// RGBA or RGB PNG using zlib.deflateSync plus a hand-written CRC32. The output is deterministic:
// running it twice produces byte-identical files.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import zlib from 'node:zlib';

// ---- Palette (matches public/favicon.svg) ---------------------------------------------------------

const GREEN = [0x2f, 0x6b, 0x3a];
const POST = [0x7b, 0x52, 0x30];
const PLANK = [0xe8, 0xc2, 0x7a];
const OUTLINE = [0x5a, 0x3b, 0x1e];

// ---- Signed distance functions (unit space: a 64 x 64 square) -------------------------------------
// Each returns the distance from (x, y) to the shape's edge: negative inside, positive outside.

/** A rounded rectangle with its top-left corner at (x, y). */
function sdRoundRect(px, py, x, y, w, h, r) {
  const qx = Math.abs(px - (x + w / 2)) - (w / 2 - r);
  const qy = Math.abs(py - (y + h / 2)) - (h / 2 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

/** A simple polygon given as [[x, y], ...]. */
function sdPolygon(px, py, pts) {
  let d = (px - pts[0][0]) ** 2 + (py - pts[0][1]) ** 2;
  let sign = 1;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[j];
    const ex = bx - ax;
    const ey = by - ay;
    const wx = px - ax;
    const wy = py - ay;
    const t = Math.min(Math.max((wx * ex + wy * ey) / (ex * ex + ey * ey), 0), 1);
    const dx = wx - ex * t;
    const dy = wy - ey * t;
    d = Math.min(d, dx * dx + dy * dy);
    const c1 = py >= ay;
    const c2 = py < by;
    const c3 = ex * wy > ey * wx;
    if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) sign = -sign;
  }
  return sign * Math.sqrt(d);
}

// ---- The mark, as a list of layers (unit space) ---------------------------------------------------

const BOARD_RIGHT = [
  [35, 14],
  [52, 14],
  [57, 20],
  [52, 26],
  [35, 26],
];
const BOARD_LEFT = [
  [29, 30],
  [12, 30],
  [7, 36],
  [12, 42],
  [29, 42],
];
const STROKE = 2;

/** Layers painted bottom to top. `d` is the distance function, `color` the paint. */
const MARK = [
  { d: (x, y) => sdRoundRect(x, y, 29, 12, 6, 44, 2), color: POST },
  { d: (x, y) => sdPolygon(x, y, BOARD_RIGHT), color: PLANK },
  { d: (x, y) => Math.abs(sdPolygon(x, y, BOARD_RIGHT)) - STROKE / 2, color: OUTLINE },
  { d: (x, y) => sdPolygon(x, y, BOARD_LEFT), color: PLANK },
  { d: (x, y) => Math.abs(sdPolygon(x, y, BOARD_LEFT)) - STROKE / 2, color: OUTLINE },
  { d: (x, y) => sdRoundRect(x, y, 22, 54, 20, 4, 2), color: OUTLINE },
];
/** Middle of the mark's bounding box (y only matters), so it can be centred for the full-bleed icons. */
const MARK_CENTER = [32, 35];

// ---- Rasterizer ------------------------------------------------------------------------------------

/**
 * Draws one icon into a Float64 RGBA buffer (non-premultiplied, 0..255) and returns it as bytes.
 *
 * @param size      pixels per side
 * @param rounded   true for the rounded square with transparent corners, false for full-bleed
 * @param markScale 1 draws the mark as in the favicon; smaller shrinks it about the centre
 */
function render(size, { rounded, markScale }) {
  const px = new Float64Array(size * size * 4);
  const unitsPerPixel = 64 / size;

  /** Paint `color` over pixel `i` with `coverage` (0..1). */
  function over(i, color, coverage) {
    if (coverage <= 0) return;
    const da = px[i + 3] / 255;
    const outA = coverage + da * (1 - coverage);
    for (let c = 0; c < 3; c++) {
      px[i + c] = (color[c] * coverage + px[i + c] * da * (1 - coverage)) / outA;
    }
    px[i + 3] = outA * 255;
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      // Pixel centre in the 64-unit canvas.
      const ux = (x + 0.5) * unitsPerPixel;
      const uy = (y + 0.5) * unitsPerPixel;

      // Background. Distance is converted to pixels (x1 / unitsPerPixel) for the anti-aliasing ramp.
      const bg = rounded ? sdRoundRect(ux, uy, 0, 0, 64, 64, 12) : -1;
      over(i, GREEN, clamp01(0.5 - bg / unitsPerPixel));

      // The mark, mapped from canvas space into mark space. At scale 1 it sits exactly where it does in
      // the favicon; at other scales it is shrunk about the canvas centre and its own middle is moved there.
      const mx = (ux - 32) / markScale + 32;
      const my = (uy - 32) / markScale + 32 + (markScale === 1 ? 0 : MARK_CENTER[1] - 32);
      for (const layer of MARK) {
        // Distance in mark units times markScale is distance in canvas units.
        const dist = layer.d(mx, my) * markScale;
        over(i, layer.color, clamp01(0.5 - dist / unitsPerPixel));
      }
    }
  }

  const bytes = new Uint8Array(size * size * 4);
  for (let i = 0; i < px.length; i++) bytes[i] = Math.round(px[i]);
  return bytes;
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// ---- PNG encoder ------------------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC32 (the PNG flavour) of a byte array. */
export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), 8 + data.length);
  return out;
}

/**
 * Encodes RGBA bytes as a PNG. With `opaque` true the alpha channel is dropped and the file is
 * written as 8-bit RGB (colour type 2); otherwise as 8-bit RGBA (colour type 6).
 */
export function encodePng(rgba, size, { opaque = false } = {}) {
  const channels = opaque ? 3 : 4;
  const stride = size * channels;
  const raw = Buffer.alloc((stride + 1) * size); // each row starts with filter type 0 (None)
  for (let y = 0; y < size; y++) {
    const row = y * (stride + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x++) {
      const src = (y * size + x) * 4;
      const dst = row + 1 + x * channels;
      raw[dst] = rgba[src];
      raw[dst + 1] = rgba[src + 1];
      raw[dst + 2] = rgba[src + 2];
      if (!opaque) raw[dst + 3] = rgba[src + 3];
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0); // width
  header.writeUInt32BE(size, 4); // height
  header[8] = 8; // bit depth
  header[9] = opaque ? 2 : 6; // colour type
  header[10] = 0; // compression
  header[11] = 0; // filter
  header[12] = 0; // interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- The icon set -----------------------------------------------------------------------------------

/** File name, pixel size, and how to draw it. */
export const ICONS = [
  { file: 'icon-192.png', size: 192, rounded: true, markScale: 1, opaque: false },
  { file: 'icon-512.png', size: 512, rounded: true, markScale: 1, opaque: false },
  // iOS rounds the corners itself and paints transparent pixels black, so this one is full-bleed.
  { file: 'apple-touch-icon.png', size: 180, rounded: false, markScale: 0.92, opaque: true },
  // Android may crop to any shape; the mark stays inside the central circle (80% of the width).
  { file: 'maskable-512.png', size: 512, rounded: false, markScale: 0.8, opaque: true },
];

/** Renders every icon in memory: a list of { file, png }. */
export function renderIcons() {
  return ICONS.map(({ file, size, rounded, markScale, opaque }) => ({
    file,
    png: encodePng(render(size, { rounded, markScale }), size, { opaque }),
  }));
}

function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const outDir = path.join(root, 'public', 'icons');
  fs.mkdirSync(outDir, { recursive: true });
  for (const { file, png } of renderIcons()) {
    fs.writeFileSync(path.join(outDir, file), png);
    console.log(`public/icons/${file}  ${png.length} bytes`);
  }
}

// Run only when started from the command line, so tests can import the helpers.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
