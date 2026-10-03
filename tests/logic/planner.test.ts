import { describe, expect, it } from 'vitest';
import { requiredAdventuresInOrder } from '../../src/content/load';
import type { RankContent } from '../../src/content/types';
import {
  createPlanner,
  planBonusStop,
  planTrail,
  stageForStop,
} from '../../src/quests/planner';
import type { TodaysTrail } from '../../src/quests/types';
import type { RequirementProgress } from '../../src/save/types';
import { card, deepFreeze, doneReq, learnedReq, makeProfile, TODAY } from '../fixtures/profile.fixture';
import { ADVENTURE, fixtureRank, ID } from '../fixtures/rank.fixture';

type Progress = Record<string, RequirementProgress>;

const kinds = (trail: TodaysTrail) => trail.stops.map((s) => s.kind);
const ids = (trail: TodaysTrail) => trail.stops.map((s) => s.requirementId);
const planFor = (requirements: Progress, review = {}, content: RankContent = fixtureRank) =>
  planTrail(makeProfile({ requirements, review }), content, TODAY);

/** Every requirement of every required adventure done, each with its own learned date. */
function allRequiredDone(): Progress {
  const progress: Progress = {};
  let day = 10;
  for (const adventure of requiredAdventuresInOrder(fixtureRank)) {
    for (const requirement of adventure.requirements) {
      progress[requirement.id] = doneReq(`2026-09-${day++}`);
    }
  }
  return progress;
}

describe('planner: new-step and field-check', () => {
  it('starts with the Bobcat adventure even though it is listed after another', () => {
    const trail = planFor({});
    expect(kinds(trail)).toEqual(['new-step', 'field-check']);
    const [newStep, fieldCheck] = trail.stops;
    expect(newStep.requirementId).toBe(ID.campQuiz);
    expect(newStep.adventureId).toBe(ADVENTURE.camp);
    expect(newStep.zone).toBe('base-camp');
    expect(newStep.activity.type).toBe('quiz');
    expect(fieldCheck.requirementId).toBe(ID.campErrand);
    expect(trail.date).toBe(TODAY);
    expect(trail.profileId).toBe('test-profile-1');
    expect(trail.completedStops).toBe(0);
  });

  it('uses the first sentence of the kid text as the title', () => {
    const [newStep] = planFor({}).stops;
    expect(newStep.title).toBe('Test step 1 of wolf.test-camp.');
  });

  it('treats a requirement with no progress entry as available', () => {
    const withLocked = planFor({ [ID.campQuiz]: { status: 'locked', attempts: 0 } });
    expect(withLocked.stops[0].requirementId).toBe(ID.campQuiz);
    expect(planFor({}).stops[0].requirementId).toBe(ID.campQuiz);
  });

  it('offers a field mission practice as the new step, using the practice activity', () => {
    const trail = planFor({ [ID.campQuiz]: doneReq() });
    const newStep = trail.stops.find((s) => s.kind === 'new-step')!;
    expect(newStep.requirementId).toBe(ID.campChore);
    expect(newStep.activity.type).toBe('sequence');
    expect(stageForStop(makeProfile(), newStep)).toBe('new');
  });

  it('skips requirements that are already learned', () => {
    const trail = planFor({
      [ID.campQuiz]: doneReq(),
      [ID.campChore]: learnedReq(),
    });
    expect(trail.stops.find((s) => s.kind === 'new-step')!.requirementId).toBe(ID.campSort);
  });

  it('skips field missions that have no practice when choosing the new step', () => {
    const trail = planFor({
      [ID.campQuiz]: doneReq(),
      [ID.campChore]: learnedReq(),
      [ID.campSort]: doneReq(),
    });
    // Nothing is left to learn in Bobcat: the errand has no practice, the chore is learned.
    const newStep = trail.stops.find((s) => s.kind === 'new-step')!;
    expect(newStep.adventureId).toBe(ADVENTURE.trek);
    expect(newStep.requirementId).toBe(ID.trekCollect);
    expect(trail.stops.find((s) => s.kind === 'field-check')!.requirementId).toBe(ID.campChore);
  });

  it('moves to the next incomplete required adventure when the active one has no step left', () => {
    const trail = planFor({
      [ID.campQuiz]: doneReq(),
      [ID.campChore]: doneReq(),
      [ID.campSort]: doneReq(),
    });
    const newStep = trail.stops.find((s) => s.kind === 'new-step')!;
    expect(newStep.adventureId).toBe(ADVENTURE.trek);
    expect(newStep.zone).toBe('nature-trail');
    expect(trail.stops.find((s) => s.kind === 'field-check')!.requirementId).toBe(ID.campErrand);
  });

  it('never plans from an adventure that is not required', () => {
    const progress = allRequiredDone();
    const trail = planFor(progress);
    expect(ids(trail)).not.toContain(ID.extraQuiz);
  });

  it('prefers a pending-approval field mission, wherever it is', () => {
    const trail = planFor({
      [ID.trekChore]: { status: 'pending-approval', attempts: 0, learnedAt: '2026-09-20' },
    });
    const fieldCheck = trail.stops.find((s) => s.kind === 'field-check')!;
    expect(fieldCheck.requirementId).toBe(ID.trekChore);
    expect(fieldCheck.activity.type).toBe('fieldMission');
    expect(stageForStop(makeProfile({ requirements: { [ID.trekChore]: { status: 'pending-approval', attempts: 0 } } }), fieldCheck)).toBe('approval');
  });

  it('prefers a learned or practice-free field mission over an unlearned one', () => {
    // The chore comes first in content order but has an unlearned practice.
    const unlearned = planFor({}).stops.find((s) => s.kind === 'field-check')!;
    expect(unlearned.requirementId).toBe(ID.campErrand);

    const learned = planFor({ [ID.campChore]: learnedReq() }).stops.find((s) => s.kind === 'field-check')!;
    expect(learned.requirementId).toBe(ID.campChore);
  });

  it('falls back to an unlearned field mission only when nothing else is open', () => {
    const trail = planFor({ [ID.campErrand]: doneReq() });
    const fieldCheck = trail.stops.find((s) => s.kind === 'field-check')!;
    expect(fieldCheck.requirementId).toBe(ID.campChore);
  });

  it('picks the field-check stage from the requirement status', () => {
    const profile = (status: RequirementProgress['status']) =>
      makeProfile({ requirements: { [ID.campErrand]: { status, attempts: 0 } } });
    for (const [status, stage] of [
      ['locked', 'handout'],
      ['available', 'handout'],
      ['in-progress', 'check-in'],
    ] as const) {
      const p = profile(status);
      const stop = planTrail(p, fieldCheckOnlyContent(), TODAY).stops.find((s) => s.kind === 'field-check')!;
      expect(stop.requirementId).toBe(ID.campErrand);
      expect(stageForStop(p, stop)).toBe(stage);
    }
  });

  it('does not offer extra choices once the choose quota is met', () => {
    const progress = allRequiredDone();
    // Pick adventure: rhythm learned but not done; two choices done; the third is an extra.
    progress[ID.pickRhythm] = learnedReq();
    delete progress[ID.pickCraft];
    const trail = planFor(progress);
    expect(ids(trail)).not.toContain(ID.pickCraft);
    expect(trail.stops.some((s) => s.kind === 'new-step')).toBe(false);
  });

  it('offers choice requirements in order while the quota is not met', () => {
    const progress = allRequiredDone();
    delete progress[ID.pickRhythm];
    delete progress[ID.pickQuiz];
    delete progress[ID.pickSequence];
    delete progress[ID.pickCraft];
    expect(planFor(progress).stops.find((s) => s.kind === 'new-step')!.requirementId).toBe(ID.pickRhythm);
  });
});

/** Content reduced to the Bobcat errand, so a trail has exactly one field-check candidate. */
function fieldCheckOnlyContent(): RankContent {
  const camp = fixtureRank.adventures.find((a) => a.id === ADVENTURE.camp)!;
  return {
    ...fixtureRank,
    adventures: [{ ...camp, requirements: camp.requirements.filter((r) => r.id === ID.campErrand) }],
  };
}

describe('planner: warm-up', () => {
  it('is skipped when nothing has been learned', () => {
    expect(kinds(planFor({}))).not.toContain('warm-up');
  });

  it('picks the review card that is most overdue', () => {
    const trail = planFor(
      {
        [ID.campQuiz]: doneReq(),
        [ID.campSort]: doneReq(),
        [ID.trekChore]: learnedReq(),
      },
      {
        [ID.campQuiz]: card(2, '2026-10-02'),
        [ID.campSort]: card(1, '2026-10-01'),
        [ID.trekChore]: card(0, '2026-10-20'), // not due yet
      },
    );
    expect(trail.stops[0].kind).toBe('warm-up');
    expect(trail.stops[0].requirementId).toBe(ID.campSort);
    expect(trail.stops[0].activity.type).toBe('sort');
    expect(stageForStop(makeProfile(), trail.stops[0])).toBe('review');
  });

  it('counts a card due today as due', () => {
    const trail = planFor({ [ID.campQuiz]: doneReq() }, { [ID.campQuiz]: card(1, TODAY) });
    expect(trail.stops[0]).toMatchObject({ kind: 'warm-up', requirementId: ID.campQuiz });
  });

  it('breaks ties by lower box, then content order', () => {
    const requirements = { [ID.campQuiz]: doneReq(), [ID.campSort]: doneReq(), [ID.pickQuiz]: doneReq() };
    const sameBox = planFor(requirements, {
      [ID.pickQuiz]: card(1, '2026-10-01'),
      [ID.campSort]: card(1, '2026-10-01'),
    });
    expect(sameBox.stops[0].requirementId).toBe(ID.campSort);
    const lowerBox = planFor(requirements, {
      [ID.campSort]: card(2, '2026-10-01'),
      [ID.pickQuiz]: card(1, '2026-10-01'),
    });
    expect(lowerBox.stops[0].requirementId).toBe(ID.pickQuiz);
  });

  it('falls back to the most recently learned reviewable requirement', () => {
    const trail = planFor(
      {
        [ID.campQuiz]: doneReq('2026-09-20'),
        [ID.campSort]: doneReq('2026-09-25'),
        [ID.trekCollect]: doneReq('2026-09-29'), // not reviewable, so never a warm-up
      },
      { [ID.campQuiz]: card(1, '2026-10-20'), [ID.campSort]: card(1, '2026-10-20') },
    );
    expect(trail.stops[0]).toMatchObject({ kind: 'warm-up', requirementId: ID.campSort });
  });

  it('uses the practice activity when the requirement is a field mission', () => {
    const trail = planFor(
      { [ID.campChore]: learnedReq() },
      { [ID.campChore]: card(0, '2026-10-02') },
    );
    const warmUp = trail.stops[0];
    expect(warmUp.kind).toBe('warm-up');
    expect(warmUp.requirementId).toBe(ID.campChore);
    const chore = fixtureRank.adventures[1].requirements[1];
    expect(warmUp.activity).toBe(chore.practice);
    expect(warmUp.activity.type).toBe('sequence');
  });

  it('ignores cards for unknown or non-reviewable requirements', () => {
    const trail = planFor(
      { [ID.trekCollect]: doneReq() },
      { 'wolf.gone.1': card(0, '2026-10-01'), [ID.trekCollect]: card(0, '2026-10-01') },
    );
    expect(kinds(trail)).not.toContain('warm-up');
  });

  it('puts the stops in order: warm-up, new-step, field-check', () => {
    const trail = planFor({ [ID.campQuiz]: doneReq() }, { [ID.campQuiz]: card(0, '2026-10-02') });
    expect(kinds(trail)).toEqual(['warm-up', 'new-step', 'field-check']);
  });
});

describe('planner: bonus', () => {
  it('returns a single bonus review when everything is done', () => {
    const trail = planFor(allRequiredDone());
    expect(trail.stops).toHaveLength(1);
    expect(trail.stops[0].kind).toBe('bonus');
    // The most recently learned reviewable item (the last choice in the Pick adventure).
    expect(trail.stops[0].requirementId).toBe(ID.pickSequence);
    expect(['quiz', 'sequence', 'sort']).toContain(trail.stops[0].activity.type);
    expect(stageForStop(makeProfile(), trail.stops[0])).toBe('review');
  });

  it('prefers the most overdue card for the bonus review', () => {
    const trail = planFor(allRequiredDone(), { [ID.campSort]: card(1, '2026-09-30') });
    expect(trail.stops[0]).toMatchObject({ kind: 'bonus', requirementId: ID.campSort });
  });

  it('is empty only when there is nothing learned that can be reviewed', () => {
    const onlyCollect: RankContent = {
      ...fixtureRank,
      adventures: [
        { ...fixtureRank.adventures[0], requirements: [fixtureRank.adventures[0].requirements[0]] },
      ],
    };
    expect(planTrail(makeProfile({ requirements: { [ID.trekCollect]: doneReq() } }), onlyCollect, TODAY).stops).toEqual([]);
  });

  it('planBonusStop skips the requirements already used today', () => {
    const profile = makeProfile({ requirements: allRequiredDone() });
    const first = planBonusStop(profile, fixtureRank, TODAY)!;
    expect(first.kind).toBe('bonus');
    const second = planBonusStop(profile, fixtureRank, TODAY, [first.requirementId])!;
    expect(second.requirementId).not.toBe(first.requirementId);
    const all = Object.keys(profile.requirements);
    expect(planBonusStop(profile, fixtureRank, TODAY, all)).toBeUndefined();
  });
});

describe('planner: purity', () => {
  it('does not mutate its inputs and is repeatable', () => {
    const profile = deepFreeze(
      makeProfile({ requirements: { [ID.campQuiz]: doneReq() }, review: { [ID.campQuiz]: card(0, '2026-10-02') } }),
    );
    const content = deepFreeze(structuredClone(fixtureRank));
    const planner = createPlanner();
    const a = planner.plan(profile, content, TODAY);
    const b = planner.plan(profile, content, TODAY);
    expect(a).toEqual(b);
    expect(a.stops.length).toBeGreaterThan(0);
  });
});
