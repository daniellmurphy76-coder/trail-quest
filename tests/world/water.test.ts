import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { QualityTier } from '../../src/engine/quality';
import {
  createStreamWater,
  FROZEN_TIME,
  SPARKLE_MAX,
  WATER_FRAGMENT_SHADER,
  WATER_FRINGE,
  WATER_SPACING,
  WATER_VERTEX_SHADER,
  WATER_Y,
  type StreamWaterOptions,
} from '../../src/world/water';

const TIERS: QualityTier[] = ['high', 'medium', 'low'];

/** Draw calls: one per visible mesh, instanced mesh, or point cloud. */
function countDrawCalls(root: THREE.Object3D): number {
  let n = 0;
  root.traverseVisible((o) => {
    if ((o as THREE.Mesh).isMesh || (o as THREE.Points).isPoints) n++;
  });
  return n;
}

/** A gentle west-to-east S-curve, like the nature trail's stream, 40 units long. */
const PATH = Array.from({ length: 41 }, (_, i) => ({ x: -20 + i, z: -1.5 + 2.2 * Math.sin(i * 0.22) }));
const WIDTH = 3;

function build(extra: Partial<StreamWaterOptions> = {}) {
  return createStreamWater({ path: PATH, width: WIDTH, seed: 7, tier: 'high', reducedMotion: false, ...extra });
}

function ribbonOf(root: THREE.Object3D): THREE.Mesh {
  const ribbon = root.getObjectByName('stream-water-ribbon') as THREE.Mesh | undefined;
  expect(ribbon, 'water should have a ribbon').toBeDefined();
  return ribbon!;
}

function sparklesOf(root: THREE.Object3D): THREE.Points | undefined {
  return root.getObjectByName('stream-sparkles') as THREE.Points | undefined;
}

const materialOf = (root: THREE.Object3D): THREE.ShaderMaterial => ribbonOf(root).material as THREE.ShaderMaterial;
const timeOf = (root: THREE.Object3D): number => materialOf(root).uniforms.uTime!.value as number;

/** Where (x, z) is on the polyline: its distance from the line and its arc length along it. */
function nearestOnPath(x: number, z: number): { dist: number; s: number } {
  let best = Infinity;
  let bestS = 0;
  let run = 0;
  for (let i = 1; i < PATH.length; i++) {
    const a = PATH[i - 1]!;
    const b = PATH[i]!;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len2 = dx * dx + dz * dz;
    const t = Math.min(1, Math.max(0, ((x - a.x) * dx + (z - a.z) * dz) / len2));
    const d = Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t));
    if (d < best) {
      best = d;
      bestS = run + Math.sqrt(len2) * t;
    }
    run += Math.sqrt(len2);
  }
  return { dist: best, s: bestS };
}

const distanceToPath = (x: number, z: number): number => nearestOnPath(x, z).dist;
const PATH_LENGTH = PATH.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - PATH[i]!.x, p.z - PATH[i]!.z), 0);

/** The (arc length, across) attribute and the positions of the ribbon, as plain arrays. */
function ribbonData(root: THREE.Object3D) {
  const geometry = ribbonOf(root).geometry;
  const position = geometry.getAttribute('position');
  const flow = geometry.getAttribute('aFlow');
  const index = geometry.getIndex()!;
  const vertices = Array.from({ length: position.count }, (_, i) => ({
    x: position.getX(i),
    y: position.getY(i),
    z: position.getZ(i),
    s: flow.getX(i),
    v: flow.getY(i),
  }));
  const triangles = Array.from({ length: index.count / 3 }, (_, i) => [index.getX(i * 3), index.getX(i * 3 + 1), index.getX(i * 3 + 2)] as const);
  return { vertices, triangles };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createStreamWater: building', () => {
  it('builds with only a path and a width, on every tier, and update and dispose do not throw', () => {
    for (const tier of TIERS) {
      const water = createStreamWater({ path: PATH, width: WIDTH, tier });
      expect(water.root).toBeInstanceOf(THREE.Group);
      expect(water.root.children.length).toBeGreaterThan(0);
      expect(() => {
        for (let i = 0; i < 300; i++) water.update(1 / 60);
        water.update(0);
        water.update(5);
        water.update(-1);
        water.dispose();
        water.dispose();
      }).not.toThrow();
    }
  });

  it('builds with just a path (default width and tier)', () => {
    const water = createStreamWater({ path: PATH });
    expect(water.root.getObjectByName('stream-water-ribbon')).toBeDefined();
    water.dispose();
  });

  it('stays within its draw call budget: ribbon plus sparkles on high and medium, the ribbon alone on low', () => {
    expect(countDrawCalls(build({ tier: 'high' }).root)).toBe(2);
    expect(countDrawCalls(build({ tier: 'medium' }).root)).toBe(2);
    const low = build({ tier: 'low' });
    expect(countDrawCalls(low.root)).toBe(1);
    expect(sparklesOf(low.root)).toBeUndefined();
  });

  it('keeps the triangle count small (two per row, one row every 0.7 units)', () => {
    const { triangles } = ribbonData(build().root);
    const rows = Math.ceil(PATH_LENGTH / WATER_SPACING);
    expect(triangles.length).toBe(rows * 2);
    expect(triangles.length).toBeLessThan(200);
  });

  it('returns an empty group for a path too short to follow, without throwing', () => {
    for (const path of [[], [{ x: 1, z: 1 }], [{ x: 1, z: 1 }, { x: 1, z: 1 }], [{ x: Number.NaN, z: 0 }, { x: 1, z: 1 }]]) {
      const water = createStreamWater({ path, tier: 'high' });
      expect(water.root.children).toHaveLength(0);
      expect(() => {
        water.update(0.1);
        water.setReducedMotion(true);
        water.dispose();
      }).not.toThrow();
    }
  });
});

describe('createStreamWater: the ribbon follows the path', () => {
  it('puts every row across the path, symmetric about it, at the right width and height', () => {
    const { vertices } = ribbonData(build().root);
    const halfTotal = WIDTH / 2 + WATER_FRINGE;
    for (let i = 0; i < vertices.length; i += 2) {
      const left = vertices[i]!;
      const right = vertices[i + 1]!;
      expect(left.v).toBe(-1);
      expect(right.v).toBe(1);
      expect(left.s).toBeCloseTo(right.s, 6);
      // The middle of the row is on the centerline; the edges are a half width either side.
      const mx = (left.x + right.x) / 2;
      const mz = (left.z + right.z) / 2;
      expect(distanceToPath(mx, mz)).toBeLessThan(1e-4);
      expect(Math.hypot(left.x - right.x, left.z - right.z)).toBeCloseTo(halfTotal * 2, 4);
      expect(left.y).toBeCloseTo(WATER_Y, 6);
      expect(right.y).toBeCloseTo(WATER_Y, 6);
    }
  });

  it('keeps every vertex within half the strip of the path, and the edges close to exactly that', () => {
    const { vertices } = ribbonData(build().root);
    const halfTotal = WIDTH / 2 + WATER_FRINGE;
    for (const v of vertices) {
      const d = distanceToPath(v.x, v.z);
      expect(d).toBeLessThanOrEqual(halfTotal + 1e-4);
      expect(d).toBeGreaterThan(halfTotal - 0.08);
    }
  });

  it('runs its arc length from 0 to the path length, rising row by row', () => {
    const { vertices } = ribbonData(build().root);
    expect(vertices[0]!.s).toBeCloseTo(0, 6);
    expect(vertices[vertices.length - 1]!.s).toBeCloseTo(PATH_LENGTH, 4);
    for (let i = 2; i < vertices.length; i += 2) {
      const step = vertices[i]!.s - vertices[i - 2]!.s;
      expect(step).toBeGreaterThan(0);
      expect(step).toBeLessThanOrEqual(WATER_SPACING + 1e-6);
    }
  });

  it('faces every triangle up', () => {
    const { vertices, triangles } = ribbonData(build().root);
    for (const [a, b, c] of triangles) {
      const va = vertices[a]!;
      const vb = vertices[b]!;
      const vc = vertices[c]!;
      const normalY = (vb.z - va.z) * (vc.x - va.x) - (vb.x - va.x) * (vc.z - va.z);
      expect(normalY).toBeGreaterThanOrEqual(0);
    }
  });

  it('honors a custom width and height', () => {
    const { vertices } = ribbonData(build({ width: 5, y: 0.2 }).root);
    for (let i = 0; i < vertices.length; i += 2) {
      expect(Math.hypot(vertices[i]!.x - vertices[i + 1]!.x, vertices[i]!.z - vertices[i + 1]!.z)).toBeCloseTo(5 + 2 * WATER_FRINGE, 4);
      expect(vertices[i]!.y).toBeCloseTo(0.2, 6);
    }
  });
});

describe('createStreamWater: the gap', () => {
  const GAP_CENTER = { x: 0, z: PATH[20]!.z };
  const GAP_LENGTH = 3.1;
  // Where the window sits along the path, from the same nearest-point rule the module uses.
  const centerS = nearestOnPath(GAP_CENTER.x, GAP_CENTER.z).s;
  const g0 = centerS - GAP_LENGTH / 2;
  const g1 = centerS + GAP_LENGTH / 2;

  it('leaves no vertex or triangle inside the gap, and cuts exactly at its two ends', () => {
    const { vertices, triangles } = ribbonData(build({ gap: { center: GAP_CENTER, length: GAP_LENGTH } }).root);
    for (const v of vertices) expect(v.s <= g0 + 1e-4 || v.s >= g1 - 1e-4).toBe(true);
    expect(vertices.some((v) => Math.abs(v.s - g0) < 1e-4)).toBe(true);
    expect(vertices.some((v) => Math.abs(v.s - g1) < 1e-4)).toBe(true);
    for (const tri of triangles) {
      const s = tri.map((i) => vertices[i]!.s);
      const before = s.every((v) => v <= g0 + 1e-4);
      const after = s.every((v) => v >= g1 - 1e-4);
      expect(before || after).toBe(true); // no triangle bridges the gap
    }
  });

  it('keeps water on both sides of the gap, and the same ripple coordinates as without it', () => {
    const gapped = ribbonData(build({ gap: { center: GAP_CENTER, length: GAP_LENGTH } }).root).vertices;
    expect(gapped.some((v) => v.s < g0 - 1)).toBe(true);
    expect(gapped.some((v) => v.s > g1 + 1)).toBe(true);
    // Rows beyond the gap run to the end of the path, so the arc length is still the path's own.
    expect(gapped[gapped.length - 1]!.s).toBeCloseTo(PATH_LENGTH, 4);
    // Every row is still centered on the path.
    for (let i = 0; i < gapped.length; i += 2) {
      expect(distanceToPath((gapped[i]!.x + gapped[i + 1]!.x) / 2, (gapped[i]!.z + gapped[i + 1]!.z) / 2)).toBeLessThan(1e-4);
    }
  });

  it('is continuous without a gap: no triangle spans more than one row spacing', () => {
    const { vertices, triangles } = ribbonData(build().root);
    for (const tri of triangles) {
      const s = tri.map((i) => vertices[i]!.s);
      expect(Math.max(...s) - Math.min(...s)).toBeLessThanOrEqual(WATER_SPACING + 1e-6);
    }
  });

  it('has fewer triangles than the unbroken stream, and ignores a gap of no length', () => {
    const whole = ribbonData(build().root).triangles.length;
    expect(ribbonData(build({ gap: { center: GAP_CENTER, length: GAP_LENGTH } }).root).triangles.length).toBeLessThan(whole);
    expect(ribbonData(build({ gap: { center: GAP_CENTER, length: 0 } }).root).triangles.length).toBe(whole);
  });

  it('can cut the water off at the start or the end of the path', () => {
    const atStart = ribbonData(build({ gap: { center: PATH[0]!, length: 4 } }).root).vertices;
    expect(Math.min(...atStart.map((v) => v.s))).toBeGreaterThanOrEqual(2 - 1e-4);
    const atEnd = ribbonData(build({ gap: { center: PATH[PATH.length - 1]!, length: 4 } }).root).vertices;
    expect(Math.max(...atEnd.map((v) => v.s))).toBeLessThanOrEqual(PATH_LENGTH - 2 + 1e-4);
  });

  it('draws nothing when the gap covers the whole path', () => {
    const water = build({ gap: { center: { x: 0, z: PATH[20]!.z }, length: 500 } });
    expect(water.root.children).toHaveLength(0);
    expect(countDrawCalls(water.root)).toBe(0);
    expect(() => water.update(0.1)).not.toThrow();
  });

  it('keeps the sparkles out of the gap and on the water', () => {
    const water = build({ gap: { center: GAP_CENTER, length: GAP_LENGTH } });
    const points = sparklesOf(water.root)!;
    const positions = points.geometry.getAttribute('position');
    for (let step = 0; step < 600; step++) {
      water.update(1 / 30);
      for (let i = 0; i < positions.count; i++) {
        const { dist, s } = nearestOnPath(positions.getX(i), positions.getZ(i));
        expect(dist).toBeLessThanOrEqual(WIDTH / 2 + 1e-3);
        // Its place along the stream is never inside the window (a little slack for the bend).
        expect(s <= g0 + 0.1 || s >= g1 - 0.1).toBe(true);
      }
    }
  });
});

describe('createStreamWater: the look', () => {
  it('uses one transparent, unlit shader with the scene fog, drawn after the ground', () => {
    const material = materialOf(build().root);
    expect(material).toBeInstanceOf(THREE.ShaderMaterial);
    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(false);
    expect(material.fog).toBe(true);
    expect(ribbonOf(build().root).renderOrder).toBeGreaterThan(0);
    for (const name of ['fogColor', 'fogNear', 'fogFar']) expect(material.uniforms[name]).toBeDefined();
    expect(WATER_VERTEX_SHADER).toContain('#include <fog_vertex>');
    expect(WATER_FRAGMENT_SHADER).toContain('#include <fog_fragment>');
    expect(WATER_FRAGMENT_SHADER).toContain('#include <colorspace_fragment>');
  });

  it('has the rich shader on high and medium and the cheap one on low', () => {
    for (const tier of ['high', 'medium'] as const) {
      expect(materialOf(build({ tier }).root).defines).toHaveProperty('TQ_RICH');
    }
    expect(materialOf(build({ tier: 'low' }).root).defines).not.toHaveProperty('TQ_RICH');
    // The noise lives behind TQ_RICH, so the low build never sees it.
    const beforeRich = WATER_FRAGMENT_SHADER.indexOf('#ifdef TQ_RICH');
    expect(beforeRich).toBeGreaterThan(-1);
    expect(WATER_FRAGMENT_SHADER.indexOf('tqNoise(vec2(s')).toBeGreaterThan(beforeRich);
  });

  it('writes only floats with decimal points (GLSL ES 3.00 has no implicit int to float)', () => {
    // Every bare integer in an expression would be an int literal; the only ints allowed are in directives and the version.
    const code = WATER_FRAGMENT_SHADER.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
    expect(code).not.toMatch(/[^\w.][0-9]+(?![\w.])/);
  });

  it('takes custom colors', () => {
    const material = materialOf(build({ colors: { deep: 0xff0000, shallow: 0x00ff00, foam: 0x0000ff } }).root);
    expect((material.uniforms.uDeep!.value as THREE.Color).getHex()).toBe(0xff0000);
    expect((material.uniforms.uShallow!.value as THREE.Color).getHex()).toBe(0x00ff00);
    expect((material.uniforms.uFoam!.value as THREE.Color).getHex()).toBe(0x0000ff);
  });

  it('varies the ripples with the seed and repeats them with the same one', () => {
    const offset = (seed: number): THREE.Vector2 => materialOf(build({ seed }).root).uniforms.uOffset!.value as THREE.Vector2;
    expect(offset(3).equals(offset(3))).toBe(true);
    expect(offset(3).equals(offset(4))).toBe(false);
  });
});

describe('createStreamWater: motion', () => {
  it('flows: the clock advances with update', () => {
    const water = build();
    const before = timeOf(water.root);
    water.update(0.2);
    expect(timeOf(water.root)).toBeCloseTo(before + 0.2, 6);
    water.update(100); // a stalled frame moves the clock by no more than a quarter second
    expect(timeOf(water.root)).toBeCloseTo(before + 0.45, 6);
  });

  it('drifts and twinkles the sparkles on high and medium', () => {
    for (const tier of ['high', 'medium'] as const) {
      const water = build({ tier });
      const points = sparklesOf(water.root)!;
      expect(points).toBeDefined();
      expect(points.geometry.getAttribute('position').count).toBeLessThanOrEqual(SPARKLE_MAX);
      expect(points.geometry.getAttribute('position').count).toBeGreaterThanOrEqual(12);
      const positions = points.geometry.getAttribute('position');
      const colors = points.geometry.getAttribute('color');
      const startX = positions.getX(0);
      let brightest = 0;
      let dimmest = Infinity;
      for (let i = 0; i < 1200; i++) {
        water.update(1 / 60);
        brightest = Math.max(brightest, colors.getX(3));
        dimmest = Math.min(dimmest, colors.getX(3));
      }
      expect(positions.getX(0)).not.toBeCloseTo(startX, 2);
      expect(brightest).toBeGreaterThan(0.5); // it twinkles up...
      expect(dimmest).toBeLessThan(0.1); // ...and down
      expect(brightest).toBeLessThanOrEqual(1);
    }
  });

  it('keeps every sparkle on the water surface after many steps', () => {
    const water = build();
    const positions = sparklesOf(water.root)!.geometry.getAttribute('position');
    for (let step = 0; step < 2000; step++) {
      water.update(1 / 60);
      if (step % 40 !== 0) continue;
      for (let i = 0; i < positions.count; i++) {
        expect(distanceToPath(positions.getX(i), positions.getZ(i))).toBeLessThanOrEqual(WIDTH / 2 + 1e-3);
        expect(positions.getY(i)).toBeGreaterThan(WATER_Y);
        expect(positions.getY(i)).toBeLessThan(WATER_Y + 0.2);
      }
    }
  });

  it('places the same sparkles for the same seed and different ones for another', () => {
    const first = (seed: number): number[] => {
      const water = build({ seed });
      return Array.from(sparklesOf(water.root)!.geometry.getAttribute('position').array.slice(0, 12));
    };
    expect(first(5)).toEqual(first(5));
    expect(first(5)).not.toEqual(first(6));
  });

  it('under reduced motion: no flow, no sparkles drawn, still colored', () => {
    const water = build({ reducedMotion: true });
    expect(sparklesOf(water.root)!.visible).toBe(false);
    expect(countDrawCalls(water.root)).toBe(1);
    expect(timeOf(water.root)).toBe(FROZEN_TIME);
    for (let i = 0; i < 120; i++) water.update(1 / 60);
    expect(timeOf(water.root)).toBe(FROZEN_TIME);
    expect(ribbonOf(water.root).visible).toBe(true);
    expect(materialOf(water.root).uniforms.uDeep!.value).toBeInstanceOf(THREE.Color);
  });

  it('reads the system preference when not told, and can be switched live', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce'), media: query }) as MediaQueryList);
    const water = createStreamWater({ path: PATH, width: WIDTH, tier: 'high' });
    expect(timeOf(water.root)).toBe(FROZEN_TIME);
    expect(countDrawCalls(water.root)).toBe(1);

    water.setReducedMotion(false);
    expect(countDrawCalls(water.root)).toBe(2);
    const before = timeOf(water.root);
    water.update(0.1);
    expect(timeOf(water.root)).toBeCloseTo(before + 0.1, 6);

    water.setReducedMotion(true);
    expect(timeOf(water.root)).toBe(FROZEN_TIME);
    expect(sparklesOf(water.root)!.visible).toBe(false);
  });

  it('freezes the cheap shader too', () => {
    const water = build({ tier: 'low', reducedMotion: true });
    for (let i = 0; i < 60; i++) water.update(1 / 60);
    expect(timeOf(water.root)).toBe(FROZEN_TIME);
  });
});

describe('createStreamWater: dispose', () => {
  it('frees the geometry, the material, the sparkles and the dot texture, and empties the root', () => {
    const water = build();
    const ribbon = ribbonOf(water.root);
    const points = sparklesOf(water.root)!;
    const pointsMaterial = points.material as THREE.PointsMaterial;
    const spies = [
      vi.fn(), // ribbon geometry
      vi.fn(), // ribbon material
      vi.fn(), // sparkle geometry
      vi.fn(), // sparkle material
      vi.fn(), // dot texture
    ];
    ribbon.geometry.addEventListener('dispose', spies[0]!);
    (ribbon.material as THREE.Material).addEventListener('dispose', spies[1]!);
    points.geometry.addEventListener('dispose', spies[2]!);
    pointsMaterial.addEventListener('dispose', spies[3]!);
    pointsMaterial.map!.addEventListener('dispose', spies[4]!);
    water.dispose();
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
    expect(water.root.children).toHaveLength(0);
    expect(() => water.update(0.1)).not.toThrow();
  });
});
