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
      expect.arrayContaining(['quiz-a', 'quiz-b', 'sequence', 'mission-handout', 'mission-checkin', 'coming-soon']),
    );

    (list.querySelector('[data-id="mission-handout"]') as HTMLButtonElement).click();
    const ui = document.getElementById('ui')!;
    expect(ui.textContent).toContain('Sample mission');
    const gotIt = Array.from(ui.querySelectorAll('button')).find((b) => b.textContent?.includes('Got it!'))!;
    gotIt.click();
    await flush();
    const printed = JSON.parse(document.getElementById('result')!.textContent!);
    expect(printed).toEqual({ completed: false, attempts: 1 });

    (list.querySelector('[data-id="coming-soon"]') as HTMLButtonElement).click();
    expect(ui.textContent).toContain('still being built');
  });
});
