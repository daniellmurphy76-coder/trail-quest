/**
 * The skin layout of Kenney's Blocky Characters: where each face of each body part sits on the skin texture.
 * Pure data and arithmetic: no Three.js, no DOM, so the painter and the tests can use it anywhere.
 *
 * The kit draws every skin on a 1024 x 1024 sheet (a Minecraft-style cross unwrap) and every one of its 18
 * skins shares the same UVs, so one table covers them all. The table below is the UV box of each face read
 * from public/assets/characters/blocky.glb (dev/assets/build-blocky-glb.mjs makes that file); a test reads
 * the GLB again and checks every number.
 *
 * Names follow the character, not the viewer: `left` is the character's left (+x, the side the `arm-left`
 * and `leg-left` nodes sit on), `front` is +z (where the face goes), `top` is +y.
 *
 * Orientation of every face, so a painter can draw upright pictures:
 *  - side faces (front, back, left, right): upright, u grows toward the viewer's right as the viewer
 *    looks at the face from outside, v grows downward;
 *  - top: the top of the picture points to the back of the character (-z);
 *  - bottom: the top of the picture points to the front (+z).
 * Faces of the head touch each other (left | front | right run side by side), so a texel on a shared edge
 * belongs to both faces. Painters should fill a one-texel margin around each face with its base color.
 */

export const BODY_PARTS = ['head', 'torso', 'arm-left', 'arm-right', 'leg-left', 'leg-right'] as const;
export type BodyPart = (typeof BODY_PARTS)[number];

export const FACES = ['front', 'back', 'left', 'right', 'top', 'bottom'] as const;
export type Face = (typeof FACES)[number];

/** `head.front`, `torso.left`, `arm-right.top`... */
export type RegionName = `${BodyPart}.${Face}`;

/** The size of the kit's own skin sheets, in pixels. The numbers in `KIT_RECTS` are in this space. */
export const KIT_SIZE = 1024;

/**
 * The size we paint at. The kit's unit is 1024 / 7 pixels and the model's parts are all multiples of 0.1
 * units, so at 560 pixels every part is a whole number of pixels (80 per unit, so 8 per tenth: the head is
 * 64 x 64, a leg 32 x 80) and the 16 x 16 face grid has 4-pixel cells.
 */
export const SKIN_SIZE = 560;

/** A face box on the kit's 1024 sheet: [left, top, right, bottom] in pixels. */
export type KitRect = readonly [x0: number, y0: number, x1: number, y1: number];

export const KIT_RECTS: Readonly<Record<BodyPart, Readonly<Record<Face, KitRect>>>> = {
  head: {
    front: [134.1, 132.4, 251.1, 249.5],
    back: [389.1, 132.3, 506.2, 249.4],
    left: [250.7, 132.4, 367.8, 249.4],
    right: [18.3, 132.4, 135.4, 249.5],
    top: [133.4, 5.8, 250.4, 122.8],
    bottom: [132.9, 257.3, 250, 374.4],
  },
  torso: {
    front: [101.4, 790, 218.5, 921.6],
    back: [325.7, 790, 442.7, 921.7],
    left: [228.1, 790, 315.9, 921.6],
    right: [4.5, 790, 92.3, 921.6],
    top: [101.7, 692.5, 218.7, 780.3],
    bottom: [101.1, 933.1, 218.1, 1020.9],
  },
  'arm-left': {
    front: [835.2, 602.6, 893.8, 763.6],
    back: [963.1, 602.7, 1021.6, 763.6],
    left: [899.1, 602.7, 957.6, 763.6],
    right: [770.9, 602.6, 829.4, 763.5],
    top: [771, 537.2, 829.5, 595.7],
    bottom: [834.7, 536.6, 893.2, 595.1],
  },
  'arm-right': {
    front: [547.1, 602.6, 605.6, 763.5],
    back: [675.3, 602.6, 733.8, 763.5],
    left: [611.2, 602.6, 669.7, 763.5],
    right: [482.6, 602.6, 541.1, 763.5],
    top: [482.6, 537.4, 541.1, 595.9],
    bottom: [546.2, 536.8, 604.8, 595.3],
  },
  'leg-left': {
    front: [835, 870.6, 893.5, 1016.9],
    back: [962.5, 870.6, 1021, 1016.9],
    left: [898.7, 870.6, 957.2, 1016.9],
    right: [771, 870.6, 829.5, 1016.9],
    top: [770.8, 802.6, 829.3, 861.2],
    bottom: [834.8, 803.3, 893.3, 861.8],
  },
  'leg-right': {
    front: [546.9, 870.7, 605.5, 1016.9],
    back: [675, 870.6, 733.5, 1016.9],
    left: [611, 870.7, 669.5, 1017],
    right: [483.1, 870.6, 541.6, 1016.9],
    top: [482.8, 803.2, 541.3, 861.7],
    bottom: [546.5, 803, 605, 861.5],
  },
};

/** Size of each part in the kit's units (width, height, depth), for anyone who needs the proportions. */
export const PART_SIZE: Readonly<Record<BodyPart, readonly [w: number, h: number, d: number]>> = {
  head: [0.8, 0.8, 0.8],
  torso: [0.8, 0.9, 0.6],
  'arm-left': [0.4, 1.1, 0.4],
  'arm-right': [0.4, 1.1, 0.4],
  'leg-left': [0.4, 1, 0.4],
  'leg-right': [0.4, 1, 0.4],
};

/** A box of whole pixels, `x, y` the top-left corner. */
export interface PixelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Both ends rounded to the nearest pixel, so a face that is 64 pixels wide stays 64 wide. */
export function kitRectToPixels(rect: KitRect, size = SKIN_SIZE): PixelRect {
  const k = size / KIT_SIZE;
  const x0 = Math.round(rect[0] * k);
  const y0 = Math.round(rect[1] * k);
  return { x: x0, y: y0, w: Math.round(rect[2] * k) - x0, h: Math.round(rect[3] * k) - y0 };
}

/** The pixel rectangle of one face on a skin sheet `size` pixels square. */
export function regionRect(part: BodyPart, face: Face, size = SKIN_SIZE): PixelRect {
  return kitRectToPixels(KIT_RECTS[part][face], size);
}

/** Every region (6 parts x 6 faces = 36) as pixel rectangles. */
export function regionRects(size = SKIN_SIZE): Record<RegionName, PixelRect> {
  const out = {} as Record<RegionName, PixelRect>;
  for (const part of BODY_PARTS) for (const face of FACES) out[`${part}.${face}`] = regionRect(part, face, size);
  return out;
}

/** A rectangle grown by `by` pixels on every side (for the base-color margin), kept inside the sheet. */
export function grow(rect: PixelRect, by: number, size = SKIN_SIZE): PixelRect {
  const x0 = Math.max(0, rect.x - by);
  const y0 = Math.max(0, rect.y - by);
  const x1 = Math.min(size, rect.x + rect.w + by);
  const y1 = Math.min(size, rect.y + rect.h + by);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
