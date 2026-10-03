import { describe, expect, it } from 'vitest';
import {
  adventureProgress,
  approveAndAward,
  pendingApprovals,
  requirementStatusWord,
  resetProfileProgress,
} from '../../src/game/parent';
import { badgeInitials } from '../../src/game/screens/badge';
import { deepFreeze, doneReq, learnedReq, makeProfile, TODAY } from '../fixtures/profile.fixture';
import { ADVENTURE, fixtureRank, ID } from '../fixtures/rank.fixture';

describe('parent mode: status words', () => {
  it('says Not yet, Learned, Waiting for approval or Done', () => {
    expect(requirementStatusWord(undefined)).toBe('Not yet');
    expect(requirementStatusWord({ status: 'locked', attempts: 0 })).toBe('Not yet');
    expect(requirementStatusWord({ status: 'in-progress', attempts: 1 })).toBe('Not yet');
    expect(requirementStatusWord(learnedReq())).toBe('Learned');
    expect(requirementStatusWord({ status: 'pending-approval', attempts: 1, learnedAt: '2026-09-20' })).toBe(
      'Waiting for approval',
    );
    expect(requirementStatusWord(doneReq())).toBe('Done');
  });
});

describe('parent mode: approvals', () => {
  const waiting = makeProfile({
    requirements: {
      [ID.campErrand]: { status: 'pending-approval', attempts: 1 },
      [ID.trekChore]: { status: 'pending-approval', attempts: 1 },
    },
  });

  it('lists waiting missions with their title, adventure and no parent note when there is none', () => {
    const pending = pendingApprovals(waiting, fixtureRank);
    // Content order: Test Trek is listed before Test Camp.
    expect(pending.map((p) => p.requirementId)).toEqual([ID.trekChore, ID.campErrand]);
    expect(pending[0]).toMatchObject({ title: 'Test trek chore', adventureName: 'Test Trek' });
    expect(pending[0]!.parentNote).toBeUndefined();
  });

  it('lists nothing without content or when nothing waits', () => {
    expect(pendingApprovals(waiting, undefined)).toEqual([]);
    expect(pendingApprovals(makeProfile(), fixtureRank)).toEqual([]);
  });

  it('approves a mission, awards the XP and does not mutate the profile', () => {
    const profile = deepFreeze(waiting);
    const result = approveAndAward(profile, fixtureRank, ID.campErrand, TODAY);
    expect(result.profile.requirements[ID.campErrand]).toMatchObject({ status: 'done', approvedAt: TODAY });
    expect(result.profile.xp).toBe(30);
    expect(result.newBadges).toEqual([]);
    expect(profile.requirements[ID.campErrand]!.status).toBe('pending-approval');
  });

  it('names the badge when the approval completes an adventure', () => {
    const profile = makeProfile({
      requirements: {
        [ID.campQuiz]: doneReq(),
        [ID.campChore]: doneReq(),
        [ID.campSort]: doneReq(),
        [ID.campErrand]: { status: 'pending-approval', attempts: 1 },
      },
    });
    const result = approveAndAward(profile, fixtureRank, ID.campErrand, TODAY);
    expect(result.newBadges).toEqual(['Test Camp']);
    expect(result.profile.adventures[ADVENTURE.camp]).toBeDefined();
    expect(result.profile.unlocks).toContain(`badge:${ADVENTURE.camp}`);
  });

  it('ignores a requirement that is not waiting', () => {
    const result = approveAndAward(makeProfile(), fixtureRank, ID.campErrand, TODAY);
    expect(result.profile.xp).toBe(0);
    expect(result.newBadges).toEqual([]);
  });
});

describe('parent mode: reset and counts', () => {
  it('clears progress but keeps who the Scout is', () => {
    const profile = makeProfile({
      name: 'Rowan',
      guideName: 'Captain Sam',
      readAloud: false,
      xp: 120,
      streak: { current: 4, best: 6, lastTrailDate: TODAY, embers: 1 },
      requirements: { [ID.campQuiz]: doneReq() },
      adventures: { [ADVENTURE.camp]: { completedAt: TODAY } },
      unlocks: ['badge:wolf.test-camp'],
      sessions: [{ date: TODAY, stops: [], xpEarned: 10, durationSec: 60 }],
    });
    const reset = resetProfileProgress(profile);
    expect(reset).toMatchObject({
      id: profile.id,
      name: 'Rowan',
      guideName: 'Captain Sam',
      rank: profile.rank,
      readAloud: false,
      xp: 0,
      streak: { current: 0, best: 0, embers: 0 },
      requirements: {},
      adventures: {},
      review: {},
      sessions: [],
      unlocks: [],
    });
    expect(profile.xp).toBe(120);
  });

  it('counts the requirements done in an adventure', () => {
    const camp = fixtureRank.adventures.find((a) => a.id === ADVENTURE.camp)!;
    const profile = makeProfile({ requirements: { [ID.campQuiz]: doneReq(), [ID.campSort]: doneReq() } });
    expect(adventureProgress(camp, profile)).toEqual({ done: 2, total: 4 });
  });
});

describe('badge initials', () => {
  it('uses the first letters of the main words', () => {
    expect(badgeInitials('Paws on the Path')).toBe('PP');
    expect(badgeInitials('Running with the Pack')).toBe('RP');
    expect(badgeInitials('Bobcat Arrow of Light')).toBe('BAL');
    expect(badgeInitials('Test Camp')).toBe('TC');
  });

  it('uses two letters for a single word and never comes back empty', () => {
    expect(badgeInitials('Footsteps')).toBe('FO');
    expect(badgeInitials('')).toBe('?');
    expect(badgeInitials('the of')).toBe('TO');
  });
});
