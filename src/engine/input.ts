import {
  ActionEdge,
  GAMEPAD_DEADZONE,
  applyDeadzone,
  clampToUnit,
  isInJoystickZone,
  joystickVector,
  keyboardAxis,
  mergeMoves,
  type MoveVec,
} from './input-math';

export interface InputState {
  /** Unit length or shorter. x: right is positive. z: toward the viewer is positive (up is negative). */
  move: { x: number; z: number };
  /** Action is held (or was just tapped). */
  action: boolean;
  /** True for exactly one update after the action is pressed. */
  actionPressed: boolean;
}

/** The device the player touched last. Used to word on-screen prompts. */
export type InputDevice = 'keyboard' | 'gamepad' | 'touch';

export interface InputOptions {
  /** Element that receives touch-joystick pointers (the game canvas). */
  target: HTMLElement;
  /** Overlay root; the touch controls are created inside it. */
  ui: HTMLElement;
}

const JOY_BASE_PX = 120;
const JOY_RADIUS_PX = 50;

const UP_KEYS = ['KeyW', 'ArrowUp'];
const DOWN_KEYS = ['KeyS', 'ArrowDown'];
const LEFT_KEYS = ['KeyA', 'ArrowLeft'];
const RIGHT_KEYS = ['KeyD', 'ArrowRight'];
const ACTION_KEYS = ['Space', 'Enter', 'KeyE'];
const GAME_KEYS = new Set([...UP_KEYS, ...DOWN_KEYS, ...LEFT_KEYS, ...RIGHT_KEYS, ...ACTION_KEYS]);

/**
 * One input source for the game: keyboard + gamepad + touch merged into an `InputState`.
 * Call `update()` once per fixed simulation step.
 */
export class Input {
  /** Latest result of `update()`. */
  readonly state: InputState = { move: { x: 0, z: 0 }, action: false, actionPressed: false };
  /** Which device the player used last. */
  lastDevice: InputDevice;

  private readonly target: HTMLElement;
  private readonly keys = new Set<string>();
  private readonly edge = new ActionEdge();
  private enabled = true;

  private kbAction = false;
  private padAction = false;
  private touchAction = false;

  private readonly coarse: MediaQueryList;
  private touchSeen = false;

  private joyPointer: number | null = null;
  private joyOriginX = 0;
  private joyOriginY = 0;
  private joyMove: MoveVec = { x: 0, z: 0 };
  private actionPointer: number | null = null;

  private readonly joyBase: HTMLDivElement;
  private readonly joyKnob: HTMLDivElement;
  private readonly actionButton: HTMLDivElement;
  private readonly actionText: HTMLSpanElement;

  constructor(options: InputOptions) {
    this.target = options.target;
    this.coarse = window.matchMedia('(pointer: coarse)');
    this.lastDevice = this.coarse.matches ? 'touch' : 'keyboard';

    this.joyBase = document.createElement('div');
    this.joyBase.className = 'tq-joy';
    this.joyKnob = document.createElement('div');
    this.joyKnob.className = 'tq-joy-knob';
    this.joyBase.appendChild(this.joyKnob);

    this.actionButton = document.createElement('div');
    this.actionButton.className = 'tq-action';
    this.actionButton.setAttribute('role', 'button');
    this.actionText = document.createElement('span');
    this.actionButton.appendChild(this.actionText);
    this.setActionLabel('');

    options.ui.append(this.joyBase, this.actionButton);

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.releaseAll);
    document.addEventListener('visibilitychange', this.releaseAll);
    window.addEventListener('pointerdown', this.onAnyPointerDown, true);
    this.coarse.addEventListener('change', this.refreshTouchVisibility);

    const t = this.target;
    t.addEventListener('pointerdown', this.onJoyDown);
    t.addEventListener('pointermove', this.onJoyMove);
    t.addEventListener('pointerup', this.onJoyEnd);
    t.addEventListener('pointercancel', this.onJoyEnd);
    t.addEventListener('lostpointercapture', this.onJoyEnd);
    t.addEventListener('contextmenu', preventDefault);

    const b = this.actionButton;
    b.addEventListener('pointerdown', this.onActionDown);
    b.addEventListener('pointerup', this.onActionEnd);
    b.addEventListener('pointercancel', this.onActionEnd);
    b.addEventListener('lostpointercapture', this.onActionEnd);
    b.addEventListener('contextmenu', preventDefault);

    this.refreshTouchVisibility();
  }

  /** True when the on-screen touch controls are showing. */
  get touchControlsVisible(): boolean {
    return this.coarse.matches || this.touchSeen;
  }

  /**
   * Text on the round touch action button, for example "Talk". An empty string dims the button
   * to show there is nothing to do right now.
   */
  setActionLabel(text: string): void {
    if (this.actionText.textContent === text) return;
    this.actionText.textContent = text;
    this.actionButton.classList.toggle('is-idle', text === '');
    this.actionButton.setAttribute('aria-label', text === '' ? 'Action' : text);
  }

  /** Turn all input off (for example while a full-screen dialog is open). */
  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (!enabled) this.releaseAll();
  }

  /** Merge every source into `state`. Call once per fixed update. */
  update(): InputState {
    const s = this.state;
    if (!this.enabled) {
      s.move.x = 0;
      s.move.z = 0;
      s.action = false;
      s.actionPressed = false;
      return s;
    }

    const pad = readGamepad();
    if (pad.active) this.lastDevice = 'gamepad';
    this.padAction = pad.action;
    this.syncAction();

    const kb = keyboardAxis({
      up: anyDown(this.keys, UP_KEYS),
      down: anyDown(this.keys, DOWN_KEYS),
      left: anyDown(this.keys, LEFT_KEYS),
      right: anyDown(this.keys, RIGHT_KEYS),
    });
    const move = mergeMoves(kb, pad.move, this.joyMove);
    const step = this.edge.step();
    s.move.x = move.x;
    s.move.z = move.z;
    s.action = step.down;
    s.actionPressed = step.pressed;
    return s;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.releaseAll);
    document.removeEventListener('visibilitychange', this.releaseAll);
    window.removeEventListener('pointerdown', this.onAnyPointerDown, true);
    this.coarse.removeEventListener('change', this.refreshTouchVisibility);
    const t = this.target;
    t.removeEventListener('pointerdown', this.onJoyDown);
    t.removeEventListener('pointermove', this.onJoyMove);
    t.removeEventListener('pointerup', this.onJoyEnd);
    t.removeEventListener('pointercancel', this.onJoyEnd);
    t.removeEventListener('lostpointercapture', this.onJoyEnd);
    t.removeEventListener('contextmenu', preventDefault);
    this.joyBase.remove();
    this.actionButton.remove();
  }

  // ---- keyboard -----------------------------------------------------------------------------

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (!this.enabled || !GAME_KEYS.has(e.code) || isTypingTarget(e.target)) return;
    // Enter and Space must keep activating a focused UI button or link.
    if ((e.code === 'Enter' || e.code === 'Space') && isPressableTarget(e.target)) return;
    e.preventDefault(); // keep arrows and space from scrolling the page
    this.lastDevice = 'keyboard';
    this.keys.add(e.code);
    this.kbAction = anyDown(this.keys, ACTION_KEYS);
    this.syncAction();
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    if (!GAME_KEYS.has(e.code)) return;
    this.keys.delete(e.code);
    this.kbAction = anyDown(this.keys, ACTION_KEYS);
    this.syncAction();
  };

  // ---- touch: joystick ----------------------------------------------------------------------

  private readonly onAnyPointerDown = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse') return;
    this.lastDevice = 'touch';
    if (!this.touchSeen) {
      this.touchSeen = true;
      this.refreshTouchVisibility();
    }
  };

  private readonly onJoyDown = (e: PointerEvent): void => {
    if (!this.enabled || e.pointerType === 'mouse' || this.joyPointer !== null) return;
    if (!isInJoystickZone(e.clientX, window.innerWidth)) return;
    e.preventDefault();
    this.target.setPointerCapture(e.pointerId);
    this.joyPointer = e.pointerId;
    this.joyOriginX = e.clientX;
    this.joyOriginY = e.clientY;
    this.joyMove = { x: 0, z: 0 };
    const half = JOY_BASE_PX / 2;
    this.joyBase.style.transform = `translate(${e.clientX - half}px, ${e.clientY - half}px)`;
    this.joyKnob.style.transform = 'translate(0px, 0px)';
    this.joyBase.classList.add('is-on');
  };

  private readonly onJoyMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.joyPointer) return;
    const dx = e.clientX - this.joyOriginX;
    const dy = e.clientY - this.joyOriginY;
    const knob = clampToUnit(dx, dy, JOY_RADIUS_PX);
    this.joyKnob.style.transform = `translate(${knob.x}px, ${knob.z}px)`;
    this.joyMove = joystickVector(dx, dy, JOY_RADIUS_PX);
  };

  private readonly onJoyEnd = (e: PointerEvent): void => {
    if (e.pointerId !== this.joyPointer) return;
    this.endJoystick();
  };

  private endJoystick(): void {
    if (this.joyPointer !== null && this.target.hasPointerCapture(this.joyPointer)) {
      this.target.releasePointerCapture(this.joyPointer);
    }
    this.joyPointer = null;
    this.joyMove = { x: 0, z: 0 };
    this.joyBase.classList.remove('is-on');
  }

  // ---- touch: action button -----------------------------------------------------------------

  private readonly onActionDown = (e: PointerEvent): void => {
    if (!this.enabled || this.actionPointer !== null) return;
    e.preventDefault();
    e.stopPropagation();
    this.actionButton.setPointerCapture(e.pointerId);
    this.actionPointer = e.pointerId;
    this.touchAction = true;
    this.actionButton.classList.add('is-down');
    this.syncAction();
  };

  private readonly onActionEnd = (e: PointerEvent): void => {
    if (e.pointerId !== this.actionPointer) return;
    this.endActionPointer();
  };

  private endActionPointer(): void {
    if (this.actionPointer !== null && this.actionButton.hasPointerCapture(this.actionPointer)) {
      this.actionButton.releasePointerCapture(this.actionPointer);
    }
    this.actionPointer = null;
    this.touchAction = false;
    this.actionButton.classList.remove('is-down');
    this.syncAction();
  }

  // ---- shared -------------------------------------------------------------------------------

  private syncAction(): void {
    this.edge.set(this.kbAction || this.padAction || this.touchAction);
  }

  private readonly refreshTouchVisibility = (): void => {
    this.actionButton.classList.toggle('is-on', this.touchControlsVisible);
  };

  /** Drop everything that is held: window lost focus, tab hidden, or input disabled. */
  private readonly releaseAll = (): void => {
    this.keys.clear();
    this.kbAction = false;
    this.padAction = false;
    if (this.joyPointer !== null) this.endJoystick();
    if (this.actionPointer !== null) this.endActionPointer();
    this.touchAction = false;
    this.edge.reset();
  };
}

function preventDefault(e: Event): void {
  e.preventDefault();
}

function anyDown(keys: ReadonlySet<string>, codes: readonly string[]): boolean {
  return codes.some((c) => keys.has(c));
}

/** Do not steal keys while the player is typing in a form field. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

/** A focused button or link: Enter and Space belong to it, not to the game. */
function isPressableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'BUTTON' || tag === 'A' || target.getAttribute('role') === 'button';
}

interface PadReading {
  move: MoveVec;
  action: boolean;
  /** Something on the pad is being used right now. */
  active: boolean;
}

const NO_PAD: PadReading = { move: { x: 0, z: 0 }, action: false, active: false };

/** First connected gamepad: left stick (0.2 radial deadzone) and button 0. */
function readGamepad(): PadReading {
  const pads = navigator.getGamepads?.();
  if (!pads) return NO_PAD;
  for (const pad of pads) {
    if (!pad || !pad.connected) continue;
    const move = applyDeadzone(pad.axes[0] ?? 0, pad.axes[1] ?? 0, GAMEPAD_DEADZONE);
    const action = pad.buttons[0]?.pressed ?? false;
    return { move, action, active: action || move.x !== 0 || move.z !== 0 };
  }
  return NO_PAD;
}
