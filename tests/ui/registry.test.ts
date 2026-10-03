// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { collectActivity } from '../../src/activities/collect';
import { comingSoonActivity } from '../../src/activities/comingSoon';
import { fieldMissionActivity } from '../../src/activities/fieldMission';
import { navigateActivity } from '../../src/activities/navigate';
import { quizActivity } from '../../src/activities/quiz';
import { getActivity, IMPLEMENTED_TYPES, isActivityImplemented } from '../../src/activities/registry';
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
    expect(getActivity('collect')).toBe(collectActivity);
    expect(getActivity('navigate')).toBe(navigateActivity);
    expect(isActivityImplemented('quiz')).toBe(true);
  });

  it('has a real controller for every activity type, each keeping its own type name', () => {
    const all: ActivityType[] = ['quiz', 'sequence', 'sort', 'collect', 'navigate', 'rhythm', 'craft', 'fieldMission'];
    for (const type of all) {
      expect(isActivityImplemented(type)).toBe(true);
      expect(IMPLEMENTED_TYPES.has(type)).toBe(true);
      expect(getActivity(type).type).toBe(type);
    }
  });

  it('keeps the coming-soon stand-in for any future type: a friendly card that resolves "not done"', async () => {
    const stand = comingSoonActivity('collect');
    expect(stand.type).toBe('collect');
    const result = stand.run(host, { prompt: 'x', zone: 'nature-trail', targets: [] }, makeCtx());
    expect(host.textContent).toContain('This stop is still being built. Come back soon!');
    buttonByText(host, 'Next').click();
    await expect(result).resolves.toEqual({ completed: false, attempts: 0 });
    expect(host.querySelector('.tq-overlay')).toBeNull();
  });
});
