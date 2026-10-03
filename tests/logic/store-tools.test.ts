import { describe, expect, it } from 'vitest';
import type { RankId } from '../../src/activities/types';
import { defaultAvatar } from '../../src/player/avatar/options';
import { createDefaultSave, createProfile, nextRank, promoteRank, removeProfile, resetProgress } from '../../src/save/store';
import { card, deepFreeze, doneReq, makeProfile, TODAY } from '../fixtures/profile.fixture';

describe('nextRank', () => {
  it('walks Lion to Arrow of Light and then stops', () => {
    const order: RankId[] = ['lion', 'tiger', 'wolf', 'bear', 'webelos', 'arrow-of-light'];
    expect(order.map((rank) => nextRank(rank))).toEqual(['tiger', 'wolf', 'bear', 'webelos', 'arrow-of-light', undefined]);
  });
});

describe('resetProgress', () => {
  const busy = makeProfile({
    name: 'Rowan',
    guideName: 'Captain Sam',
    sound: false,
    avatar: { ...defaultAvatar('wolf'), hat: 'cap', glasses: true },
    xp: 120,
    streak: { current: 4, best: 6, lastTrailDate: TODAY, embers: 2 },
    requirements: { 'wolf.test-camp.1': doneReq() },
    adventures: { 'wolf.test-camp': { completedAt: TODAY } },
    review: { 'wolf.test-camp.1': card(2, '2026-10-10') },
    sessions: [{ date: TODAY, stops: [], xpEarned: 10, durationSec: 60 }],
    unlocks: ['badge:wolf.test-camp', 'hat:scout'],
  });

  it('clears XP, streak, requirements, review cards, adventures, sessions and unlocks', () => {
    const reset = resetProgress(busy);
    expect(reset).toMatchObject({
      xp: 0,
      streak: { current: 0, best: 0, embers: 0 },
      requirements: {},
      adventures: {},
      review: {},
      sessions: [],
      unlocks: [],
    });
    expect(reset.streak.lastTrailDate).toBeUndefined();
  });

  it('keeps who the Scout is: id, name, rank, guide, look and the sound setting', () => {
    const reset = resetProgress(busy);
    expect(reset).toMatchObject({
      id: busy.id,
      name: 'Rowan',
      rank: 'wolf',
      guideName: 'Captain Sam',
      sound: false,
      createdAt: busy.createdAt,
    });
    expect(reset.avatar).toEqual(busy.avatar);
  });

  it('returns a new profile and leaves the input alone', () => {
    const frozen = deepFreeze(structuredClone(busy));
    const reset = resetProgress(frozen);
    expect(reset).not.toBe(frozen);
    expect(frozen.xp).toBe(120);
    expect(frozen.requirements['wolf.test-camp.1']).toBeDefined();
  });
});

describe('removeProfile', () => {
  function twoScouts() {
    const save = createDefaultSave();
    const first = createProfile(save, { name: 'Rowan', rank: 'wolf' });
    const second = createProfile(save, { name: 'Zip', rank: 'bear' });
    return { save, first, second };
  }

  it('deletes the profile and says it was not the active one', () => {
    const { save, first, second } = twoScouts();
    expect(save.activeProfileId).toBe(second.id);
    expect(removeProfile(save, first.id)).toEqual({ removed: true, wasActive: false });
    expect(save.profiles.map((p) => p.name)).toEqual(['Zip']);
    expect(save.activeProfileId).toBe(second.id);
  });

  it('clears the active id when the active Scout goes, so the app can show the picker', () => {
    const { save, second } = twoScouts();
    expect(removeProfile(save, second.id)).toEqual({ removed: true, wasActive: true });
    expect(save.profiles.map((p) => p.name)).toEqual(['Rowan']);
    expect(save.activeProfileId).toBeUndefined();
    expect('activeProfileId' in save).toBe(false);
  });

  it('does nothing for an unknown id', () => {
    const { save } = twoScouts();
    expect(removeProfile(save, 'nobody')).toEqual({ removed: false, wasActive: false });
    expect(save.profiles).toHaveLength(2);
  });
});

describe('promoteRank', () => {
  it('moves the Scout up a rank and keeps the old rank progress where it is', () => {
    const wolf = makeProfile({
      xp: 50,
      requirements: { 'wolf.test-camp.1': doneReq() },
      adventures: { 'wolf.test-camp': { completedAt: TODAY } },
    });
    const bear = promoteRank(wolf, 'bear', () => true);
    expect(bear.rank).toBe('bear');
    expect(bear.xp).toBe(50);
    expect(bear.requirements).toEqual(wolf.requirements);
    expect(bear.adventures).toEqual(wolf.adventures);
    expect(wolf.rank).toBe('wolf');
  });

  it('moves the neckerchief to the new rank color only while it is still the old default', () => {
    const plain = makeProfile({ avatar: defaultAvatar('wolf') });
    expect(promoteRank(plain, 'bear', () => true).avatar.neckerchief).toBe(defaultAvatar('bear').neckerchief);

    const customized = makeProfile({ avatar: { ...defaultAvatar('wolf'), neckerchief: '#123456', hat: 'cap' } });
    const moved = promoteRank(customized, 'bear', () => true);
    expect(moved.avatar.neckerchief).toBe('#123456');
    expect(moved.avatar.hat).toBe('cap');

    const old = makeProfile({ avatar: { bodyColor: '#3d85c6' } }); // a v1 save has no neckerchief
    expect(promoteRank(old, 'bear', () => true).avatar.neckerchief).toBeUndefined();
  });

  it('keeps the rest of the look', () => {
    const profile = makeProfile({ avatar: { ...defaultAvatar('wolf'), skin: '#8d5524', hairStyle: 'curly', glasses: true } });
    expect(promoteRank(profile, 'bear', () => true).avatar).toMatchObject({ skin: '#8d5524', hairStyle: 'curly', glasses: true });
  });

  it('refuses a rank that has no content', () => {
    expect(() => promoteRank(makeProfile(), 'bear', (rank) => rank !== 'bear')).toThrow(/no adventures/);
  });

  it('refuses the same rank or an earlier one', () => {
    expect(() => promoteRank(makeProfile(), 'wolf', () => true)).toThrow(/earlier rank/);
    expect(() => promoteRank(makeProfile(), 'lion', () => true)).toThrow(/earlier rank/);
  });

  it('checks the bundled rank files by default', () => {
    // Every rank has a content file, so each step up is allowed.
    expect(promoteRank(makeProfile({ rank: 'lion' }), 'tiger').rank).toBe('tiger');
    expect(promoteRank(makeProfile({ rank: 'webelos' }), 'arrow-of-light').rank).toBe('arrow-of-light');
  });
});
