/**
 * The world as collect and navigate see it: a `WorldActivityHost` over the game's world.
 *
 * `spawnPickup` drops a bobbing, slowly spinning item (a small colored low-poly shape picked by a
 * hash of the content id) with a name tag. `spawnMarker` plants a tall translucent beacon with a
 * name tag. Both are checked every fixed step: the first time the player's ground distance gets
 * within `radius`, `onReach` fires once and the object goes away.
 *
 * The host only talks to the small `WorldHostTarget` shape, so tests can drive it with a bare
 * THREE.Scene and a fake player. Nothing is registered with the loop until something is placed,
 * and it unregisters again when nothing is left.
 */
import * as THREE from 'three';
import type {
  WorldActivityHost,
  WorldPlaceOptions,
  WorldPlacedHandle,
  WorldPoint,
} from '../activities/types';
import { setShadowCasting } from '../engine/environment';
import type { LabelOptions, WorldLabel } from '../engine/labels';
import type { Zone } from '../world/zone';

/** Ground distance at which a pickup is collected, when the activity does not say. */
export const DEFAULT_PICKUP_RADIUS = 1.5;
/** Ground distance at which a waypoint is reached, when the activity does not say. */
export const DEFAULT_MARKER_RADIUS = 2;
/** How high a pickup floats above the ground, and about how big it is. */
export const PICKUP_HEIGHT = 0.8;
export const PICKUP_SIZE = 0.5;
/** Beacon: a cylinder 0.4 units wide (radius) and 6 units tall. */
export const BEACON_RADIUS = 0.4;
export const BEACON_HEIGHT = 6;

/** The parts of the world the host needs. `World` satisfies it. */
export interface WorldHostTarget {
  readonly scene: { add(object: THREE.Object3D): unknown; remove(object: THREE.Object3D): unknown };
  /** The zone the player is in now (read live, so it follows travel). */
  readonly zone: Pick<Zone, 'id' | 'openSpots' | 'landmarks'>;
  readonly player: { readonly position: { readonly x: number; readonly y: number; readonly z: number } };
  readonly labels: { add(options: LabelOptions): WorldLabel; remove(label: WorldLabel): void };
  readonly compass: { setTarget(point: { x: number; z: number } | null, label?: string): void };
  /** Run a function every fixed step. Returns a stop function. */
  onUpdate(fn: (dt: number) => void): () => void;
}

export interface WorldHostOptions {
  /**
   * Optional model lookup: given a content id such as "bird" or "footbridge", return a fresh
   * Object3D (a new instance each call) to show in place of the primitive, or undefined to keep
   * the primitive. A pickup uses the model instead of its colored shape. A marker keeps its tall
   * beacon, because that is what makes it findable from far away, and shows the model at its foot.
   *
   * NOT WIRED YET: the asset library is being built separately. When it lands, pass something like
   * `resolveModel: (id) => (assets.has(`item.${id}`) ? assets.instance(`item.${id}`) : undefined)`
   * from app.ts where the host is created.
   */
  resolveModel?: (id: string) => THREE.Object3D | undefined;
}

export interface WorldHost extends WorldActivityHost {
  /** How many pickups and markers are still waiting for the player. */
  readonly activeCount: number;
}

/** A small stable hash (FNV-1a) of a string, so an id always gets the same shape and color. */
export function hashString(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

const SHAPES: readonly (() => THREE.BufferGeometry)[] = [
  () => new THREE.IcosahedronGeometry(PICKUP_SIZE * 0.55, 0),
  () => new THREE.OctahedronGeometry(PICKUP_SIZE * 0.62, 0),
  () => new THREE.DodecahedronGeometry(PICKUP_SIZE * 0.55, 0),
  () => new THREE.BoxGeometry(PICKUP_SIZE * 0.85, PICKUP_SIZE * 0.85, PICKUP_SIZE * 0.85),
  () => new THREE.ConeGeometry(PICKUP_SIZE * 0.55, PICKUP_SIZE, 6),
  () => new THREE.TetrahedronGeometry(PICKUP_SIZE * 0.68, 0),
];
const COLORS = [0xe8505b, 0xf2b705, 0x2f9e5a, 0x3b82c4, 0x8e5bd0, 0xf08a3c, 0x20a8a8, 0xd9528f] as const;

const shapeCache = new Map<number, THREE.BufferGeometry>();
const materialCache = new Map<number, THREE.MeshLambertMaterial>();

/** The shape and color an id gets. Same id, same look, every time. */
export function pickupLook(id: string): { shape: number; color: number } {
  const hash = hashString(id);
  return { shape: hash % SHAPES.length, color: COLORS[Math.floor(hash / SHAPES.length) % COLORS.length]! };
}

function pickupMesh(id: string): THREE.Mesh {
  const { shape, color } = pickupLook(id);
  let geometry = shapeCache.get(shape);
  if (!geometry) {
    geometry = SHAPES[shape]!();
    shapeCache.set(shape, geometry);
  }
  let material = materialCache.get(color);
  if (!material) {
    material = new THREE.MeshLambertMaterial({ color, flatShading: true });
    materialCache.set(color, material);
  }
  return new THREE.Mesh(geometry, material);
}

let beaconGeometry: THREE.CylinderGeometry | undefined;

function beaconMesh(): THREE.Mesh {
  beaconGeometry ??= new THREE.CylinderGeometry(BEACON_RADIUS, BEACON_RADIUS, BEACON_HEIGHT, 16, 1, true);
  const material = new THREE.MeshBasicMaterial({
    color: 0xffd84d,
    transparent: true,
    opacity: 0.4,
    blending: THREE.AdditiveBlending, // glows against the sky and the ground
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(beaconGeometry, material);
  mesh.position.y = BEACON_HEIGHT / 2;
  return mesh;
}

interface Placement {
  kind: 'pickup' | 'marker';
  object: THREE.Object3D;
  label: WorldLabel;
  /** Where the label hangs; the label reads it live. */
  labelPosition: THREE.Vector3;
  x: number;
  z: number;
  baseY: number;
  radius: number;
  zoneId: string;
  phase: number;
  text: string;
  onReach: () => void;
  removed: boolean;
}

export function createWorldHost(target: WorldHostTarget, options: WorldHostOptions = {}): WorldHost {
  const placements = new Set<Placement>();
  let stopUpdating: (() => void) | null = null;
  let time = 0;

  function dispose(p: Placement): void {
    if (p.removed) return;
    p.removed = true;
    placements.delete(p);
    target.scene.remove(p.object);
    target.labels.remove(p.label);
    if (placements.size === 0 && stopUpdating) {
      stopUpdating();
      stopUpdating = null;
    }
  }

  function step(dt: number): void {
    time += dt;
    const player = target.player.position;
    const zoneId = target.zone.id;
    for (const p of [...placements]) {
      if (p.removed) continue; // an earlier onReach removed it
      if (p.zoneId !== zoneId) {
        dispose(p); // the player left the zone: quietly drop it, nothing was reached
        continue;
      }
      if (p.kind === 'pickup') {
        p.object.position.y = p.baseY + Math.sin(time * 2.4 + p.phase) * 0.12;
        p.object.rotation.y += dt * 1.1;
      } else {
        const glow = p.object.children[0] as THREE.Mesh | undefined;
        const material = glow?.material;
        if (material instanceof THREE.MeshBasicMaterial) material.opacity = 0.38 + Math.sin(time * 2 + p.phase) * 0.08;
      }
      if (Math.hypot(player.x - p.x, player.z - p.z) <= p.radius) {
        dispose(p); // gone before the callback, so a handle.remove() inside it does nothing
        try {
          p.onReach();
        } catch (error) {
          console.error(error);
        }
      }
    }
  }

  function place(kind: Placement['kind'], opts: WorldPlaceOptions): WorldPlacedHandle {
    const radius = opts.radius ?? (kind === 'pickup' ? DEFAULT_PICKUP_RADIUS : DEFAULT_MARKER_RADIUS);
    const phase = (hashString(opts.id) % 628) / 100;
    const group = new THREE.Group();
    group.name = `${kind}:${opts.id}`;
    const baseY = opts.position.y + (kind === 'pickup' ? PICKUP_HEIGHT : 0);
    group.position.set(opts.position.x, baseY, opts.position.z);

    const model = options.resolveModel?.(opts.id);
    if (kind === 'pickup') {
      group.add(model ?? pickupMesh(opts.id));
      setShadowCasting(group, true, false); // a soft shadow on the grass under the bobbing item
    } else {
      group.add(beaconMesh()); // children[0] is the glow, which the step above pulses
      if (model) group.add(model);
    }

    const labelPosition = new THREE.Vector3(
      opts.position.x,
      opts.position.y + (kind === 'pickup' ? PICKUP_HEIGHT : BEACON_HEIGHT * 0.55),
      opts.position.z,
    );
    const label = target.labels.add({
      text: opts.label,
      position: labelPosition,
      offsetY: kind === 'pickup' ? 0.6 : 0.2,
      className: 'tq-nametag',
    });
    target.scene.add(group);

    const placement: Placement = {
      kind,
      object: group,
      label,
      labelPosition,
      x: opts.position.x,
      z: opts.position.z,
      baseY,
      radius,
      zoneId: target.zone.id,
      phase,
      text: opts.label,
      onReach: opts.onReach,
      removed: false,
    };
    placements.add(placement);
    stopUpdating ??= target.onUpdate(step);
    return { remove: () => dispose(placement) };
  }

  const point = (v: { x: number; y: number; z: number }): WorldPoint => ({ x: v.x, y: v.y, z: v.z });

  return {
    get activeCount() {
      return placements.size;
    },
    zoneId: () => target.zone.id,
    playerPosition: () => point(target.player.position),
    openSpots: () => (target.zone.openSpots ?? []).map(point),
    landmark(id) {
      const landmarks = target.zone.landmarks;
      if (!landmarks || !Object.prototype.hasOwnProperty.call(landmarks, id)) return undefined;
      return point(landmarks[id]!);
    },
    spawnPickup: (opts) => place('pickup', opts),
    spawnMarker: (opts) => place('marker', opts),
    setCompassTarget(position) {
      if (!position) {
        target.compass.setTarget(null);
        return;
      }
      // The contract carries no label, so borrow the name of whatever stands at that spot.
      let name = '';
      for (const p of placements) {
        if (Math.abs(p.x - position.x) < 0.01 && Math.abs(p.z - position.z) < 0.01) {
          name = p.text;
          break;
        }
      }
      target.compass.setTarget({ x: position.x, z: position.z }, name);
    },
    clear() {
      for (const p of [...placements]) dispose(p);
      target.compass.setTarget(null);
    },
  };
}
