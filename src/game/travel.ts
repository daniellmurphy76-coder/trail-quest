/**
 * Zone travel: swap the zone that is in the scene, put the player at its spawn looking into it,
 * and snap the camera. Kept apart from createWorld (which needs WebGL) so tests can drive it with
 * a plain THREE.Scene and fakes.
 *
 * `travelTo` hides the swap behind the veil (fade out, swap, fade in). `jumpTo` swaps at once with
 * no fade, for moments when a screen already covers the world (picking a Scout). Zones are built
 * once and kept, so going back to a zone is cheap and its state (campfire flicker, models) stays.
 * Travel requests queue: asking while a trip is under way waits for it, then goes.
 */
import type * as THREE from 'three';
import type { ZoneId } from '../activities/types';
import type { FollowTarget } from '../engine/camera';
import type { Zone } from '../world/zone';
import type { Veil } from './veil';

export interface TravelDeps {
  /** What zone roots are added to and removed from. */
  scene: { add(object: THREE.Object3D): unknown; remove(object: THREE.Object3D): unknown };
  /** The zone that is already in the scene. */
  initial: Zone;
  /** Build a zone that has not been visited yet. */
  createZone(id: ZoneId): Zone;
  player: { setPosition(position: THREE.Vector3, facing?: number): void };
  follow: { snapTo(target: FollowTarget): void };
  followTarget: FollowTarget;
  veil: Pick<Veil, 'fadeOut' | 'fadeIn'>;
  /**
   * Runs right after the swap, while the screen is still covered: rebuild name tags, retarget
   * cues, tell listeners. `previous` is the zone that was just removed.
   */
  onSwap(zone: Zone, previous: Zone): void;
}

export interface ZoneTraveler {
  /** The zone the player is in now. */
  readonly zone: Zone;
  /** Fade out, swap, fade in. Resolves when the screen is clear again. No-op when already there. */
  travelTo(id: ZoneId): Promise<void>;
  /** Swap at once with no fade. No-op when already there. */
  jumpTo(id: ZoneId): void;
}

/** The heading that looks from the spawn toward the middle of the zone's walkable area. */
export function facingIntoZone(zone: Pick<Zone, 'spawn' | 'bounds'>): number {
  const cx = (zone.bounds.minX + zone.bounds.maxX) / 2;
  const cz = (zone.bounds.minZ + zone.bounds.maxZ) / 2;
  const dx = cx - zone.spawn.x;
  const dz = cz - zone.spawn.z;
  if (Math.hypot(dx, dz) < 1e-6) return Math.PI; // standing in the middle: face the default view
  return Math.atan2(dx, dz);
}

export function createZoneTraveler(deps: TravelDeps): ZoneTraveler {
  const zones = new Map<ZoneId, Zone>([[deps.initial.id, deps.initial]]);
  let current = deps.initial;
  let queue: Promise<void> = Promise.resolve();

  function zoneFor(id: ZoneId): Zone {
    let zone = zones.get(id);
    if (!zone) {
      zone = deps.createZone(id);
      zones.set(id, zone);
    }
    return zone;
  }

  function swap(next: Zone): void {
    const previous = current;
    deps.scene.remove(previous.root);
    deps.scene.add(next.root);
    current = next;
    deps.player.setPosition(next.spawn, facingIntoZone(next));
    deps.follow.snapTo(deps.followTarget);
    deps.onSwap(next, previous);
  }

  async function go(id: ZoneId): Promise<void> {
    if (current.id === id) return;
    const next = zoneFor(id); // build first: if it throws, nothing has changed on screen
    await deps.veil.fadeOut();
    try {
      swap(next);
    } finally {
      await deps.veil.fadeIn(); // never leave the screen covered
    }
  }

  return {
    get zone() {
      return current;
    },
    travelTo(id) {
      const trip = queue.then(() => go(id));
      queue = trip.catch(() => {}); // one failed trip must not block the next
      return trip;
    },
    jumpTo(id) {
      if (current.id !== id) swap(zoneFor(id));
    },
  };
}
