// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { fieldMissionActivity } from '../../src/activities/fieldMission';
import { quizActivity } from '../../src/activities/quiz';
import { getActivity, isActivityImplemented } from '../../src/activities/registry';
import { sequenceActivity } from '../../src/activities/sequence';
import type { ActivityType } from '../../src/activities/types';
import { buttonByText, makeCtx, makeHost } from './helpers';

let host: HTMLElement;
beforeEach(() => {
  host = makeHost();
});

describe('getActivity', () => {
  it('returns the implemented controllers', () => {
    expect(getActivity('quiz')).toBe(quizActivity);
    expect(getActivity('sequence')).toBe(sequenceActivity);
    expect(getActivity('fieldMission')).toBe(fieldMissionActivity);
    expect(isActivityImplemented('quiz')).toBe(true);
  });

  it('returns a coming-soon controller for a type that is not built yet', async () => {
    const sort = getActivity('collect');
    expect(sort.type).toBe('collect');
    expect(isActivityImplemented('collect')).toBe(false);
    const ctx = makeCtx();
    const result = sort.run(host, { prompt: 'x', zone: 'nature-trail', targets: [] }, ctx);
    expect(host.textContent).toContain('This stop is still being built. Come back soon!');
    expect(ctx.speak).toHaveBeenCalledWith('This stop is still being built. Come back soon!');
    buttonByText(host, 'Next').click();
    await expect(result).resolves.toEqual({ completed: false, attempts: 0 });
    expect(host.querySelector('.tq-overlay')).toBeNull();
  });

  it('covers all unbuilt types, each keeping its own type name', () => {
    const unbuilt: ActivityType[] = ['collect', 'navigate'];
    for (const type of unbuilt) {
      expect(isActivityImplemented(type)).toBe(false);
      expect(getActivity(type).type).toBe(type);
    }
  });
});
