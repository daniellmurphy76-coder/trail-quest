// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PEEK_LABEL, peekButton, postersOf } from '../../src/activities/shared';
import { mountOverlay } from '../../src/ui/overlay';
import { button } from '../../src/ui/widgets';
import { buttonByText, flush, makeHost, maybeButton, press } from './helpers';

/** Invented text, nothing from the real Oath or Law. */
const OATH = { title: 'The Test Oath', lines: ['Oath line one.', 'Oath line two.'] };
const LAW = { title: 'The Test Law', lines: ['Law point one.', 'Law point two.', 'Law point three.'] };
const RULES = { title: 'The Test Rules', lines: ['Rule one.'] };

let host: HTMLElement;
beforeEach(() => {
  host = makeHost();
});

const listed = (): string[] =>
  Array.from(host.querySelectorAll('.tq-poster__line')).map((li) => li.textContent ?? '');
const title = (): string => host.querySelector('.tq-poster__title')?.textContent ?? '';
const posterCount = (): number => host.querySelectorAll('.tq-poster').length;

/** An "activity" underneath with a peek button, as in a quiz. */
function activity(source: Parameters<typeof peekButton>[1]) {
  const underneath = mountOverlay(host, { label: 'Activity' });
  const press1 = vi.fn();
  const go = button('Go', { variant: 'primary', onClick: press1 });
  const peek = peekButton(host, source);
  underneath.card.append(go, peek ?? '');
  underneath.setDefault(go);
  return { peek, press1 };
}

describe('postersOf', () => {
  it('prefers the list, falls back to the single poster, and is empty when there is neither', () => {
    expect(postersOf({ posters: [OATH, LAW], poster: OATH })).toEqual([OATH, LAW]);
    expect(postersOf({ poster: OATH })).toEqual([OATH]);
    expect(postersOf({ posters: [], poster: OATH })).toEqual([OATH]);
    expect(postersOf({})).toEqual([]);
  });

  it('leaves out a poster with nothing on it', () => {
    expect(postersOf({ posters: [{ title: 'Empty', lines: [] }, LAW] })).toEqual([LAW]);
  });
});

describe('peekButton', () => {
  it('is null when there is nothing to peek at', () => {
    expect(peekButton(host, undefined)).toBeNull();
    expect(peekButton(host, null)).toBeNull();
    expect(peekButton(host, [])).toBeNull();
    expect(peekButton(host, { title: 'Empty', lines: [] })).toBeNull();
  });

  it('says Show me for one poster or for several', () => {
    expect(peekButton(host, OATH)!.textContent).toContain(PEEK_LABEL);
    expect(peekButton(host, [OATH, LAW])!.textContent).toContain(PEEK_LABEL);
    expect(peekButton(host, [OATH, LAW])!.getAttribute('aria-haspopup')).toBe('dialog');
  });

  it('opens one poster as the plain peek, with just Back (as before)', async () => {
    const { peek, press1 } = activity([OATH]);
    peek!.click();
    expect(title()).toBe('The Test Oath');
    expect(listed()).toEqual(OATH.lines);
    expect(Array.from(host.querySelectorAll('.tq-poster button')).map((b) => b.textContent)).toEqual(['←Back']);
    expect(maybeButton(host, 'Next')).toBeNull();
    buttonByText(host.querySelector('.tq-poster')!, 'Back').click();
    await flush();
    expect(posterCount()).toBe(0);
    expect(press1).not.toHaveBeenCalled();
  });

  it('also takes the single legacy poster on its own', () => {
    const { peek } = activity(OATH);
    peek!.click();
    expect(title()).toBe('The Test Oath');
    expect(maybeButton(host, 'Next')).toBeNull();
  });
});

describe('the pager (more than one poster)', () => {
  it('starts on the first poster with a Next button that names the next one, and Back', () => {
    const { peek } = activity([OATH, LAW]);
    peek!.click();
    expect(posterCount()).toBe(1); // one card, not a card per poster
    expect(title()).toBe('The Test Oath');
    expect(listed()).toEqual(OATH.lines); // the whole first poster and nothing of the second
    expect(host.querySelector('.tq-poster__hint')!.textContent).toBe('1 of 2');
    const labels = Array.from(host.querySelectorAll('.tq-poster button')).map((b) => b.textContent);
    expect(labels).toEqual(['←Back', '→Next: The Test Law']);
    expect(host.querySelector('[role="dialog"].tq-overlay:last-child')!.getAttribute('aria-label')).toBe('The Test Oath');
  });

  it('Next moves to the second poster, whole, with Next naming the first again', () => {
    const { peek } = activity([OATH, LAW]);
    peek!.click();
    buttonByText(host.querySelector('.tq-poster')!, 'Next: The Test Law').click();
    expect(title()).toBe('The Test Law');
    expect(listed()).toEqual(LAW.lines);
    expect(host.querySelector('.tq-poster__hint')!.textContent).toBe('2 of 2');
    expect(maybeButton(host, 'Next: The Test Oath')).not.toBeNull(); // wraps around: no dead end
    expect(host.querySelector('[role="dialog"].tq-overlay:last-child')!.getAttribute('aria-label')).toBe('The Test Law');
    buttonByText(host, 'Next: The Test Oath').click();
    expect(title()).toBe('The Test Oath');
    expect(listed()).toEqual(OATH.lines);
  });

  it('moves through three posters in order', () => {
    const { peek } = activity([OATH, LAW, RULES]);
    peek!.click();
    const seen: string[] = [title()];
    for (let i = 0; i < 3; i += 1) {
      const next = Array.from(host.querySelectorAll<HTMLButtonElement>('.tq-poster button')).find((b) => /Next/.test(b.textContent ?? ''))!;
      next.click();
      seen.push(title());
    }
    expect(seen).toEqual(['The Test Oath', 'The Test Law', 'The Test Rules', 'The Test Oath']);
  });

  it('Back closes the peek from any page, and the activity underneath is untouched', async () => {
    const { peek, press1 } = activity([OATH, LAW]);
    peek!.click();
    buttonByText(host, 'Next: The Test Law').click();
    buttonByText(host.querySelector('.tq-poster')!, 'Back').click();
    await flush();
    expect(posterCount()).toBe(0);
    expect(host.querySelectorAll('.tq-overlay')).toHaveLength(1);
    expect(host.textContent).toContain('Go');
    expect(press1).not.toHaveBeenCalled();
  });

  it('Escape closes it, Enter moves on (Next is the default button), and neither presses the activity', async () => {
    const { peek, press1 } = activity([OATH, LAW]);
    peek!.click();
    press(document, 'Enter');
    expect(title()).toBe('The Test Law');
    press(document, 'Escape');
    await flush();
    expect(posterCount()).toBe(0);
    expect(press1).not.toHaveBeenCalled();
    press(document, 'Enter'); // the activity is on top again
    expect(press1).toHaveBeenCalledTimes(1);
  });

  it('can be opened again after it closes, and starts from the first poster again', async () => {
    const { peek } = activity([OATH, LAW]);
    peek!.click();
    buttonByText(host, 'Next: The Test Law').click();
    press(document, 'Escape');
    await flush();
    peek!.click();
    expect(title()).toBe('The Test Oath');
    expect(posterCount()).toBe(1);
  });

  it('does not open two peeks on a double tap', () => {
    const { peek } = activity([OATH, LAW]);
    peek!.click();
    peek!.click();
    expect(posterCount()).toBe(1);
  });

  it('says just Next when the next poster has no title, and draws no heading for a poster with none', () => {
    const { peek } = activity([{ title: '', lines: ['Plain one.'] }, { title: '', lines: ['Plain two.'] }]);
    peek!.click();
    expect(host.querySelector('.tq-poster__title')).toBeNull();
    expect(maybeButton(host, /^→Next$/)).not.toBeNull();
    expect(host.querySelector('[role="dialog"].tq-overlay:last-child')!.getAttribute('aria-label')).toBe('Poster');
  });

  it('never speaks', () => {
    const { peek } = activity([OATH, LAW]);
    peek!.click();
    for (const b of Array.from(host.querySelectorAll('.tq-poster button'))) {
      expect(b.textContent ?? '').not.toMatch(/\bread\b|aloud|speak|listen/i);
    }
  });
});
