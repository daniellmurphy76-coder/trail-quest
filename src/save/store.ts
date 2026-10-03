/**
 * Save storage: profiles, persistence, export/import, parent PIN.
 * Everything goes through an injectable KeyValueStore so tests never touch localStorage.
 */
import type { RankId } from '../activities/types';
import { listRankContent } from '../content/load';
import { defaultAvatar, fillAvatar, RANK_IDS } from '../player/avatar/options';
import { migrate } from './migrations';
import { SAVE_VERSION, STORAGE_KEY, type AvatarConfig, type Profile, type SaveFile } from './types';

export interface KeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

/** Browser storage. Reads never throw (blocked storage reads as empty); writes may throw. */
export function localStorageStore(): KeyValueStore {
  return {
    get(key) {
      try {
        return globalThis.localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    set(key, value) {
      globalThis.localStorage.setItem(key, value);
    },
  };
}

/** In-memory store for tests. */
export function memoryStore(initial: Record<string, string> = {}): KeyValueStore {
  const data = new Map<string, string>(Object.entries(initial));
  return {
    get: (key) => data.get(key) ?? null,
    set: (key, value) => {
      data.set(key, value);
    },
  };
}

export function createDefaultSave(): SaveFile {
  return { version: SAVE_VERSION, profiles: [], parent: {} };
}

/** Where unreadable save data is copied before a fresh default replaces it. */
export const UNREADABLE_KEY = `${STORAGE_KEY}.unreadable`;

/**
 * Load the save. Returns a fresh default when nothing is stored or the stored data cannot
 * be read. Unreadable data is copied to UNREADABLE_KEY first so it is not lost.
 */
export function loadSave(store: KeyValueStore): SaveFile {
  let raw: string | null;
  try {
    raw = store.get(STORAGE_KEY);
  } catch {
    return createDefaultSave();
  }
  if (raw === null) return createDefaultSave();
  try {
    return migrate(JSON.parse(raw));
  } catch {
    try {
      store.set(UNREADABLE_KEY, raw);
    } catch {
      // Nothing more to do; the default save is still returned.
    }
    return createDefaultSave();
  }
}

/** Write the save. Returns false (instead of throwing) if the browser refused the write. */
export function persistSave(store: KeyValueStore, save: SaveFile): boolean {
  try {
    store.set(STORAGE_KEY, JSON.stringify(save));
    return true;
  } catch {
    return false;
  }
}

export function exportSave(save: SaveFile): string {
  return JSON.stringify(save, null, 2);
}

/** Parse and validate an exported save. Throws an Error with a message safe to show a parent. */
export function importSave(json: string): SaveFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('That file is not a Trail Quest save. It could not be read as JSON.');
  }
  try {
    return migrate(parsed);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Unknown problem.';
    throw new Error(`That file is not a usable Trail Quest save. ${reason}`);
  }
}

export interface NewProfileOptions {
  name: string;
  rank: RankId;
  guideName?: string;
  readAloud?: boolean;
  /** The Scout's look from the avatar editor. Omit for the rank's default uniform look. */
  avatar?: AvatarConfig;
}

/** Create a profile, add it to the save (mutating it) and make it the active profile. */
export function createProfile(save: SaveFile, options: NewProfileOptions): Profile {
  const name = options.name.trim();
  if (name === '') throw new Error('A profile needs a name.');
  const profile: Profile = {
    id: globalThis.crypto.randomUUID(),
    name,
    rank: options.rank,
    guideName: options.guideName?.trim() || 'Den Chief',
    readAloud: options.readAloud ?? options.rank === 'wolf',
    createdAt: new Date().toISOString(),
    avatar: options.avatar ? fillAvatar(options.avatar, options.rank) : defaultAvatar(options.rank),
    xp: 0,
    streak: { current: 0, best: 0, embers: 0 },
    requirements: {},
    adventures: {},
    review: {},
    sessions: [],
    unlocks: [],
  };
  save.profiles.push(profile);
  save.activeProfileId = profile.id;
  return profile;
}

export function getActiveProfile(save: SaveFile): Profile | undefined {
  return save.profiles.find((profile) => profile.id === save.activeProfileId);
}

// ---- Parent tools: reset, remove, move up a rank ----------------------------------------------------

/** The rank after `rank` in program order (Lion, Tiger, Wolf, Bear, Webelos, Arrow of Light), if any. */
export function nextRank(rank: RankId): RankId | undefined {
  const index = RANK_IDS.indexOf(rank);
  return index >= 0 ? RANK_IDS[index + 1] : undefined;
}

/**
 * Start the Scout over. XP, streak, requirement progress, review cards, finished adventures,
 * sessions and every unlock (badges and the cosmetics they opened) go. Name, rank, guide, look
 * and the sound setting stay. Returns a new profile; the input is not changed.
 */
export function resetProgress(profile: Profile): Profile {
  return {
    ...profile,
    xp: 0,
    streak: { current: 0, best: 0, embers: 0 },
    requirements: {},
    adventures: {},
    review: {},
    sessions: [],
    unlocks: [],
  };
}

/**
 * Delete a profile from the save (mutating it). If it was the active profile, the active id is
 * cleared so the caller can send the player back to the picker. `removed` is false when there was
 * no such profile.
 */
export function removeProfile(save: SaveFile, id: string): { removed: boolean; wasActive: boolean } {
  const index = save.profiles.findIndex((profile) => profile.id === id);
  if (index < 0) return { removed: false, wasActive: false };
  save.profiles.splice(index, 1);
  const wasActive = save.activeProfileId === id;
  if (wasActive) delete save.activeProfileId;
  return { removed: true, wasActive };
}

/**
 * Move a Scout up to a later rank. The look stays; the neckerchief follows the new rank only if it
 * is still the old rank's default color. Progress stays too: requirement ids start with the rank,
 * so the old rank's progress is kept and never mixes with the new rank's. Returns a new profile.
 * Throws a message safe to show a parent when `next` is not a later rank or has no content yet
 * (`hasContent` defaults to the bundled rank files).
 */
export function promoteRank(
  profile: Profile,
  next: RankId,
  hasContent: (rank: RankId) => boolean = (rank) => listRankContent().some((content) => content.rank === rank),
): Profile {
  if (RANK_IDS.indexOf(next) <= RANK_IDS.indexOf(profile.rank)) {
    throw new Error(`${profile.name} cannot move back to an earlier rank.`);
  }
  if (!hasContent(next)) throw new Error('There are no adventures for that rank in the game yet.');
  const oldDefault = defaultAvatar(profile.rank).neckerchief.toLowerCase();
  const stillDefault = profile.avatar.neckerchief?.toLowerCase() === oldDefault;
  return {
    ...profile,
    rank: next,
    avatar: stillDefault ? { ...profile.avatar, neckerchief: defaultAvatar(next).neckerchief } : { ...profile.avatar },
  };
}

const PIN_PATTERN = /^\d{4}$/;

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function hashPin(salt: string, pin: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('The parent PIN needs a secure page (https or localhost).');
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${pin}`));
  return toHex(new Uint8Array(digest));
}

export function hasPin(save: SaveFile): boolean {
  return save.parent.pinHash !== undefined && save.parent.pinSalt !== undefined;
}

/** Set the parent PIN (mutating save.parent). Rejects unless the PIN is exactly 4 digits. */
export async function setPin(save: SaveFile, pin: string): Promise<void> {
  if (!PIN_PATTERN.test(pin)) throw new Error('The PIN must be exactly 4 digits.');
  const salt = toHex(globalThis.crypto.getRandomValues(new Uint8Array(16)));
  const hash = await hashPin(salt, pin);
  save.parent.pinSalt = salt;
  save.parent.pinHash = hash;
}

/** True when the PIN matches. False if no PIN is set or the PIN is malformed. */
export async function verifyPin(save: SaveFile, pin: string): Promise<boolean> {
  const { pinHash, pinSalt } = save.parent;
  if (pinHash === undefined || pinSalt === undefined) return false;
  if (!PIN_PATTERN.test(pin)) return false;
  const attempt = await hashPin(pinSalt, pin);
  if (attempt.length !== pinHash.length) return false;
  let diff = 0;
  for (let i = 0; i < attempt.length; i++) diff |= attempt.charCodeAt(i) ^ pinHash.charCodeAt(i);
  return diff === 0;
}
