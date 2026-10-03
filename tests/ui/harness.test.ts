// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import pageHtml from '../../dev/activities.html?raw';
import { flush } from './helpers';

describe('dev/activities.html harness', () => {
  it('lists the samples, runs one in #ui and prints the result as JSON', async () => {
    const body = /<body[^>]*>([\s\S]*)<\/body>/.exec(pageHtml)![1]!.replace(/<script[\s\S]*?<\/script>/g, '');
    document.body.innerHTML = body;
    await import('../../src/dev/activities-harness');

    const list = document.getElementById('list')!;
    const ids = Array.from(list.querySelectorAll('button')).map((b) => b.dataset.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'quiz-a',
        'quiz-b',
        'sequence',
        'mission-handout',
        'mission-checkin',
        'collect-a',
        'navigate-marker',
        'navigate-compass',
      ]),
    );

    (list.querySelector('[data-id="mission-handout"]') as HTMLButtonElement).click();
    const ui = document.getElementById('ui')!;
    expect(ui.textContent).toContain('Sample mission');
    const gotIt = Array.from(ui.querySelectorAll('button')).find((b) => b.textContent?.includes('Got it!'))!;
    gotIt.click();
    await flush();
    const printed = JSON.parse(document.getElementById('result')!.textContent!);
    expect(printed).toEqual({ completed: false, attempts: 1 });

    // A world activity runs on a fake world, with a "Walk to next" button to stand in for walking.
    (list.querySelector('[data-id="collect-a"]') as HTMLButtonElement).click();
    expect(ui.querySelector('[data-tq-nonmodal="true"]')).not.toBeNull();
    expect(ui.textContent).toContain('Help Zip find the pretend items.');
    const walk = ui.querySelector('[data-dev="walk-next"]') as HTMLButtonElement;
    for (let i = 0; i < 4; i++) walk.click(); // four pickups: one bunny, two acorns, one feather
    expect(ui.textContent).toContain('You found them all!');
    Array.from(ui.querySelectorAll('button')).find((b) => b.textContent?.includes('Finish'))!.click();
    await flush();
    expect(JSON.parse(document.getElementById('result')!.textContent!)).toEqual({ completed: true, attempts: 4, score: 1 });
    expect(ui.querySelector('[data-dev="walk-next"]')).toBeNull(); // the helper goes away with the activity

    (list.querySelector('[data-id="collect-no-world"]') as HTMLButtonElement).click();
    expect(ui.textContent).toContain('This stop needs the camp.');
  });
});
