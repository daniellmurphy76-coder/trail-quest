import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { QualityTier } from '../../src/engine/quality';
import {
  createBirds,
  createButterflies,
  createFireflies,
  MAX_BIRDS,
  MAX_BUTTERFLIES,
  MAX_FIREFLIES,
  type Critters,
} from '../../src/world/critters';

const TIERS: QualityTier[] = ['high', 'medium', 'low'];
const STEP = 1 / 60;

/** Draw calls: one per visible mesh, instanced mesh, or point cloud. */
function countDrawCalls(root: THREE.Object3D): number {
  let n = 0;
  root.traverseVisible((o) => {
    if ((o as THREE.Mesh).isMesh || (o as THREE.Points).isPoints) n++;
  });
  return n;
}

function run(critters: Critters, steps: number, dt = STEP): void {
  for (let i = 0; i < steps; i++) critters.update(dt);
}

function instancedOf(root: THREE.Object3D, name: string): THREE.InstancedMesh {
  const mesh = root.getObjectByName(name) as THREE.InstancedMesh | undefined;
  expect(mesh, `should have an instanced mesh called ${name}`).toBeDefined();
  return mesh!;
}

/** The position of each body (instance 2i is body i's first wing, and sits at the body's position). */
function bodyPositions(mesh: THREE.InstancedMesh): THREE.Vector3[] {
  const m = new THREE.Matrix4();
  return Array.from({ length: mesh.count / 2 }, (_, i) => {
    mesh.getMatrixAt(2 * i, m);
    return new THREE.Vector3().setFromMatrixPosition(m);
  });
}

function matrixOf(mesh: THREE.InstancedMesh, i: number): THREE.Matrix4 {
  const m = new THREE.Matrix4();
  mesh.getMatrixAt(i, m);
  return m;
}

const horizontal = (p: THREE.Vector3, cx: number, cz: number): number => Math.hypot(p.x - cx, p.z - cz);

function firefliesOf(root: THREE.Object3D): THREE.Points {
  const points = root.getObjectByName('fireflies-points') as THREE.Points | undefined;
  expect(points, 'should have a Points object').toBeDefined();
  return points!;
}

function snapshot(mesh: THREE.InstancedMesh): number[] {
  return Array.from(mesh.instanceMatrix.array.slice(0, mesh.count * 16));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---- shared behavior --------------------------------------------------------------------------------

describe('every critter factory', () => {
  const factories: Array<[string, (tier?: QualityTier) => Critters]> = [
    ['butterflies', (tier) => createButterflies({ tier })],
    ['birds', (tier) => createBirds({ tier })],
    ['fireflies', (tier) => createFireflies({ tier })],
  ];

  it.each(factories)('builds %s with defaults and on every tier, within 2 draw calls, and update and dispose do not throw', (_, make) => {
    for (const tier of [undefined, ...TIERS]) {
      const critters = make(tier);
      expect(critters.root).toBeInstanceOf(THREE.Group);
      expect(countDrawCalls(critters.root)).toBeLessThanOrEqual(2);
      expect(() => {
        run(critters, 240);
        critters.update(0);
        critters.update(5);
        critters.update(-1);
        critters.update(Number.NaN);
        critters.setReducedMotion(true);
        critters.update(0.1);
        critters.setReducedMotion(false);
        critters.dispose();
        critters.dispose();
        critters.update(0.1);
      }).not.toThrow();
    }
  });

  it.each(factories)('hides %s under reduced motion, freezes it, and brings it back when allowed', (_, make) => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce'), media: query }) as MediaQueryList);
    const critters = make('high'); // no explicit option: it reads the system preference
    expect(critters.root.visible).toBe(false);
    expect(countDrawCalls(critters.root)).toBe(0);
    critters.setReducedMotion(false);
    expect(critters.root.visible).toBe(true);
    expect(countDrawCalls(critters.root)).toBe(1);
    critters.setReducedMotion(true);
    expect(critters.root.visible).toBe(false);
    expect(countDrawCalls(critters.root)).toBe(0);
  });
});

// ---- butterflies ------------------------------------------------------------------------------------

describe('createButterflies', () => {
  const area = { minX: -6, maxX: 10, minZ: -4, maxZ: 12 };

  it('is one draw call with two wing quads per butterfly (4 triangles each), and nothing on the low tier', () => {
    for (const tier of ['high', 'medium'] as const) {
      const { root } = createButterflies({ count: 12, area, tier });
      expect(countDrawCalls(root)).toBe(1);
      const mesh = instancedOf(root, 'butterfly-wings');
      expect(mesh.count).toBe(24);
      expect(mesh.geometry.getIndex()!.count / 3).toBe(2); // one wing: a quad
    }
    const low = createButterflies({ count: 12, area, tier: 'low' });
    expect(low.root.children).toHaveLength(0);
    expect(countDrawCalls(low.root)).toBe(0);
  });

  it('gives every butterfly one of a few colors on both wings', () => {
    const mesh = instancedOf(createButterflies({ count: 40, area, seed: 3, tier: 'high' }).root, 'butterfly-wings');
    const colors = new Set<number>();
    const a = new THREE.Color();
    const b = new THREE.Color();
    for (let i = 0; i < 40; i++) {
      mesh.getColorAt(2 * i, a);
      mesh.getColorAt(2 * i + 1, b);
      expect(a.getHex()).toBe(b.getHex());
      colors.add(a.getHex());
    }
    expect(colors.size).toBeGreaterThanOrEqual(3);
    expect(colors.size).toBeLessThanOrEqual(6);
  });

  it('stays inside the area and between 0.4 and 1.6 units high through a long flight', () => {
    const butterflies = createButterflies({ count: 20, area, seed: 11, tier: 'high', reducedMotion: false });
    const mesh = instancedOf(butterflies.root, 'butterfly-wings');
    for (let step = 0; step < 9000; step++) {
      butterflies.update(step % 500 === 0 ? 3 : STEP); // now and then a stalled frame
      if (step % 50 !== 0) continue;
      for (const p of bodyPositions(mesh)) {
        expect(p.x).toBeGreaterThanOrEqual(area.minX);
        expect(p.x).toBeLessThanOrEqual(area.maxX);
        expect(p.z).toBeGreaterThanOrEqual(area.minZ);
        expect(p.z).toBeLessThanOrEqual(area.maxZ);
        expect(p.y).toBeGreaterThanOrEqual(0.4);
        expect(p.y).toBeLessThanOrEqual(1.6);
      }
    }
  });

  it('keeps out of the avoid circles, from the first frame on', () => {
    const avoid = [
      { x: 2, z: 4, r: 3 },
      { x: -3, z: -1, r: 1.5 },
    ];
    const butterflies = createButterflies({ count: 30, area, avoid, seed: 5, tier: 'high', reducedMotion: false });
    const mesh = instancedOf(butterflies.root, 'butterfly-wings');
    const check = (): void => {
      for (const p of bodyPositions(mesh)) {
        for (const d of avoid) expect(Math.hypot(p.x - d.x, p.z - d.z)).toBeGreaterThanOrEqual(d.r);
        expect(p.x).toBeGreaterThanOrEqual(area.minX);
        expect(p.x).toBeLessThanOrEqual(area.maxX);
        expect(p.z).toBeGreaterThanOrEqual(area.minZ);
        expect(p.z).toBeLessThanOrEqual(area.maxZ);
      }
    };
    check();
    for (let step = 0; step < 6000; step++) {
      butterflies.update(STEP);
      if (step % 40 === 0) check();
    }
  });

  it('wanders: bodies move, and not in straight lines', () => {
    const butterflies = createButterflies({ count: 6, area, seed: 2, tier: 'high', reducedMotion: false });
    const mesh = instancedOf(butterflies.root, 'butterfly-wings');
    const start = bodyPositions(mesh);
    const mid: THREE.Vector3[][] = [];
    for (let i = 0; i < 600; i++) {
      butterflies.update(STEP);
      if (i % 100 === 99) mid.push(bodyPositions(mesh));
    }
    const end = bodyPositions(mesh);
    start.forEach((p, i) => expect(horizontal(end[i]!, p.x, p.z)).toBeGreaterThan(0.1));
    // A straight flight would have collinear sample points; a curve bends away from the chord.
    const bent = start.some((p, i) => {
      const a = mid[1]![i]!;
      const b = mid[4]![i]!;
      const chord = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      const off = Math.abs((b.x - a.x) * (mid[2]![i]!.z - a.z) - (b.z - a.z) * (mid[2]![i]!.x - a.x)) / chord;
      return off > 0.02;
    });
    expect(bent).toBe(true);
  });

  it('flaps: the two wings are mirror images and each one moves as time passes', () => {
    const butterflies = createButterflies({ count: 1, area, seed: 4, tier: 'high', reducedMotion: false });
    const mesh = instancedOf(butterflies.root, 'butterfly-wings');
    const wingTip = new THREE.Vector3(0.17, 0, 0);
    const tips: number[] = [];
    let mirrored = false;
    for (let i = 0; i < 90; i++) {
      butterflies.update(STEP);
      const left = wingTip.clone().applyMatrix4(matrixOf(mesh, 0));
      const right = wingTip.clone().applyMatrix4(matrixOf(mesh, 1));
      const body = bodyPositions(mesh)[0]!;
      tips.push(left.y - body.y);
      // The mirrored wing reaches out the other way, so the two tips are on opposite sides of the body.
      const lx = left.x - body.x;
      const lz = left.z - body.z;
      const rx = right.x - body.x;
      const rz = right.z - body.z;
      if (lx * rx + lz * rz < 0) mirrored = true;
    }
    expect(mirrored).toBe(true);
    expect(Math.max(...tips) - Math.min(...tips)).toBeGreaterThan(0.1); // the wing tip rises and falls
  });

  it('repeats the same flight for a seed and flies another for a different one', () => {
    const flight = (seed: number): number[] => {
      const b = createButterflies({ count: 4, area, seed, tier: 'high', reducedMotion: false });
      run(b, 200);
      return snapshot(instancedOf(b.root, 'butterfly-wings'));
    };
    expect(flight(9)).toEqual(flight(9));
    expect(flight(9)).not.toEqual(flight(10));
  });

  it('freezes under reduced motion', () => {
    const b = createButterflies({ count: 5, area, tier: 'high', reducedMotion: true });
    const mesh = instancedOf(b.root, 'butterfly-wings');
    const before = snapshot(mesh);
    run(b, 120);
    expect(snapshot(mesh)).toEqual(before);
    expect(b.root.visible).toBe(false);
  });

  it('clamps the count and copes with no butterflies or a degenerate area', () => {
    expect(instancedOf(createButterflies({ count: 9999, tier: 'high' }).root, 'butterfly-wings').count).toBe(MAX_BUTTERFLIES * 2);
    expect(createButterflies({ count: 0, tier: 'high' }).root.children).toHaveLength(0);
    expect(createButterflies({ count: -3, tier: 'high' }).root.children).toHaveLength(0);
    const flat = createButterflies({ count: 3, area: { minX: 2, maxX: 2, minZ: 1, maxZ: 6 }, tier: 'high', reducedMotion: false });
    expect(() => run(flat, 300)).not.toThrow();
    for (const p of bodyPositions(instancedOf(flat.root, 'butterfly-wings'))) expect(p.x).toBe(2);
    // An area given backwards is the same area.
    const swapped = createButterflies({ count: 3, area: { minX: 10, maxX: -6, minZ: 12, maxZ: -4 }, tier: 'high', reducedMotion: false });
    run(swapped, 600);
    for (const p of bodyPositions(instancedOf(swapped.root, 'butterfly-wings'))) {
      expect(p.x).toBeGreaterThanOrEqual(-6);
      expect(p.x).toBeLessThanOrEqual(10);
    }
  });

  it('frees its geometry, material and instance buffers when disposed', () => {
    const b = createButterflies({ count: 3, area, tier: 'high' });
    const mesh = instancedOf(b.root, 'butterfly-wings');
    const spies = [vi.fn(), vi.fn(), vi.fn()];
    mesh.geometry.addEventListener('dispose', spies[0]!);
    (mesh.material as THREE.Material).addEventListener('dispose', spies[1]!);
    mesh.addEventListener('dispose', spies[2]!);
    b.dispose();
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
    expect(b.root.children).toHaveLength(0);
  });
});

// ---- birds ------------------------------------------------------------------------------------------

describe('createBirds', () => {
  it('is one draw call with two wings per bird (6 triangles each), and nothing on the low tier', () => {
    for (const tier of ['high', 'medium'] as const) {
      const { root } = createBirds({ count: 5, tier });
      expect(countDrawCalls(root)).toBe(1);
      const mesh = instancedOf(root, 'bird-wings');
      expect(mesh.count).toBe(10);
      expect(mesh.geometry.getIndex()!.count / 3).toBe(3); // a wing quad and half a body
    }
    const low = createBirds({ count: 5, tier: 'low' });
    expect(low.root.children).toHaveLength(0);
    expect(countDrawCalls(low.root)).toBe(0);
  });

  it('circles within the radius of the center, 20 to 35 units up for a height of 28', () => {
    const center = { x: 4, z: -7 };
    const radius = 30;
    const birds = createBirds({ count: 8, radius, height: 28, center, seed: 6, tier: 'high', reducedMotion: false });
    const mesh = instancedOf(birds.root, 'bird-wings');
    const angles = new Map<number, number>();
    for (let step = 0; step < 12000; step++) {
      birds.update(step % 400 === 0 ? 2 : STEP);
      if (step % 100 !== 0) continue;
      bodyPositions(mesh).forEach((p, i) => {
        const r = horizontal(p, center.x, center.z);
        expect(r).toBeLessThanOrEqual(radius);
        expect(r).toBeGreaterThanOrEqual(radius * 0.6); // wide circles, not hovering at the center
        expect(p.y).toBeGreaterThanOrEqual(20);
        expect(p.y).toBeLessThanOrEqual(35);
        angles.set(i, Math.atan2(p.z - center.z, p.x - center.x));
      });
    }
    expect(angles.size).toBe(8);
  });

  it('goes round: in a minute a bird crosses its whole circle', () => {
    const birds = createBirds({ count: 1, radius: 60, height: 25, seed: 8, tier: 'high', reducedMotion: false });
    const mesh = instancedOf(birds.root, 'bird-wings');
    const start = bodyPositions(mesh)[0]!;
    let farthest = 0;
    for (let i = 0; i < 60 * 60; i++) {
      birds.update(STEP);
      const p = bodyPositions(mesh)[0]!;
      farthest = Math.max(farthest, Math.hypot(p.x - start.x, p.z - start.z));
    }
    expect(farthest).toBeGreaterThan(60); // the circle is 84 to 108 across
  });

  it('flaps its wings in bursts and spreads them into a V', () => {
    const birds = createBirds({ count: 1, radius: 60, height: 25, seed: 8, scale: 1, tier: 'high', reducedMotion: false });
    const mesh = instancedOf(birds.root, 'bird-wings');
    const tip = new THREE.Vector3(1.15, 0, -0.52);
    const rises: number[] = [];
    let span = 0;
    for (let i = 0; i < 60 * 40; i++) {
      birds.update(STEP);
      const left = tip.clone().applyMatrix4(matrixOf(mesh, 0));
      const right = tip.clone().applyMatrix4(matrixOf(mesh, 1));
      const body = bodyPositions(mesh)[0]!;
      rises.push(left.y - body.y);
      span = Math.max(span, left.distanceTo(right));
    }
    expect(span).toBeGreaterThan(2); // about 2.3 across at scale 1
    expect(span).toBeLessThan(3);
    expect(Math.max(...rises) - Math.min(...rises)).toBeGreaterThan(0.3); // the tip beats up and down
  });

  it('gives each bird a height of its own and some dark colors', () => {
    const birds = createBirds({ count: 12, height: 28, seed: 21, tier: 'high' });
    const mesh = instancedOf(birds.root, 'bird-wings');
    const heights = bodyPositions(mesh).map((p) => Math.round(p.y));
    expect(new Set(heights).size).toBeGreaterThan(3);
    const c = new THREE.Color();
    for (let i = 0; i < mesh.count; i++) {
      mesh.getColorAt(i, c);
      expect(Math.max(c.r, c.g, c.b)).toBeLessThan(0.1); // dark silhouettes (linear values)
    }
  });

  it('is not fogged (a dark shape on the sky, however far) and casts no shadow', () => {
    const mesh = instancedOf(createBirds({ tier: 'high' }).root, 'bird-wings');
    expect((mesh.material as THREE.MeshBasicMaterial).fog).toBe(false);
    expect(mesh.castShadow).toBe(false);
  });

  it('repeats the same flight for a seed and flies another for a different one', () => {
    const flight = (seed: number): number[] => {
      const b = createBirds({ count: 3, seed, tier: 'high', reducedMotion: false });
      run(b, 200);
      return snapshot(instancedOf(b.root, 'bird-wings'));
    };
    expect(flight(1)).toEqual(flight(1));
    expect(flight(1)).not.toEqual(flight(2));
  });

  it('freezes under reduced motion', () => {
    const b = createBirds({ count: 3, tier: 'high', reducedMotion: true });
    const mesh = instancedOf(b.root, 'bird-wings');
    const before = snapshot(mesh);
    run(b, 120);
    expect(snapshot(mesh)).toEqual(before);
    expect(b.root.visible).toBe(false);
  });

  it('clamps the count and frees its resources when disposed', () => {
    expect(instancedOf(createBirds({ count: 9999, tier: 'high' }).root, 'bird-wings').count).toBe(MAX_BIRDS * 2);
    expect(createBirds({ count: 0, tier: 'high' }).root.children).toHaveLength(0);
    const b = createBirds({ count: 2, tier: 'high' });
    const mesh = instancedOf(b.root, 'bird-wings');
    const spies = [vi.fn(), vi.fn()];
    mesh.geometry.addEventListener('dispose', spies[0]!);
    (mesh.material as THREE.Material).addEventListener('dispose', spies[1]!);
    b.dispose();
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
  });
});

// ---- fireflies --------------------------------------------------------------------------------------

describe('createFireflies', () => {
  it('is one Points draw call on every tier, the low one included', () => {
    for (const tier of TIERS) {
      const { root } = createFireflies({ count: 10, radius: 5, tier });
      expect(countDrawCalls(root)).toBe(1);
      expect(firefliesOf(root).geometry.getAttribute('position').count).toBe(10);
    }
  });

  it('drifts within the radius of the center and 0.5 to 2.4 above it, through a long run', () => {
    const center = { x: -3, y: 0.25, z: 9 };
    const radius = 6;
    const flies = createFireflies({ center, radius, count: 30, seed: 4, tier: 'high', reducedMotion: false });
    const positions = firefliesOf(flies.root).geometry.getAttribute('position');
    const start = Array.from(positions.array.slice(0, 90));
    for (let step = 0; step < 9000; step++) {
      flies.update(step % 700 === 0 ? 4 : STEP);
      if (step % 30 !== 0) continue;
      for (let i = 0; i < positions.count; i++) {
        expect(Math.hypot(positions.getX(i) - center.x, positions.getZ(i) - center.z)).toBeLessThanOrEqual(radius);
        expect(positions.getY(i)).toBeGreaterThanOrEqual(center.y + 0.5 - 1e-6);
        expect(positions.getY(i)).toBeLessThanOrEqual(center.y + 2.4 + 1e-6);
      }
    }
    expect(Array.from(positions.array.slice(0, 90))).not.toEqual(start); // they moved
  });

  it('pulses, with peaks above 1 so the bloom pass catches them, warm in color', () => {
    const flies = createFireflies({ count: 20, seed: 2, tier: 'high', reducedMotion: false });
    const colors = firefliesOf(flies.root).geometry.getAttribute('color');
    let peak = 0;
    let dim = Infinity;
    for (let step = 0; step < 60 * 90; step++) {
      flies.update(STEP);
      if (step % 10 !== 0) continue;
      for (let i = 0; i < colors.count; i++) {
        const r = colors.getX(i);
        const g = colors.getY(i);
        const b = colors.getZ(i);
        expect(r).toBeGreaterThan(0);
        expect(r).toBeGreaterThanOrEqual(g);
        expect(g).toBeGreaterThan(b); // warm: red over green over blue
        peak = Math.max(peak, r);
        dim = Math.min(dim, r);
      }
    }
    expect(peak).toBeGreaterThan(1.3);
    expect(dim).toBeLessThan(0.3);
  });

  it('is additive, unfogged, and not tone-mapped away (so the shared glow lift leaves it alone)', () => {
    const material = firefliesOf(createFireflies({ tier: 'high' }).root).material as THREE.PointsMaterial;
    expect(material.blending).toBe(THREE.AdditiveBlending);
    expect(material.depthWrite).toBe(false);
    expect(material.fog).toBe(false);
    expect(material.toneMapped).toBe(true);
    expect(material.vertexColors).toBe(true);
    expect(material.map).toBeInstanceOf(THREE.DataTexture);
  });

  it('repeats the same drift for a seed and drifts differently for another', () => {
    const drift = (seed: number): number[] => {
      const f = createFireflies({ count: 5, seed, tier: 'high', reducedMotion: false });
      run(f, 200);
      return Array.from(firefliesOf(f.root).geometry.getAttribute('position').array);
    };
    expect(drift(3)).toEqual(drift(3));
    expect(drift(3)).not.toEqual(drift(4));
  });

  it('freezes under reduced motion', () => {
    const f = createFireflies({ count: 5, tier: 'high', reducedMotion: true });
    const positions = firefliesOf(f.root).geometry.getAttribute('position');
    const before = Array.from(positions.array);
    run(f, 120);
    expect(Array.from(positions.array)).toEqual(before);
    expect(f.root.visible).toBe(false);
    expect(countDrawCalls(f.root)).toBe(0);
  });

  it('clamps the count and frees its geometry, material and dot texture when disposed', () => {
    expect(firefliesOf(createFireflies({ count: 9999, tier: 'high' }).root).geometry.getAttribute('position').count).toBe(MAX_FIREFLIES);
    expect(createFireflies({ count: 0, tier: 'high' }).root.children).toHaveLength(0);
    const f = createFireflies({ count: 4, tier: 'high' });
    const points = firefliesOf(f.root);
    const material = points.material as THREE.PointsMaterial;
    const spies = [vi.fn(), vi.fn(), vi.fn()];
    points.geometry.addEventListener('dispose', spies[0]!);
    material.addEventListener('dispose', spies[1]!);
    material.map!.addEventListener('dispose', spies[2]!);
    f.dispose();
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
    expect(f.root.children).toHaveLength(0);
  });
});
