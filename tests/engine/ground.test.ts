import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../src/engine/seed';
import {
  CLEARING_RAGGED,
  coarsePatch,
  createGround,
  createGroundApron,
  dirtColorAt,
  dirtWeight,
  grassColorAt,
  grassPatch,
  groundColor,
  leanGrassRGB,
  mixRGB,
  PATCH_CELL_LARGE,
  PATCH_CELL_SMALL,
  PATH_EDGE_BAND,
  PATH_RIM_SHADE,
  pathEdgeColor,
  pathEdgeDirt,
  shadeRGB,
  type GroundPath,
  type RGB,
} from '../../src/world/ground';

const path: GroundPath = { center: { x: 0, z: 0 }, radius: 8, feather: 4 };

describe('dirtWeight', () => {
  it('is solid dirt inside the radius', () => {
    expect(dirtWeight(0, 0, path)).toBe(1);
    expect(dirtWeight(8, 0, path)).toBe(1);
    expect(dirtWeight(3, -4, path)).toBe(1);
  });

  it('is solid grass beyond radius + feather', () => {
    expect(dirtWeight(12, 0, path)).toBe(0);
    expect(dirtWeight(50, 50, path)).toBe(0);
  });

  it('is half and half midway across the feather, and eases rather than ramping', () => {
    expect(dirtWeight(10, 0, path)).toBeCloseTo(0.5, 10);
    // A smoothstep is flat at both ends: close to the edges it barely moves.
    expect(dirtWeight(8.2, 0, path)).toBeGreaterThan(0.98);
    expect(dirtWeight(11.8, 0, path)).toBeLessThan(0.02);
  });

  it('never rises as you walk away from the center, and stays within [0, 1]', () => {
    let prev = 1;
    for (let d = 0; d <= 30; d += 0.25) {
      const w = dirtWeight(d, 0, path);
      expect(w).toBeGreaterThanOrEqual(0);
      expect(w).toBeLessThanOrEqual(1);
      expect(w).toBeLessThanOrEqual(prev + 1e-12);
      prev = w;
    }
  });

  it('measures from the clearing center, in x and z', () => {
    const off: GroundPath = { center: { x: 10, z: -5 }, radius: 3, feather: 2 };
    expect(dirtWeight(10, -5, off)).toBe(1);
    expect(dirtWeight(10, -2, off)).toBe(1);
    expect(dirtWeight(0, 0, off)).toBe(0);
  });

  it('gives a hard edge when the feather is 0 or negative, with no NaN', () => {
    expect(dirtWeight(8, 0, { ...path, feather: 0 })).toBe(1);
    expect(dirtWeight(8.01, 0, { ...path, feather: 0 })).toBe(0);
    expect(dirtWeight(9, 0, { ...path, feather: -3 })).toBe(0);
  });
});

describe('color math', () => {
  const grass: RGB = [0.1, 0.4, 0.05];
  const dirt: RGB = [0.5, 0.35, 0.15];

  it('mixRGB blends linearly and clamps t', () => {
    expect(mixRGB(grass, dirt, 0)).toEqual(grass);
    expect(mixRGB(grass, dirt, 1)).toEqual(dirt);
    const half = mixRGB(grass, dirt, 0.5);
    expect(half[0]).toBeCloseTo(0.3, 10);
    expect(half[1]).toBeCloseTo(0.375, 10);
    expect(mixRGB(grass, dirt, -5)).toEqual(grass);
    expect(mixRGB(grass, dirt, 9)).toEqual(dirt);
  });

  it('shadeRGB leaves the color alone at 0, lightens for positive, darkens for negative, and stays in [0, 1]', () => {
    expect(shadeRGB(grass, 0, 0.2)).toEqual(grass);
    expect(shadeRGB(grass, 1, 0.2)[1]).toBeGreaterThan(grass[1]);
    expect(shadeRGB(grass, -1, 0.2)[1]).toBeLessThan(grass[1]);
    for (const v of [-9, -1, 0, 1, 9]) {
      for (const c of shadeRGB([0.95, 0.99, 1], v, 0.5)) {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(1);
      }
    }
  });

  it('grassPatch is a smooth field within [-1, 1]', () => {
    for (let x = -40; x <= 40; x += 3.7) {
      for (let z = -40; z <= 40; z += 3.1) {
        const p = grassPatch(x, z);
        expect(p).toBeGreaterThanOrEqual(-1);
        expect(p).toBeLessThanOrEqual(1);
      }
    }
    expect(grassPatch(0, 0)).toBe(grassPatch(0, 0));
    expect(Math.abs(grassPatch(1, 1) - grassPatch(1.01, 1))).toBeLessThan(0.01);
  });

  it('groundColor is pure grass at weight 0, pure dirt at weight 1, and in between at the feather edge', () => {
    expect(groundColor(grass, dirt, 0, 0)).toEqual(grass);
    expect(groundColor(grass, dirt, 1, 0)).toEqual(dirt);
    const mid = groundColor(grass, dirt, dirtWeight(10, 0, path), 0);
    expect(mid[0]).toBeGreaterThan(grass[0]);
    expect(mid[0]).toBeLessThan(dirt[0]);
    expect(mid[1]).toBeGreaterThan(Math.min(grass[1], dirt[1]));
    expect(mid[1]).toBeLessThan(Math.max(grass[1], dirt[1]));
  });

  it('groundColor clamps a weight outside [0, 1]', () => {
    expect(groundColor(grass, dirt, 3, 0)).toEqual(dirt);
    expect(groundColor(grass, dirt, -3, 0)).toEqual(grass);
  });
});

describe('coarsePatch', () => {
  it('stays in [-1, 1], is the same every time for a seed, and differs between seeds', () => {
    let different = 0;
    for (let x = -40; x <= 40; x += 1.7) {
      for (let z = -40; z <= 40; z += 1.3) {
        const p = coarsePatch(x, z, 12);
        expect(p).toBeGreaterThanOrEqual(-1);
        expect(p).toBeLessThanOrEqual(1);
        expect(coarsePatch(x, z, 12)).toBe(p);
        if (coarsePatch(x, z, 13) !== p) different++;
      }
    }
    expect(different).toBeGreaterThan(500);
  });

  it('is smooth: a small step never makes a big jump', () => {
    for (let x = -30; x <= 30; x += 2.3) {
      for (let z = -30; z <= 30; z += 2.9) {
        expect(Math.abs(coarsePatch(x, z, 5) - coarsePatch(x + 0.05, z, 5))).toBeLessThan(0.1);
        expect(Math.abs(coarsePatch(x, z, 5) - coarsePatch(x, z + 0.05, 5))).toBeLessThan(0.1);
      }
    }
  });

  it('makes blobs 4 to 8 units across (the average gap between sign changes along a line)', () => {
    let crossings = 0;
    let length = 0;
    for (let line = 0; line < 6; line++) {
      let previous = 0;
      for (let x = -150; x <= 150; x += 0.25) {
        const p = coarsePatch(x, line * 11.3 + 2.1, line * 31);
        if (previous !== 0 && Math.sign(p) !== Math.sign(previous)) crossings++;
        if (p !== 0) previous = p;
      }
      length += 300;
    }
    const blob = length / crossings;
    expect(blob).toBeGreaterThanOrEqual(4);
    expect(blob).toBeLessThanOrEqual(8);
    expect(PATCH_CELL_SMALL).toBeGreaterThan(2);
    expect(PATCH_CELL_LARGE).toBeLessThan(10);
  });

  it('uses most of its range: plenty of clearly drier and clearly lusher places', () => {
    let high = 0;
    let low = 0;
    let n = 0;
    for (let x = -60; x <= 60; x += 1.1) {
      for (let z = -60; z <= 60; z += 1.1) {
        const p = coarsePatch(x, z, 3);
        if (p > 0.4) high++;
        if (p < -0.4) low++;
        n++;
      }
    }
    expect(high / n).toBeGreaterThan(0.15);
    expect(low / n).toBeGreaterThan(0.15);
  });
});

describe('the grass and dirt lean with the patches', () => {
  const grass: RGB = [0.115, 0.34, 0.06];
  const dirt: RGB = [0.48, 0.33, 0.14];

  it('leanGrassRGB leaves the color alone at 0, goes yellower and lighter for dry, deeper and cooler for lush, in range', () => {
    expect(leanGrassRGB(grass, 0, 0.7)).toEqual(grass);
    const dry = leanGrassRGB(grass, 1, 0.7);
    const lush = leanGrassRGB(grass, -1, 0.7);
    expect(dry[0]).toBeGreaterThan(grass[0]);
    expect(dry[2]).toBeLessThan(grass[2]);
    expect(lush[0]).toBeLessThan(grass[0]);
    expect(lush[2]).toBeGreaterThan(grass[2]);
    // Gentle: green stays the main channel and moves by well under a fifth.
    for (const c of [dry, lush]) {
      expect(c[1]).toBeGreaterThan(c[0]);
      expect(Math.abs(c[1] / grass[1] - 1)).toBeLessThan(0.2);
    }
    for (const v of [-9, 9]) for (const c of leanGrassRGB([0.95, 0.99, 1], v, 0.7)) expect(c).toBeGreaterThanOrEqual(0);
  });

  it('groundColor takes the patch on both sides: grass leaning, dirt lightening or darkening (paving less so)', () => {
    expect(groundColor(grass, dirt, 0, 0, 0)).toEqual(grass);
    expect(groundColor(grass, dirt, 1, 0, 0)).toEqual(dirt);
    const lighter = groundColor(grass, dirt, 1, 0, 1);
    const darker = groundColor(grass, dirt, 1, 0, -1);
    expect(lighter[1]).toBeGreaterThan(dirt[1] * 1.1);
    expect(darker[1]).toBeLessThan(dirt[1] * 0.9);
    expect(groundColor(grass, dirt, 0, 0, 1)[0]).toBeGreaterThan(grass[0]);
    const paved = groundColor(grass, dirt, 1, 0, 1, 0.05);
    expect(paved[1] - dirt[1]).toBeLessThan(lighter[1] - dirt[1]);
  });

  it('grassColorAt and dirtColorAt are the ground color with no per-vertex noise, the same for the same seed', () => {
    expect(grassColorAt(grass, 3, -4, 9)).toEqual(grassColorAt(grass, 3, -4, 9));
    expect(grassColorAt(grass, 3, -4, 9)).toEqual(groundColor(grass, grass, 0, 0.55 * grassPatch(3, -4), coarsePatch(3, -4, 9)));
    expect(dirtColorAt(dirt, 3, -4, 9)).toEqual(groundColor(dirt, dirt, 1, 0.55 * grassPatch(3, -4), coarsePatch(3, -4, 9)));
    expect(grassColorAt(grass, 3, -4, 9)).not.toEqual(grassColorAt(grass, 3, -4, 10));
  });
});

describe('the edge of a path', () => {
  const grass: RGB = [0.115, 0.34, 0.06];
  const dirt: RGB = [0.48, 0.33, 0.14];
  const dist = (a: RGB, b: RGB): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

  it('starts as a rim a little darker than the path, ends as exactly the grass, and eases in between', () => {
    const rim = pathEdgeColor(dirt, grass, 0);
    expect(rim[1]).toBeLessThan(dirt[1]);
    expect(rim[1]).toBeGreaterThan(dirt[1] * (1 - 2 * PATH_RIM_SHADE)); // a touch, not a stripe
    pathEdgeColor(dirt, grass, 1).forEach((v, k) => expect(v).toBeCloseTo(grass[k]!, 10));
    let previous = dist(rim, grass);
    for (let t = 0.1; t <= 1.0001; t += 0.1) {
      const d = dist(pathEdgeColor(dirt, grass, t), grass);
      expect(d).toBeLessThanOrEqual(previous + 1e-9); // always on the way to the grass
      previous = d;
    }
  });

  it('is between the path and the grass in the middle of the band: nearer to each than they are to each other', () => {
    const mid = pathEdgeColor(dirt, grass, 0.5);
    expect(dist(mid, dirt)).toBeLessThan(dist(dirt, grass));
    expect(dist(mid, grass)).toBeLessThan(dist(dirt, grass));
    expect(mid[0]).toBeGreaterThan(grass[0]);
    expect(mid[0]).toBeLessThan(dirt[0]);
  });

  it('carries a dirt weight that is 1 at the rim, 0 at the grass and falls in between, over a band 0.3 to 0.6 wide', () => {
    expect(pathEdgeDirt(0)).toBe(1);
    expect(pathEdgeDirt(1)).toBe(0);
    expect(pathEdgeDirt(0.5)).toBeCloseTo(0.5, 10);
    expect(PATH_EDGE_BAND).toBeGreaterThanOrEqual(0.3);
    expect(PATH_EDGE_BAND).toBeLessThanOrEqual(0.6);
  });
});

describe('createGround', () => {
  const size = 60;
  const make = (seed = 7, withPath = true): THREE.Mesh =>
    createGround({
      size,
      rng: mulberry32(seed),
      grass: 0x5f9e45,
      dirt: 0xb89a6a,
      ...(withPath ? { path } : {}),
    });

  it('is a shadow-receiving plane with vertex colors, 48 by 48 quads', () => {
    const ground = make();
    expect(ground.isMesh).toBe(true);
    expect(ground.receiveShadow).toBe(true);
    expect(ground.castShadow).toBe(false);
    expect((ground.material as THREE.MeshLambertMaterial).vertexColors).toBe(true);
    const pos = ground.geometry.getAttribute('position');
    expect(pos.count).toBe(49 * 49);
    expect(ground.geometry.getAttribute('color').count).toBe(pos.count);
    expect(ground.geometry.getAttribute('normal').count).toBe(pos.count);
    ground.geometry.computeBoundingBox();
    const box = ground.geometry.boundingBox!;
    expect(box.max.x - box.min.x).toBeCloseTo(size, 6);
    expect(box.max.z - box.min.z).toBeCloseTo(size, 6);
  });

  it('is the same ground for the same seed and a different one for another seed', () => {
    const a = make(7).geometry.getAttribute('color').array;
    expect(Array.from(make(7).geometry.getAttribute('color').array)).toEqual(Array.from(a));
    expect(Array.from(make(8).geometry.getAttribute('color').array)).not.toEqual(Array.from(a));
  });

  it('is exactly flat inside the clearing and has a few centimeters of ripple outside', () => {
    const ground = make();
    const pos = ground.geometry.getAttribute('position');
    let insideCount = 0;
    let rippled = 0;
    let maxAbs = 0;
    for (let i = 0; i < pos.count; i++) {
      const d = Math.hypot(pos.getX(i), pos.getZ(i));
      const y = pos.getY(i);
      if (d <= path.radius) {
        insideCount++;
        expect(Math.abs(y)).toBe(0);
      } else if (d >= path.radius + path.feather) {
        if (y !== 0) rippled++;
      }
      maxAbs = Math.max(maxAbs, Math.abs(y));
    }
    expect(insideCount).toBeGreaterThan(50);
    expect(rippled).toBeGreaterThan(500);
    expect(maxAbs).toBeGreaterThan(0.01);
    expect(maxAbs).toBeLessThanOrEqual(0.03 + 1e-9); // half of the default 0.06 ripple
  });

  it('ripples everywhere when there is no clearing', () => {
    const pos = make(7, false).geometry.getAttribute('position');
    let flat = 0;
    for (let i = 0; i < pos.count; i++) if (pos.getY(i) === 0) flat++;
    expect(flat).toBeLessThan(5);
  });

  it('puts dirt in the clearing and grass outside, with the grass color varying from vertex to vertex', () => {
    const ground = make();
    const pos = ground.geometry.getAttribute('position');
    const col = ground.geometry.getAttribute('color');
    const grass = new THREE.Color(0x5f9e45);
    const dirt = new THREE.Color(0xb89a6a);
    const greens: number[] = [];
    for (let i = 0; i < pos.count; i++) {
      const d = Math.hypot(pos.getX(i), pos.getZ(i));
      if (d <= path.radius) {
        // Dirt, within its variation and the coarse lighter and darker patches.
        expect(col.getX(i)).toBeGreaterThan(dirt.r * 0.8);
        expect(col.getX(i)).toBeLessThan(dirt.r * 1.25);
        expect(col.getZ(i)).toBeGreaterThan(dirt.b * 0.8);
        expect(col.getZ(i)).toBeLessThan(dirt.b * 1.2);
      } else if (d >= path.radius + path.feather) {
        greens.push(col.getY(i));
        expect(col.getY(i)).toBeGreaterThan(grass.g * 0.7);
        expect(col.getY(i)).toBeLessThan(grass.g * 1.3);
        expect(col.getX(i)).toBeLessThan(dirt.r); // never reads as dirt out here
      }
    }
    const mean = greens.reduce((a, b) => a + b, 0) / greens.length;
    const variance = greens.reduce((a, b) => a + (b - mean) ** 2, 0) / greens.length;
    expect(Math.sqrt(variance)).toBeGreaterThan(0.01); // not one flat value
  });

  it('keeps every vertex color a valid [0, 1] value', () => {
    const col = make().geometry.getAttribute('color');
    for (let i = 0; i < col.count * 3; i++) {
      expect(col.array[i]).toBeGreaterThanOrEqual(0);
      expect(col.array[i]).toBeLessThanOrEqual(1);
    }
  });

  it('breaks the lawn into drier and lusher patches: red against green follows the coarse patch field', () => {
    const ground = make(7, false);
    const seed = ground.userData.patchSeed as number;
    expect(Number.isInteger(seed)).toBe(true);
    const pos = ground.geometry.getAttribute('position');
    const col = ground.geometry.getAttribute('color');
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < pos.count; i++) {
      xs.push(coarsePatch(pos.getX(i), pos.getZ(i), seed));
      ys.push(col.getX(i) / col.getY(i));
    }
    const mean = (v: number[]): number => v.reduce((a, b) => a + b, 0) / v.length;
    const mx = mean(xs);
    const my = mean(ys);
    let cov = 0;
    let vx = 0;
    let vy = 0;
    for (let i = 0; i < xs.length; i++) {
      cov += (xs[i]! - mx) * (ys[i]! - my);
      vx += (xs[i]! - mx) ** 2;
      vy += (ys[i]! - my) ** 2;
    }
    expect(cov / Math.sqrt(vx * vy)).toBeGreaterThan(0.6);
  });

  it('takes the patch seed from the options when given, and keeps it', () => {
    const a = createGround({ size: 30, rng: mulberry32(3), grass: 0x5f9e45, dirt: 0xb89a6a, patchSeed: 41 });
    const b = createGround({ size: 30, rng: mulberry32(3), grass: 0x5f9e45, dirt: 0xb89a6a, patchSeed: 42 });
    expect(a.userData.patchSeed).toBe(41);
    expect(Array.from(a.geometry.getAttribute('color').array)).not.toEqual(Array.from(b.geometry.getAttribute('color').array));
  });

  it('lets a dirt clearing wander outward only: solid dirt stays inside the radius, and the grass starts a little beyond the circle', () => {
    const ground = make();
    const seed = ground.userData.patchSeed as number;
    const dirt = ground.geometry.getAttribute('dirt');
    const pos = ground.geometry.getAttribute('position');
    let wandered = 0;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const d = Math.hypot(x, z);
      const plain = dirtWeight(x, z, path);
      expect(dirt.getX(i)).toBeCloseTo(dirtWeight(x, z, { ...path, ragged: CLEARING_RAGGED }, seed), 6);
      expect(dirt.getX(i)).toBeGreaterThanOrEqual(plain - 1e-6); // never less dirt than the plain circle
      if (d <= path.radius) expect(dirt.getX(i)).toBe(1);
      if (d >= path.radius + path.feather + CLEARING_RAGGED + 1e-6) expect(dirt.getX(i)).toBe(0);
      if (dirt.getX(i) > plain + 0.05) wandered++;
    }
    expect(wandered).toBeGreaterThan(10);
  });

  it('keeps a plaza (no pebbles) a perfect circle, with no wander', () => {
    const plaza = createGround({ size: 60, rng: mulberry32(7), grass: 0x5f9e45, dirt: 0xcdc5b2, path, pebbles: false });
    const dirt = plaza.geometry.getAttribute('dirt');
    const pos = plaza.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      expect(dirt.getX(i)).toBeCloseTo(dirtWeight(pos.getX(i), pos.getZ(i), path), 6);
    }
  });

  it('takes the plaza patches gently: paving varies less from place to place than a dirt clearing does', () => {
    const spread = (pebbles: boolean): number => {
      const g = createGround({ size: 60, rng: mulberry32(7), grass: 0x5f9e45, dirt: 0xcdc5b2, path, pebbles, patchSeed: 5 });
      const pos = g.geometry.getAttribute('position');
      const col = g.geometry.getAttribute('color');
      const values: number[] = [];
      for (let i = 0; i < pos.count; i++) if (Math.hypot(pos.getX(i), pos.getZ(i)) <= path.radius) values.push(col.getY(i));
      const m = values.reduce((a, b) => a + b, 0) / values.length;
      return Math.sqrt(values.reduce((a, b) => a + (b - m) ** 2, 0) / values.length) / m;
    };
    expect(spread(false)).toBeLessThan(spread(true));
  });

  it('honors segments and ripple options', () => {
    const g = createGround({ size: 20, rng: mulberry32(1), grass: 0x5f9e45, dirt: 0xb89a6a, segments: 8, ripple: 0 });
    const pos = g.geometry.getAttribute('position');
    expect(pos.count).toBe(9 * 9);
    for (let i = 0; i < pos.count; i++) expect(Math.abs(pos.getY(i))).toBe(0);
  });
});

describe('createGroundApron', () => {
  it('is a big flat plane just under the ground that does not receive shadows', () => {
    const apron = createGroundApron(0x5f9e45);
    expect(apron.position.y).toBeLessThan(-0.03); // below the ground's ripple
    expect(apron.receiveShadow).toBe(false);
    apron.geometry.computeBoundingBox();
    expect(apron.geometry.boundingBox!.max.x).toBeGreaterThan(200);
  });
});
