/**
 * Boots Trail Quest: loads the save, starts the 3D world, and runs the screens around it
 * (profile setup and picker, HUD, trail panel, parent mode) plus the daily session with the
 * Den Chief. The session logic itself is in session.ts; this file wires it to the real DOM,
 * storage and activities.
 *
 * Guided start: when a Scout arrives the player stands two units from the Den Chief, facing
 * them, and (when today's trail is not done) the Den Chief opens the greeting about a second
 * later. At Base Camp a big Start button, a bobbing arrow over the Den Chief, a compass and a
 * controls hint make the next step obvious without reading a manual.
 */
import './game.css';
import type { Object3D } from 'three';
import { getActivity, IMPLEMENTED_TYPES } from '../activities/registry';
import { assets } from '../engine/assets';
import type { ActivityContext, RankId, ZoneId } from '../activities/types';
import { getRequirement, lessonPosters, listRankContent, loadRankContent } from '../content/load';
import type { RankContent } from '../content/types';
import { todayLocal } from '../quests/dates';
import {
  createProfile,
  hasPin,
  loadSave,
  localStorageStore,
  persistSave,
  setPin,
  verifyPin,
  type KeyValueStore,
} from '../save/store';
import type { Profile, SaveFile } from '../save/types';
import { showDialog } from '../ui/dialog';
import { askNewPin, askPin } from '../ui/pinpad';
import { showPoster } from '../ui/poster';
import { showToast } from '../ui/toast';
import { installEffects } from './effects';
import { events } from './events';
import { GREETING_DELAY_MS, shouldAutoGreet } from './guided-start';
import { line, lineLevelOf, PARENT_TEXT, RANK_FALLBACK_LABELS, type LineLevel, type LineVars } from './lines';
import { overlayCount, watchOverlays } from './overlays';
import { cosmeticById, evaluateUnlocks, UNLOCK_LINE_BY_GROUP, withCosmetics, wornButUnearned } from './rewards';
import { createSession, type Session } from './session';
import { activeStreak } from './streak';
import { showApprovalScreen } from './screens/approval';
import { showAvatarEditor } from './screens/avatar-editor';
import { showBadgeCard } from './screens/badge';
import { ControlsHintGate, controlsMode, createControlsHint } from './screens/controls-hint';
import { createDock } from './screens/dock';
import { createHud, trailProgress } from './screens/hud';
import { showParentMode } from './screens/parent';
import { applySoundSetting, initSound } from './sound-bindings';
import { showProfilePicker } from './screens/profile-picker';
import { showProfileSetup } from './screens/profile-setup';
import { showScoutBook } from './screens/scout-book';
import { createStartButton, startLabel, startMode, startVisible } from './screens/start-button';
import { showSummary } from './screens/summary';
import { showTrailPanel } from './screens/trail-panel';
import { showTrailSign } from './screens/trail-sign';
import { showUnlockCard } from './screens/unlock';
import { createWorld, type World } from './world';
import { createWorldHost, type WorldHost } from './world-host';

export interface AppOptions {
  /** Pin the date (YYYY-MM-DD) instead of using the clock. For testing streaks in dev. */
  today?: string;
  canvas?: HTMLCanvasElement;
  ui?: HTMLElement;
  /** Where the save lives. Defaults to localStorage. */
  store?: KeyValueStore;
  /** Let the Den Chief open the greeting by himself when a Scout arrives. Default true. */
  autoGreet?: boolean;
  /** How long after arriving the greeting opens, in milliseconds. Default 1000. */
  greetingDelayMs?: number;
}

export interface App {
  readonly world: World;
  /** The live save. Edited in place. */
  readonly save: SaveFile;
  /** The session for the Scout who is playing, or null on the picker. */
  readonly session: Session | null;
  /** The Scout who is playing, or null on the picker. */
  readonly profile: Profile | null;
  today(): string;
  /** Pin the date, or pass null to go back to the clock. Dev only in practice. */
  setToday(ymd: string | null): void;
  /** Resolves once a Scout has been chosen and the game is ready to play. */
  readonly ready: Promise<void>;
  /**
   * Stop everything this app started: the idle-hint timer, the greeting timer, the overlay
   * watcher, the zone listener, the confetti and sound listeners on the event bus, the toasts that
   * are still up, and any trail wait that is running (that trail simply stops where it is). The
   * world and the DOM already drawn are the caller's to drop. Safe to call more than once.
   */
  dispose(): void;
}

const SAVE_FAILED = 'Your progress could not be saved. Storage may be full or blocked.';

/** Models the world host may show for collect targets and navigate waypoints. */
const WORLD_MODEL_IDS = [
  'animal.bird',
  'animal.rabbit',
  'animal.frog',
  'animal.squirrel',
  'pickup.backpack',
  'pickup.first-aid-kit',
  'pickup.water-bottle',
  'pickup.flashlight',
  'pickup.map-compass',
  'pickup.fire-starters',
  'pickup.trail-food',
  'pickup.sun-protection',
];

export function startApp(options: AppOptions = {}): App {
  const canvas = options.canvas ?? (document.getElementById('game') as HTMLCanvasElement);
  const ui = options.ui ?? (document.getElementById('ui') as HTMLElement);
  const store = options.store ?? localStorageStore();
  const save = loadSave(store);

  let disposed = false;
  let todayOverride: string | undefined = options.today;
  const today = (): string => todayOverride ?? todayLocal();

  const world = createWorld(canvas, ui);
  // Confetti on a badge, a finished trail and a new cosmetic. It listens to the event bus only.
  const stopEffects = installEffects(ui, events);

  let activeId: string | undefined;
  let session: Session | null = null;
  let panelOpen = false;
  /** The Den Chief's wording for the Scout who is playing. */
  let activeLevel: LineLevel = 'grade2';

  const getProfile = (): Profile | undefined => save.profiles.find((p) => p.id === activeId);
  /** The game has no voice: activities still get a `speak`, and it does nothing. */
  const noSpeak = (): void => {};

  const ranks = listRankContent();
  /** The rank's label from its content file; a plain name only when the content is missing. */
  const rankLabel = (rank: RankId): string => ranks.find((c) => c.rank === rank)?.label ?? RANK_FALLBACK_LABELS[rank] ?? rank;

  /** Toasts still on screen, so dispose() can take them down along with their timers. */
  const liveToasts = new Set<() => void>();
  function toast(text: string, ms?: number): void {
    if (disposed) return;
    liveToasts.add(showToast(ui, text, ms));
  }

  function writeSave(): void {
    if (!persistSave(store, save)) toast(SAVE_FAILED, 6000);
  }

  /** A stop or screen threw. Log it and tell the player, so nobody is left staring at nothing. */
  function reportProblem(error: unknown): void {
    console.error(error);
    toast('Something went wrong. Please try again.', 4000);
  }

  // ---- HUD ----------------------------------------------------------------------------------

  // ---- sound: effects only, remembered per Scout -----------------------------------------------
  const sound = initSound({
    isEnabled: () => applySoundSetting(getProfile()),
    currentZone: () => world.currentZoneId(),
    onToggle(on) {
      const profile = getProfile();
      if (profile) {
        profile.sound = on;
        writeSave();
      }
      refreshHud();
    },
  });

  const hud = createHud(
    ui,
    () => {
      openTrailPanel().catch(reportProblem);
    },
    { onToggleSound: () => sound.toggle() },
  );

  function refreshHud(): void {
    const profile = getProfile();
    hud.update(
      profile
        ? {
            name: profile.name,
            rankLabel: rankLabel(profile.rank),
            xp: profile.xp,
            streak: activeStreak(profile.streak, today()),
            progress: session ? trailProgress(session.view()) : null,
            soundEnabled: applySoundSetting(profile),
          }
        : null,
    );
  }

  // ---- Base Camp: Start button, controls hint, objective --------------------------------------

  const dock = createDock(ui);
  let hintGate = new ControlsHintGate();
  const hint = createControlsHint(dock, {
    onDismiss() {
      hintGate.dismiss();
      syncHint();
    },
  });
  const start = createStartButton(dock, () => talkToGuide());

  let greetingTimer: ReturnType<typeof setTimeout> | undefined;

  function cancelGreeting(): void {
    if (greetingTimer === undefined) return;
    clearTimeout(greetingTimer);
    greetingTimer = undefined;
  }

  /** About a second after a Scout arrives, the Den Chief says hello by himself (if there is a trail to play). */
  function scheduleGreeting(): void {
    cancelGreeting();
    if (options.autoGreet === false || !session || session.view().state !== 'ready') return;
    greetingTimer = setTimeout(() => {
      greetingTimer = undefined;
      const open = session
        ? { viewState: session.view().state, busy: session.busy, overlayOpen: overlayCount(ui) > 0 }
        : { viewState: null, busy: false, overlayOpen: false };
      if (shouldAutoGreet(open)) talkToGuide();
      else syncHint();
    }, options.greetingDelayMs ?? GREETING_DELAY_MS);
  }

  /** Talk to the Den Chief: the Start button, pressing E, the Talk button and the auto greeting all come here. */
  function talkToGuide(): void {
    const current = session;
    if (disposed || !current || current.busy) return;
    cancelGreeting();
    const talking = current.talk();
    refreshBaseCamp(); // the Start button and the objective step aside at once
    talking
      .then((outcome) => {
        // "Look around first": show how to walk and talk, and keep the objective in view.
        if (outcome === 'look-around' && session === current) hintGate.force();
      })
      .catch(reportProblem)
      // The trail may have ended in another zone ("Explore camp" is a camp): walk back first.
      .then(() => (session === current && !atBaseCamp() ? goHome() : undefined))
      .finally(() => {
        if (session === current) refreshBaseCamp();
      });
  }

  function prefersTouch(): boolean {
    return (
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(pointer: coarse)').matches
    );
  }

  /** Show or hide the controls hint. Cheap, so it also runs on a short timer for the idle rule. */
  function syncHint(): void {
    if (disposed) return;
    const profile = getProfile();
    const blocked =
      !profile || !session || session.busy || overlayCount(ui) > 0 || greetingTimer !== undefined || !atBaseCamp();
    const visible = hintGate.update({
      blocked,
      idleSeconds: world.idleSeconds,
      sessionsCompleted: profile?.sessions.length ?? 0,
    });
    hint.set(visible, controlsMode(world.input.lastDevice, prefersTouch()), activeLevel);
  }

  /** Bring the HUD, the Start button, the objective marker and the hint in line with the game's state. */
  function refreshBaseCamp(): void {
    if (disposed) return;
    refreshHud();
    const current = session;
    if (!getProfile() || !current) {
      start.set('hidden', false, activeLevel);
      world.setObjectiveVisible(false);
      syncHint();
      return;
    }
    const view = current.view();
    const mode = startMode(view.state, view.state === 'done-today' && current.keepGoingAvailable());
    const visible = startVisible(mode, { overlayOpen: overlayCount(ui) > 0, busy: current.busy });
    start.set(mode, visible && atBaseCamp(), activeLevel); // the Den Chief lives at Base Camp
    // The arrow over the Den Chief and the compass: only while today's trail is waiting.
    world.setObjectiveVisible(view.state === 'ready' && !current.busy);
    syncHint();
  }

  // Input and Base Camp's own buttons follow the overlays: nothing here shows while a screen is open.
  const stopOverlayWatch = watchOverlays(ui, world.input, () => refreshBaseCamp());
  const stopZoneWatch = world.onZoneChange(() => refreshBaseCamp()); // the Start button and the hint belong to Base Camp
  const hintTimer = setInterval(syncHint, 250);

  function lineVars(): LineVars {
    const profile = getProfile();
    if (!profile) return {};
    return { name: profile.name, guide: profile.guideName, streak: activeStreak(profile.streak, today()), xp: profile.xp };
  }

  // ---- zones: travel and the world host -------------------------------------------------------

  let worldHost: WorldHost | null = null;
  /**
   * What collect and navigate use to place pickups and markers. Made on first use.
   * `resolveModel` maps a content id to a loaded `animal.*` or `pickup.*` model when available;
   * pass `{ resolveModel: (id) => ... }` here to show a model instead of the primitive shape.
   */
  /** Pickups and markers use the matching CC0 model once the asset library has it loaded. */
  function resolveWorldModel(id: string): Object3D | undefined {
    for (const candidate of [`animal.${id}`, `pickup.${id}`, id]) {
      if (assets.has(candidate)) return assets.instance(candidate);
    }
    return undefined;
  }
  void assets.load(WORLD_MODEL_IDS);

  function getWorldHost(): WorldHost {
    worldHost ??= createWorldHost(world, { resolveModel: resolveWorldModel });
    return worldHost;
  }

  const atBaseCamp = (): boolean => world.currentZoneId() === 'base-camp';

  /** Walk to a zone (fade, swap, fade). Clears whatever an activity left in the world first. Never rejects. */
  async function travel(zone: ZoneId): Promise<void> {
    if (world.currentZoneId() === zone) return;
    worldHost?.clear();
    try {
      await world.travelTo(zone);
    } catch (error) {
      reportProblem(error);
    }
  }

  const goHome = (): Promise<void> => travel('base-camp');

  // The "Back to camp" trail sign: a free-roam trip home. Not while a stop is running; that stop's
  // own Back button is how to leave it.
  world.setReturnHandler(() => {
    if (disposed) return;
    if (session?.busy) {
      toast(line('travelBusy', activeLevel), 3000);
      return;
    }
    events.emit({ type: 'travel', zone: 'base-camp' });
    void goHome();
  });

  // ---- the session --------------------------------------------------------------------------

  /** Timers behind the session's `wait` (the trail sign while walking), cleared by dispose(). */
  const waits = new Set<ReturnType<typeof setTimeout>>();

  function buildSession(content: RankContent): Session {
    const level = lineLevelOf(content.readingLevel);
    const need = (): Profile => {
      const profile = getProfile();
      if (!profile) throw new Error('No Scout is playing.');
      return profile;
    };
    return createSession({
      content,
      implemented: IMPLEMENTED_TYPES,
      getProfile: need,
      persist(next) {
        const index = save.profiles.findIndex((p) => p.id === next.id);
        if (index >= 0) save.profiles[index] = next;
        writeSave();
        refreshHud();
      },
      today,
      now: () => Date.now(),
      // Tracked, so dispose() can stop a trail that is mid-wait: its promise just never resolves.
      wait: (ms) =>
        new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            waits.delete(timer);
            resolve();
          }, ms);
          waits.add(timer);
        }),

      // Every Den Chief page tells the event bus it opened and moved on (for the sound layer).
      async showDialog({ text, choices }) {
        events.emit({ type: 'dialog-open' });
        const picked = await showDialog(ui, { speaker: need().guideName, text, choices });
        events.emit({ type: 'dialog-advance' });
        return picked;
      },
      showPoster: ({ title, lines, hint }) => showPoster(ui, { title, lines, hint }),
      async runActivity(stop, stage) {
        const profile = need();
        const spec = stop.activity;
        // Collect and navigate play in the zone their content names; everything else where the stop
        // lives. Normally the trail sign has already walked there, so this is a no-op.
        const zone = spec.type === 'collect' || spec.type === 'navigate' ? spec.params.zone : stop.zone;
        await travel(zone);
        const host = getWorldHost();
        // A lesson with posters (the Scout Oath, then the Scout Law) lets the activity offer a "Show me"
        // peek: `posters` has every one in order, `poster` is the first for activities that know only one.
        const posters = lessonPosters(getRequirement(content, stop.requirementId)?.requirement);
        const ctx: ActivityContext = {
          profileId: profile.id,
          rank: profile.rank,
          readingLevel: content.readingLevel,
          speak: noSpeak,
          world: host,
          stage,
          ...(posters.length > 0 ? { poster: posters[0], posters } : {}),
        };
        try {
          return await getActivity(spec.type).run(ui, spec.params, ctx);
        } finally {
          host.clear(); // nothing an activity placed outlives it
        }
      },
      showTrailSign: (text) => showTrailSign(ui, text),
      showApproval: (info) => showApprovalScreen(ui, { info, level, vars: lineVars() }),
      hasPin: () => hasPin(save),
      askPin: ({ title, subtitle }) => askPin(ui, { title, subtitle, verify: (pin) => verifyPin(save, pin) }),
      askNewPin: (request) => askNewPin(ui, request),
      setPin: (pin) => storePin(pin),
      showBadge: ({ adventureName }) => showBadgeCard(ui, { adventureName, level, vars: lineVars() }),
      showSummary: (info) => showSummary(ui, { info, level, vars: lineVars() }),
      showUnlock: (info) => showUnlockCard(ui, { info, level, vars: lineVars() }),
      showToast: (text) => toast(text, 3500),
      // A cheer from the Scout's avatar when a stop is done (the session never touches the world).
      celebrate: () => world.player.celebrate(),
      // The ZONE-TRAVEL HOOK (see session.ts): the trail sign has been shown, now really walk there.
      travelToZone: (zone) => travel(zone),
    });
  }

  /** Store a new PIN. Tells the parent why when it fails, then rethrows. */
  async function storePin(pin: string): Promise<void> {
    try {
      await setPin(save, pin);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'The PIN could not be saved.', 6000);
      throw error;
    }
    writeSave();
  }

  /**
   * Make a Scout the active player. False when there is no trail content for their rank.
   * `arrive` is the guided start (stand by the Den Chief, greeting after a second); it is off when
   * an already-playing Scout is only being refreshed, for example after Parent mode.
   */
  function activate(profile: Profile, arrive = true): boolean {
    const content = loadRankContent(profile.rank);
    if (!content) {
      toast(`There is no trail for ${rankLabel(profile.rank)} yet.`, 4000);
      return false;
    }
    activeId = profile.id;
    save.activeProfileId = profile.id;
    writeSave();
    session = buildSession(content);
    activeLevel = lineLevelOf(content.readingLevel);
    events.emit({ type: 'profile-active', profileId: profile.id });
    grantEarned(content);
    const current = getProfile() ?? profile;
    world.setGuideName(current.guideName);
    world.setPlayerAvatar(current.avatar, current.rank);
    world.setDenChiefHandler(() => talkToGuide());
    if (arrive) {
      hintGate = new ControlsHintGate();
      world.placeAtGuide();
      scheduleGreeting();
    }
    refreshBaseCamp();
    return true;
  }

  /**
   * Catch the active Scout up on rewards when they sit down: cosmetics they earned while the game
   * was closed (or in Parent mode, where a parent approves a mission) are saved and announced with a
   * toast. A look made before rewards existed keeps what it wears: those options are marked earned
   * quietly, never taken away.
   */
  function grantEarned(content: RankContent): void {
    const profile = getProfile();
    if (!profile) return;
    const fresh = evaluateUnlocks(profile, content);
    const earned = withCosmetics(profile, fresh);
    const next = withCosmetics(earned, wornButUnearned(earned));
    if (next !== profile) {
      const index = save.profiles.findIndex((p) => p.id === profile.id);
      if (index >= 0) save.profiles[index] = next;
      writeSave();
    }
    if (fresh.length === 0) return;
    for (const id of fresh) events.emit({ type: 'cosmetic-unlocked', id });
    const first = cosmeticById(fresh[0]!);
    if (!first) return;
    const key = fresh.length === 1 ? UNLOCK_LINE_BY_GROUP[first.group] : 'unlockMany';
    toast(line(key, activeLevel, { ...lineVars(), unlock: first.label }), 5000);
  }

  function deactivate(): void {
    cancelGreeting();
    activeId = undefined;
    session = null;
    world.setDenChiefHandler(() => {});
    refreshBaseCamp();
  }

  // ---- parent mode --------------------------------------------------------------------------

  /** Ask for the parent PIN, setting one first if there is none. */
  async function parentGate(): Promise<boolean> {
    if (!hasPin(save)) {
      const pin = await askNewPin(ui, {
        title: PARENT_TEXT.newPinTitle,
        subtitle: PARENT_TEXT.newPinSubtitle,
        confirmTitle: PARENT_TEXT.newPinConfirmTitle,
      });
      if (pin === null) return false;
      try {
        await storePin(pin);
      } catch {
        return false;
      }
      return true;
    }
    return askPin(ui, {
      title: PARENT_TEXT.enterPinTitle,
      subtitle: PARENT_TEXT.parentPinSubtitle,
      verify: (pin) => verifyPin(save, pin),
    });
  }

  /** Open Parent mode behind the PIN. Resolves true when a save was imported. */
  async function openParentMode(): Promise<boolean> {
    if (!(await parentGate())) return false;
    const result = await showParentMode(ui, {
      save,
      today,
      persist: writeSave,
      replaceSave(next) {
        save.version = next.version;
        save.profiles = next.profiles;
        save.parent = next.parent;
        save.activeProfileId = next.activeProfileId;
        writeSave();
      },
      async changePin() {
        const pin = await askNewPin(ui, {
          title: 'Choose a new PIN',
          subtitle: 'Pick 4 digits.',
          confirmTitle: PARENT_TEXT.newPinConfirmTitle,
        });
        if (pin === null) return false;
        try {
          await storePin(pin);
          return true;
        } catch {
          return false;
        }
      },
      contentFor: loadRankContent,
      rankLabel,
      startProfileId: activeId,
    });
    return result.imported || result.removedActiveProfile;
  }

  // ---- choosing who plays -------------------------------------------------------------------

  async function runSetup(allowCancel: boolean): Promise<Profile | null> {
    const choice = await showProfileSetup(ui, {
      ranks: ranks.map((c) => ({ rank: c.rank, label: c.label, grade: c.grade })),
      allowCancel,
    });
    if (!choice) return null;
    const profile = createProfile(save, choice);
    writeSave();
    return profile;
  }

  /** The profile setup or picker, until a Scout has been chosen. */
  async function chooseProfile(): Promise<void> {
    deactivate();
    for (;;) {
      if (save.profiles.length === 0) {
        const created = await runSetup(false);
        if (created && activate(created)) return;
        continue;
      }
      const choice = await showProfilePicker(ui, {
        profiles: save.profiles.map((p) => ({
          id: p.id,
          name: p.name,
          rankLabel: rankLabel(p.rank),
          streakDays: activeStreak(p.streak, today()),
        })),
      });
      if (choice.kind === 'play') {
        const profile = save.profiles.find((p) => p.id === choice.profileId);
        if (profile && activate(profile)) return;
      } else if (choice.kind === 'add') {
        const created = await runSetup(true);
        if (created && activate(created)) return;
      } else {
        await openParentMode();
      }
    }
  }

  // ---- the trail panel ----------------------------------------------------------------------

  async function openTrailPanel(): Promise<void> {
    const profile = getProfile();
    if (!session || !profile || session.busy || panelOpen) return;
    panelOpen = true;
    try {
      const level = activeLevel;
      const view = session.view();
      const mode = startMode(view.state, view.state === 'done-today' && session.keepGoingAvailable());
      const choice = await showTrailPanel(ui, {
        view,
        level,
        start: mode === 'hidden' ? undefined : { label: startLabel(mode, level) },
        places: { current: world.currentZoneId() },
        onEditAvatar: async () => {
          const next = await showAvatarEditor(ui, {
            initial: profile.avatar,
            rank: profile.rank,
            unlocks: profile.unlocks,
            level,
          });
          if (!next) return;
          profile.avatar = next;
          writeSave();
          world.setPlayerAvatar(next, profile.rank);
        },
        onScoutBook: () => showScoutBook(ui, { rank: profile.rank, level }),
      });
      if (typeof choice === 'object') {
        events.emit({ type: 'travel', zone: choice.travel });
        await travel(choice.travel); // a free-roam hop from the Places section
      } else if (choice === 'start') {
        // The Den Chief lives at Base Camp: walk home first when the Scout is somewhere else.
        await goHome();
        talkToGuide();
      } else if (choice === 'switch') {
        await chooseProfile();
      } else if (choice === 'parent') {
        const imported = await openParentMode();
        const stillThere = getProfile();
        // Parent mode may have approved, reset or imported. Start a fresh session from the save,
        // or go back to the picker when an import may have replaced the Scouts.
        if (!imported && stillThere && activate(stillThere, false)) return;
        await chooseProfile();
      }
    } finally {
      panelOpen = false;
    }
  }

  const ready = chooseProfile();
  ready.catch(reportProblem);

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    clearInterval(hintTimer);
    cancelGreeting();
    // Stop watching before anything below touches the DOM, so teardown never reaches the input switch.
    stopOverlayWatch();
    stopZoneWatch();
    stopEffects();
    sound.dispose();
    for (const timer of waits) clearTimeout(timer);
    waits.clear();
    for (const remove of [...liveToasts]) remove();
    liveToasts.clear();
  }

  return {
    world,
    save,
    get session() {
      return session;
    },
    get profile() {
      return getProfile() ?? null;
    },
    today,
    setToday(ymd) {
      todayOverride = ymd ?? undefined;
      refreshBaseCamp();
    },
    ready,
    dispose,
  };
}
