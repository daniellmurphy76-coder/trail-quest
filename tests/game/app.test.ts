// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RankId } from '../../src/activities/types';
import { startApp, type AppOptions } from '../../src/game/app';
import { createDefaultSave, createProfile, loadSave, memoryStore, persistSave } from '../../src/save/store';
import type { Profile } from '../../src/save/types';
import { TRAVEL_SIGN_MS } from '../../src/game/session';
import { card, doneReq } from '../fixtures/profile.fixture';
import { ID } from '../fixtures/rank.fixture';
import { buttonByText, flush, makeHost } from '../ui/helpers';

// The 3D world needs WebGL, which a DOM test does not have. The app only touches these members.
const world = vi.hoisted(() => {
  const state = { zone: 'base-camp' as string };
  const listeners = new Set<() => void>();
  return {
    state,
    listeners,
    input: { setEnabled: vi.fn(), lastDevice: 'keyboard' as 'keyboard' | 'gamepad' | 'touch' },
    idleSeconds: 0,
    setDenChiefHandler: vi.fn(),
    setGuideName: vi.fn(),
    placeAtGuide: vi.fn(),
    setObjectiveVisible: vi.fn(),
    // Zone travel: the mock just remembers where the player is and tells the listeners.
    currentZoneId: () => state.zone,
    travelTo: vi.fn(async (id: string) => {
      state.zone = id;
      for (const listener of [...listeners]) listener();
    }),
    setReturnHandler: vi.fn(),
    onZoneChange: vi.fn((listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    // What the world host needs, so a stop can run (nothing is drawn).
    scene: { add: vi.fn(), remove: vi.fn() },
    get zone() {
      return { id: state.zone, openSpots: [], landmarks: {} };
    },
    player: { position: { x: 0, y: 0, z: 0 } },
    labels: { add: vi.fn(() => ({})), remove: vi.fn() },
    compass: { setTarget: vi.fn() },
    onUpdate: vi.fn<(fn: (dt: number) => void) => () => void>(() => () => {}),
  };
});
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
  world.placeAtGuide.mockClear();
  world.setObjectiveVisible.mockClear();
  world.travelTo.mockClear();
  world.setReturnHandler.mockClear();
  world.onZoneChange.mockClear();
  world.state.zone = 'base-camp';
  world.listeners.clear();
  world.idleSeconds = 0;
  world.input.lastDevice = 'keyboard';
});

/** Most tests drive the Den Chief by hand, so the greeting that opens by itself is off unless asked for. */
function boot(store = memoryStore(), today = '2026-10-03', extra: Partial<AppOptions> = { autoGreet: false }) {
  const app = startApp({ canvas: document.createElement('canvas'), ui: host, store, today, ...extra });
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
function storeWithScout(
  streak = { current: 4, best: 4, lastTrailDate: '2026-10-02', embers: 0 },
  tweak: (profile: Profile) => void = () => {},
) {
  const store = memoryStore();
  const save = createDefaultSave();
  const profile = createProfile(save, { name: 'Rowan', rank: 'wolf' });
  profile.streak = streak;
  profile.xp = 70;
  profile.sessions = [{ date: '2026-10-02', stops: [], xpEarned: 30, durationSec: 80 }];
  tweak(profile);
  persistSave(store, save);
  return store;
}

/** Three finished sessions on record: past the first three, so the controls hint no longer shows by default. */
const manySessions = (profile: Profile): void => {
  profile.sessions = ['2026-09-28', '2026-09-30', '2026-10-02'].map((date) => ({
    date,
    stops: [],
    xpEarned: 30,
    durationSec: 80,
  }));
};

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const startButton = (): HTMLButtonElement | null => host.querySelector('.tq-dock .tq-start');
const hintCard = (): HTMLElement | null => host.querySelector('.tq-hint-card');
const shown = (el: HTMLElement | null): boolean => el !== null && !el.hidden;
const lastObjective = (): unknown => world.setObjectiveVisible.mock.calls.at(-1)?.[0];

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
    expect(hudText()).toContain("Today's Trail");
    expect(hudText()).toMatch(/0 of \d/); // the progress dots, with words beside them
    expect(host.querySelectorAll('.tq-hud .tq-dot').length).toBeGreaterThanOrEqual(2);
    expect(world.setGuideName).toHaveBeenLastCalledWith('Den Chief');
    expect(loadSave(store).profiles).toHaveLength(1);
    expect(loadSave(store).profiles[0]).toMatchObject({ name: 'Rowan', rank: 'wolf' });
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

  it('greets by name and lets the kid look around first', async () => {
    const { app, talk } = await play();
    talk();
    await flush();
    expect(host.textContent).toContain('Welcome back, Rowan!');
    expect(host.textContent).toContain('Day 4');
    expect(host.textContent).toContain("Let's go!");
    expect(host.textContent).toContain('Look around first');
    expect(host.textContent).not.toContain('Not now');
    expect(app.session!.busy).toBe(true);
    buttonByText(host, 'Look around first').click();
    await flush();
    expect(host.querySelector('.tq-overlay')).toBeNull();
    expect(app.session!.busy).toBe(false);
  });

  it('opens the trail panel from the HUD with today stops and the Switch and Parent buttons', async () => {
    await play();
    buttonByText(host.querySelector('.tq-hud')!, "Today's Trail").click();
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
    buttonByText(host.querySelector('.tq-hud')!, "Today's Trail").click();
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
    const trail = buttonByText(host.querySelector('.tq-hud')!, "Today's Trail");
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

describe('app: guided start', () => {
  const GREET_MS = 40;
  const guided: Partial<AppOptions> = { autoGreet: true, greetingDelayMs: GREET_MS };

  async function createFirstScout() {
    const booted = boot(memoryStore(), '2026-10-03', guided);
    typeInto('input[name="scout-name"]', 'Rowan');
    buttonByText(host, 'Test Wolf').click();
    buttonByText(host, "Let's start").click();
    await booted.app.ready;
    return booted;
  }

  it('puts the Scout by the Den Chief and, a moment later, explains the game on the very first session', async () => {
    await createFirstScout();
    expect(world.placeAtGuide).toHaveBeenCalledTimes(1);
    // Nothing opens straight away, and the controls hint waits for the greeting to be over.
    expect(host.querySelector('.tq-overlay')).toBeNull();
    expect(shown(hintCard())).toBe(false);

    await wait(GREET_MS + 80);
    expect(host.querySelector('.tq-overlay')).not.toBeNull();
    expect(host.textContent).toContain('Hi Rowan, I am Den Chief!');
    expect(host.textContent).toContain('A trail is three quick stops.');
    expect(host.textContent).toContain('grow your campfire');
    const labels = Array.from(host.querySelectorAll('.tq-dialog__choices button')).map((b) => b.textContent);
    expect(labels).toEqual(["Let's go!", 'Look around first']);
    // The Start button and the objective step aside while the Den Chief talks.
    expect(shown(startButton())).toBe(false);
    expect(lastObjective()).toBe(false);
  });

  it('"Look around first" closes the dialog, then shows the controls hint, the objective and the Start button', async () => {
    await createFirstScout();
    await wait(GREET_MS + 80);
    buttonByText(host, 'Look around first').click();
    await flush();

    expect(host.querySelector('.tq-overlay')).toBeNull();
    expect(shown(hintCard())).toBe(true);
    expect(hintCard()!.textContent).toContain('Walk: arrow keys or W A S D.');
    expect(hintCard()!.textContent).toContain('Talk: E');
    expect(host.querySelectorAll('.tq-hint-card .tq-key')).toHaveLength(5);
    expect(lastObjective()).toBe(true);
    expect(shown(startButton())).toBe(true);
    expect(startButton()!.textContent).toContain("Start today's trail");
  });

  it('words the hint for touch when the last device was touch, with no key caps', async () => {
    world.input.lastDevice = 'touch';
    await createFirstScout();
    await wait(GREET_MS + 80);
    buttonByText(host, 'Look around first').click();
    await flush();
    expect(hintCard()!.textContent).toContain('Walk: drag the circle.');
    expect(hintCard()!.textContent).toContain('Talk: tap the big button.');
    expect(host.querySelectorAll('.tq-hint-card .tq-key')).toHaveLength(0);
  });

  it('says hello on a later day and offers the same two choices', async () => {
    const { app } = boot(storeWithScout(), '2026-10-03', guided);
    buttonByText(host, 'Play').click();
    await app.ready;
    await wait(GREET_MS + 80);
    expect(host.textContent).toContain('Welcome back, Rowan!');
    const labels = Array.from(host.querySelectorAll('.tq-dialog__choices button')).map((b) => b.textContent);
    expect(labels).toEqual(["Let's go!", 'Look around first']);
  });

  it('does not open the greeting by itself when today is already done', async () => {
    const done = { current: 5, best: 5, lastTrailDate: '2026-10-03', embers: 0 };
    const { app } = boot(storeWithScout(done), '2026-10-03', guided);
    buttonByText(host, 'Play').click();
    await app.ready;
    expect(world.placeAtGuide).toHaveBeenCalledTimes(1);
    await wait(GREET_MS + 80);
    expect(host.querySelector('.tq-overlay')).toBeNull();
    expect(lastObjective()).toBe(false);
    expect(hudText()).toContain('Done');
  });

  it('leaves the Scout alone when they open something before the greeting fires', async () => {
    const { app } = boot(storeWithScout(), '2026-10-03', { autoGreet: true, greetingDelayMs: 120 });
    buttonByText(host, 'Play').click();
    await app.ready;
    buttonByText(host.querySelector('.tq-hud')!, "Today's Trail").click();
    await wait(200);
    expect(host.querySelectorAll('.tq-overlay')).toHaveLength(1);
    expect(host.textContent).toContain('Up next'); // still the trail panel, no dialog on top
  });

  it('cancels the greeting when the Scout switches away', async () => {
    const { app } = boot(storeWithScout(), '2026-10-03', { autoGreet: true, greetingDelayMs: 120 });
    buttonByText(host, 'Play').click();
    await app.ready;
    buttonByText(host.querySelector('.tq-hud')!, "Today's Trail").click();
    await flush();
    buttonByText(host, 'Switch Scout').click();
    await wait(200);
    expect(host.textContent).toContain('Who is playing?');
    expect(host.textContent).not.toContain('Welcome back');
  });
});

describe('app: the Start button', () => {
  async function play(store = storeWithScout()) {
    const booted = boot(store);
    buttonByText(host, 'Play').click();
    await booted.app.ready;
    await flush();
    return booted;
  }

  it('shows "Start today\'s trail" at Base Camp and opens the Den Chief from anywhere', async () => {
    await play();
    expect(shown(startButton())).toBe(true);
    expect(startButton()!.textContent).toContain("Start today's trail");
    expect(lastObjective()).toBe(true);

    startButton()!.click();
    await flush();
    expect(host.textContent).toContain('Welcome back, Rowan!');
    expect(shown(startButton())).toBe(false); // an overlay is open
    expect(lastObjective()).toBe(false); // a session is running

    buttonByText(host, 'Look around first').click();
    await flush();
    expect(shown(startButton())).toBe(true);
    expect(lastObjective()).toBe(true);
  });

  it('hides while the trail panel is open', async () => {
    await play();
    buttonByText(host.querySelector('.tq-hud')!, "Today's Trail").click();
    await flush();
    expect(shown(startButton())).toBe(false);
  });

  it('puts the same Start button at the top of the trail panel, and it starts the trail talk', async () => {
    await play();
    buttonByText(host.querySelector('.tq-hud')!, "Today's Trail").click();
    await flush();
    const panelStart = host.querySelector<HTMLButtonElement>('.tq-overlay .tq-start')!;
    expect(panelStart.textContent).toContain("Start today's trail");
    // First thing after the title row, before the list of stops.
    const panel = host.querySelector('.tq-trail-panel')!;
    expect(Array.from(panel.children).indexOf(panelStart)).toBe(1);

    panelStart.click();
    await flush();
    expect(host.querySelector('.tq-trail-panel')).toBeNull();
    expect(host.textContent).toContain('Welcome back, Rowan!');
  });

  it('says "Bonus stop" when the trail is done and a bonus waits', async () => {
    const done = { current: 5, best: 5, lastTrailDate: '2026-10-03', embers: 0 };
    const store = storeWithScout(done, (p) => {
      p.requirements = { [ID.campQuiz]: doneReq() };
      p.review = { [ID.campQuiz]: card(0, '2026-10-02') };
    });
    await play(store);
    expect(shown(startButton())).toBe(true);
    expect(startButton()!.textContent).toContain('Bonus stop');
    expect(lastObjective()).toBe(false);

    buttonByText(host.querySelector('.tq-hud')!, "Today's Trail").click();
    await flush();
    expect(host.querySelector('.tq-overlay .tq-start')!.textContent).toContain('Bonus stop');
  });

  it('is hidden when the trail is done and there is no bonus', async () => {
    const done = { current: 5, best: 5, lastTrailDate: '2026-10-03', embers: 0 };
    await play(storeWithScout(done));
    expect(shown(startButton())).toBe(false);
    buttonByText(host.querySelector('.tq-hud')!, "Today's Trail").click();
    await flush();
    expect(host.querySelector('.tq-overlay .tq-start')).toBeNull();
  });

  it('is hidden on the picker, before anybody is playing', async () => {
    boot(storeWithScout());
    await flush();
    expect(shown(startButton())).toBe(false);
  });
});

describe('app: the controls hint', () => {
  async function play(tweak: (profile: Profile) => void = () => {}) {
    const booted = boot(storeWithScout(undefined, tweak));
    buttonByText(host, 'Play').click();
    await booted.app.ready;
    await flush();
    return booted;
  }

  /** Re-check the hint without waiting for the 250 ms timer. */
  const recheck = (app: ReturnType<typeof boot>['app']): void => app.setToday(app.today());

  it('shows during the first three sessions', async () => {
    await play(); // one finished session on record
    expect(shown(hintCard())).toBe(true);
  });

  it('stays away after the first three sessions until the Scout has stood still for 8 seconds', async () => {
    const { app } = await play(manySessions);
    expect(shown(hintCard())).toBe(false);
    world.idleSeconds = 7.9;
    recheck(app);
    expect(shown(hintCard())).toBe(false);
    world.idleSeconds = 8;
    recheck(app);
    expect(shown(hintCard())).toBe(true);
  });

  it('is put away by one tap and stays away until the Scout moves', async () => {
    const { app } = await play(manySessions);
    world.idleSeconds = 9;
    recheck(app);
    expect(shown(hintCard())).toBe(true);

    hintCard()!.click();
    expect(shown(hintCard())).toBe(false);
    world.idleSeconds = 20; // still standing there: no nagging
    recheck(app);
    expect(shown(hintCard())).toBe(false);

    world.idleSeconds = 0; // walked
    recheck(app);
    world.idleSeconds = 8;
    recheck(app);
    expect(shown(hintCard())).toBe(true);
  });

  it('does not show over a dialog or panel', async () => {
    await play();
    expect(shown(hintCard())).toBe(true);
    buttonByText(host.querySelector('.tq-hud')!, "Today's Trail").click();
    await flush();
    expect(shown(hintCard())).toBe(false);
    buttonByText(host, 'Close').click();
    await flush();
    expect(shown(hintCard())).toBe(true);
  });

  it('has no Read button: the game has no voice', async () => {
    await play();
    expect(Array.from(hintCard()!.querySelectorAll('button')).map((b) => b.textContent)).toEqual(['Got it']);
  });

  it('is only for Base Camp', async () => {
    const { app } = await play();
    expect(shown(hintCard())).toBe(true);
    world.state.zone = 'nature-trail';
    app.setToday(app.today()); // any refresh re-checks the hint
    expect(shown(hintCard())).toBe(false);
  });
});

describe('app: zones', () => {
  async function play() {
    const booted = boot(storeWithScout());
    buttonByText(host, 'Play').click();
    await booted.app.ready;
    await flush();
    return booted;
  }

  const openTrailPanel = async (): Promise<void> => {
    buttonByText(host.querySelector('.tq-hud')!, "Today's Trail").click();
    await flush();
  };

  it('lists a Places button for every zone in the trail panel and marks where the Scout is', async () => {
    await play();
    await openTrailPanel();
    const places = host.querySelector('.tq-places')!;
    const labels = Array.from(places.querySelectorAll('button')).map((b) => b.textContent);
    expect(labels).toHaveLength(6);
    for (const name of ['Base Camp', 'Fitness Field', 'Nature Trail', 'Town Square', 'Safety Station', 'Campfire Circle']) {
      expect(labels.some((l) => l?.includes(name))).toBe(true);
    }
    const here = places.querySelector<HTMLButtonElement>('button[aria-current="location"]')!;
    expect(here.textContent).toContain('Base Camp');
    expect(here.textContent).toContain('You are here');
    expect(here.disabled).toBe(true);
  });

  it('a Places button closes the panel and walks to that zone, which hides the Start button', async () => {
    await play();
    expect(shown(startButton())).toBe(true);
    await openTrailPanel();
    buttonByText(host.querySelector('.tq-places')!, 'Nature Trail').click();
    await flush();
    expect(world.travelTo).toHaveBeenCalledWith('nature-trail');
    expect(host.querySelector('.tq-overlay')).toBeNull();
    expect(shown(startButton())).toBe(false); // the Den Chief lives at Base Camp
  });

  it('Start in the trail panel walks home first when the Scout is somewhere else', async () => {
    await play();
    world.state.zone = 'nature-trail';
    await openTrailPanel();
    expect(host.querySelector('.tq-places button[aria-current="location"]')!.textContent).toContain('Nature Trail');
    host.querySelector<HTMLButtonElement>('.tq-overlay .tq-start')!.click();
    await flush();
    expect(world.travelTo).toHaveBeenCalledWith('base-camp');
    expect(host.textContent).toContain('Welcome back, Rowan!');
  });

  it('walks back to Base Camp when a conversation with the Den Chief ends somewhere else', async () => {
    await play();
    const talk = world.setDenChiefHandler.mock.calls.at(-1)![0] as () => void;
    talk();
    await flush();
    world.state.zone = 'nature-trail'; // as if the trail's last stop was out there
    buttonByText(host, 'Look around first').click();
    await flush();
    expect(world.travelTo).toHaveBeenCalledWith('base-camp');
    expect(world.state.zone).toBe('base-camp');
  });

  it('stays put when the conversation ends at Base Camp already', async () => {
    await play();
    const talk = world.setDenChiefHandler.mock.calls.at(-1)![0] as () => void;
    talk();
    await flush();
    buttonByText(host, 'Look around first').click();
    await flush();
    expect(world.travelTo).not.toHaveBeenCalled();
  });

  it('plays a collect stop in the zone, with the world host in ctx.world, then walks back to camp', async () => {
    // Bobcat is done, so today's trail is: a warm-up quiz, the collect stop (Nature Trail), a mission card.
    const store = storeWithScout(undefined, (p) => {
      for (const id of [ID.campQuiz, ID.campChore, ID.campErrand, ID.campSort]) p.requirements[id] = doneReq();
      p.review = { [ID.campQuiz]: card(0, '2026-10-02') }; // due: the warm-up is its quiz
    });
    const booted = boot(store);
    buttonByText(host, 'Play').click();
    await booted.app.ready;
    await flush();
    const click = async (text: string): Promise<void> => {
      buttonByText(host, text).click();
      await flush();
    };
    const talk = world.setDenChiefHandler.mock.calls.at(-1)![0] as () => void;
    talk();
    await flush();
    await click("Let's go!");

    // Stop 1: the warm-up quiz, at Base Camp. No travel.
    await click('Next'); // intro
    await click('Alpha');
    await click('Finish');
    await click('Next'); // cheer
    await click('Great!'); // finishing the quiz completed Test Camp: a badge
    expect(world.travelTo).not.toHaveBeenCalled();

    // Stop 2: collect. The trail sign walks to the Nature Trail first.
    await click('Next'); // intro
    expect(host.textContent).toContain('Walking to the Nature Trail');
    await wait(TRAVEL_SIGN_MS + 200);
    expect(world.travelTo).toHaveBeenCalledWith('nature-trail');
    expect(world.state.zone).toBe('nature-trail');

    // The panel is up and does not take input away; two tokens stand in the world.
    const panel = host.querySelector('[data-tq-nonmodal="true"]')!;
    expect(panel.textContent).toContain('Collect the test tokens.');
    expect(host.querySelector('.tq-overlay')).toBeNull();
    expect(world.input.setEnabled).toHaveBeenLastCalledWith(true);
    const placed = world.scene.add.mock.calls.map((c) => c[0] as { name: string; position: { x: number; z: number } });
    const tokens = placed.filter((o) => o.name === 'pickup:token');
    expect(tokens).toHaveLength(2);

    // Walk onto each token: the host's reach check runs on the world's fixed update.
    const step = world.onUpdate.mock.calls.at(-1)![0] as (dt: number) => void;
    for (const token of tokens) {
      world.player.position.x = token.position.x;
      world.player.position.z = token.position.z;
      step(1 / 60);
    }
    await flush();
    expect(panel.textContent).toContain('You found them all!');
    await click('Finish');
    expect(host.querySelector('[data-tq-nonmodal="true"]')).toBeNull();
    expect(world.scene.remove).toHaveBeenCalledTimes(2); // the world is cleaned up
    await click('Next'); // cheer

    // Stop 3: a mission card, still in the Nature Trail (no second trip), then the summary.
    await click('Next'); // intro
    await wait(TRAVEL_SIGN_MS + 200);
    await click('Got it!'); // the mission card (the controls hint's button has no exclamation mark)
    await click('Next'); // cheer
    expect(world.travelTo).toHaveBeenCalledTimes(1);
    expect(world.state.zone).toBe('nature-trail');
    expect(host.textContent).toContain('Great trail, Rowan!');

    // "Explore camp" is a camp: the Scout walks back.
    await click('Explore camp');
    expect(world.travelTo).toHaveBeenLastCalledWith('base-camp');
    expect(world.state.zone).toBe('base-camp');
  }, 15000);

  it('the Back to camp sign walks home, except in the middle of a stop', async () => {
    await play();
    const sign = world.setReturnHandler.mock.calls.at(-1)![0] as () => void;
    world.state.zone = 'nature-trail';
    sign();
    await flush();
    expect(world.travelTo).toHaveBeenCalledWith('base-camp');

    world.travelTo.mockClear();
    world.state.zone = 'nature-trail';
    const talk = world.setDenChiefHandler.mock.calls.at(-1)![0] as () => void;
    talk(); // a session is now busy
    await flush();
    sign();
    await flush();
    expect(world.travelTo).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Tap Back to leave this stop.');
  });
});
