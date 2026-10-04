import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { regionRect, SKIN_SIZE, type BodyPart, type Face, type PixelRect } from '../../src/player/avatar/blocky/layout';
import { faceCell, hexToRgb, paintSkin, shadeRgb, type PixelSheet, type Rgb } from '../../src/player/avatar/blocky/painter';
import {
  clearSkinTextures,
  getSkinTexture,
  skinCacheSize,
  skinKey,
} from '../../src/player/avatar/blocky/skin-texture';
import { defaultAvatar, EYE_STYLES, fillAvatar, HAIR_STYLES, type FilledAvatar } from '../../src/player/avatar/options';

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
