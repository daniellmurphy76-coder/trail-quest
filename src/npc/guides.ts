/**
 * The zone guides in the world: where each one stands, how they idle and wave, and the "Talk"
 * spot a Scout walks up to. What a guide says is in guide-lines.ts, and the talk itself is run by
 * the app (src/game/app.ts); this file only places the guide and brings them to life.
 *
 * A guide is added to a zone after the zone is built (`installGuides`, called from world.ts), never
 * inside the zone builders: a builder's own interactable list stays the Trail sign alone. Base Camp
 * has the Den Chief and gets no guide.
 */
import * as THREE from 'three';
import type { AvatarRig } from '../player/avatar/rig-types';
import type { Interactable, Zone } from '../world/zone';
import { guideForZone, type GuideId, type GuideZoneId } from './guide-types';
import { createGuideRig, guideLabelHeight } from './looks';

/** The "Talk" prompt shows within this many units, the same reach as the Den Chief. */
export const GUIDE_REACH = 2;
/** A guide turns to look at a Scout who comes this close, and turns back when they leave. */
export const GUIDE_NOTICE_RADIUS = 5;
/** How fast a guide turns, in radians a second. */
const GUIDE_TURN_SPEED = 4;
/** A guide waves this often (the Den Chief does too), and once soon after the Scout arrives. */
const WAVE_EVERY = 14;
const WAVE_ON_ARRIVAL = 1.2;
/** About how wide a guide stands on the ground, for keeping them off props. */
export const GUIDE_BODY_RADIUS = 0.5;

export interface GuideSpot {
  x: number;
  z: number;
}

/**
 * Where each guide stands: in view from the spawn, a few steps ahead and a little off to one side,
 * so the walk in never goes through them. Every spot is 3.5 to 8 units from the spawn and within
 * about 40 degrees of the way the Scout faces on arrival (into the zone, toward -z). Each one keeps
 * clear of props, open spots, landmarks, the Trail sign and the first lane the Scout walks
 * (tests/npc/guides.test.ts checks all of that against the zones as built).
 *
 *   nature-trail     the Ranger stands beside the trailhead sign, to the right of the dirt path.
 *   safety-station   the Firefighter stands by the paved path that leads toward the fire station.
 *   town-square      the Mayor stands on the plaza paving, left of the main street, by the planters.
 *   campfire-circle  the Camp Cook stands just inside the log gateway, a step right of the middle, so
 *                    the gateway posts never hide them from the arrival camera.
 *   fitness-field    the Coach stands on the inside edge of the running track, where the infield starts
 *                    (the middle of the infield is more than 8 units from the spawn).
 */
export const GUIDE_SPOTS: Readonly<Record<GuideZoneId, GuideSpot>> = {
  'nature-trail': { x: 1.5, z: 8.6 },
  'safety-station': { x: 1.9, z: 7.6 },
  'town-square': { x: -3.8, z: 7.6 },
  'campfire-circle': { x: 1.5, z: 10 },
  'fitness-field': { x: 1.7, z: 5.8 },
};

/** The heading (rotation about up, like `Object3D.rotation.y`) that looks from `from` toward `to`. */
export function facingToward(from: GuideSpot, to: GuideSpot): number {
  return Math.atan2(to.x - from.x, to.z - from.z);
}

/** A guide's place in a zone: the spot, and the heading it rests at (looking toward the spawn). */
export function guidePlacement(zone: Pick<Zone, 'id' | 'spawn'>): (GuideSpot & { facing: number }) | undefined {
  if (!guideForZone(zone.id)) return undefined;
  const spot = GUIDE_SPOTS[zone.id as GuideZoneId];
  return { ...spot, facing: facingToward(spot, zone.spawn) };
}

/** Turn `current` toward `target` by at most `maxStep` radians, the short way round. */
export function turnToward(current: number, target: number, maxStep: number): number {
  const full = Math.PI * 2;
  const diff = ((((target - current) % full) + full + Math.PI) % full) - Math.PI; // -PI to PI
  if (Math.abs(diff) <= maxStep) return current + diff;
  return current + Math.sign(diff) * maxStep;
}

/** Where a guide looks: at the Scout when they are close, else back at the resting heading. */
export function guideTargetFacing(spot: GuideSpot, restingFacing: number, scout: GuideSpot): number {
  if (Math.hypot(scout.x - spot.x, scout.z - spot.z) > GUIDE_NOTICE_RADIUS) return restingFacing;
  return facingToward(spot, scout);
}

/** One guide standing in one zone. */
export interface GuideActor {
  readonly id: GuideId;
  readonly rig: AvatarRig;
  /** The "Talk" spot, the same object that was added to the zone's interactables. */
  readonly interactable: Interactable;
  readonly restingFacing: number;
  /** Idle, wave now and then, and look at the Scout when they are near. Call it every step while the Scout is in this zone. */
  update(dt: number, scoutX: number, scoutZ: number): void;
  /** The Scout has just arrived: wave soon. */
  welcome(): void;
}

/** Every guide already standing in a zone, so a zone that is built once and kept never gets a second. */
const installed = new WeakMap<Zone, GuideActor>();

/**
 * Put the zone's guide into the zone: the rig on `zone.root` and a "Talk" interactable (id
 * `guide-<id>`, name tag the role) on `zone.interactables`. `onTalk` runs when the Scout talks to
 * them. Safe to call again for the same zone: it returns the guide that is already there and adds
 * nothing. Returns undefined for a zone with no guide (Base Camp).
 */
export function installGuides(zone: Zone, onTalk: (id: GuideId) => void): GuideActor | undefined {
  const info = guideForZone(zone.id);
  const placement = guidePlacement(zone);
  if (!info || !placement) return undefined;
  const existing = installed.get(zone);
  if (existing) return existing;

  const rig = createGuideRig(info.id);
  rig.root.position.set(placement.x, 0, placement.z);
  rig.root.rotation.y = placement.facing;
  zone.root.add(rig.root);

  const interactable: Interactable = {
    id: `guide-${info.id}`,
    // y is the label height (see Interactable): just above the guide's head.
    position: new THREE.Vector3(placement.x, guideLabelHeight(info.id), placement.z),
    radius: GUIDE_REACH,
    label: 'Talk',
    nameTag: info.role,
    onInteract: () => onTalk(info.id),
  };
  zone.interactables.push(interactable);

  let waveClock = WAVE_EVERY / 2;
  const actor: GuideActor = {
    id: info.id,
    rig,
    interactable,
    restingFacing: placement.facing,
    update(dt, scoutX, scoutZ) {
      const target = guideTargetFacing(placement, placement.facing, { x: scoutX, z: scoutZ });
      rig.root.rotation.y = turnToward(rig.root.rotation.y, target, GUIDE_TURN_SPEED * dt);
      waveClock -= dt;
      if (waveClock <= 0) {
        rig.play('wave');
        waveClock = WAVE_EVERY;
      }
      rig.update(dt, { moving: false, speed: 0 });
    },
    welcome() {
      waveClock = Math.min(waveClock, WAVE_ON_ARRIVAL);
    },
  };
  installed.set(zone, actor);
  return actor;
}
