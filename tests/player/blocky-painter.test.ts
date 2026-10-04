import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { regionRect, SKIN_SIZE, type BodyPart, type Face, type PixelRect } from '../../src/player/avatar/blocky/layout';
import { blushColor, BROW_SHADE, browColor, faceCell, hexToRgb, paintSkin, shadeRgb, type PixelSheet, type Rgb } from '../../src/player/avatar/blocky/painter';
import {
  clearSkinTextures,
  getSkinTexture,
  skinCacheSize,
  skinKey,
} from '../../src/player/avatar/blocky/skin-texture';
import { defaultAvatar, EYE_STYLES, fillAvatar, HAIR_COLORS, HAIR_STYLES, SKIN_TONES, type FilledAvatar } from '../../src/player/avatar/options';

const look = (patch: Partial<FilledAvatar> = {}): FilledAvatar => fillAvatar({ ...defaultAvatar('wolf'), ...patch });

const INK = hexToRgb('#23262b');
const MOUTH = hexToRgb('#6b2f26');

/** The pixel at fraction (fx, fy) of a face. */
function at(sheet: PixelSheet, part: BodyPart, face: Face, fx: number, fy: number): Rgb {
  const r = regionRect(part, face, sheet.size);
  return sheet.at(r.x + Math.min(r.w - 1, Math.floor(fx * r.w)), r.y + Math.min(r.h - 1, Math.floor(fy * r.h)));
}

/** The pixel in the middle of a cell of the 16 x 16 face grid. */
function cell(sheet: PixelSheet, col: number, row: number, face: Face = 'front'): Rgb {
  const c = faceCell(regionRect('head', face, sheet.size), col, row);
  return sheet.at(c.x + Math.floor(c.w / 2), c.y + Math.floor(c.h / 2));
}

function count(sheet: PixelSheet, rect: PixelRect, want: Rgb): number {
  let n = 0;
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      const p = sheet.at(x, y);
      if (p[0] === want[0] && p[1] === want[1] && p[2] === want[2]) n++;
    }
  }
  return n;
}

const half = (rect: PixelRect, side: 'left' | 'right'): PixelRect => ({
  x: side === 'left' ? rect.x : rect.x + rect.w / 2,
  y: rect.y,
  w: rect.w / 2,
  h: rect.h,
});

describe('skin painter: colors', () => {
  const cfg = look({
    skin: '#a96e44',
    shirt: '#c63d34',
    legColor: '#1f3557',
    shoes: '#f2f2f2',
    hairColor: '#e6c36a',
    hairStyle: 'short',
    legs: 'shorts',
  });
  const sheet = paintSkin(cfg);
  const skin = hexToRgb('#a96e44');
  const shirt = hexToRgb('#c63d34');
  const legColor = hexToRgb('#1f3557');
  const shoes = hexToRgb('#f2f2f2');
  const hair = hexToRgb('#e6c36a');

  it('is a plain square RGBA buffer, fully opaque', () => {
    expect(sheet.size).toBe(SKIN_SIZE);
    expect(sheet.data).toBeInstanceOf(Uint8Array);
    expect(sheet.data.length).toBe(SKIN_SIZE * SKIN_SIZE * 4);
    let opaque = true;
    for (let i = 3; i < sheet.data.length; i += 4) opaque &&= sheet.data[i] === 255;
    expect(opaque).toBe(true);
  });

  it('paints the shirt on the torso and the sleeves, with a belt band in the leg color', () => {
    for (const face of ['front', 'back', 'left', 'right'] as const) {
      expect(at(sheet, 'torso', face, 0.5, 0.3)).toEqual(shirt);
      expect(at(sheet, 'torso', face, 0.5, 0.95)).toEqual(legColor);
    }
    for (const part of ['arm-left', 'arm-right'] as const) {
      for (const face of ['front', 'back', 'left', 'right'] as const) {
        expect(at(sheet, part, face, 0.5, 0.15), `${part}.${face} sleeve`).toEqual(shirt);
        expect(at(sheet, part, face, 0.5, 0.8), `${part}.${face} forearm`).toEqual(skin);
      }
    }
  });

  it('shorts: leg color at the top, bare skin below the hem, shoes at the bottom', () => {
    for (const part of ['leg-left', 'leg-right'] as const) {
      expect(at(sheet, part, 'front', 0.5, 0.2)).toEqual(legColor);
      expect(at(sheet, part, 'front', 0.5, 0.7)).toEqual(skin);
      expect(at(sheet, part, 'front', 0.5, 0.88)).toEqual(shoes);
      expect(at(sheet, part, 'back', 0.5, 0.88)).toEqual(shoes);
    }
  });

  it('pants: leg color all the way down to the shoes', () => {
    const pants = paintSkin(look({ skin: '#a96e44', legColor: '#1f3557', shoes: '#f2f2f2', legs: 'pants' }));
    for (const part of ['leg-left', 'leg-right'] as const) {
      expect(at(pants, part, 'front', 0.5, 0.2)).toEqual(legColor);
      expect(at(pants, part, 'front', 0.5, 0.7)).toEqual(legColor);
      expect(at(pants, part, 'front', 0.5, 0.88)).toEqual(shoes);
    }
  });

  it('skort paints the legs exactly like shorts (the flared skirt is a mesh)', () => {
    const shorts = paintSkin(look({ legs: 'shorts' }));
    const skort = paintSkin(look({ legs: 'skort' }));
    expect(Buffer.compare(Buffer.from(shorts.data), Buffer.from(skort.data))).toBe(0);
  });

  it('skin tone covers the head, the neck and the hands; shoe soles are darker than the shoes', () => {
    expect(at(sheet, 'head', 'front', 0.5, 0.45)).toEqual(skin);
    expect(at(sheet, 'head', 'bottom', 0.5, 0.5)).toEqual(skin);
    expect(at(sheet, 'torso', 'top', 0.5, 0.5)).toEqual(skin);
    const sole = at(sheet, 'leg-left', 'front', 0.5, 0.98);
    expect(sole[0]).toBeLessThan(shoes[0]);
    expect(at(sheet, 'leg-left', 'bottom', 0.5, 0.5)).toEqual(shadeRgb(shoes, 0.6));
  });

  it('puts hair color on the top, the back and the fringe of the head', () => {
    expect(at(sheet, 'head', 'top', 0.5, 0.5)).toEqual(hair);
    expect(at(sheet, 'head', 'back', 0.5, 0.2)).toEqual(hair);
    expect(cell(sheet, 8, 0)).toEqual(hair); // fringe
    expect(cell(sheet, 8, 1)).toEqual(hair);
    expect(cell(sheet, 8, 2)).toEqual(skin); // forehead
    // The back five columns of each side face are hair; the picture-right edge of the +x face is the back.
    expect(cell(sheet, 14, 6, 'left')).toEqual(hair);
    expect(cell(sheet, 1, 6, 'right')).toEqual(hair);
    expect(cell(sheet, 1, 6, 'left')).toEqual(skin);
  });

  it('hair style none stays bald (no hair color anywhere on the head); buzz is a thin cap', () => {
    const bald = paintSkin(look({ skin: '#a96e44', hairColor: '#e6c36a', hairStyle: 'none' }));
    for (const face of ['top', 'back', 'front', 'left', 'right'] as const) {
      expect(count(bald, regionRect('head', face), hair), face).toBe(0);
    }
    const buzz = paintSkin(look({ skin: '#a96e44', hairColor: '#e6c36a', hairStyle: 'buzz' }));
    expect(at(buzz, 'head', 'top', 0.5, 0.5)).toEqual(hair);
    expect(cell(buzz, 8, 0)).toEqual(hair);
    expect(cell(buzz, 8, 1)).toEqual(skin);
    expect(cell(buzz, 8, 5, 'back')).toEqual(skin);
    expect(count(buzz, regionRect('head', 'back'), hair)).toBeGreaterThan(0);
  });

  it('every hair style paints without throwing, and styles with hair meshes paint the same fringe', () => {
    const sheets = HAIR_STYLES.map((c) => paintSkin(look({ hairStyle: c.value })));
    expect(sheets).toHaveLength(HAIR_STYLES.length);
    const keyOf = (s: PixelSheet): string => Buffer.from(s.data).toString('base64');
    const long = keyOf(paintSkin(look({ hairStyle: 'long' })));
    expect(keyOf(paintSkin(look({ hairStyle: 'curly' })))).toBe(long);
    expect(keyOf(paintSkin(look({ hairStyle: 'none' })))).not.toBe(long);
    expect(keyOf(paintSkin(look({ hairStyle: 'buzz' })))).not.toBe(long);
  });

  it('margins match the face next to them, so an edge sample never picks up a neighbor', () => {
    const r = regionRect('torso', 'front');
    expect(sheet.at(r.x - 1, r.y + 20)).toEqual(shirt);
    expect(sheet.at(r.x + r.w, r.y + 20)).toEqual(shirt);
    expect(sheet.at(r.x + 20, r.y - 1)).toEqual(shirt);
    // The belt band runs into the margin below the face too.
    expect(sheet.at(r.x + 20, r.y + r.h)).toEqual(legColor);
    const arm = regionRect('arm-left', 'front');
    expect(sheet.at(arm.x + 10, arm.y + arm.h)).toEqual(skin); // below the hand
    expect(sheet.at(arm.x + 10, arm.y - 1)).toEqual(shirt); // above the shoulder
  });

  it('a different config paints different pixels in the right places only', () => {
    const other = paintSkin(look({ skin: '#a96e44', shirt: '#567a3a', legColor: '#1f3557', shoes: '#f2f2f2', hairColor: '#e6c36a', hairStyle: 'short' }));
    expect(at(other, 'torso', 'front', 0.5, 0.3)).toEqual(hexToRgb('#567a3a'));
    expect(at(other, 'head', 'front', 0.5, 0.45)).toEqual(skin);
    expect(at(other, 'leg-left', 'front', 0.5, 0.2)).toEqual(legColor);
  });

  it('is deterministic', () => {
    expect(Buffer.compare(Buffer.from(paintSkin(cfg).data), Buffer.from(sheet.data))).toBe(0);
  });

  it('hexToRgb reads #rrggbb and shows a bad color as magenta', () => {
    expect(hexToRgb('#ffd646')).toEqual([255, 214, 70]);
    expect(hexToRgb('#000000')).toEqual([0, 0, 0]);
    expect(hexToRgb('nope')).toEqual([255, 0, 255]);
    expect(shadeRgb([200, 100, 50], 0.5)).toEqual([100, 50, 25]);
    expect(shadeRgb([200, 100, 50], 3)).toEqual([255, 255, 150]);
  });
});

describe('skin painter: the face', () => {
  const front = regionRect('head', 'front');
  const faceFor = (eyes: FilledAvatar['eyes']): PixelSheet => paintSkin(look({ eyes, skin: '#efbf99', hairStyle: 'none' }));
  const ink = (s: PixelSheet, area: PixelRect = front): number => count(s, area, INK);

  it('draws eyes in ink, a mouth, and keeps them on the face', () => {
    for (const style of EYE_STYLES) {
      const s = faceFor(style.value);
      expect(ink(s), style.value).toBeGreaterThan(20);
      expect(count(s, front, MOUTH), `${style.value} mouth`).toBeGreaterThan(5);
      // No ink on the sides, the back or the top: the eyes belong to the front only.
      for (const face of ['left', 'right', 'back', 'top', 'bottom'] as const) expect(ink(s, regionRect('head', face)), `${style.value} ${face}`).toBe(0);
    }
  });

  it('round eyes are a matching pair, 4 cells wide, with a white glint', () => {
    const s = faceFor('round');
    const l = ink(s, half(front, 'left'));
    const r = ink(s, half(front, 'right'));
    expect(l).toBe(r);
    expect(cell(s, 4, 8)).toEqual(INK);
    expect(cell(s, 10, 8)).toEqual(INK);
    expect(cell(s, 1, 1)).toEqual(hexToRgb('#efbf99'));
    expect(count(s, front, [255, 255, 255])).toBeGreaterThan(0);
  });

  it('happy eyes are closed arcs: fewer ink pixels than round', () => {
    expect(ink(faceFor('happy'))).toBeLessThan(ink(faceFor('round')));
    expect(cell(faceFor('happy'), 4, 7)).toEqual(INK);
    expect(cell(faceFor('happy'), 4, 9)).toEqual(hexToRgb('#efbf99'));
  });

  it('wink closes one eye only: the character\'s left is the picture\'s right half', () => {
    const s = faceFor('wink');
    expect(ink(s, half(front, 'left'))).toBeGreaterThan(ink(s, half(front, 'right')));
    expect(ink(s, half(front, 'right'))).toBeGreaterThan(0);
    // Same open eye as the round look on the picture-left.
    expect(ink(s, half(front, 'left'))).toBe(ink(faceFor('round'), half(front, 'left')));
  });

  it('star eyes are bigger than round eyes and a pair', () => {
    const s = faceFor('star');
    expect(ink(s, half(front, 'left'))).toBe(ink(s, half(front, 'right')));
    expect(ink(s)).toBeGreaterThan(ink(faceFor('happy')));
  });

  it('every face pixel is a crisp cell: cells are 4 pixels at the default size', () => {
    const c = faceCell(front, 3, 6);
    expect([c.w, c.h]).toEqual([4, 4]);
    const wide = faceCell(front, 5, 12, 6, 2);
    expect([wide.w, wide.h]).toEqual([24, 8]);
  });
});

describe('skin painter: brows, cheeks and a nose', () => {
  const front = regionRect('head', 'front');
  const skinHex = '#efbf99';
  const skin = hexToRgb(skinHex);
  const withFace = (patch: Partial<FilledAvatar> = {}): PixelSheet =>
    paintSkin(look({ skin: skinHex, eyes: 'round', hairStyle: 'short', hairColor: '#3f78d0', ...patch }));
  const same = (a: Rgb, b: Rgb): boolean => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
  const luma = (c: Rgb): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const distance = (a: Rgb, b: Rgb): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  /** Hue in degrees, 0 to 360: red is 0, orange 30, pink 330 to 350. */
  const hue = ([r, g, b]: Rgb): number => {
    const mx = Math.max(r, g, b);
    const d = mx - Math.min(r, g, b);
    if (d === 0) return 0;
    const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return (h * 60 + 360) % 360;
  };

  /** The three cells of each brow, as [col, row] pairs: the screen-left brow, then the screen-right brow. */
  const browCells = (leftRow: number, rightRow: number): Array<[number, number]> => [
    ...[3, 4, 5].map((c): [number, number] => [c, leftRow]),
    ...[10, 11, 12].map((c): [number, number] => [c, rightRow]),
  ];
  /** Brow row (screen-left, screen-right) for each eye style. */
  const BROW_ROWS: Record<FilledAvatar['eyes'], [number, number]> = { round: [4, 4], happy: [3, 3], wink: [3, 4], star: [4, 4] };

  describe('brows', () => {
    it.each(EYE_STYLES.map((s) => s.value))('%s: one cell tall, three wide over each eye, in a darker shade of the hair', (eyes) => {
      const hair = hexToRgb('#3f78d0');
      const brow = shadeRgb(hair, BROW_SHADE);
      expect(luma(brow)).toBeLessThan(luma(hair));
      expect(same(browColor('short', hair), brow)).toBe(true);
      const s = withFace({ eyes });
      const [leftRow, rightRow] = BROW_ROWS[eyes];
      for (const [col, row] of browCells(leftRow, rightRow)) {
        expect(cell(s, col, row), `${eyes} brow at ${col},${row}`).toEqual(brow);
        expect(cell(s, col, row - 1), `${eyes} above ${col},${row}`).not.toEqual(brow);
        expect(cell(s, col, row + 1), `${eyes} below ${col},${row}`).not.toEqual(brow);
      }
      // Three wide: the cell next to each end is plain skin.
      for (const col of [2, 6, 9, 13]) expect(cell(s, col, leftRow)).not.toEqual(brow);
      expect(count(s, front, brow)).toBe(6 * 16); // six cells, 4 x 4 pixels each
    });

    it.each(EYE_STYLES.map((s) => s.value))('%s: sit clear of the eyes and the fringe', (eyes) => {
      const s = withFace({ eyes });
      const [leftRow, rightRow] = BROW_ROWS[eyes];
      // The fringe is rows 0 and 1; the eyes start on row 6 (round, star) or row 7 (happy).
      expect(Math.min(leftRow, rightRow)).toBeGreaterThan(1);
      for (const [col, row] of browCells(leftRow, rightRow)) {
        expect(cell(s, col, row)).not.toEqual(INK);
        expect(cell(s, col, row + 1), 'a clear row under the brow').not.toEqual(INK);
      }
    });

    it('are level for round and star, raised for happy, and one raised for wink', () => {
      expect(BROW_ROWS.round[0]).toBe(BROW_ROWS.round[1]);
      expect(BROW_ROWS.star).toEqual(BROW_ROWS.round);
      expect(BROW_ROWS.happy[0]).toBe(BROW_ROWS.happy[1]);
      expect(BROW_ROWS.happy[0]).toBeLessThan(BROW_ROWS.round[0]); // a smaller row number is higher on the face
      expect(BROW_ROWS.wink[0]).not.toBe(BROW_ROWS.wink[1]);
      // The painter agrees with the table above: the wink's open eye (screen-left) has the raised brow.
      const brow = shadeRgb(hexToRgb('#3f78d0'), BROW_SHADE);
      const s = withFace({ eyes: 'wink' });
      expect(cell(s, 4, 3)).toEqual(brow);
      expect(cell(s, 4, 4)).toEqual(skin);
      expect(cell(s, 11, 4)).toEqual(brow);
      expect(cell(s, 11, 3)).toEqual(skin);
    });

    it('are the same pair on both sides: mirror images about the middle of the face', () => {
      for (const eyes of ['round', 'happy', 'star'] as const) {
        const s = withFace({ eyes });
        const brow = shadeRgb(hexToRgb('#3f78d0'), BROW_SHADE);
        for (const col of [3, 4, 5]) {
          expect(cell(s, col, BROW_ROWS[eyes][0])).toEqual(brow);
          expect(cell(s, 15 - col, BROW_ROWS[eyes][1])).toEqual(brow);
        }
      }
    });

    it('take their color from the hair: every hair color gives a darker, matching brow', () => {
      for (const c of HAIR_COLORS) {
        const hair = hexToRgb(c.value);
        const s = withFace({ hairColor: c.value, eyes: 'round' });
        const brow = cell(s, 4, 4);
        expect(brow, c.label).toEqual(shadeRgb(hair, BROW_SHADE));
        expect(luma(brow), c.label).toBeLessThan(luma(hair));
        // Same hue family as the hair (a darker shade, not a new color), apart from near-black and gray hair.
        if (Math.max(...hair) - Math.min(...hair) > 40) expect(Math.abs(hue(brow) - hue(hair)), c.label).toBeLessThan(6);
      }
    });

    it('are ink when there is no hair to match: bald and buzz, whatever the hair color', () => {
      for (const hairStyle of ['none', 'buzz'] as const) {
        for (const eyes of EYE_STYLES.map((s) => s.value)) {
          const s = withFace({ hairStyle, eyes, hairColor: '#e6c36a' });
          const [leftRow, rightRow] = BROW_ROWS[eyes];
          for (const [col, row] of browCells(leftRow, rightRow)) expect(cell(s, col, row), `${hairStyle} ${eyes}`).toEqual(INK);
        }
        expect(same(browColor(hairStyle, hexToRgb('#e6c36a')), INK)).toBe(true);
      }
    });

    it('every hair style with hair paints the same brows', () => {
      const reference = cell(withFace({ hairStyle: 'short' }), 4, 4);
      for (const hairStyle of ['short', 'spiky', 'curly', 'long', 'ponytail', 'braids'] as const) {
        expect(cell(withFace({ hairStyle }), 4, 4), hairStyle).toEqual(reference);
      }
    });

    it('stay on the front of the head', () => {
      const s = withFace({ eyes: 'round' });
      const brow = shadeRgb(hexToRgb('#3f78d0'), BROW_SHADE);
      for (const face of ['left', 'right', 'back', 'top', 'bottom'] as const) expect(count(s, regionRect('head', face), brow), face).toBe(0);
    });
  });

  describe('cheeks', () => {
    const cheekCells: Array<[number, number]> = [[3, 11], [4, 11], [11, 11], [12, 11]];

    it('are two cells on each side under the eyes, and nothing else on the face is blush', () => {
      const s = withFace();
      const blush = blushColor(skin);
      for (const [col, row] of cheekCells) expect(cell(s, col, row)).toEqual(blush);
      for (const [col, row] of [[2, 11], [5, 11], [10, 11], [13, 11], [3, 10], [4, 12], [11, 10], [12, 12]] as const) {
        expect(cell(s, col, row), `${col},${row}`).not.toEqual(blush);
      }
      expect(count(s, front, blush)).toBe(4 * 16);
    });

    it.each(SKIN_TONES.map((t) => [t.label, t.value] as const))('%s: a different color from the skin, but only a small step from it', (_label, hex) => {
      const base = hexToRgb(hex);
      const blush = blushColor(base);
      const s = withFace({ skin: hex });
      for (const [col, row] of cheekCells) expect(cell(s, col, row)).toEqual(blush);
      expect(same(blush, base)).toBe(false);
      // Visible (well apart from the skin) yet subtle (nowhere near the pure red it is pulled toward).
      expect(distance(blush, base)).toBeGreaterThan(25);
      expect(distance(blush, base)).toBeLessThan(55);
      // Never more than halfway to the red it is pulled toward (the 1 is for rounding to whole bytes).
      expect(distance(blush, hexToRgb('#cd4632'))).toBeGreaterThanOrEqual(distance(blush, base) - 1);
    });

    it.each(SKIN_TONES.map((t) => [t.label, t.value] as const))('%s: is warmer and redder than the skin, never pink', (_label, hex) => {
      const base = hexToRgb(hex);
      const blush = blushColor(base);
      expect(blush[0] - blush[1]).toBeGreaterThan(base[0] - base[1]); // redder
      expect(blush[1]).toBeGreaterThan(blush[2]); // green over blue: orange-red, not pink or magenta
      expect(hue(blush)).toBeGreaterThan(0);
      expect(hue(blush)).toBeLessThan(35); // pink sits around 330 to 350
      expect(Math.abs(hue(blush) - hue(base))).toBeLessThan(20); // a warm version of the same skin
    });

    it('is not one pink pasted on every skin: each tone gets its own blush', () => {
      const blushes = SKIN_TONES.map((t) => blushColor(hexToRgb(t.value)).join(','));
      expect(new Set(blushes).size).toBe(SKIN_TONES.length);
      // Lighter skin gives a lighter cheek.
      const lumas = SKIN_TONES.map((t) => luma(blushColor(hexToRgb(t.value))));
      for (let i = 1; i < lumas.length; i++) expect(lumas[i]!).toBeLessThan(lumas[i - 1]!);
    });

    it('never touch the eyes, whichever style', () => {
      for (const style of EYE_STYLES) {
        const s = withFace({ eyes: style.value });
        for (const [col, row] of cheekCells) expect(cell(s, col, row), `${style.value} ${col},${row}`).not.toEqual(INK);
      }
    });
  });

  describe('nose', () => {
    it.each(SKIN_TONES.map((t) => [t.label, t.value] as const))('%s: two cells in a darker shade of the skin, between the eyes', (_label, hex) => {
      const base = hexToRgb(hex);
      const s = withFace({ skin: hex });
      const nose = shadeRgb(base, 0.8);
      expect(luma(nose)).toBeLessThan(luma(base));
      expect(cell(s, 7, 10)).toEqual(nose);
      expect(cell(s, 8, 10)).toEqual(nose);
      // Just those two: skin on both sides, above and below.
      for (const [col, row] of [[6, 10], [9, 10], [7, 9], [8, 9], [7, 11], [8, 11]] as const) expect(cell(s, col, row), `${col},${row}`).toEqual(base);
      expect(count(s, front, nose)).toBe(2 * 16);
    });

    it('sits in the middle columns and about halfway between the eyes and the mouth, for every eye style', () => {
      const nose = shadeRgb(skin, 0.8);
      const rowsOf = (s: PixelSheet, col: number, want: Rgb): number[] => Array.from({ length: 16 }, (_, r) => r).filter((r) => same(cell(s, col, r), want));
      for (const style of EYE_STYLES) {
        const s = withFace({ eyes: style.value });
        const eyeBottom = Math.max(...Array.from({ length: 16 }, (_, c) => c).flatMap((c) => rowsOf(s, c, INK)));
        const mouthTop = Math.min(...Array.from({ length: 6 }, (_, i) => i + 5).flatMap((c) => rowsOf(s, c, MOUTH)));
        const noseRows = rowsOf(s, 7, nose);
        expect(noseRows, style.value).toHaveLength(1);
        expect(rowsOf(s, 8, nose), style.value).toEqual(noseRows); // columns 7 and 8 mirror each other about the face's middle
        expect(noseRows[0]!, style.value).toBeGreaterThanOrEqual(eyeBottom);
        expect(noseRows[0]!, style.value).toBeLessThan(mouthTop);
        expect(Math.abs(noseRows[0]! - (eyeBottom + mouthTop) / 2), style.value).toBeLessThanOrEqual(1);
      }
    });

    it('is darker than the skin around it by a step you can see, but not as dark as the ink', () => {
      for (const t of SKIN_TONES) {
        const base = hexToRgb(t.value);
        const nose = shadeRgb(base, 0.8);
        expect(luma(base) - luma(nose)).toBeGreaterThan(luma(base) * 0.15);
        expect(luma(nose)).toBeGreaterThan(luma(INK));
      }
    });
  });

  it('the eyes keep their look: dark, with no white of the eye, and one white glint on round eyes', () => {
    const s = withFace({ eyes: 'round' });
    expect(count(s, front, [255, 255, 255])).toBe(2 * 16); // one cell of glint per eye, nothing else white
    expect(cell(s, 4, 7)).toEqual([255, 255, 255]);
    expect(cell(s, 4, 8)).toEqual(INK);
    for (const eyes of ['happy', 'wink', 'star'] as const) {
      expect(count(withFace({ eyes }), front, [255, 255, 255]), eyes).toBe(eyes === 'wink' ? 16 : 0);
    }
  });
});

describe('skin texture: a Three.js texture from the painted sheet, cached by look', () => {
  it('is a DataTexture in sRGB, nearest on magnify, the size of the sheet', () => {
    clearSkinTextures();
    const tex = getSkinTexture(look());
    expect(tex).toBeInstanceOf(THREE.DataTexture);
    expect(tex.image.width).toBe(SKIN_SIZE);
    expect(tex.image.height).toBe(SKIN_SIZE);
    expect(tex.magFilter).toBe(THREE.NearestFilter);
    expect(tex.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(tex.flipY).toBe(false);
    expect(tex.wrapS).toBe(THREE.ClampToEdgeWrapping);
  });

  it('gives back the same texture for the same look, and for looks that differ only in meshes', () => {
    clearSkinTextures();
    const base = look();
    const tex = getSkinTexture(base);
    expect(getSkinTexture(look())).toBe(tex);
    const meshOnly = look({ hat: 'cap', hatColor: '#c63d34', glasses: true, backpack: true, build: 'tall', neckerchief: '#000000', hairStyle: 'spiky', legs: 'skort' });
    expect(skinKey(meshOnly)).toBe(skinKey(base));
    expect(getSkinTexture(meshOnly)).toBe(tex);
    expect(skinCacheSize()).toBe(1);
  });

  it('makes a new texture when paint changes: skin, eyes, hair color, shirt, leg color, shoes, pants', () => {
    clearSkinTextures();
    const base = look();
    const tex = getSkinTexture(base);
    const changes: Array<Partial<FilledAvatar>> = [
      { skin: '#4d2f1e' },
      { eyes: 'star' },
      { hairColor: '#3f78d0' },
      { hairStyle: 'none' },
      { shirt: '#7a56b8' },
      { legColor: '#c9a877' },
      { shoes: '#c63d34' },
      { legs: 'pants' },
    ];
    // (compare with ===: a failing `expect` on a texture would try to print a megabyte of pixels)
    for (const change of changes) expect(getSkinTexture(look(change)) === tex, JSON.stringify(change)).toBe(false);
    expect(skinCacheSize()).toBe(changes.length + 1);
  });

  it('keeps only the newest textures and frees the ones that fall out', () => {
    clearSkinTextures();
    const first = getSkinTexture(look({ skin: '#101010' }));
    let freed = 0;
    first.addEventListener('dispose', () => freed++);
    for (let i = 0; i < 20; i++) getSkinTexture(look({ skin: `#${(0x202020 + i).toString(16)}` }));
    expect(skinCacheSize()).toBeLessThanOrEqual(16);
    expect(freed).toBe(1);
    // A re-use refreshes a texture, so it is the one that survives.
    clearSkinTextures();
    const keep = getSkinTexture(look({ skin: '#303030' }));
    for (let i = 0; i < 12; i++) getSkinTexture(look({ skin: `#${(0x404040 + i).toString(16)}` }));
    getSkinTexture(look({ skin: '#303030' }));
    for (let i = 0; i < 8; i++) getSkinTexture(look({ skin: `#${(0x505050 + i).toString(16)}` }));
    expect(getSkinTexture(look({ skin: '#303030' }))).toBe(keep);
  });

  it('clearSkinTextures empties the cache', () => {
    getSkinTexture(look());
    clearSkinTextures();
    expect(skinCacheSize()).toBe(0);
  });
});
