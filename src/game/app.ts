/**
 * Boots Trail Quest: loads the save, starts the 3D world, and runs the screens around it
 * (profile setup and picker, HUD, trail panel, parent mode) plus the daily session with the
 * Den Chief. The session logic itself is in session.ts; this file wires it to the real DOM,
 * storage, speech and activities.
 */
import './game.css';
import { getActivity, IMPLEMENTED_TYPES } from '../activities/registry';
import type { ActivityContext, RankId } from '../activities/types';
import { listRankContent, loadRankContent } from '../content/load';
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
import { createSpeaker, prepareSpeechOnFirstGesture } from '../ui/speech';
import { showToast } from '../ui/toast';
import { lineLevelOf, PARENT_TEXT, type LineVars } from './lines';
import { watchOverlays } from './overlays';
import { createSession, type Session } from './session';
import { activeStreak } from './streak';
import { showApprovalScreen } from './screens/approval';
import { showBadgeCard } from './screens/badge';
import { createHud } from './screens/hud';
import { showParentMode } from './screens/parent';
import { showProfilePicker } from './screens/profile-picker';
import { showProfileSetup } from './screens/profile-setup';
import { showSummary } from './screens/summary';
import { showTrailPanel } from './screens/trail-panel';
import { showTrailSign } from './screens/trail-sign';
import { createWorld, type World } from './world';

export interface AppOptions {
  /** Pin the date (YYYY-MM-DD) instead of using the clock. For testing streaks in dev. */
  today?: string;
  canvas?: HTMLCanvasElement;
  ui?: HTMLElement;
  /** Where the save lives. Defaults to localStorage. */
  store?: KeyValueStore;
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
}

const SAVE_FAILED = 'Your progress could not be saved. Storage may be full or blocked.';

export function startApp(options: AppOptions = {}): App {
  const canvas = options.canvas ?? (document.getElementById('game') as HTMLCanvasElement);
  const ui = options.ui ?? (document.getElementById('ui') as HTMLElement);
  const store = options.store ?? localStorageStore();
  const save = loadSave(store);

  let todayOverride: string | undefined = options.today;
  const today = (): string => todayOverride ?? todayLocal();

  prepareSpeechOnFirstGesture();
  const world = createWorld(canvas, ui);
  watchOverlays(ui, world.input);

  let activeId: string | undefined;
  let session: Session | null = null;
  let panelOpen = false;

  const getProfile = (): Profile | undefined => save.profiles.find((p) => p.id === activeId);
  const speak = createSpeaker(() => getProfile()?.readAloud ?? false);

  const ranks = listRankContent();
  const rankLabel = (rank: RankId): string => ranks.find((c) => c.rank === rank)?.label ?? rank;

  function writeSave(): void {
    if (!persistSave(store, save)) showToast(ui, SAVE_FAILED, 6000);
  }

  /** A stop or screen threw. Log it and tell the player, so nobody is left staring at nothing. */
  function reportProblem(error: unknown): void {
    console.error(error);
    showToast(ui, 'Something went wrong. Please try again.', 4000);
  }

  // ---- HUD ----------------------------------------------------------------------------------

  const hud = createHud(ui, () => {
    openTrailPanel().catch(reportProblem);
  });

  function refreshHud(): void {
    const profile = getProfile();
    hud.update(
      profile
        ? {
            name: profile.name,
            rankLabel: rankLabel(profile.rank),
            xp: profile.xp,
            streak: activeStreak(profile.streak, today()),
          }
        : null,
    );
  }

  function lineVars(): LineVars {
    const profile = getProfile();
    if (!profile) return {};
    return { name: profile.name, guide: profile.guideName, streak: activeStreak(profile.streak, today()), xp: profile.xp };
  }

  // ---- the session --------------------------------------------------------------------------

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
      wait: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),

      showDialog: ({ text, choices }) =>
        showDialog(ui, { speaker: need().guideName, text, choices, speak, autoSpeak: true }),
      runActivity(stop, stage) {
        const profile = need();
        const ctx: ActivityContext = {
          profileId: profile.id,
          rank: profile.rank,
          readingLevel: content.readingLevel,
          speak,
          stage,
        };
        return getActivity(stop.activity.type).run(ui, stop.activity.params, ctx);
      },
      showTrailSign(text) {
        speak(text);
        return showTrailSign(ui, text);
      },
      showApproval: (info) => showApprovalScreen(ui, { info, level, vars: lineVars(), speak }),
      hasPin: () => hasPin(save),
      askPin: ({ title, subtitle }) => askPin(ui, { title, subtitle, verify: (pin) => verifyPin(save, pin) }),
      askNewPin: (request) => askNewPin(ui, request),
      setPin: (pin) => storePin(pin),
      showBadge: ({ adventureName }) => showBadgeCard(ui, { adventureName, level, vars: lineVars(), speak }),
      showSummary: (info) => showSummary(ui, { info, level, vars: lineVars(), speak }),
      // travelToZone is the ZONE-TRAVEL HOOK (see session.ts): unset until real zones exist.
    });
  }

  /** Store a new PIN. Tells the parent why when it fails, then rethrows. */
  async function storePin(pin: string): Promise<void> {
    try {
      await setPin(save, pin);
    } catch (error) {
      showToast(ui, error instanceof Error ? error.message : 'The PIN could not be saved.', 6000);
      throw error;
    }
    writeSave();
  }

  /** Make a Scout the active player. False when there is no trail content for their rank. */
  function activate(profile: Profile): boolean {
    const content = loadRankContent(profile.rank);
    if (!content) {
      showToast(ui, `There is no trail for ${rankLabel(profile.rank)} yet.`, 4000);
      return false;
    }
    activeId = profile.id;
    save.activeProfileId = profile.id;
    writeSave();
    session = buildSession(content);
    world.setGuideName(profile.guideName);
    world.setDenChiefHandler(() => {
      session?.talk().catch(reportProblem);
    });
    refreshHud();
    return true;
  }

  function deactivate(): void {
    activeId = undefined;
    session = null;
    world.setDenChiefHandler(() => {});
    refreshHud();
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
    return result.imported;
  }

  // ---- choosing who plays -------------------------------------------------------------------

  async function runSetup(allowCancel: boolean): Promise<Profile | null> {
    const choice = await showProfileSetup(ui, {
      ranks: ranks.map((c) => ({ rank: c.rank, label: c.label, grade: c.grade })),
      speak,
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
        speak,
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
      const level = lineLevelOf(loadRankContent(profile.rank)?.readingLevel ?? 'grade2');
      const choice = await showTrailPanel(ui, { view: session.view(), level, speak });
      if (choice === 'switch') {
        await chooseProfile();
      } else if (choice === 'parent') {
        const imported = await openParentMode();
        const stillThere = getProfile();
        // Parent mode may have approved, reset or imported. Start a fresh session from the save,
        // or go back to the picker when an import may have replaced the Scouts.
        if (!imported && stillThere && activate(stillThere)) return;
        await chooseProfile();
      }
    } finally {
      panelOpen = false;
    }
  }

  const ready = chooseProfile();
  ready.catch(reportProblem);

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
      refreshHud();
    },
    ready,
  };
}
