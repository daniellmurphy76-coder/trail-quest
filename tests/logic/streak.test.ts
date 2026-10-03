import { describe, expect, it } from 'vitest';
import { advanceStreak, finishSession, MAX_SESSIONS } from '../../src/quests/progress';
import { XP_BY_STOP, type TodaysTrail, type TrailStop } from '../../src/quests/types';
import type { SessionLog, StopKind, Streak } from '../../src/save/types';
import { deepFreeze, makeProfile } from '../fixtures/profile.fixture';
import { fixtureRank, ID } from '../fixtures/rank.fixture';
import { planTrail } from '../../src/quests/planner';

const streak = (current: number, lastTrailDate: string | undefined, embers = 0, best = current): Streak => ({
  current,
  best,
  lastTrailDate,
  embers,
});

describe('advanceStreak', () => {
  it('starts at 1 on the first trail', () => {
    expect(advanceStreak(streak(0, undefined), '2026-10-03')).toEqual(streak(1, '2026-10-03', 0, 1));
  });

  it('adds one on the next calendar day', () => {
    expect(advanceStreak(streak(4, '2026-10-02'), '2026-10-03')).toEqual(streak(5, '2026-10-03', 0, 5));
  });

  it('does nothing for a second trail on the same day', () => {
    const before = streak(4, '2026-10-03', 1);
    expect(advanceStreak(before, '2026-10-03')).toEqual(before);
  });

  it('uses an ember to bridge exactly one missed day', () => {
    expect(advanceStreak(streak(4, '2026-10-01', 2), '2026-10-03')).toEqual(streak(5, '2026-10-03', 1, 5));
  });

  it('resets to 1 after one missed day with no ember, keeping the best', () => {
    expect(advanceStreak(streak(4, '2026-10-01', 0), '2026-10-03')).toEqual(streak(1, '2026-10-03', 0, 4));
  });

  it('resets after two or more missed days even with embers', () => {
    expect(advanceStreak(streak(9, '2026-09-30', 3), '2026-10-03')).toEqual(streak(1, '2026-10-03', 3, 9));
  });

  it('earns an ember on every 7th consecutive day, up to 3', () => {
    expect(advanceStreak(streak(6, '2026-10-02', 0), '2026-10-03')).toMatchObject({ current: 7, embers: 1 });
    expect(advanceStreak(streak(13, '2026-10-02', 1), '2026-10-03')).toMatchObject({ current: 14, embers: 2 });
    expect(advanceStreak(streak(20, '2026-10-02', 3), '2026-10-03')).toMatchObject({ current: 21, embers: 3 });
    expect(advanceStreak(streak(5, '2026-10-02', 0), '2026-10-03')).toMatchObject({ current: 6, embers: 0 });
  });

  it('can spend an ember and earn one on the same day', () => {
    expect(advanceStreak(streak(6, '2026-10-01', 1), '2026-10-03')).toMatchObject({ current: 7, embers: 1 });
  });

  it('counts consecutive days across a daylight saving change', () => {
    expect(advanceStreak(streak(2, '2026-03-07'), '2026-03-08').current).toBe(3);
    expect(advanceStreak(streak(2, '2026-03-08'), '2026-03-09').current).toBe(3);
    expect(advanceStreak(streak(2, '2026-10-31'), '2026-11-01').current).toBe(3);
    expect(advanceStreak(streak(2, '2026-11-01'), '2026-11-02').current).toBe(3);
  });

  it('keeps best when the streak grows past it', () => {
    expect(advanceStreak(streak(4, '2026-10-02', 0, 4), '2026-10-03').best).toBe(5);
    expect(advanceStreak(streak(2, '2026-10-02', 0, 9), '2026-10-03').best).toBe(9);
  });
});

function stop(kind: StopKind, requirementId: string): TrailStop {
  return {
    kind,
    requirementId,
    adventureId: 'wolf.test-camp',
    activity: fixtureRank.adventures[1].requirements[0].activity,
    zone: 'base-camp',
    title: 'Test stop.',
  };
}

const threeStops = [
  stop('warm-up', ID.campSort),
  stop('new-step', ID.campQuiz),
  stop('field-check', ID.campErrand),
];

function trail(stops: TrailStop[], completedStops: number): TodaysTrail {
  return { date: '2026-10-03', profileId: 'test-profile-1', stops, completedStops };
}

describe('finishSession', () => {
  it('logs the session and advances the streak when every non-bonus stop is done', () => {
    const profile = makeProfile({ streak: streak(2, '2026-10-02') });
    const next = finishSession(profile, trail(threeStops, 3), 240, '2026-10-03');
    expect(next.streak).toEqual(streak(3, '2026-10-03', 0, 3));
    expect(next.sessions).toHaveLength(1);
    expect(next.sessions[0]).toMatchObject({
      date: '2026-10-03',
      durationSec: 240,
      stops: [
        { kind: 'warm-up', requirementId: ID.campSort, completed: true },
        { kind: 'new-step', requirementId: ID.campQuiz, completed: true },
        { kind: 'field-check', requirementId: ID.campErrand, completed: true },
      ],
    });
  });

  it('does not touch the streak for a partial trail, but still logs it', () => {
    const profile = makeProfile({ streak: streak(2, '2026-10-02') });
    const next = finishSession(profile, trail(threeStops, 2), 90, '2026-10-03');
    expect(next.streak).toEqual(profile.streak);
    expect(next.sessions[0].stops.map((s) => s.completed)).toEqual([true, true, false]);
  });

  it('leaves the streak as is on a second trail the same day', () => {
    const profile = makeProfile({ streak: streak(3, '2026-10-03', 1) });
    const next = finishSession(profile, trail(threeStops, 3), 200, '2026-10-03');
    expect(next.streak).toEqual(profile.streak);
    expect(next.sessions).toHaveLength(1);
  });

  it('does not require the bonus stop', () => {
    const withBonus = [...threeStops, stop('bonus', ID.campQuiz)];
    const profile = makeProfile({ streak: streak(2, '2026-10-02') });
    expect(finishSession(profile, trail(withBonus, 3), 200, '2026-10-03').streak.current).toBe(3);
    expect(finishSession(profile, trail(withBonus, 4), 260, '2026-10-03').streak.current).toBe(3);
  });

  it('counts a bonus-only trail, but not an untouched one', () => {
    const only = [stop('bonus', ID.campQuiz)];
    const profile = makeProfile({ streak: streak(2, '2026-10-02') });
    expect(finishSession(profile, trail(only, 1), 60, '2026-10-03').streak.current).toBe(3);
    expect(finishSession(profile, trail(only, 0), 5, '2026-10-03').streak.current).toBe(2);
  });

  it('uses an ember to keep the fire lit through one missed day', () => {
    const profile = makeProfile({ streak: streak(5, '2026-10-01', 1) });
    const next = finishSession(profile, trail(threeStops, 3), 200, '2026-10-03');
    expect(next.streak).toMatchObject({ current: 6, embers: 0, lastTrailDate: '2026-10-03' });
  });

  it('derives xpEarned from completed stops; field-check counts only if approved today', () => {
    const base = makeProfile();
    const pending = finishSession(base, trail(threeStops, 3), 200, '2026-10-03');
    expect(pending.sessions[0].xpEarned).toBe(XP_BY_STOP['warm-up'] + XP_BY_STOP['new-step']);

    const approved = makeProfile({
      requirements: { [ID.campErrand]: { status: 'done', attempts: 0, approvedAt: '2026-10-03' } },
    });
    const full = finishSession(approved, trail(threeStops, 3), 200, '2026-10-03');
    expect(full.sessions[0].xpEarned).toBe(
      XP_BY_STOP['warm-up'] + XP_BY_STOP['new-step'] + XP_BY_STOP['field-check'],
    );
  });

  it('keeps only the 30 most recent sessions, newest last', () => {
    const old: SessionLog[] = Array.from({ length: 35 }, (_, i) => ({
      date: `2026-08-${String((i % 28) + 1).padStart(2, '0')}`,
      stops: [],
      xpEarned: i,
      durationSec: 60,
    }));
    const next = finishSession(makeProfile({ sessions: old }), trail(threeStops, 1), 60, '2026-10-03');
    expect(next.sessions).toHaveLength(MAX_SESSIONS);
    expect(next.sessions[next.sessions.length - 1].date).toBe('2026-10-03');
    expect(next.sessions[0].xpEarned).toBe(6);
  });

  it('works on a trail from the planner and never mutates its input', () => {
    const profile = deepFreeze(makeProfile({ streak: streak(1, '2026-10-02') }));
    const planned = planTrail(profile, fixtureRank, '2026-10-03');
    const next = finishSession(profile, { ...planned, completedStops: planned.stops.length }, 180, '2026-10-03');
    expect(next.streak.current).toBe(2);
    expect(profile.sessions).toHaveLength(0);
  });
});
