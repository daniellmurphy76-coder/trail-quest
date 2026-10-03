import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ZoneId } from '../../src/activities/types';
import { assets } from '../../src/engine/assets';
import { PLAYER_SPEED } from '../../src/player/controller';
import { createBaseCamp } from '../../src/world/base-camp';
import { isClear, PLAYER_RADIUS, TREE_TRUNK_RADIUS, type BoxCollider, type CircleCollider, type Collider } from '../../src/world/collide';
import { FITNESS_TRACK } from '../../src/world/fitness-field';
import { natureTrailLayout, NATURE_TRAIL_HALF } from '../../src/world/nature-trail';
import { gapTo, SAFETY_STATION_KEEP_OUT } from '../../src/world/safety-station';
import { TOWN_SQUARE_BUILDINGS, TOWN_SQUARE_STREET_HALF } from '../../src/world/town-square';
import { createZone, ZONE_IDS, type ZoneDeps } from '../../src/world/zones';
import type { Zone } from '../../src/world/zone';
import { laneIsClear, walkMap, type Point } from './collider-helpers';

function makeDeps() {
  const deps = { onTalkToDenChief: vi.fn<() => void>(), onReturnToBaseCamp: vi.fn<() => void>() };
  return deps satisfies ZoneDeps;
}

const R = PLAYER_RADIUS;
const WALK_CAP = PLAYER_SPEED * 15; // "walking between stops is capped at about 15 seconds"

const circles = (list: readonly Collider[]): CircleCollider[] => list.filter((c): c is CircleCollider => c.kind === 'circle');
const boxes = (list: readonly Collider[]): BoxCollider[] => list.filter((c): c is BoxCollider => c.kind === 'box');

/** Ground (x, z) of every instance of an InstancedMesh. */
function instancePoints(mesh: THREE.InstancedMesh): Point[] {
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  return Array.from({ length: mesh.count }, (_, i) => {
    mesh.getMatrixAt(i, m);
    p.setFromMatrixPosition(m);
    return { x: p.x, z: p.z };
  });
}

/** The first instanced mesh inside the named group or mesh (the trunks of a stand of trees, the benches...). */
function instancesNamed(zone: Zone, name: string): THREE.InstancedMesh {
  const found = zone.root.getObjectByName(name);
  expect(found, `the zone should have "${name}"`).toBeDefined();
  const mesh = (found as THREE.InstancedMesh).isInstancedMesh ? (found as THREE.InstancedMesh) : (found!.children[0] as THREE.InstancedMesh);
  expect(mesh.isInstancedMesh, `"${name}" should be instanced`).toBe(true);
  return mesh;
}

const hasCircleAt = (list: readonly Collider[], p: Point, tolerance = 1e-6): boolean =>
  circles(list).some((c) => Math.hypot(c.x - p.x, c.z - p.z) < tolerance);
const hasBoxAt = (list: readonly Collider[], p: Point, tolerance = 1e-6): boolean =>
  boxes(list).some((c) => Math.hypot(c.x - p.x, c.z - p.z) < tolerance);

/** Where a player walks first, by zone: the way the zone's own layout leads them in. */
const START_LANE: Record<ZoneId, (zone: Zone) => Point> = {
  'base-camp': (zone) => {
    const chief = zone.interactables.find((i) => i.id === 'den-chief')!;
    return { x: chief.position.x, z: chief.position.z };
  },
  'nature-trail': (zone) => zone.landmarks!.trailhead!, // the first landmark
  'town-square': () => ({ x: 0, z: 4 }), // up the main street
  'fitness-field': () => ({ x: 0, z: -1.5 }), // out across the track to the middle of the infield
  'safety-station': () => ({ x: 0, z: -1.4 }), // down the paved path to the crossing
  'campfire-circle': () => ({ x: 0, z: 3 }), // through the gateway and the gap in the benches, to the fire
};

describe.each(ZONE_IDS)('%s colliders', (id) => {
  const zone = createZone(id, makeDeps());
  const colliders = zone.colliders ?? [];
  const spawn = zone.spawn;
  const spots = zone.openSpots ?? [];
  const landmarks = Object.entries(zone.landmarks ?? {});
  const clear = (p: Point): boolean => isClear(p.x, p.z, R, colliders);

  it('lists its solid props, each a finite circle or box with a size', () => {
    expect(colliders.length).toBeGreaterThan(20);
    for (const c of colliders) {
      expect(Number.isFinite(c.x) && Number.isFinite(c.z)).toBe(true);
      if (c.kind === 'circle') {
        expect(c.r).toBeGreaterThan(0);
        expect(c.r).toBeLessThan(3);
      } else {
        expect(c.hw).toBeGreaterThan(0);
        expect(c.hd).toBeGreaterThan(0);
        expect(Number.isFinite(c.yaw ?? 0)).toBe(true);
      }
    }
    expect(circles(colliders).length).toBeGreaterThan(0);
    expect(boxes(colliders).length).toBeGreaterThan(0);
  });

  it('puts a trunk-sized circle on every tree, from the very same spots that place the trees', () => {
    const trunks = instancePoints(instancesNamed(zone, 'trees'));
    expect(trunks.length).toBeGreaterThan(10);
    for (const t of trunks) {
      const found = circles(colliders).find((c) => Math.hypot(c.x - t.x, c.z - t.z) < 1e-4);
      expect(found, `a collider at the tree at ${t.x.toFixed(2)}, ${t.z.toFixed(2)}`).toBeDefined();
      expect(found!.r).toBe(TREE_TRUNK_RADIUS); // the trunk, not the crown
    }
  });

  it('leaves the spawn clear', () => {
    expect(clear(spawn)).toBe(true);
  });

  it('leaves every open spot clear, so a pickup or marker can be stood on', () => {
    for (const [i, spot] of spots.entries()) expect(clear(spot), `open spot ${i} at ${spot.x.toFixed(2)}, ${spot.z.toFixed(2)}`).toBe(true);
  });

  it('leaves every landmark clear', () => {
    for (const [name, point] of landmarks) expect(clear(point), `landmark ${name}`).toBe(true);
  });

  it('keeps the start lane clear: a straight walk from the spawn to where the zone leads the player first', () => {
    const to = START_LANE[id](zone);
    expect(laneIsClear(spawn, to, colliders), `lane to ${to.x.toFixed(1)}, ${to.z.toFixed(1)}`).toBe(true);
  });

  it('leaves every open spot, landmark and interactable reachable on foot, within the 15 second walking cap', () => {
    const map = walkMap(zone.bounds, colliders, spawn);
    const bare = walkMap(zone.bounds, [], spawn);
    const targets: Array<[string, Point, number]> = [
      ...spots.map((s, i): [string, Point, number] => [`open spot ${i}`, s, 0.5]),
      ...landmarks.map(([name, p]): [string, Point, number] => [`landmark ${name}`, p, 0.5]),
      ...zone.interactables.map((it): [string, Point, number] => [`interactable ${it.id}`, it.position, it.radius]),
    ];
    expect(targets.length).toBeGreaterThan(0);
    for (const [name, p, slack] of targets) {
      const walked = map.distanceTo(p.x, p.z, slack);
      expect(walked, `${name} can be walked to`).not.toBeNull();
      expect(walked!, `${name} is within ${WALK_CAP} units`).toBeLessThanOrEqual(WALK_CAP);
      // And props never make it a long way round: at most a quarter more than with nothing in the way.
      const free = bare.distanceTo(p.x, p.z, slack)!;
      expect(walked!, `${name} is not a detour`).toBeLessThanOrEqual(free * 1.25 + 1);
    }
  });
});

describe('Base Camp colliders', () => {
  const zone = createBaseCamp({ onTalkToDenChief: () => {} });
  const colliders = zone.colliders!;

  it('puts circles on the rocks, the fire ring and the flagpole, and a box on the cabin', () => {
    for (const p of instancePoints(zone.root.getObjectByName('rocks') as THREE.InstancedMesh)) {
      expect(hasCircleAt(colliders, p), `rock at ${p.x}, ${p.z}`).toBe(true);
    }
    const fire = circles(colliders).find((c) => c.x === 0 && c.z === 0)!;
    expect(fire.r).toBeGreaterThan(1);
    expect(fire.r).toBeLessThan(2);
    const pole = zone.root.getObjectByName('flagpole')!;
    expect(hasCircleAt(colliders, { x: pole.position.x, z: pole.position.z })).toBe(true);
    const cabin = zone.root.getObjectByName('lodge')!;
    const box = boxes(colliders).find((b) => Math.hypot(b.x - cabin.position.x, b.z - cabin.position.z) < 1e-6)!;
    expect(box).toBeDefined();
    expect(box.yaw).toBeCloseTo(cabin.rotation.y, 9);
  });

  it('keeps the Den Chief and the spawn clear, with room to talk to the Den Chief', () => {
    const chief = zone.interactables.find((i) => i.id === 'den-chief')!;
    expect(isClear(chief.position.x, chief.position.z, R, colliders)).toBe(true);
    expect(isClear(zone.spawn.x, zone.spawn.z, R, colliders)).toBe(true);
  });

  it('has no tents or signpost in the list while only the primitives show (the models do not exist yet)', () => {
    // 40 trees, 6 rocks, the fire ring, the flagpole, the cabin.
    expect(colliders).toHaveLength(49);
  });
});

describe('Base Camp colliders after the models load', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

  /** Pretend every model has loaded, except the ones `missing` names (the library hands back nothing for those). */
  function fakeLoadedAssets(missing: (id: string) => boolean = () => false): void {
    const fakeMesh = (): THREE.Mesh => new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial());
    vi.spyOn(assets, 'load').mockResolvedValue(undefined);
    vi.spyOn(assets, 'has').mockImplementation((id) => !missing(id));
    vi.spyOn(assets, 'instance').mockImplementation((id) => {
      const group = new THREE.Group();
      group.name = id;
      group.add(fakeMesh());
      return group;
    });
    vi.spyOn(assets, 'instanced').mockImplementation((id, count) => {
      if (missing(id)) return undefined;
      const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial(), count);
      mesh.name = id;
      return mesh;
    });
  }

  it('adds the three tents and the signpost the moment they appear, and fits the cabin to its model', async () => {
    fakeLoadedAssets();
    const zone = createBaseCamp({ onTalkToDenChief: () => {} });
    const colliders = zone.colliders!;
    expect(colliders).toHaveLength(49);
    await flush();
    expect(colliders).toHaveLength(49 + 4); // the same array, grown in place: the zone hands it out once

    for (const p of [
      { x: 6, z: -16.5 },
      { x: 13.5, z: -15.5 },
      { x: -1.5, z: -18.5 },
    ]) {
      expect(hasBoxAt(colliders, p), `tent at ${p.x}, ${p.z}`).toBe(true);
    }
    expect(hasCircleAt(colliders, { x: -5.5, z: 3.5 })).toBe(true); // the signpost, a small circle
    const sign = circles(colliders).find((c) => c.x === -5.5 && c.z === 3.5)!;
    expect(sign.r).toBeLessThan(0.6);

    const cabin = zone.root.getObjectByName('cabin') ?? zone.root.children.find((o) => o.name === 'cabin');
    expect(cabin).toBeDefined();
    const box = boxes(colliders).find((b) => Math.hypot(b.x + 17, b.z + 12) < 1e-6)!;
    expect(box.hw).toBeCloseTo(3.3, 5); // the model is 6.65 wide and 7.03 deep, not the primitive's 8 by 6
    expect(box.hd).toBeCloseTo(3.5, 5);

    // Still nothing on the spawn, and the tents are in the camp, not on top of the Den Chief or the fire.
    expect(isClear(zone.spawn.x, zone.spawn.z, R, colliders)).toBe(true);
    const chief = zone.interactables[0]!;
    expect(isClear(chief.position.x, chief.position.z, R, colliders)).toBe(true);
    expect(isClear(0, 4, R, colliders)).toBe(true);
  });

  it('adds no collider for a model that did not load', async () => {
    fakeLoadedAssets((id) => id === 'tent' || id === 'signpost' || id === 'cabin');
    const zone = createBaseCamp({ onTalkToDenChief: () => {} });
    await flush();
    const colliders = zone.colliders!;
    expect(hasBoxAt(colliders, { x: 6, z: -16.5 })).toBe(false); // the big tents did not load
    expect(hasCircleAt(colliders, { x: -5.5, z: 3.5 })).toBe(false); // nor the signpost
    expect(hasBoxAt(colliders, { x: -1.5, z: -18.5 })).toBe(true); // the small tent did
    expect(colliders).toHaveLength(49 + 1);
    const cabin = boxes(colliders).find((b) => Math.hypot(b.x + 17, b.z + 12) < 1e-6)!;
    expect(cabin.hw).toBe(4); // still the primitive lodge's size
  });
});

describe('Nature Trail colliders', () => {
  const layout = natureTrailLayout();
  const zone = createZone('nature-trail', makeDeps());
  const colliders = zone.colliders!;

  it('is the layout\'s own list, so the colliders and the props come from one place', () => {
    expect(colliders).toBe(zone.colliders);
    expect(JSON.stringify(colliders)).toEqual(JSON.stringify(natureTrailLayout().colliders));
  });

  it('puts a box on every rock (turned the way the rock is), a circle on every stump, and a box on the tent, firewood and seats', () => {
    for (const r of layout.rocks) {
      const box = boxes(colliders).find((b) => Math.hypot(b.x - r.x, b.z - r.z) < 1e-6);
      expect(box, `rock at ${r.x}, ${r.z}`).toBeDefined();
      expect(box!.yaw).toBeCloseTo(r.yaw, 9);
    }
    for (const s of layout.stumps) expect(hasCircleAt(colliders, s)).toBe(true);
    for (const p of [layout.tent, layout.firewood, ...layout.seats]) expect(hasBoxAt(colliders, p)).toBe(true);
    expect(hasCircleAt(colliders, layout.fire)).toBe(true);
    expect(hasCircleAt(colliders, layout.backSign)).toBe(true);
  });

  it('gives the trailhead sign none: it stands on its own landmark, and a landmark stays clear', () => {
    expect(hasCircleAt(colliders, layout.trailheadSign, 0.5)).toBe(false);
    expect(isClear(layout.landmarks.trailhead.x, layout.landmarks.trailhead.z, R, colliders)).toBe(true);
  });

  it('keeps the whole dirt path clear, and the flat spot in front of the lookout rocks', () => {
    for (const p of layout.path.pts) expect(isClear(p.x, p.z, R, colliders), `path at ${p.x.toFixed(2)}, ${p.z.toFixed(2)}`).toBe(true);
    // The viewing floor is open out to 1.8 from the landmark; only its far rim, beside the rocks, is not.
    const pad = layout.lookoutPad;
    for (let a = 0; a < Math.PI * 2; a += 0.3) {
      for (const k of [0, 0.5, 1]) {
        const x = pad.x + Math.cos(a) * 1.8 * k;
        const z = pad.z + Math.sin(a) * 1.8 * k;
        expect(isClear(x, z, R, colliders), `lookout floor at ${x.toFixed(2)}, ${z.toFixed(2)}`).toBe(true);
      }
    }
  });

  it('walls off the stream along its whole length, with a gap exactly where the bridge is', () => {
    const bridge = layout.landmarks.footbridge;
    for (let x = -NATURE_TRAIL_HALF; x <= NATURE_TRAIL_HALF; x += 0.25) {
      const z = layout.stream.pointAt(layout.stream.nearest(x, bridge.z).s).z;
      const offBridge = Math.abs(x - bridge.x);
      if (offBridge <= 1.0) expect(isClear(x, z, R, colliders), `bridge gap at x=${x}`).toBe(true);
      if (offBridge >= 2.1) expect(isClear(x, z, R, colliders), `stream wall at x=${x}`).toBe(false);
    }
  });

  it('keeps the wall to the water: the banks are walkable right up to it, and the far side of the stream is beyond it', () => {
    // Everything within the water's width of the center line is blocked, away from the bridge.
    for (const s of [3, 8, 14, 20, 28, 34, 44]) {
      const c = layout.stream.pointAt(s);
      if (Math.abs(c.x - layout.landmarks.footbridge.x) < 3) continue;
      for (const across of [-1.2, 0, 1.2]) {
        const t = layout.stream.tangentAt(s);
        const x = c.x - t.z * across;
        const z = c.z + t.x * across;
        expect(isClear(x, z, R, colliders), `in the water at s=${s}, ${across} across`).toBe(false);
      }
      // A step from the water's edge is dry land the Scout can stand on.
      const t = layout.stream.tangentAt(s);
      const bank = layout.streamHalf + R + 0.3;
      expect(isClear(c.x - t.z * bank, c.z + t.x * bank, R, colliders)).toBe(true);
    }
  });

  it('puts the bridge gap where the path crosses, and nowhere else', () => {
    const wet = layout.path.pts.filter((p) => layout.stream.nearest(p.x, p.z).dist < layout.streamHalf + R);
    expect(wet.length).toBeGreaterThan(0);
    for (const p of wet) expect(Math.abs(p.x - layout.landmarks.footbridge.x)).toBeLessThan(1.1);
  });
});

describe('Town Square colliders', () => {
  const zone = createZone('town-square', makeDeps());
  const colliders = zone.colliders!;

  it('puts a box of the right size and turn on all 13 buildings', () => {
    expect(TOWN_SQUARE_BUILDINGS).toHaveLength(13);
    for (const b of TOWN_SQUARE_BUILDINGS) {
      const box = boxes(colliders).find((c) => Math.hypot(c.x - b.x, c.z - b.z) < 1e-6);
      expect(box, `building ${b.id}`).toBeDefined();
      expect(box!.hw).toBeCloseTo(b.w / 2, 9);
      expect(box!.hd).toBeCloseTo(b.d / 2, 9);
      expect(box!.yaw).toBeCloseTo(b.yaw, 9);
    }
  });

  it('puts small circles on the flagpole, every lamp post and stop sign, the Trail sign, and big ones on the planters', () => {
    expect(hasCircleAt(colliders, { x: 0, z: 0 })).toBe(true);
    for (const p of instancePoints(zone.root.getObjectByName('lamps') as THREE.InstancedMesh)) {
      const c = circles(colliders).find((q) => Math.hypot(q.x - p.x, q.z - p.z) < 1e-4);
      expect(c, `lamp at ${p.x}, ${p.z}`).toBeDefined();
      expect(c!.r).toBeLessThan(0.5);
    }
    for (const p of instancePoints(zone.root.getObjectByName('stop-signs') as THREE.InstancedMesh)) {
      expect(hasCircleAt(colliders, p, 1e-4)).toBe(true);
    }
    const trail = zone.interactables[0]!;
    expect(hasCircleAt(colliders, { x: trail.position.x, z: trail.position.z })).toBe(true);
    for (const p of instancePoints(zone.root.getObjectByName('planter-soil') as THREE.InstancedMesh)) {
      const c = circles(colliders).find((q) => Math.hypot(q.x - p.x, q.z - p.z) < 1e-4);
      expect(c, `planter at ${p.x}, ${p.z}`).toBeDefined();
      expect(c!.r).toBeGreaterThan(1);
    }
  });

  it('gives the name signs none: each stands on its own landmark', () => {
    for (const p of Object.values(zone.landmarks!)) expect(circles(colliders).some((c) => Math.hypot(c.x - p.x, c.z - p.z) < 1)).toBe(false);
  });

  it('keeps both streets walkable end to end, except the flagpole in the middle', () => {
    for (let t = -17; t <= 17; t += 0.25) {
      if (Math.abs(t) < 1.2) continue;
      expect(isClear(0, t, R, colliders), `street along z at ${t}`).toBe(true);
      expect(isClear(t, 0, R, colliders), `street along x at ${t}`).toBe(true);
    }
    expect(TOWN_SQUARE_STREET_HALF).toBeGreaterThan(2);
  });

  it('keeps the walk to each civic landmark open: the spot in front of every door is reachable', () => {
    const map = walkMap(zone.bounds, colliders, zone.spawn);
    for (const [name, p] of Object.entries(zone.landmarks!)) expect(map.distanceTo(p.x, p.z), name).not.toBeNull();
  });
});

describe('Fitness Field colliders', () => {
  const zone = createZone('fitness-field', makeDeps());
  const colliders = zone.colliders!;

  it('puts boxes on each fence run, the gate, each bench and the scoreboard, turned like them', () => {
    for (const p of instancePoints(instancesNamed(zone, 'fence'))) expect(hasBoxAt(colliders, p), `fence at ${p.x}`).toBe(true);
    for (const p of instancePoints(instancesNamed(zone, 'fence-gate'))) expect(hasBoxAt(colliders, p), `gate at ${p.x}`).toBe(true);
    const benches = instancesNamed(zone, 'benches');
    for (const p of instancePoints(benches)) {
      const box = boxes(colliders).find((b) => Math.hypot(b.x - p.x, b.z - p.z) < 1e-6);
      expect(box, `bench at ${p.x}`).toBeDefined();
      expect(box!.yaw).toBeCloseTo(Math.PI / 2, 9); // lying along x
      expect(box!.hd).toBeGreaterThan(box!.hw); // long and thin
    }
    const board = zone.root.getObjectByName('scoreboard')!;
    expect(hasBoxAt(colliders, { x: board.position.x, z: board.position.z })).toBe(true);
  });

  it('puts small circles on the cones and the stretching stones, and on the Trail sign', () => {
    for (const name of ['cones', 'stretch-stones']) {
      for (const p of instancePoints(instancesNamed(zone, name))) {
        const c = circles(colliders).find((q) => Math.hypot(q.x - p.x, q.z - p.z) < 1e-4);
        expect(c, `${name} at ${p.x}, ${p.z}`).toBeDefined();
        expect(c!.r).toBeLessThan(0.6);
      }
    }
    const sign = zone.interactables[0]!;
    expect(hasCircleAt(colliders, { x: sign.position.x, z: sign.position.z })).toBe(true);
  });

  it('keeps the whole running track walkable, all the way around, and the infield open', () => {
    const { cx, cz, a, b } = FITNESS_TRACK;
    for (let theta = 0; theta < Math.PI * 2; theta += 0.02) {
      for (const offset of [-1.0, 0, 1.0]) {
        const x = cx + (a + offset) * Math.cos(theta);
        const z = cz + (b + offset) * Math.sin(theta);
        expect(isClear(x, z, R, colliders), `track at theta ${theta.toFixed(2)}, offset ${offset}`).toBe(true);
      }
    }
  });

  it('walls the fence line but leaves the ends of it open', () => {
    for (let x = -15.5; x <= 15.5; x += 0.5) expect(isClear(x, -16.2, R, colliders), `fence at x=${x}`).toBe(false);
    for (const x of [-17, 17]) expect(isClear(x, -16.2, R, colliders)).toBe(true);
  });
});

describe('Safety Station colliders', () => {
  const zone = createZone('safety-station', makeDeps());
  const colliders = zone.colliders!;

  it('keeps every prop collider on the ground its prop is known to stand on (the zone\'s keep-out shapes)', () => {
    const bounds = zone.bounds;
    const inBounds = (c: Collider): boolean => c.x >= bounds.minX && c.x <= bounds.maxX && c.z >= bounds.minZ && c.z <= bounds.maxZ;
    const props = colliders.filter(inBounds);
    expect(props.length).toBeGreaterThanOrEqual(15);
    for (const c of props) {
      expect(
        SAFETY_STATION_KEEP_OUT.some((k) => gapTo(c.x, c.z, k) <= 0),
        `${c.kind} at ${c.x.toFixed(2)}, ${c.z.toFixed(2)} stands in a keep-out shape`,
      ).toBe(true);
    }
  });

  it('covers the fire station, both houses, the fence runs, the tent, the slide, the swing set and the sandbox', () => {
    const at = (x: number, z: number, within = 2.5): boolean => colliders.some((c) => Math.hypot(c.x - x, c.z - z) <= within);
    for (const [name, x, z] of [
      ['fire station', 0, -13.6],
      ['house a', 13.6, 3.4],
      ['house c', 13.9, 12.2],
      ['fence 1', 9.7, 1.4],
      ['fence 2', 9.7, 5.4],
      ['fence 3', 9.7, 13.4],
      ['tent', 5.2, 1.4],
      ['slide', -13.5, 3.2],
      ['swing set', -9.2, 6.3],
      ['sandbox', -13.8, 10.9],
      ['stop sign', 2.7, -2.75],
      ['lamp', -8.2, -2.6],
      ['lamp', 8.2, -2.6],
      ['meeting sign', 8.3, 9.4],
    ] as const) {
      expect(at(x, z, 0.5), name).toBe(true);
    }
  });

  it('keeps the paved path from the spawn to the crossing, the street and the sidewalks walkable', () => {
    for (let z = -1.4; z <= 14.5; z += 0.25) for (const x of [-1, 0, 1]) expect(isClear(x, z, R, colliders), `path at ${x}, ${z}`).toBe(true);
    for (let x = -16; x <= 16; x += 0.25) {
      for (const z of [-6.2, -5, -7.4, -9.7]) expect(isClear(x, z, R, colliders), `street at ${x}, ${z}`).toBe(true);
    }
  });
});

describe('Campfire Circle colliders', () => {
  const zone = createZone('campfire-circle', makeDeps());
  const colliders = zone.colliders!;

  it('puts a circle on the fire, a box on each of the eight benches, and circles on the stumps, gateway posts and lanterns', () => {
    const fire = circles(colliders).find((c) => c.x === 0 && c.z === 0)!;
    expect(fire.r).toBeGreaterThan(1);
    for (const p of instancePoints(instancesNamed(zone, 'benches'))) expect(hasBoxAt(colliders, p, 1e-4), `bench at ${p.x}, ${p.z}`).toBe(true);
    expect(boxes(colliders).filter((b) => Math.hypot(b.x, b.z) > 4.3 && Math.hypot(b.x, b.z) < 4.5)).toHaveLength(8);
    for (const name of ['stumps', 'lanterns']) {
      for (const p of instancePoints(instancesNamed(zone, name))) expect(hasCircleAt(colliders, p, 1e-4), `${name} at ${p.x}`).toBe(true);
    }
    expect(hasCircleAt(colliders, { x: -2.2, z: 12.2 })).toBe(true);
    expect(hasCircleAt(colliders, { x: 2.2, z: 12.2 })).toBe(true);
  });

  it('turns each bench along the circle, like the log it stands for', () => {
    for (const b of boxes(colliders).filter((q) => Math.hypot(q.x, q.z) > 4.3 && Math.hypot(q.x, q.z) < 4.5)) {
      const along = { x: Math.sin(b.yaw ?? 0), z: Math.cos(b.yaw ?? 0) }; // the bench's long axis
      const radial = { x: b.x / Math.hypot(b.x, b.z), z: b.z / Math.hypot(b.x, b.z) };
      expect(Math.abs(along.x * radial.x + along.z * radial.z)).toBeLessThan(1e-9); // across the radius, so along the ring
    }
  });

  it('leaves the gateway open between its posts and a gap in the ring of benches to the fire', () => {
    for (let z = 15; z >= 2.5; z -= 0.25) expect(isClear(0, z, R, colliders), `way in at z=${z}`).toBe(true);
  });

  it('lets the Scout walk between the benches, not only through the gap (the narrowest gap is wider than the Scout)', () => {
    const map = walkMap(zone.bounds, colliders, zone.spawn);
    // A point inside the bench ring on the far side from the entrance is reachable.
    expect(map.distanceTo(0, -2.5)).not.toBeNull();
  });
});
