/**
 * Printable progress sheet for a den leader. `buildProgressSheet` is a pure function from a profile
 * and its rank content to a print-friendly DOM tree; `showProgressSheet` mounts it in the UI host,
 * opens the browser's print dialog and cleans up afterwards. The print rules live in print.css.
 *
 * The sheet is a report, not a record: in-game approvals are not official sign-offs, and the den
 * leader records completion in Scoutbook Plus. Every requirement shows the official number and the
 * adult wording from the content files, a status in words, and an empty box for the den leader.
 */
import { isOptionalRequirement } from '../content/load';
import type { Adventure, RankContent, Requirement } from '../content/types';
import type { Profile, RequirementProgress } from '../save/types';
import { h } from '../ui/dom';
import { button } from '../ui/widgets';
import { requirementStatusWord, STATUS_ICONS, type RequirementStatusWord } from './parent';
import './print.css';

export const SHEET_TEXT = {
  title: 'Trail Quest progress sheet',
  notAffiliated:
    'Trail Quest is a home-made practice game. It is not affiliated with or endorsed by Scouting America.',
  footer:
    'In-game approvals are not official sign-offs. The den leader records completion in Scoutbook Plus.',
} as const;

export interface ProgressSheetOptions {
  /** Today, as YYYY-MM-DD. Printed on the sheet. */
  today: string;
  /** The rank's display name. Defaults to the content's label. */
  rankLabel?: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-10-03" (or a full ISO date-time) as "Oct 3, 2026". Anything else comes back unchanged. */
export function formatDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  const month = match ? MONTHS[Number(match[2]) - 1] : undefined;
  if (!match || !month) return value;
  return `${month} ${Number(match[3])}, ${match[1]}`;
}

/** The date that goes with a status, when the save knows one. */
function statusDate(word: RequirementStatusWord, progress: RequirementProgress | undefined): string | undefined {
  if (!progress) return undefined;
  switch (word) {
    case 'Done':
      return progress.approvedAt ?? progress.completedAt;
    case 'Waiting for approval':
      return progress.completedAt;
    case 'Learned':
      return progress.learnedAt;
    default:
      return undefined;
  }
}

const DATE_LEAD: Record<RequirementStatusWord, string> = {
  'Not yet': '',
  Learned: 'on',
  'Waiting for approval': 'since',
  Done: 'on',
};

function statusCell(progress: RequirementProgress | undefined): { cell: HTMLElement; word: RequirementStatusWord } {
  const word = requirementStatusWord(progress);
  const date = statusDate(word, progress);
  const cell = h(
    'span',
    { class: 'tq-print-sheet__status' },
    h('span', { attrs: { 'aria-hidden': 'true' } }, `${STATUS_ICONS[word]} `),
    word,
    date ? h('span', { class: 'tq-print-sheet__date' }, ` ${DATE_LEAD[word]} ${formatDate(date)}`) : null,
  );
  return { cell, word };
}

function requirementRow(adventure: Adventure, requirement: Requirement, profile: Profile): HTMLTableRowElement {
  const { cell, word } = statusCell(profile.requirements[requirement.id]);
  return h(
    'tr',
    { class: 'tq-print-sheet__row', dataset: { requirement: requirement.id, status: word } },
    h('td', { class: 'tq-print-sheet__num' }, requirement.number),
    h(
      'td',
      { class: 'tq-print-sheet__text' },
      requirement.adultText,
      isOptionalRequirement(adventure, requirement) ? h('span', { class: 'tq-print-sheet__optional' }, ' (optional)') : null,
    ),
    h('td', { class: 'tq-print-sheet__state' }, cell),
    h('td', { class: 'tq-print-sheet__check' }, h('span', { class: 'tq-print-sheet__box', attrs: { 'aria-hidden': 'true' } })),
  );
}

function chooseNote(adventure: Adventure): HTMLElement | null {
  if (!adventure.choose) return null;
  const numbers = adventure.requirements
    .filter((requirement) => adventure.choose!.from.includes(requirement.id))
    .map((requirement) => requirement.number);
  return h(
    'p',
    { class: 'tq-print-sheet__note' },
    `Do any ${adventure.choose.count} of the optional requirements (${numbers.join(', ')}), plus all the others.`,
  );
}

function adventureSection(adventure: Adventure, profile: Profile, who: string): HTMLElement {
  const done = adventure.requirements.filter((requirement) => profile.requirements[requirement.id]?.status === 'done').length;
  const badge = profile.adventures[adventure.id]?.completedAt;
  return h(
    'section',
    { class: 'tq-print-sheet__adventure', dataset: { adventure: adventure.id } },
    h('h2', null, adventure.name),
    h(
      'p',
      { class: 'tq-print-sheet__sub' },
      `${who} · ${done} of ${adventure.requirements.length} requirements done`,
      badge ? ` · Complete in the game on ${formatDate(badge)}` : null,
    ),
    chooseNote(adventure),
    h(
      'table',
      { class: 'tq-print-sheet__table' },
      h(
        'thead',
        null,
        h(
          'tr',
          null,
          h('th', { attrs: { scope: 'col' } }, 'No.'),
          h('th', { attrs: { scope: 'col' } }, 'Requirement'),
          h('th', { attrs: { scope: 'col' } }, 'Status'),
          h('th', { attrs: { scope: 'col' } }, 'Den leader'),
        ),
      ),
      h('tbody', null, ...adventure.requirements.map((requirement) => requirementRow(adventure, requirement, profile))),
    ),
  );
}

/**
 * The sheet itself, with no side effects: Scout name, rank and date, a line saying the game is not
 * affiliated with Scouting America, one section per required adventure (a page each when printed),
 * and a footer. Names and text are inserted as text, never as HTML.
 */
export function buildProgressSheet(profile: Profile, content: RankContent, options: ProgressSheetOptions): HTMLElement {
  const rank = options.rankLabel ?? content.label;
  const who = `${profile.name} · ${rank}`;
  const required = content.adventures.filter((adventure) => adventure.required);
  return h(
    'article',
    { class: 'tq-print-sheet', attrs: { 'aria-label': `Progress sheet for ${profile.name}` } },
    h(
      'header',
      { class: 'tq-print-sheet__head' },
      h('h1', null, SHEET_TEXT.title),
      h(
        'dl',
        { class: 'tq-print-sheet__who' },
        h('div', null, h('dt', null, 'Scout'), h('dd', null, profile.name)),
        h('div', null, h('dt', null, 'Rank'), h('dd', null, rank)),
        h('div', null, h('dt', null, 'Date'), h('dd', null, formatDate(options.today))),
      ),
      h('p', { class: 'tq-print-sheet__affiliation' }, SHEET_TEXT.notAffiliated),
    ),
    required.length === 0 ? h('p', null, 'There are no required adventures for this rank yet.') : null,
    ...required.map((adventure) => adventureSection(adventure, profile, who)),
    h('footer', { class: 'tq-print-sheet__footer' }, h('p', null, SHEET_TEXT.footer)),
  );
}

export interface ShowProgressSheetOptions extends ProgressSheetOptions {
  /** Opens the print dialog. Defaults to `window.print()`; tests pass a spy. */
  print?: () => void;
}

export interface ProgressSheetHandle {
  /** The `.tq-print-sheet` element inside the host. */
  root: HTMLElement;
  /** Removes the sheet. Safe to call twice. */
  close(): void;
}

/**
 * Appends the sheet to `host` (the `#ui` layer) and opens the print dialog. On screen the sheet
 * shows as a preview with Print and Close buttons; when printing, print.css hides everything else.
 * The sheet removes itself on `afterprint`, and the Close button (or Escape) covers browsers that
 * never send that event. It counts as an overlay, so the game stays paused underneath.
 */
export function showProgressSheet(
  host: HTMLElement,
  profile: Profile,
  content: RankContent,
  options: ShowProgressSheetOptions,
): ProgressSheetHandle {
  const sheet = buildProgressSheet(profile, content, options);
  const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  let closed = false;

  const print = (): void => {
    if (options.print) options.print();
    else if (typeof window.print === 'function') window.print();
  };
  const printButton = button('Print', { variant: 'primary', onClick: print });
  const closeButton = button('Close', { onClick: () => close() });

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'Tab') {
      // Keep Tab inside the preview: it only has two buttons.
      const buttons = [printButton, closeButton];
      const index = buttons.findIndex((b) => b === document.activeElement);
      const target = event.shiftKey ? buttons[index <= 0 ? buttons.length - 1 : index - 1] : buttons[(index + 1) % buttons.length];
      event.preventDefault();
      target?.focus({ preventScroll: true });
    }
  }

  function close(): void {
    if (closed) return;
    closed = true;
    window.removeEventListener('afterprint', close);
    document.removeEventListener('keydown', onKeyDown);
    const hadFocus = sheet.contains(document.activeElement);
    sheet.remove();
    if (hadFocus && previouslyFocused?.isConnected) previouslyFocused.focus({ preventScroll: true });
  }

  sheet.classList.add('tq-overlay');
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.prepend(
    h(
      'div',
      { class: 'tq-print-sheet__bar' },
      h('p', null, 'Preview. Print it, or save it as a PDF from the print window.'),
      h('div', { class: 'tq-actions' }, printButton, closeButton),
    ),
  );
  host.appendChild(sheet);
  window.addEventListener('afterprint', close);
  document.addEventListener('keydown', onKeyDown);
  closeButton.focus({ preventScroll: true });
  print();
  return { root: sheet, close };
}
