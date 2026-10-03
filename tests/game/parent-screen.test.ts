// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RankId } from '../../src/activities/types';
import type { RankContent } from '../../src/content/types';
import { titleForXp } from '../../src/game/rewards';
import { showParentMode, type ParentModeOptions } from '../../src/game/screens/parent';
import { defaultAvatar } from '../../src/player/avatar/options';
import { createDefaultSave, createProfile } from '../../src/save/store';
import type { Profile, SaveFile } from '../../src/save/types';
import { busyProfile } from '../fixtures/parent.fixture';
import { doneReq } from '../fixtures/profile.fixture';
import { fixtureRank, ID } from '../fixtures/rank.fixture';
import { buttonByText, flush, makeHost, maybeButton } from '../ui/helpers';

const RANK_LABELS: Record<RankId, string> = {
  lion: 'Lion',
  tiger: 'Tiger',
  wolf: 'Wolf',
  bear: 'Bear',
  webelos: 'Webelos',
  'arrow-of-light': 'Arrow of Light',
};

let host: HTMLElement;
beforeEach(() => {
  host = makeHost();
});

/** Rowan (a busy Wolf, made first) and Zip (a new Wolf, made last, so Zip is the active Scout). */
function makeSave(): { save: SaveFile; rowan: Profile; zip: Profile } {
  const save = createDefaultSave();
  const rowan = createProfile(save, { name: 'Rowan', rank: 'wolf' });
  Object.assign(rowan, busyProfile({ id: rowan.id, name: 'Rowan', avatar: { ...defaultAvatar('wolf'), hat: 'cap' }, sound: false }));
  const zip = createProfile(save, { name: 'Zip', rank: 'wolf' });
  return { save, rowan, zip };
}

function open(save: SaveFile, extra: Partial<ParentModeOptions> = {}) {
  const persist = vi.fn();
  const print = vi.fn();
  const changePin = vi.fn(async () => true);
  const result = showParentMode(host, {
    save,
    today: () => '2026-10-03',
    persist,
    replaceSave: vi.fn(),
    changePin,
    contentFor: (rank: RankId): RankContent | undefined => (rank === 'wolf' || rank === 'bear' ? fixtureRank : undefined),
    rankLabel: (rank: RankId) => RANK_LABELS[rank],
    print,
    ...extra,
  });
  return { result, persist, print, changePin };
}

const cardFor = (name: string): HTMLElement =>
  Array.from(host.querySelectorAll<HTMLElement>('.tq-pdash__card')).find((c) => c.querySelector('h3')!.textContent === name)!;

describe('parent mode overview', () => {
  it('shows one card per Scout with the numbers that matter', () => {
    const { save } = makeSave();
    open(save);
    expect(host.querySelectorAll('.tq-pdash__card')).toHaveLength(2);

    const rowan = cardFor('Rowan');
    const text = rowan.textContent ?? '';
    expect(text).toContain('Wolf · Grade 2');
    expect(text).toContain('Last played');
    expect(text).toContain('Oct 2, 2026');
    expect(text).toContain('3 days');
    expect(text).toContain('120');
    expect(rowan.querySelector('.tq-pdash__stats')!.textContent).toContain(titleForXp(120)); // the trail title
    expect(text).toContain('1 of 3'); // badges
    expect(rowan.querySelector('.tq-pdash__overall-text')!.textContent).toBe('Overall: 6 of 11 requirements done (55%)');
    expect(text).toContain('Pending approvals: 2');
  });

  it('writes the numbers beside every bar and names each adventure', () => {
    const { save } = makeSave();
    open(save);
    const rows = Array.from(cardFor('Rowan').querySelectorAll('.tq-pdash__adv')).map((li) => li.textContent);
    expect(rows).toEqual(['Test Trek2 of 4', 'Test Camp1 of 4', 'Test Pick✓ Badge']);
    const bars = cardFor('Rowan').querySelectorAll('[role="progressbar"]');
    expect(bars).toHaveLength(4); // overall plus three adventures
    expect(bars[0]!.getAttribute('aria-valuenow')).toBe('6');
    expect(bars[0]!.getAttribute('aria-valuemax')).toBe('11');
    expect(bars[1]!.getAttribute('aria-label')).toBe('Test Trek: 2 of 4 requirements done');
  });

  it('says Not yet for a Scout who has never played, and leaves out the pending line when nothing waits', () => {
    const { save } = makeSave();
    open(save);
    const zip = cardFor('Zip');
    expect(zip.textContent).toContain('Not yet');
    expect(zip.textContent).toContain('0 days');
    expect(zip.textContent).toContain('Overall: 0 of 11 requirements done (0%)');
    expect(zip.textContent).not.toContain('Pending approvals');
  });

  it('gives each card Details, Print progress sheet and Tools buttons', () => {
    const { save } = makeSave();
    open(save);
    for (const name of ['Rowan', 'Zip']) {
      const card = cardFor(name);
      expect(buttonByText(card, 'Details').getAttribute('aria-label')).toBe(`Details for ${name}`);
      expect(buttonByText(card, 'Print progress sheet').getAttribute('aria-label')).toBe(`Print progress sheet for ${name}`);
      expect(buttonByText(card, 'Tools').getAttribute('aria-label')).toBe(`Tools for ${name}`);
    }
  });

  it('keeps Export, Import and Change PIN, and Change PIN still reports back', async () => {
    const { save } = makeSave();
    const { changePin } = open(save);
    expect(buttonByText(host, 'Export save')).toBeDefined();
    expect(buttonByText(host, 'Import save')).toBeDefined();
    buttonByText(host, 'Change PIN').click();
    await flush();
    expect(changePin).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain('PIN changed.');
  });

  it('copes with a rank that has no content, and with no Scouts', () => {
    const { save } = makeSave();
    open(save, { contentFor: () => undefined });
    expect(cardFor('Rowan').textContent).toContain('There are no adventures for this rank yet.');
    expect(maybeButton(cardFor('Rowan'), 'Print progress sheet')).toBeNull();

    host = makeHost();
    open(createDefaultSave());
    expect(host.textContent).toContain('There are no Scouts yet.');
  });

  it('closes with nothing changed', async () => {
    const { save } = makeSave();
    const { result, persist } = open(save);
    buttonByText(host, 'Close').click();
    await expect(result).resolves.toEqual({
      imported: false,
      changedProfileIds: [],
      removedProfileIds: [],
      removedActiveProfile: false,
    });
    expect(persist).not.toHaveBeenCalled();
    expect(host.querySelector('.tq-overlay')).toBeNull();
  });
});

describe('parent mode details', () => {
  it('opens the requirement list for one Scout and goes back to all Scouts', () => {
    const { save } = makeSave();
    open(save);
    buttonByText(cardFor('Rowan'), 'Details').click();
    expect(host.querySelectorAll('.tq-pdash__card')).toHaveLength(0);
    expect(host.textContent).toContain('Rowan · Wolf');
    expect(host.textContent).toContain('Waiting for your approval');
    expect(host.textContent).toContain('Test trek chore');
    expect(host.textContent).toContain('Test camp errand');
    expect(host.textContent).toContain('Test Camp — 1 of 4 done');
    expect(host.textContent).toContain('Test Pick — 3 of 3 done (badge earned)');

    const toggle = buttonByText(host, 'Test Camp');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    toggle.click();
    const text = host.textContent ?? '';
    expect(text).toContain('Done');
    expect(text).toContain('Learned');
    expect(text).toContain('Waiting for approval');
    expect(text).toContain('Not yet');

    buttonByText(host, 'Back to all Scouts').click();
    expect(host.querySelectorAll('.tq-pdash__card')).toHaveLength(2);
  });

  it('approves a waiting mission, saves, and reports the Scout as changed', async () => {
    const { save, rowan } = makeSave();
    const { result, persist } = open(save);
    buttonByText(cardFor('Rowan'), 'Details').click();
    host.querySelector<HTMLButtonElement>('[aria-label="Approve: Test camp errand"]')!.click();
    const after = save.profiles.find((p) => p.id === rowan.id)!; // the screen swaps in a new profile object
    expect(after.requirements[ID.campErrand]).toMatchObject({ status: 'done', approvedAt: '2026-10-03' });
    expect(after.xp).toBe(150);
    expect(persist).toHaveBeenCalled();
    expect(host.textContent).toContain('Approved: Test camp errand');

    buttonByText(host, 'Close').click();
    await expect(result).resolves.toMatchObject({ changedProfileIds: [rowan.id], removedProfileIds: [], removedActiveProfile: false });
  });

  it('prints the sheet from Details too', () => {
    const { save } = makeSave();
    const { print } = open(save);
    buttonByText(cardFor('Rowan'), 'Details').click();
    buttonByText(host, 'Print progress sheet').click();
    expect(host.querySelector('.tq-print-sheet')).not.toBeNull();
    expect(print).toHaveBeenCalledTimes(1);
  });
});

describe('parent mode: print progress sheet', () => {
  it('opens the sheet for that Scout and prints it', () => {
    const { save } = makeSave();
    const { print } = open(save);
    buttonByText(cardFor('Rowan'), 'Print progress sheet').click();
    const sheet = host.querySelector<HTMLElement>('.tq-print-sheet')!;
    expect(sheet.parentElement).toBe(host);
    expect(sheet.textContent).toContain('Rowan');
    expect(sheet.textContent).toContain('Test Trek');
    expect(sheet.textContent).toContain('Oct 3, 2026');
    expect(print).toHaveBeenCalledTimes(1);
  });

  it('removes the sheet after afterprint and leaves Parent mode as it was', () => {
    const { save } = makeSave();
    open(save);
    buttonByText(cardFor('Zip'), 'Print progress sheet').click();
    expect(host.querySelector('.tq-print-sheet')!.textContent).toContain('Zip');
    window.dispatchEvent(new Event('afterprint'));
    expect(host.querySelector('.tq-print-sheet')).toBeNull();
    expect(host.querySelectorAll('.tq-pdash__card')).toHaveLength(2);
  });

  it('closes the sheet along with Parent mode', async () => {
    const { save } = makeSave();
    const { result } = open(save);
    buttonByText(cardFor('Rowan'), 'Print progress sheet').click();
    expect(host.querySelector('.tq-print-sheet')).not.toBeNull();
    // The first Close in the page is Parent mode's own (the sheet's comes later in the document).
    buttonByText(host, 'Close').click();
    await result;
    expect(host.querySelector('.tq-print-sheet')).toBeNull();
    expect(host.querySelector('.tq-overlay')).toBeNull();
  });
});

describe('parent mode tools', () => {
  function openTools(save: SaveFile, name: string, extra: Partial<ParentModeOptions> = {}) {
    const handle = open(save, extra);
    buttonByText(cardFor(name), 'Tools').click();
    return handle;
  }

  it('lists the three tools for the Scout, with the name in the title', () => {
    const { save } = makeSave();
    openTools(save, 'Rowan');
    expect(host.textContent).toContain('Tools for Rowan');
    expect(host.querySelector('[data-tool="reset"]')).not.toBeNull();
    expect(host.querySelector('[data-tool="promote"]')!.textContent).toContain('Move to Bear');
    expect(host.querySelector('[data-tool="remove"]')!.textContent).toContain('Remove Rowan');
  });

  it('resets only after a second confirm that names the Scout, and keeps name, look and sound', async () => {
    const { save, rowan } = makeSave();
    const { result, persist } = openTools(save, 'Rowan');

    buttonByText(host, 'Reset progress').click();
    expect(host.querySelector('.tq-pdash__question')!.textContent).toBe("Reset Rowan's progress? This cannot be undone.");
    expect(rowan.xp).toBe(120); // nothing happens on the first click
    buttonByText(host, 'No, keep it').click();
    expect(rowan.xp).toBe(120);
    expect(persist).not.toHaveBeenCalled();
    expect(host.querySelector('.tq-pdash__question')).toBeNull();

    buttonByText(host, 'Reset progress').click();
    buttonByText(host, "Yes, reset Rowan's progress").click();
    const after = save.profiles.find((p) => p.id === rowan.id)!;
    expect(after).toMatchObject({ name: 'Rowan', rank: 'wolf', xp: 0, requirements: {}, adventures: {}, sessions: [], sound: false });
    expect(after.avatar.hat).toBe('cap');
    expect(persist).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("Rowan's progress was reset.");

    buttonByText(host, 'Back to all Scouts').click();
    expect(cardFor('Rowan').textContent).toContain('Overall: 0 of 11 requirements done (0%)');
    buttonByText(host, 'Close').click();
    await expect(result).resolves.toMatchObject({ changedProfileIds: [rowan.id], removedActiveProfile: false });
  });

  it('puts focus on the safe choice when a confirm opens', () => {
    const { save } = makeSave();
    openTools(save, 'Rowan');
    buttonByText(host, 'Remove Rowan').click();
    expect(document.activeElement).toBe(buttonByText(host, 'No, keep it'));
  });

  it('removes a Scout after a second confirm and says when it was the active Scout', async () => {
    const { save, zip } = makeSave();
    expect(save.activeProfileId).toBe(zip.id);
    const { result, persist } = openTools(save, 'Zip');

    buttonByText(host, 'Remove Zip').click();
    expect(host.querySelector('.tq-pdash__question')!.textContent).toBe(
      'Remove Zip? This deletes Zip and all progress from this device. This cannot be undone.',
    );
    expect(save.profiles).toHaveLength(2);
    buttonByText(host, 'Yes, remove Zip').click();

    expect(save.profiles.map((p) => p.name)).toEqual(['Rowan']);
    expect(save.activeProfileId).toBeUndefined();
    expect(persist).toHaveBeenCalled();
    expect(host.querySelectorAll('.tq-pdash__card')).toHaveLength(1); // back on the overview
    expect(host.textContent).toContain('Zip was removed.');

    buttonByText(host, 'Close').click();
    await expect(result).resolves.toEqual({
      imported: false,
      changedProfileIds: [],
      removedProfileIds: [zip.id],
      removedActiveProfile: true,
    });
  });

  it('does not call it the active Scout when another Scout is removed', async () => {
    const { save, rowan, zip } = makeSave();
    const { result } = openTools(save, 'Rowan');
    buttonByText(host, 'Remove Rowan').click();
    buttonByText(host, 'Yes, remove Rowan').click();
    expect(save.activeProfileId).toBe(zip.id);
    buttonByText(host, 'Close').click();
    await expect(result).resolves.toMatchObject({ removedProfileIds: [rowan.id], removedActiveProfile: false, changedProfileIds: [] });
  });

  it('moves a Scout to the next rank after a confirm, keeping the old progress', async () => {
    const { save, rowan } = makeSave();
    rowan.requirements[ID.campSort] = doneReq();
    const { result, persist } = openTools(save, 'Rowan');

    buttonByText(host, 'Move to Bear').click();
    expect(host.querySelector('.tq-pdash__question')!.textContent).toBe('Move Rowan from Wolf to Bear? Wolf progress stays saved.');
    expect(save.profiles[0]!.rank).toBe('wolf');
    buttonByText(host, 'Yes, move Rowan to Bear').click();

    const after = save.profiles.find((p) => p.id === rowan.id)!;
    expect(after.rank).toBe('bear');
    expect(after.requirements[ID.campSort]).toBeDefined();
    expect(after.avatar.neckerchief).toBe(defaultAvatar('bear').neckerchief);
    expect(persist).toHaveBeenCalled();
    expect(host.textContent).toContain('Rowan is now in Bear.');
    buttonByText(host, 'Close').click();
    await expect(result).resolves.toMatchObject({ changedProfileIds: [rowan.id] });
  });

  it('refuses to move up when the next rank has no content, and says why', () => {
    const { save, rowan } = makeSave();
    openTools(save, 'Rowan', { contentFor: (rank) => (rank === 'wolf' ? fixtureRank : undefined) });
    const tool = host.querySelector<HTMLElement>('[data-tool="promote"]')!;
    expect(tool.textContent).toContain('Bear adventures are not in the game yet.');
    const start = tool.querySelector<HTMLButtonElement>('button')!;
    expect(start.disabled).toBe(true);
    start.click();
    expect(host.querySelector('.tq-pdash__question')).toBeNull();
    expect(rowan.rank).toBe('wolf');
  });

  it('has nothing to move to from Arrow of Light', () => {
    const save = createDefaultSave();
    createProfile(save, { name: 'Sky', rank: 'arrow-of-light' });
    open(save, { contentFor: () => fixtureRank });
    buttonByText(host, 'Tools').click();
    const tool = host.querySelector<HTMLElement>('[data-tool="promote"]')!;
    expect(tool.textContent).toContain('Arrow of Light is the last rank.');
    expect(tool.querySelector('button')!.disabled).toBe(true);
  });
});
