import { describe, expect, it } from 'vitest';
import type { ActivityResult } from '../../src/activities/types';
import { getRequirement, learnActivityOf } from '../../src/content/load';
import { ZONE_BY_CATEGORY } from '../../src/content/types';
import {
  approveFieldMission,
  completeAdventuresIfDone,
  nextReviewCard,
  recordStopResult,
} from '../../src/quests/progress';
import { XP_BY_STOP, type TrailStop } from '../../src/quests/types';
import type { Profile, ReviewCard, StopKind } from '../../src/save/types';
import { card, deepFreeze, doneReq, makeProfile, TODAY } from '../fixtures/profile.fixture';
import { ADVENTURE, fixtureRank, ID } from '../fixtures/rank.fixture';

function stopFor(kind: StopKind, requirementId: string): TrailStop {
  const { requirement, adventure } = getRequirement(fixtureRank, requirementId)!;
  const activity = kind === 'field-check' ? requirement.activity : learnActivityOf(requirement)!;
  return {
    kind,
    requirementId,
    adventureId: adventure.id,
    activity,
    zone: ZONE_BY_CATEGORY[adventure.category],
    title: 'Test stop.',
  };
}

const ok = (extra: Partial<ActivityResult> = {}): ActivityResult => ({
  completed: true,
  attempts: 1,
  score: 1,
  ...extra,
});
const notDone: ActivityResult = { completed: false, attempts: 1 };

const record = (profile: Profile, kind: StopKind, id: string, result: ActivityResult, today = TODAY) =>
  recordStopResult(profile, stopFor(kind, id), result, today, fixtureRank);

describe('nextReviewCard (Leitner)', () => {
  it('creates a new card in box 0, due tomorrow', () => {
    expect(nextReviewCard(undefined, true, '2026-10-03')).toEqual({
      box: 0,
      dueOn: '2026-10-04',
      lastReviewedOn: '2026-10-03',
    });
  });

  it('climbs 1, 3, 7, 14, 30 days on correct answers and stays in the top box', () => {
    let current: ReviewCard | undefined = nextReviewCard(undefined, true, '2026-10-01');
    const seen: [number, string][] = [];
    for (const _ of [1, 2, 3, 4, 5]) {
      current = nextReviewCard(current, true, '2026-10-01');
      seen.push([current.box, current.dueOn]);
    }
    expect(seen).toEqual([
      [1, '2026-10-04'],
      [2, '2026-10-08'],
      [3, '2026-10-15'],
      [4, '2026-10-31'],
      [4, '2026-10-31'],
    ]);
  });

  it('sends a wrong answer back to box 0, due tomorrow', () => {
    expect(nextReviewCard(card(3, '2026-10-03'), false, '2026-10-03')).toMatchObject({
      box: 0,
      dueOn: '2026-10-04',
    });
  });
});

describe('recordStopResult: new-step', () => {
  it('completes a digital requirement, creates a card and awards XP', () => {
    const next = record(makeProfile(), 'new-step', ID.campQuiz, ok({ score: 0.8 }));
    expect(next.requirements[ID.campQuiz]).toEqual({
      status: 'done',
      attempts: 1,
      bestScore: 0.8,
      learnedAt: TODAY,
      completedAt: TODAY,
    });
    expect(next.review[ID.campQuiz]).toEqual({ box: 0, dueOn: '2026-10-04', lastReviewedOn: TODAY });
    expect(next.xp).toBe(XP_BY_STOP['new-step']);
  });

  it('awards new-step XP only once per requirement', () => {
    const once = record(makeProfile(), 'new-step', ID.campQuiz, ok());
    const twice = record(once, 'new-step', ID.campQuiz, ok(), '2026-10-05');
    expect(twice.xp).toBe(XP_BY_STOP['new-step']);
    expect(twice.requirements[ID.campQuiz].completedAt).toBe(TODAY);
    expect(twice.requirements[ID.campQuiz].status).toBe('done');
  });

  it('keeps the best score and counts attempts', () => {
    let profile = record(makeProfile(), 'new-step', ID.campQuiz, notDone);
    expect(profile.requirements[ID.campQuiz]).toMatchObject({ status: 'in-progress', attempts: 1 });
    expect(profile.xp).toBe(0);
    expect(profile.review[ID.campQuiz]).toBeUndefined();
    profile = record(profile, 'new-step', ID.campQuiz, ok({ attempts: 3, score: 0.5 }));
    expect(profile.requirements[ID.campQuiz]).toMatchObject({ status: 'done', attempts: 4, bestScore: 0.5 });
  });

  it('does not create a review card for a non-reviewable activity', () => {
    const next = record(makeProfile(), 'new-step', ID.trekCollect, ok({ score: undefined }));
    expect(next.requirements[ID.trekCollect].status).toBe('done');
    expect(next.review).toEqual({});
    expect(next.xp).toBe(XP_BY_STOP['new-step']);
  });

  it('learning a field mission practice does not complete the mission', () => {
    const next = record(makeProfile(), 'new-step', ID.campChore, ok());
    const progress = next.requirements[ID.campChore];
    expect(progress.status).toBe('available');
    expect(progress.learnedAt).toBe(TODAY);
    expect(progress.completedAt).toBeUndefined();
    expect(progress.bestScore).toBeUndefined();
    expect(next.review[ID.campChore]).toMatchObject({ box: 0, dueOn: '2026-10-04' });
    expect(next.xp).toBe(XP_BY_STOP['new-step']);

    const again = record(next, 'new-step', ID.campChore, ok(), '2026-10-04');
    expect(again.xp).toBe(XP_BY_STOP['new-step']);
  });

  it('leaves a field mission status alone when the practice is not finished', () => {
    const next = record(makeProfile(), 'new-step', ID.campChore, notDone);
    expect(next.requirements[ID.campChore].status).toBe('available');
    expect(next.requirements[ID.campChore].learnedAt).toBeUndefined();
    expect(next.xp).toBe(0);
  });

  it('treats a stop for an unknown requirement as digital when no content is given', () => {
    const next = recordStopResult(makeProfile(), stopFor('new-step', ID.campQuiz), ok(), TODAY);
    expect(next.requirements[ID.campQuiz].status).toBe('done');
  });
});

describe('recordStopResult: warm-up and bonus', () => {
  const learned = (): Profile =>
    makeProfile({
      requirements: { [ID.campQuiz]: doneReq('2026-09-20') },
      review: { [ID.campQuiz]: card(1, '2026-10-02') },
      xp: 100,
    });

  it('moves a card up a box when answered correctly and awards XP', () => {
    const next = record(learned(), 'warm-up', ID.campQuiz, ok());
    expect(next.review[ID.campQuiz]).toEqual({ box: 2, dueOn: '2026-10-10', lastReviewedOn: TODAY });
    expect(next.xp).toBe(100 + XP_BY_STOP['warm-up']);
  });

  it('sends a poor review back to box 0 due tomorrow, and still awards XP', () => {
    const next = record(learned(), 'warm-up', ID.campQuiz, ok({ score: 0.3 }));
    expect(next.review[ID.campQuiz]).toMatchObject({ box: 0, dueOn: '2026-10-04' });
    expect(next.xp).toBe(100 + XP_BY_STOP['warm-up']);
  });

  it('changes nothing when the player backs out', () => {
    const profile = learned();
    const next = record(profile, 'warm-up', ID.campQuiz, notDone);
    expect(next).toEqual(profile);
    expect(next).not.toBe(profile);
  });

  it('awards warm-up and bonus XP every time', () => {
    let profile = learned();
    profile = record(profile, 'warm-up', ID.campQuiz, ok());
    profile = record(profile, 'warm-up', ID.campQuiz, ok());
    profile = record(profile, 'bonus', ID.campQuiz, ok());
    expect(profile.xp).toBe(100 + 2 * XP_BY_STOP['warm-up'] + XP_BY_STOP.bonus);
  });

  it('does not rewrite when the requirement was completed', () => {
    const next = record(learned(), 'warm-up', ID.campQuiz, ok());
    expect(next.requirements[ID.campQuiz]).toMatchObject({
      status: 'done',
      completedAt: '2026-09-20',
      learnedAt: '2026-09-20',
    });
  });

  it('creates a card when a reviewed requirement has none yet', () => {
    const profile = makeProfile({
      requirements: { [ID.campChore]: { status: 'available', attempts: 1, learnedAt: '2026-09-20' } },
    });
    const next = record(profile, 'warm-up', ID.campChore, ok());
    expect(next.review[ID.campChore]).toMatchObject({ box: 0, dueOn: '2026-10-04' });
    expect(next.requirements[ID.campChore].status).toBe('available');
  });

  it('raises the best score of a digital requirement', () => {
    const profile = makeProfile({
      requirements: { [ID.campQuiz]: doneReq('2026-09-20', { bestScore: 0.5 }) },
      review: { [ID.campQuiz]: card(0, TODAY) },
    });
    const next = record(profile, 'warm-up', ID.campQuiz, ok({ score: 1 }));
    expect(next.requirements[ID.campQuiz].bestScore).toBe(1);
  });
});

describe('field missions', () => {
  it('goes handout, check-in, pending-approval, then done on approval', () => {
    let profile = makeProfile();

    profile = record(profile, 'field-check', ID.campErrand, notDone);
    expect(profile.requirements[ID.campErrand].status).toBe('in-progress');
    expect(profile.xp).toBe(0);

    // A second handout changes nothing.
    expect(record(profile, 'field-check', ID.campErrand, notDone).requirements[ID.campErrand].status).toBe(
      'in-progress',
    );

    profile = record(profile, 'field-check', ID.campErrand, ok({ score: undefined }), '2026-10-04');
    expect(profile.requirements[ID.campErrand].status).toBe('pending-approval');
    expect(profile.requirements[ID.campErrand].completedAt).toBe('2026-10-04');
    expect(profile.xp).toBe(0);
    expect(profile.review).toEqual({});

    profile = approveFieldMission(profile, ID.campErrand, '2026-10-05');
    expect(profile.requirements[ID.campErrand]).toMatchObject({
      status: 'done',
      approvedAt: '2026-10-05',
      completedAt: '2026-10-04',
    });
    expect(profile.xp).toBe(XP_BY_STOP['field-check']);
  });

  it('awards the field-check XP only on approval, and only once', () => {
    const pending = record(makeProfile(), 'field-check', ID.campErrand, ok({ score: undefined }));
    const approved = approveFieldMission(pending, ID.campErrand, TODAY);
    expect(approveFieldMission(approved, ID.campErrand, TODAY).xp).toBe(XP_BY_STOP['field-check']);
  });

  it('ignores approval for a mission that is not pending', () => {
    const profile = makeProfile({ requirements: { [ID.campErrand]: { status: 'in-progress', attempts: 0 } } });
    const next = approveFieldMission(profile, ID.campErrand, TODAY);
    expect(next.requirements[ID.campErrand].status).toBe('in-progress');
    expect(next.xp).toBe(0);
    expect(approveFieldMission(profile, 'wolf.nope.1', TODAY).xp).toBe(0);
  });

  it('never moves a finished mission backwards', () => {
    const profile = makeProfile({
      requirements: { [ID.campErrand]: { status: 'done', attempts: 0, approvedAt: '2026-09-01' } },
    });
    expect(record(profile, 'field-check', ID.campErrand, notDone).requirements[ID.campErrand].status).toBe('done');
    expect(record(profile, 'field-check', ID.campErrand, ok()).requirements[ID.campErrand].status).toBe('done');
  });
});

describe('completeAdventuresIfDone', () => {
  const campDone = {
    [ID.campQuiz]: doneReq(),
    [ID.campChore]: doneReq(),
    [ID.campErrand]: doneReq(),
    [ID.campSort]: doneReq(),
  };

  it('marks a finished adventure and unlocks its badge', () => {
    const next = completeAdventuresIfDone(makeProfile({ requirements: campDone }), fixtureRank, TODAY);
    expect(next.adventures).toEqual({ [ADVENTURE.camp]: { completedAt: TODAY } });
    expect(next.unlocks).toEqual([`badge:${ADVENTURE.camp}`]);
  });

  it('leaves unfinished adventures alone', () => {
    const { [ID.campSort]: _skip, ...partial } = campDone;
    const next = completeAdventuresIfDone(makeProfile({ requirements: partial }), fixtureRank, TODAY);
    expect(next.adventures).toEqual({});
    expect(next.unlocks).toEqual([]);
  });

  it('does not re-stamp or duplicate on a later call', () => {
    const first = completeAdventuresIfDone(makeProfile({ requirements: campDone }), fixtureRank, TODAY);
    const second = completeAdventuresIfDone(first, fixtureRank, '2026-10-09');
    expect(second.adventures[ADVENTURE.camp].completedAt).toBe(TODAY);
    expect(second.unlocks).toEqual([`badge:${ADVENTURE.camp}`]);
  });

  it('honors choose: needs the required step plus two of the three choices', () => {
    const base = { [ID.pickRhythm]: doneReq() };
    const one = completeAdventuresIfDone(
      makeProfile({ requirements: { ...base, [ID.pickQuiz]: doneReq() } }),
      fixtureRank,
      TODAY,
    );
    expect(one.adventures[ADVENTURE.pick]).toBeUndefined();

    const two = completeAdventuresIfDone(
      makeProfile({ requirements: { ...base, [ID.pickQuiz]: doneReq(), [ID.pickCraft]: doneReq() } }),
      fixtureRank,
      TODAY,
    );
    expect(two.adventures[ADVENTURE.pick]).toEqual({ completedAt: TODAY });
    expect(two.unlocks).toContain(`badge:${ADVENTURE.pick}`);

    const choicesOnly = completeAdventuresIfDone(
      makeProfile({ requirements: { [ID.pickQuiz]: doneReq(), [ID.pickSequence]: doneReq() } }),
      fixtureRank,
      TODAY,
    );
    expect(choicesOnly.adventures[ADVENTURE.pick]).toBeUndefined();
  });
});

describe('purity', () => {
  it('never mutates the profile it is given', () => {
    const profile = deepFreeze(
      makeProfile({
        requirements: { [ID.campQuiz]: doneReq(), [ID.campErrand]: { status: 'pending-approval', attempts: 0 } },
        review: { [ID.campQuiz]: card(1, '2026-10-02') },
      }),
    );
    expect(() => {
      record(profile, 'new-step', ID.campSort, ok());
      record(profile, 'new-step', ID.campChore, ok());
      record(profile, 'warm-up', ID.campQuiz, ok());
      record(profile, 'field-check', ID.trekChore, notDone);
      record(profile, 'field-check', ID.trekChore, ok());
      approveFieldMission(profile, ID.campErrand, TODAY);
      completeAdventuresIfDone(profile, fixtureRank, TODAY);
    }).not.toThrow();
  });
});
