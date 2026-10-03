// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RankId } from '../../src/activities/types';
import { startApp } from '../../src/game/app';
import { createDefaultSave, createProfile, memoryStore, persistSave } from '../../src/save/store';
import { card, doneReq } from '../fixtures/profile.fixture';
import { ID } from '../fixtures/rank.fixture';
import { buttonByText, flush, makeHost, maybeButton } from '../ui/helpers';

// The same stand-in for the 3D world as app.test.ts: the app only touches these members.
const world = vi.hoisted(() => {
  const state = { zone: 'base-camp' as string };
  return {
    state,
    input: { setEnabled: vi.fn(), lastDevice: 'keyboard' as 'keyboard' | 'gamepad' | 'touch' },
    idleSeconds: 0,
    setDenChiefHandler: vi.fn(),
    setGuideName: vi.fn(),
    setPlayerAvatar: vi.fn(),
    placeAtGuide: vi.fn(),
    setObjectiveVisible: vi.fn(),
    currentZoneId: () => state.zone,
    travelTo: vi.fn(async (id: string) => {
      state.zone = id;
    }),
    setReturnHandler: vi.fn(),
    onZoneChange: vi.fn(() => () => {}),
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

// vi.mock factories run before the rest of the file, so what they use is made with vi.hoisted.
const { POSTER, CHORE_LINES } = vi.hoisted(() => ({
  POSTER: {
    title: 'The Test Poster',
    lines: ['Test poster line one.', 'Test poster line two.', 'Test poster line three.'],
  },
  CHORE_LINES: ['Chore line one.', 'Chore line two.'],
}));

// Test content only: the fixture rank, with a poster on the lesson of the new step (the camp chore).
vi.mock('../../src/content/load', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/content/load')>();
  const { fixtureRank, ID: fixtureIds } = await import('../fixtures/rank.fixture');
  const content = {
    ...fixtureRank,
    adventures: fixtureRank.adventures.map((adventure) => ({
      ...adventure,
      requirements: adventure.requirements.map((r) =>
        r.id === fixtureIds.campChore ? { ...r, lesson: { lines: CHORE_LINES, poster: POSTER } } : r,
      ),
    })),
  };
  return {
    ...actual,
    listRankContent: () => [content],
    loadRankContent: (rank: RankId) => (rank === content.rank ? content : undefined),
  };
});

let host: HTMLElement;
beforeEach(() => {
  host = makeHost();
  world.state.zone = 'base-camp';
});

const click = async (text: string): Promise<void> => {
  buttonByText(host, text).click();
  await flush();
};

/** A Scout with the camp quiz learned (so the warm-up is a review) and the chore as the new step. */
function storeWithWarmUp() {
  const store = memoryStore();
  const save = createDefaultSave();
  const profile = createProfile(save, { name: 'Rowan', rank: 'wolf' });
  profile.streak = { current: 4, best: 4, lastTrailDate: '2026-10-02', embers: 0 };
  profile.sessions = [{ date: '2026-10-02', stops: [], xpEarned: 30, durationSec: 80 }];
  profile.requirements[ID.campQuiz] = doneReq();
  profile.review = { [ID.campQuiz]: card(0, '2026-10-02') };
  persistSave(store, save);
  return store;
}

describe('app: a lesson with a poster', () => {
  it('shows the poster page after the intro line, then the lines, and offers Show me in the activity', async () => {
    const app = startApp({
      canvas: document.createElement('canvas'),
      ui: host,
      store: storeWithWarmUp(),
      today: '2026-10-03',
      autoGreet: false,
    });
    buttonByText(host, 'Play').click();
    await app.ready;
    await flush();
    const talk = world.setDenChiefHandler.mock.calls.at(-1)![0] as () => void;
    talk();
    await flush();
    await click("Let's go!");

    // Stop 1, the warm-up quiz: the camp quiz has no poster, so no poster page and no Show me.
    await click('Next'); // intro
    await click('I remember!');
    expect(maybeButton(host, 'Show me')).toBeNull();
    await click('Alpha');
    await click('Finish');
    await click('Next'); // cheer
    expect(host.querySelector('.tq-poster')).toBeNull();

    // Stop 2, the new step: intro line, the whole poster on one page, then the lesson lines.
    await click('Next'); // "A new step!"
    expect(host.textContent).toContain('Let me show you something first.');
    expect(host.querySelector('.tq-poster')).toBeNull();
    await click('Next'); // the lesson intro line
    const poster = host.querySelector<HTMLElement>('.tq-poster')!;
    expect(poster).not.toBeNull();
    expect(poster.querySelector('h2')!.textContent).toBe(POSTER.title);
    expect(poster.textContent).toContain('Here is the whole thing. Read it top to bottom.');
    expect(Array.from(poster.querySelectorAll('.tq-poster__line')).map((l) => l.textContent)).toEqual(POSTER.lines);
    expect(host.textContent).not.toContain('Chore line one.'); // the lines come after the poster
    await click('Next'); // the poster's Next

    expect(host.querySelector('.tq-poster')).toBeNull();
    expect(host.textContent).toContain('Chore line one.');
    await click('Next');
    expect(host.textContent).toContain('Chore line two.');
    await click('Next');

    // The sequence practice is running, with the poster one tap away.
    expect(host.textContent).toContain('Put the steps in order');
    await click('Show me');
    const peek = host.querySelector<HTMLElement>('.tq-poster')!;
    expect(Array.from(peek.querySelectorAll('.tq-poster__line')).map((l) => l.textContent)).toEqual(POSTER.lines);
    expect(peek.textContent).not.toContain('Here is the whole thing'); // the peek is just the card
    buttonByText(peek, 'Back').click();
    await flush();
    expect(host.querySelector('.tq-poster')).toBeNull();
    expect(host.textContent).toContain('Put the steps in order'); // still in the activity
  });
});
