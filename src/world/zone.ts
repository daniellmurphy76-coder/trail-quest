import type * as THREE from 'three';
import type { ZoneId } from '../activities/types';
import type { Bounds } from './bounds';
import type { Collider } from './collide';

export type { Bounds } from './bounds';
export type { Collider } from './collide';

/** Something the player can walk up to and act on. */
export interface Interactable {
  id: string;
  /**
   * Where the interaction happens. Distance checks use x and z only. `y` is the height where
   * labels (name tag, prompt) hang, so set it to roughly the top of the object.
   */
  position: THREE.Vector3;
  /** The player is "in range" within this many units (measured on the ground). */
  radius: number;
  /** Short verb for the prompt and the touch action button, for example "Talk". */
  label: string;
  /** Name shown above the object, for example "Den Chief". */
  nameTag?: string;
  onInteract(): void;
}

export interface Zone {
  id: ZoneId;
  root: THREE.Group;
  /** Where the player can walk. */
  bounds: Bounds;
  spawn: THREE.Vector3;
  interactables: Interactable[];
  /**
   * Pre-authored walkable points where world activities may place pickups and markers.
   * Keep them clear of props and at least 2 units apart. Optional for the hub.
   */
  openSpots?: THREE.Vector3[];
  /**
   * Named places that navigate waypoints refer to by id (content uses ids such as
   * "trailhead", "footbridge", "lookout", "campsite", "library", "school", "fire-station", "store").
   */
  landmarks?: Record<string, THREE.Vector3>;
  /**
   * Solid footprints the player cannot walk through: trunks, rocks, tents, buildings, fences,
   * lamp posts, the fire ring. Never on a path, an open spot, a landmark or the spawn. Optional:
   * a zone without any simply has nothing to bump into. May grow when a model swaps in.
   */
  colliders?: Collider[];
  /** Fixed-step animation (campfire flicker and so on). */
  update(dt: number): void;
}

/** The closest interactable whose radius contains (x, z), or null. Ground distance only. */
export function findInteractableInRange(
  x: number,
  z: number,
  interactables: readonly Interactable[],
): Interactable | null {
  let best: Interactable | null = null;
  let bestDist = Infinity;
  for (const item of interactables) {
    const d = Math.hypot(item.position.x - x, item.position.z - z);
    if (d <= item.radius && d < bestDist) {
      best = item;
      bestDist = d;
    }
  }
  return best;
}
