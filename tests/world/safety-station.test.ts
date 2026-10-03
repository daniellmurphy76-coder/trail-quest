import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assets } from '../../src/engine/assets';
import { createSafetyStation, gapTo, OPEN_SPOT_CLEARANCE, SAFETY_STATION_KEEP_OUT } from '../../src/world/safety-station';
import { findInteractableInRange } from '../../src/world/zone';
import type { ZoneDeps } from '../../src/world/zones';

function makeDeps() {
  const deps = { onTalkToDenChief: vi.fn<() => void>(), onReturnToBaseCamp: vi.fn<() => void>() };
  return deps satisfies ZoneDeps;
}

/** Draw calls: one per visible Mesh, InstancedMesh or Sprite (every mesh here has one material). */
function drawCalls(root: THREE.Object3D): number {
  let n = 0;
  root.traverseVisible((o) => {
    if ((o as THREE.Mesh).isMesh || (o as THREE.Sprite).isSprite) n++;
  });
  return n;
}

function seatAngles(zone: ReturnType<typeof createSafetyStation>): number[] {
  return [0, 1].map((i) => zone.root.getObjectByName(`swing-seat-${i}`)!.rotation.x);
}

describe('Safety Station zone', () => {
  const deps = makeDeps();
  const zone = createSafetyStation(deps);
  const { bounds, spawn } = zone;
  const inside = (p: THREE.Vector3): boolean =>
    p.x >= bounds.minX && p.x <= bounds.maxX && p.z >= bounds.minZ && p.z <= bounds.maxZ;

  it('builds a zone with its own id, a scene root, and about 35 by 35 of lawn', () => {
    expect(zone.id).toBe('safety-station');
    expect(zone.root).toBeInstanceOf(THREE.Group);
    expect(zone.root.children.length).toBeGreaterThan(0);
    expect(bounds.maxX - bounds.minX).toBeGreaterThanOrEqual(34);
    expect(bounds.maxX - bounds.minX).toBeLessThanOrEqual(36);
    expect(bounds.maxZ - bounds.minZ).toBeGreaterThanOrEqual(34);
    expect(bounds.maxZ - bounds.minZ).toBeLessThanOrEqual(36);
    expect(zone.landmarks).toEqual({});
  });

  it('has the spawn inside the bounds, near the +z edge', () => {
    expect(inside(spawn)).toBe(true);
    expect(spawn.y).toBe(0);
    expect(spawn.z).toBeGreaterThan(bounds.maxZ - 6);
  });

  it('has 10 to 14 open spots, inside the bounds, at least 2 units apart', () => {
    const spots = zone.openSpots!;
    expect(spots.length).toBeGreaterThanOrEqual(10);
    expect(spots.length).toBeLessThanOrEqual(14);
    for (const spot of spots) expect(inside(spot)).toBe(true);
    for (let i = 0; i < spots.length; i++) {
      for (let j = i + 1; j < spots.length; j++) {
        expect(Math.hypot(spots[i]!.x - spots[j]!.x, spots[i]!.z - spots[j]!.z)).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('keeps open spots at least 1.5 from the spawn, and 3 from the Trail sign like the other zones', () => {
    const sign = zone.interactables[0]!;
    for (const spot of zone.openSpots!) {
      expect(Math.hypot(spot.x - spawn.x, spot.z - spawn.z)).toBeGreaterThanOrEqual(1.5);
      expect(Math.hypot(spot.x - sign.position.x, spot.z - sign.position.z)).toBeGreaterThanOrEqual(3);
    }
  });

  it('keeps open spots clear of every prop, the road and the fire station', () => {
    for (const spot of zone.openSpots!) {
      for (const k of SAFETY_STATION_KEEP_OUT) {
        expect(gapTo(spot.x, spot.z, k), `spot (${spot.x.toFixed(1)}, ${spot.z.toFixed(1)}) vs ${JSON.stringify(k)}`).toBeGreaterThanOrEqual(
          OPEN_SPOT_CLEARANCE,
        );
      }
    }
  });

  it('spreads open spots over the playground, the sidewalk and the lawn', () => {
    const spots = zone.openSpots!;
    expect(spots.filter((s) => s.x < -5 && s.z > 0).length).toBeGreaterThanOrEqual(2); // playground (left)
    expect(spots.filter((s) => s.z < -1.5 && s.z > -3.5).length).toBeGreaterThanOrEqual(2); // near sidewalk
    expect(spots.filter((s) => s.x > -5 && s.x < 8 && s.z > 2).length).toBeGreaterThanOrEqual(3); // lawn
  });

  it('places the same spots and the same trees every load (seeded)', () => {
    const again = createSafetyStation(makeDeps());
    expect(again.openSpots!.map((s) => [s.x, s.z])).toEqual(zone.openSpots!.map((s) => [s.x, s.z]));
    const treeMatrices = (z: ReturnType<typeof createSafetyStation>): number[] => {
      const trees = z.root.getObjectByName('trees')!.children[0] as THREE.InstancedMesh;
      return Array.from(trees.instanceMatrix.array);
    };
    expect(treeMatrices(again)).toEqual(treeMatrices(zone));
  });

  it('has one "Back to camp" Trail sign near the spawn that calls onReturnToBaseCamp', () => {
    const signs = zone.interactables.filter((i) => i.label === 'Back to camp');
    expect(signs).toHaveLength(1);
    expect(zone.interactables).toHaveLength(1);
    const sign = signs[0]!;
    expect(sign.id).toBe('trail-sign');
    expect(sign.nameTag).toBe('Trail sign');
    expect(sign.radius).toBe(2);
    expect(Math.hypot(sign.position.x - spawn.x, sign.position.z - spawn.z)).toBeLessThanOrEqual(6);
    expect(findInteractableInRange(spawn.x, spawn.z, zone.interactables)).toBeNull();
    expect(findInteractableInRange(sign.position.x, sign.position.z, zone.interactables)).toBe(sign);
    sign.onInteract();
    expect(deps.onReturnToBaseCamp).toHaveBeenCalledOnce();
    expect(deps.onTalkToDenChief).not.toHaveBeenCalled();
  });

  it('adds no lights (the environment lights every zone) and lets props cast shadows', () => {
    let lights = 0;
    let casters = 0;
    zone.root.traverse((o) => {
      if ((o as THREE.Light).isLight) lights++;
      if ((o as THREE.Mesh).isMesh && o.castShadow) casters++;
    });
    expect(lights).toBe(0);
    expect(casters).toBeGreaterThanOrEqual(10);
    expect(zone.root.getObjectByName('ground')!.castShadow).toBe(false);
  });

  it('draws the placeholder art in 26 calls or fewer (the swap adds a few, the budget is 90)', () => {
    const calls = drawCalls(zone.root);
    expect(calls).toBeLessThanOrEqual(26);
    expect(calls).toBeGreaterThanOrEqual(15); // not an empty clearing
  });

  it('builds the first-aid cross from two thin white boxes above the tent', () => {
    expect(zone.root.getObjectByName('first-aid-cross')).toBeDefined();
    expect(zone.root.getObjectByName('tent-primitive')).toBeDefined();
  });

  it('sways the two swing seats gently in update(dt)', () => {
    const fresh = createSafetyStation(makeDeps());
    const before = seatAngles(fresh);
    let peak = 0;
    let moved = false;
    for (let i = 0; i < 360; i++) {
      expect(() => fresh.update(1 / 60)).not.toThrow();
      const now = seatAngles(fresh);
      if (now[0] !== before[0] && now[1] !== before[1]) moved = true;
      peak = Math.max(peak, Math.abs(now[0]!), Math.abs(now[1]!));
    }
    expect(moved).toBe(true);
    expect(peak).toBeGreaterThan(0.1);
    expect(peak).toBeLessThan(0.4); // about 23 degrees at most: gentle
    const [a, b] = seatAngles(fresh);
    expect(a).not.toBeCloseTo(b!, 3); // the two seats do not swing in lockstep
  });
});

describe('Safety Station model swap (assets mocked)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Pretend the models loaded: every id is available as a one-box InstancedMesh named after the id. */
  function mockModels(missing: readonly string[] = []): void {
    vi.spyOn(assets, 'load').mockResolvedValue();
    vi.spyOn(assets, 'has').mockImplementation((id) => !missing.includes(id));
    vi.spyOn(assets, 'instanced').mockImplementation((id, count) => {
      if (missing.includes(id)) return undefined;
      const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial(), count);
      mesh.name = id;
      return mesh;
    });
  }

  const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

  it('replaces every primitive prop with its model and stays under the 90 draw-call budget', async () => {
    mockModels();
    const zone = createSafetyStation(makeDeps());
    const placeholderCalls = drawCalls(zone.root);
    await flush();
    for (const id of [
      'building.firestation',
      'building.house.a',
      'building.house.c',
      'street.straight',
      'street.crossing',
      'street.sign.stop',
      'street.lamp',
      'fence.simple',
      'signpost.single',
      'signpost',
      'tent.open',
      'rock.flat',
    ]) {
      expect(zone.root.getObjectByName(id), `model ${id}`).toBeDefined();
    }
    for (const name of [
      'firestation-primitive',
      'street-primitive',
      'stop-sign-primitive',
      'lamps-primitive',
      'fence-primitive',
      'meeting-sign-primitive',
      'tent-primitive',
      'sandbox-rocks-primitive',
      'trail-sign-primitive',
    ]) {
      expect(zone.root.getObjectByName(name), `primitive ${name}`).toBeUndefined();
    }
    // What the playground is made of never has a model, and the first-aid cross is always a primitive.
    expect(zone.root.getObjectByName('playground')).toBeDefined();
    expect(zone.root.getObjectByName('first-aid-cross')).toBeDefined();
    expect(zone.root.getObjectByName('swing-seat-0')).toBeDefined();

    const after = drawCalls(zone.root);
    expect(after).toBeLessThan(40);
    expect(after).toBeLessThan(90);
    expect(after).toBeGreaterThan(placeholderCalls - 5);
  });

  it('lifts the road models so the asphalt shows above the ground', async () => {
    mockModels();
    const zone = createSafetyStation(makeDeps());
    await flush();
    const straight = zone.root.getObjectByName('street.straight')!;
    expect(straight.position.y).toBeGreaterThan(0.05);
    expect((straight as THREE.InstancedMesh).count).toBe(6);
    expect((zone.root.getObjectByName('street.crossing') as THREE.InstancedMesh).count).toBe(1);
  });

  it('keeps the primitive street when only one of its two models loads, and swaps the rest', async () => {
    mockModels(['street.crossing']);
    const zone = createSafetyStation(makeDeps());
    await flush();
    expect(zone.root.getObjectByName('street-primitive')).toBeDefined();
    expect(zone.root.getObjectByName('street.straight')).toBeUndefined();
    expect(zone.root.getObjectByName('building.firestation')).toBeDefined();
  });

  it('keeps all the placeholder art when no model loads', async () => {
    vi.spyOn(assets, 'load').mockResolvedValue();
    vi.spyOn(assets, 'has').mockReturnValue(false);
    const zone = createSafetyStation(makeDeps());
    const before = drawCalls(zone.root);
    await flush();
    expect(drawCalls(zone.root)).toBe(before);
    expect(zone.root.getObjectByName('firestation-primitive')).toBeDefined();
  });

  it('keeps the placeholder art when loading fails, and says so once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(assets, 'load').mockRejectedValue(new Error('offline'));
    const zone = createSafetyStation(makeDeps());
    await flush();
    expect(warn).toHaveBeenCalled();
    expect(zone.root.getObjectByName('firestation-primitive')).toBeDefined();
  });
});
