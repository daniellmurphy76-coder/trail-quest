// @vitest-environment happy-dom
/// <reference types="node" />
import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildProgressSheet, formatDate, SHEET_TEXT, showProgressSheet } from '../../src/game/progress-sheet';
import { busyProfile } from '../fixtures/parent.fixture';
import { deepFreeze, doneReq, makeProfile } from '../fixtures/profile.fixture';
import { ADVENTURE, fixtureRank, ID } from '../fixtures/rank.fixture';
import { buttonByText, makeHost, press } from '../ui/helpers';

const OPTIONS = { today: '2026-10-03', rankLabel: 'Wolf' };

/** A fixture Scout with one of each status and known dates. */
function datedProfile() {
  return makeProfile({
    name: 'Rowan',
    requirements: {
      [ID.trekCollect]: doneReq('2026-09-20', { approvedAt: '2026-09-25' }), // done: the approval date wins
      [ID.trekNavigate]: doneReq('2026-09-21'), // done: completed date
      [ID.trekChore]: { status: 'pending-approval', attempts: 1, learnedAt: '2026-09-22', completedAt: '2026-09-30' },
      [ID.campQuiz]: doneReq('2026-09-19'),
      [ID.campChore]: { status: 'available', attempts: 1, learnedAt: '2026-09-18' },
      [ID.campErrand]: { status: 'in-progress', attempts: 0 },
      [ID.pickRhythm]: doneReq('2026-09-17'),
    },
    adventures: {},
  });
}

const row = (sheet: HTMLElement, id: string): HTMLElement => sheet.querySelector<HTMLElement>(`tr[data-requirement="${id}"]`)!;
const statusText = (sheet: HTMLElement, id: string): string => row(sheet, id).querySelector('.tq-print-sheet__status')!.textContent ?? '';

describe('formatDate', () => {
  it('writes a date in words, and leaves anything else alone', () => {
    expect(formatDate('2026-10-03')).toBe('Oct 3, 2026');
    expect(formatDate('2026-01-09T12:00:00.000Z')).toBe('Jan 9, 2026');
    expect(formatDate('soon')).toBe('soon');
  });
});

describe('progress sheet content', () => {
  const sheet = buildProgressSheet(datedProfile(), fixtureRank, OPTIONS);

  it('names the Scout, rank and date, and says the game is not affiliated with Scouting America', () => {
    const head = sheet.querySelector('.tq-print-sheet__head')!;
    expect(head.textContent).toContain('Rowan');
    expect(head.textContent).toContain('Wolf');
    expect(head.textContent).toContain('Oct 3, 2026');
    expect(head.querySelector('.tq-print-sheet__affiliation')!.textContent).toBe(SHEET_TEXT.notAffiliated);
    expect(SHEET_TEXT.notAffiliated).toMatch(/not affiliated with or endorsed by Scouting America/);
  });

  it('has one section per required adventure and leaves out the extras', () => {
    const names = Array.from(sheet.querySelectorAll('.tq-print-sheet__adventure h2')).map((h2) => h2.textContent);
    expect(names).toEqual(['Test Trek', 'Test Camp', 'Test Pick']);
    expect(sheet.textContent).not.toContain('Test Extra');
  });

  it('lists every requirement of every required adventure with its official number and adult text', () => {
    const required = fixtureRank.adventures.filter((a) => a.required);
    const total = required.reduce((n, a) => n + a.requirements.length, 0);
    expect(sheet.querySelectorAll('tr[data-requirement]')).toHaveLength(total);
    expect(total).toBe(12);
    for (const adventure of required) {
      for (const requirement of adventure.requirements) {
        const tr = row(sheet, requirement.id);
        expect(tr, requirement.id).not.toBeNull();
        expect(tr.querySelector('.tq-print-sheet__num')!.textContent).toBe(requirement.number);
        expect(tr.querySelector('.tq-print-sheet__text')!.textContent).toContain(requirement.adultText);
      }
    }
  });

  it('says Not yet, Learned, Waiting for approval or Done for each requirement', () => {
    const word = (id: string) => row(sheet, id).dataset.status;
    expect(word(ID.trekCollect)).toBe('Done');
    expect(word(ID.trekNavigate)).toBe('Done');
    expect(word(ID.trekCraft)).toBe('Not yet'); // no progress at all
    expect(word(ID.trekChore)).toBe('Waiting for approval');
    expect(word(ID.campQuiz)).toBe('Done');
    expect(word(ID.campChore)).toBe('Learned');
    expect(word(ID.campErrand)).toBe('Not yet'); // in progress, not yet told to the parent
    expect(word(ID.campSort)).toBe('Not yet');
    expect(word(ID.pickRhythm)).toBe('Done');
    // The words are on the page, not only in a data attribute.
    expect(statusText(sheet, ID.trekChore)).toContain('Waiting for approval');
    expect(statusText(sheet, ID.campChore)).toContain('Learned');
    expect(statusText(sheet, ID.campQuiz)).toContain('Done');
    expect(statusText(sheet, ID.campSort)).toContain('Not yet');
  });

  it('adds the date where the save knows one', () => {
    expect(statusText(sheet, ID.trekCollect)).toContain('Sep 25, 2026'); // approved
    expect(statusText(sheet, ID.trekNavigate)).toContain('Sep 21, 2026'); // completed
    expect(statusText(sheet, ID.trekChore)).toContain('since Sep 30, 2026');
    expect(statusText(sheet, ID.campChore)).toContain('on Sep 18, 2026');
    expect(statusText(sheet, ID.campSort)).not.toMatch(/\d{4}/);
  });

  it('gives each requirement an empty box in a Den leader column', () => {
    const headers = Array.from(sheet.querySelectorAll('thead th')).map((th) => th.textContent);
    expect(new Set(headers)).toEqual(new Set(['No.', 'Requirement', 'Status', 'Den leader']));
    for (const tr of sheet.querySelectorAll('tr[data-requirement]')) {
      expect(tr.querySelectorAll('td')).toHaveLength(4);
      expect(tr.querySelector('td:last-child .tq-print-sheet__box')).not.toBeNull();
      expect(tr.querySelector('td:last-child')!.textContent).toBe('');
    }
  });

  it('marks optional requirements and explains the choose rule', () => {
    expect(row(sheet, ID.pickQuiz).textContent).toContain('(optional)');
    expect(row(sheet, ID.pickRhythm).textContent).not.toContain('(optional)');
    expect(sheet.querySelector('[data-adventure="wolf.test-pick"] .tq-print-sheet__note')!.textContent).toContain(
      'Do any 2 of the optional requirements (2, 3, 4)',
    );
  });

  it('ends with the footer: not official sign-offs, the den leader records it in Scoutbook Plus', () => {
    const footer = sheet.querySelector('footer')!;
    expect(footer.textContent).toBe(SHEET_TEXT.footer);
    expect(footer.textContent).toContain('not official sign-offs');
    expect(footer.textContent).toContain('den leader records completion in Scoutbook Plus');
  });

  it('shows the badge date and the done count in each adventure heading', () => {
    const sub = buildProgressSheet(busyProfile({ name: 'Rowan' }), fixtureRank, OPTIONS).querySelector(
      '[data-adventure="wolf.test-pick"] .tq-print-sheet__sub',
    )!;
    expect(sub.textContent).toContain('4 of 4 requirements done');
    expect(sub.textContent).toContain('Oct 1, 2026');
  });

  it('is a pure build: no document changes, no input changes, and names are text not HTML', () => {
    const profile = deepFreeze(makeProfile({ name: '<img src=x onerror=alert(1)>' }));
    const before = document.body.innerHTML;
    const built = buildProgressSheet(profile, deepFreeze(structuredClone(fixtureRank)), OPTIONS);
    expect(document.body.innerHTML).toBe(before);
    expect(built.isConnected).toBe(false);
    expect(built.querySelector('img')).toBeNull();
    expect(built.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('says so when a rank has no required adventures', () => {
    const empty = buildProgressSheet(makeProfile(), { ...fixtureRank, adventures: [] }, OPTIONS);
    expect(empty.textContent).toContain('no required adventures');
    expect(empty.textContent).toContain('Scoutbook Plus');
  });

  it('falls back to the content label when no rank label is given', () => {
    expect(buildProgressSheet(makeProfile(), fixtureRank, { today: '2026-10-03' }).textContent).toContain('Test Wolf');
  });
});

describe('showing and printing the sheet', () => {
  let host: HTMLElement;
  beforeEach(() => {
    host = makeHost();
  });

  function show(print = vi.fn()) {
    const handle = showProgressSheet(host, datedProfile(), fixtureRank, { ...OPTIONS, print });
    return { handle, print };
  }

  it('appends .tq-print-sheet to the UI host and opens the print dialog once', () => {
    const { handle, print } = show();
    expect(handle.root.parentElement).toBe(host);
    expect(handle.root.classList.contains('tq-print-sheet')).toBe(true);
    expect(host.querySelectorAll('.tq-print-sheet')).toHaveLength(1);
    expect(print).toHaveBeenCalledTimes(1);
  });

  it('counts as an overlay, so the game stays paused underneath', () => {
    show();
    expect(host.querySelector('.tq-print-sheet')!.classList.contains('tq-overlay')).toBe(true);
    expect(host.querySelector('.tq-print-sheet')!.getAttribute('role')).toBe('dialog');
  });

  it('removes the sheet after afterprint', () => {
    show();
    window.dispatchEvent(new Event('afterprint'));
    expect(host.querySelector('.tq-print-sheet')).toBeNull();
  });

  it('has a Close button for browsers without afterprint, and Print to try again', () => {
    const { print } = show();
    buttonByText(host, 'Print').click();
    expect(print).toHaveBeenCalledTimes(2);
    buttonByText(host, 'Close').click();
    expect(host.querySelector('.tq-print-sheet')).toBeNull();
  });

  it('closes on Escape and ignores a later afterprint', () => {
    const { handle } = show();
    press(document, 'Escape');
    expect(host.querySelector('.tq-print-sheet')).toBeNull();
    expect(() => {
      window.dispatchEvent(new Event('afterprint'));
      handle.close();
    }).not.toThrow();
  });

  it('shows the preview and sheet text, but keeps the Print and Close bar out of the printed text rules', () => {
    show();
    expect(host.querySelector('.tq-print-sheet__bar')).not.toBeNull();
    const css = fs.readFileSync(path.resolve(__dirname, '../../src/game/print.css'), 'utf8');
    // Printing: hide the bar, hide everything but the sheet, one adventure per page.
    expect(css).toMatch(/@media print/);
    expect(css).toMatch(/\.tq-print-sheet__bar\s*\{\s*display:\s*none/);
    expect(css).toContain('#ui > *:not(.tq-print-sheet)');
    expect(css).toContain('body > *:not(#ui)');
    expect(css).toMatch(/break-before:\s*page/);
    expect(css).toMatch(/color:\s*#000/);
  });
});

describe('fixture sanity', () => {
  it('the fixture rank has the adventures the sheet tests rely on', () => {
    expect(fixtureRank.adventures.filter((a) => a.required).map((a) => a.id)).toEqual([
      ADVENTURE.trek,
      ADVENTURE.camp,
      ADVENTURE.pick,
    ]);
  });
});
