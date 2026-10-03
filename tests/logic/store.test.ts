import { describe, expect, it } from 'vitest';
import { defaultAvatar } from '../../src/player/avatar/options';
import { applyMigrations, migrate, type MigrationStep } from '../../src/save/migrations';
import {
  createDefaultSave,
  createProfile,
  exportSave,
  getActiveProfile,
  hasPin,
  importSave,
  loadSave,
  memoryStore,
  persistSave,
  setPin,
  UNREADABLE_KEY,
  verifyPin,
  type KeyValueStore,
} from '../../src/save/store';
import { SAVE_VERSION, STORAGE_KEY, type SaveFile } from '../../src/save/types';
import { doneReq, card } from '../fixtures/profile.fixture';

function populatedSave(): SaveFile {
  const save = createDefaultSave();
  const wolf = createProfile(save, { name: 'Test Scout One', rank: 'wolf' });
  wolf.xp = 120;
  wolf.requirements['wolf.test-camp.1'] = doneReq();
  wolf.review['wolf.test-camp.1'] = card(1, '2026-10-06');
  wolf.streak = { current: 3, best: 5, lastTrailDate: '2026-10-02', embers: 1 };
  wolf.sessions.push({
    date: '2026-10-02',
    stops: [{ kind: 'new-step', requirementId: 'wolf.test-camp.1', completed: true }],
    xpEarned: 20,
    durationSec: 150,
  });
  createProfile(save, { name: 'Test Scout Two', rank: 'arrow-of-light' });
  return save;
}

describe('loadSave / persistSave', () => {
  it('returns a fresh default when nothing is stored', () => {
    const save = loadSave(memoryStore());
    expect(save).toEqual({ version: SAVE_VERSION, profiles: [], parent: {} });
  });

  it('returns a default for corrupt JSON and keeps a copy of the bad data', () => {
    const store = memoryStore({ [STORAGE_KEY]: '{not json' });
    expect(loadSave(store)).toEqual(createDefaultSave());
    expect(store.get(UNREADABLE_KEY)).toBe('{not json');
  });

  it('returns a default when the shape is wrong', () => {
    for (const bad of ['null', '[]', '"text"', '{}', '{"version":1}', '{"version":1,"profiles":{},"parent":{}}']) {
      expect(loadSave(memoryStore({ [STORAGE_KEY]: bad }))).toEqual(createDefaultSave());
    }
    const broken = populatedSave();
    (broken.profiles[0] as unknown as { xp: string }).xp = 'lots';
    expect(loadSave(memoryStore({ [STORAGE_KEY]: JSON.stringify(broken) }))).toEqual(createDefaultSave());
  });

  it('returns a default when the store itself throws', () => {
    const exploding: KeyValueStore = {
      get() {
        throw new Error('blocked');
      },
      set() {
        throw new Error('blocked');
      },
    };
    expect(loadSave(exploding)).toEqual(createDefaultSave());
  });

  it('round trips a save through the store', () => {
    const store = memoryStore();
    const save = populatedSave();
    expect(persistSave(store, save)).toBe(true);
    expect(loadSave(store)).toEqual(save);
    expect(store.get(STORAGE_KEY)).not.toBeNull();
  });

  it('reports a failed write instead of throwing', () => {
    const full: KeyValueStore = {
      get: () => null,
      set() {
        throw new Error('quota');
      },
    };
    expect(persistSave(full, createDefaultSave())).toBe(false);
  });
});

describe('exportSave / importSave', () => {
  it('exports pretty JSON that imports back to the same save', () => {
    const save = populatedSave();
    const json = exportSave(save);
    expect(json).toContain('\n  "profiles"');
    expect(importSave(json)).toEqual(save);
  });

  it('throws readable errors on bad input', () => {
    expect(() => importSave('')).toThrow(/not a Trail Quest save/);
    expect(() => importSave('{oops')).toThrow(/could not be read as JSON/);
    expect(() => importSave('[]')).toThrow(/not a usable Trail Quest save/);
    expect(() => importSave('{"profiles":[]}')).toThrow(/version/);
    expect(() => importSave(JSON.stringify({ version: 99, profiles: [], parent: {} }))).toThrow(
      /newer version/,
    );
    const broken = populatedSave();
    (broken.profiles[0] as unknown as { rank: string }).rank = 'dragon';
    expect(() => importSave(JSON.stringify(broken))).toThrow(/profiles\[0\]\.rank/);
  });
});

describe('createProfile / getActiveProfile', () => {
  it('fills in defaults, adds the profile and makes it active', () => {
    const save = createDefaultSave();
    const profile = createProfile(save, { name: '  Test Scout  ', rank: 'wolf' });
    expect(save.profiles).toEqual([profile]);
    expect(save.activeProfileId).toBe(profile.id);
    expect(getActiveProfile(save)).toBe(profile);
    expect(profile).toMatchObject({
      name: 'Test Scout',
      rank: 'wolf',
      guideName: 'Den Chief',
      readAloud: true,
      xp: 0,
      streak: { current: 0, best: 0, embers: 0 },
      requirements: {},
      adventures: {},
      review: {},
      sessions: [],
      unlocks: [],
    });
    expect(profile.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(profile.avatar.bodyColor).toMatch(/^#[0-9a-f]{6}$/i);
    expect(Number.isNaN(Date.parse(profile.createdAt))).toBe(false);
  });

  it('reads aloud by default only for wolf, and honors overrides', () => {
    const save = createDefaultSave();
    expect(createProfile(save, { name: 'A', rank: 'arrow-of-light' }).readAloud).toBe(false);
    expect(createProfile(save, { name: 'B', rank: 'arrow-of-light', readAloud: true }).readAloud).toBe(true);
    expect(createProfile(save, { name: 'C', rank: 'wolf', readAloud: false }).readAloud).toBe(false);
    expect(createProfile(save, { name: 'D', rank: 'wolf', guideName: 'Captain Test' }).guideName).toBe(
      'Captain Test',
    );
  });

  it('gives each profile a unique id', () => {
    const save = createDefaultSave();
    const a = createProfile(save, { name: 'A', rank: 'wolf' });
    const b = createProfile(save, { name: 'B', rank: 'wolf' });
    expect(a.id).not.toBe(b.id);
    expect(save.activeProfileId).toBe(b.id);
  });

  it("starts from the rank's uniform look, or from the avatar the editor chose", () => {
    const save = createDefaultSave();
    const wolf = createProfile(save, { name: 'A', rank: 'wolf' });
    expect(wolf.avatar).toEqual(defaultAvatar('wolf'));
    expect(createProfile(save, { name: 'B', rank: 'lion' }).avatar.neckerchief).toBe(defaultAvatar('lion').neckerchief);

    const chosen = createProfile(save, {
      name: 'C',
      rank: 'bear',
      avatar: { ...defaultAvatar('bear'), hat: 'cap', hairStyle: 'braids', glasses: true },
    });
    expect(chosen.avatar).toMatchObject({ hat: 'cap', hairStyle: 'braids', glasses: true });
    // A partial avatar is filled in, so the save never holds half a look.
    const partial = createProfile(save, { name: 'D', rank: 'webelos', avatar: { bodyColor: '#e07a5f', hat: 'beanie' } });
    expect(partial.avatar).toEqual({ ...defaultAvatar('webelos'), bodyColor: '#e07a5f', shirt: '#e07a5f', hat: 'beanie' });
    // And it survives a save and load.
    expect(importSave(exportSave(save)).profiles[3]!.avatar).toEqual(partial.avatar);
  });

  it('rejects an empty name and has no active profile on an empty save', () => {
    const save = createDefaultSave();
    expect(() => createProfile(save, { name: '   ', rank: 'wolf' })).toThrow(/name/);
    expect(save.profiles).toEqual([]);
    expect(getActiveProfile(save)).toBeUndefined();
  });
});

describe('parent PIN', () => {
  it('sets a salted SHA-256 hash and verifies the right PIN only', async () => {
    const save = createDefaultSave();
    expect(hasPin(save)).toBe(false);
    expect(await verifyPin(save, '1234')).toBe(false);

    await setPin(save, '1234');
    expect(hasPin(save)).toBe(true);
    expect(save.parent.pinSalt).toMatch(/^[0-9a-f]{32}$/);
    expect(save.parent.pinHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(save)).not.toContain('1234');

    expect(await verifyPin(save, '1234')).toBe(true);
    expect(await verifyPin(save, '1235')).toBe(false);
    expect(await verifyPin(save, '')).toBe(false);
    expect(await verifyPin(save, '12345')).toBe(false);
  });

  it('hashes SHA-256 over salt:pin', async () => {
    const save = createDefaultSave();
    await setPin(save, '0420');
    const bytes = new TextEncoder().encode(`${save.parent.pinSalt}:0420`);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    const hex = Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
    expect(save.parent.pinHash).toBe(hex);
  });

  it('uses a fresh salt each time', async () => {
    const save = createDefaultSave();
    await setPin(save, '1234');
    const first = { ...save.parent };
    await setPin(save, '1234');
    expect(save.parent.pinSalt).not.toBe(first.pinSalt);
    expect(save.parent.pinHash).not.toBe(first.pinHash);
    expect(await verifyPin(save, '1234')).toBe(true);
  });

  it('rejects anything that is not exactly 4 digits and leaves the PIN unchanged', async () => {
    const save = createDefaultSave();
    for (const bad of ['', '123', '12345', 'abcd', '12a4', ' 123', '1 34', '12.4', '١٢٣٤']) {
      await expect(setPin(save, bad)).rejects.toThrow(/4 digits/);
    }
    expect(hasPin(save)).toBe(false);
    await setPin(save, '9999');
    await expect(setPin(save, 'nope')).rejects.toThrow();
    expect(await verifyPin(save, '9999')).toBe(true);
  });

  it('survives export and import', async () => {
    const save = createDefaultSave();
    await setPin(save, '2468');
    const restored = importSave(exportSave(save));
    expect(await verifyPin(restored, '2468')).toBe(true);
    expect(await verifyPin(restored, '8642')).toBe(false);
  });
});

describe('migrations', () => {
  it('accepts a current-version save unchanged', () => {
    const save = populatedSave();
    expect(migrate(JSON.parse(JSON.stringify(save)))).toEqual(save);
  });

  it('runs steps in order, stamping each new version', () => {
    const steps: Record<number, MigrationStep> = {
      1: (data) => ({ ...data, a: 'one' }),
      2: (data) => ({ ...data, b: `${String(data.a)}-two` }),
    };
    const out = applyMigrations({ version: 1 }, 1, 3, steps);
    expect(out).toEqual({ version: 3, a: 'one', b: 'one-two' });
    expect(applyMigrations({ version: 2, a: 'x' }, 2, 3, steps)).toMatchObject({ version: 3, b: 'x-two' });
  });

  it('does not change data when already at the target version', () => {
    const data = { version: 2, keep: true };
    expect(applyMigrations(data, 2, 2, {})).toBe(data);
  });

  it('fails clearly when a step is missing', () => {
    expect(() => applyMigrations({ version: 1 }, 1, 2, {})).toThrow(/no step from version 1/);
  });

  it('rejects saves with no usable version', () => {
    expect(() => migrate({ profiles: [], parent: {} })).toThrow(/version/);
    expect(() => migrate({ version: 0, profiles: [], parent: {} })).toThrow(/version/);
    expect(() => migrate({ version: '1', profiles: [], parent: {} })).toThrow(/version/);
    expect(() => migrate(null)).toThrow();
  });
});
