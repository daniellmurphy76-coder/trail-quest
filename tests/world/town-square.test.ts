import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assets } from '../../src/engine/assets';
import {
  createTownSquare,
  insideFootprint,
  TOWN_SQUARE_BUILDINGS,
  TOWN_SQUARE_HALF,
  TOWN_SQUARE_PROPS,
  TOWN_SQUARE_STREET_HALF,
} from '../../src/world/town-square';
import { findInteractableInRange } from '../../src/world/zone';
import type { ZoneDeps } from '../../src/world/zones';

function makeDeps() {
  const deps = { onTalkToDenChief: vi.fn<() => void>(), onReturnToBaseCamp: vi.fn<() => void>() };
  return deps satisfies ZoneDeps;
}

/** One draw call per visible Mesh, InstancedMesh or Sprite (every material in the zone is a single one). */
function drawCalls(root: THREE.Object3D): number {
  let n = 0;
  root.traverseVisible((o) => {
    if ((o as THREE.Mesh).isMesh || (o as THREE.Sprite).isSprite) n++;
  });
  return n;
}

const visibleNames = (root: THREE.Object3D): string[] => {
  const out: string[] = [];
  root.traverseVisible((o) => out.push(o.name));
  return out;
};

interface Pose {
  x: number;
  y: number;
  z: number;
  /** Turn about the up axis. */
  yaw: number;
}

/** Position and yaw of every instance of an InstancedMesh. */
function poses(mesh: THREE.InstancedMesh): Pose[] {
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const out: Pose[] = [];
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, m);
    m.decompose(p, q, s);
    out.push({ x: p.x, y: p.y, z: p.z, yaw: new THREE.Euler().setFromQuaternion(q, 'YXZ').y });
  }
  return out;
}

const dist = (a: { x: number; z: number }, b: { x: number; z: number }): number => Math.hypot(a.x - b.x, a.z - b.z);

/** True when the ground point is on a street tile (the streets run 19.25 units out from the middle). */
function onStreet(x: number, z: number, margin = 0): boolean {
  const reach = 19.25 + margin;
  const half = TOWN_SQUARE_STREET_HALF + margin;
  return (Math.abs(x) < half && Math.abs(z) <= reach) || (Math.abs(z) < half && Math.abs(x) <= reach);
}

describe('Town Square zone', () => {
  const deps = makeDeps();
  const zone = createTownSquare(deps);
  const { bounds, spawn } = zone;
  const inside = (p: { x: number; z: number }): boolean =>
    p.x >= bounds.minX && p.x <= bounds.maxX && p.z >= bounds.minZ && p.z <= bounds.maxZ;
  const mesh = (name: string): THREE.InstancedMesh => zone.root.getObjectByName(name) as THREE.InstancedMesh;
  const spots = zone.openSpots!;
  const landmarks = zone.landmarks!;

  it('builds a zone with its own id and a scene root, and carries no lights', () => {
    expect(zone.id).toBe('town-square');
    expect(zone.root).toBeInstanceOf(THREE.Group);
    expect(zone.root.children.length).toBeGreaterThan(0);
    let lights = 0;
    zone.root.traverse((o) => {
      if ((o as THREE.Light).isLight) lights++;
    });
    expect(lights).toBe(0);
  });

  it('has bounds about 36 across with the spawn inside, near the +z edge', () => {
    expect(bounds).toEqual({ minX: -TOWN_SQUARE_HALF, maxX: TOWN_SQUARE_HALF, minZ: -TOWN_SQUARE_HALF, maxZ: TOWN_SQUARE_HALF });
    expect(bounds.maxX - bounds.minX).toBeGreaterThanOrEqual(34);
    expect(bounds.maxX - bounds.minX).toBeLessThanOrEqual(36);
    expect(inside(spawn)).toBe(true);
    expect(spawn.y).toBe(0);
    expect(spawn.z).toBeGreaterThanOrEqual(bounds.maxZ - 5); // the +z end, so the player looks into the square
    expect(onStreet(spawn.x, spawn.z)).toBe(true); // standing on the main street
  });

  it('has 10 to 14 open spots, inside the bounds and at least 2 units apart', () => {
    expect(spots.length).toBeGreaterThanOrEqual(10);
    expect(spots.length).toBeLessThanOrEqual(14);
    for (const spot of spots) {
      expect(inside(spot)).toBe(true);
      expect(spot.y).toBe(0);
    }
    for (let i = 0; i < spots.length; i++) {
      for (let j = i + 1; j < spots.length; j++) expect(dist(spots[i]!, spots[j]!)).toBeGreaterThanOrEqual(2);
    }
  });

  it('keeps the open spots at least 1.5 from the spawn and every landmark', () => {
    for (const spot of spots) {
      expect(dist(spot, spawn)).toBeGreaterThanOrEqual(1.5);
      for (const l of Object.values(landmarks)) expect(dist(spot, l)).toBeGreaterThanOrEqual(1.5);
    }
  });

  it('keeps the open spots clear of every prop, building and tree trunk', () => {
    const trunks = poses(mesh('tree-trunks'));
    for (const spot of spots) {
      for (const p of TOWN_SQUARE_PROPS) expect(dist(spot, p)).toBeGreaterThanOrEqual(p.r + 0.5);
      for (const b of TOWN_SQUARE_BUILDINGS) expect(insideFootprint(spot.x, spot.z, b, 0.5), `spot in ${b.id}`).toBe(false);
      for (const tree of trunks) expect(dist(spot, tree)).toBeGreaterThanOrEqual(1.5);
    }
  });

  it('places the same layout every load (seeded)', () => {
    const again = createTownSquare(makeDeps());
    expect(again.openSpots!.map((s) => [s.x, s.z])).toEqual(spots.map((s) => [s.x, s.z]));
    for (const name of ['tree-crowns', 'plant-tufts', 'building-walls']) {
      const a = Array.from((again.root.getObjectByName(name) as THREE.InstancedMesh).instanceMatrix.array);
      expect(a, name).toEqual(Array.from(mesh(name).instanceMatrix.array));
    }
  });

  describe('landmarks', () => {
    const civic = TOWN_SQUARE_BUILDINGS.slice(0, 4);

    it('names the four civic buildings, all inside the bounds', () => {
      expect(Object.keys(landmarks).sort()).toEqual(['fire-station', 'library', 'school', 'store']);
      expect(civic.map((b) => b.id).sort()).toEqual(['fire-station', 'library', 'school', 'store']);
      for (const point of Object.values(landmarks)) expect(inside(point)).toBe(true);
    });

    it('puts each one on the plaza side of its building, in front of the door, off every footprint', () => {
      for (const b of civic) {
        const l = landmarks[b.id]!;
        // Its own frame: x along the wall, z out of the door.
        const dx = l.x - b.x;
        const dz = l.z - b.z;
        const lx = dx * Math.cos(b.yaw) - dz * Math.sin(b.yaw);
        const lz = dx * Math.sin(b.yaw) + dz * Math.cos(b.yaw);
        expect(Math.abs(lx), `${b.id} sideways offset`).toBeLessThan(0.01);
        expect(lz - b.d / 2, `${b.id} gap in front of the door`).toBeGreaterThan(1);
        expect(lz - b.d / 2).toBeLessThan(3.5);
        for (const other of TOWN_SQUARE_BUILDINGS) expect(insideFootprint(l.x, l.z, other, 0.5)).toBe(false);
      }
    });

    it('has the four buildings in the four corners, each facing the middle of the plaza', () => {
      const corners = new Set(civic.map((b) => `${Math.sign(b.x)},${Math.sign(b.z)}`));
      expect(corners.size).toBe(4);
      for (const b of civic) {
        const toMiddle = new THREE.Vector2(-b.x, -b.z).normalize();
        const front = new THREE.Vector2(Math.sin(b.yaw), Math.cos(b.yaw));
        expect(front.dot(toMiddle), `${b.id} faces the plaza`).toBeGreaterThan(0.99);
      }
    });

    it('hangs a named group at each landmark', () => {
      for (const [id, point] of Object.entries(landmarks)) {
        const group = zone.root.getObjectByName(`landmark:${id}`);
        expect(group, id).toBeDefined();
        expect(group!.position.x).toBeCloseTo(point.x, 6);
        expect(group!.position.z).toBeCloseTo(point.z, 6);
      }
    });
  });

  describe('layout', () => {
    it('lays a cross of streets through the middle: 8 straight, 4 crossing, 1 intersection', () => {
      expect(mesh('street-straight').count).toBe(8);
      expect(mesh('street-crossing').count).toBe(4);
      expect(mesh('street-intersection').count).toBe(1);
      for (const name of ['street-straight', 'street-crossing', 'street-intersection']) {
        for (const p of poses(mesh(name))) expect(Math.min(Math.abs(p.x), Math.abs(p.z)), name).toBeLessThan(1e-9);
      }
      // The long arm runs both ways along z (the way the player looks) and along x.
      const straight = poses(mesh('street-straight'));
      expect(straight.filter((p) => Math.abs(p.x) < 1e-9 && p.z > 0)).toHaveLength(2);
      expect(straight.filter((p) => Math.abs(p.x) < 1e-9 && p.z < 0)).toHaveLength(2);
      expect(straight.filter((p) => Math.abs(p.z) < 1e-9)).toHaveLength(4);
    });

    it('keeps every building off the streets', () => {
      for (const b of TOWN_SQUARE_BUILDINGS) {
        for (let u = -1; u <= 1; u += 0.25) {
          for (let v = -1; v <= 1; v += 0.25) {
            // A point inside the footprint, turned from its own frame into the world.
            const lx = (u * b.w) / 2;
            const lz = (v * b.d) / 2;
            const x = b.x + lx * Math.cos(b.yaw) + lz * Math.sin(b.yaw);
            const z = b.z - lx * Math.sin(b.yaw) + lz * Math.cos(b.yaw);
            expect(onStreet(x, z), `${b.id} at ${x.toFixed(1)}, ${z.toFixed(1)}`).toBe(false);
          }
        }
      }
    });

    it('stands the houses outside the walkable square, all around the edges but around the spawn', () => {
      const houses = TOWN_SQUARE_BUILDINGS.slice(4);
      expect(houses.length).toBeGreaterThanOrEqual(6);
      for (const h of houses) {
        expect(Math.max(Math.abs(h.x), Math.abs(h.z)), h.id).toBeGreaterThan(TOWN_SQUARE_HALF + 2);
        expect(Math.hypot(h.x - spawn.x, h.z - spawn.z), h.id).toBeGreaterThan(14); // the camera trails the player
      }
      expect(houses.some((h) => h.x < -18)).toBe(true);
      expect(houses.some((h) => h.x > 18)).toBe(true);
      expect(houses.some((h) => h.z < -18)).toBe(true);
    });

    it('keeps the plaza, streets and buildings free of trees and plants', () => {
      const trees = poses(mesh('tree-crowns'));
      const plants = poses(mesh('plant-tufts'));
      expect(trees.length).toBeGreaterThanOrEqual(10);
      expect(plants.length).toBeGreaterThanOrEqual(60);
      for (const t of [...trees, ...plants]) {
        expect(Math.hypot(t.x, t.z)).toBeGreaterThan(11);
        expect(onStreet(t.x, t.z)).toBe(false);
        for (const b of TOWN_SQUARE_BUILDINGS) expect(insideFootprint(t.x, t.z, b)).toBe(false);
      }
    });

    it('stands two stop signs and four planters, all inside the bounds', () => {
      expect(mesh('stop-signs').count).toBe(2);
      for (const p of poses(mesh('stop-signs'))) expect(inside(p)).toBe(true);
      expect(mesh('planter-soil').count).toBe(4);
      for (const p of poses(mesh('planter-soil'))) expect(Math.hypot(p.x, p.z)).toBeGreaterThan(5);
    });

    it('builds the merged stand-ins with vertex colors (not the one-box fallback)', () => {
      for (const name of ['street-straight', 'street-crossing', 'street-intersection', 'lamps', 'stop-signs']) {
        const geometry = mesh(name).geometry;
        expect(geometry.getAttribute('color'), `${name} color`).toBeDefined();
        expect(geometry.getAttribute('position').count, `${name} vertices`).toBeGreaterThan(100);
      }
      const trailSign = zone.root.getObjectByName('trail-sign')!.children[0] as THREE.Mesh;
      expect(trailSign.geometry.getAttribute('color')).toBeDefined();
    });

    it('turns every lamp arm toward the street or the plaza', () => {
      const lamps = poses(mesh('lamps'));
      expect(lamps.length).toBeGreaterThanOrEqual(8);
      for (const l of lamps) {
        // The arm runs toward local -z, which is (-sin yaw, -cos yaw) in the world.
        const tip = { x: l.x - Math.sin(l.yaw) * 1.78, z: l.z - Math.cos(l.yaw) * 1.78 };
        expect(Math.min(Math.abs(tip.x), Math.abs(tip.z))).toBeLessThan(Math.min(Math.abs(l.x), Math.abs(l.z)) - 1);
      }
    });
  });

  describe('the Trail sign', () => {
    it('is one "Back to camp" interactable near the spawn, out of range at the spawn', () => {
      const signs = zone.interactables.filter((i) => i.label === 'Back to camp');
      expect(signs).toHaveLength(1);
      expect(zone.interactables).toHaveLength(1);
      const sign = signs[0]!;
      expect(sign.id).toBe('trail-sign');
      expect(sign.nameTag).toBe('Trail sign');
      expect(sign.radius).toBe(2);
      expect(dist(sign.position, spawn)).toBeLessThanOrEqual(6);
      expect(inside(sign.position)).toBe(true);
      expect(findInteractableInRange(spawn.x, spawn.z, zone.interactables)).toBeNull();
      expect(findInteractableInRange(sign.position.x, sign.position.z, zone.interactables)).toBe(sign);
      expect(zone.root.getObjectByName('trail-sign')).toBeDefined();
    });

    it('calls onReturnToBaseCamp, and nothing else, when used', () => {
      const own = makeDeps();
      const z = createTownSquare(own);
      z.interactables.find((i) => i.label === 'Back to camp')!.onInteract();
      expect(own.onReturnToBaseCamp).toHaveBeenCalledOnce();
      expect(own.onTalkToDenChief).not.toHaveBeenCalled();
    });
  });

  it('stays under 36 draw calls with placeholders (about 24; the swap adds a few)', () => {
    expect(drawCalls(zone.root)).toBeLessThan(36);
  });

  it('runs update(dt) without error, and flutters the flag', () => {
    const flagpole = zone.root.children.find((c) => c.type === 'Group' && c.children.length === 3 && c.position.y > 0)!;
    expect(flagpole).toBeDefined();
    const flag = flagpole.children[2]!;
    const before = flag.rotation.y;
    for (let i = 0; i < 120; i++) expect(() => zone.update(1 / 60)).not.toThrow();
    expect(flag.rotation.y).not.toBe(before);
    expect(Math.abs(flag.rotation.y)).toBeLessThan(0.2);
  });
});

describe('Town Square model swap', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Pretend the models that `loaded` accepts have loaded: a one-mesh stand-in per id. */
  function fakeAssets(loaded: (id: string) => boolean): void {
    const box = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshBasicMaterial();
    vi.spyOn(assets, 'load').mockResolvedValue(undefined);
    vi.spyOn(assets, 'has').mockImplementation(loaded);
    vi.spyOn(assets, 'instanced').mockImplementation((id: string, count: number) => {
      if (!loaded(id)) return undefined;
      const m = new THREE.InstancedMesh(box, material, count);
      m.name = id;
      return m;
    });
    vi.spyOn(assets, 'instance').mockImplementation((id: string) => {
      const g = new THREE.Group();
      g.name = id;
      g.add(new THREE.Mesh(box, material));
      return g;
    });
  }

  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

  it('swaps every model in, drops the primitives, and stays under 60 draw calls', async () => {
    fakeAssets(() => true);
    const zone = createTownSquare(makeDeps());
    const before = drawCalls(zone.root);
    await settle();
    const names = visibleNames(zone.root);

    const models = [
      'street.straight',
      'street.crossing',
      'street.intersection',
      'street.lamp',
      'street.sign.stop',
      'building.library',
      'building.school',
      'building.firestation',
      'building.store',
      'building.house.a',
      'building.house.b',
      'building.house.c',
      'tree.round',
      'rock.flat',
      'plant.bush',
      'plant.flower.yellow',
      'plant.flower.red',
      'signpost',
    ];
    for (const id of models) expect(names, `${id} should be in the scene`).toContain(id);
    const primitives = [
      'street-straight',
      'street-crossing',
      'street-intersection',
      'lamps',
      'stop-signs',
      'building-walls',
      'building-roofs',
      'building-doors',
      'tree-trunks',
      'tree-crowns',
      'planter-stones',
      'planter-bushes',
      'planter-flowers',
      'plant-tufts',
    ];
    for (const id of primitives) expect(names, `primitive ${id} should be gone`).not.toContain(id);
    // The flagpole, the island, the planter beds and the name signs have no model: they stay.
    for (const keep of ['plaza-island', 'planter-soil', 'landmark-posts', 'landmark-caps', 'ground']) expect(names).toContain(keep);

    const after = drawCalls(zone.root);
    expect(after).toBeLessThan(60); // 35 in practice
    expect(after).toBeGreaterThanOrEqual(before);
    expect(() => zone.update(1 / 60)).not.toThrow();
  });

  it('turns the stop sign models so their faces (toward -x) look along the street', async () => {
    fakeAssets(() => true);
    const zone = createTownSquare(makeDeps());
    await settle();
    const signs = poses(zone.root.getObjectByName('street.sign.stop') as THREE.InstancedMesh);
    expect(signs).toHaveLength(2);
    for (const s of signs) {
      // Local -x in the world: (-cos yaw, +sin yaw). One sign faces +z (walkers from the south), one -z.
      const face = { x: -Math.cos(s.yaw), z: Math.sin(s.yaw) };
      expect(Math.abs(face.x)).toBeLessThan(1e-6);
      expect(Math.abs(face.z)).toBeCloseTo(1, 6);
    }
    expect(Math.sign(Math.sin(signs[0]!.yaw))).toBe(-Math.sign(Math.sin(signs[1]!.yaw)));
    expect(signs[0]!.z).toBeGreaterThan(0);
    expect(Math.sin(signs[0]!.yaw)).toBeGreaterThan(0); // the sign on the south side looks at the walkers coming in
  });

  it('lifts the street models a little so they sit proud of the flat ground', async () => {
    fakeAssets(() => true);
    const zone = createTownSquare(makeDeps());
    await settle();
    for (const id of ['street.straight', 'street.crossing', 'street.intersection']) {
      expect(zone.root.getObjectByName(id)!.position.y, id).toBeGreaterThan(0);
    }
  });

  it('keeps the primitive of any model that does not load, and retires only what was replaced', async () => {
    fakeAssets((id) => id === 'building.library');
    const zone = createTownSquare(makeDeps());
    await settle();
    const names = visibleNames(zone.root);
    expect(names).toContain('building.library');
    for (const keep of ['building-walls', 'building-roofs', 'building-doors', 'street-straight', 'lamps', 'tree-crowns', 'trail-sign']) {
      expect(names).toContain(keep);
    }
    const walls = zone.root.getObjectByName('building-walls') as THREE.InstancedMesh;
    const [library, school] = poses(walls); // civic buildings come first, library first
    expect(library!.y).toBeLessThan(-50);
    expect(school!.y).toBe(0);
    expect(drawCalls(zone.root)).toBeLessThanOrEqual(30);
  });

  it('keeps every primitive when no model loads', async () => {
    fakeAssets(() => false);
    const zone = createTownSquare(makeDeps());
    const before = drawCalls(zone.root);
    await settle();
    expect(drawCalls(zone.root)).toBe(before);
    expect(visibleNames(zone.root)).toContain('building-walls');
  });

  it('keeps the primitives if the asset library rejects', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(assets, 'load').mockRejectedValue(new Error('offline'));
    const zone = createTownSquare(makeDeps());
    await settle();
    expect(visibleNames(zone.root)).toContain('building-walls');
    expect(warn).toHaveBeenCalled();
  });

  it('keeps the other swaps going when one of them fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fakeAssets(() => true);
    vi.spyOn(assets, 'instance').mockImplementation(() => {
      throw new Error('broken signpost');
    });
    const zone = createTownSquare(makeDeps());
    await settle();
    const names = visibleNames(zone.root);
    expect(names).toContain('building.store'); // later steps still ran
    expect(names).toContain('trail-sign');
    expect(names).not.toContain('signpost'); // the sign keeps its primitive
    expect(warn).toHaveBeenCalled();
  });
});
