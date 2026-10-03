import { describe, expect, it } from 'vitest';
import { adventureCounts, gradeLabel, summarizeScout } from '../../src/game/parent-overview';
import { busyProfile } from '../fixtures/parent.fixture';
import { makeProfile } from '../fixtures/profile.fixture';
import { ADVENTURE, fixtureRank } from '../fixtures/rank.fixture';

describe('parent overview numbers', () => {
  it('counts what each badge needs, with the choose rule capped at its count', () => {
    const profile = busyProfile();
    const byId = (id: string) => fixtureRank.adventures.find((a) => a.id === id)!;
    expect(adventureCounts(byId(ADVENTURE.trek), profile)).toEqual({ done: 2, total: 4 });
    expect(adventureCounts(byId(ADVENTURE.camp), profile)).toEqual({ done: 1, total: 4 });
    // 1 fixed + "any 2 of 3": three are done, so the bar reads 3 of 3, not 4 of 4.
    expect(adventureCounts(byId(ADVENTURE.pick), profile)).toEqual({ done: 3, total: 3 });
  });

  it('sums done over required requirements, counts badges and pending approvals, and finds the last played date', () => {
    const sum = summarizeScout(busyProfile(), fixtureRank);
    expect(sum).toMatchObject({
      lastPlayed: '2026-10-02',
      streak: 3,
      bestStreak: 5,
      xp: 120,
      badges: 1,
      badgesTotal: 3,
      done: 6,
      total: 11,
      percent: 55,
      pending: 2,
    });
    expect(sum.adventures.map((a) => [a.name, a.done, a.total, a.badge])).toEqual([
      ['Test Trek', 2, 4, false],
      ['Test Camp', 1, 4, false],
      ['Test Pick', 3, 3, true],
    ]);
  });

  it('leaves out adventures that are not required', () => {
    expect(summarizeScout(makeProfile(), fixtureRank).adventures.map((a) => a.id)).not.toContain(ADVENTURE.extra);
  });

  it('has no last played date before the first session, and zeros for a new Scout', () => {
    const sum = summarizeScout(makeProfile(), fixtureRank);
    expect(sum.lastPlayed).toBeUndefined();
    expect(sum).toMatchObject({ done: 0, total: 11, percent: 0, pending: 0, badges: 0, badgesTotal: 3 });
  });

  it('copes with a rank that has no content', () => {
    expect(summarizeScout(busyProfile(), undefined)).toMatchObject({
      done: 0,
      total: 0,
      percent: 0,
      pending: 0,
      badgesTotal: 0,
      adventures: [],
      xp: 120,
      lastPlayed: '2026-10-02',
    });
  });

  it('says Kindergarten for grade 0 and Grade N otherwise', () => {
    expect(gradeLabel(0)).toBe('Kindergarten');
    expect(gradeLabel(2)).toBe('Grade 2');
    expect(gradeLabel(5)).toBe('Grade 5');
  });
});
