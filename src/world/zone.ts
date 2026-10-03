import type * as THREE from 'three';
import type { ZoneId } from '../activities/types';
import type { Bounds } from './bounds';

export type { Bounds } from './bounds';

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
