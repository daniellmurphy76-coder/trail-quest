/**
 * Pure rules for the guided start: where the Scout stands when they arrive at Base Camp, and
 * whether the Den Chief should open the greeting by himself. No DOM, no Three.js.
 */
import { clampToBounds, type Bounds, type XZ } from '../world/bounds';
import type { TrailView } from './session';

/** How long after arriving the greeting opens by itself. */
export const GREETING_DELAY_MS = 1000;
/** How far from the Den Chief the Scout starts. The Den Chief's reach is 2, so this is inside it. */
export const GUIDED_START_DISTANCE = 2;
/** Stay this far inside the Den Chief's reach so the Talk prompt is already showing. */
const REACH_MARGIN = 0.2;

export interface GuidedPose {
  x: number;
  z: number;
  /** Heading in radians (forward is (sin, cos)); looks at the guide. */
  facing: number;
}

/**
 * A spot `distance` units from `guide`, on the side toward `awayFrom` (the spawn point, which is
 * where the Den Chief already faces), looking at the guide. The camera snaps to this facing, so
 * the Scout sees the Den Chief straight ahead. `reach` is the guide's interaction radius; the
 * distance is held inside it so the Talk prompt shows at once. `bounds` keeps the spot walkable.
 */
export function guidedStartPose(
  guide: XZ,
  awayFrom: XZ,
  reach: number,
  bounds?: Bounds,
  distance: number = GUIDED_START_DISTANCE,
): GuidedPose {
  const d = Math.min(distance, Math.max(0.5, reach - REACH_MARGIN));
  let dx = awayFrom.x - guide.x;
  let dz = awayFrom.z - guide.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) {
    dx = 0;
    dz = 1; // nothing to go on: stand on the +z side, which is the default camera's side
  } else {
    dx /= len;
    dz /= len;
  }
  let x = guide.x + dx * d;
  let z = guide.z + dz * d;
  if (bounds) ({ x, z } = clampToBounds(x, z, bounds));
  return { x, z, facing: Math.atan2(guide.x - x, guide.z - z) };
}

export interface AutoGreetInput {
  /** `session.view().state` for the active Scout, or null when nobody is playing. */
  viewState: TrailView['state'] | null;
  /** The session is already running a conversation or a stop. */
  busy: boolean;
  /** Any dialog, panel or activity is on screen. */
  overlayOpen: boolean;
}

/**
 * The greeting opens by itself only when today's trail still has stops to play and the Scout has
 * not already started something. A Scout who is done for today is left alone.
 */
export function shouldAutoGreet({ viewState, busy, overlayOpen }: AutoGreetInput): boolean {
  return viewState === 'ready' && !busy && !overlayOpen;
}
