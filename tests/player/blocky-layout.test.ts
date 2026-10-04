import { describe, expect, it } from 'vitest';
import {
  BODY_PARTS,
  FACES,
  KIT_RECTS,
  KIT_SIZE,
  SKIN_SIZE,
  grow,
  kitRectToPixels,
  regionRect,
  regionRects,
  type BodyPart,
  type Face,
} from '../../src/player/avatar/blocky/layout';
import { floats, readGlb } from './model-file';

describe('skin layout: pixel rectangles for every body region', () => {
  const rects = regionRects();

  it('has all 36 regions (6 parts x 6 faces), each a real box inside the sheet', () => {
    expect(Object.keys(rects)).toHaveLength(36);
    for (const part of BODY_PARTS) {
      for (const face of FACES) {
        const r = rects[`${part}.${face}`];
        expect(r, `${part}.${face}`).toBeDefined();
        for (const v of [r.x, r.y, r.w, r.h]) expect(Number.isInteger(v)).toBe(true);
        expect(r.w).toBeGreaterThan(0);
        expect(r.h).toBeGreaterThan(0);
        expect(r.x).toBeGreaterThanOrEqual(0);
        expect(r.y).toBeGreaterThanOrEqual(0);
        expect(r.x + r.w).toBeLessThanOrEqual(SKIN_SIZE);
        expect(r.y + r.h).toBeLessThanOrEqual(SKIN_SIZE);
      }
    }
  });

  it('every face is a whole number of tenths of the part, 8 pixels to a tenth at 560', () => {
    const size = (part: BodyPart, face: Face): [number, number] => {
      const r = regionRect(part, face);
      return [r.w, r.h];
    };
    for (const face of ['front', 'back'] as const) {
      expect(size('head', face)).toEqual([64, 64]);
      expect(size('torso', face)).toEqual([64, 72]);
      expect(size('arm-left', face)).toEqual([32, 88]);
      expect(size('leg-right', face)).toEqual([32, 80]);
    }
    for (const face of ['left', 'right'] as const) {
      expect(size('head', face)).toEqual([64, 64]);
      expect(size('torso', face)).toEqual([48, 72]);
      expect(size('arm-right', face)).toEqual([32, 88]);
      expect(size('leg-left', face)).toEqual([32, 80]);
    }
    for (const face of ['top', 'bottom'] as const) {
      expect(size('head', face)).toEqual([64, 64]);
      expect(size('torso', face)).toEqual([64, 48]);
      expect(size('arm-left', face)).toEqual([32, 32]);
      expect(size('leg-left', face)).toEqual([32, 32]);
    }
  });

  it('puts the head faces where the kit does: right | front | left side by side, back apart', () => {
    const at = (f: Face): ReturnType<typeof regionRect> => regionRect('head', f);
    const front = at('front');
    const left = at('left');
    const right = at('right');
    const back = at('back');
    // On the sheet the character's right side is picture-left (the kit unwraps it as seen from the front).
    expect(right.x).toBeLessThan(front.x);
    expect(left.x).toBeGreaterThan(front.x);
    expect(Math.abs(right.x + right.w - front.x)).toBeLessThanOrEqual(2);
    expect(Math.abs(front.x + front.w - left.x)).toBeLessThanOrEqual(2);
    expect(back.x).toBeGreaterThan(left.x + left.w);
    for (const f of [front, left, right, back]) expect(f.y).toBe(front.y);
    expect(at('top').y + at('top').h).toBeLessThanOrEqual(front.y + 2);
    expect(at('bottom').y).toBeGreaterThan(front.y + front.h);
  });

  it("no two parts share a pixel, and a part's own faces overlap only along a head seam", () => {
    const all = BODY_PARTS.flatMap((part) => FACES.map((face) => ({ part, face, r: regionRect(part, face) })));
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i]!;
        const b = all[j]!;
        const ox = Math.min(a.r.x + a.r.w, b.r.x + b.r.w) - Math.max(a.r.x, b.r.x);
        const oy = Math.min(a.r.y + a.r.h, b.r.y + b.r.h) - Math.max(a.r.y, b.r.y);
        const overlap = ox > 0 && oy > 0 ? ox * oy : 0;
        // The head's left, front and right faces touch; a shared texel column or two is the most that is allowed.
        const seam = a.part === 'head' && b.part === 'head' && ox <= 2;
        if (!seam) expect(overlap, `${a.part}.${a.face} / ${b.part}.${b.face}`).toBe(0);
      }
    }
  });

  it('scales with the sheet size: the same layout at 1024 is the kit rectangle itself', () => {
    const front = regionRect('head', 'front', KIT_SIZE);
    expect(front).toEqual({ x: 134, y: 132, w: 117, h: 118 });
    expect(kitRectToPixels(KIT_RECTS.torso.front, KIT_SIZE).w).toBeGreaterThanOrEqual(117);
    expect(Math.abs(regionRects(256)['leg-left.front'].w - 58.5 / 4)).toBeLessThan(1);
  });

  it('grow adds a margin and stays on the sheet', () => {
    expect(grow({ x: 10, y: 10, w: 4, h: 4 }, 1)).toEqual({ x: 9, y: 9, w: 6, h: 6 });
    expect(grow({ x: 0, y: 0, w: 4, h: 4 }, 1)).toEqual({ x: 0, y: 0, w: 5, h: 5 });
    expect(grow({ x: SKIN_SIZE - 4, y: SKIN_SIZE - 4, w: 4, h: 4 }, 3)).toEqual({ x: SKIN_SIZE - 7, y: SKIN_SIZE - 7, w: 7, h: 7 });
  });
});

describe('skin layout: matches the UVs in the shipped model file', () => {
  const glb = readGlb();
  const FACE_OF: Record<string, Face> = { 'x+': 'left', 'x-': 'right', 'y+': 'top', 'y-': 'bottom', 'z+': 'front', 'z-': 'back' };

  interface FaceUv {
    part: BodyPart;
    face: Face;
    box: [number, number, number, number];
    /** For each model axis, does u / v grow with it (1), shrink (-1) or stay put (0)? */
    du: [number, number, number];
    dv: [number, number, number];
  }

  const faces: FaceUv[] = [];
  for (const mesh of glb.json.meshes) {
    const prim = mesh.primitives[0]!;
    const pos = floats(glb, prim.attributes.POSITION!);
    const uv = floats(glb, prim.attributes.TEXCOORD_0!);
    const n = pos.length / 3;
    const centre = [0, 1, 2].map((a) => {
      const v = Array.from({ length: n }, (_, i) => pos[i * 3 + a]!);
      return (Math.min(...v) + Math.max(...v)) / 2;
    });
    // The shipped file is non-indexed: 6 vertices (2 triangles) per face, in a row.
    for (let f = 0; f < n; f += 6) {
      const ids = [0, 1, 2, 3, 4, 5].map((k) => f + k);
      const axis = [0, 1, 2].find((a) => ids.every((i) => Math.abs(pos[i * 3 + a]! - pos[f * 3 + a]!) < 1e-5))!;
      const key = `${'xyz'[axis]}${pos[f * 3 + axis]! > centre[axis]! ? '+' : '-'}`;
      const us = ids.map((i) => uv[i * 2]! * KIT_SIZE);
      const vs = ids.map((i) => uv[i * 2 + 1]! * KIT_SIZE);
      const slope = (values: number[], a: number): number => {
        const hi = ids.reduce((best, i, k) => (pos[i * 3 + a]! > pos[ids[best]! * 3 + a]! ? k : best), 0);
        const lo = ids.reduce((best, i, k) => (pos[i * 3 + a]! < pos[ids[best]! * 3 + a]! ? k : best), 0);
        return Math.sign(Math.round((values[hi]! - values[lo]!) * 10) / 10);
      };
      faces.push({
        part: mesh.name as BodyPart,
        face: FACE_OF[key]!,
        box: [Math.min(...us), Math.min(...vs), Math.max(...us), Math.max(...vs)],
        du: [0, 1, 2].map((a) => (a === axis ? 0 : slope(us, a))) as [number, number, number],
        dv: [0, 1, 2].map((a) => (a === axis ? 0 : slope(vs, a))) as [number, number, number],
      });
    }
  }

  it('the file has 6 parts of 6 faces and they are the parts we name', () => {
    expect(faces).toHaveLength(36);
    expect(new Set(faces.map((f) => f.part))).toEqual(new Set(BODY_PARTS));
  });

  it('every UV is inside 0..1 (the kit leaned on texture repeat; the build script removed that)', () => {
    for (const mesh of glb.json.meshes) {
      const uv = floats(glb, mesh.primitives[0]!.attributes.TEXCOORD_0!);
      for (const x of uv) {
        expect(x).toBeGreaterThanOrEqual(-1e-6);
        expect(x).toBeLessThanOrEqual(1 + 1e-6);
      }
    }
  });

  it('every KIT_RECTS entry is the UV box of that face in the file', () => {
    for (const f of faces) {
      const want = KIT_RECTS[f.part][f.face];
      f.box.forEach((v, i) => expect(Math.abs(v - want[i]!), `${f.part}.${f.face}[${i}]`).toBeLessThan(0.25));
    }
  });

  it('side faces are upright, top and bottom are turned as documented', () => {
    for (const f of faces) {
      const [dux, , duz] = f.du;
      const [, dvy, dvz] = f.dv;
      switch (f.face) {
        case 'front': // looking at +z from outside, right is +x
          expect([dux, dvy], `${f.part}.front`).toEqual([1, -1]);
          break;
        case 'back': // right is -x
          expect([dux, dvy], `${f.part}.back`).toEqual([-1, -1]);
          break;
        case 'left': // the +x face: right is -z
          expect([duz, dvy], `${f.part}.left`).toEqual([-1, -1]);
          break;
        case 'right': // the -x face: right is +z
          expect([duz, dvy], `${f.part}.right`).toEqual([1, -1]);
          break;
        case 'top': // u grows with x, picture-up is -z (v grows with z)
          expect([dux, dvz], `${f.part}.top`).toEqual([1, 1]);
          break;
        case 'bottom': // u grows with x, picture-up is +z (v falls as z grows)
          expect([dux, dvz], `${f.part}.bottom`).toEqual([1, -1]);
          break;
      }
    }
  });
});
