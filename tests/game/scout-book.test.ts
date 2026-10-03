// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import type { ReferenceContent } from '../../src/content/reference';
import { bookTabs, BOOK_TAB_LABELS, showScoutBook, showsBsaMottos } from '../../src/game/screens/scout-book';
import { buttonByText, flush, makeHost, maybeButton, press } from '../ui/helpers';

/** Invented text standing in for the real reference content. */
const REF: ReferenceContent = {
  oath: { title: 'Test Oath', lines: ['Oath line one.', 'Oath line two.', 'Oath line three.'] },
  law: {
    title: 'Test Law',
    points: [
      { word: 'Kind', meaning: 'Be nice to everyone.' },
      { word: 'Brave', meaning: 'Try even when it is hard.' },
      { word: 'Calm', meaning: 'Stay steady.' },
    ],
  },
  cubMotto: { title: 'Test Cub Motto', lines: ['Cub motto line.'] },
  bsaMotto: { title: 'Test Scouts BSA Motto', lines: ['Scouts motto line.'] },
  bsaSlogan: { title: 'Test Scouts BSA Slogan', lines: ['Scouts slogan line.'] },
  outdoorCode: { title: 'Test Outdoor Code', lines: ['Outdoor line one.', 'Outdoor line two.'] },
  leaveNoTrace: { title: 'Test Leave No Trace', lines: ['Trace line one.'] },
};

let host: HTMLElement;
beforeEach(() => {
  host = makeHost();
});

const book = (): HTMLElement => host.querySelector<HTMLElement>('.tq-book')!;
const tabLabels = (): string[] => Array.from(book().querySelectorAll('[role="tab"]')).map((t) => t.textContent ?? '');
const panel = (): HTMLElement => book().querySelector<HTMLElement>('[role="tabpanel"]')!;
const sectionTitles = (): string[] => Array.from(panel().querySelectorAll('h3')).map((h) => h.textContent ?? '');
const lineTexts = (): string[] => Array.from(panel().querySelectorAll('.tq-poster__line')).map((l) => l.textContent ?? '');
const tab = (name: string): HTMLButtonElement => buttonByText(book().querySelector('[role="tablist"]')!, name);

describe('Scout Book tabs', () => {
  it('has Oath, Law, Motto and Outdoors, in that order', () => {
    expect(bookTabs('wolf', REF).map((t) => t.label)).toEqual(['Oath', 'Law', 'Motto', 'Outdoors']);
    expect(BOOK_TAB_LABELS).toEqual({ oath: 'Oath', law: 'Law', motto: 'Motto', outdoors: 'Outdoors' });
  });

  it('gives only Webelos and Arrow of Light the Scouts BSA motto and slogan', () => {
    for (const rank of ['lion', 'tiger', 'wolf', 'bear'] as const) {
      expect(showsBsaMottos(rank)).toBe(false);
      const motto = bookTabs(rank, REF).find((t) => t.id === 'motto')!;
      expect(motto.sections.map((s) => s.title)).toEqual(['Test Cub Motto']);
    }
    for (const rank of ['webelos', 'arrow-of-light'] as const) {
      expect(showsBsaMottos(rank)).toBe(true);
      const motto = bookTabs(rank, REF).find((t) => t.id === 'motto')!;
      expect(motto.sections.map((s) => s.title)).toEqual([
        'Test Cub Motto',
        'Test Scouts BSA Motto',
        'Test Scouts BSA Slogan',
      ]);
    }
  });

  it('leaves out a tab with nothing in it, and has no tabs for an empty reference', () => {
    expect(bookTabs('wolf', { oath: REF.oath }).map((t) => t.id)).toEqual(['oath']);
    expect(bookTabs('wolf', { bsaMotto: REF.bsaMotto }).map((t) => t.id)).toEqual([]); // not a Wolf page
    expect(bookTabs('arrow-of-light', { bsaMotto: REF.bsaMotto }).map((t) => t.id)).toEqual(['motto']);
    expect(bookTabs('wolf', {})).toEqual([]);
  });
});

describe('showScoutBook for a Wolf', () => {
  it('opens on the Oath with every line visible, and tabs across the top', async () => {
    const done = showScoutBook(host, { rank: 'wolf', reference: REF });
    expect(book().querySelector('h2')!.textContent).toContain('Scout Book');
    expect(book().querySelector('[role="tablist"]')).not.toBeNull();
    expect(tabLabels()).toEqual(['Oath', 'Law', 'Motto', 'Outdoors']);
    expect(tab('Oath').getAttribute('aria-selected')).toBe('true');
    expect(tab('Law').getAttribute('aria-selected')).toBe('false');
    expect(sectionTitles()).toEqual(['Test Oath']);
    expect(lineTexts()).toEqual(['Oath line one.', 'Oath line two.', 'Oath line three.']);
    buttonByText(book(), 'Close').click();
    await done;
  });

  it('shows the Law with each point in bold and its plain meaning beneath', async () => {
    const done = showScoutBook(host, { rank: 'wolf', reference: REF });
    tab('Law').click();
    expect(tab('Law').getAttribute('aria-selected')).toBe('true');
    expect(tab('Oath').getAttribute('aria-selected')).toBe('false');
    expect(sectionTitles()).toEqual(['Test Law']);
    const points = Array.from(panel().querySelectorAll('.tq-law__point'));
    expect(points).toHaveLength(3);
    expect(points.map((p) => p.querySelector('strong')!.textContent)).toEqual(['Kind', 'Brave', 'Calm']);
    expect(points.map((p) => p.querySelector('.tq-law__meaning')!.textContent)).toEqual([
      'Be nice to everyone.',
      'Try even when it is hard.',
      'Stay steady.',
    ]);
    // The word comes first, the meaning after it (beneath, once drawn as a column).
    const first = points[0]!;
    expect(first.firstElementChild!.tagName).toBe('STRONG');
    expect(first.lastElementChild!.classList.contains('tq-law__meaning')).toBe(true);
    // The Oath page is gone, not stacked underneath.
    expect(panel().textContent).not.toContain('Oath line one.');
    buttonByText(book(), 'Close').click();
    await done;
  });

  it('shows only the Cub motto on the Motto tab', async () => {
    const done = showScoutBook(host, { rank: 'wolf', reference: REF });
    tab('Motto').click();
    expect(sectionTitles()).toEqual(['Test Cub Motto']);
    expect(lineTexts()).toEqual(['Cub motto line.']);
    expect(panel().textContent).not.toContain('Scouts motto line.');
    buttonByText(book(), 'Close').click();
    await done;
  });

  it('shows the Outdoor Code and Leave No Trace on the Outdoors tab', async () => {
    const done = showScoutBook(host, { rank: 'wolf', reference: REF });
    tab('Outdoors').click();
    expect(sectionTitles()).toEqual(['Test Outdoor Code', 'Test Leave No Trace']);
    expect(lineTexts()).toEqual(['Outdoor line one.', 'Outdoor line two.', 'Trace line one.']);
    buttonByText(book(), 'Close').click();
    await done;
  });

  it('resolves on Close, and on Escape, and removes itself', async () => {
    const closed = showScoutBook(host, { rank: 'wolf', reference: REF });
    buttonByText(book(), 'Close').click();
    await closed;
    expect(host.querySelector('.tq-overlay')).toBeNull();

    const escaped = showScoutBook(host, { rank: 'wolf', reference: REF });
    press(document, 'Escape');
    await escaped;
    expect(host.querySelector('.tq-overlay')).toBeNull();
  });
});

describe('showScoutBook for Arrow of Light', () => {
  it('adds the Scouts BSA motto and slogan to the Motto tab', async () => {
    const done = showScoutBook(host, { rank: 'arrow-of-light', reference: REF });
    expect(tabLabels()).toEqual(['Oath', 'Law', 'Motto', 'Outdoors']);
    tab('Motto').click();
    expect(sectionTitles()).toEqual(['Test Cub Motto', 'Test Scouts BSA Motto', 'Test Scouts BSA Slogan']);
    expect(lineTexts()).toEqual(['Cub motto line.', 'Scouts motto line.', 'Scouts slogan line.']);
    buttonByText(book(), 'Close').click();
    await done;
  });

  it('can open on a chosen tab', async () => {
    const done = showScoutBook(host, { rank: 'arrow-of-light', reference: REF, tab: 'law' });
    expect(tab('Law').getAttribute('aria-selected')).toBe('true');
    expect(sectionTitles()).toEqual(['Test Law']);
    buttonByText(book(), 'Close').click();
    await done;
  });
});

describe('showScoutBook keys, status and missing content', () => {
  it('moves between tabs with the arrow keys, wrapping round, and marks the tab with more than color', async () => {
    const done = showScoutBook(host, { rank: 'wolf', reference: REF });
    press(document, 'ArrowRight');
    expect(tab('Law').getAttribute('aria-selected')).toBe('true');
    expect(tab('Law').classList.contains('is-selected')).toBe(true);
    expect(sectionTitles()).toEqual(['Test Law']);
    press(document, 'End');
    expect(tab('Outdoors').getAttribute('aria-selected')).toBe('true');
    press(document, 'ArrowRight');
    expect(tab('Oath').getAttribute('aria-selected')).toBe('true');
    press(document, 'ArrowLeft');
    expect(tab('Outdoors').getAttribute('aria-selected')).toBe('true');
    // Only the tab you are on is in the tab order; the arrow keys reach the rest.
    expect(tab('Outdoors').tabIndex).toBe(0);
    expect(tab('Oath').tabIndex).toBe(-1);
    buttonByText(book(), 'Close').click();
    await done;
  });

  it('shows one tab for a half-written reference', async () => {
    const done = showScoutBook(host, { rank: 'wolf', reference: { oath: REF.oath } });
    expect(tabLabels()).toEqual(['Oath']);
    expect(lineTexts()).toHaveLength(3);
    buttonByText(book(), 'Close').click();
    await done;
  });

  it('shows a friendly empty page, with a working Close, when there is no reference at all', async () => {
    let settled = false;
    void showScoutBook(host, { rank: 'wolf', reference: {} }).then(() => (settled = true));
    expect(book().querySelector('[role="tab"]')).toBeNull();
    expect(book().textContent).toContain('Nothing here yet.');
    expect(maybeButton(book(), 'Close')).not.toBeNull();
    buttonByText(book(), 'Close').click();
    await flush();
    expect(settled).toBe(true);
    expect(host.querySelector('.tq-overlay')).toBeNull();
  });

  it('opens with the bundled reference when none is passed, without throwing', async () => {
    const done = showScoutBook(host, { rank: 'wolf' });
    expect(book()).not.toBeNull(); // real tabs when content/reference.json exists, the empty page when it does not
    buttonByText(book(), 'Close').click();
    await done;
  });
});
