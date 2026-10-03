// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHud } from '../../src/game/screens/hud';
import { buttonByText, makeHost } from '../ui/helpers';

let host: HTMLElement;
beforeEach(() => {
  host = makeHost();
});

const scout = { name: 'Rowan', rankLabel: 'Wolf', xp: 0, streak: 0 };

function soundButton(root: HTMLElement): HTMLButtonElement {
  return buttonByText(root, 'Sound');
}

describe('HUD sound button', () => {
  it('reads "Sound" with its icon when sound is on, and "Sound off" when it is off', () => {
    const hud = createHud(host, () => {}, { onToggleSound: () => {} });
    hud.update({ ...scout, soundEnabled: true });
    expect(soundButton(hud.root).textContent).toBe('\u{1F50A}Sound');
    expect(soundButton(hud.root).querySelector('.tq-icon')!.getAttribute('aria-hidden')).toBe('true');

    hud.update({ ...scout, soundEnabled: false });
    expect(soundButton(hud.root).textContent).toBe('\u{1F507}Sound off');
  });

  it('is a word plus an icon, a plain button inside the card', () => {
    const hud = createHud(host, () => {}, { onToggleSound: () => {} });
    hud.update(scout);
    const button = soundButton(hud.root);
    expect(button.tagName).toBe('BUTTON');
    expect(button.getAttribute('type')).toBe('button');
    expect(button.classList.contains('tq-btn')).toBe(true); // 44px or taller, from the shared button
    expect(button.textContent!.replace(/\p{Extended_Pictographic}/gu, '').trim()).toBe('Sound');
    expect(hud.root.contains(button)).toBe(true);
  });

  it('is on until told otherwise', () => {
    const hud = createHud(host, () => {}, { onToggleSound: () => {} });
    hud.update(scout);
    expect(soundButton(hud.root).textContent).toContain('Sound');
    expect(soundButton(hud.root).textContent).not.toContain('off');
  });

  it('toggles through onToggleSound and flips the label at once', () => {
    const onToggleSound = vi.fn();
    const hud = createHud(host, () => {}, { onToggleSound });
    hud.update({ ...scout, soundEnabled: true });

    soundButton(hud.root).click();
    expect(onToggleSound).toHaveBeenCalledTimes(1);
    expect(soundButton(hud.root).textContent).toContain('Sound off');

    soundButton(hud.root).click();
    expect(onToggleSound).toHaveBeenCalledTimes(2);
    expect(soundButton(hud.root).textContent).not.toContain('off');
  });

  it('follows the data: an update with soundEnabled wins over the local flip', () => {
    const hud = createHud(host, () => {}, { onToggleSound: () => {} });
    hud.update({ ...scout, soundEnabled: true });
    soundButton(hud.root).click(); // flips to off locally
    hud.update({ ...scout, soundEnabled: true }); // the app says it is still on
    expect(soundButton(hud.root).textContent).toBe('\u{1F50A}Sound');
    // An update without soundEnabled leaves the label alone.
    hud.update({ ...scout, soundEnabled: false });
    hud.update(scout);
    expect(soundButton(hud.root).textContent).toBe('\u{1F507}Sound off');
  });

  it('has no sound button when nothing handles it, and the rest of the HUD is unchanged', () => {
    const onTrail = vi.fn();
    const hud = createHud(host, onTrail);
    hud.update({ ...scout, xp: 120, streak: 3, soundEnabled: false });
    expect(hud.root.textContent).not.toContain('Sound');
    expect(hud.root.textContent).toContain('Rowan · Wolf');
    expect(hud.root.textContent).toContain('120 XP');
    expect(hud.root.textContent).toContain('Day 3 streak');
    buttonByText(hud.root, 'Trail').click();
    expect(onTrail).toHaveBeenCalledTimes(1);
  });

  it('keeps the Trail button working and separate', () => {
    const onTrail = vi.fn();
    const onToggleSound = vi.fn();
    const hud = createHud(host, onTrail, { onToggleSound });
    hud.update(scout);
    buttonByText(hud.root, 'Trail').click();
    expect(onTrail).toHaveBeenCalledTimes(1);
    expect(onToggleSound).not.toHaveBeenCalled();
  });
});
