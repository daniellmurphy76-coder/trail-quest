/**
 * The Scout Book: a reference screen with the Oath, the Law, the mottos and the outdoor codes, each
 * on one page in big type, for a Scout who wants to look something up or practice it again. Opened
 * from the trail panel. Tabs across the top: Oath, Law, Motto, Outdoors. Webelos and Arrow of Light
 * also get the Scouts BSA motto and slogan on the Motto tab, since that is where they are headed.
 *
 * The text comes from content/reference.json (see src/content/reference.ts). A tab with nothing in
 * it is left out, and a book with nothing at all shows a friendly empty page, so a missing or
 * half-written reference file never breaks the screen. Nothing here is spoken.
 */
import type { RankId } from '../../activities/types';
import { loadReference, type LawPoint, type ReferenceContent, type ReferenceText } from '../../content/reference';
import { append, h, type Child } from '../../ui/dom';
import { mountOverlay } from '../../ui/overlay';
import { posterLines } from '../../ui/poster';
import { button, icon, uid } from '../../ui/widgets';
import { line, type LineLevel } from '../lines';

export type BookTabId = 'oath' | 'law' | 'motto' | 'outdoors';

/** One block on a page: a poster of lines, or the Scout Law with a meaning under each word. */
export type BookSection =
  | { kind: 'poster'; title: string; lines: string[] }
  | { kind: 'law'; title: string; points: LawPoint[] };

export interface BookTab {
  id: BookTabId;
  label: string;
  sections: BookSection[];
}

export interface ScoutBookOptions {
  rank: RankId;
  /** The text to show. Defaults to the bundled content/reference.json (empty if it is missing). */
  reference?: ReferenceContent;
  /** Wording for the empty page. Default 'grade2'. */
  level?: LineLevel;
  /** The tab to open on. Default: the first one with something in it. */
  tab?: BookTabId;
}

export const SCOUT_BOOK_TITLE = 'Scout Book';

/** The words on the tabs. */
export const BOOK_TAB_LABELS: Record<BookTabId, string> = {
  oath: 'Oath',
  law: 'Law',
  motto: 'Motto',
  outdoors: 'Outdoors',
};

const BOOK_TAB_ORDER: readonly BookTabId[] = ['oath', 'law', 'motto', 'outdoors'];

/** Webelos and Arrow of Light are getting ready for Scouts BSA, so they see its motto and slogan too. */
export function showsBsaMottos(rank: RankId): boolean {
  return rank === 'webelos' || rank === 'arrow-of-light';
}

const posterSection = (text: ReferenceText | undefined): BookSection[] =>
  text ? [{ kind: 'poster', title: text.title, lines: text.lines }] : [];

/**
 * The tabs a Scout of this rank sees, each with its sections. A tab with nothing in it is dropped,
 * so a reference with only an Oath gives one tab.
 */
export function bookTabs(rank: RankId, reference: ReferenceContent): BookTab[] {
  const sections: Record<BookTabId, BookSection[]> = {
    oath: posterSection(reference.oath),
    law: reference.law ? [{ kind: 'law', title: reference.law.title, points: reference.law.points }] : [],
    motto: [
      ...posterSection(reference.cubMotto),
      ...(showsBsaMottos(rank) ? [...posterSection(reference.bsaMotto), ...posterSection(reference.bsaSlogan)] : []),
    ],
    outdoors: [...posterSection(reference.outdoorCode), ...posterSection(reference.leaveNoTrace)],
  };
  return BOOK_TAB_ORDER.filter((id) => sections[id].length > 0).map((id) => ({
    id,
    label: BOOK_TAB_LABELS[id],
    sections: sections[id],
  }));
}

function lawList(points: readonly LawPoint[]): HTMLUListElement {
  return h(
    'ul',
    { class: 'tq-law' },
    ...points.map((point) =>
      h(
        'li',
        { class: 'tq-law__point' },
        h('strong', { class: 'tq-law__word' }, point.word),
        point.meaning === '' ? null : h('span', { class: 'tq-law__meaning' }, point.meaning),
      ),
    ),
  );
}

function sectionView(section: BookSection): HTMLElement {
  const heading: Child = section.title === '' ? null : h('h3', { class: 'tq-book__section-title' }, section.title);
  return h(
    'section',
    { class: 'tq-book__section' },
    heading,
    section.kind === 'law' ? lawList(section.points) : posterLines(section.lines),
  );
}

/**
 * Open the Scout Book. Resolves when the Scout taps Close (or presses Escape). Arrow keys move
 * between the tabs; every page is one scrollable panel with all of its text visible.
 */
export function showScoutBook(host: HTMLElement, options: ScoutBookOptions): Promise<void> {
  return new Promise<void>((resolve) => {
    const tabs = bookTabs(options.rank, options.reference ?? loadReference());
    let finished = false;
    let selected = Math.max(
      0,
      tabs.findIndex((tab) => tab.id === options.tab),
    );

    const done = (): void => {
      if (finished) return;
      finished = true;
      overlay.close();
      resolve();
    };

    const panelId = uid('tq-book-panel');
    const panel = h('div', { class: 'tq-book__panel', id: panelId, role: 'tabpanel', tabIndex: 0 });
    const tabButtons = tabs.map((tab) => {
      const btn = button(tab.label, { class: 'tq-tab' });
      btn.id = uid('tq-tab');
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-controls', panelId);
      return btn;
    });

    const select = (index: number, focus: boolean): void => {
      selected = index;
      tabs.forEach((_, i) => {
        const on = i === index;
        const btn = tabButtons[i]!;
        btn.classList.toggle('is-selected', on);
        btn.setAttribute('aria-selected', on ? 'true' : 'false');
        btn.tabIndex = on ? 0 : -1;
      });
      panel.setAttribute('aria-labelledby', tabButtons[index]!.id);
      panel.replaceChildren(...tabs[index]!.sections.map(sectionView));
      panel.scrollTop = 0;
      if (focus) overlay.focus(tabButtons[index]);
    };
    tabButtons.forEach((btn, i) => btn.addEventListener('click', () => select(i, false)));

    const overlay = mountOverlay(host, {
      label: SCOUT_BOOK_TITLE,
      cardClass: 'tq-poster tq-book',
      onEscape: done,
      onKey: (event) => {
        if (tabs.length < 2 || event.ctrlKey || event.metaKey || event.altKey) return false;
        const last = tabs.length - 1;
        let next: number;
        if (event.key === 'ArrowRight') next = selected >= last ? 0 : selected + 1;
        else if (event.key === 'ArrowLeft') next = selected <= 0 ? last : selected - 1;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = last;
        else return false;
        select(next, true);
        return true;
      },
    });

    const close = button('Close', { variant: 'primary', onClick: done });
    append(overlay.card, [
      h('h2', { class: 'tq-poster__title' }, icon('\u{1F4D6}'), ` ${SCOUT_BOOK_TITLE}`),
      tabs.length > 0
        ? h('div', { class: 'tq-book__tabs', role: 'tablist', attrs: { 'aria-label': SCOUT_BOOK_TITLE } }, ...tabButtons)
        : null,
      panel,
      h('div', { class: 'tq-actions tq-poster__actions' }, close),
    ]);

    if (tabs.length > 0) {
      select(selected, false);
      overlay.focus(tabButtons[selected]);
    } else {
      panel.removeAttribute('tabindex');
      panel.removeAttribute('role');
      panel.replaceChildren(h('p', { class: 'tq-book__empty' }, line('bookEmpty', options.level ?? 'grade2')));
      overlay.focus(close);
    }
    overlay.setDefault(close);
  });
}
