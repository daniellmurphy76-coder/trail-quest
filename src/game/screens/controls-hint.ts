import type { InputDevice } from '../../engine/input';
import { h, type Child } from '../../ui/dom';
import { button } from '../../ui/widgets';
import { line, type LineKey, type LineLevel } from '../lines';

/** The hint is on show during this many sessions (completed trails), counting from the first. */
export const HINT_SESSIONS = 3;
/** And whenever the Scout stands still this long at Base Camp with nothing open. */
export const HINT_IDLE_SECONDS = 8;

export type ControlsMode = 'keyboard' | 'touch';

/**
 * Which wording to show: the device the Scout used last decides, and a touch-first screen
 * decides when the last device was a gamepad (there is no gamepad wording).
 */
export function controlsMode(lastDevice: InputDevice, coarsePointer: boolean): ControlsMode {
  if (lastDevice === 'touch') return 'touch';
  if (lastDevice === 'keyboard') return 'keyboard';
  return coarsePointer ? 'touch' : 'keyboard';
}

/** True for the first three sessions: a Scout with fewer than three finished trails behind them. */
export function isOnboarding(sessionsCompleted: number): boolean {
  return sessionsCompleted < HINT_SESSIONS;
}

export interface HintGateInput {
  /** A dialog or panel is open, a stop is running, or the greeting is about to open. */
  blocked: boolean;
  /** Seconds the Scout has stood still at Base Camp with nothing open. Drops to 0 on any move. */
  idleSeconds: number;
  /** Finished sessions in the save. */
  sessionsCompleted: number;
}

/**
 * When the controls hint card is on screen. Shown during the first three sessions, and whenever
 * the Scout has stood still for 8 seconds. One tap dismisses it: a dismissed card stays away until
 * the Scout moves (or something opens), so it never nags. "Look around first" forces it back.
 */
export class ControlsHintGate {
  private dismissed = false;
  private forced = false;
  private idleLatched = false;
  private lastIdle = 0;

  /** Show the card now, whatever else is true (the Scout chose "Look around first"). */
  force(): void {
    this.forced = true;
    this.dismissed = false;
    this.idleLatched = false;
  }

  /** The Scout tapped the card away. */
  dismiss(): void {
    this.forced = false;
    this.dismissed = true;
    this.idleLatched = true;
  }

  /** Call every time the world changes or on a short timer. Returns whether the card shows. */
  update({ blocked, idleSeconds, sessionsCompleted }: HintGateInput): boolean {
    if (idleSeconds < this.lastIdle) {
      // The idle clock fell back to zero: the Scout moved, or something opened. Start fresh.
      this.idleLatched = false;
      this.forced = false;
    }
    this.lastIdle = idleSeconds;
    if (blocked) return false;
    if (this.forced) return true;
    if (!this.dismissed && isOnboarding(sessionsCompleted)) return true;
    return idleSeconds >= HINT_IDLE_SECONDS && !this.idleLatched;
  }
}

export interface HintToken {
  /** True when the text is a key to draw as a key cap. */
  key: boolean;
  text: string;
}

/** Split "Walk: [W] [A]." into plain text and key caps. */
export function hintTokens(text: string): HintToken[] {
  const tokens: HintToken[] = [];
  for (const part of text.split(/(\[\w+\])/)) {
    if (part === '') continue;
    const match = /^\[(\w+)\]$/.exec(part);
    tokens.push(match ? { key: true, text: match[1]! } : { key: false, text: part });
  }
  return tokens;
}

const LINE_KEYS: Record<ControlsMode, [LineKey, LineKey]> = {
  keyboard: ['hintWalkKeys', 'hintTalkKeys'],
  touch: ['hintWalkTouch', 'hintTalkTouch'],
};

function renderLine(text: string): HTMLElement {
  const parts: Child[] = hintTokens(text).map((token) =>
    token.key ? h('kbd', { class: 'tq-key' }, token.text) : token.text,
  );
  return h('p', { class: 'tq-hint-card__line' }, ...parts);
}

export interface ControlsHint {
  readonly root: HTMLElement;
  /** Show or hide the card. The wording follows `mode` and `level`. */
  set(visible: boolean, mode: ControlsMode, level: LineLevel): void;
}

export interface ControlsHintOptions {
  /** The Scout tapped the card. */
  onDismiss: () => void;
}

/**
 * A small card at the bottom centre: how to walk and how to talk. Keyboard wording has key caps
 * drawn in CSS; touch wording points at the circle and the big button. Tapping anywhere on the
 * card dismisses it.
 */
export function createControlsHint(host: HTMLElement, options: ControlsHintOptions): ControlsHint {
  const lines = h('div', { class: 'tq-hint-card__lines' });
  const gotItLabel = h('span', null);
  const gotIt = button(gotItLabel, { class: 'tq-btn--small' });
  const root = h(
    'div',
    { class: 'tq-hint-card', role: 'status', hidden: true },
    lines,
    h('div', { class: 'tq-hint-card__buttons' }, gotIt),
  );
  root.addEventListener('click', (event) => {
    options.onDismiss();
  });
  host.appendChild(root);

  let drawn = '';
  return {
    root,
    set(visible, mode, level) {
      root.hidden = !visible;
      if (!visible) return;
      const key = `${mode}/${level}`;
      if (key === drawn) return;
      drawn = key;
      const [walk, talk] = LINE_KEYS[mode].map((k) => line(k, level)) as [string, string];
      lines.replaceChildren(renderLine(walk), renderLine(talk));
      gotItLabel.textContent = line('hintGotIt', level);
    },
  };
}
