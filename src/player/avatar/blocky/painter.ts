/**
 * Paints a Scout's skin sheet from an `AvatarConfig`: skin tone, face, hair color on the head, shirt, legs and
 * shoes, laid out on Kenney's Blocky skin layout (see layout.ts). Pure: it fills a plain RGBA pixel buffer, so
 * it runs in Node and in the browser the same way, and a test can read any pixel back. `skin-texture.ts` turns
 * the buffer into a Three.js texture.
 *
 * The look is flat color with a few pixel-art touches (a 16 x 16 face grid, a hem line on the sleeves and
 * legs, a belt band, a sole line on the shoes). Everything that sticks out (hair shapes, hats, glasses, the
 * neckerchief, the backpack, the skirt) is a separate mesh built in attachments.ts.
 *
 * Painting happens in two passes. First every face gets its base color, grown by one pixel so a sample on the
 * very edge of a face never picks up a neighbor. Then the details go on inside each face's exact rectangle.
 */
import type { FilledAvatar } from '../options';
import { BODY_PARTS, FACES, grow, regionRect, SKIN_SIZE, type BodyPart, type Face, type PixelRect } from './layout';

export type Rgb = readonly [r: number, g: number, b: number];

const HEX = /^#([0-9a-f]{6})$/i;

/** `#rrggbb` to bytes. Anything else comes back as magenta, so a bad color is loud rather than invisible. */
export function hexToRgb(hex: string): Rgb {
  const m = HEX.exec(hex.trim());
  if (!m) return [255, 0, 255];
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** `rgb` scaled by `factor` (under 1 darkens, over 1 lightens), clamped to bytes. */
export function shadeRgb(rgb: Rgb, factor: number): Rgb {
  const c = (v: number): number => Math.max(0, Math.min(255, Math.round(v * factor)));
  return [c(rgb[0]), c(rgb[1]), c(rgb[2])];
}

/** Bytes in memory order r, g, b, a read as one 32-bit number: which end the red byte is on depends on the machine. */
const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
const pack = (c: Rgb): number => (LITTLE_ENDIAN ? (255 << 24) | (c[2] << 16) | (c[1] << 8) | c[0] : (c[0] << 24) | (c[1] << 16) | (c[2] << 8) | 255) >>> 0;

/** A square RGBA sheet of bytes. Row 0 is the top row (the glTF convention: v = 0 is the top). */
export class PixelSheet {
  readonly size: number;
  readonly data: Uint8Array;
  private readonly words: Uint32Array;

  constructor(size: number, background: Rgb = [0, 0, 0]) {
    this.size = size;
    this.data = new Uint8Array(size * size * 4);
    this.words = new Uint32Array(this.data.buffer);
    this.fill({ x: 0, y: 0, w: size, h: size }, background);
  }

  /** Fill `rect` with `color`, clipped to the sheet and (when given) to `clip`. */
  fill(rect: PixelRect, color: Rgb, clip?: PixelRect): void {
    let x0 = Math.max(0, rect.x);
    let y0 = Math.max(0, rect.y);
    let x1 = Math.min(this.size, rect.x + rect.w);
    let y1 = Math.min(this.size, rect.y + rect.h);
    if (clip) {
      x0 = Math.max(x0, clip.x);
      y0 = Math.max(y0, clip.y);
      x1 = Math.min(x1, clip.x + clip.w);
      y1 = Math.min(y1, clip.y + clip.h);
    }
    if (x1 <= x0) return;
    const word = pack(color);
    for (let y = y0; y < y1; y++) this.words.fill(word, y * this.size + x0, y * this.size + x1);
  }

  /** The color at one pixel. */
  at(x: number, y: number): Rgb {
    const i = (y * this.size + x) * 4;
    return [this.data[i]!, this.data[i + 1]!, this.data[i + 2]!];
  }
}

// ---- the face -------------------------------------------------------------------------------------

const INK = hexToRgb('#23262b');
const WHITE = hexToRgb('#ffffff');
const MOUTH = hexToRgb('#6b2f26');

/** Pixel art for the eyes. `#` is ink, `w` is a white glint, `.` is skin. One string per row. */
export const EYE_ART: Readonly<Record<'round' | 'happy' | 'star', { rows: readonly string[]; dy: number }>> = {
  round: { rows: ['.##.', '#w##', '####', '.##.'], dy: 0 },
  happy: { rows: ['.##.', '#..#'], dy: 1 },
  star: { rows: ['..#..', '.###.', '#####', '.###.', '.#.#.'], dy: 0 },
};

/** Where the eyes sit on the 16 x 16 face grid: the left edge of the screen-left and screen-right eye, and the top row. */
const EYE_COLS = {
  round: [3, 9],
  happy: [3, 9],
  star: [2, 9],
} as const;
const EYE_TOP = 6;

const MOUTH_ART = ['#....#', '.####.'] as const;
const MOUTH_COL = 5;
const MOUTH_ROW = 12;

const FACE_GRID = 16;

/** One cell of the 16 x 16 face grid as a pixel rectangle. */
export function faceCell(face: PixelRect, col: number, row: number, cols = 1, rows = 1): PixelRect {
  const x0 = face.x + Math.round((col / FACE_GRID) * face.w);
  const y0 = face.y + Math.round((row / FACE_GRID) * face.h);
  const x1 = face.x + Math.round(((col + cols) / FACE_GRID) * face.w);
  const y1 = face.y + Math.round(((row + rows) / FACE_GRID) * face.h);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function art(sheet: PixelSheet, face: PixelRect, rows: readonly string[], col: number, row: number, ink: Rgb): void {
  rows.forEach((line, dy) => {
    [...line].forEach((ch, dx) => {
      if (ch === '#') sheet.fill(faceCell(face, col + dx, row + dy), ink, face);
      else if (ch === 'w') sheet.fill(faceCell(face, col + dx, row + dy), WHITE, face);
    });
  });
}

function paintEyes(sheet: PixelSheet, face: PixelRect, style: FilledAvatar['eyes']): void {
  // On the front picture, image-right is the character's left (+x). A wink closes that eye.
  const open = style === 'happy' ? 'happy' : style === 'star' ? 'star' : 'round';
  const [leftCol, rightCol] = EYE_COLS[open];
  const draw = (kind: 'round' | 'happy' | 'star', col: number): void =>
    art(sheet, face, EYE_ART[kind].rows, col, EYE_TOP + EYE_ART[kind].dy, INK);
  if (style === 'wink') {
    draw('round', EYE_COLS.round[0]);
    draw('happy', EYE_COLS.happy[1]);
    return;
  }
  draw(open, leftCol);
  draw(open, rightCol);
}

// ---- helpers --------------------------------------------------------------------------------------

/**
 * Rows of `rect` from `from` to `to`, counted in tenths of the part's height (`hTenths` of them in all), and one
 * pixel wider on each side. The first band also takes the margin above the face and the last the margin below it,
 * so the margin rows match the band next to them.
 */
function rows(rect: PixelRect, from: number, to: number, hTenths: number): PixelRect {
  const y0 = rect.y + Math.round((from / hTenths) * rect.h) - (from === 0 ? 1 : 0);
  const y1 = rect.y + Math.round((to / hTenths) * rect.h) + (to === hTenths ? 1 : 0);
  return { x: rect.x - 1, y: y0, w: rect.w + 2, h: y1 - y0 };
}
const SIDES: readonly Face[] = ['front', 'back', 'left', 'right'];


// ---- the whole sheet ------------------------------------------------------------------------------

/** Paint the skin sheet for a look. `size` is the sheet's width and height in pixels. */
export function paintSkin(config: FilledAvatar, size = SKIN_SIZE): PixelSheet {
  const skin = hexToRgb(config.skin);
  const shirt = hexToRgb(config.shirt);
  const legColor = hexToRgb(config.legColor);
  const shoes = hexToRgb(config.shoes);
  const hair = hexToRgb(config.hairColor);
  const sheet = new PixelSheet(size, skin);
  const rect = (part: BodyPart, face: Face): PixelRect => regionRect(part, face, size);
  const base = (part: BodyPart, face: Face, color: Rgb): void => sheet.fill(grow(rect(part, face), 1, size), color);

  // Pass 1: base colors, with a one-pixel margin.
  for (const part of BODY_PARTS) for (const face of FACES) base(part, face, skin);
  for (const face of FACES) {
    base('torso', face, shirt);
    for (const part of ['arm-left', 'arm-right'] as const) base(part, face, face === 'bottom' ? skin : shirt);
    for (const part of ['leg-left', 'leg-right'] as const) base(part, face, face === 'bottom' ? shadeRgb(shoes, 0.6) : legColor);
  }
  base('torso', 'top', skin); // the neck, hidden under the neckerchief
  base('torso', 'bottom', legColor);

  // Pass 2: details, inside each face.
  const hem = (hex: Rgb): Rgb => shadeRgb(hex, 0.82);

  // Torso: a belt band at the waist.
  for (const face of SIDES) sheet.fill(rows(rect('torso', face), 7.5, 9, 9), legColor);

  // Arms: a short sleeve, a hem line, then bare forearm and hand.
  for (const part of ['arm-left', 'arm-right'] as const) {
    for (const face of SIDES) {
      const r = rect(part, face);
      sheet.fill(rows(r, 5, 11, 11), skin);
      sheet.fill(rows(r, 4.4, 5, 11), hem(shirt));
    }
  }

  // Legs: shorts or long pants, bare shin, shoes with a sole line.
  const pants = config.legs === 'pants';
  const kneeEnd = pants ? 8.5 : 5;
  for (const part of ['leg-left', 'leg-right'] as const) {
    for (const face of SIDES) {
      const r = rect(part, face);
      if (!pants) sheet.fill(rows(r, 5, 8.5, 10), skin);
      sheet.fill(rows(r, kneeEnd - 0.6, kneeEnd, 10), hem(legColor));
      sheet.fill(rows(r, 8.5, 10, 10), shoes);
      sheet.fill(rows(r, 9.5, 10, 10), shadeRgb(shoes, 0.6));
    }
  }

  paintHead(sheet, config, skin, hair, size);
  return sheet;
}

function paintHead(sheet: PixelSheet, config: FilledAvatar, skin: Rgb, hair: Rgb, size: number): void {
  const rect = (face: Face): PixelRect => regionRect('head', face, size);
  const style = config.hairStyle;
  const haired = style !== 'none';
  const buzz = style === 'buzz';
  const earColor = shadeRgb(skin, 0.88);

  if (haired) sheet.fill(grow(rect('top'), 1, size), hair);

  // Back of the head.
  if (haired) {
    const back = rect('back');
    sheet.fill(grow(faceCell(back, 0, 0, 16, buzz ? 3 : 10), 1, size), hair, grow(back, 1, size));
  }

  // Sides: hair on top and toward the back, and an ear.
  for (const face of ['left', 'right'] as const) {
    const r = rect(face);
    if (haired) {
      sheet.fill(grow(faceCell(r, 0, 0, 16, buzz ? 2 : 4), 1, size), hair, grow(r, 1, size));
      if (!buzz) {
        // On the left face (+x) the picture's right edge is the back of the head; on the right face it is the front.
        const backCol = face === 'left' ? 11 : 0;
        sheet.fill(grow(faceCell(r, backCol, 0, 5, 10), 1, size), hair, grow(r, 1, size));
      }
    }
    sheet.fill(faceCell(r, 7, 7, 3, 3), earColor, r);
  }

  // Front: fringe, eyes, nose and mouth.
  const front = rect('front');
  if (haired) sheet.fill(grow(faceCell(front, 0, 0, 16, buzz ? 1 : 2), 1, size), hair, grow(front, 1, size));
  paintEyes(sheet, front, config.eyes);
  sheet.fill(faceCell(front, 7, 10, 2, 1), shadeRgb(skin, 0.88), front);
  art(sheet, front, MOUTH_ART, MOUTH_COL, MOUTH_ROW, MOUTH);
}
