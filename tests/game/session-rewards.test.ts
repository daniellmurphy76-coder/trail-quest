import { describe, expect, it, vi } from 'vitest';
import type { ActivityResult, ActivityType } from '../../src/activities/types';
import type { RankContent } from '../../src/content/types';
import { createEventBus, events, type GameEvent } from '../../src/game/events';
import {
  createSession,
  type ActivityStage,
  type SessionDeps,
  type SummaryChoice,
  type SummaryInfo,
  type UnlockInfo,
} from '../../src/game/session';
import type { TrailStop } from '../../src/quests/types';
import type { Profile } from '../../src/save/types';
import { card, doneReq, makeProfile, TODAY } from '../fixtures/profile.fixture';
import { fixtureRank, ID } from '../fixtures/rank.fixture';

const IMPLEMENTED: ReadonlySet<ActivityType> = new Set(['quiz', 'sequence', 'fieldMission', 'collect']);

/** The Scout has learned the camp quiz (so the warm-up is a review): today is warm-up, new step, handout. */
const threeStops = (): Partial<Profile> => ({
  requirements: { [ID.campQuiz]: doneReq() },
  review: { [ID.campQuiz]: card(0, '2026-10-02') },
});

/** The one Bobcat mission with no practice, waiting on a parent: the trail is just its approval. */
function errandOnly(): RankContent {
  const camp = fixtureRank.adventures.find((a) => a.id === 'wolf.test-camp')!;
  return { ...fixtureRank, adventures: [{ ...camp, requirements: camp.requirements.filter((r) => r.id === ID.campErrand) }] };
}
const pendingErrand: Partial<Profile> = {
  requirements: { [ID.campErrand]: { status: 'pending-approval', attempts: 1, completedAt: '2026-10-01' } },
};

/** Only the first Test Trek requirement, a collect stop at the Nature Trail. */
function onlyCollect(): RankContent {
  const trek = fixtureRank.adventures[0]!;
  return { ...fixtureRank, adventures: [{ ...trek, requirements: [trek.requirements[0]!] }] };
}

interface Rig {
  deps: SessionDeps;
  profile: () => Profile;
  /** Every event, in order. */
  seen: GameEvent[];
  /** Events and the things on screen, in the order they happened: `event:<type>`, `run:<kind>`, `celebrate`... */
  timeline: string[];
  summaries: SummaryInfo[];
  toasts: string[];
  unlockCards: UnlockInfo[];
}

interface RigOptions {
  profile?: Partial<Profile>;
  content?: RankContent;
  result?: (stop: TrailStop, stage: ActivityStage) => ActivityResult;
  summaryChoice?: (info: SummaryInfo, index: number) => SummaryChoice;
  celebrate?: () => void;
  /** Leave the optional hooks out, as the older tests do. */
  bare?: boolean;
}

function rig(options: RigOptions = {}): Rig {
  let profile = makeProfile(options.profile);
  const bus = createEventBus();
  const seen: GameEvent[] = [];
  const timeline: string[] = [];
  const summaries: SummaryInfo[] = [];
  const toasts: string[] = [];
  const unlockCards: UnlockInfo[] = [];
  bus.on((event) => {
    seen.push(event);
    timeline.push(`event:${event.type}`);
  });
  let clock = 1_000_000;

  const deps: SessionDeps = {
    content: options.content ?? fixtureRank,
    implemented: IMPLEMENTED,
    getProfile: () => profile,
    persist: (next) => {
      profile = next;
    },
    today: () => TODAY,
    now: () => (clock += 10_000),
    wait: async () => {},
    showDialog: async () => 0,
    showPoster: async () => {},
    runActivity: async (stop, stage) => {
      timeline.push(`run:${stop.kind}`);
      if (options.result) return options.result(stop, stage);
      return stage === 'handout' ? { completed: false, attempts: 1 } : { completed: true, attempts: 1, score: 1 };
    },
    showTrailSign: () => () => {},
    showApproval: async () => true,
    hasPin: () => true,
    askPin: async () => true,
    askNewPin: async () => '1234',
    setPin: async () => {},
    showBadge: async () => {
      timeline.push('card:badge');
    },
    showSummary: async (info) => {
      timeline.push('card:summary');
      const index = summaries.length;
      summaries.push(info);
      return options.summaryChoice ? options.summaryChoice(info, index) : 'explore';
    },
    ...(options.bare
      ? {}
      : {
          events: bus,
          celebrate: () => {
            timeline.push('celebrate');
            options.celebrate?.();
          },
          showToast: (text: string) => {
            timeline.push('toast');
            toasts.push(text);
          },
          showUnlock: async (info: UnlockInfo) => {
            timeline.push(`card:unlock:${info.id}`);
            unlockCards.push(info);
          },
        }),
  };
  if (options.bare) deps.events = bus;
  return { deps, profile: () => profile, seen, timeline, summaries, toasts, unlockCards };
}

const types = (r: Rig): string[] => r.seen.map((e) => e.type);

describe('session events: a trail of three stops', () => {
  it('emits session-start, a stop-complete and a cheer for each stop, trail-complete and session-end, in order', async () => {
    const r = rig({ profile: threeStops() });
    await createSession(r.deps).talk();

    expect(r.timeline).toEqual([
      'event:session-start',
      'run:warm-up',
      'event:stop-complete',
      'celebrate',
      'run:new-step',
      'event:stop-complete',
      'celebrate',
      'run:field-check',
      'event:stop-complete',
      'celebrate',
      'event:trail-complete',
      'card:summary',
      'event:session-end',
    ]);
  });

  it('says what each stop was and what it earned', async () => {
    const r = rig({ profile: threeStops() });
    await createSession(r.deps).talk();
    const stops = r.seen.filter((e) => e.type === 'stop-complete');
    expect(stops).toEqual([
      { type: 'stop-complete', kind: 'warm-up', xp: 10 },
      { type: 'stop-complete', kind: 'new-step', xp: 20 },
      { type: 'stop-complete', kind: 'field-check', xp: 0 }, // a handout earns nothing
    ]);
    expect(r.seen.find((e) => e.type === 'trail-complete')).toEqual({ type: 'trail-complete', stops: 3 });
  });

  it('does not cheer, or say stop-complete, for a stop the kid backed out of', async () => {
    const r = rig({
      profile: threeStops(),
      result: (stop, stage) =>
        stop.kind === 'new-step'
          ? { completed: false, attempts: 1 }
          : stage === 'handout'
            ? { completed: false, attempts: 1 }
            : { completed: true, attempts: 1, score: 1 },
    });
    await createSession(r.deps).talk();
    expect(r.seen.filter((e) => e.type === 'stop-complete').map((e) => (e as { kind: string }).kind)).toEqual([
      'warm-up',
      'field-check',
    ]);
    expect(r.timeline.filter((t) => t === 'celebrate')).toHaveLength(2);
    // Two of three stops is not a finished trail: no confetti event, but the session still ends.
    expect(types(r)).not.toContain('trail-complete');
    expect(types(r).at(-1)).toBe('session-end');
  });

  it('says session-start and session-end again for each trail when the Scout keeps going', async () => {
    const r = rig({
      profile: threeStops(),
      summaryChoice: (_info, index) => (index === 0 ? 'keep-going' : 'explore'),
    });
    await createSession(r.deps).talk();
    expect(types(r).filter((t) => t === 'session-start')).toHaveLength(2);
    expect(types(r).filter((t) => t === 'session-end')).toHaveLength(2);
    expect(types(r).filter((t) => t === 'trail-complete')).toHaveLength(2);
    // Each trail closes before the next opens.
    expect(types(r).filter((t) => t === 'session-start' || t === 'session-end')).toEqual([
      'session-start',
      'session-end',
      'session-start',
      'session-end',
    ]);
  });

  it('says travel when a stop is in another zone', async () => {
    const r = rig({ content: onlyCollect() });
    await createSession(r.deps).talk();
    expect(r.seen.filter((e) => e.type === 'travel')).toEqual([{ type: 'travel', zone: 'nature-trail' }]);
    expect(r.timeline.indexOf('event:travel')).toBeLessThan(r.timeline.indexOf('run:new-step'));
  });

  it('says nothing about travel for stops at Base Camp', async () => {
    const r = rig({ profile: threeStops() });
    await createSession(r.deps).talk();
    expect(types(r)).not.toContain('travel');
  });

  it('uses the shared events bus when no bus is passed in', async () => {
    const r = rig({ profile: threeStops(), bare: true });
    delete r.deps.events;
    const heard: string[] = [];
    const off = events.on((event) => heard.push(event.type));
    try {
      await createSession(r.deps).talk();
    } finally {
      off();
    }
    expect(heard[0]).toBe('session-start');
    expect(heard).toContain('stop-complete');
    expect(heard.at(-1)).toBe('session-end');
  });

  it('still plays the whole trail when the optional hooks are left out', async () => {
    const r = rig({ profile: threeStops(), bare: true });
    await createSession(r.deps).talk();
    expect(r.summaries).toHaveLength(1);
    expect(r.summaries[0]).toMatchObject({ stopsDone: 3, title: 'New Hiker', unlocks: [] });
  });

  it('keeps going when the cheer hook throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const r = rig({
        profile: threeStops(),
        celebrate: () => {
          throw new Error('no avatar');
        },
      });
      await createSession(r.deps).talk();
      expect(r.summaries).toHaveLength(1);
      expect(r.summaries[0]).toMatchObject({ stopsDone: 3, stopsTotal: 3 });
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

describe('session events: a field mission approved by a parent', () => {
  it('says mission-approved first, then stop-complete, then the badge and the cosmetics it earned', async () => {
    const r = rig({ profile: pendingErrand, content: errandOnly() });
    await createSession(r.deps).talk();

    expect(r.timeline).toEqual([
      'event:session-start',
      'event:mission-approved',
      'event:stop-complete',
      'celebrate',
      'event:badge-earned',
      'card:badge',
      'event:cosmetic-unlocked', // the scout hat: a Bobcat adventure is done
      'card:unlock:hat-scout',
      'event:cosmetic-unlocked', // the backpack: the first approved mission
      'card:unlock:backpack',
      'event:trail-complete',
      'card:summary',
      'event:session-end',
    ]);
    expect(r.seen.find((e) => e.type === 'mission-approved')).toEqual({
      type: 'mission-approved',
      requirementId: ID.campErrand,
    });
    expect(r.seen.find((e) => e.type === 'stop-complete')).toEqual({ type: 'stop-complete', kind: 'field-check', xp: 30 });
    expect(r.seen.find((e) => e.type === 'badge-earned')).toEqual({ type: 'badge-earned', adventureId: 'wolf.test-camp' });
  });

  it('says nothing about an approval that did not happen', async () => {
    const r = rig({ profile: pendingErrand, content: errandOnly() });
    r.deps.askPin = async () => false;
    await createSession(r.deps).talk();
    expect(types(r)).not.toContain('mission-approved');
    expect(types(r)).not.toContain('stop-complete');
    expect(types(r)).not.toContain('cosmetic-unlocked');
  });
});

describe('session: trail titles', () => {
  it('shows a toast and says title-earned when a stop pushes XP past a threshold', async () => {
    const r = rig({ profile: { ...threeStops(), xp: 95 } });
    await createSession(r.deps).talk();

    expect(r.seen.filter((e) => e.type === 'title-earned')).toEqual([{ type: 'title-earned', title: 'Trail Walker' }]);
    expect(r.toasts).toEqual(['New title: Trail Walker!']);
    // It comes right after the stop that earned it (the warm-up, 95 + 10 = 105), before the next stop runs.
    const at = r.timeline.indexOf('event:title-earned');
    expect(at).toBeGreaterThan(r.timeline.indexOf('run:warm-up'));
    expect(at).toBeLessThan(r.timeline.indexOf('run:new-step'));
    expect(r.summaries[0]).toMatchObject({ title: 'Trail Walker', newTitle: 'Trail Walker' });
  });

  it('says nothing when the title does not change', async () => {
    const r = rig({ profile: { ...threeStops(), xp: 10 } });
    await createSession(r.deps).talk();
    expect(types(r)).not.toContain('title-earned');
    expect(r.toasts).toEqual([]);
    const summary = r.summaries[0]!;
    expect(summary.title).toBe('New Hiker');
    expect(summary.newTitle).toBeUndefined();
  });

  it('uses the older reading wording for the toast on a grade 4 or 5 trail', async () => {
    const r = rig({ profile: { ...threeStops(), xp: 95 }, content: { ...fixtureRank, readingLevel: 'grade5' } });
    await createSession(r.deps).talk();
    expect(r.toasts).toEqual(['You earned a new trail title: Trail Walker!']);
  });
});

describe('session: cosmetic unlocks', () => {
  it('earns the beanie at 50 XP, saves it as cosmetic:hat-beanie, and shows its card', async () => {
    const r = rig({ profile: { ...threeStops(), xp: 45 } });
    await createSession(r.deps).talk();

    expect(r.seen.filter((e) => e.type === 'cosmetic-unlocked')).toEqual([{ type: 'cosmetic-unlocked', id: 'hat-beanie' }]);
    expect(r.unlockCards).toEqual([{ id: 'hat-beanie', label: 'Beanie', group: 'hat' }]);
    expect(r.profile().unlocks).toContain('cosmetic:hat-beanie');
    expect(r.summaries[0]!.unlocks).toEqual(['Beanie']);
    // The card follows the cheer for the stop that earned it, before the next stop.
    expect(r.timeline.indexOf('card:unlock:hat-beanie')).toBeLessThan(r.timeline.indexOf('run:new-step'));
  });

  it('saves the cosmetic with the stop: no extra persist for it', async () => {
    const r = rig({ profile: { ...threeStops(), xp: 45 } });
    const persist = vi.fn(r.deps.persist);
    r.deps.persist = persist;
    await createSession(r.deps).talk();
    expect(persist).toHaveBeenCalledTimes(4); // three stops and the session log, as before
  });

  it('earns the star eyes when the trail lights a third day in a row, after the trail is done', async () => {
    const r = rig({
      profile: { ...threeStops(), xp: 100, streak: { current: 2, best: 2, lastTrailDate: '2026-10-02', embers: 0 } },
    });
    await createSession(r.deps).talk();
    expect(r.profile().streak.current).toBe(3);
    expect(r.seen.filter((e) => e.type === 'cosmetic-unlocked')).toContainEqual({ type: 'cosmetic-unlocked', id: 'eyes-star' });
    expect(r.timeline.indexOf('event:trail-complete')).toBeLessThan(r.timeline.indexOf('card:unlock:eyes-star'));
    expect(r.timeline.indexOf('card:unlock:eyes-star')).toBeLessThan(r.timeline.indexOf('card:summary'));
    expect(r.profile().unlocks).toContain('cosmetic:eyes-star');
    expect(r.summaries[0]!.unlocks).toContain('Star eyes');
  });

  it('never announces the same cosmetic twice when the Scout keeps going', async () => {
    const r = rig({
      profile: { ...threeStops(), xp: 45 },
      summaryChoice: (_info, index) => (index === 0 ? 'keep-going' : 'explore'),
    });
    await createSession(r.deps).talk();
    expect(r.seen.filter((e) => e.type === 'cosmetic-unlocked' && e.id === 'hat-beanie')).toHaveLength(1);
    expect(r.profile().unlocks.filter((u) => u === 'cosmetic:hat-beanie')).toHaveLength(1);
  });

  it('adds nothing for a Scout who has earned nothing new, and leaves the badge unlock alone', async () => {
    const r = rig({ profile: threeStops() });
    await createSession(r.deps).talk();
    expect(r.profile().unlocks).toEqual([]);
    expect(r.summaries[0]!.unlocks).toEqual([]);
  });
});
