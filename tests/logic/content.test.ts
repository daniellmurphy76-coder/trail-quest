import { describe, expect, it } from 'vitest';
import {
  getAdventure,
  getRequirement,
  isAdventureComplete,
  isReviewable,
  learnActivityOf,
  listRankContent,
  loadRankContent,
  requiredAdventuresInOrder,
} from '../../src/content/load';
import type { RequirementProgress } from '../../src/save/types';
import { ADVENTURE, fixtureRank, ID } from '../fixtures/rank.fixture';

const done: RequirementProgress = { status: 'done', attempts: 1 };

describe('content helpers', () => {
  it('looks up adventures and requirements', () => {
    expect(getAdventure(fixtureRank, ADVENTURE.camp)?.name).toBe('Test Camp');
    expect(getAdventure(fixtureRank, 'wolf.nope')).toBeUndefined();
    const found = getRequirement(fixtureRank, ID.campChore);
    expect(found?.requirement.id).toBe(ID.campChore);
    expect(found?.adventure.id).toBe(ADVENTURE.camp);
    expect(getRequirement(fixtureRank, 'wolf.nope.1')).toBeUndefined();
  });

  it('lists required adventures with bobcat first, then content order', () => {
    const ids = requiredAdventuresInOrder(fixtureRank).map((a) => a.id);
    expect(ids).toEqual([ADVENTURE.camp, ADVENTURE.trek, ADVENTURE.pick]);
  });

  it('knows which activities are reviewable', () => {
    const kinds = fixtureRank.adventures.flatMap((a) => a.requirements.map((r) => r.activity));
    const byType = (type: string) => kinds.find((k) => k.type === type)!;
    expect(isReviewable(byType('quiz'))).toBe(true);
    expect(isReviewable(byType('sequence'))).toBe(true);
    expect(isReviewable(byType('sort'))).toBe(true);
    for (const type of ['collect', 'navigate', 'rhythm', 'craft', 'fieldMission']) {
      expect(isReviewable(byType(type))).toBe(false);
    }
  });

  it('uses the practice activity as the learn activity of a field mission', () => {
    const chore = getRequirement(fixtureRank, ID.campChore)!.requirement;
    expect(learnActivityOf(chore)?.type).toBe('sequence');
    const errand = getRequirement(fixtureRank, ID.campErrand)!.requirement;
    expect(learnActivityOf(errand)).toBeUndefined();
    const quiz = getRequirement(fixtureRank, ID.campQuiz)!.requirement;
    expect(learnActivityOf(quiz)).toBe(quiz.activity);
  });

  describe('isAdventureComplete', () => {
    const camp = getAdventure(fixtureRank, ADVENTURE.camp)!;
    const pick = getAdventure(fixtureRank, ADVENTURE.pick)!;

    it('needs every non-optional requirement done', () => {
      const progress = {
        [ID.campQuiz]: done,
        [ID.campChore]: done,
        [ID.campErrand]: done,
      };
      expect(isAdventureComplete(camp, progress)).toBe(false);
      expect(isAdventureComplete(camp, { ...progress, [ID.campSort]: done })).toBe(true);
    });

    it('does not count pending-approval as done', () => {
      const progress = {
        [ID.campQuiz]: done,
        [ID.campChore]: done,
        [ID.campErrand]: { status: 'pending-approval', attempts: 0 } as RequirementProgress,
        [ID.campSort]: done,
      };
      expect(isAdventureComplete(camp, progress)).toBe(false);
    });

    it('honors choose: all required plus at least count of the choices', () => {
      expect(isAdventureComplete(pick, {})).toBe(false);
      expect(isAdventureComplete(pick, { [ID.pickQuiz]: done, [ID.pickSequence]: done })).toBe(false);
      const base = { [ID.pickRhythm]: done };
      expect(isAdventureComplete(pick, base)).toBe(false);
      expect(isAdventureComplete(pick, { ...base, [ID.pickQuiz]: done })).toBe(false);
      expect(isAdventureComplete(pick, { ...base, [ID.pickQuiz]: done, [ID.pickCraft]: done })).toBe(true);
      expect(
        isAdventureComplete(pick, {
          ...base,
          [ID.pickQuiz]: done,
          [ID.pickSequence]: done,
          [ID.pickCraft]: done,
        }),
      ).toBe(true);
    });
  });

  it('loads bundled content without needing any particular file', () => {
    const all = listRankContent();
    expect(Array.isArray(all)).toBe(true);
    for (const content of all) expect(loadRankContent(content.rank)).toBe(content);
  });
});
