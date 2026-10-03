import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../src/engine/seed';
import {
  createGround,
  createGroundApron,
  dirtWeight,
  grassPatch,
  groundColor,
  mixRGB,
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
        // Dirt, within its small variation.
        expect(col.getX(i)).toBeGreaterThan(dirt.r * 0.85);
        expect(col.getX(i)).toBeLessThan(dirt.r * 1.15);
        expect(col.getZ(i)).toBeGreaterThan(dirt.b * 0.9);
        expect(col.getZ(i)).toBeLessThan(dirt.b * 1.1);
      } else if (d >= path.radius + path.feather) {
        greens.push(col.getY(i));
        expect(col.getY(i)).toBeGreaterThan(grass.g * 0.75);
        expect(col.getY(i)).toBeLessThan(grass.g * 1.25);
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
