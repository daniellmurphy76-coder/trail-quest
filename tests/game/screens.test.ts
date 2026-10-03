// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { watchOverlays } from '../../src/game/overlays';
import { showApprovalScreen } from '../../src/game/screens/approval';
import { badgeSvg, showBadgeCard } from '../../src/game/screens/badge';
import { createHud } from '../../src/game/screens/hud';
import { showParentMode } from '../../src/game/screens/parent';
import { showProfilePicker } from '../../src/game/screens/profile-picker';
import { showProfileSetup } from '../../src/game/screens/profile-setup';
import { showSummary } from '../../src/game/screens/summary';
import { showTrailPanel } from '../../src/game/screens/trail-panel';
import { showTrailSign } from '../../src/game/screens/trail-sign';
import { createDefaultSave, createProfile } from '../../src/save/store';
import type { SaveFile } from '../../src/save/types';
import { buttonByText, flush, makeHost } from '../ui/helpers';
import { fixtureRank, ID } from '../fixtures/rank.fixture';

let host: HTMLElement;
beforeEach(() => {
  host = makeHost();
});

const RANKS = [
  { rank: 'wolf' as const, label: 'Test Wolf', grade: 2 },
  { rank: 'arrow-of-light' as const, label: 'Test Arrow', grade: 5 },
];

function typeInto(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('profile setup', () => {
  it('asks who is playing, with a big name field and the rank cards from the content', () => {
    void showProfileSetup(host, { ranks: RANKS, allowCancel: false });
    expect(host.textContent).toContain('Who is playing?');
    expect(host.textContent).toContain('Test Wolf · grade 2');
    expect(host.textContent).toContain('Test Arrow · grade 5');
    expect(host.querySelector('input.tq-input')).not.toBeNull();
    // The guide name defaults to Den Chief and can be edited.
    const guide = host.querySelector<HTMLInputElement>('input[name="guide-name"]')!;
    expect(guide.value).toBe('Den Chief');
    // First run: nowhere to go back to.
    expect(host.textContent).not.toContain('Back');
  });

  it('resolves the new profile options, with no read-aloud setting anywhere', async () => {
    const result = showProfileSetup(host, { ranks: RANKS, allowCancel: false });
    typeInto(host.querySelector<HTMLInputElement>('input[name="scout-name"]')!, '  Rowan ');
    expect(host.querySelector('input[type="checkbox"]')).toBeNull();
    expect(host.textContent).not.toContain('Read to me');

    buttonByText(host, 'Test Arrow').click();
    buttonByText(host, 'Test Wolf').click();
    expect(buttonByText(host, 'Test Wolf').getAttribute('aria-pressed')).toBe('true');
    expect(buttonByText(host, 'Test Wolf').textContent).toContain('Picked');

    buttonByText(host, "Let's start").click();
    await expect(result).resolves.toEqual({ name: 'Rowan', rank: 'wolf', guideName: 'Den Chief' });
    expect(host.querySelector('.tq-overlay')).toBeNull();
  });

  it('asks for a name and a rank before it lets the kid start', async () => {
    const result = showProfileSetup(host, { ranks: RANKS, allowCancel: false });
    buttonByText(host, "Let's start").click();
    expect(host.querySelector('[role="alert"]')!.textContent).toContain('Type your name');
    typeInto(host.querySelector<HTMLInputElement>('input[name="scout-name"]')!, 'Rowan');
    buttonByText(host, "Let's start").click();
    expect(host.querySelector('[role="alert"]')!.textContent).toContain('Pick your rank');
    expect(host.querySelector('.tq-overlay')).not.toBeNull();
    buttonByText(host, 'Test Wolf').click();
    buttonByText(host, "Let's start").click();
    await expect(result).resolves.toMatchObject({ name: 'Rowan', rank: 'wolf' });
  });

  it('has a Back button when there are other Scouts, which resolves null', async () => {
    const result = showProfileSetup(host, { ranks: RANKS, allowCancel: true });
    buttonByText(host, 'Back').click();
    await expect(result).resolves.toBeNull();
  });
});

describe('profile picker', () => {
  const profiles = [
    { id: 'a', name: 'Rowan', rankLabel: 'Wolf', streakDays: 3 },
    { id: 'b', name: 'Sky', rankLabel: 'Arrow of Light', streakDays: 1 },
  ];

  it('shows a card for each Scout with rank, streak flame and a big Play button', () => {
    void showProfilePicker(host, { profiles });
    expect(host.querySelectorAll('.tq-profile')).toHaveLength(2);
    expect(host.textContent).toContain('Rowan');
    expect(host.textContent).toContain('Wolf');
    expect(host.textContent).toContain('\u{1F525} 3 days');
    expect(host.textContent).toContain('\u{1F525} 1 day');
    expect(host.textContent).not.toContain('1 days');
    expect(host.querySelectorAll('.tq-profile .tq-btn--primary')).toHaveLength(2);
  });

  it('resolves play, add and parent choices', async () => {
    let result = showProfilePicker(host, { profiles });
    host.querySelectorAll<HTMLButtonElement>('.tq-profile .tq-btn--primary')[1]!.click();
    await expect(result).resolves.toEqual({ kind: 'play', profileId: 'b' });

    result = showProfilePicker(host, { profiles });
    buttonByText(host, 'Add a Scout').click();
    await expect(result).resolves.toEqual({ kind: 'add' });

    result = showProfilePicker(host, { profiles });
    buttonByText(host, 'Parent').click();
    await expect(result).resolves.toEqual({ kind: 'parent' });
  });
});

describe('HUD', () => {
  it('shows name, rank, XP, the streak flame with Day N, and the Trail button', () => {
    const onTrail = vi.fn();
    const hud = createHud(host, onTrail);
    expect(hud.root.hidden).toBe(true);
    hud.update({ name: 'Rowan', rankLabel: 'Wolf', xp: 120, streak: 3 });
    expect(hud.root.hidden).toBe(false);
    expect(hud.root.textContent).toContain('Rowan');
    expect(hud.root.textContent).toContain('Wolf');
    expect(hud.root.textContent).toContain('120 XP');
    expect(hud.root.textContent).toContain('\u{1F525}');
    expect(hud.root.textContent).toContain('Day 3 streak');
    buttonByText(hud.root, 'Trail').click();
    expect(onTrail).toHaveBeenCalledTimes(1);
    hud.update(null);
    expect(hud.root.hidden).toBe(true);
  });
});

describe('trail panel', () => {
  it('lists the stops with an icon and a word for each status, plus Switch Scout and Parent', async () => {
    const result = showTrailPanel(host, {
      level: 'grade2',
      view: {
        state: 'ready',
        items: [
          { kind: 'warm-up', title: 'Warm up title.', status: 'done' },
          { kind: 'new-step', title: 'New step title.', status: 'next' },
          { kind: 'field-check', title: 'Field title.', status: 'later' },
        ],
      },
    });
    const text = host.textContent ?? '';
    expect(text).toContain("Today's Trail");
    expect(text).toContain('✓');
    expect(text).toContain('Done');
    expect(text).toContain('→');
    expect(text).toContain('Up next');
    expect(text).toContain('·');
    expect(text).toContain('Later');
    expect(host.querySelectorAll('.tq-trail-item')).toHaveLength(3);
    buttonByText(host, 'Switch Scout').click();
    await expect(result).resolves.toBe('switch');
  });

  it('says so when the trail is done or empty', () => {
    void showTrailPanel(host, { level: 'grade2', view: { state: 'done-today', items: [] } });
    expect(host.textContent).toContain('All done for today!');
    expect(host.querySelectorAll('.tq-trail-item')).toHaveLength(0);
  });

  it('resolves parent and close', async () => {
    let result = showTrailPanel(host, { level: 'grade5', view: { state: 'empty', items: [] } });
    buttonByText(host, 'Parent').click();
    await expect(result).resolves.toBe('parent');
    result = showTrailPanel(host, { level: 'grade5', view: { state: 'empty', items: [] } });
    buttonByText(host, 'Close').click();
    await expect(result).resolves.toBe('close');
  });
});

describe('trail sign', () => {
  it('shows the text and goes away when closed', () => {
    const close = showTrailSign(host, 'Walking to the Nature Trail…');
    expect(host.textContent).toContain('Walking to the Nature Trail');
    expect(host.querySelector('button')).toBeNull();
    close();
    expect(host.querySelector('.tq-overlay')).toBeNull();
  });
});

describe('approval screen', () => {
  const info = {
    title: 'Test camp errand',
    parentNote: 'Check that the test errand is finished.',
    steps: ['Do test step one.', 'Do test step two.'],
  };

  it('asks the kid to get a parent and shows the mission and the parent note', async () => {
    const result = showApprovalScreen(host, { info, level: 'grade2', vars: { name: 'Rowan' } });
    expect(host.textContent).toContain('Ask your parent to approve: Test camp errand');
    expect(host.textContent).toContain('Check that the test errand is finished.');
    expect(host.textContent).toContain('Do test step one.');
    buttonByText(host, 'Parent: enter PIN').click();
    await expect(result).resolves.toBe(true);
  });

  it('resolves false on Not now', async () => {
    const result = showApprovalScreen(host, { info: { ...info, parentNote: undefined }, level: 'grade5', vars: {} });
    expect(host.querySelector('.tq-parent-note')).toBeNull();
    buttonByText(host, 'Not now').click();
    await expect(result).resolves.toBe(false);
  });
});

describe('badge card', () => {
  it('draws an original badge with initials and says the sentence', async () => {
    const svg = badgeSvg('Paws on the Path');
    expect(svg.querySelector('text')!.textContent).toBe('PP');
    expect(svg.querySelectorAll('circle')).toHaveLength(2);
    expect(svg.querySelector('image')).toBeNull();

    const done = showBadgeCard(host, { adventureName: 'Test Camp', level: 'grade2', vars: {} });
    expect(host.textContent).toContain('You earned the Test Camp badge!');
    expect(host.querySelector('svg')).not.toBeNull();
    buttonByText(host, 'Great!').click();
    await expect(done).resolves.toBeUndefined();
  });
});

describe('summary', () => {
  const info = {
    stopsDone: 3,
    stopsTotal: 3,
    xpEarned: 60,
    streak: 4,
    streakLit: true,
    badges: ['Test Camp'],
    bonusAvailable: true,
  };

  it('shows stops, XP, the lit campfire, badges and the goodbye', async () => {
    const result = showSummary(host, { info, level: 'grade2', vars: { name: 'Rowan' } });
    const text = host.textContent ?? '';
    expect(text).toContain('3 of 3');
    expect(text).toContain('60 XP');
    expect(text).toContain('Your campfire is lit: Day 4.');
    expect(text).toContain('Badge: Test Camp');
    expect(text).toContain('See you soon!');
    buttonByText(host, 'Bonus stop').click();
    await expect(result).resolves.toBe('bonus');
  });

  it('offers only Explore camp when there is no bonus, and is honest when the fire is not lit', async () => {
    const result = showSummary(host, {
      info: { ...info, streakLit: false, bonusAvailable: false, badges: [] },
      level: 'grade5',
      vars: {},
    });
    expect(host.textContent).not.toContain('Bonus stop');
    expect(host.textContent).not.toContain('Your campfire is lit');
    expect(host.textContent).toContain('Finish every stop to light your campfire.');
    buttonByText(host, 'Explore camp').click();
    await expect(result).resolves.toBe('explore');
  });
});

describe('parent mode', () => {
  function makeSave(): SaveFile {
    const save = createDefaultSave();
    const profile = createProfile(save, { name: 'Rowan', rank: 'wolf' });
    profile.requirements[ID.campErrand] = { status: 'pending-approval', attempts: 1 };
    profile.requirements[ID.campQuiz] = { status: 'done', attempts: 1, learnedAt: '2026-09-20', completedAt: '2026-09-20' };
    return save;
  }

  function open(save: SaveFile, extra: Partial<Parameters<typeof showParentMode>[1]> = {}) {
    const persist = vi.fn();
    const result = showParentMode(host, {
      save,
      today: () => '2026-10-03',
      persist,
      replaceSave: vi.fn(),
      changePin: vi.fn(async () => true),
      contentFor: () => fixtureRank,
      rankLabel: () => 'Wolf',
      ...extra,
    });
    return { result, persist };
  }

  it('lists adventures with each requirement in words, and the waiting mission with Approve', async () => {
    const save = makeSave();
    const { result } = open(save);
    expect(host.textContent).toContain('Waiting for your approval');
    expect(host.textContent).toContain('Test camp errand');
    expect(host.textContent).toContain('Test Camp — 1 of 4 done');

    // Adventure lists open and close with a button.
    const toggle = buttonByText(host, 'Test Camp');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    toggle.click();
    const text = host.textContent ?? '';
    expect(text).toContain('Done');
    expect(text).toContain('Waiting for approval');
    expect(text).toContain('Not yet');
    buttonByText(host, 'Close').click();
    await expect(result).resolves.toEqual({ imported: false });
  });

  it('approves a waiting mission and saves', () => {
    const save = makeSave();
    const { persist } = open(save);
    buttonByText(host, 'Approve').click();
    const profile = save.profiles[0]!;
    expect(profile.requirements[ID.campErrand]).toMatchObject({ status: 'done', approvedAt: '2026-10-03' });
    expect(profile.xp).toBe(30);
    expect(persist).toHaveBeenCalled();
    expect(host.textContent).toContain('Approved: Test camp errand');
    expect(host.textContent).toContain('Nothing is waiting.');
  });

  it('resets a Scout only after a confirm', async () => {
    const save = makeSave();
    save.profiles[0]!.xp = 90;
    const { persist } = open(save);

    buttonByText(host, 'Reset Rowan').click();
    expect(host.querySelectorAll('.tq-overlay')).toHaveLength(2); // the confirm sits on top
    buttonByText(host, 'Keep everything').click();
    await flush();
    expect(save.profiles[0]!.xp).toBe(90);
    expect(persist).not.toHaveBeenCalled();

    buttonByText(host, 'Reset Rowan').click();
    buttonByText(host, 'Reset this Scout').click();
    await flush();
    expect(save.profiles[0]).toMatchObject({ name: 'Rowan', xp: 0, requirements: {} });
    expect(persist).toHaveBeenCalled();
  });

  it('changes the PIN through the app and says so', async () => {
    const changePin = vi.fn(async () => true);
    open(makeSave(), { changePin });
    buttonByText(host, 'Change PIN').click();
    await flush();
    expect(changePin).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain('PIN changed.');
  });

  it('has Export and Import buttons', () => {
    open(makeSave());
    expect(buttonByText(host, 'Export save')).toBeDefined();
    expect(buttonByText(host, 'Import save')).toBeDefined();
  });
});

describe('overlay watcher', () => {
  it('turns input off while an overlay is open and on again when the last one closes', async () => {
    const input = { setEnabled: vi.fn() };
    const stop = watchOverlays(host, input);
    expect(input.setEnabled).toHaveBeenLastCalledWith(true);

    const first = document.createElement('div');
    first.className = 'tq-overlay';
    const second = document.createElement('div');
    second.className = 'tq-overlay';
    host.append(first, second);
    await flush();
    expect(input.setEnabled).toHaveBeenLastCalledWith(false);

    first.remove();
    await flush();
    expect(input.setEnabled).toHaveBeenLastCalledWith(false);
    second.remove();
    await flush();
    expect(input.setEnabled).toHaveBeenLastCalledWith(true);

    // The HUD and toasts are not overlays.
    const hud = document.createElement('div');
    hud.className = 'tq-hud';
    host.append(hud);
    await flush();
    expect(input.setEnabled).toHaveBeenLastCalledWith(true);
    stop();
  });
});
