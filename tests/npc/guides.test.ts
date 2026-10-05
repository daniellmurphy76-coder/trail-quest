import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { facingIntoZone } from '../../src/game/travel';
import {
  GUIDE_BODY_RADIUS,
  GUIDE_NOTICE_RADIUS,
  GUIDE_REACH,
  GUIDE_SPOTS,
  facingToward,
  guidePlacement,
  guideTargetFacing,
  installGuides,
  turnToward,
} from '../../src/npc/guides';
import { GUIDES, guideForZone, type GuideId, type GuideZoneId } from '../../src/npc/guide-types';
import { guideLabelHeight } from '../../src/npc/looks';
import { PLAYER_SPEED } from '../../src/player/controller';
import { isClear } from '../../src/world/collide';
import { findInteractableInRange, type Zone } from '../../src/world/zone';
import { createZone, ZONE_IDS, type ZoneDeps } from '../../src/world/zones';
import { laneIsClear, walkMap, type Point } from '../world/collider-helpers';

function makeDeps() {
  const deps = { onTalkToDenChief: vi.fn<() => void>(), onReturnToBaseCamp: vi.fn<() => void>() };
  return deps satisfies ZoneDeps;
}

const WALK_CAP = PLAYER_SPEED * 15; // "walking between stops is capped at about 15 seconds"
const TWO_PI = Math.PI * 2;

/** The smallest angle between two headings, 0 to PI. */
function angleBetween(a: number, b: number): number {
  const d = (((a - b) % TWO_PI) + TWO_PI) % TWO_PI;
  return Math.min(d, TWO_PI - d);
}

/**
 * Where a Scout walks first in each zone, as in tests/world/colliders.test.ts: the lane a guide must
 * never stand on. (The Nature Trail's is the trailhead landmark, so it is looked up from the zone.)
 */
const START_LANE: Record<GuideZoneId, (zone: Zone) => Point> = {
  'nature-trail': (zone) => zone.landmarks!.trailhead!,
  'town-square': () => ({ x: 0, z: 4 }),
  'fitness-field': () => ({ x: 0, z: -1.5 }),
  'safety-station': () => ({ x: 0, z: -1.4 }),
  'campfire-circle': () => ({ x: 0, z: 3 }),
};

/** Shortest distance from a point to the segment a-b. */
function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const lengthSq = dx * dx + dz * dz;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / lengthSq));
  return Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t));
}

describe('guide spots', () => {
  it('has one spot for each zone that has a guide, and none for Base Camp', () => {
    expect(Object.keys(GUIDE_SPOTS).sort()).toEqual(GUIDES.map((g) => g.zone).sort());
    expect(Object.keys(GUIDE_SPOTS)).not.toContain('base-camp');
    expect(ZONE_IDS.filter((id) => !(id in GUIDE_SPOTS))).toEqual(['base-camp']);
  });

  describe.each(GUIDES)('$role at the $zone', ({ zone: zoneId }) => {
    const zone = createZone(zoneId, makeDeps());
    const colliders = zone.colliders ?? [];
    const spot = GUIDE_SPOTS[zoneId];
    const spawn = zone.spawn;
    const sign = zone.interactables[0]!;
    const toSpot = { dx: spot.x - spawn.x, dz: spot.z - spawn.z };

    it('is in view from the spawn: 3.5 to 8 units ahead, within 40 degrees of the way the Scout faces', () => {
      const distance = Math.hypot(toSpot.dx, toSpot.dz);
      expect(distance).toBeGreaterThanOrEqual(3.5);
      expect(distance).toBeLessThanOrEqual(8);
      const off = angleBetween(Math.atan2(toSpot.dx, toSpot.dz), facingIntoZone(zone));
      expect(off).toBeLessThanOrEqual((40 * Math.PI) / 180);
    });

    it('stands inside the walkable area, clear of every prop', () => {
      const { minX, maxX, minZ, maxZ } = zone.bounds;
      expect(spot.x).toBeGreaterThan(minX);
      expect(spot.x).toBeLessThan(maxX);
      expect(spot.z).toBeGreaterThan(minZ);
      expect(spot.z).toBeLessThan(maxZ);
      expect(isClear(spot.x, spot.z, GUIDE_BODY_RADIUS, colliders)).toBe(true);
    });

    it('keeps 1.5 units from every open spot and landmark, so a pickup or marker is never behind a guide', () => {
      const places = [...(zone.openSpots ?? []), ...Object.values(zone.landmarks ?? {})];
      expect(places.length).toBeGreaterThan(0);
      for (const place of places) {
        expect(Math.hypot(place.x - spot.x, place.z - spot.z), `place at ${place.x.toFixed(1)}, ${place.z.toFixed(1)}`).toBeGreaterThanOrEqual(1.5);
      }
    });

    it('stays off the lane the Scout walks first, and off the straight line ahead of the spawn', () => {
      const lane = START_LANE[zoneId](zone);
      expect(distanceToSegment(spot, spawn, lane), 'first lane').toBeGreaterThanOrEqual(1.4);
      const ahead = { x: spawn.x + Math.sin(facingIntoZone(zone)) * 8, z: spawn.z + Math.cos(facingIntoZone(zone)) * 8 };
      expect(distanceToSegment(spot, spawn, ahead), 'straight ahead').toBeGreaterThanOrEqual(1.4);
      // And a Scout can still make that walk with the guide standing there (the guide is not a prop, but must not crowd it).
      expect(laneIsClear(spawn, lane, colliders)).toBe(true);
    });

    it('is outside the Trail sign\'s reach plus its own, and out of reach from the spawn', () => {
      expect(Math.hypot(sign.position.x - spot.x, sign.position.z - spot.z)).toBeGreaterThanOrEqual(sign.radius + GUIDE_REACH);
      expect(Math.hypot(toSpot.dx, toSpot.dz)).toBeGreaterThan(GUIDE_REACH);
      // With the guide added, standing at the spawn never offers a talk.
      const copy = createZone(zoneId, makeDeps());
      installGuides(copy, () => {});
      const near = findInteractableInRange(copy.spawn.x, copy.spawn.z, copy.interactables);
      expect(near?.id.startsWith('guide-') ?? false).toBe(false);
    });

    it('can be walked up to, within the 15 second walking cap', () => {
      const walked = walkMap(zone.bounds, colliders, spawn).distanceTo(spot.x, spot.z, GUIDE_REACH);
      expect(walked, 'a Scout can get within reach').not.toBeNull();
      expect(walked!).toBeLessThanOrEqual(WALK_CAP);
    });

    it('rests looking at the spawn', () => {
      const placement = guidePlacement(zone)!;
      expect(placement).toMatchObject(spot);
      const length = Math.hypot(toSpot.dx, toSpot.dz);
      expect(Math.sin(placement.facing)).toBeCloseTo(-toSpot.dx / length, 9);
      expect(Math.cos(placement.facing)).toBeCloseTo(-toSpot.dz / length, 9);
    });
  });

  it('gives Base Camp no placement', () => {
    expect(guidePlacement(createZone('base-camp', makeDeps()))).toBeUndefined();
  });
});

describe('installGuides', () => {
  it.each(GUIDES)('adds exactly one rig and one Talk spot to the $zone, after the zone is built', ({ id, zone: zoneId, role }) => {
    const zone = createZone(zoneId, makeDeps());
    const interactables = zone.interactables.length;
    const children = zone.root.children.length;
    expect(interactables).toBe(1); // the builder's own: the Trail sign
    const onTalk = vi.fn<(id: GuideId) => void>();

    const actor = installGuides(zone, onTalk)!;
    expect(actor.id).toBe(id);
    expect(zone.interactables).toHaveLength(interactables + 1);
    expect(zone.interactables[0]!.label).toBe('Back to camp'); // the sign stays first
    expect(zone.root.children).toHaveLength(children + 1);
    expect(zone.root.children).toContain(actor.rig.root);
    expect(actor.rig.root.name).toBe(`guide-${id}`);

    const talk = zone.interactables.at(-1)!;
    expect(talk).toBe(actor.interactable);
    expect(talk.id).toBe(`guide-${id}`);
    expect(talk.label).toBe('Talk');
    expect(talk.nameTag).toBe(role);
    expect(talk.radius).toBe(2);
    expect(talk.position.x).toBe(GUIDE_SPOTS[zoneId].x);
    expect(talk.position.z).toBe(GUIDE_SPOTS[zoneId].z);
    expect(talk.position.y).toBe(guideLabelHeight(id));
    expect(actor.rig.root.position.x).toBe(GUIDE_SPOTS[zoneId].x);
    expect(actor.rig.root.position.z).toBe(GUIDE_SPOTS[zoneId].z);
    expect(actor.rig.root.rotation.y).toBeCloseTo(actor.restingFacing, 9);

    // The Talk spot calls back with the guide's id.
    expect(onTalk).not.toHaveBeenCalled();
    talk.onInteract();
    expect(onTalk).toHaveBeenCalledTimes(1);
    expect(onTalk).toHaveBeenCalledWith(id);
  });

  it('only ever installs once for a zone that is built once and kept', () => {
    const zone = createZone('nature-trail', makeDeps());
    const first = installGuides(zone, () => {})!;
    const again = installGuides(zone, () => {})!;
    const third = installGuides(zone, () => {})!;
    expect(again).toBe(first);
    expect(third).toBe(first);
    expect(zone.interactables).toHaveLength(2);
    expect(zone.root.children.filter((child) => child.name === 'guide-ranger')).toHaveLength(1);
    expect(zone.interactables.filter((i) => i.id === 'guide-ranger')).toHaveLength(1);
  });

  it('gives each zone object its own guide', () => {
    const a = createZone('town-square', makeDeps());
    const b = createZone('town-square', makeDeps());
    expect(installGuides(a, () => {})).not.toBe(installGuides(b, () => {}));
    expect(a.interactables).toHaveLength(2);
    expect(b.interactables).toHaveLength(2);
  });

  it('gives Base Camp nothing: the Den Chief lives there', () => {
    const camp = createZone('base-camp', makeDeps());
    const interactables = camp.interactables.length;
    const children = camp.root.children.length;
    expect(installGuides(camp, () => {})).toBeUndefined();
    expect(camp.interactables).toHaveLength(interactables);
    expect(camp.interactables.map((i) => i.id)).toEqual(['den-chief']);
    expect(camp.root.children).toHaveLength(children);
  });

  it('covers every zone but Base Camp', () => {
    for (const id of ZONE_IDS) {
      const zone = createZone(id, makeDeps());
      const actor = installGuides(zone, () => {});
      expect(actor === undefined, id).toBe(id === 'base-camp');
      expect(guideForZone(id) === undefined, id).toBe(id === 'base-camp');
    }
  });
});

describe('guide life', () => {
  const fresh = (zoneId: 'nature-trail' | 'fitness-field' = 'nature-trail') => {
    const zone = createZone(zoneId, makeDeps());
    const actor = installGuides(zone, () => {})!;
    return { zone, actor, spot: GUIDE_SPOTS[zoneId] };
  };
  /** Run `seconds` of fixed steps with the Scout at (x, z). */
  const run = (actor: ReturnType<typeof fresh>['actor'], seconds: number, x: number, z: number, step = 1 / 60): void => {
    for (let t = 0; t < seconds; t += step) actor.update(step, x, z);
  };

  it('turns toward a Scout who comes close, and back to rest when they leave', () => {
    const { actor, spot } = fresh();
    const rest = actor.restingFacing;
    run(actor, 1, spot.x + 20, spot.z + 20); // far away: stays at rest
    expect(angleBetween(actor.rig.root.rotation.y, rest)).toBeLessThan(1e-9);

    const near = { x: spot.x + 3, z: spot.z }; // 3 units east of the guide
    run(actor, 2, near.x, near.z);
    expect(angleBetween(actor.rig.root.rotation.y, facingToward(spot, near))).toBeLessThan(1e-6);
    expect(angleBetween(actor.rig.root.rotation.y, facingToward(spot, near))).toBeLessThan(angleBetween(rest, facingToward(spot, near)) + 1e-9);

    run(actor, 2, spot.x + 20, spot.z + 20);
    expect(angleBetween(actor.rig.root.rotation.y, rest)).toBeLessThan(1e-6);
  });

  it('turns smoothly, not in one jump', () => {
    const { actor, spot } = fresh();
    const before = actor.rig.root.rotation.y;
    actor.update(1 / 60, spot.x - 3, spot.z + 1);
    const moved = angleBetween(actor.rig.root.rotation.y, before);
    expect(moved).toBeGreaterThan(0);
    expect(moved).toBeLessThanOrEqual((4 / 60) * 1.0001); // the turn speed is 4 radians a second
  });

  it('waves now and then, not all the time', () => {
    const { actor, spot } = fresh();
    const far = { x: spot.x + 20, z: spot.z + 20 };
    run(actor, 4, far.x, far.z);
    expect(actor.rig.emote).toBe('idle');
    run(actor, 4, far.x, far.z); // about 8 seconds in: the first wave is on
    let waves = 0;
    let waving = false;
    for (let t = 0; t < 40; t += 1 / 60) {
      actor.update(1 / 60, far.x, far.z);
      const now = actor.rig.emote === 'wave';
      if (now && !waving) waves += 1;
      waving = now;
    }
    expect(waves).toBeGreaterThanOrEqual(2); // 14 seconds apart, so two or three in 40 seconds
    expect(waves).toBeLessThanOrEqual(4);
  });

  it('waves soon after the Scout arrives', () => {
    const { actor, spot } = fresh('fitness-field');
    actor.welcome();
    run(actor, 1.3, spot.x + 20, spot.z + 20);
    expect(actor.rig.emote).toBe('wave');
  });

  it('keeps its ground: idling never moves the guide off the spot', () => {
    const { actor, spot } = fresh();
    run(actor, 20, spot.x + 2, spot.z + 2);
    expect(actor.rig.root.position.x).toBe(spot.x);
    expect(actor.rig.root.position.z).toBe(spot.z);
    expect(actor.rig.root.position.y).toBe(0);
  });
});

describe('guide turning helpers', () => {
  it('turns the short way round, across the PI seam', () => {
    expect(turnToward(3.0, -3.0, 0.1)).toBeCloseTo(3.1, 9); // up through PI, not back down through 0
    expect(turnToward(-3.0, 3.0, 0.1)).toBeCloseTo(-3.1, 9);
    expect(turnToward(0, 1, 0.25)).toBeCloseTo(0.25, 9);
    expect(turnToward(0, -1, 0.25)).toBeCloseTo(-0.25, 9);
  });

  it('lands exactly on the target when it is within one step', () => {
    expect(turnToward(1, 1.05, 0.1)).toBeCloseTo(1.05, 9);
    expect(turnToward(1, 1, 0.1)).toBe(1);
    expect(angleBetween(turnToward(3.1, -3.1, 1), -3.1)).toBeLessThan(1e-9);
  });

  it('faces the Scout inside the notice radius and the resting heading outside it', () => {
    const spot = { x: 2, z: 3 };
    const rest = 0.7;
    const inside = { x: 2 + GUIDE_NOTICE_RADIUS - 0.01, z: 3 };
    const outside = { x: 2 + GUIDE_NOTICE_RADIUS + 0.01, z: 3 };
    expect(guideTargetFacing(spot, rest, inside)).toBeCloseTo(Math.PI / 2, 9);
    expect(guideTargetFacing(spot, rest, outside)).toBe(rest);
    expect(GUIDE_NOTICE_RADIUS).toBeGreaterThan(GUIDE_REACH); // a guide notices a Scout before they can talk
  });

  it('looks from one point toward another the way a rotation about up does (front is +z)', () => {
    expect(facingToward({ x: 0, z: 0 }, { x: 0, z: 5 })).toBeCloseTo(0, 9);
    expect(facingToward({ x: 0, z: 0 }, { x: 5, z: 0 })).toBeCloseTo(Math.PI / 2, 9);
    expect(Math.abs(facingToward({ x: 0, z: 0 }, { x: 0, z: -5 }))).toBeCloseTo(Math.PI, 9);
    const v = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), facingToward({ x: 1, z: 1 }, { x: 4, z: 5 }));
    expect(v.x).toBeCloseTo(0.6, 9);
    expect(v.z).toBeCloseTo(0.8, 9);
  });
});
