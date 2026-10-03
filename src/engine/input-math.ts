/**
 * Pure input math. No DOM, no Three.js, so it can be unit-tested in node.
 *
 * Axis convention: `x` is right-positive, `z` is toward-the-viewer-positive. So pushing a stick or
 * key "up" (away from the viewer) gives a NEGATIVE `z`, matching Three.js world axes.
 */

export interface MoveVec {
  x: number;
  z: number;
}

export const GAMEPAD_DEADZONE = 0.2;
export const TOUCH_DEADZONE = 0.1;

/** Scale (x, z) down so its length is at most `max`. Shorter vectors are unchanged. */
export function clampToUnit(x: number, z: number, max = 1): MoveVec {
  const len = Math.hypot(x, z);
  if (len <= max || len === 0) return { x: x + 0, z: z + 0 }; // "+ 0" turns -0 into 0
  const s = max / len;
  return { x: x * s + 0, z: z * s + 0 };
}

/**
 * Radial deadzone. Inside the deadzone the result is zero; outside it ramps from 0 to 1 so there
 * is no jump at the edge. Result length is at most 1.
 */
export function applyDeadzone(x: number, z: number, deadzone: number): MoveVec {
  const len = Math.hypot(x, z);
  if (len <= deadzone) return { x: 0, z: 0 };
  const scaled = Math.min(1, (len - deadzone) / (1 - deadzone));
  const s = scaled / len;
  return { x: x * s + 0, z: z * s + 0 };
}

export interface DirectionKeys {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
}

/** Combine four direction keys into a move vector. Opposite keys cancel; diagonals have length 1. */
export function keyboardAxis(keys: DirectionKeys): MoveVec {
  const x = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
  const z = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
  return clampToUnit(x, z);
}

/**
 * Virtual joystick: pixel offset of the finger from where it landed, to a move vector.
 * Full speed at `radius` pixels or more; a small deadzone absorbs finger jitter.
 */
export function joystickVector(
  dxPx: number,
  dyPx: number,
  radius: number,
  deadzone: number = TOUCH_DEADZONE,
): MoveVec {
  const unit = clampToUnit(dxPx / radius, dyPx / radius);
  return applyDeadzone(unit.x, unit.z, deadzone);
}

/** Sum several sources (keyboard, gamepad, touch) and keep the result at unit length or shorter. */
export function mergeMoves(...moves: readonly MoveVec[]): MoveVec {
  let x = 0;
  let z = 0;
  for (const m of moves) {
    x += m.x;
    z += m.z;
  }
  return clampToUnit(x, z);
}

/** True when a pointer at `clientX` falls in the joystick zone (the left `fraction` of the screen). */
export function isInJoystickZone(clientX: number, screenWidth: number, fraction = 0.6): boolean {
  return clientX >= 0 && clientX < screenWidth * fraction;
}

export type JoystickView = 'hidden' | 'rest' | 'drag';

export interface JoystickViewInput {
  /** The touch controls are showing: a coarse-pointer device, or a touch has been seen. */
  touchControls: boolean;
  /** A finger is down and moving the stick. */
  dragging: boolean;
  /** Game input is on (no dialog or screen is open). */
  enabled: boolean;
}

/**
 * Where the joystick ring is. On touch devices it rests in the bottom-left corner, faint, so a
 * kid can see there is a stick before touching anything. While a finger drags it, the ring moves
 * to the finger. It is hidden on laptops and whenever a screen is open.
 */
export function joystickView({ touchControls, dragging, enabled }: JoystickViewInput): JoystickView {
  if (!enabled) return 'hidden';
  if (dragging) return 'drag';
  return touchControls ? 'rest' : 'hidden';
}

export interface ActionStep {
  /** Held down (or was pressed and released since the last step). */
  down: boolean;
  /** True for exactly one step after a press. */
  pressed: boolean;
}

/**
 * Edge detector for the action button. Feed it the merged "is any source down" value with `set`
 * whenever a source changes, then call `step` exactly once per fixed update.
 * A tap that begins and ends between two steps still counts as one press.
 */
export class ActionEdge {
  private held = false;
  private pending = false;

  set(down: boolean): void {
    if (down && !this.held) this.pending = true;
    this.held = down;
  }

  step(): ActionStep {
    const pressed = this.pending;
    this.pending = false;
    return { down: this.held || pressed, pressed };
  }

  reset(): void {
    this.held = false;
    this.pending = false;
  }
}
