import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { ActivitySpec, ZoneId } from '../../src/activities/types';
import { listRankContent } from '../../src/content/load';
import { createFitnessField } from '../../src/world/fitness-field';
import { createNatureTrail } from '../../src/world/nature-trail';
import { createCampfireCircle } from '../../src/world/campfire-circle';
import { createSafetyStation } from '../../src/world/safety-station';
import { createTownSquare } from '../../src/world/town-square';
import { createZone, ZONE_IDS, ZONE_LABELS, type ZoneDeps } from '../../src/world/zones';
import { findInteractableInRange } from '../../src/world/zone';
import { HORIZON_MAX_DRAW_CALLS, HORIZON_MAX_TRIANGLES, horizonStats } from '../../src/world/horizon';

function makeDeps() {
  const deps = { onTalkToDenChief: vi.fn<() => void>(), onReturnToBaseCamp: vi.fn<() => void>() };
  return deps satisfies ZoneDeps;
}

const OTHER_ZONES = ZONE_IDS.filter((id) => id !== 'base-camp');

/** The place names each zone floats over the world (Zone.labels). */
const PLACE_NAMES: Partial<Record<ZoneId, string[]>> = {
  'fitness-field': ['Fitness Field'],
  'nature-trail': ['Trailhead sign', 'Footbridge', 'Lookout rock', 'Campsite'],
  'town-square': ['Library', 'School', 'Fire station', 'Grocery store'],
  'safety-station': ['Safe meeting spot', 'First aid'],
  'campfire-circle': ['Back to camp'],
};

/** Every navigate waypoint id the real content uses, by zone. */
function contentWaypoints(): Map<ZoneId, Set<string>> {
  const byZone = new Map<ZoneId, Set<string>>();
  const visit = (spec: ActivitySpec | undefined): void => {
    if (spec?.type !== 'navigate') return;
    const set = byZone.get(spec.params.zone) ?? new Set<string>();
    for (const w of spec.params.waypoints) set.add(w.id);
    byZone.set(spec.params.zone, set);
  };
  for (const content of listRankContent()) {
    for (const adventure of content.adventures) {
      for (const requirement of adventure.requirements) {
        visit(requirement.activity);
        visit(requirement.practice);
      }
    }
  }
  return byZone;
}

describe('zone registry', () => {
  it('lists all six zones once, with a label each', () => {
    expect([...ZONE_IDS].sort()).toEqual(
      ['base-camp', 'campfire-circle', 'fitness-field', 'nature-trail', 'safety-station', 'town-square'].sort(),
    );
    expect(new Set(ZONE_IDS).size).toBe(6);
    expect(ZONE_IDS[0]).toBe('base-camp');
    for (const id of ZONE_IDS) expect(ZONE_LABELS[id].length).toBeGreaterThan(0);
    expect(ZONE_LABELS['nature-trail']).toBe('Nature Trail');
  });

  it('builds Base Camp through the existing builder and hands it the Den Chief callback', () => {
    const deps = makeDeps();
    const camp = createZone('base-camp', deps);
    expect(camp.id).toBe('base-camp');
    const chief = camp.interactables.find((i) => i.id === 'den-chief')!;
    chief.onInteract();
    expect(deps.onTalkToDenChief).toHaveBeenCalledOnce();
    expect(deps.onReturnToBaseCamp).not.toHaveBeenCalled();
  });

  it('exports one builder per placeholder zone with a stable name', () => {
    const deps = makeDeps();
    expect(createNatureTrail(deps).id).toBe('nature-trail');
    expect(createTownSquare(deps).id).toBe('town-square');
    expect(createFitnessField(deps).id).toBe('fitness-field');
    expect(createSafetyStation(deps).id).toBe('safety-station');
    expect(createCampfireCircle(deps).id).toBe('campfire-circle');
  });
});

describe.each(OTHER_ZONES)('placeholder zone %s', (id) => {
  const deps = makeDeps();
  const zone = createZone(id, deps);
  const { bounds, spawn } = zone;
  const inside = (p: THREE.Vector3): boolean =>
    p.x >= bounds.minX && p.x <= bounds.maxX && p.z >= bounds.minZ && p.z <= bounds.maxZ;

  it('builds a zone with its own id and a scene root', () => {
    expect(zone.id).toBe(id);
    expect(zone.root).toBeInstanceOf(THREE.Group);
    expect(zone.root.children.length).toBeGreaterThan(0);
    expect(() => zone.update(1 / 60)).not.toThrow();
  });

  it('has real bounds about 30 units across, with the spawn inside', () => {
    expect(bounds.maxX).toBeGreaterThan(bounds.minX);
    expect(bounds.maxZ).toBeGreaterThan(bounds.minZ);
    expect(bounds.maxX - bounds.minX).toBeGreaterThanOrEqual(25);
    expect(bounds.maxX - bounds.minX).toBeLessThanOrEqual(35);
    expect(inside(spawn)).toBe(true);
    expect(spawn.y).toBe(0);
  });

  it('has 10 to 14 open spots, inside the bounds and at least 2 units apart', () => {
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

  it('keeps the open spots clear of the spawn, the Trail sign and every landmark', () => {
    const sign = zone.interactables.find((i) => i.id === 'trail-sign')!;
    const blockers = [spawn, sign.position, ...Object.values(zone.landmarks ?? {})];
    for (const spot of zone.openSpots!) {
      for (const b of blockers) expect(Math.hypot(spot.x - b.x, spot.z - b.z)).toBeGreaterThanOrEqual(3);
    }
  });

  it('places the same spots every time (seeded)', () => {
    const again = createZone(id, makeDeps());
    expect(again.openSpots!.map((s) => [s.x, s.z])).toEqual(zone.openSpots!.map((s) => [s.x, s.z]));
  });

  it('has a landmark signpost for each navigate waypoint the content names for it', () => {
    const wanted = contentWaypoints().get(id) ?? new Set<string>();
    const landmarks = zone.landmarks ?? {};
    for (const waypoint of wanted) {
      const point = landmarks[waypoint];
      expect(point, `${id} should have a landmark for "${waypoint}"`).toBeDefined();
      expect(inside(point!)).toBe(true);
      expect(zone.root.getObjectByName(`landmark:${waypoint}`), `signpost for ${waypoint}`).toBeDefined();
    }
  });

  it('carries its place names as label data, up in the air inside the walls', () => {
    const labels = zone.labels ?? [];
    expect(labels.map((l) => l.text).sort()).toEqual([...(PLACE_NAMES[id] ?? [])].sort());
    for (const label of labels) {
      expect(inside(label.position), label.text).toBe(true);
      expect(label.position.y, label.text).toBeGreaterThan(1.5);
    }
  });

  it('has one Trail sign, "Back to camp", near the spawn, that is not in range at the spawn', () => {
    const signs = zone.interactables.filter((i) => i.label === 'Back to camp');
    expect(signs).toHaveLength(1);
    const sign = signs[0]!;
    expect(sign.nameTag).toBe('Trail sign');
    expect(zone.interactables).toHaveLength(1); // landmarks are not interactable
    expect(Math.hypot(sign.position.x - spawn.x, sign.position.z - spawn.z)).toBeLessThanOrEqual(6);
    expect(findInteractableInRange(spawn.x, spawn.z, zone.interactables)).toBeNull();
    expect(findInteractableInRange(sign.position.x, sign.position.z, zone.interactables)).toBe(sign);
    sign.onInteract();
    expect(deps.onReturnToBaseCamp).toHaveBeenCalledOnce();
    expect(deps.onTalkToDenChief).not.toHaveBeenCalled();
  });

  it('stays well inside the draw-call budget (the horizon is 3 of these)', () => {
    let calls = 0;
    zone.root.traverseVisible((o) => {
      if ((o as THREE.Mesh).isMesh || (o as THREE.Sprite).isSprite) calls++;
    });
    expect(calls).toBeLessThan(30);
  });

  it('has a horizon behind the walls of trees: hills, a tree line, and mountains or rooftops, within budget', () => {
    const horizon = zone.root.getObjectByName('horizon')!;
    expect(horizon).toBeDefined();
    const stats = horizonStats(horizon);
    expect(stats.drawCalls).toBeLessThanOrEqual(HORIZON_MAX_DRAW_CALLS);
    expect(stats.triangles).toBeLessThanOrEqual(HORIZON_MAX_TRIANGLES);
    const hills = horizon.getObjectByName('horizon-hills') as THREE.Mesh;
    const position = hills.geometry.getAttribute('position');
    for (let i = 0; i < position.count; i++) {
      expect(Math.max(Math.abs(position.getX(i)), Math.abs(position.getZ(i)))).toBeGreaterThan(bounds.maxX);
    }
  });

  it('has a textured, rolling ground with the apron under it', () => {
    const ground = zone.root.getObjectByName('ground') as THREE.Mesh;
    expect((ground.material as THREE.Material).userData.groundTexture).toBeDefined();
    expect(zone.root.getObjectByName('ground-apron')).toBeDefined();
  });
});

describe('zones with navigate content', () => {
  it('give the Nature Trail and Town Square landmarks for the ids content uses today', () => {
    const deps = makeDeps();
    expect(Object.keys(createNatureTrail(deps).landmarks!).sort()).toEqual(
      ['campsite', 'footbridge', 'lookout', 'trailhead'].sort(),
    );
    expect(Object.keys(createTownSquare(deps).landmarks!).sort()).toEqual(
      ['fire-station', 'library', 'school', 'store'].sort(),
    );
  });

  it('every collect and navigate stop in the content names a zone that exists and has open spots', () => {
    const zones = new Set<ZoneId>();
    for (const content of listRankContent()) {
      for (const adventure of content.adventures) {
        for (const requirement of adventure.requirements) {
          for (const spec of [requirement.activity, requirement.practice]) {
            if (spec?.type === 'collect' || spec?.type === 'navigate') zones.add(spec.params.zone);
          }
        }
      }
    }
    expect(zones.size).toBeGreaterThan(0);
    for (const id of zones) {
      expect(ZONE_IDS).toContain(id);
      expect(createZone(id, makeDeps()).openSpots?.length ?? 0).toBeGreaterThanOrEqual(10);
    }
  });
});
