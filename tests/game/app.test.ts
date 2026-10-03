// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RankId } from '../../src/activities/types';
import { startApp } from '../../src/game/app';
import { createDefaultSave, createProfile, loadSave, memoryStore, persistSave } from '../../src/save/store';
import { buttonByText, flush, makeHost } from '../ui/helpers';

// The 3D world needs WebGL, which a DOM test does not have. The app only touches these members.
const world = vi.hoisted(() => ({
  input: { setEnabled: vi.fn() },
  setDenChiefHandler: vi.fn(),
  setGuideName: vi.fn(),
}));
vi.mock('../../src/game/world', () => ({ createWorld: () => world }));

// Test content only: the rank cards and trails come from the synthetic fixture.
vi.mock('../../src/content/load', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/content/load')>();
  const { fixtureRank: content } = await import('../fixtures/rank.fixture');
  return {
    ...actual,
    listRankContent: () => [content],
    loadRankContent: (rank: RankId) => (rank === content.rank ? content : undefined),
  };
});

let host: HTMLElement;
beforeEach(() => {
  host = makeHost();
  world.input.setEnabled.mockClear();
  world.setDenChiefHandler.mockClear();
  world.setGuideName.mockClear();
});

function boot(store = memoryStore(), today = '2026-10-03') {
  const app = startApp({ canvas: document.createElement('canvas'), ui: host, store, today });
  return { app, store };
}

function hudText(): string {
  return host.querySelector('.tq-hud')?.textContent ?? '';
}

function typeInto(selector: string, value: string): void {
  const input = host.querySelector<HTMLInputElement>(selector)!;
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

/** A store that already holds one Scout with a streak, as if the game had been played before. */
function storeWithScout(streak = { current: 4, best: 4, lastTrailDate: '2026-10-02', embers: 0 }) {
  const store = memoryStore();
  const save = createDefaultSave();
  const profile = createProfile(save, { name: 'Rowan', rank: 'wolf' });
  profile.streak = streak;
  profile.xp = 70;
  profile.sessions = [{ date: '2026-10-02', stops: [], xpEarned: 30, durationSec: 80 }];
  persistSave(store, save);
  return store;
}

describe('app: first run', () => {
  it('shows profile setup when there are no profiles, then the HUD once a Scout is made', async () => {
    const { app, store } = boot();
    expect(host.querySelector('.tq-overlay')).not.toBeNull();
    expect(host.textContent).toContain('Who is playing?');
    expect(host.textContent).toContain('Test Wolf · grade 2');
    expect(host.querySelector<HTMLElement>('.tq-hud')!.hidden).toBe(true);

    typeInto('input[name="scout-name"]', 'Rowan');
    buttonByText(host, 'Test Wolf').click();
    buttonByText(host, "Let's start").click();
    await app.ready;

    expect(host.querySelector('.tq-overlay')).toBeNull();
    expect(host.querySelector<HTMLElement>('.tq-hud')!.hidden).toBe(false);
    expect(hudText()).toContain('Rowan');
    expect(hudText()).toContain('Test Wolf');
    expect(hudText()).toContain('0 XP');
    expect(hudText()).toContain('Day 0 streak');
    expect(world.setGuideName).toHaveBeenLastCalledWith('Den Chief');
    expect(loadSave(store).profiles).toHaveLength(1);
    expect(loadSave(store).profiles[0]).toMatchObject({ name: 'Rowan', rank: 'wolf', readAloud: true });
    expect(app.profile?.name).toBe('Rowan');
    expect(app.session).not.toBeNull();
  });

  it('turns game input off while an overlay is open and on when it closes', async () => {
    const { app } = boot();
    await flush();
    expect(world.input.setEnabled).toHaveBeenLastCalledWith(false);
    typeInto('input[name="scout-name"]', 'Rowan');
    buttonByText(host, 'Test Wolf').click();
    buttonByText(host, "Let's start").click();
    await app.ready;
    await flush();
    expect(world.input.setEnabled).toHaveBeenLastCalledWith(true);
  });
});

describe('app: returning', () => {
  it('shows the picker with a streak flame, and Play opens the game', async () => {
    const { app } = boot(storeWithScout());
    expect(host.querySelectorAll('.tq-profile')).toHaveLength(1);
    expect(host.textContent).toContain('Rowan');
    expect(host.textContent).toContain('\u{1F525} 4 days');
    expect(host.textContent).toContain('Add a Scout');
    expect(host.textContent).toContain('Parent');

    buttonByText(host, 'Play').click();
    await app.ready;
    expect(hudText()).toContain('70 XP');
    expect(hudText()).toContain('Day 4 streak');
  });

  it('shows a lapsed streak as 0 and follows a date override', async () => {
    const { app } = boot(storeWithScout());
    buttonByText(host, 'Play').click();
    await app.ready;
    expect(app.today()).toBe('2026-10-03');
    app.setToday('2026-10-09');
    expect(hudText()).toContain('Day 0 streak');
    app.setToday('2026-10-03');
    expect(hudText()).toContain('Day 4 streak');
  });
});

describe('app: Den Chief and the trail panel', () => {
  async function play() {
    const booted = boot(storeWithScout());
    buttonByText(host, 'Play').click();
    await booted.app.ready;
    const handler = world.setDenChiefHandler.mock.calls.at(-1)![0] as () => void;
    return { ...booted, talk: handler };
  }

  it('greets by name and lets the kid say not now', async () => {
    const { app, talk } = await play();
    talk();
    await flush();
    expect(host.textContent).toContain('Welcome back, Rowan!');
    expect(host.textContent).toContain('Day 4');
    expect(host.textContent).toContain("Let's go!");
    expect(app.session!.busy).toBe(true);
    buttonByText(host, 'Not now').click();
    await flush();
    expect(host.querySelector('.tq-overlay')).toBeNull();
    expect(app.session!.busy).toBe(false);
  });

  it('opens the trail panel from the HUD with today stops and the Switch and Parent buttons', async () => {
    await play();
    buttonByText(host.querySelector('.tq-hud')!, 'Trail').click();
    await flush();
    expect(host.textContent).toContain("Today's Trail");
    expect(host.textContent).toContain('Up next');
    expect(host.textContent).toContain('Later');
    expect(host.textContent).toContain('Switch Scout');
    expect(host.textContent).toContain('Parent');
    buttonByText(host, 'Close').click();
    await flush();
    expect(host.querySelector('.tq-overlay')).toBeNull();
  });

  it('Switch Scout goes to the picker, and Add a Scout can go back', async () => {
    await play();
    buttonByText(host.querySelector('.tq-hud')!, 'Trail').click();
    await flush();
    buttonByText(host, 'Switch Scout').click();
    await flush();
    expect(host.querySelectorAll('.tq-profile')).toHaveLength(1);
    expect(host.querySelector<HTMLElement>('.tq-hud')!.hidden).toBe(true);

    buttonByText(host, 'Add a Scout').click();
    await flush();
    expect(host.textContent).toContain('Test Wolf · grade 2');
    buttonByText(host, 'Back').click();
    await flush();
    expect(host.querySelectorAll('.tq-profile')).toHaveLength(1);
  });

  it('does not open the trail panel twice', async () => {
    await play();
    const trail = buttonByText(host.querySelector('.tq-hud')!, 'Trail');
    trail.click();
    trail.click();
    await flush();
    expect(host.querySelectorAll('.tq-overlay')).toHaveLength(1);
  });

  it('asks a parent to set a PIN before Parent mode when there is none', async () => {
    const { app } = boot(storeWithScout());
    buttonByText(host, 'Parent').click();
    await flush();
    expect(host.textContent).toContain('Parent: choose a PIN');
    expect(host.textContent).toContain('not a security lock');
    buttonByText(host, 'Cancel').click();
    await flush();
    // Back on the picker.
    expect(host.querySelectorAll('.tq-profile')).toHaveLength(1);
    expect(app.profile).toBeNull();
  });
});
