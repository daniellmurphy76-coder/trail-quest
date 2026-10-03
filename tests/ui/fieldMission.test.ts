// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { fieldMissionActivity } from '../../src/activities/fieldMission';
import type { FieldMissionParams } from '../../src/activities/types';
import { buttonByText, makeCtx, makeHost, maybeButton } from './helpers';

const PARAMS: FieldMissionParams = {
  title: 'Sample mission: Zip the Test Bunny picnic',
  kidSteps: ['Pick a pretend spot.', 'Draw the spot.', 'Show a grown-up.'],
  parentNote: 'Parent-only sample note.',
  evidence: 'checklist',
};

let host: HTMLElement;
beforeEach(() => {
  host = makeHost();
});

const boxes = (): HTMLInputElement[] => Array.from(host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));

describe('fieldMissionActivity handout', () => {
  it('shows the title, numbered steps and the real-life note, and resolves completed:false', async () => {
    const result = fieldMissionActivity.run(host, PARAMS, makeCtx({ stage: 'handout' }));
    expect(host.textContent).toContain(PARAMS.title);
    const steps = Array.from(host.querySelectorAll('ol.tq-steps > li')).map((li) => li.textContent);
    expect(steps).toEqual(PARAMS.kidSteps);
    expect(host.textContent).toContain('Do this in real life. Then come back and tell me!');
    expect(boxes()).toHaveLength(0); // no tick boxes in a handout
    expect(maybeButton(host, 'I did it!')).toBeNull();
    expect(host.textContent).not.toContain('Parent-only'); // parent note stays out of the kid card
    buttonByText(host, 'Got it!').click();
    await expect(result).resolves.toEqual({ completed: false, attempts: 1 });
    expect(host.querySelector('.tq-overlay')).toBeNull();
  });

  it('treats a missing stage as a handout', async () => {
    const result = fieldMissionActivity.run(host, PARAMS, makeCtx());
    buttonByText(host, 'Got it!').click();
    await expect(result).resolves.toEqual({ completed: false, attempts: 1 });
  });

  it('presses Got it! on Enter', async () => {
    const result = fieldMissionActivity.run(host, PARAMS, makeCtx({ stage: 'handout' }));
    (document.activeElement as HTMLElement).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    await expect(result).resolves.toEqual({ completed: false, attempts: 1 });
  });
});

describe('fieldMissionActivity check-in', () => {
  it('with a checklist, enables "I did it!" only when every box is ticked', async () => {
    const result = fieldMissionActivity.run(host, PARAMS, makeCtx({ stage: 'check-in' }));
    expect(boxes()).toHaveLength(3);
    const done = buttonByText(host, 'I did it!');
    expect(done.disabled).toBe(true);
    boxes()[0]!.click();
    boxes()[1]!.click();
    expect(done.disabled).toBe(true);
    boxes()[2]!.click();
    expect(done.disabled).toBe(false);
    boxes()[1]!.click(); // untick one: locked again
    expect(done.disabled).toBe(true);
    boxes()[1]!.click();
    expect(done.disabled).toBe(false);
    done.click();
    await expect(result).resolves.toEqual({ completed: true, attempts: 1 });
  });

  it('does not resolve when the disabled button is clicked', async () => {
    const result = fieldMissionActivity.run(host, PARAMS, makeCtx({ stage: 'check-in' }));
    buttonByText(host, 'I did it!').click();
    expect(host.querySelector('.tq-overlay')).not.toBeNull();
    buttonByText(host, 'Not yet').click();
    await expect(result).resolves.toEqual({ completed: false, attempts: 1 });
  });

  it('"Not yet" resolves completed:false even after ticking boxes', async () => {
    const result = fieldMissionActivity.run(host, PARAMS, makeCtx({ stage: 'check-in' }));
    boxes().forEach((box) => box.click());
    buttonByText(host, 'Not yet').click();
    await expect(result).resolves.toEqual({ completed: false, attempts: 1 });
  });

  it('without a checklist, "I did it!" is ready right away and no PIN pad appears', async () => {
    const result = fieldMissionActivity.run(
      host,
      { ...PARAMS, evidence: 'none' },
      makeCtx({ stage: 'check-in' }),
    );
    expect(boxes()).toHaveLength(0);
    const done = buttonByText(host, 'I did it!');
    expect(done.disabled).toBe(false);
    expect(host.querySelector('.tq-pin')).toBeNull();
    done.click();
    await expect(result).resolves.toEqual({ completed: true, attempts: 1 });
  });

  it('does not use the checklist in a handout even when evidence is checklist', async () => {
    const result = fieldMissionActivity.run(host, PARAMS, makeCtx({ stage: 'handout' }));
    expect(boxes()).toHaveLength(0);
    buttonByText(host, 'Got it!').click();
    await result;
  });
});
