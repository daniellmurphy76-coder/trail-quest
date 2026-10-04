import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { coarsePatch, grassColorAt, PATH_EDGE_BAND, type RGB } from '../../src/world/ground';
import type { ZoneId } from '../../src/activities/types';
import { createZone, ZONE_IDS } from '../../src/world/zones';

/** Paths, tracks and sidewalks: they read as a surface lifted off the grass, with edges that blend or a crisp kerb. */

const build = (id: ZoneId): ReturnType<typeof createZone> => createZone(id, { onTalkToDenChief: vi.fn(), onReturnToBaseCamp: vi.fn() });
const meshOf = (root: THREE.Object3D, name: string): THREE.Mesh => {
  const mesh = root.getObjectByName(name) as THREE.Mesh | undefined;
  if (!mesh) throw new Error(`no mesh called ${name}`);
  return mesh;
};
const linear = (hex: number): RGB => {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
};
const dist = (a: RGB, b: RGB): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const colorOf = (g: THREE.BufferGeometry, i: number): RGB => {
  const c = g.getAttribute('color');
  return [c.getX(i), c.getY(i), c.getZ(i)];
};

/** The highest point of the ground inside the walkable square of a zone. */
function groundTop(root: THREE.Object3D, half: number): number {
  const position = meshOf(root, 'ground').geometry.getAttribute('position');
  let top = -Infinity;
  for (let i = 0; i < position.count; i++) {
    if (Math.abs(position.getX(i)) <= half + 1 && Math.abs(position.getZ(i)) <= half + 1) top = Math.max(top, position.getY(i));
  }
  return top;
}

/** Surfaces that blend into the grass across an edge band, with the grass color they must end in. */
const BLENDED = [
  { zone: 'nature-trail', mesh: 'path', grass: 0x58a042 },
  { zone: 'fitness-field', mesh: 'track', grass: 0x69ad4b },
] as const;

describe.each(BLENDED)('the $mesh in $zone blends into the grass', ({ zone: id, mesh: name, grass }) => {
  const zone = build(id);
  const mesh = meshOf(zone.root, name);
  const seed = meshOf(zone.root, 'ground').userData.patchSeed as number;
  const geometry = mesh.geometry;
  const dirt = geometry.getAttribute('dirt');
  const position = geometry.getAttribute('position');
  const grassRGB = linear(grass);

  it('carries a dirt weight from 1 on the surface to 0 at the outer end of the band, and everything between', () => {
    let ones = 0;
    let zeros = 0;
    let between = 0;
    for (let i = 0; i < dirt.count; i++) {
      const w = dirt.getX(i);
      expect(w).toBeGreaterThanOrEqual(0);
      expect(w).toBeLessThanOrEqual(1);
      if (w === 1) ones++;
      else if (w === 0) zeros++;
      else between++;
    }
    expect(ones).toBeGreaterThan(100);
    expect(zeros).toBeGreaterThan(50);
    expect(between).toBeGreaterThan(50);
  });

  it('ends the band in exactly the color the ground shows there', () => {
    let checked = 0;
    for (let i = 0; i < dirt.count; i++) {
      if (dirt.getX(i) !== 0) continue;
      const want = grassColorAt(grassRGB, position.getX(i), position.getZ(i), seed);
      expect(dist(colorOf(geometry, i), want)).toBeLessThan(1e-5);
      checked++;
    }
    expect(checked).toBeGreaterThan(50);
  });

  it('has a band in between: its colors sit between the surface and the grass', () => {
    const inside = [0, 0, 0];
    let insideCount = 0;
    for (let i = 0; i < dirt.count; i++) {
      if (dirt.getX(i) !== 1) continue;
      const c = colorOf(geometry, i);
      inside[0] += c[0];
      inside[1] += c[1];
      inside[2] += c[2];
      insideCount++;
    }
    const surface: RGB = [inside[0] / insideCount, inside[1] / insideCount, inside[2] / insideCount];
    let mids = 0;
    for (let i = 0; i < dirt.count; i++) {
      const w = dirt.getX(i);
      if (w < 0.3 || w > 0.7) continue;
      const grassHere = grassColorAt(grassRGB, position.getX(i), position.getZ(i), seed);
      const c = colorOf(geometry, i);
      const apart = dist(surface, grassHere);
      expect(dist(c, grassHere), 'nearer the grass than the surface is').toBeLessThan(apart);
      expect(dist(c, surface), 'nearer the surface than the grass is').toBeLessThan(apart);
      mids++;
    }
    expect(mids).toBeGreaterThan(50);
    expect(PATH_EDGE_BAND).toBeGreaterThanOrEqual(0.3);
    expect(PATH_EDGE_BAND).toBeLessThanOrEqual(0.6);
  });

  it('floats above the ground ripple everywhere, with a polygon offset as well, so it never fights the grass', () => {
    const top = groundTop(zone.root, zone.bounds.maxX);
    let lowest = Infinity;
    let highest = -Infinity;
    for (let i = 0; i < position.count; i++) {
      lowest = Math.min(lowest, position.getY(i));
      highest = Math.max(highest, position.getY(i));
    }
    expect(lowest).toBeGreaterThan(top + 0.001);
    expect(highest).toBeLessThan(0.1);
    const material = mesh.material as THREE.Material;
    expect(material.polygonOffset).toBe(true);
    expect(material.polygonOffsetFactor).toBeLessThan(0);
  });

  it('lifts the middle a little above its own edge: a bank, not a cliff', () => {
    let middle = -Infinity;
    let edge = Infinity;
    for (let i = 0; i < position.count; i++) {
      if (dirt.getX(i) === 1 && position.getY(i) < 0.05) middle = Math.max(middle, position.getY(i)); // not the start line, which stands a hair above
      if (dirt.getX(i) === 0) edge = Math.min(edge, position.getY(i));
    }
    expect(middle - edge).toBeGreaterThan(0.004);
    expect(middle - edge).toBeLessThan(0.02); // gentle: no step the eye reads as a wall
  });
});

describe('the Safety Station sidewalks and path read as stone, not paper', () => {
  const zone = build('safety-station');
  const mesh = meshOf(zone.root, 'sidewalks');
  const geometry = mesh.geometry;
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');

  /** The upward-facing triangles: [ax, az, bx, bz, cx, cz, y]. */
  const tops: number[][] = [];
  for (let i = 0; i + 2 < position.count; i += 3) {
    if ([0, 1, 2].every((k) => normal.getY(i + k) > 0.99)) {
      tops.push([
        position.getX(i), position.getZ(i),
        position.getX(i + 1), position.getZ(i + 1),
        position.getX(i + 2), position.getZ(i + 2),
        position.getY(i),
      ]);
    }
  }

  const inside = (t: number[], x: number, z: number): boolean => {
    const [ax, az, bx, bz, cx, cz] = t as [number, number, number, number, number, number];
    const d1 = (x - bx) * (az - bz) - (ax - bx) * (z - bz);
    const d2 = (x - cx) * (bz - cz) - (bx - cx) * (z - cz);
    const d3 = (x - ax) * (cz - az) - (cx - ax) * (z - az);
    const negative = d1 < -1e-9 || d2 < -1e-9 || d3 < -1e-9;
    const positive = d1 > 1e-9 || d2 > 1e-9 || d3 > 1e-9;
    return !(negative && positive);
  };

  it('keeps every upward face above the lawn\'s ripple, so the ground never pokes through', () => {
    const top = groundTop(zone.root, zone.bounds.maxX);
    expect(tops.length).toBeGreaterThan(200);
    for (const t of tops) expect(t[6]!).toBeGreaterThan(top + 0.01);
  });

  it('has no two upward faces at the same height over the same spot (no coplanar faces to fight)', () => {
    let samples = 0;
    // Walk the path, the near sidewalk and the strip in front of the fire station on an uneven grid.
    const points: Array<[number, number]> = [];
    for (let x = -19; x <= 19; x += 0.173) {
      for (const z of [-10.1, -9.3, -3.2, -2.1, -1.7]) points.push([x + 0.0071 * z, z + 0.0033 * x]);
    }
    for (let z = -1.5; z <= 15.9; z += 0.151) {
      for (const x of [-1.05, -0.5, 0.02, 0.6, 1.04]) points.push([x + 0.0017 * z, z]);
    }
    for (const [x, z] of points) {
      const heights = tops.filter((t) => inside(t, x, z)).map((t) => t[6]!).sort((a, b) => a - b);
      for (let k = 1; k < heights.length; k++) expect(heights[k]! - heights[k - 1]!, `faces at ${x.toFixed(2)}, ${z.toFixed(2)}`).toBeGreaterThan(0.005);
      if (heights.length > 0) samples++;
    }
    expect(samples).toBeGreaterThan(300);
  });

  it('is built in layers: a bed, slabs standing proud of it with joints between, and a kerb taller than the slabs', () => {
    const levels = new Set(tops.map((t) => Math.round(t[6]! * 1000)));
    expect(levels.size).toBe(3);
    const [bed, slab, kerb] = [...levels].sort((a, b) => a - b) as [number, number, number];
    expect(slab - bed).toBeGreaterThanOrEqual(10); // at least a centimeter between the joint and the stone
    expect(kerb - slab).toBeGreaterThanOrEqual(20); // a lip the eye reads from across the lawn
    expect(kerb).toBeLessThan(150);
  });

  it('is not one flat color: slabs of many shades, darker joints and kerbs of their own tone', () => {
    const colors = new Set<string>();
    for (let i = 0; i < position.count; i += 3) colors.add(colorOf(geometry, i).map((v) => v.toFixed(3)).join(','));
    expect(colors.size).toBeGreaterThan(20);
  });

  it('puts a kerb down both sides of the path and leaves the near sidewalk\'s kerb open where the path joins it', () => {
    const kerbs = tops.filter((t) => Math.round(t[6]! * 1000) === Math.max(...tops.map((u) => Math.round(u[6]! * 1000))));
    const center = (t: number[]): [number, number] => [(t[0]! + t[2]! + t[4]!) / 3, (t[1]! + t[3]! + t[5]!) / 3];
    const along = kerbs.map(center);
    // Path: both edges (x near -1.1 and +1.1), for most of its 17 units.
    for (const side of [-1, 1]) expect(along.filter(([x, z]) => Math.abs(x - side * 1.02) < 0.1 && z > 0).length).toBeGreaterThan(20);
    // The near sidewalk's lawn-side kerb (z near -1.68) has stones, but none across the path's mouth.
    const lawnSide = along.filter(([, z]) => Math.abs(z - -1.68) < 0.1);
    expect(lawnSide.length).toBeGreaterThan(40);
    expect(lawnSide.filter(([x]) => Math.abs(x) < 0.9).length).toBe(0);
  });
});

describe('the Town Square plaza is paving with a tight edge', () => {
  const zone = build('town-square');
  const ground = meshOf(zone.root, 'ground');

  it('shows the paving slabs, and its edge band is at most a couple of units wide', () => {
    expect((ground.material as THREE.Material).userData.groundTexture.mode).toBe('paved');
    const dirt = ground.geometry.getAttribute('dirt');
    const position = ground.geometry.getAttribute('position');
    let inner = Infinity;
    let outer = 0;
    for (let i = 0; i < dirt.count; i++) {
      const w = dirt.getX(i);
      const d = Math.hypot(position.getX(i), position.getZ(i));
      if (w < 1) inner = Math.min(inner, d);
      if (w > 0) outer = Math.max(outer, d);
    }
    expect(outer - inner).toBeLessThanOrEqual(2);
  });
});

describe.each(ZONE_IDS)('%s ground has coarse patches and keeps its seed', (id) => {
  const zone = build(id);
  const ground = meshOf(zone.root, 'ground');

  it('leans drier and lusher in blobs: the red to green ratio follows the patch field on the open lawn', () => {
    const seed = ground.userData.patchSeed as number;
    expect(Number.isInteger(seed)).toBe(true);
    const position = ground.geometry.getAttribute('position');
    const dirt = ground.geometry.getAttribute('dirt');
    const half = zone.bounds.maxX;
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i);
      const z = position.getZ(i);
      if (dirt.getX(i) > 0 || Math.abs(x) > half + 2 || Math.abs(z) > half + 2) continue;
      xs.push(coarsePatch(x, z, seed));
      const c = colorOf(ground.geometry, i);
      ys.push(c[0] / c[1]);
    }
    expect(xs.length).toBeGreaterThan(300);
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
    expect(cov / Math.sqrt(vx * vy)).toBeGreaterThan(0.4);
  });
});
