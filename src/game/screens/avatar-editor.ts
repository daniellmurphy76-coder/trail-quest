/**
 * "Make your Scout": the avatar editor. A full-screen overlay with a live 3D preview of the Scout
 * (drag or use the Turn buttons to look around) and big tabbed controls: Hero, Body, Hair, Face,
 * Clothes, Extras. The Hero tab offers three ready-made heroes: one tap sets a whole look, which the
 * other tabs can then change. Every option is a 56px swatch or little picture with a word under it and a
 * check mark when picked, so nothing depends on color alone. Works with keyboard, mouse and touch.
 *
 * A few options are earned by playing (the scout hat, star eyes, the backpack, the gold shirt...).
 * Until the Scout has earned one, its tile shows a lock mark and a plain "how to earn it" line, and
 * tapping it does nothing but say so. The Random button and the starting look never use one either.
 *
 * Resolves the finished look (every field filled in) on Done, or null on Cancel or Escape.
 * The preview has its own WebGL renderer, which is freed when the editor closes. With no WebGL the
 * editor still works and says the picture is not available.
 */
import type { RankId } from '../../activities/types';
import { HEROES, heroAvatar, heroOf, type HeroId } from '../../player/avatar/heroes';
import { optionIcon, type IconGroup } from '../../player/avatar/icons';
import {
  BUILDS,
  CLOTHES_COLORS,
  EYE_STYLES,
  HAIR_COLORS,
  HAIR_STYLES,
  HAT_COLORS,
  HAT_STYLES,
  LEG_STYLES,
  NECKERCHIEF_COLORS,
  SHIRT_COLORS,
  SHOE_COLORS,
  SKIN_TONES,
  cosmeticLock,
  earnedCosmetics,
  fillAvatar,
  randomAvatar,
  type Choice,
  type CosmeticGroup,
  type CosmeticLock,
  type FilledAvatar,
} from '../../player/avatar/options';
import { createAvatarPreview, type AvatarPreview } from '../../player/avatar/preview';
import type { AvatarConfig } from '../../save/types';
import { h } from '../../ui/dom';
import { mountOverlay } from '../../ui/overlay';
import { button, uid } from '../../ui/widgets';
import '../avatar.css';
import '../rewards.css';
import type { LineLevel } from '../lines';

export interface AvatarEditorOptions {
  /** The look to start from. A v1 avatar (bodyColor only) is filled in from the rank. */
  initial: AvatarConfig;
  /** The Scout's rank: sets the default uniform colors and the neckerchief for the Random button. */
  rank: RankId;
  /** Heading. Default "Make your Scout". */
  title?: string;
  /** Default "Done". */
  doneLabel?: string;
  /** Default "Cancel". Setup uses "Back", because it returns to the name step. */
  cancelLabel?: string;
  /** Replaces Math.random for the Random button (tests). */
  random?: () => number;
  /**
   * The Scout's `Profile.unlocks`: which earned options are open. Left out, nothing has been earned
   * yet (a brand-new Scout), so the earned options show as locked. Tests that want every tile open
   * pass `ALL_COSMETIC_UNLOCKS`.
   */
  unlocks?: readonly string[];
  /** Which wording the "how to earn it" lines use. Default 'grade2'. */
  level?: LineLevel;
}

export const AVATAR_EDITOR_TITLE = 'Make your Scout';

type TabId = 'hero' | 'body' | 'hair' | 'face' | 'clothes' | 'extras';

const TABS: ReadonlyArray<{ id: TabId; label: string }> = [
  { id: 'hero', label: 'Hero' },
  { id: 'body', label: 'Body' },
  { id: 'hair', label: 'Hair' },
  { id: 'face', label: 'Face' },
  { id: 'clothes', label: 'Clothes' },
  { id: 'extras', label: 'Extras' },
];

interface GroupDef {
  tab: TabId;
  title: string;
  choices: readonly Choice[];
  /** Colors show as a swatch; the rest show a little picture. */
  picture?: IconGroup;
  /** The picked value, or '' when none of the options is picked (a hero after a change). */
  get(look: FilledAvatar, rank: RankId): string;
  set(look: FilledAvatar, value: string, rank: RankId): void;
  /** A short line under each option's word, by value (the hero blurbs). */
  notes?: Readonly<Record<string, string>>;
  /** False hides the group (hat color with no hat). */
  visible?(look: FilledAvatar): boolean;
  /** Set when some of this group's options have to be earned. */
  lockGroup?: CosmeticGroup;
}

const ON_OFF = (label: string): readonly Choice[] => [
  { value: 'off', label: 'None' },
  { value: 'on', label: label },
];

const GROUPS: readonly GroupDef[] = [
  {
    tab: 'hero',
    title: 'Heroes',
    choices: HEROES.map((hero) => ({ value: hero.id, label: hero.name })),
    picture: 'hero',
    notes: Object.fromEntries(HEROES.map((hero) => [hero.id, hero.blurb])),
    get: (a, rank) => heroOf(a, rank) ?? '',
    set: (a, v, rank) => Object.assign(a, heroAvatar(v as HeroId, rank)),
  },
  { tab: 'body', title: 'Size', choices: BUILDS, picture: 'build', get: (a) => a.build, set: (a, v) => (a.build = v as FilledAvatar['build']) },
  { tab: 'body', title: 'Skin', choices: SKIN_TONES, get: (a) => a.skin, set: (a, v) => (a.skin = v) },
  { tab: 'hair', title: 'Hair style', choices: HAIR_STYLES, picture: 'hairStyle', get: (a) => a.hairStyle, set: (a, v) => (a.hairStyle = v as FilledAvatar['hairStyle']) },
  { tab: 'hair', title: 'Hair color', choices: HAIR_COLORS, get: (a) => a.hairColor, set: (a, v) => (a.hairColor = v), visible: (a) => a.hairStyle !== 'none' },
  { tab: 'face', title: 'Eyes', choices: EYE_STYLES, picture: 'eyes', lockGroup: 'eyes', get: (a) => a.eyes, set: (a, v) => (a.eyes = v as FilledAvatar['eyes']) },
  { tab: 'face', title: 'Glasses', choices: ON_OFF('Glasses'), picture: 'glasses', get: (a) => (a.glasses ? 'on' : 'off'), set: (a, v) => (a.glasses = v === 'on') },
  {
    tab: 'clothes',
    title: 'Shirt',
    choices: SHIRT_COLORS,
    lockGroup: 'shirt',
    get: (a) => a.shirt,
    set: (a, v) => {
      a.shirt = v;
      a.bodyColor = v; // the old v1 field follows the shirt
    },
  },
  { tab: 'clothes', title: 'Legs', choices: LEG_STYLES, picture: 'legs', get: (a) => a.legs, set: (a, v) => (a.legs = v as FilledAvatar['legs']) },
  { tab: 'clothes', title: 'Leg color', choices: CLOTHES_COLORS, get: (a) => a.legColor, set: (a, v) => (a.legColor = v) },
  { tab: 'clothes', title: 'Shoes', choices: SHOE_COLORS, get: (a) => a.shoes, set: (a, v) => (a.shoes = v) },
  { tab: 'extras', title: 'Hat', choices: HAT_STYLES, picture: 'hat', lockGroup: 'hat', get: (a) => a.hat, set: (a, v) => (a.hat = v) },
  { tab: 'extras', title: 'Hat color', choices: HAT_COLORS, get: (a) => a.hatColor, set: (a, v) => (a.hatColor = v), visible: (a) => a.hat !== 'none' },
  { tab: 'extras', title: 'Backpack', choices: ON_OFF('Backpack'), picture: 'backpack', lockGroup: 'backpack', get: (a) => (a.backpack ? 'on' : 'off'), set: (a, v) => (a.backpack = v === 'on') },
  { tab: 'extras', title: 'Scarf', choices: NECKERCHIEF_COLORS, get: (a) => a.neckerchief, set: (a, v) => (a.neckerchief = v) },
];

interface OptionView {
  value: string;
  button: HTMLButtonElement;
}

interface GroupView {
  def: GroupDef;
  section: HTMLElement;
  options: OptionView[];
}

/**
 * One tile. A locked one (`lock` set and not earned) keeps its picture or swatch, adds a lock mark,
 * and says how to earn it under the word. It is still a button (a keyboard can reach it and a screen
 * reader can read it) but it is `aria-disabled` and never picks.
 */
function optionButton(def: GroupDef, choice: Choice, lock?: CosmeticLock, level: LineLevel = 'grade2'): HTMLButtonElement {
  const note = def.notes?.[choice.value];
  const face = h('span', { class: 'tq-opt__face', attrs: { 'aria-hidden': 'true' } });
  if (def.picture) face.append(optionIcon(def.picture, choice.value));
  else face.style.setProperty('--swatch', choice.value);
  face.append(h('span', { class: 'tq-opt__tick' }, '✓'));
  const classes = ['tq-opt', def.picture ? 'tq-opt--picture' : 'tq-opt--swatch'];
  const children = [face, h('span', { class: 'tq-opt__label' }, choice.label)];
  if (note) {
    classes.push('tq-opt--noted');
    children.push(h('span', { class: 'tq-opt__note' }, note));
  }
  if (lock) {
    classes.push('tq-opt--locked');
    children.push(
      h('span', { class: 'tq-opt__lock' }, h('span', { attrs: { 'aria-hidden': 'true' } }, '\u{1F512}'), h('span', { class: 'tq-sr' }, 'Locked. ')),
      h('span', { class: 'tq-opt__earn' }, lock.earn[level]),
    );
  }
  return h(
    'button',
    {
      class: classes.join(' '),
      type: 'button',
      role: 'radio',
      dataset: lock ? { value: choice.value, locked: 'true' } : { value: choice.value },
      attrs: lock ? { 'aria-checked': 'false', 'aria-disabled': 'true' } : { 'aria-checked': 'false' },
    },
    ...children,
  );
}

/** Move focus among the options of one group with the arrow keys (the page does not scroll). */
function arrowKeys(grid: HTMLElement): void {
  grid.addEventListener('keydown', (event) => {
    const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    const items = Array.from(grid.querySelectorAll<HTMLButtonElement>('button'));
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    event.preventDefault();
    let next = at;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (at + 1) % items.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (at - 1 + items.length) % items.length;
    else if (event.key === 'Home') next = 0;
    else next = items.length - 1;
    items[next]?.focus({ preventScroll: false });
  });
}

/** Opens the avatar editor over `host`. Resolves the chosen look, or null if the Scout cancels. */
export function showAvatarEditor(host: HTMLElement, options: AvatarEditorOptions): Promise<FilledAvatar | null> {
  return new Promise<FilledAvatar | null>((resolve) => {
    let finished = false;
    let preview: AvatarPreview | null = null;
    const onResize = (): void => preview?.resize();
    const finish = (value: FilledAvatar | null): void => {
      if (finished) return;
      finished = true;
      window.removeEventListener('resize', onResize);
      preview?.dispose();
      preview = null;
      overlay.close();
      resolve(value);
    };
    const title = options.title ?? AVATAR_EDITOR_TITLE;
    const overlay = mountOverlay(host, {
      label: title,
      cardClass: 'tq-avatar',
      onEscape: () => finish(null),
    });

    const level = options.level ?? 'grade2';
    const unlocks = options.unlocks ?? [];
    const earned = earnedCosmetics(unlocks);
    /** The lock on an option the Scout has not earned yet, or undefined when it is free or earned. */
    const closedLock = (def: GroupDef, value: string): CosmeticLock | undefined => {
      const lock = def.lockGroup ? cosmeticLock(def.lockGroup, value) : undefined;
      return lock && !earned.has(lock.id) ? lock : undefined;
    };

    let look = fillAvatar(options.initial, options.rank, unlocks);

    // ---- the picture ---------------------------------------------------------------------------
    const canvas = h('canvas', {
      class: 'tq-avatar__canvas',
      role: 'img',
      attrs: { 'aria-label': 'Your Scout. Drag to turn around.' },
    });
    const noPicture = h('p', { class: 'tq-avatar__nopicture', hidden: true }, 'No picture here. Your choices still work.');
    const turn = (label: string, glyph: string, radians: number): HTMLButtonElement =>
      h(
        'button',
        {
          class: 'tq-avatar__turn',
          type: 'button',
          title: label,
          attrs: { 'aria-label': label },
          on: { click: () => preview?.turn(radians) },
        },
        h('span', { attrs: { 'aria-hidden': 'true' } }, glyph),
      );
    const turnLeft = turn('Turn left', '↺', Math.PI / 4);
    const turnRight = turn('Turn right', '↻', -Math.PI / 4);
    const stage = h(
      'div',
      { class: 'tq-avatar__stage' },
      h('div', { class: 'tq-avatar__view' }, canvas, noPicture, turnLeft, turnRight),
      h('p', { class: 'tq-avatar__hint' }, 'Drag to turn around.'),
    );

    // ---- the controls --------------------------------------------------------------------------
    const groupViews: GroupView[] = GROUPS.map((def) => {
      const labelId = uid('tq-opt-group');
      const grid = h('div', { class: 'tq-avatar__grid', role: 'radiogroup', attrs: { 'aria-labelledby': labelId } });
      const views: OptionView[] = def.choices.map((choice) => {
        const btn = optionButton(def, choice, closedLock(def, choice.value), level);
        btn.addEventListener('click', () => pick(def, choice));
        grid.append(btn);
        return { value: choice.value, button: btn };
      });
      arrowKeys(grid);
      const section = h(
        'section',
        { class: 'tq-avatar__group' },
        h('h3', { class: 'tq-avatar__group-title', id: labelId }, def.title),
        grid,
      );
      return { def, section, options: views };
    });

    const panels = new Map<TabId, HTMLElement>();
    const tabButtons = new Map<TabId, HTMLButtonElement>();
    const tablistId = uid('tq-tabs');
    for (const tab of TABS) {
      const panelId = uid('tq-panel');
      const tabId = `${tablistId}-${tab.id}`;
      const panel = h(
        'div',
        { class: 'tq-avatar__tabpanel', id: panelId, role: 'tabpanel', hidden: tab.id !== TABS[0]!.id, attrs: { 'aria-labelledby': tabId } },
        ...groupViews.filter((g) => g.def.tab === tab.id).map((g) => g.section),
      );
      panels.set(tab.id, panel);
      const btn = h(
        'button',
        {
          class: 'tq-avatar__tab',
          type: 'button',
          role: 'tab',
          id: tabId,
          attrs: { 'aria-selected': 'false', 'aria-controls': panelId },
          dataset: { tab: tab.id },
          on: { click: () => selectTab(tab.id) },
        },
        tab.label,
      );
      tabButtons.set(tab.id, btn);
    }
    const tablist = h('div', { class: 'tq-avatar__tabs', role: 'tablist', attrs: { 'aria-label': 'Parts of your Scout' } }, ...tabButtons.values());
    tablist.addEventListener('keydown', (event) => {
      const ids = TABS.map((t) => t.id);
      const at = ids.findIndex((id) => tabButtons.get(id) === document.activeElement);
      if (at < 0) return;
      let next = at;
      if (event.key === 'ArrowRight') next = (at + 1) % ids.length;
      else if (event.key === 'ArrowLeft') next = (at - 1 + ids.length) % ids.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = ids.length - 1;
      else return;
      event.preventDefault();
      selectTab(ids[next]!);
      tabButtons.get(ids[next]!)?.focus({ preventScroll: true });
    });

    function selectTab(id: TabId): void {
      for (const tab of TABS) {
        const on = tab.id === id;
        const btn = tabButtons.get(tab.id)!;
        btn.setAttribute('aria-selected', String(on));
        btn.tabIndex = on ? 0 : -1;
        btn.classList.toggle('is-selected', on);
        panels.get(tab.id)!.hidden = !on;
      }
    }

    /** Show what is picked, and hide groups that do not apply (hat color with no hat). */
    function refresh(): void {
      for (const view of groupViews) {
        view.section.hidden = view.def.visible ? !view.def.visible(look) : false;
        const current = view.def.get(look, options.rank);
        for (const option of view.options) {
          const on = option.value === current;
          option.button.setAttribute('aria-checked', String(on));
          option.button.classList.toggle('is-selected', on);
        }
      }
    }

    function pick(def: GroupDef, choice: Choice): void {
      const lock = closedLock(def, choice.value);
      if (lock) {
        // Not earned yet: nothing changes, and the Scout is told how to get it.
        status.textContent = `${lock.label} is locked. ${lock.earn[level]}`;
        return;
      }
      const next = { ...look };
      def.set(next, choice.value, options.rank);
      look = next;
      refresh();
      preview?.setConfig(look);
    }

    const status = h('p', { class: 'tq-sr', role: 'status' });
    const random = button('Random', {
      icon: '\u{1F3B2}',
      onClick: () => {
        look = randomAvatar(options.rank, options.random, unlocks);
        refresh();
        preview?.setConfig(look);
        status.textContent = 'New look!';
      },
    });
    const cancel = button(options.cancelLabel ?? 'Cancel', { icon: '✖', onClick: () => finish(null) });
    const done = button(options.doneLabel ?? 'Done', {
      variant: 'primary',
      icon: '✓',
      onClick: () => finish({ ...look, bodyColor: look.shirt }),
    });

    overlay.card.append(
      h('div', { class: 'tq-prompt' }, h('h2', null, title)),
      h(
        'div',
        { class: 'tq-avatar__body' },
        stage,
        h('div', { class: 'tq-avatar__panel' }, tablist, ...TABS.map((t) => panels.get(t.id)!)),
      ),
      status,
      h('div', { class: 'tq-actions' }, random, cancel, done),
    );
    selectTab(TABS[0]!.id);
    refresh();

    // The picture comes last: the canvas must be in the page to be measured.
    preview = createAvatarPreview(canvas, look, { rank: options.rank });
    if (!preview) {
      canvas.hidden = true;
      noPicture.hidden = false;
      turnLeft.hidden = true;
      turnRight.hidden = true;
    } else {
      window.addEventListener('resize', onResize);
    }

    overlay.setDefault(done);
    overlay.focus(tabButtons.get(TABS[0]!.id));
  });
}
