import { describe, expect, it } from 'vitest';
import { defaultAvatar, fillAvatar } from '../../src/player/avatar/options';
import { migrate } from '../../src/save/migrations';
import { createDefaultSave, createProfile, exportSave, importSave } from '../../src/save/store';
import { SAVE_VERSION, type AvatarConfig, type SaveFile } from '../../src/save/types';
import { validateSave } from '../../src/save/validate';
import { makeProfile } from '../fixtures/profile.fixture';

function saveWith(avatar: Record<string, unknown>): unknown {
  const save: SaveFile = { version: SAVE_VERSION, profiles: [makeProfile()], parent: {} };
  return JSON.parse(JSON.stringify({ ...save, profiles: [{ ...save.profiles[0], avatar }] }));
}

describe('save validation: avatar', () => {
  it('still accepts a v1 save whose avatar has only bodyColor', () => {
    const v1 = saveWith({ bodyColor: '#3d85c6' });
    expect(() => validateSave(v1)).not.toThrow();
    expect(migrate(v1).profiles[0]!.avatar).toEqual({ bodyColor: '#3d85c6' });
  });

  it('accepts a v1 avatar that carried a hat and neckerchief', () => {
    expect(() => validateSave(saveWith({ bodyColor: '#3d85c6', hat: 'cap', neckerchief: '#c63d34' }))).not.toThrow();
  });

  it('accepts a complete new avatar', () => {
    const full: Required<AvatarConfig> = { ...defaultAvatar('bear'), hat: 'scout', glasses: true, backpack: true };
    expect(() => validateSave(saveWith({ ...full }))).not.toThrow();
  });

  it('accepts every new field on its own', () => {
    for (const extra of [
      { build: 'tall' },
      { skin: '#a96e44' },
      { hairStyle: 'braids' },
      { hairColor: '#e46fa8' },
      { eyes: 'star' },
      { shirt: '#c9a877' },
      { legs: 'skort' },
      { legColor: '#1f3557' },
      { shoes: '#f2f2f2' },
      { hatColor: '#7a56b8' },
      { glasses: false },
      { backpack: true },
    ]) {
      expect(() => validateSave(saveWith({ bodyColor: '#3d85c6', ...extra })), JSON.stringify(extra)).not.toThrow();
    }
  });

  it.each([
    ['build', 'giant', /avatar\.build/],
    ['hairStyle', 'mohawk', /avatar\.hairStyle/],
    ['eyes', 'laser', /avatar\.eyes/],
    ['legs', 'kilt', /avatar\.legs/],
    ['skin', 'tan', /avatar\.skin/],
    ['skin', '#12345', /avatar\.skin/],
    ['hairColor', 42, /avatar\.hairColor/],
    ['shirt', 'red', /avatar\.shirt/],
    ['legColor', null, /avatar\.legColor/],
    ['shoes', '#gggggg', /avatar\.shoes/],
    ['hatColor', {}, /avatar\.hatColor/],
    ['neckerchief', 'red', /avatar\.neckerchief/],
    ['glasses', 'yes', /avatar\.glasses/],
    ['backpack', 1, /avatar\.backpack/],
  ])('rejects a bad %s (%j) and names the field', (field, value, message) => {
    expect(() => validateSave(saveWith({ bodyColor: '#3d85c6', [field]: value }))).toThrow(message);
  });

  it('round trips through export and import', () => {
    const save = createDefaultSave();
    const chosen = { ...defaultAvatar('wolf'), hat: 'bucket', hairStyle: 'curly' as const, backpack: true };
    createProfile(save, { name: 'Test Scout', rank: 'wolf', avatar: chosen });
    const back = importSave(exportSave(save));
    expect(back.profiles[0]!.avatar).toEqual(chosen);
  });

  it('a v1 profile loads and fills out to a complete look in the rank colors', () => {
    const loaded = migrate(saveWith({ bodyColor: '#e07a5f' })).profiles[0]!;
    const look = fillAvatar(loaded.avatar, loaded.rank);
    expect(look.shirt).toBe('#e07a5f');
    expect(look.neckerchief).toBe(defaultAvatar(loaded.rank).neckerchief);
    expect(look.hairStyle).toBeDefined();
  });
});
