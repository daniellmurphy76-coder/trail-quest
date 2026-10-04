import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { WorldPlaceOptions } from '../../src/activities/types';
import type { LabelOptions, WorldLabel } from '../../src/engine/labels';
import {
  BEACON_HEIGHT,
  BEACON_RADIUS,
  createWorldHost,
  DEFAULT_MARKER_RADIUS,
  DEFAULT_PICKUP_RADIUS,
  hashString,
  PICKUP_HEIGHT,
  pickupLook,
  type WorldHostOptions,
  type WorldHostTarget,
} from '../../src/game/world-host';

/** A world with a real THREE.Scene and fakes for everything that needs a browser. */
function setup(options: WorldHostOptions = {}) {
  const scene = new THREE.Scene();
  const player = new THREE.Vector3(0, 0, 0);
  const zone = {
    id: 'nature-trail' as string,
    openSpots: [new THREE.Vector3(3, 0, 4), new THREE.Vector3(-6, 0, 2)],
    landmarks: { footbridge: new THREE.Vector3(8, 0, -3) } as Record<string, THREE.Vector3>,
  };
  const labels: { options: LabelOptions; removed: boolean }[] = [];
  const updaters = new Set<(dt: number) => void>();
  const compass = { setTarget: vi.fn() };
  const onUpdate = vi.fn((fn: (dt: number) => void) => {
    updaters.add(fn);
    return () => updaters.delete(fn);
  });
  const target = {
    scene,
    zone: zone as WorldHostTarget['zone'],
    player: { position: player },
    labels: {
      add: (o: LabelOptions) => {
        const entry = { options: o, removed: false };
        labels.push(entry);
        return entry as unknown as WorldLabel;
      },
      remove: (l: WorldLabel) => {
        (l as unknown as { removed: boolean }).removed = true;
      },
    },
    compass,
    onUpdate,
  } satisfies WorldHostTarget;
  const host = createWorldHost(target, options);
  const step = (dt = 1 / 60, times = 1): void => {
    for (let i = 0; i < times; i++) for (const fn of [...updaters]) fn(dt);
  };
  const spawnOpts = (extra: Partial<WorldPlaceOptions> = {}): WorldPlaceOptions => ({
    id: 'bird',
    label: 'Bird',
    position: { x: 10, y: 0, z: 0 },
    onReach: vi.fn(),
    ...extra,
  });
  return { host, scene, player, zone, labels, updaters, compass, onUpdate, step, spawnOpts };
}

describe('world host: reading the world', () => {
  it('reports the zone, the player, the open spots and the landmarks as plain points', () => {
    const { host, player, zone } = setup();
    expect(host.zoneId()).toBe('nature-trail');
    player.set(1, 0, 2);
    expect(host.playerPosition()).toEqual({ x: 1, y: 0, z: 2 });
    expect(host.openSpots()).toEqual([
      { x: 3, y: 0, z: 4 },
      { x: -6, y: 0, z: 2 },
    ]);
    expect(host.openSpots()[0]).not.toBeInstanceOf(THREE.Vector3);
    expect(host.landmark('footbridge')).toEqual({ x: 8, y: 0, z: -3 });
    expect(host.landmark('nope')).toBeUndefined();
    expect(host.landmark('constructor')).toBeUndefined(); // not a prototype lookup
    zone.id = 'town-square'; // read live: follows travel
    expect(host.zoneId()).toBe('town-square');
  });

  it('copes with a zone that has no open spots or landmarks', () => {
    const { host, zone } = setup();
    delete (zone as { openSpots?: unknown }).openSpots;
    delete (zone as { landmarks?: unknown }).landmarks;
    expect(host.openSpots()).toEqual([]);
    expect(host.landmark('footbridge')).toBeUndefined();
  });
});

describe('world host: pickups', () => {
  it('adds a small colored shape 0.8 units up, with a name tag', () => {
    const { host, scene, labels, spawnOpts } = setup();
    host.spawnPickup(spawnOpts());
    const item = scene.getObjectByName('pickup:bird')!;
    expect(item).toBeDefined();
    expect(item.position.x).toBe(10);
    expect(item.position.y).toBeCloseTo(PICKUP_HEIGHT, 6);
    const mesh = item.children[0] as THREE.Mesh;
    expect(mesh.isMesh).toBe(true);
    mesh.geometry.computeBoundingBox();
    const size = mesh.geometry.boundingBox!.getSize(new THREE.Vector3());
    expect(Math.max(size.x, size.y, size.z)).toBeGreaterThan(0.3);
    expect(Math.max(size.x, size.y, size.z)).toBeLessThan(0.7); // about half a unit
    expect(labels).toHaveLength(1);
    expect(labels[0]!.options.text).toBe('Bird');
    expect(labels[0]!.options.priority).toBe(true); // never dropped for room, never faded by distance
    expect(labels[0]!.options.position.x).toBe(10);
  });

  it('bobs gently and spins slowly', () => {
    const { host, scene, step, spawnOpts } = setup();
    host.spawnPickup(spawnOpts());
    const item = scene.getObjectByName('pickup:bird')!;
    const ys = new Set<number>();
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < 240; i++) {
      step(1 / 60);
      ys.add(Math.round(item.position.y * 1000));
      minY = Math.min(minY, item.position.y);
      maxY = Math.max(maxY, item.position.y);
    }
    expect(ys.size).toBeGreaterThan(10);
    expect(minY).toBeGreaterThan(PICKUP_HEIGHT - 0.2);
    expect(maxY).toBeLessThan(PICKUP_HEIGHT + 0.2);
    expect(item.rotation.y).toBeGreaterThan(1); // 4 seconds of slow spin
    expect(item.rotation.y).toBeLessThan(10);
  });

  it('gives an id the same shape and color every time, and different ids a variety', () => {
    expect(pickupLook('bird')).toEqual(pickupLook('bird'));
    expect(hashString('bird')).toBe(hashString('bird'));
    const ids = ['bird', 'squirrel', 'rabbit', 'frog', 'pocketknife', 'rain-gear', 'trail-food', 'flashlight', 'backpack'];
    const looks = new Set(ids.map((id) => JSON.stringify(pickupLook(id))));
    expect(looks.size).toBeGreaterThanOrEqual(5);
    const { host, scene, spawnOpts } = setup();
    host.spawnPickup(spawnOpts({ id: 'frog' }));
    host.spawnPickup(spawnOpts({ id: 'frog', position: { x: 12, y: 0, z: 0 } }));
    const [a, b] = scene.children.map((c) => c.children[0] as THREE.Mesh);
    expect(a!.geometry).toBe(b!.geometry);
    expect(a!.material).toBe(b!.material);
  });

  it('fires onReach once, at 1.5 units on the ground by default, then removes the item and its tag', () => {
    const { host, scene, player, labels, step, spawnOpts, updaters } = setup();
    const onReach = vi.fn();
    host.spawnPickup(spawnOpts({ onReach }));
    expect(DEFAULT_PICKUP_RADIUS).toBe(1.5);

    player.set(8.51, 3, 0); // 1.49 away on the ground; height is ignored
    step();
    expect(onReach).toHaveBeenCalledTimes(1);
    expect(scene.getObjectByName('pickup:bird')).toBeUndefined();
    expect(labels[0]!.removed).toBe(true);
    step(1 / 60, 10);
    expect(onReach).toHaveBeenCalledTimes(1);
    expect(host.activeCount).toBe(0);
    expect(updaters.size).toBe(0); // nothing left to watch
  });

  it('does not fire from just outside the radius', () => {
    const { host, player, step, spawnOpts } = setup();
    const onReach = vi.fn();
    host.spawnPickup(spawnOpts({ onReach }));
    player.set(8.49, 0, 0); // 1.51 away
    step(1 / 60, 5);
    expect(onReach).not.toHaveBeenCalled();
    expect(host.activeCount).toBe(1);
  });

  it('honors a custom radius', () => {
    const { host, player, step, spawnOpts } = setup();
    const onReach = vi.fn();
    host.spawnPickup(spawnOpts({ onReach, radius: 3 }));
    player.set(7.5, 0, 0); // 2.5 away
    step();
    expect(onReach).toHaveBeenCalledOnce();
  });

  it('is not collected when its handle was removed', () => {
    const { host, scene, player, labels, step, spawnOpts } = setup();
    const onReach = vi.fn();
    const handle = host.spawnPickup(spawnOpts({ onReach }));
    handle.remove();
    handle.remove(); // twice is fine
    expect(scene.getObjectByName('pickup:bird')).toBeUndefined();
    expect(labels[0]!.removed).toBe(true);
    player.set(10, 0, 0);
    step();
    expect(onReach).not.toHaveBeenCalled();
  });
});

describe('world host: markers', () => {
  it('plants a tall translucent additive beacon, 0.4 by 6, with a name tag', () => {
    const { host, scene, labels, spawnOpts } = setup();
    host.spawnMarker(spawnOpts({ id: 'footbridge', label: 'Footbridge' }));
    const marker = scene.getObjectByName('marker:footbridge')!;
    expect(marker).toBeDefined();
    const beacon = marker.children[0] as THREE.Mesh;
    const geometry = beacon.geometry as THREE.CylinderGeometry;
    expect(geometry.parameters.radiusTop).toBe(BEACON_RADIUS);
    expect(geometry.parameters.height).toBe(BEACON_HEIGHT);
    expect(BEACON_RADIUS).toBe(0.4);
    expect(BEACON_HEIGHT).toBe(6);
    expect(beacon.position.y).toBe(3); // stands on the ground
    const material = beacon.material as THREE.MeshBasicMaterial;
    expect(material.transparent).toBe(true);
    expect(material.opacity).toBeLessThan(0.7);
    expect(material.blending).toBe(THREE.AdditiveBlending);
    expect(material.depthWrite).toBe(false);
    expect(labels[0]!.options.text).toBe('Footbridge');
    expect(labels[0]!.options.priority).toBe(true);
  });

  it('is reached within 2 units by default, once, and then goes away', () => {
    const { host, scene, player, step, spawnOpts } = setup();
    const onReach = vi.fn();
    host.spawnMarker(spawnOpts({ id: 'footbridge', onReach }));
    expect(DEFAULT_MARKER_RADIUS).toBe(2);
    player.set(8.1, 0, 0); // 1.9 away
    step(1 / 60, 3);
    expect(onReach).toHaveBeenCalledOnce();
    expect(scene.getObjectByName('marker:footbridge')).toBeUndefined();
  });

  it('is not reached from 2.1 units away', () => {
    const { host, player, step, spawnOpts } = setup();
    const onReach = vi.fn();
    host.spawnMarker(spawnOpts({ onReach }));
    player.set(7.9, 0, 0);
    step();
    expect(onReach).not.toHaveBeenCalled();
  });

  it('pulses its glow while it waits', () => {
    const { host, scene, step, spawnOpts } = setup();
    host.spawnMarker(spawnOpts());
    const material = ((scene.getObjectByName('marker:bird')!.children[0]) as THREE.Mesh).material as THREE.MeshBasicMaterial;
    const seen = new Set<number>();
    for (let i = 0; i < 120; i++) {
      step(1 / 60);
      seen.add(Math.round(material.opacity * 1000));
    }
    expect(seen.size).toBeGreaterThan(5);
  });
});

describe('world host: the compass', () => {
  it('points the HUD compass at a position, borrowing the name of what stands there', () => {
    const { host, compass, spawnOpts } = setup();
    host.spawnMarker(spawnOpts({ id: 'footbridge', label: 'Footbridge', position: { x: 8, y: 0, z: -3 } }));
    host.setCompassTarget({ x: 8, y: 0, z: -3 });
    expect(compass.setTarget).toHaveBeenLastCalledWith({ x: 8, z: -3 }, 'Footbridge');
    host.setCompassTarget({ x: 1, y: 0, z: 1 }); // nothing there: no name
    expect(compass.setTarget).toHaveBeenLastCalledWith({ x: 1, z: 1 }, '');
    host.setCompassTarget(null);
    expect(compass.setTarget).toHaveBeenLastCalledWith(null);
  });

  it('is cleared by clear()', () => {
    const { host, compass } = setup();
    host.clear();
    expect(compass.setTarget).toHaveBeenLastCalledWith(null);
  });
});

describe('world host: clearing and housekeeping', () => {
  it('clear() removes everything that was placed, with its tags, and never fires onReach', () => {
    const { host, scene, player, labels, step, spawnOpts, updaters } = setup();
    const onReach = vi.fn();
    host.spawnPickup(spawnOpts({ onReach }));
    host.spawnPickup(spawnOpts({ id: 'frog', onReach }));
    host.spawnMarker(spawnOpts({ id: 'lookout', onReach }));
    expect(host.activeCount).toBe(3);
    host.clear();
    expect(host.activeCount).toBe(0);
    expect(scene.children).toHaveLength(0);
    expect(labels.every((l) => l.removed)).toBe(true);
    expect(updaters.size).toBe(0);
    player.set(10, 0, 0);
    step();
    expect(onReach).not.toHaveBeenCalled();
  });

  it('registers with the loop only once something is placed, and only once', () => {
    const { host, onUpdate, spawnOpts, updaters } = setup();
    expect(onUpdate).not.toHaveBeenCalled();
    host.spawnPickup(spawnOpts());
    host.spawnPickup(spawnOpts({ id: 'frog' }));
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(updaters.size).toBe(1);
    host.clear();
    expect(updaters.size).toBe(0);
    host.spawnPickup(spawnOpts());
    expect(onUpdate).toHaveBeenCalledTimes(2); // and again when needed
  });

  it('quietly drops what was placed in a zone the player has left', () => {
    const { host, scene, zone, player, step, spawnOpts } = setup();
    const onReach = vi.fn();
    host.spawnPickup(spawnOpts({ onReach }));
    zone.id = 'base-camp';
    player.set(10, 0, 0); // standing right on it, but in another zone now
    step();
    expect(onReach).not.toHaveBeenCalled();
    expect(host.activeCount).toBe(0);
    expect(scene.children).toHaveLength(0);
  });

  it('lets onReach place the next thing (navigate does) and remove its own handle harmlessly', () => {
    const { host, scene, player, step, spawnOpts } = setup();
    let second = 0;
    let first: { remove(): void } | undefined;
    first = host.spawnMarker(
      spawnOpts({
        id: 'one',
        onReach: () => {
          first!.remove(); // already gone: a no-op
          host.spawnMarker(spawnOpts({ id: 'two', position: { x: 10, y: 0, z: 0 }, onReach: () => second++ }));
        },
      }),
    );
    player.set(10, 0, 0);
    step(); // reaches 'one', which places 'two' right here
    expect(host.activeCount).toBe(1);
    expect(scene.getObjectByName('marker:two')).toBeDefined();
    expect(second).toBe(0); // the new one is checked on the next step, not this one
    step();
    expect(second).toBe(1);
    expect(host.activeCount).toBe(0);
  });

  it('survives an onReach that throws, and still removes the item', () => {
    const { host, player, step, spawnOpts } = setup();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const other = vi.fn();
    host.spawnPickup(spawnOpts({ onReach: () => { throw new Error('oops'); } }));
    host.spawnPickup(spawnOpts({ id: 'frog', onReach: other }));
    player.set(10, 0, 0);
    expect(() => step()).not.toThrow();
    expect(error).toHaveBeenCalledOnce();
    expect(other).toHaveBeenCalledOnce(); // one bad callback does not stop the rest
    expect(host.activeCount).toBe(0);
    error.mockRestore();
  });
});

describe('world host: models', () => {
  it('uses a model from resolveModel in place of the primitive for a pickup', () => {
    const model = new THREE.Group();
    model.name = 'fancy-bird';
    const resolveModel = vi.fn((id: string) => (id === 'bird' ? model : undefined));
    const { host, scene, spawnOpts } = setup({ resolveModel });
    host.spawnPickup(spawnOpts());
    const item = scene.getObjectByName('pickup:bird')!;
    expect(resolveModel).toHaveBeenCalledWith('bird');
    expect(item.children).toEqual([model]);

    host.spawnPickup(spawnOpts({ id: 'frog' })); // resolver has none: back to the primitive
    const frog = scene.getObjectByName('pickup:frog')!;
    expect((frog.children[0] as THREE.Mesh).isMesh).toBe(true);
  });

  it('keeps the beacon on a marker and shows the model at its foot', () => {
    const model = new THREE.Group();
    const { host, scene, spawnOpts } = setup({ resolveModel: () => model });
    host.spawnMarker(spawnOpts({ id: 'footbridge' }));
    const marker = scene.getObjectByName('marker:footbridge')!;
    expect(marker.children).toHaveLength(2);
    expect((marker.children[0] as THREE.Mesh).isMesh).toBe(true);
    expect(marker.children[1]).toBe(model);
  });
});
