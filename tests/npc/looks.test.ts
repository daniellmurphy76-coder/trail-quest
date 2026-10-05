import * as THREE from 'three';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GUIDES, type GuideId } from '../../src/npc/guide-types';
import { createGuideRig, GUIDE_GEAR, GUIDE_LOOKS, guideLabelHeight } from '../../src/npc/looks';
import { resetBlockyModel, useBlockyModel, type BlockyAsset } from '../../src/player/avatar/blocky/model';
import { GEAR_COLORS } from '../../src/player/avatar/npc-gear';
import { buildTorsoGeometry } from '../../src/player/avatar/parts';
import {
  defaultAvatar,
  fillAvatar,
  HAIR_COLORS,
  HAT_STYLES,
  SKIN_TONES,
  type FilledAvatar,
} from '../../src/player/avatar/options';
import { DEN_CHIEF_AVATAR } from '../../src/player/avatar/presets';
import { buildAvatar, type AvatarRig } from '../../src/player/avatar/rig';
import { loadModel } from '../player/model-file';

let model: BlockyAsset;
beforeAll(async () => {
  model = await loadModel();
});
beforeEach(() => resetBlockyModel());
afterEach(() => resetBlockyModel());

const IDS: readonly GuideId[] = GUIDES.map((g) => g.id);
const SLIDE = '#c9a46a'; // the neckerchief slide: only a Scout wears one

const meshes = (root: THREE.Object3D): THREE.Mesh[] => {
  const found: THREE.Mesh[] = [];
  root.traverseVisible((o) => {
    if ((o as THREE.Mesh).isMesh) found.push(o as THREE.Mesh);
  });
  return found;
};

/** A guide, wearing the Kenney Scout model. */
function modelGuide(id: GuideId): AvatarRig {
  useBlockyModel(model);
  return createGuideRig(id);
}

/** A guide as the plain Scout, which is what shows until the model loads. */
function plainGuide(id: GuideId): AvatarRig {
  resetBlockyModel();
  return createGuideRig(id);
}

function top(rig: AvatarRig): number {
  rig.root.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(rig.root).max.y;
}

function painted(g: THREE.BufferGeometry, hex: string): number {
  const want = new THREE.Color(hex);
  const colors = g.getAttribute('color');
  let n = 0;
  for (let i = 0; i < colors.count; i++) {
    if (Math.abs(colors.getX(i) - want.r) + Math.abs(colors.getY(i) - want.g) + Math.abs(colors.getZ(i) - want.b) < 0.01) n++;
  }
  return n;
}

describe('guide looks', () => {
  it('has a look and gear for every guide, and nothing else', () => {
    expect(Object.keys(GUIDE_LOOKS).sort()).toEqual([...IDS].sort());
    expect(Object.keys(GUIDE_GEAR).sort()).toEqual([...IDS].sort());
  });

  it('every look is a complete, valid look: nothing for fillAvatar to fix, a hat from the kid list, colors from the palettes', () => {
    for (const id of IDS) {
      const look = GUIDE_LOOKS[id];
      expect(fillAvatar(look), id).toEqual(look);
      expect(HAT_STYLES.map((c) => c.value), id).toContain(look.hat);
      expect(SKIN_TONES.map((c) => c.value), id).toContain(look.skin);
      expect(HAIR_COLORS.map((c) => c.value), id).toContain(look.hairColor);
      expect(look.backpack, id).toBe(false);
    }
  });

  it('gives each guide a thing to read from across the zone', () => {
    expect(GUIDE_LOOKS.coach.hat).toBe('cap');
    expect(GUIDE_LOOKS.coach.legs).toBe('shorts');
    expect(GUIDE_GEAR.coach.torso).toEqual(['whistle']);
    expect(GUIDE_LOOKS.ranger.hat).toBe('scout');
    expect(GUIDE_GEAR.ranger.torso).toEqual(['badge']);
    expect(GUIDE_GEAR.mayor.torso).toEqual(['sash']);
    expect(GUIDE_LOOKS.mayor.hat).toBe('none');
    expect(GUIDE_GEAR.firefighter.headgear).toBe('fire-helmet');
    expect(GUIDE_GEAR.firefighter.torso).toEqual(['reflective-stripes']);
    expect(GUIDE_GEAR['camp-cook'].headgear).toBe('chef-hat');
    expect(GUIDE_GEAR['camp-cook'].torso).toEqual(['apron']);
    // A white apron needs a shirt that is not white.
    expect(GUIDE_LOOKS['camp-cook'].shirt).not.toBe('#f2f2f2');
  });

  it('the five are different from each other and from the Den Chief, at a glance', () => {
    const everyone: Array<[string, Readonly<FilledAvatar>, string]> = [
      ...IDS.map((id): [string, Readonly<FilledAvatar>, string] => [id, GUIDE_LOOKS[id], GUIDE_GEAR[id].headgear ?? `${GUIDE_LOOKS[id].hat}:${GUIDE_LOOKS[id].hatColor}`]),
      ['den-chief', DEN_CHIEF_AVATAR, `${DEN_CHIEF_AVATAR.hat}:${DEN_CHIEF_AVATAR.hatColor}`],
    ];
    // What you see first: the shirt and the headwear. Nobody shares either.
    expect(new Set(everyone.map(([, look]) => look.shirt)).size).toBe(everyone.length);
    expect(new Set(everyone.map(([, , headwear]) => headwear)).size).toBe(everyone.length);
    const fields = Object.keys(defaultAvatar('wolf')) as Array<keyof FilledAvatar>;
    for (let a = 0; a < everyone.length; a++) {
      for (let b = a + 1; b < everyone.length; b++) {
        const [nameA, lookA] = everyone[a]!;
        const [nameB, lookB] = everyone[b]!;
        const differing = fields.filter((field) => lookA[field] !== lookB[field]);
        expect(differing.length, `${nameA} and ${nameB} differ in ${differing.join(', ')}`).toBeGreaterThanOrEqual(7);
      }
    }
  });

  it('spans skin tones, hair styles and builds, with grown-ups mostly tall', () => {
    const looks = IDS.map((id) => GUIDE_LOOKS[id]);
    expect(new Set(looks.map((l) => l.skin)).size).toBe(5); // every guide a different tone
    expect(new Set(looks.map((l) => l.skin)).has(DEN_CHIEF_AVATAR.skin)).toBe(false);
    expect(new Set(looks.map((l) => l.hairStyle)).size).toBeGreaterThanOrEqual(4);
    expect(new Set(looks.map((l) => l.build)).size).toBeGreaterThanOrEqual(2);
    expect(looks.filter((l) => l.build === 'tall').length).toBeGreaterThanOrEqual(3);
    expect(looks.filter((l) => l.build === 'small')).toHaveLength(0);
  });

  it('is only looks: the same fields as a Scout, and no field for gender', () => {
    for (const id of IDS) expect(Object.keys(GUIDE_LOOKS[id]).sort(), id).toEqual(Object.keys(defaultAvatar('wolf')).sort());
  });
});

describe('guide gear', () => {
  it('no guide wears a neckerchief: no collar, no slide, in either Scout', () => {
    for (const id of IDS) {
      expect(GUIDE_GEAR[id].neckerchief, id).toBe(false);
      const kit = modelGuide(id);
      const attachments = kit.root.getObjectByName('torso-attachments') as THREE.Mesh | null;
      if (attachments) expect(painted(attachments.geometry, SLIDE), id).toBe(0);
      const plain = buildTorsoGeometry(GUIDE_LOOKS[id], { npcGear: GUIDE_GEAR[id] });
      expect(painted(plain, SLIDE), id).toBe(0);
    }
    // A Scout does, so the check means something.
    useBlockyModel(model);
    const scout = buildAvatar(defaultAvatar('wolf'));
    expect(painted((scout.root.getObjectByName('torso-attachments') as THREE.Mesh).geometry, SLIDE)).toBeGreaterThan(0);
  });

  it('every guide wears its gear in the Kenney Scout: the helmet and the cook hat on the head, the rest on the torso', () => {
    const onHead = (id: GuideId): THREE.Mesh | null => modelGuide(id).root.getObjectByName('head-attachments') as THREE.Mesh | null;
    const onTorso = (id: GuideId): THREE.Mesh => modelGuide(id).root.getObjectByName('torso-attachments') as THREE.Mesh;
    expect(painted(onHead('firefighter')!.geometry, GEAR_COLORS.gold)).toBeGreaterThan(10);
    expect(painted(onHead('firefighter')!.geometry, GUIDE_LOOKS.firefighter.hatColor)).toBeGreaterThan(40);
    expect(painted(onHead('camp-cook')!.geometry, GUIDE_LOOKS['camp-cook'].hatColor)).toBeGreaterThan(100);
    expect(painted(onTorso('firefighter').geometry, GEAR_COLORS.reflective)).toBeGreaterThan(40);
    expect(painted(onTorso('coach').geometry, GEAR_COLORS.silver)).toBeGreaterThan(20);
    expect(painted(onTorso('ranger').geometry, GEAR_COLORS.gold)).toBeGreaterThan(10);
    expect(painted(onTorso('mayor').geometry, GUIDE_LOOKS.mayor.neckerchief)).toBeGreaterThan(40); // the sash
    expect(painted(onTorso('camp-cook').geometry, GUIDE_LOOKS['camp-cook'].neckerchief)).toBeGreaterThan(40); // the apron
    // The grown-ups' gear is theirs alone.
    expect(painted(onTorso('ranger').geometry, GEAR_COLORS.reflective)).toBe(0);
    expect(painted(onTorso('mayor').geometry, GEAR_COLORS.silver)).toBe(0);
  });
});

describe('createGuideRig', () => {
  it('names the root guide-<id>', () => {
    for (const id of IDS) expect(modelGuide(id).root.name).toBe(`guide-${id}`);
  });

  it('wears the Kenney Scout when it is loaded, the plain Scout before that, and neither throws or animates wrongly', () => {
    for (const id of IDS) {
      const kit = modelGuide(id);
      expect(kit.root.getObjectByName('avatar-blocky'), id).toBeDefined();
      const plain = plainGuide(id);
      expect(plain.root.getObjectByName('avatar-fallback'), id).toBeDefined();
      for (const rig of [kit, plain]) {
        expect(rig.config).toEqual(GUIDE_LOOKS[id]);
        rig.play('wave');
        rig.update(0.4, { moving: false, speed: 0 });
        rig.play('idle');
        for (let i = 0; i < 60; i++) rig.update(1 / 60, { moving: false, speed: 0 });
        expect(Number.isFinite(top(rig))).toBe(true);
        expect(top(rig)).toBeGreaterThan(1.5);
        rig.dispose();
      }
    }
  });

  it('costs the same draw calls as a Scout, in both Scouts: gear is merged into the attachment meshes', () => {
    useBlockyModel(model);
    const hatted = buildAvatar({ ...defaultAvatar('wolf'), hat: 'cap' });
    for (const id of IDS) {
      const rig = modelGuide(id);
      expect(meshes(rig.root), id).toHaveLength(meshes(hatted.root).length);
      expect(meshes(rig.root), id).toHaveLength(9);
      expect(meshes(rig.root).map((m) => m.name).sort(), id).toEqual(meshes(hatted.root).map((m) => m.name).sort());
    }
    resetBlockyModel();
    const plainScout = buildAvatar({ ...defaultAvatar('wolf'), hat: 'cap' });
    for (const id of IDS) expect(meshes(plainGuide(id).root), id).toHaveLength(meshes(plainScout.root).length);
    expect(meshes(plainScout.root)).toHaveLength(7);
  });

  it('builds a new rig each time, with its own geometry', () => {
    const a = modelGuide('mayor');
    const b = modelGuide('mayor');
    expect(a.root).not.toBe(b.root);
    expect((a.root.getObjectByName('torso-attachments') as THREE.Mesh).geometry).not.toBe((b.root.getObjectByName('torso-attachments') as THREE.Mesh).geometry);
  });
});

describe('guideLabelHeight', () => {
  it('is at least 2.3, and exactly 2.3 for a guide whose head is well under it', () => {
    for (const id of IDS) expect(guideLabelHeight(id), id).toBeGreaterThanOrEqual(2.3);
    expect(guideLabelHeight('coach')).toBe(2.3);
  });

  it.each(IDS)('%s: the tag floats at least 0.25 above the highest vertex, in both Scouts', (id) => {
    for (const rig of [modelGuide(id), plainGuide(id)]) {
      expect(guideLabelHeight(id) - top(rig), id).toBeGreaterThanOrEqual(0.25 - 1e-6);
    }
  });

  it.each(IDS)('%s: and no higher than it needs to be', (id) => {
    const highest = Math.max(top(modelGuide(id)), top(plainGuide(id)));
    const height = guideLabelHeight(id);
    if (height > 2.3) expect(height - highest, id).toBeLessThan(0.3);
  });

  it('the tall chef hat lifts the Camp Cook\'s tag above the default, and the cook is a regular build', () => {
    expect(GUIDE_LOOKS['camp-cook'].build).toBe('regular');
    expect(guideLabelHeight('camp-cook')).toBeGreaterThan(2.3);
    // The same cook without the hat would not need it.
    useBlockyModel(model);
    const withoutHat = buildAvatar(GUIDE_LOOKS['camp-cook'], { npcGear: { torso: ['apron'], neckerchief: false } });
    expect(guideLabelHeight('camp-cook')).toBeGreaterThan(top(withoutHat) + 0.25 + 0.1);
  });

  it('is the same number every time (it is worked out once)', () => {
    for (const id of IDS) expect(guideLabelHeight(id)).toBe(guideLabelHeight(id));
  });
});
