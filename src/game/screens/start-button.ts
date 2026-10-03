import { h } from '../../ui/dom';
import { button } from '../../ui/widgets';
import { line, type LineLevel } from '../lines';
import type { TrailView } from '../session';

/** What the big Start button offers right now. */
export type StartMode = 'trail' | 'bonus' | 'hidden';

/**
 * The Start button rule. Today's trail with stops left to play: "Start today's trail". Trail done
 * and a bonus stop waiting: "Bonus stop". Anything else (nothing to play today, or done with no
 * bonus left): no button, because pressing it could only say there is nothing to do.
 */
export function startMode(state: TrailView['state'], bonusAvailable: boolean): StartMode {
  if (state === 'ready') return 'trail';
  if (state === 'done-today' && bonusAvailable) return 'bonus';
  return 'hidden';
}

export interface StartContext {
  /** A dialog, panel or activity is on screen. */
  overlayOpen: boolean;
  /** The Den Chief is mid-conversation or a stop is running. */
  busy: boolean;
}

/** The button is on screen only at Base Camp with nothing open and nothing running. */
export function startVisible(mode: StartMode, { overlayOpen, busy }: StartContext): boolean {
  return mode !== 'hidden' && !overlayOpen && !busy;
}

/** The words on the button for a mode that is not hidden. */
export function startLabel(mode: Exclude<StartMode, 'hidden'>, level: LineLevel): string {
  return line(mode === 'trail' ? 'startTrail' : 'startBonus', level);
}

export interface StartButton {
  readonly root: HTMLButtonElement;
  /** Show the right words, or hide the button. */
  set(mode: StartMode, visible: boolean, level: LineLevel): void;
}

/** The big primary button at the bottom centre. Tapping it asks the Den Chief to start, from anywhere. */
export function createStartButton(host: HTMLElement, onStart: () => void): StartButton {
  const label = h('span', null);
  const root = button(label, { variant: 'primary', icon: '▶', class: 'tq-start', onClick: () => onStart() });
  root.hidden = true;
  host.appendChild(root);

  return {
    root,
    set(mode, visible, level) {
      root.hidden = !visible || mode === 'hidden';
      if (mode === 'hidden') return;
      const text = startLabel(mode, level);
      if (label.textContent !== text) label.textContent = text;
    },
  };
}
