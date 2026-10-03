import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { ZoneId } from '../../src/activities/types';
import type { FollowTarget } from '../../src/engine/camera';
import { createZoneTraveler, facingIntoZone, type TravelDeps } from '../../src/game/travel';
import { squareBounds } from '../../src/world/bounds';
import { createNatureTrail } from '../../src/world/nature-trail';
import type { Zone } from '../../src/world/zone';

/** A bare zone: a named group, bounds and a spawn. */
function fakeZone(id: ZoneId, spawn: [number, number, number], half = 25): Zone {
  const root = new THREE.Group();
  root.name = id;
  return { id, root, bounds: squareBounds(half), spawn: new THREE.Vector3(...spawn), interactables: [], update: () => {} };
}

function setup(overrides: Partial<TravelDeps> = {}) {
  const scene = new THREE.Scene();
  const camp = fakeZone('base-camp', [0, 0, 9]);
  scene.add(camp.root);
  const events: string[] = [];
  const built: ZoneId[] = [];
  const player = { setPosition: vi.fn((p: THREE.Vector3, facing?: number) => void events.push(`player:${p.x},${p.z},${facing}`)) };
  const followTarget: FollowTarget = { position: new THREE.Vector3(), facing: 0, isMoving: false };
  const follow = { snapTo: vi.fn(() => void events.push('snap')) };
  const veil = {
    fadeOut: vi.fn(async () => void events.push('fade-out')),
    fadeIn: vi.fn(async () => void events.push('fade-in')),
  };
  const onSwap = vi.fn((zone: Zone, previous: Zone) => void events.push(`swap:${previous.id}->${zone.id}`));
  const zones: Partial<Record<ZoneId, Zone>> = {
    'nature-trail': fakeZone('nature-trail', [0, 0, 12], 15),
    'town-square': fakeZone('town-square', [6, 0, 0], 15),
  };
  const traveler = createZoneTraveler({
    scene,
    initial: camp,
    createZone: (id) => {
      built.push(id);
      const zone = zones[id];
      if (!zone) throw new Error(`no zone ${id}`);
      return zone;
    },
    player,
    follow,
    followTarget,
    veil,
    onSwap,
    ...overrides,
  });
  return { scene, camp, zones, traveler, events, built, player, follow, followTarget, veil, onSwap };
}

describe('facingIntoZone', () => {
  it('looks from the spawn toward the middle of the walkable area', () => {
    // Base Camp: spawn at +z, camp at the origin: look down -z, which is heading PI.
    expect(facingIntoZone({ spawn: new THREE.Vector3(0, 0, 9), bounds: squareBounds(25) })).toBeCloseTo(Math.PI, 6);
    // Spawn on the +x side: look toward -x.
    expect(facingIntoZone({ spawn: new THREE.Vector3(12, 0, 0), bounds: squareBounds(15) })).toBeCloseTo(-Math.PI / 2, 6);
    // Off-center bounds count too.
    const f = facingIntoZone({
      spawn: new THREE.Vector3(0, 0, 0),
      bounds: { minX: 0, maxX: 20, minZ: 0, maxZ: 0 },
    });
    expect(f).toBeCloseTo(Math.PI / 2, 6);
  });

  it('keeps the default view when the spawn is in the middle', () => {
    expect(facingIntoZone({ spawn: new THREE.Vector3(0, 0, 0), bounds: squareBounds(10) })).toBe(Math.PI);
  });
});

describe('zone traveler: travelTo', () => {
  it('swaps the zone in the scene, moves the player to the spawn facing in, and snaps the camera', async () => {
    const { scene, camp, zones, traveler, player, follow, followTarget } = setup();
    expect(traveler.zone).toBe(camp);
    await traveler.travelTo('nature-trail');

    expect(traveler.zone).toBe(zones['nature-trail']);
    expect(scene.children).toContain(zones['nature-trail']!.root);
    expect(scene.children).not.toContain(camp.root);
    expect(player.setPosition).toHaveBeenCalledOnce();
    const [spawn, facing] = player.setPosition.mock.calls[0]!;
    expect(spawn).toBe(zones['nature-trail']!.spawn);
    expect(facing).toBeCloseTo(Math.PI, 6); // spawn at +z of the middle: looking down -z
    expect(follow.snapTo).toHaveBeenCalledWith(followTarget);
  });

  it('fades out, swaps while the screen is covered, then fades in', async () => {
    const { traveler, events, onSwap, zones, camp } = setup();
    await traveler.travelTo('nature-trail');
    expect(events).toEqual(['fade-out', 'player:0,12,' + Math.PI, 'snap', 'swap:base-camp->nature-trail', 'fade-in']);
    expect(onSwap).toHaveBeenCalledWith(zones['nature-trail'], camp);
  });

  it('does nothing when the player is already in that zone', async () => {
    const { traveler, veil, player, built, onSwap } = setup();
    await traveler.travelTo('base-camp');
    expect(veil.fadeOut).not.toHaveBeenCalled();
    expect(player.setPosition).not.toHaveBeenCalled();
    expect(onSwap).not.toHaveBeenCalled();
    expect(built).toEqual([]);
  });

  it('builds each zone once and keeps it: a second visit returns the same zone with its state', async () => {
    const { traveler, built, scene, camp, zones } = setup();
    await traveler.travelTo('nature-trail');
    await traveler.travelTo('base-camp');
    expect(traveler.zone).toBe(camp);
    expect(scene.children).toContain(camp.root);
    expect(scene.children).not.toContain(zones['nature-trail']!.root);
    await traveler.travelTo('nature-trail');
    expect(built).toEqual(['nature-trail']); // base camp was the initial zone, never built here
    expect(traveler.zone).toBe(zones['nature-trail']);
  });

  it('goes from one zone straight to another, leaving only the new one in the scene', async () => {
    const { traveler, scene, zones } = setup();
    await traveler.travelTo('nature-trail');
    await traveler.travelTo('town-square');
    const roots = scene.children.filter((c) => c instanceof THREE.Group);
    expect(roots).toEqual([zones['town-square']!.root]);
  });

  it('queues trips: asking while one is under way waits for it', async () => {
    const { traveler, events } = setup();
    const a = traveler.travelTo('nature-trail');
    const b = traveler.travelTo('town-square');
    const c = traveler.travelTo('town-square'); // already there by the time it runs
    await Promise.all([a, b, c]);
    expect(events.filter((e) => e.startsWith('swap:'))).toEqual([
      'swap:base-camp->nature-trail',
      'swap:nature-trail->town-square',
    ]);
    expect(events.filter((e) => e === 'fade-out')).toHaveLength(2);
    expect(traveler.zone.id).toBe('town-square');
  });

  it('rejects when the zone cannot be built, changes nothing on screen, and the next trip still works', async () => {
    const { traveler, veil, scene, camp } = setup();
    await expect(traveler.travelTo('fitness-field')).rejects.toThrow('no zone fitness-field');
    expect(veil.fadeOut).not.toHaveBeenCalled();
    expect(traveler.zone).toBe(camp);
    expect(scene.children).toContain(camp.root);
    await traveler.travelTo('nature-trail');
    expect(traveler.zone.id).toBe('nature-trail');
  });

  it('never leaves the screen covered, even if the swap throws', async () => {
    const onSwap = vi.fn(() => {
      throw new Error('boom');
    });
    const { traveler, veil } = setup({ onSwap });
    await expect(traveler.travelTo('nature-trail')).rejects.toThrow('boom');
    expect(veil.fadeIn).toHaveBeenCalledOnce();
  });
});

describe('zone traveler: jumpTo', () => {
  it('swaps at once with no fade, and does nothing when already there', async () => {
    const { traveler, veil, zones, player, onSwap } = setup();
    traveler.jumpTo('nature-trail');
    expect(traveler.zone).toBe(zones['nature-trail']);
    expect(veil.fadeOut).not.toHaveBeenCalled();
    expect(veil.fadeIn).not.toHaveBeenCalled();
    expect(player.setPosition).toHaveBeenCalledOnce();
    expect(onSwap).toHaveBeenCalledOnce();
    traveler.jumpTo('nature-trail');
    expect(player.setPosition).toHaveBeenCalledOnce();
  });
});

describe('zone traveler with a real placeholder zone', () => {
  it('puts the player at the Nature Trail spawn, inside its bounds, looking toward the clearing', async () => {
    const deps = { onTalkToDenChief: vi.fn(), onReturnToBaseCamp: vi.fn() };
    const trail = createNatureTrail(deps);
    const { traveler, player } = setup({ createZone: () => trail });
    await traveler.travelTo('nature-trail');
    expect(traveler.zone.openSpots!.length).toBeGreaterThanOrEqual(10);
    const [spawn, facing] = player.setPosition.mock.calls[0]!;
    expect(spawn).toBe(trail.spawn);
    expect(spawn.x).toBeGreaterThanOrEqual(trail.bounds.minX);
    expect(spawn.z).toBeLessThanOrEqual(trail.bounds.maxZ);
    // Walk one step along the facing: it must bring the player closer to the middle.
    const before = Math.hypot(spawn.x, spawn.z);
    const after = Math.hypot(spawn.x + Math.sin(facing!), spawn.z + Math.cos(facing!));
    expect(after).toBeLessThan(before);
  });
});
