// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mountOverlay } from '../../src/ui/overlay';
import { posterOverlay, showPoster } from '../../src/ui/poster';
import { button } from '../../src/ui/widgets';
import { buttonByText, flush, makeHost, maybeButton, press } from './helpers';

/** Twelve invented lines, like a long poster: none of the real text. */
const LINES = Array.from({ length: 12 }, (_, i) => `Test poster line ${i + 1} of the whole thing.`);
const POSTER = { title: 'The Test Poster', lines: LINES };

let host: HTMLElement;
beforeEach(() => {
  host = makeHost();
});

const listed = (root: ParentNode = host): string[] =>
  Array.from(root.querySelectorAll('.tq-poster__line')).map((li) => li.textContent ?? '');

describe('showPoster', () => {
  it('shows the title and every line at once, as a list, with one big Next button', () => {
    void showPoster(host, { ...POSTER, hint: 'Here is the whole thing.' });
    const card = host.querySelector('.tq-poster')!;
    expect(card.querySelector('h2')!.textContent).toBe('The Test Poster');
    expect(card.textContent).toContain('Here is the whole thing.');
    // Every line is in the page now: no typewriter, nothing cut off.
    expect(listed()).toEqual(LINES);
    expect(card.querySelectorAll('ul > li')).toHaveLength(12);
    expect(card.querySelector('.tq-dialog__rest')).toBeNull();
    const buttons = Array.from(card.querySelectorAll('button'));
    expect(buttons.map((b) => b.textContent)).toEqual(['Next']);
    expect(buttons[0]!.classList.contains('tq-btn--primary')).toBe(true);
  });

  it('is a labelled dialog, and leaves the hint and title out when there are none', () => {
    void showPoster(host, { title: '', lines: ['Only line.'] });
    const root = host.querySelector('.tq-overlay')!;
    expect(root.getAttribute('role')).toBe('dialog');
    expect(root.getAttribute('aria-modal')).toBe('true');
    expect(root.getAttribute('aria-label')).toBe('Poster');
    expect(root.querySelector('h2')).toBeNull();
    expect(root.querySelector('.tq-poster__hint')).toBeNull();
    expect(listed()).toEqual(['Only line.']);
  });

  it('resolves when Next is tapped, and takes itself off the screen', async () => {
    let settled = false;
    const done = showPoster(host, POSTER).then(() => (settled = true));
    await flush();
    expect(settled).toBe(false);
    buttonByText(host, 'Next').click();
    await done;
    expect(settled).toBe(true);
    expect(host.querySelector('.tq-overlay')).toBeNull();
  });

  it.each(['Enter', ' '])('resolves on the %j key', async (key) => {
    const done = showPoster(host, POSTER);
    press(document, key);
    await done;
    expect(host.querySelector('.tq-overlay')).toBeNull();
  });

  it('uses the words it is given for the button', async () => {
    const done = showPoster(host, { ...POSTER, buttonLabel: "I'm ready" });
    expect(maybeButton(host, 'Next')).toBeNull();
    buttonByText(host, "I'm ready").click();
    await done;
  });

  it('waits for Next: Escape does not skip a lesson poster', async () => {
    let settled = false;
    void showPoster(host, POSTER).then(() => (settled = true));
    press(document, 'Escape');
    await flush();
    expect(settled).toBe(false);
    expect(host.querySelector('.tq-poster')).not.toBeNull();
  });

  it('resolves only once when Next is tapped twice', async () => {
    const resolved = vi.fn();
    const done = showPoster(host, POSTER).then(resolved);
    const next = buttonByText(host, 'Next');
    next.click();
    next.click();
    await done;
    await flush();
    expect(resolved).toHaveBeenCalledTimes(1);
  });

  it('never speaks', () => {
    void showPoster(host, POSTER);
    const labels = Array.from(host.querySelectorAll('button')).map((b) => b.textContent ?? '');
    for (const label of labels) expect(label).not.toMatch(/\bread\b|aloud|speak|listen/i);
  });
});

describe('posterOverlay (the peek)', () => {
  /** An "activity" underneath: an overlay with a default button that must not fire while peeking. */
  function activityUnderneath() {
    const underneath = mountOverlay(host, { label: 'Activity' });
    const press1 = vi.fn();
    const go = button('Go', { variant: 'primary', onClick: press1 });
    underneath.card.append(go);
    underneath.setDefault(go);
    return { underneath, press1 };
  }

  it('draws the same card with a Back button above the activity, which stays', async () => {
    const { press1 } = activityUnderneath();
    let settled = false;
    const peek = posterOverlay(host, POSTER).then(() => (settled = true));
    expect(host.querySelectorAll('.tq-overlay')).toHaveLength(2);
    const card = host.querySelector('.tq-poster')!;
    expect(listed(card)).toEqual(LINES);
    expect(Array.from(card.querySelectorAll('button')).map((b) => b.textContent)).toEqual(['←Back']);
    // It is the top overlay, so it is the one drawn last.
    expect(host.lastElementChild!.contains(card)).toBe(true);

    buttonByText(card, 'Back').click();
    await peek;
    expect(settled).toBe(true);
    // The activity is exactly where it was: still mounted, and nothing on it was pressed.
    expect(host.querySelectorAll('.tq-overlay')).toHaveLength(1);
    expect(host.querySelector('.tq-poster')).toBeNull();
    expect(host.textContent).toContain('Go');
    expect(press1).not.toHaveBeenCalled();
  });

  it('closes on Enter, Space and Escape without touching the overlay underneath', async () => {
    const { press1 } = activityUnderneath();
    for (const key of ['Enter', ' ', 'Escape']) {
      const peek = posterOverlay(host, POSTER);
      press(document, key);
      await peek;
      expect(host.querySelectorAll('.tq-overlay')).toHaveLength(1);
    }
    expect(press1).not.toHaveBeenCalled();
  });

  it('keeps the activity from seeing keys while the poster is up', async () => {
    const { press1 } = activityUnderneath();
    const peek = posterOverlay(host, POSTER);
    press(document, 'Enter'); // closes the poster; must not also press Go
    await peek;
    expect(press1).not.toHaveBeenCalled();
    press(document, 'Enter'); // now the activity is on top again
    expect(press1).toHaveBeenCalledTimes(1);
  });
});

describe('poster word grid', () => {
  it('lays the twelve Scout Law points out as two numbered columns, in order', async () => {
    const { posterLines, usesWordGrid } = await import('../../src/ui/poster');
    const law = ['Trustworthy', 'Loyal', 'Helpful', 'Friendly', 'Courteous', 'Kind', 'Obedient', 'Cheerful', 'Thrifty', 'Brave', 'Clean', 'Reverent'];
    expect(usesWordGrid(law)).toBe(true);
    const list = posterLines(law);
    expect(list.classList.contains('tq-poster__lines--grid')).toBe(true);
    expect(list.style.getPropertyValue('--tq-poster-rows')).toBe('6');
    const items = [...list.querySelectorAll('li')];
    expect(items).toHaveLength(12);
    expect(items[0]!.textContent).toBe('1Trustworthy');
    expect(items[11]!.textContent).toBe('12Reverent');
    expect(items[0]!.querySelector('.tq-poster__num')!.getAttribute('aria-hidden')).toBe('true');
  });

  it('keeps sentences such as the Scout Oath as one full-width line each', async () => {
    const { posterLines, usesWordGrid } = await import('../../src/ui/poster');
    const oath = ['On my honor I will do my best', 'to do my duty to God and my country', 'and to obey the Scout Law;', 'to help other people at all times;', 'to keep myself physically strong,', 'mentally awake, and morally straight.'];
    expect(usesWordGrid(oath)).toBe(false);
    expect(posterLines(oath).classList.contains('tq-poster__lines--grid')).toBe(false);
  });
});
