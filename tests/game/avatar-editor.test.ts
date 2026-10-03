// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebGLRenderer } from 'three';
import { showAvatarEditor } from '../../src/game/screens/avatar-editor';
import { mulberry32 } from '../../src/engine/seed';
import {
  ALL_COSMETIC_UNLOCKS,
  BUILDS,
  CLOTHES_COLORS,
  EYE_STYLES,
  HAIR_COLORS,
  HAIR_STYLES,
  HAT_COLORS,
  HAT_STYLES,
  LEG_STYLES,
  NECKERCHIEF_COLORS,
  SHIRT_COLORS,
  SHOE_COLORS,
  SKIN_TONES,
  defaultAvatar,
  fillAvatar,
} from '../../src/player/avatar/options';
import { buttonByText, flush, makeHost, press } from '../ui/helpers';

// happy-dom has no WebGL, so the preview gets a stand-in renderer that only counts what it is asked.
vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class FakeRenderer {
    static instances: FakeRenderer[] = [];
    rendered = 0;
    disposed = 0;
    contextLost = 0;
    sizes: Array<[number, number]> = [];
    shadowMap = { enabled: false, type: 0 };
    toneMapping = 0;
    toneMappingExposure = 1;
    outputColorSpace = '';
    constructor(public params: unknown) {
      FakeRenderer.instances.push(this);
    }
    setClearColor(): void {}
    setPixelRatio(): void {}
    setSize(w: number, h: number): void {
      this.sizes.push([w, h]);
    }
    render(): void {
      this.rendered++;
    }
    dispose(): void {
      this.disposed++;
    }
    forceContextLoss(): void {
      this.contextLost++;
    }
  }
  return { ...actual, WebGLRenderer: FakeRenderer };
});

type Fake = { instances: Array<{ rendered: number; disposed: number; contextLost: number; sizes: unknown[] }> };
const fake = (): Fake['instances'] => (WebGLRenderer as unknown as Fake).instances;

let host: HTMLElement;
let getContext: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  host = makeHost();
  fake().length = 0;
  getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({}) as never);
});
afterEach(() => {
  getContext.mockRestore();
});

const rank = 'wolf' as const;

/** Opens the editor with every earned option already open; the lock tests pass their own `unlocks`. */
function open(extra: Partial<Parameters<typeof showAvatarEditor>[1]> = {}) {
  return showAvatarEditor(host, { initial: defaultAvatar(rank), rank, unlocks: ALL_COSMETIC_UNLOCKS, ...extra });
}

function group(title: string): HTMLElement {
  const found = Array.from(host.querySelectorAll<HTMLElement>('.tq-avatar__group')).find(
    (g) => g.querySelector('.tq-avatar__group-title')?.textContent === title,
  );
  if (!found) throw new Error(`No group "${title}"`);
  return found;
}

function radio(title: string, label: string): HTMLButtonElement {
  const found = Array.from(group(title).querySelectorAll<HTMLButtonElement>('[role="radio"]')).find(
    (b) => b.querySelector('.tq-opt__label')?.textContent === label,
  );
  if (!found) throw new Error(`No "${label}" in ${title}`);
  return found;
}

const tab = (label: string): HTMLButtonElement =>
  Array.from(host.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find((t) => t.textContent === label)!;

const selected = (title: string): string[] =>
  Array.from(group(title).querySelectorAll<HTMLButtonElement>('[role="radio"]'))
    .filter((b) => b.getAttribute('aria-checked') === 'true')
    .map((b) => b.querySelector('.tq-opt__label')!.textContent!);

describe('avatar editor: layout and words', () => {
  it('is a dialog titled Make your Scout with the five tabs and the three buttons', () => {
    void open();
    const dialog = host.querySelector('[role="dialog"]')!;
    expect(dialog.getAttribute('aria-label')).toBe('Make your Scout');
    expect(host.querySelector('h2')!.textContent).toBe('Make your Scout');
    expect(Array.from(host.querySelectorAll('[role="tab"]')).map((t) => t.textContent)).toEqual([
      'Body',
      'Hair',
      'Face',
      'Clothes',
      'Extras',
    ]);
    for (const word of ['Random', 'Cancel', 'Done']) expect(buttonByText(host, word)).toBeDefined();
  });

  it('puts every option in its tab, each with a word and a title that is one or two words', () => {
    void open();
    const byTab = new Map<string, string[]>();
    for (const panel of Array.from(host.querySelectorAll('[role="tabpanel"]'))) {
      const label = host.querySelector(`#${panel.getAttribute('aria-labelledby')}`)!.textContent!;
      byTab.set(label, Array.from(panel.querySelectorAll('.tq-avatar__group-title')).map((t) => t.textContent!));
    }
    expect(byTab.get('Body')).toEqual(['Size', 'Skin']);
    expect(byTab.get('Hair')).toEqual(['Hair style', 'Hair color']);
    expect(byTab.get('Face')).toEqual(['Eyes', 'Glasses']);
    expect(byTab.get('Clothes')).toEqual(['Shirt', 'Legs', 'Leg color', 'Shoes']);
    expect(byTab.get('Extras')).toEqual(['Hat', 'Hat color', 'Backpack', 'Scarf']);
    for (const title of Array.from(host.querySelectorAll('.tq-avatar__group-title'))) {
      expect(title.textContent!.split(' ').length).toBeLessThanOrEqual(2);
    }
  });

  it('offers every option from the lists, color swatches by name (for color-blind kids)', () => {
    void open();
    const labels = (title: string): string[] =>
      Array.from(group(title).querySelectorAll('.tq-opt__label')).map((l) => l.textContent!);
    expect(labels('Size')).toEqual(BUILDS.map((c) => c.label));
    expect(labels('Skin')).toEqual(SKIN_TONES.map((c) => c.label));
    expect(labels('Hair style')).toEqual(HAIR_STYLES.map((c) => c.label));
    expect(labels('Hair color')).toEqual(HAIR_COLORS.map((c) => c.label));
    expect(labels('Eyes')).toEqual(EYE_STYLES.map((c) => c.label));
    expect(labels('Glasses')).toEqual(['None', 'Glasses']);
    expect(labels('Shirt')).toEqual(SHIRT_COLORS.map((c) => c.label));
    expect(labels('Legs')).toEqual(LEG_STYLES.map((c) => c.label));
    expect(labels('Leg color')).toEqual(CLOTHES_COLORS.map((c) => c.label));
    expect(labels('Shoes')).toEqual(SHOE_COLORS.map((c) => c.label));
    expect(labels('Hat')).toEqual(HAT_STYLES.map((c) => c.label));
    expect(labels('Hat color')).toEqual(HAT_COLORS.map((c) => c.label));
    expect(labels('Backpack')).toEqual(['None', 'Backpack']);
    expect(labels('Scarf')).toEqual(NECKERCHIEF_COLORS.map((c) => c.label));
  });

  it('draws a swatch in the real color, or a little picture, in each 56px option', () => {
    void open();
    const skin = radio('Skin', 'Peach').querySelector<HTMLElement>('.tq-opt__face')!;
    expect(skin.style.getPropertyValue('--swatch')).toBe('#efbf99');
    const hair = radio('Hair style', 'Spiky').querySelector('.tq-opt__face')!;
    expect(hair.querySelector('svg')).not.toBeNull();
    expect(hair.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
    // Every option is a button of its own that a keyboard and a finger can both reach.
    for (const option of Array.from(host.querySelectorAll('[role="radio"]'))) {
      expect(option.tagName).toBe('BUTTON');
      expect(option.getAttribute('type')).toBe('button');
    }
  });

  it('can be named for another step, with other words on the buttons', () => {
    void open({ title: 'Change my look', doneLabel: 'Save', cancelLabel: 'Back' });
    expect(host.querySelector('h2')!.textContent).toBe('Change my look');
    expect(buttonByText(host, 'Save')).toBeDefined();
    expect(buttonByText(host, 'Back')).toBeDefined();
  });
});

describe('avatar editor: choosing', () => {
  it('Done resolves the starting look when nothing was changed', async () => {
    const result = open();
    buttonByText(host, 'Done').click();
    await expect(result).resolves.toEqual(defaultAvatar(rank));
    expect(host.querySelector('.tq-overlay')).toBeNull();
  });

  it('Done resolves the chosen config', async () => {
    const result = open();
    radio('Size', 'Tall').click();
    radio('Skin', 'Dark brown').click();
    tab('Hair').click();
    radio('Hair style', 'Braids').click();
    radio('Hair color', 'Pink').click();
    tab('Face').click();
    radio('Eyes', 'Star').click();
    radio('Glasses', 'Glasses').click();
    tab('Clothes').click();
    radio('Shirt', 'Red').click();
    radio('Legs', 'Skort').click();
    radio('Leg color', 'Purple').click();
    radio('Shoes', 'Yellow').click();
    tab('Extras').click();
    radio('Hat', 'Scout').click();
    radio('Hat color', 'Orange').click();
    radio('Backpack', 'Backpack').click();
    radio('Scarf', 'Navy').click();
    buttonByText(host, 'Done').click();

    const look = await result;
    expect(look).toEqual({
      bodyColor: '#c63d34', // follows the shirt
      shirt: '#c63d34',
      build: 'tall',
      skin: '#4d2f1e',
      hairStyle: 'braids',
      hairColor: '#e46fa8',
      eyes: 'star',
      glasses: true,
      legs: 'skort',
      legColor: '#7a56b8',
      shoes: '#f2c230',
      hat: 'scout',
      hatColor: '#ea8a2c',
      backpack: true,
      neckerchief: '#1f3557',
    });
  });

  it('Cancel resolves null, and so does Escape', async () => {
    let result = open();
    radio('Size', 'Small').click();
    buttonByText(host, 'Cancel').click();
    await expect(result).resolves.toBeNull();
    expect(host.querySelector('.tq-overlay')).toBeNull();

    result = open();
    press(document, 'Escape');
    await expect(result).resolves.toBeNull();
    expect(host.querySelector('.tq-overlay')).toBeNull();
  });

  it('shows what is picked with a check mark and aria-checked, one per group, and moves it', () => {
    void open();
    expect(selected('Size')).toEqual(['Medium']);
    expect(selected('Skin')).toEqual(['Peach']);
    const peach = radio('Skin', 'Peach');
    expect(peach.classList.contains('is-selected')).toBe(true);
    expect(peach.querySelector('.tq-opt__tick')!.textContent).toBe('✓'); // not color alone
    radio('Skin', 'Tan').click();
    expect(selected('Skin')).toEqual(['Tan']);
    expect(peach.classList.contains('is-selected')).toBe(false);
    expect(peach.getAttribute('aria-checked')).toBe('false');
  });

  it('starts from the Scout’s own look, filling in a v1 avatar from the rank', async () => {
    const result = showAvatarEditor(host, { initial: { bodyColor: '#c9a877' }, rank: 'webelos' });
    expect(selected('Shirt')).toEqual(['Tan']);
    expect(selected('Scarf')).toEqual(['Green']);
    buttonByText(host, 'Done').click();
    await expect(result).resolves.toEqual(fillAvatar({ bodyColor: '#c9a877' }, 'webelos'));
  });

  it('hides hat color until there is a hat, and hair color when the hair is None', () => {
    void open();
    tab('Extras').click();
    expect(group('Hat color').hidden).toBe(true);
    radio('Hat', 'Cap').click();
    expect(group('Hat color').hidden).toBe(false);
    radio('Hat', 'None').click();
    expect(group('Hat color').hidden).toBe(true);
    tab('Hair').click();
    radio('Hair style', 'None').click();
    expect(group('Hair color').hidden).toBe(true);
  });

  it('Random picks a whole new look, keeps the rank neckerchief, and Done returns it', async () => {
    const result = open({ random: mulberry32(11) });
    buttonByText(host, 'Random').click();
    expect(host.querySelector('[role="status"]')!.textContent).toBe('New look!');
    buttonByText(host, 'Done').click();
    const look = (await result)!;
    expect(look).not.toEqual(defaultAvatar(rank));
    expect(look.neckerchief).toBe(defaultAvatar(rank).neckerchief);
    expect(look.bodyColor).toBe(look.shirt);
    expect(fillAvatar(look, rank)).toEqual(look);
  });
});

describe('avatar editor: keyboard and touch', () => {
  it('shows one tab panel at a time, and the arrow keys move between tabs', () => {
    void open();
    const visible = (): string[] =>
      Array.from(host.querySelectorAll<HTMLElement>('[role="tabpanel"]'))
        .filter((p) => !p.hidden)
        .map((p) => host.querySelector(`#${p.getAttribute('aria-labelledby')}`)!.textContent!);
    expect(visible()).toEqual(['Body']);
    expect(tab('Body').getAttribute('aria-selected')).toBe('true');
    expect(tab('Body').tabIndex).toBe(0);
    expect(tab('Hair').tabIndex).toBe(-1);

    tab('Body').focus();
    tab('Body').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(visible()).toEqual(['Hair']);
    expect(document.activeElement).toBe(tab('Hair'));
    tab('Hair').dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect(visible()).toEqual(['Extras']);
    tab('Extras').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(visible()).toEqual(['Body']); // wraps
  });

  it('Enter and Space press the focused option, and the arrow keys move between options', () => {
    void open();
    const small = radio('Size', 'Small');
    small.focus();
    press(small, 'Enter');
    expect(selected('Size')).toEqual(['Small']);
    const medium = radio('Size', 'Medium');
    medium.focus();
    press(medium, ' ');
    expect(selected('Size')).toEqual(['Medium']);

    medium.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(document.activeElement).toBe(radio('Size', 'Tall'));
    radio('Size', 'Tall').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(document.activeElement).toBe(radio('Size', 'Small')); // wraps
  });

  it('a plain tap (click with detail 1) works the same as a click', () => {
    void open();
    radio('Skin', 'Brown').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
    expect(selected('Skin')).toEqual(['Brown']);
  });

  it('puts focus on the first tab and sits above anything already open', async () => {
    const lower = document.createElement('div');
    lower.className = 'tq-overlay';
    host.append(lower);
    const result = open();
    expect(document.activeElement).toBe(tab('Body'));
    press(document, 'Escape'); // only the top overlay answers
    await expect(result).resolves.toBeNull();
    expect(host.contains(lower)).toBe(true);
  });
});

describe('avatar editor: the 3D preview', () => {
  it('makes its own renderer on the canvas, draws, and frees it when the editor closes', async () => {
    const result = open();
    expect(fake()).toHaveLength(1);
    const canvas = host.querySelector('canvas')!;
    expect(canvas.getAttribute('role')).toBe('img');
    expect(canvas.getAttribute('aria-label')).toMatch(/Scout/);
    await new Promise((r) => setTimeout(r, 60));
    expect(fake()[0]!.rendered).toBeGreaterThan(0);

    buttonByText(host, 'Done').click();
    await result;
    expect(fake()[0]!.disposed).toBe(1);
    expect(fake()[0]!.contextLost).toBe(1);
    const frames = fake()[0]!.rendered;
    await new Promise((r) => setTimeout(r, 60));
    expect(fake()[0]!.rendered).toBe(frames); // the loop has stopped
  });

  it('frees the renderer on Cancel and on Escape too, once each', async () => {
    let result = open();
    buttonByText(host, 'Cancel').click();
    await result;
    result = open();
    press(document, 'Escape');
    await result;
    expect(fake()).toHaveLength(2);
    expect(fake().map((r) => r.disposed)).toEqual([1, 1]);
  });

  it('has Turn left and Turn right buttons, with names for screen readers', () => {
    void open();
    const labels = Array.from(host.querySelectorAll('.tq-avatar__turn')).map((b) => b.getAttribute('aria-label'));
    expect(labels).toEqual(['Turn left', 'Turn right']);
    (host.querySelector('.tq-avatar__turn') as HTMLButtonElement).click(); // does not throw
  });

  it('keeps working without WebGL: no picture, but every choice and Done still work', async () => {
    getContext.mockImplementation(() => null);
    const result = open();
    expect(fake()).toHaveLength(0);
    expect(host.textContent).toContain('No picture here');
    expect(host.querySelector('canvas')!.hidden).toBe(true);
    expect(host.querySelector<HTMLElement>('.tq-avatar__turn')!.hidden).toBe(true);
    radio('Skin', 'Light').click();
    buttonByText(host, 'Done').click();
    await expect(result).resolves.toMatchObject({ skin: '#f8d9c0' });
  });

  it('does not leave timers or listeners behind after closing', async () => {
    const result = open();
    buttonByText(host, 'Done').click();
    await result;
    await flush();
    expect(() => window.dispatchEvent(new Event('resize'))).not.toThrow();
  });
});

describe('avatar editor: options that are earned', () => {
  /** Every locked tile: the group it sits in, its word, and the plain line that says how to earn it. */
  const LOCKED = [
    ['Hat', 'Scout', 'Finish an adventure at Base Camp.'],
    ['Hat', 'Beanie', 'Earn 50 XP.'],
    ['Hat', 'Bucket', 'Finish an adventure away from Base Camp.'],
    ['Eyes', 'Star', 'Play 3 days in a row.'],
    ['Backpack', 'Backpack', 'Do a real mission. Your parent says yes.'],
    ['Shirt', 'Gold', 'Earn 500 XP.'],
  ] as const;

  const GOLD = '#e0a82e';
  const locked = (title: string, label: string): boolean => radio(title, label).classList.contains('tq-opt--locked');
  const statusText = (): string => host.querySelector('[role="status"]')!.textContent ?? '';

  it('shows each earned option as a locked tile with a lock mark and the earn-it line, until it is earned', () => {
    void open({ unlocks: [] });
    for (const [title, label, earn] of LOCKED) {
      const tile = radio(title, label);
      expect(tile.classList.contains('tq-opt--locked'), `${title} ${label}`).toBe(true);
      expect(tile.getAttribute('aria-disabled')).toBe('true');
      expect(tile.dataset.locked).toBe('true');
      expect(tile.getAttribute('aria-checked')).toBe('false');
      expect(tile.querySelector('.tq-opt__earn')!.textContent).toBe(earn);
      // A mark and words, never color alone: the lock glyph for sight, "Locked" for a screen reader.
      expect(tile.querySelector('.tq-opt__lock')!.textContent).toContain('\u{1F512}');
      expect(tile.querySelector('.tq-opt__lock .tq-sr')!.textContent).toMatch(/Locked/);
      expect(tile.querySelector('.tq-opt__label')!.textContent).toBe(label);
    }
  });

  it('is strict by default: a Scout with no unlocks list has earned nothing yet', () => {
    void showAvatarEditor(host, { initial: defaultAvatar(rank), rank });
    for (const [title, label] of LOCKED) expect(locked(title, label), `${title} ${label}`).toBe(true);
  });

  it('leaves everything else free: the cap, braids, spiky hair, the other eyes, every other color', () => {
    void open({ unlocks: [] });
    expect(host.querySelectorAll('.tq-opt--locked')).toHaveLength(LOCKED.length);
    for (const [title, label] of [
      ['Hat', 'None'],
      ['Hat', 'Cap'],
      ['Hair style', 'Braids'],
      ['Hair style', 'Spiky'],
      ['Eyes', 'Round'],
      ['Eyes', 'Happy'],
      ['Eyes', 'Wink'],
      ['Backpack', 'None'],
      ['Shirt', 'Red'],
      ['Skin', 'Tan'],
    ] as const) {
      expect(locked(title, label), `${title} ${label}`).toBe(false);
      expect(radio(title, label).hasAttribute('aria-disabled')).toBe(false);
    }
  });

  it('does not select a locked tile, says how to earn it, and Done never includes it', async () => {
    const result = open({ unlocks: [] });
    tab('Extras').click();
    radio('Hat', 'Scout').click();
    expect(selected('Hat')).toEqual(['None']);
    expect(radio('Hat', 'Scout').getAttribute('aria-checked')).toBe('false');
    expect(radio('Hat', 'Scout').classList.contains('is-selected')).toBe(false);
    expect(statusText()).toBe('Scout hat is locked. Finish an adventure at Base Camp.');
    radio('Backpack', 'Backpack').click();
    expect(selected('Backpack')).toEqual(['None']);
    tab('Face').click();
    radio('Eyes', 'Star').click();
    tab('Clothes').click();
    radio('Shirt', 'Gold').click();
    expect(selected('Shirt')).toEqual(['Blue']);
    expect(statusText()).toBe('Gold shirt is locked. Earn 500 XP.');
    buttonByText(host, 'Done').click();

    const look = (await result)!;
    expect(look.hat).toBe('none');
    expect(look.backpack).toBe(false);
    expect(look.eyes).toBe('round');
    expect(look.shirt).toBe(defaultAvatar(rank).shirt);
  });

  it('keeps a locked tile out of reach of the keyboard too: Enter and Space do nothing', () => {
    void open({ unlocks: [] });
    tab('Extras').click();
    const tile = radio('Hat', 'Beanie');
    tile.focus();
    expect(document.activeElement).toBe(tile); // still reachable, so a screen reader can read the line
    press(tile, 'Enter');
    press(tile, ' ');
    expect(selected('Hat')).toEqual(['None']);
    expect(statusText()).toBe('Beanie is locked. Earn 50 XP.');
  });

  it('opens a tile as soon as it is earned, and only that one', async () => {
    const result = open({ unlocks: ['badge:wolf.bobcat', 'cosmetic:hat-scout'] });
    tab('Extras').click();
    expect(locked('Hat', 'Scout')).toBe(false);
    expect(locked('Hat', 'Beanie')).toBe(true);
    expect(radio('Hat', 'Scout').querySelector('.tq-opt__earn')).toBeNull();
    radio('Hat', 'Scout').click();
    expect(selected('Hat')).toEqual(['Scout']);
    buttonByText(host, 'Done').click();
    await expect(result).resolves.toMatchObject({ hat: 'scout' });
  });

  it('opens every tile for a Scout who has earned everything', () => {
    void open({ unlocks: ALL_COSMETIC_UNLOCKS });
    expect(host.querySelectorAll('.tq-opt--locked')).toHaveLength(0);
  });

  it('starts without a locked option the saved look still wears, so Done cannot save one', async () => {
    const wearing = { ...defaultAvatar(rank), hat: 'scout', eyes: 'star' as const, backpack: true, shirt: GOLD, bodyColor: GOLD };
    const result = showAvatarEditor(host, { initial: wearing, rank, unlocks: [] });
    expect(selected('Shirt')).toEqual(['Blue']);
    tab('Extras').click();
    expect(selected('Hat')).toEqual(['None']);
    expect(selected('Backpack')).toEqual(['None']);
    buttonByText(host, 'Done').click();
    await expect(result).resolves.toEqual(defaultAvatar(rank));
  });

  it('keeps what a Scout has earned in the look they started with', async () => {
    const wearing = { ...defaultAvatar(rank), hat: 'scout', eyes: 'star' as const };
    const result = showAvatarEditor(host, { initial: wearing, rank, unlocks: ['cosmetic:hat-scout'] });
    buttonByText(host, 'Done').click();
    await expect(result).resolves.toMatchObject({ hat: 'scout', eyes: 'round' });
  });

  it('Random only uses what has been earned', async () => {
    for (let seed = 1; seed <= 25; seed += 1) {
      const result = open({ unlocks: [], random: mulberry32(seed) });
      buttonByText(host, 'Random').click();
      buttonByText(host, 'Done').click();
      const look = (await result)!;
      expect(['scout', 'beanie', 'bucket']).not.toContain(look.hat);
      expect(look.eyes).not.toBe('star');
      expect(look.backpack).toBe(false);
      expect(look.shirt).not.toBe(GOLD);
    }
  });

  it('words the earn-it line for the older Scouts when asked', () => {
    void open({ unlocks: [], level: 'grade5' });
    expect(radio('Backpack', 'Backpack').querySelector('.tq-opt__earn')!.textContent).toBe(
      'Finish a field mission and get your parent to say yes.',
    );
    expect(radio('Eyes', 'Star').querySelector('.tq-opt__earn')!.textContent).toBe('Finish a trail 3 days in a row.');
  });

  it('keeps the word on a locked tile for the option list, so the labels are unchanged', () => {
    void open({ unlocks: [] });
    const labels = Array.from(group('Hat').querySelectorAll('.tq-opt__label')).map((l) => l.textContent);
    expect(labels).toEqual(HAT_STYLES.map((c) => c.label));
  });
});
