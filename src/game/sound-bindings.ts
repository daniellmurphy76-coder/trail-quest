/**
 * Sound wiring. Listens to the game event bus and plays the matching effect, and keeps the
 * ambience on the right zone. Features never import this file or the audio code: they emit events.
 *
 * Sound is effects only, never voice. It is on unless the Scout turned it off (`profile.sound`,
 * where a missing value means on), and nothing plays before the first user gesture (the engine
 * enforces that).
 *
 * app.ts wiring (once, after the save and the world exist):
 *
 *   const sound = initSound({
 *     isEnabled: () => applySoundSetting(getProfile()),
 *     onToggle: (on) => { const p = getProfile(); if (p) p.sound = on; persist(); refreshHud(); },
 *     currentZone: () => world.currentZoneId(),
 *   });
 *   // HUD: createHud(ui, onTrail, { onToggleSound: () => sound.toggle() }),
 *   //      and refreshHud() passes soundEnabled: applySoundSetting(profile).
 */
import type { ZoneId } from '../activities/types';
import { createAmbience, type Ambience } from '../audio/ambience';
import { getAudioEngine, type AudioEngine } from '../audio/engine';
import { createSfx, type Sfx, type SfxName } from '../audio/sfx';
import type { Profile } from '../save/types';
import { events, type EventBus, type GameEventType } from './events';

/** True unless the Scout switched sound off. A missing setting, or no Scout yet, means on. */
export function applySoundSetting(profile: Pick<Profile, 'sound'> | null | undefined): boolean {
  return profile?.sound !== false;
}

/** Which effect each event plays. Events not listed here make no sound. */
export const SFX_FOR_EVENT: { readonly [K in GameEventType]?: SfxName } = {
  'ui-tap': 'tap',
  'answer-right': 'right',
  'answer-wrong': 'wrong',
  'dialog-advance': 'advance',
  'stop-complete': 'stopComplete',
  'trail-complete': 'trailComplete',
  'badge-earned': 'badge',
  'cosmetic-unlocked': 'unlock',
  'title-earned': 'unlock',
  'mission-approved': 'approved',
  pickup: 'pickup',
  waypoint: 'waypoint',
  travel: 'travel',
};

export interface SoundOptions {
  /** The current Scout's setting. The source of truth: the engine follows it on every event. */
  isEnabled: () => boolean;
  /** The Scout flipped the switch (the HUD button): save the new value. */
  onToggle: (enabled: boolean) => void;
  /** Where the player is, for the ambience when a Scout becomes active. */
  currentZone: () => ZoneId;
  /** The bus to listen to. Defaults to the game bus. */
  bus?: EventBus;
  /** Defaults to the shared engine. */
  engine?: AudioEngine;
  /** Defaults to the real effects on `engine`. */
  sfx?: Sfx;
  /** Defaults to the real ambience on `engine`. */
  ambience?: Ambience;
}

export interface SoundHandle {
  /** The Scout chose on or off: apply it now and tell `onToggle` so it can be saved. */
  setEnabled(enabled: boolean): void;
  /** Flip the setting (what the HUD button calls). Returns the new value. */
  toggle(): boolean;
  /** Stop listening and stop the ambience. */
  dispose(): void;
}

export function initSound(options: SoundOptions): SoundHandle {
  const bus = options.bus ?? events;
  const engine = options.engine ?? getAudioEngine();
  const sfx = options.sfx ?? createSfx(engine);
  const ambience = options.ambience ?? createAmbience(engine);
  const ownsAmbience = options.ambience === undefined;

  /** Make the engine match the Scout's setting. Returns whether sound is on. */
  function sync(): boolean {
    const on = options.isEnabled();
    if (engine.isEnabled() !== on) engine.setEnabled(on);
    return on;
  }

  const unsubscribe = bus.on((event) => {
    const on = sync();
    switch (event.type) {
      case 'profile-active':
        // The new Scout's own setting is already applied by sync(). Start their campfire sounds.
        ambience.setZone(options.currentZone());
        ambience.start();
        return;
      case 'travel':
        ambience.setZone(event.zone);
        break;
      default:
        break;
    }
    const name = SFX_FOR_EVENT[event.type];
    if (name && on) sfx[name]();
  });

  const handle: SoundHandle = {
    setEnabled(enabled) {
      options.onToggle(enabled);
      engine.setEnabled(enabled);
      // A short click confirms that sound is back.
      if (enabled) sfx.tap();
    },
    toggle() {
      const next = !options.isEnabled();
      handle.setEnabled(next);
      return next;
    },
    dispose() {
      unsubscribe();
      if (ownsAmbience) ambience.dispose();
      else ambience.stop();
    },
  };
  return handle;
}
