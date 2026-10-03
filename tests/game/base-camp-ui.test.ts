// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createCompass } from '../../src/game/screens/compass';
import {
  ControlsHintGate,
  controlsMode,
  createControlsHint,
  HINT_IDLE_SECONDS,
  hintTokens,
  isOnboarding,
} from '../../src/game/screens/controls-hint';
import { createDock } from '../../src/game/screens/dock';
import { createHud, trailProgress } from '../../src/game/screens/hud';
import { createStartButton, startLabel, startMode, startVisible } from '../../src/game/screens/start-button';
import { showTrailPanel } from '../../src/game/screens/trail-panel';
import type { TrailView } from '../../src/game/session';
import { buttonByText, flush, makeHost } from '../ui/helpers';

let host: HTMLElement;
beforeEach(() => {
  host = makeHost();
});

describe('Start button rules', () => {
  it('offers the trail while it has stops, a bonus when done with one waiting, and nothing otherwise', () => {
    expect(startMode('ready', false)).toBe('trail');
    expect(startMode('ready', true)).toBe('trail'); // a bonus never replaces an unfinished trail
    expect(startMode('done-today', true)).toBe('bonus');
    expect(startMode('done-today', false)).toBe('hidden');
    expect(startMode('empty', false)).toBe('hidden');
    expect(startMode('empty', true)).toBe('hidden');
  });

  it('is on screen only with nothing open and nothing running', () => {
    expect(startVisible('trail', { overlayOpen: false, busy: false })).toBe(true);
    expect(startVisible('bonus', { overlayOpen: false, busy: false })).toBe(true);
    expect(startVisible('trail', { overlayOpen: true, busy: false })).toBe(false);
    expect(startVisible('trail', { overlayOpen: false, busy: true })).toBe(false);
    expect(startVisible('hidden', { overlayOpen: false, busy: false })).toBe(false);
  });

  it('words the button the way the brief does, at both reading levels', () => {
    for (const level of ['grade2', 'grade5'] as const) {
      expect(startLabel('trail', level)).toBe("Start today's trail");
      expect(startLabel('bonus', level)).toBe('Bonus stop');
    }
  });

  it('draws a primary button that shows, hides and relabels', () => {
    const onStart = vi.fn();
    const start = createStartButton(host, onStart);
    expect(start.root.hidden).toBe(true);
    expect(start.root.classList.contains('tq-btn--primary')).toBe(true);

    start.set('trail', true, 'grade2');
    expect(start.root.hidden).toBe(false);
    expect(start.root.textContent).toContain("Start today's trail");
    start.root.click();
    expect(onStart).toHaveBeenCalledTimes(1);

    start.set('bonus', true, 'grade2');
    expect(start.root.textContent).toContain('Bonus stop');
    expect(start.root.textContent).not.toContain('trail');

    start.set('bonus', false, 'grade2');
    expect(start.root.hidden).toBe(true);
    start.set('hidden', true, 'grade2');
    expect(start.root.hidden).toBe(true);
  });
});

describe('controls hint rules', () => {
  const calm = { blocked: false, idleSeconds: 0 };

  it('picks the wording from the last device, with touch-first screens deciding for a gamepad', () => {
    expect(controlsMode('keyboard', false)).toBe('keyboard');
    expect(controlsMode('keyboard', true)).toBe('keyboard'); // an iPad with a keyboard they just used
    expect(controlsMode('touch', false)).toBe('touch');
    expect(controlsMode('touch', true)).toBe('touch');
    expect(controlsMode('gamepad', false)).toBe('keyboard');
    expect(controlsMode('gamepad', true)).toBe('touch');
  });

  it('counts the first three sessions as onboarding', () => {
    expect(isOnboarding(0)).toBe(true);
    expect(isOnboarding(2)).toBe(true);
    expect(isOnboarding(3)).toBe(false);
  });

  it('shows through the first three sessions and not after', () => {
    const gate = new ControlsHintGate();
    expect(gate.update({ ...calm, sessionsCompleted: 0 })).toBe(true);
    expect(gate.update({ ...calm, sessionsCompleted: 2 })).toBe(true);
    expect(gate.update({ ...calm, sessionsCompleted: 3 })).toBe(false);
  });

  it('shows after 8 seconds of standing still, even after the first three sessions', () => {
    const gate = new ControlsHintGate();
    expect(HINT_IDLE_SECONDS).toBe(8);
    expect(gate.update({ blocked: false, idleSeconds: 7.9, sessionsCompleted: 9 })).toBe(false);
    expect(gate.update({ blocked: false, idleSeconds: 8, sessionsCompleted: 9 })).toBe(true);
  });

  it('never shows with something open, a stop running or the greeting about to open', () => {
    const gate = new ControlsHintGate();
    expect(gate.update({ blocked: true, idleSeconds: 30, sessionsCompleted: 0 })).toBe(false);
    gate.force();
    expect(gate.update({ blocked: true, idleSeconds: 30, sessionsCompleted: 0 })).toBe(false);
  });

  it('is put away for good by a tap during the first three sessions', () => {
    const gate = new ControlsHintGate();
    expect(gate.update({ ...calm, sessionsCompleted: 0 })).toBe(true);
    gate.dismiss();
    expect(gate.update({ ...calm, sessionsCompleted: 0 })).toBe(false);
    expect(gate.update({ ...calm, idleSeconds: 3, sessionsCompleted: 0 })).toBe(false);
  });

  it('does not come back while the Scout keeps standing still, only after they move and stop again', () => {
    const gate = new ControlsHintGate();
    expect(gate.update({ blocked: false, idleSeconds: 9, sessionsCompleted: 5 })).toBe(true);
    gate.dismiss();
    expect(gate.update({ blocked: false, idleSeconds: 12, sessionsCompleted: 5 })).toBe(false);
    expect(gate.update({ blocked: false, idleSeconds: 60, sessionsCompleted: 5 })).toBe(false);
    // They walked: the idle clock fell back to zero.
    expect(gate.update({ blocked: false, idleSeconds: 0.5, sessionsCompleted: 5 })).toBe(false);
    expect(gate.update({ blocked: false, idleSeconds: 8, sessionsCompleted: 5 })).toBe(true);
  });

  it('comes back when "Look around first" forces it, until the Scout moves or taps it away', () => {
    const gate = new ControlsHintGate();
    gate.dismiss();
    expect(gate.update({ ...calm, sessionsCompleted: 0 })).toBe(false);
    gate.force();
    expect(gate.update({ ...calm, idleSeconds: 0.2, sessionsCompleted: 9 })).toBe(true);
    expect(gate.update({ ...calm, idleSeconds: 4, sessionsCompleted: 9 })).toBe(true);
    // Walking clears the force.
    expect(gate.update({ ...calm, idleSeconds: 0, sessionsCompleted: 9 })).toBe(false);

    gate.force();
    expect(gate.update({ ...calm, idleSeconds: 1, sessionsCompleted: 9 })).toBe(true);
    gate.dismiss();
    expect(gate.update({ ...calm, idleSeconds: 2, sessionsCompleted: 9 })).toBe(false);
  });
});

describe('controls hint card', () => {
  it('splits key markers out of a line so they can be drawn as key caps', () => {
    expect(hintTokens('Walk: arrow keys or [W] [A].')).toEqual([
      { key: false, text: 'Walk: arrow keys or ' },
      { key: true, text: 'W' },
      { key: false, text: ' ' },
      { key: true, text: 'A' },
      { key: false, text: '.' },
    ]);
    expect(hintTokens('Walk: drag the circle.')).toEqual([{ key: false, text: 'Walk: drag the circle.' }]);
    expect(hintTokens('')).toEqual([]);
  });

  function makeHint() {
    const onDismiss = vi.fn();
    const hint = createControlsHint(host, { onDismiss });
    return { hint, onDismiss };
  }

  it('draws the keyboard version with five key caps', () => {
    const { hint } = makeHint();
    expect(hint.root.hidden).toBe(true);
    hint.set(true, 'keyboard', 'grade2');
    expect(hint.root.hidden).toBe(false);
    expect(hint.root.textContent).toContain('Walk: arrow keys or W A S D.');
    expect(hint.root.textContent).toContain('Talk: E');
    const caps = Array.from(hint.root.querySelectorAll('kbd.tq-key')).map((k) => k.textContent);
    expect(caps).toEqual(['W', 'A', 'S', 'D', 'E']);
  });

  it('draws the touch version without key caps and switches back', () => {
    const { hint } = makeHint();
    hint.set(true, 'touch', 'grade2');
    expect(hint.root.textContent).toContain('Walk: drag the circle.');
    expect(hint.root.textContent).toContain('Talk: tap the big button.');
    expect(hint.root.querySelectorAll('.tq-key')).toHaveLength(0);
    hint.set(true, 'keyboard', 'grade2');
    expect(hint.root.querySelectorAll('.tq-key')).toHaveLength(5);
    hint.set(false, 'keyboard', 'grade2');
    expect(hint.root.hidden).toBe(true);
  });

  it('is dismissed by one tap on the card or on Got it, and has no Read button', () => {
    const { hint, onDismiss } = makeHint();
    hint.set(true, 'keyboard', 'grade2');

    hint.root.querySelector<HTMLElement>('.tq-hint-card__line')!.click();
    expect(onDismiss).toHaveBeenCalledTimes(1);
    buttonByText(hint.root, 'Got it').click();
    expect(onDismiss).toHaveBeenCalledTimes(2);

    expect(Array.from(hint.root.querySelectorAll('button')).map((b) => b.textContent)).toEqual(['Got it']);
  });
});

describe('dock', () => {
  it('holds the hint above the Start button', () => {
    const dock = createDock(host);
    const hint = createControlsHint(dock, { onDismiss: () => {} });
    const start = createStartButton(dock, () => {});
    expect(host.contains(dock)).toBe(true);
    expect(Array.from(dock.children)).toEqual([hint.root, start.root]);
  });
});

describe('compass', () => {
  const ahead = Math.PI; // the default camera looks down -z

  it('is hidden until it has a target', () => {
    const compass = createCompass(host);
    expect(compass.root.hidden).toBe(true);
    compass.update({ x: 0, z: 9 }, ahead);
    expect(compass.root.hidden).toBe(true);
  });

  it('shows the label and a rounded number of steps, and turns toward the target', () => {
    const compass = createCompass(host);
    compass.setTarget({ x: 0, z: -3 }, 'Den Chief');
    compass.update({ x: 0, z: 9 }, ahead); // 12 units straight ahead
    expect(compass.root.hidden).toBe(false);
    expect(compass.root.textContent).toContain('Den Chief');
    expect(compass.root.textContent).toContain('12 steps');
    const arrow = compass.root.querySelector<SVGElement>('.tq-compass__arrow')!;
    expect(arrow.style.transform).toBe('rotate(0.0deg)');

    // The target is now to the right of the camera.
    compass.setTarget({ x: 10, z: 9 }, 'Den Chief');
    compass.update({ x: 0, z: 9 }, ahead);
    expect(arrow.style.transform).toBe('rotate(90.0deg)');
    expect(compass.root.textContent).toContain('10 steps');
  });

  it('says "1 step" and drops the number between reach and 3 units', () => {
    const compass = createCompass(host);
    compass.setTarget({ x: 0, z: -3 }, 'Den Chief');
    compass.update({ x: 0, z: -3 + 3.4 }, ahead);
    expect(compass.root.textContent).toContain('3 steps');
    compass.update({ x: 0, z: -3 + 2.5 }, ahead);
    expect(compass.root.hidden).toBe(false);
    expect(compass.root.textContent).not.toContain('step');
    expect(compass.root.querySelector<HTMLElement>('.tq-compass__steps')!.hidden).toBe(true);
  });

  it('hides when within reach and again when the target is cleared', () => {
    const compass = createCompass(host);
    compass.setTarget({ x: 0, z: 0 }, 'Den Chief');
    compass.update({ x: 0, z: 6 }, ahead);
    expect(compass.root.hidden).toBe(false);
    compass.update({ x: 0, z: 1.5 }, ahead);
    expect(compass.root.hidden).toBe(true);
    compass.update({ x: 0, z: 6 }, ahead);
    expect(compass.root.hidden).toBe(false);
    compass.setTarget(null);
    expect(compass.root.hidden).toBe(true);
    compass.update({ x: 0, z: 6 }, ahead);
    expect(compass.root.hidden).toBe(true);
  });

  it('is decoration for screen readers: it repeats what the name tag already says', () => {
    const compass = createCompass(host);
    expect(compass.root.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('HUD progress dots', () => {
  const item = (status: 'done' | 'next' | 'later') => ({ kind: 'warm-up' as const, title: 'Test stop', status });

  it('reads the trail view: dots filled as stops complete, all filled when done', () => {
    expect(trailProgress({ state: 'empty', items: [] })).toBeNull();
    expect(trailProgress({ state: 'ready', items: [item('next'), item('later'), item('later')] })).toEqual({
      done: 0,
      total: 3,
      complete: false,
    });
    expect(trailProgress({ state: 'ready', items: [item('done'), item('next'), item('later')] })).toEqual({
      done: 1,
      total: 3,
      complete: false,
    });
    expect(trailProgress({ state: 'done-today', items: [item('done'), item('done'), item('done')] })).toEqual({
      done: 3,
      total: 3,
      complete: true,
    });
    // After a reload the played stops are gone, but the campfire is lit: still three filled dots.
    expect(trailProgress({ state: 'done-today', items: [] })).toEqual({ done: 3, total: 3, complete: true });
  });

  const info = { name: 'Rowan', rankLabel: 'Wolf', xp: 10, streak: 2 };

  it('draws three dots with a word beside them, and a check mark when done', () => {
    const hud = createHud(host, () => {});
    hud.update({ ...info });
    expect(hud.root.querySelector<HTMLElement>('.tq-hud__progress')!.hidden).toBe(true);

    hud.update({ ...info, progress: { done: 1, total: 3, complete: false } });
    const dots = Array.from(hud.root.querySelectorAll('.tq-dot'));
    expect(dots).toHaveLength(3);
    expect(dots.map((d) => d.classList.contains('is-filled'))).toEqual([true, false, false]);
    expect(hud.root.textContent).toContain('1 of 3');
    expect(hud.root.textContent).not.toContain('✓');

    hud.update({ ...info, progress: { done: 3, total: 3, complete: true } });
    expect(Array.from(hud.root.querySelectorAll('.tq-dot')).every((d) => d.classList.contains('is-filled'))).toBe(true);
    expect(hud.root.textContent).toContain('✓ Done');

    hud.update({ ...info, progress: null });
    expect(hud.root.querySelector<HTMLElement>('.tq-hud__progress')!.hidden).toBe(true);
  });

  it('sits under the Today\'s Trail button, with the flame and "Day N streak" above it', () => {
    const hud = createHud(host, () => {});
    hud.update({ ...info, progress: { done: 0, total: 3, complete: false } });
    const children = Array.from(hud.root.children);
    const button = hud.trailButton;
    expect(button.textContent).toContain("Today's Trail");
    expect(children.indexOf(button)).toBeLessThan(children.indexOf(hud.root.querySelector('.tq-hud__progress')!));
    expect(hud.root.querySelector('.tq-hud__stats')!.textContent).toContain('\u{1F525}');
    expect(hud.root.querySelector('.tq-hud__stats')!.textContent).toContain('Day 2 streak');
  });
});

describe('trail panel Start button', () => {
  const view: TrailView = {
    state: 'ready',
    items: [{ kind: 'warm-up', title: 'Test warm up.', status: 'next' }],
  };

  it('puts a primary Start button at the top and resolves "start"', async () => {
    const result = showTrailPanel(host, { view, level: 'grade2', start: { label: "Start today's trail" } });
    const card = host.querySelector('.tq-trail-panel')!;
    const startBtn = buttonByText(card, "Start today's trail");
    expect(startBtn.classList.contains('tq-btn--primary')).toBe(true);
    expect(Array.from(card.children).indexOf(startBtn)).toBe(1); // right after the title row
    // Close is no longer the primary action.
    expect(buttonByText(card, 'Close').classList.contains('tq-btn--primary')).toBe(false);
    startBtn.click();
    await expect(result).resolves.toBe('start');
    expect(host.querySelector('.tq-overlay')).toBeNull();
  });

  it('has no Start button when there is nothing to start, and Close stays primary', async () => {
    const result = showTrailPanel(host, { view: { state: 'done-today', items: [] }, level: 'grade2' });
    expect(host.querySelector('.tq-start')).toBeNull();
    expect(buttonByText(host, 'Close').classList.contains('tq-btn--primary')).toBe(true);
    buttonByText(host, 'Close').click();
    await expect(result).resolves.toBe('close');
  });

  it('makes Start the default for Enter and Space', async () => {
    const result = showTrailPanel(host, { view, level: 'grade2', start: { label: 'Bonus stop' } });
    await flush();
    expect(document.activeElement?.textContent).toContain('Bonus stop');
    buttonByText(host, 'Bonus stop').click();
    await expect(result).resolves.toBe('start');
  });

  describe('Places', () => {
    it('is left out when the app does not ask for it', () => {
      void showTrailPanel(host, { view, level: 'grade2' });
      expect(host.querySelector('.tq-places')).toBeNull();
    });

    it('has a titled section with one button per zone label, between the stops and the bottom row', () => {
      void showTrailPanel(host, { view, level: 'grade2', places: { current: 'base-camp' } });
      const card = host.querySelector('.tq-trail-panel')!;
      const places = card.querySelector('.tq-places')!;
      expect(places.querySelector('h3')!.textContent).toBe('Places');
      expect(Array.from(places.querySelectorAll('button')).map((b) => b.dataset.zone)).toEqual([
        'base-camp',
        'fitness-field',
        'nature-trail',
        'town-square',
        'safety-station',
        'campfire-circle',
      ]);
      const children = Array.from(card.children);
      expect(children.indexOf(places)).toBeGreaterThan(children.indexOf(card.querySelector('.tq-trail-body')!));
      expect(children.indexOf(places)).toBeLessThan(children.indexOf(card.querySelector('.tq-actions')!));
      for (const b of places.querySelectorAll('button')) expect(b.classList.contains('tq-btn')).toBe(true); // 44px tall
    });

    it('marks the current zone with words and an attribute, and does not let it be picked', () => {
      void showTrailPanel(host, { view, level: 'grade2', places: { current: 'town-square' } });
      const here = host.querySelectorAll<HTMLButtonElement>('.tq-places button[aria-current="location"]');
      expect(here).toHaveLength(1);
      expect(here[0]!.textContent).toContain('Town Square');
      expect(here[0]!.textContent).toContain('You are here');
      expect(here[0]!.disabled).toBe(true);
    });

    it('resolves { travel } with the zone that was picked, and closes', async () => {
      const result = showTrailPanel(host, { view, level: 'grade2', places: { current: 'base-camp' } });
      buttonByText(host.querySelector('.tq-places')!, 'Nature Trail').click();
      await expect(result).resolves.toEqual({ travel: 'nature-trail' });
      expect(host.querySelector('.tq-overlay')).toBeNull();
    });
  });
});
