// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { showSummary } from '../../src/game/screens/summary';
import { showUnlockCard, unlockLine } from '../../src/game/screens/unlock';
import { COSMETIC_LOCKS } from '../../src/player/avatar/options';
import type { UnlockInfo } from '../../src/game/session';
import { buttonByText, flush, makeHost, press } from '../ui/helpers';

let host: HTMLElement;
beforeEach(() => {
  host = makeHost();
});

const info = {
  stopsDone: 3,
  stopsTotal: 3,
  xpEarned: 60,
  streak: 4,
  streakLit: true,
  badges: ['Test Camp'],
  keepGoingAvailable: true,
};

describe('summary: the title and what was earned', () => {
  it('shows the trail title right under the heading', async () => {
    const result = showSummary(host, { info: { ...info, title: 'Trail Walker' }, level: 'grade2', vars: { name: 'Rowan' } });
    const heading = host.querySelector('h2')!;
    const title = host.querySelector('.tq-summary__title')!;
    expect(heading.textContent).toBe('Great trail, Rowan!');
    expect(title.textContent).toContain('Your title: Trail Walker');
    // Under the name, before the numbers.
    expect(heading.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(title.compareDocumentPosition(host.querySelector('.tq-summary__rows')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // A star mark comes with the words; the mark is decoration.
    expect(title.querySelector('[aria-hidden="true"]')!.textContent).toBe('★');
    buttonByText(host, 'Explore camp').click();
    await result;
  });

  it('gives a title earned on this trail a line of its own, in the wording for the level', async () => {
    const wolf = showSummary(host, {
      info: { ...info, title: 'Trail Walker', newTitle: 'Trail Walker' },
      level: 'grade2',
      vars: { name: 'Rowan' },
    });
    expect(host.querySelector('.tq-summary__newtitle')!.textContent).toBe('New title: Trail Walker!');
    buttonByText(host, 'Explore camp').click();
    await wolf;

    const arrow = showSummary(host, {
      info: { ...info, title: 'Trail Walker', newTitle: 'Trail Walker' },
      level: 'grade5',
      vars: { name: 'Rowan' },
    });
    expect(host.querySelector('.tq-summary__newtitle')!.textContent).toBe('You earned a new title: Trail Walker!');
    buttonByText(host, 'Explore camp').click();
    await arrow;
  });

  it('lists each cosmetic earned this trail, with a mark and the word New', async () => {
    const result = showSummary(host, {
      info: { ...info, title: 'New Hiker', unlocks: ['Scout hat', 'Backpack'] },
      level: 'grade2',
      vars: { name: 'Rowan' },
    });
    const items = Array.from(host.querySelectorAll('.tq-summary__unlocks li'));
    expect(items.map((li) => li.textContent)).toEqual(['✦New: Scout hat', '✦New: Backpack']);
    for (const li of items) expect(li.querySelector('[aria-hidden="true"]')).not.toBeNull();
    // The badge list is its own list, as before.
    expect(host.querySelector('.tq-summary__badges')!.textContent).toContain('Badge: Test Camp');
    buttonByText(host, 'Explore camp').click();
    await result;
  });

  it('is exactly the old card when there is no title and nothing earned', async () => {
    const result = showSummary(host, { info, level: 'grade2', vars: { name: 'Rowan' } });
    expect(host.querySelector('.tq-summary__title')).toBeNull();
    expect(host.querySelector('.tq-summary__newtitle')).toBeNull();
    expect(host.querySelector('.tq-summary__unlocks')).toBeNull();
    buttonByText(host, 'Explore camp').click();
    await result;

    const empty = showSummary(host, { info: { ...info, unlocks: [] }, level: 'grade2', vars: { name: 'Rowan' } });
    expect(host.querySelector('.tq-summary__unlocks')).toBeNull();
    buttonByText(host, 'Explore camp').click();
    await empty;
  });
});

describe('the unlock card', () => {
  const hat: UnlockInfo = { id: 'hat-scout', label: 'Scout hat', group: 'hat' };

  it('says "You earned a new hat! Try it on in Change my look." with the name of what was earned', async () => {
    const result = showUnlockCard(host, { info: hat, level: 'grade2', vars: { name: 'Rowan' } });
    expect(host.querySelector('h2')!.textContent).toBe('You earned a new hat! Try it on in Change my look.');
    expect(host.querySelector('.tq-unlock__name')!.textContent).toBe('Scout hat');
    expect(host.querySelector('[role="dialog"]')!.getAttribute('aria-label')).toBe('You earned a new hat! Try it on in Change my look.');
    buttonByText(host, 'Great!').click();
    await expect(result).resolves.toBeUndefined();
    expect(host.querySelector('.tq-overlay')).toBeNull();
  });

  it('has a line for every kind of cosmetic, and each one points at Change my look', () => {
    const lines = COSMETIC_LOCKS.map((lock) => unlockLine({ id: lock.id, label: lock.label, group: lock.group }, 'grade2'));
    expect(new Set(lines).size).toBe(4); // hat, eyes, backpack, shirt
    for (const text of lines) {
      expect(text).toMatch(/^You earned /);
      expect(text).toContain('Change my look');
    }
    expect(unlockLine({ id: 'backpack', label: 'Backpack', group: 'backpack' }, 'grade5')).toBe(
      'You earned a backpack! Try it on in Change my look.',
    );
  });

  it('is a plain card with one big Great! button that Enter and Space press', async () => {
    for (const key of ['Enter', ' ']) {
      const result = showUnlockCard(host, { info: hat, level: 'grade5', vars: {} });
      const buttons = Array.from(host.querySelectorAll('button'));
      expect(buttons.map((b) => b.textContent)).toEqual(['Great!']);
      expect(buttons[0]!.classList.contains('tq-btn--primary')).toBe(true);
      press(document, key);
      await result;
      expect(host.querySelector('.tq-overlay')).toBeNull();
    }
  });

  it('resolves only once when Great! is tapped twice', async () => {
    let settled = 0;
    const result = showUnlockCard(host, { info: hat, level: 'grade2', vars: {} }).then(() => (settled += 1));
    const great = buttonByText(host, 'Great!');
    great.click();
    great.click();
    await result;
    await flush();
    expect(settled).toBe(1);
  });

  it('draws no confetti itself: that comes from the cosmetic-unlocked event', () => {
    void showUnlockCard(host, { info: hat, level: 'grade2', vars: {} });
    expect(host.querySelector('canvas')).toBeNull();
  });
});
