import { describe, expect, it } from 'vitest';
import { checkVocabulary } from '../../scripts/vocabulary.mjs';
import { LINES } from '../../src/game/lines';
import {
  BEANIE_XP,
  evaluateUnlocks,
  GOLD_SHIRT_XP,
  STAR_EYES_STREAK,
  titleEarnedBetween,
  titleForXp,
  TRAIL_TITLES,
  UNLOCK_LINE_BY_GROUP,
  UNLOCK_RULES,
  withCosmetics,
  wornButUnearned,
} from '../../src/game/rewards';
import { mulberry32 } from '../../src/engine/seed';
import { DEN_CHIEF_AVATAR } from '../../src/player/avatar/presets';
import {
  ALL_COSMETIC_UNLOCKS,
  COSMETIC_LOCKS,
  COSMETIC_PREFIX,
  GOLD_SHIRT,
  SHIRT_COLORS,
  cosmeticLock,
  defaultAvatar,
  earnedCosmetics,
  fillAvatar,
  isOptionOpen,
  randomAvatar,
} from '../../src/player/avatar/options';
import type { Profile } from '../../src/save/types';
import { fixtureRank } from '../fixtures/rank.fixture';
import { makeProfile } from '../fixtures/profile.fixture';

/** Sentences end at . ! ? */
const sentences = (text: string): string[] => text.split(/[.!?]+/).map((s) => s.trim()).filter(Boolean);
const wordCount = (sentence: string): number => sentence.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;

describe('titleForXp', () => {
  it('has the six kid-level titles at 0, 100, 250, 500, 1000 and 2000 XP', () => {
    expect(TRAIL_TITLES.map((t) => t.xp)).toEqual([0, 100, 250, 500, 1000, 2000]);
    expect(TRAIL_TITLES.map((t) => t.title)).toEqual([
      'New Hiker',
      'Trail Walker',
      'Path Finder',
      'Trail Blazer',
      'Peak Climber',
      'Trail Legend',
    ]);
  });

  it.each([
    [0, 'New Hiker'],
    [1, 'New Hiker'],
    [99, 'New Hiker'],
    [100, 'Trail Walker'],
    [249, 'Trail Walker'],
    [250, 'Path Finder'],
    [499, 'Path Finder'],
    [500, 'Trail Blazer'],
    [999, 'Trail Blazer'],
    [1000, 'Peak Climber'],
    [1999, 'Peak Climber'],
    [2000, 'Trail Legend'],
    [999_999, 'Trail Legend'],
  ])('%i XP is %s', (xp, title) => {
    expect(titleForXp(xp)).toBe(title);
  });

  it('gives the first title to anything that is not a real amount of XP', () => {
    expect(titleForXp(-5)).toBe('New Hiker');
    expect(titleForXp(Number.NaN)).toBe('New Hiker');
    expect(titleForXp(Number.POSITIVE_INFINITY)).toBe('New Hiker');
  });

  it('never borrows a real Scouting rank name', () => {
    const banned = /bobcat|tiger|wolf|bear|webelos|lion|arrow|tenderfoot|second class|first class|star|life|eagle|scout/i;
    for (const { title } of TRAIL_TITLES) expect(title).not.toMatch(banned);
  });

  it('is only a name for the trail, in plain everyday words', () => {
    for (const { title } of TRAIL_TITLES) {
      expect(checkVocabulary(title, 2).map((m) => m.word)).toEqual([]);
      expect(wordCount(title)).toBeLessThanOrEqual(3);
    }
  });
});

describe('titleEarnedBetween', () => {
  it('names the new title only when a threshold was crossed', () => {
    expect(titleEarnedBetween(90, 110)).toBe('Trail Walker');
    expect(titleEarnedBetween(100, 110)).toBeUndefined(); // already there
    expect(titleEarnedBetween(0, 99)).toBeUndefined();
    expect(titleEarnedBetween(240, 250)).toBe('Path Finder');
  });

  it('names the highest title when one jump crosses two', () => {
    expect(titleEarnedBetween(90, 520)).toBe('Trail Blazer');
  });

  it('never congratulates XP that went down or stayed the same', () => {
    expect(titleEarnedBetween(300, 50)).toBeUndefined();
    expect(titleEarnedBetween(100, 100)).toBeUndefined();
  });
});

describe('the lock table', () => {
  it('has a rule for every locked option, and no rule for an option that is free', () => {
    expect(Object.keys(UNLOCK_RULES).sort()).toEqual(COSMETIC_LOCKS.map((l) => l.id).sort());
  });

  it('locks exactly the six options the game promises, and leaves braids and spiky free', () => {
    expect(COSMETIC_LOCKS.map((l) => `${l.group}:${l.value}`)).toEqual([
      'hat:scout',
      'hat:beanie',
      'hat:bucket',
      'backpack:on',
      'eyes:star',
      `shirt:${GOLD_SHIRT}`,
    ]);
    expect(cosmeticLock('hat', 'cap')).toBeUndefined();
    expect(cosmeticLock('hat', 'none')).toBeUndefined();
    expect(cosmeticLock('eyes', 'happy')).toBeUndefined();
    for (const style of ['braids', 'spiky']) expect(COSMETIC_LOCKS.some((l) => l.value === style)).toBe(false);
  });

  it('puts gold at the end of the shirt colors, with a name', () => {
    expect(SHIRT_COLORS.at(-1)).toEqual({ value: GOLD_SHIRT, label: 'Gold' });
  });

  it('has a plain earn-it line for each, in both reading levels, within the sentence and word rules', () => {
    const limit = { grade2: 10, grade5: 15 } as const;
    const grade = { grade2: 2, grade5: 5 } as const;
    for (const lock of COSMETIC_LOCKS) {
      for (const level of ['grade2', 'grade5'] as const) {
        const text = lock.earn[level];
        expect(text.trim(), `${lock.id}.${level}`).not.toBe('');
        for (const sentence of sentences(text)) expect(wordCount(sentence), `${lock.id}.${level}: ${sentence}`).toBeLessThanOrEqual(limit[level]);
        expect(checkVocabulary(text, grade[level]).map((m) => m.word), `${lock.id}.${level}`).toEqual([]);
      }
      expect(lock.label).toMatch(/^[A-Z][a-z]+( [a-z]+)?$/);
    }
  });

  it('has an unlock line for every kind of cosmetic', () => {
    for (const lock of COSMETIC_LOCKS) expect(LINES[UNLOCK_LINE_BY_GROUP[lock.group]].grade2).toMatch(/You earned/);
    expect(LINES.unlockHat.grade2).toBe('You earned a new hat! Try it on in Change my look.');
  });
});

describe('evaluateUnlocks', () => {
  const profile = (extra: Partial<Profile> = {}): Profile => makeProfile(extra);
  const earn = (extra: Partial<Profile> = {}): string[] => evaluateUnlocks(profile(extra), fixtureRank);

  it('earns nothing for a brand-new Scout', () => {
    expect(earn()).toEqual([]);
  });

  it('earns the scout hat for completing any Bobcat adventure, and only a Bobcat one', () => {
    expect(earn({ adventures: { 'wolf.test-camp': { completedAt: '2026-10-01' } } })).toEqual(['hat-scout']);
    expect(earn({ adventures: { 'wolf.test-trek': { completedAt: '2026-10-01' } } })).not.toContain('hat-scout');
  });

  it('earns the bucket hat for the first completed adventure that is not a Bobcat one', () => {
    expect(earn({ adventures: { 'wolf.test-trek': { completedAt: '2026-10-01' } } })).toEqual(['hat-bucket']);
    expect(earn({ adventures: { 'wolf.test-camp': { completedAt: '2026-10-01' } } })).not.toContain('hat-bucket');
    // Both kinds done: both hats.
    expect(
      earn({ adventures: { 'wolf.test-camp': { completedAt: 'x' }, 'wolf.test-pick': { completedAt: 'x' } } }),
    ).toEqual(['hat-scout', 'hat-bucket']);
  });

  it('knows an adventure from another rank too, and ignores one the game has never heard of', () => {
    // 'wolf.bobcat' lives in the bundled content, not in the fixture.
    expect(evaluateUnlocks(profile({ adventures: { 'wolf.bobcat': { completedAt: 'x' } } }), fixtureRank)).toEqual(['hat-scout']);
    expect(earn({ adventures: { 'nobody.knows-this': { completedAt: 'x' } } })).toEqual([]);
  });

  it('earns the beanie at 50 XP', () => {
    expect(earn({ xp: BEANIE_XP - 1 })).toEqual([]);
    expect(earn({ xp: BEANIE_XP })).toEqual(['hat-beanie']);
    expect(BEANIE_XP).toBe(50);
  });

  it('earns the backpack on the first approved field mission, not on a mission that only waits for a parent', () => {
    expect(earn({ requirements: { 'wolf.test-camp.3': { status: 'pending-approval', attempts: 1 } } })).toEqual([]);
    expect(
      earn({ requirements: { 'wolf.test-camp.3': { status: 'done', attempts: 1, approvedAt: '2026-10-01' } } }),
    ).toEqual(['backpack']);
  });

  it('earns the star eyes at a 3-day streak, counting the best streak as well as the current one', () => {
    expect(earn({ streak: { current: 2, best: 2, embers: 0 } })).toEqual([]);
    expect(earn({ streak: { current: 3, best: 3, embers: 0 } })).toEqual(['eyes-star']);
    expect(earn({ streak: { current: 1, best: 5, embers: 0 } })).toEqual(['eyes-star']);
    expect(STAR_EYES_STREAK).toBe(3);
  });

  it('earns the gold shirt at 500 XP (and the beanie along the way)', () => {
    expect(earn({ xp: GOLD_SHIRT_XP - 1 })).toEqual(['hat-beanie']);
    expect(earn({ xp: GOLD_SHIRT_XP })).toEqual(['hat-beanie', 'shirt-gold']);
    expect(GOLD_SHIRT_XP).toBe(500);
  });

  it('returns a Scout who has earned everything all six, in table order', () => {
    const all = earn({
      xp: 800,
      streak: { current: 4, best: 4, embers: 0 },
      adventures: { 'wolf.test-camp': { completedAt: 'x' }, 'wolf.test-trek': { completedAt: 'x' } },
      requirements: { 'wolf.test-camp.3': { status: 'done', attempts: 1, approvedAt: 'x' } },
    });
    expect(all).toEqual(COSMETIC_LOCKS.map((l) => l.id));
  });

  it('is idempotent: once saved, nothing is earned a second time', () => {
    const base = profile({ xp: 600, streak: { current: 3, best: 3, embers: 0 } });
    const first = evaluateUnlocks(base, fixtureRank);
    expect(first).toEqual(['hat-beanie', 'eyes-star', 'shirt-gold']);
    const saved = withCosmetics(base, first);
    expect(saved.unlocks).toEqual(['cosmetic:hat-beanie', 'cosmetic:eyes-star', 'cosmetic:shirt-gold']);
    expect(evaluateUnlocks(saved, fixtureRank)).toEqual([]);
    // Saving again changes nothing, and does not repeat entries.
    expect(withCosmetics(saved, first)).toBe(saved);
  });

  it('keeps the badge unlocks and does not change its input', () => {
    const base = Object.freeze(profile({ xp: 60, unlocks: ['badge:wolf.test-camp'] }));
    const ids = evaluateUnlocks(base, fixtureRank);
    const saved = withCosmetics(base, ids);
    expect(saved.unlocks).toEqual(['badge:wolf.test-camp', 'cosmetic:hat-beanie']);
    expect(base.unlocks).toEqual(['badge:wolf.test-camp']);
  });

  it('falls back to the bundled content when none is passed', () => {
    expect(evaluateUnlocks(profile({ adventures: { 'wolf.bobcat': { completedAt: 'x' } } }))).toEqual(['hat-scout']);
  });
});

describe('wornButUnearned (a look from before rewards)', () => {
  it('finds what the saved look wears and the Scout has not earned', () => {
    const wearing = profile({ hat: 'scout', eyes: 'star', backpack: true, shirt: GOLD_SHIRT });
    expect(wornButUnearned(wearing)).toEqual(['hat-scout', 'backpack', 'eyes-star', 'shirt-gold']);
    expect(wornButUnearned(withCosmetics(wearing, ['hat-scout', 'backpack']))).toEqual(['eyes-star', 'shirt-gold']);
  });

  it('finds nothing in a look made of free things, or in a v1 look', () => {
    expect(wornButUnearned(makeProfile())).toEqual([]);
    expect(wornButUnearned(profile({ hat: 'cap', hairStyle: 'braids' }))).toEqual([]);
  });

  function profile(avatar: Partial<Profile['avatar']>): Profile {
    return makeProfile({ avatar: { bodyColor: '#3d85c6', ...avatar } });
  }
});

describe('fillAvatar with a Scout’s unlocks', () => {
  const none: string[] = [];

  it('drops every option that has not been earned, back to the default', () => {
    const wearing = { hat: 'scout', eyes: 'star', backpack: true, shirt: GOLD_SHIRT, bodyColor: GOLD_SHIRT } as const;
    const filled = fillAvatar(wearing, 'wolf', none);
    expect(filled).toEqual(defaultAvatar('wolf'));
  });

  it.each([
    ['hat', { hat: 'scout' }, { hat: 'none' }],
    ['hat', { hat: 'beanie' }, { hat: 'none' }],
    ['hat', { hat: 'bucket' }, { hat: 'none' }],
    ['eyes', { eyes: 'star' }, { eyes: 'round' }],
    ['backpack', { backpack: true }, { backpack: false }],
  ] as const)('%s: %j falls back to %j', (_group, wanted, expected) => {
    expect(fillAvatar(wanted, 'wolf', none)).toMatchObject(expected);
  });

  it('drops a gold shirt, and a gold v1 body color, to the rank shirt', () => {
    const rankShirt = defaultAvatar('wolf').shirt;
    expect(fillAvatar({ shirt: GOLD_SHIRT }, 'wolf', none)).toMatchObject({ shirt: rankShirt, bodyColor: rankShirt });
    expect(fillAvatar({ bodyColor: GOLD_SHIRT }, 'wolf', none)).toMatchObject({ shirt: rankShirt, bodyColor: rankShirt });
    expect(fillAvatar({ shirt: GOLD_SHIRT.toUpperCase() }, 'wolf', none).shirt).toBe(rankShirt); // case does not matter
  });

  it('keeps everything that is free: cap, braids, spiky, wink, other colors', () => {
    const free = { hat: 'cap', hairStyle: 'braids', eyes: 'wink', shirt: '#c63d34' } as const;
    expect(fillAvatar(free, 'wolf', none)).toMatchObject(free);
    expect(fillAvatar({ hairStyle: 'spiky' }, 'wolf', none).hairStyle).toBe('spiky');
  });

  it('keeps an option once it is earned, and only that one', () => {
    const wanted = { hat: 'scout', eyes: 'star' } as const;
    expect(fillAvatar(wanted, 'wolf', [`${COSMETIC_PREFIX}hat-scout`])).toMatchObject({ hat: 'scout', eyes: 'round' });
    expect(fillAvatar(wanted, 'wolf', ALL_COSMETIC_UNLOCKS)).toMatchObject(wanted);
  });

  it('ignores badge unlocks and anything that is not a cosmetic', () => {
    expect(fillAvatar({ hat: 'scout' }, 'wolf', ['badge:wolf.bobcat', 'hat-scout']).hat).toBe('none');
    expect([...earnedCosmetics(['badge:x', 'cosmetic:backpack'])]).toEqual(['backpack']);
  });

  it('holds nothing back when no unlocks are given: the rig and the Den Chief draw what they are handed', () => {
    expect(fillAvatar({ hat: 'scout', eyes: 'star', backpack: true }, 'wolf')).toMatchObject({
      hat: 'scout',
      eyes: 'star',
      backpack: true,
    });
    expect(isOptionOpen('hat', 'scout')).toBe(true);
    expect(isOptionOpen('hat', 'scout', [])).toBe(false);
  });

  it('the Den Chief preset ignores locks: his scout hat stays on', () => {
    expect(DEN_CHIEF_AVATAR.hat).toBe('scout');
    expect(fillAvatar(DEN_CHIEF_AVATAR, 'wolf').hat).toBe('scout');
    expect(fillAvatar(DEN_CHIEF_AVATAR, 'wolf')).toEqual(DEN_CHIEF_AVATAR);
  });
});

describe('randomAvatar with a Scout’s unlocks', () => {
  it('never picks an option that has not been earned', () => {
    for (let seed = 0; seed < 200; seed += 1) {
      const a = randomAvatar('wolf', mulberry32(seed), []);
      expect(['scout', 'beanie', 'bucket']).not.toContain(a.hat);
      expect(a.eyes).not.toBe('star');
      expect(a.backpack).toBe(false);
      expect(a.shirt).not.toBe(GOLD_SHIRT);
      expect(fillAvatar(a, 'wolf', [])).toEqual(a);
    }
  });

  it('can pick them once they are earned', () => {
    const picks = new Set<string>();
    for (let seed = 0; seed < 300; seed += 1) {
      const a = randomAvatar('wolf', mulberry32(seed), ALL_COSMETIC_UNLOCKS);
      picks.add(a.hat);
      if (a.eyes === 'star') picks.add('star');
      if (a.backpack) picks.add('backpack');
      if (a.shirt === GOLD_SHIRT) picks.add('gold');
    }
    for (const seen of ['scout', 'beanie', 'bucket', 'star', 'backpack', 'gold']) expect(picks.has(seen)).toBe(true);
  });
});
