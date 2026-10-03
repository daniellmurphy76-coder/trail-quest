// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { gradeLabel, rankCardLabel, showProfileSetup } from '../../src/game/screens/profile-setup';
import { defaultAvatar } from '../../src/player/avatar/options';
import { createDefaultSave, createProfile } from '../../src/save/store';
import { buttonByText, flush, makeHost, press } from '../ui/helpers';

let host: HTMLElement;
beforeEach(() => {
  host = makeHost();
});

/** Every rank, as `listRankContent()` would give them (labels are test names). */
const ALL_RANKS = [
  { rank: 'lion' as const, label: 'Test Lion', grade: 0 },
  { rank: 'tiger' as const, label: 'Test Tiger', grade: 1 },
  { rank: 'wolf' as const, label: 'Test Wolf', grade: 2 },
  { rank: 'bear' as const, label: 'Test Bear', grade: 3 },
  { rank: 'webelos' as const, label: 'Test Webelos', grade: 4 },
  { rank: 'arrow-of-light' as const, label: 'Test Arrow', grade: 5 },
];
const TWO = [ALL_RANKS[2]!, ALL_RANKS[5]!];

function typeInto(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

const nameField = (): HTMLInputElement => host.querySelector<HTMLInputElement>('input[name="scout-name"]')!;
const editor = (): Element | null => host.querySelector('.tq-avatar');
const radio = (title: string, label: string): HTMLButtonElement => {
  const group = Array.from(host.querySelectorAll('.tq-avatar__group')).find(
    (g) => g.querySelector('.tq-avatar__group-title')?.textContent === title,
  )!;
  return Array.from(group.querySelectorAll<HTMLButtonElement>('[role="radio"]')).find(
    (b) => b.querySelector('.tq-opt__label')?.textContent === label,
  )!;
};

describe('profile setup: name and rank', () => {
  it('asks who is playing, with a big name field and the rank cards from the content', () => {
    void showProfileSetup(host, { ranks: TWO, allowCancel: false });
    expect(host.textContent).toContain('Who is playing?');
    expect(host.textContent).toContain('Test Wolf · grade 2');
    expect(host.textContent).toContain('Test Arrow · grade 5');
    expect(host.querySelector('input.tq-input')).not.toBeNull();
    const guide = host.querySelector<HTMLInputElement>('input[name="guide-name"]')!;
    expect(guide.value).toBe('Den Chief');
    expect(host.textContent).not.toContain('Back'); // first run: nowhere to go back to
  });

  it('renders every rank as a card in one grid, with K for grade 0', () => {
    void showProfileSetup(host, { ranks: ALL_RANKS, allowCancel: false });
    const grid = host.querySelector('.tq-rank-grid')!;
    const cards = Array.from(grid.querySelectorAll<HTMLButtonElement>('button.tq-rank-card'));
    expect(cards.map((c) => c.querySelector('.tq-rank-card__label')!.textContent)).toEqual([
      'Test Lion · grade K',
      'Test Tiger · grade 1',
      'Test Wolf · grade 2',
      'Test Bear · grade 3',
      'Test Webelos · grade 4',
      'Test Arrow · grade 5',
    ]);
    for (const card of cards) expect(card.getAttribute('aria-pressed')).toBe('false');
  });

  it('labels grades: K for 0, the number otherwise', () => {
    expect(gradeLabel(0)).toBe('K');
    expect(gradeLabel(3)).toBe('3');
    expect(rankCardLabel({ rank: 'lion', label: 'Lion', grade: 0 })).toBe('Lion · grade K');
    expect(rankCardLabel({ rank: 'bear', label: 'Bear', grade: 3 })).toBe('Bear · grade 3');
  });

  it('asks for a name and a rank before it lets the kid go on', () => {
    void showProfileSetup(host, { ranks: TWO, allowCancel: false });
    buttonByText(host, "Let's start").click();
    expect(host.querySelector('[role="alert"]')!.textContent).toContain('Type your name');
    typeInto(nameField(), 'Rowan');
    buttonByText(host, "Let's start").click();
    expect(host.querySelector('[role="alert"]')!.textContent).toContain('Pick your rank');
    expect(editor()).toBeNull(); // no editor until the form is complete
    buttonByText(host, 'Test Wolf').click();
    expect(buttonByText(host, 'Test Wolf').getAttribute('aria-pressed')).toBe('true');
    expect(buttonByText(host, 'Test Wolf').textContent).toContain('Picked');
    expect(host.querySelector('input[type="checkbox"]')).toBeNull(); // no read-aloud setting anywhere
  });

  it('has a Back button when there are other Scouts, which resolves null', async () => {
    const result = showProfileSetup(host, { ranks: TWO, allowCancel: true });
    buttonByText(host, 'Back').click();
    await expect(result).resolves.toBeNull();
  });
});

describe('profile setup: Make your Scout', () => {
  function fillForm(rankLabel = 'Test Wolf'): ReturnType<typeof showProfileSetup> {
    const result = showProfileSetup(host, { ranks: ALL_RANKS, allowCancel: false });
    typeInto(nameField(), '  Rowan ');
    buttonByText(host, rankLabel).click();
    return result;
  }

  it('opens the avatar editor after name and rank, starting from the rank default', async () => {
    const result = fillForm();
    buttonByText(host, "Let's start").click();
    await flush();
    expect(editor()).not.toBeNull();
    expect(host.querySelector('[aria-label="Make your Scout"]')).not.toBeNull();
    expect(host.querySelectorAll('.tq-overlay')).toHaveLength(2); // the form waits underneath
    // Wolf default: Blue shirt, Red neckerchief.
    expect(radio('Shirt', 'Blue').getAttribute('aria-checked')).toBe('true');
    expect(radio('Scarf', 'Red').getAttribute('aria-checked')).toBe('true');
    buttonByText(host, 'Done').click();
    await expect(result).resolves.toMatchObject({ name: 'Rowan', rank: 'wolf', guideName: 'Den Chief' });
  });

  it('resolves the new profile options with the avatar that was made', async () => {
    const result = fillForm();
    buttonByText(host, "Let's start").click();
    await flush();
    radio('Size', 'Tall').click();
    buttonByText(host, 'Extras').click();
    radio('Hat', 'Cap').click(); // free; the Beanie has to be earned
    buttonByText(host, 'Face').click();
    radio('Glasses', 'Glasses').click();
    buttonByText(host, 'Done').click();

    const options = (await result)!;
    expect(options).toEqual({
      name: 'Rowan',
      rank: 'wolf',
      guideName: 'Den Chief',
      avatar: { ...defaultAvatar('wolf'), build: 'tall', hat: 'cap', glasses: true },
    });
    expect(host.querySelector('.tq-overlay')).toBeNull(); // both screens are gone
  });

  it('the avatar goes into the created profile', async () => {
    const result = fillForm('Test Lion');
    buttonByText(host, "Let's start").click();
    await flush();
    radio('Eyes', 'Happy').click();
    buttonByText(host, 'Done').click();

    const save = createDefaultSave();
    const profile = createProfile(save, (await result)!);
    expect(profile.rank).toBe('lion');
    expect(profile.avatar).toEqual({ ...defaultAvatar('lion'), eyes: 'happy' });
    expect(profile.avatar.neckerchief).toBe('#f2c230'); // Lion yellow
    expect(save.activeProfileId).toBe(profile.id);
  });

  it('opens the editor in the rank that was picked, even after the rank changes', async () => {
    const result = fillForm('Test Webelos');
    buttonByText(host, "Let's start").click();
    await flush();
    expect(radio('Shirt', 'Tan').getAttribute('aria-checked')).toBe('true'); // Webelos tan
    buttonByText(host, /Back$/).click(); // the editor's Back (the Backpack option is not it)
    await flush();
    expect(editor()).toBeNull();
    buttonByText(host, 'Test Bear').click();
    buttonByText(host, "Let's start").click();
    await flush();
    expect(radio('Shirt', 'Blue').getAttribute('aria-checked')).toBe('true'); // Bear blue
    expect(radio('Scarf', 'Light blue').getAttribute('aria-checked')).toBe('true');
    buttonByText(host, 'Done').click();
    await expect(result).resolves.toMatchObject({ rank: 'bear', avatar: defaultAvatar('bear') });
  });

  it('Back in the editor returns to the form, filled in, and nothing is resolved', async () => {
    let settled = false;
    const result = fillForm();
    void result.then(() => (settled = true));
    buttonByText(host, "Let's start").click();
    await flush();
    radio('Size', 'Small').click();
    buttonByText(host, /Back$/).click();
    await flush();
    expect(editor()).toBeNull();
    expect(settled).toBe(false);
    expect(nameField().value).toBe('  Rowan ');
    expect(buttonByText(host, 'Test Wolf').getAttribute('aria-pressed')).toBe('true');
    expect(host.querySelectorAll('.tq-overlay')).toHaveLength(1);

    // Going on again starts a fresh editor with the default look (the cancelled choices are gone).
    buttonByText(host, "Let's start").click();
    await flush();
    expect(radio('Size', 'Medium').getAttribute('aria-checked')).toBe('true');
    buttonByText(host, 'Done').click();
    await expect(result).resolves.toMatchObject({ avatar: defaultAvatar('wolf') });
  });

  it('Escape in the editor goes back to the form, not out of setup', async () => {
    const result = showProfileSetup(host, { ranks: ALL_RANKS, allowCancel: true });
    typeInto(nameField(), 'Rowan');
    buttonByText(host, 'Test Wolf').click();
    buttonByText(host, "Let's start").click();
    await flush();
    press(document, 'Escape');
    await flush();
    expect(editor()).toBeNull();
    expect(host.querySelector('.tq-setup')).not.toBeNull();
    buttonByText(host, 'Back').click();
    await expect(result).resolves.toBeNull();
  });

  it('a second tap on Let’s start while the editor is open does not open a second editor', async () => {
    const result = fillForm();
    const start = buttonByText(host, "Let's start");
    start.click();
    start.click();
    await flush();
    expect(host.querySelectorAll('.tq-avatar')).toHaveLength(1);
    buttonByText(host, 'Done').click();
    await result;
  });
});
