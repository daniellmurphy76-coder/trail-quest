/**
 * The zone registry: one place that turns a ZoneId into a built Zone.
 *
 * CONTRACT FOR ZONE BUILDERS (keep these stable; the game and the tests rely on them)
 *   - `ZoneDeps` is the only thing a zone gets from the game: `onTalkToDenChief` (Base Camp's
 *     guide) and `onReturnToBaseCamp` (the "Trail sign" every other zone has near its spawn).
 *   - Each non-hub zone lives in its own file and exports `createNatureTrail(deps)`,
 *     `createTownSquare(deps)`, `createFitnessField(deps)`, `createSafetyStation(deps)` and
 *     `createCampfireCircle(deps)`, each returning a `Zone` (see ./zone.ts). The files that exist
 *     today are placeholders (a primitive clearing built by ./placeholder-zone.ts). A zone
 *     builder replaces the file body and keeps the export name and the `ZoneDeps` shape.
 *   - A zone must provide: `bounds`; a `spawn` inside the bounds; `openSpots` (10 to 14 walkable
 *     points at least 2 units apart, clear of props and of the spawn) for collect pickups and
 *     navigate waypoints; `landmarks` for every navigate waypoint id the content uses for it
 *     ("trailhead", "footbridge", "lookout", "campsite" at the Nature Trail; "library", "school",
 *     "fire-station", "store" at Town Square); and one Interactable with label "Back to camp"
 *     that calls `deps.onReturnToBaseCamp`, near the spawn.
 *   - A zone should list its solid props as `colliders` (see ./collide.ts): trunks (not crowns),
 *     rocks, buildings, fences, posts, the fire ring. Build them from the same lists that place the
 *     props, and never put one on the spawn, an open spot, a landmark or the way in from the spawn
 *     (a landmark that is a sign gets no collider of its own). The tests check all of that.
 *   - `createZone` may be called more than once per id; the game builds each zone once and keeps it.
 */
import type { ZoneId } from '../activities/types';
import { createBaseCamp } from './base-camp';
import { createCampfireCircle } from './campfire-circle';
import { createFitnessField } from './fitness-field';
import { createNatureTrail } from './nature-trail';
import { ensureFireLight } from './props';
import { createSafetyStation } from './safety-station';
import { createTownSquare } from './town-square';
import { ZONE_IDS, ZONE_LABELS } from './zone-ids';
import type { Zone } from './zone';

export { ZONE_IDS, ZONE_LABELS };

export interface ZoneDeps {
  /** The player talks to the Den Chief (Base Camp only). */
  onTalkToDenChief: () => void;
  /** The player uses a zone's "Back to camp" trail sign. */
  onReturnToBaseCamp: () => void;
}

/**
 * Build the zone for `id`. Every zone it returns carries exactly one fire point light: the
 * campfire's own where there is a fire, and a dark one (intensity 0, still visible) where there is
 * not. The count of lights in the scene then stays the same wherever the player travels, so three
 * never rebuilds its lit shaders on a zone change. See `ensureFireLight` in ./props.ts.
 */
export function createZone(id: ZoneId, deps: ZoneDeps): Zone {
  const zone = buildZone(id, deps);
  ensureFireLight(zone.root);
  return zone;
}

function buildZone(id: ZoneId, deps: ZoneDeps): Zone {
  switch (id) {
    case 'base-camp':
      return createBaseCamp({ onTalkToDenChief: deps.onTalkToDenChief });
    case 'nature-trail':
      return createNatureTrail(deps);
    case 'town-square':
      return createTownSquare(deps);
    case 'fitness-field':
      return createFitnessField(deps);
    case 'safety-station':
      return createSafetyStation(deps);
    case 'campfire-circle':
      return createCampfireCircle(deps);
  }
}
