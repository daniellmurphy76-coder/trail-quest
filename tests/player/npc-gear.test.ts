import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildHeadAttachments, buildTorsoAttachments } from '../../src/player/avatar/blocky/attachments';
import { resetBlockyModel, useBlockyModel, type BlockyAsset } from '../../src/player/avatar/blocky/model';
import { avatarTopHeight } from '../../src/player/avatar/height';
import { GEAR_COLORS, NPC_HEADGEAR, NPC_TORSO_GEAR } from '../../src/player/avatar/npc-gear';
import {
  BUILDS,
  COSMETIC_LOCKS,
  defaultAvatar,
  EYE_STYLES,
  fillAvatar,
  HAIR_STYLES,
  HAT_STYLES,
  LEG_STYLES,
  randomAvatar,
  type FilledAvatar,
} from '../../src/player/avatar/options';
import { buildHeadGeometry, buildTorsoGeometry } from '../../src/player/avatar/parts';
import { buildAvatar, type AvatarRig, type NpcGear } from '../../src/player/avatar/rig';
import { loadModel } from './model-file';

let model: BlockyAsset;
beforeAll(async () => {
  model = await loadModel();
});
beforeEach(() => resetBlockyModel());
afterEach(() => resetBlockyModel());

const look = (patch: Partial<FilledAvatar> = {}): FilledAvatar => fillAvatar({ ...defaultAvatar('wolf'), ...patch });

const box = (g: THREE.BufferGeometry): THREE.Box3 => {
  g.computeBoundingBox();
  return g.boundingBox!.clone();
};
const vertices = (g: THREE.BufferGeometry): number => g.getAttribute('position').count;

function finite(g: THREE.BufferGeometry): void {
  for (const name of ['position', 'normal', 'color']) {
    const attribute = g.getAttribute(name);
    expect(attribute, name).toBeDefined();
    for (const v of attribute.array) expect(Number.isFinite(v)).toBe(true);
  }
}

/** The indexes of the vertices painted `hex`. */
function paintedAt(g: THREE.BufferGeometry, hex: string): number[] {
  const want = new THREE.Color(hex);
  const colors = g.getAttribute('color');
  const found: number[] = [];
  for (let i = 0; i < colors.count; i++) {
    if (Math.abs(colors.getX(i) - want.r) + Math.abs(colors.getY(i) - want.g) + Math.abs(colors.getZ(i) - want.b) < 0.01) found.push(i);
  }
  return found;
}
const painted = (g: THREE.BufferGeometry, hex: string): number => paintedAt(g, hex).length;

/** The box around the vertices painted `hex`. */
function boxOf(g: THREE.BufferGeometry, hex: string): THREE.Box3 {
  const pos = g.getAttribute('position');
  const b = new THREE.Box3();
  for (const i of paintedAt(g, hex)) b.expandByPoint(new THREE.Vector3().fromBufferAttribute(pos, i));
  return b;
}

const shaded = (hex: string, factor: number): string => `#${new THREE.Color(hex).multiplyScalar(factor).getHexString()}`;
const SLIDE = '#c9a46a'; // the neckerchief slide: only a Scout wears one
const CORD = '#f2c230'; // the Den Chief cord

const head = (patch: Partial<FilledAvatar>, gear?: NpcGear): THREE.BufferGeometry | null =>
  buildHeadAttachments(look({ hairStyle: 'none', hat: 'none', glasses: false, ...patch }), { npcGear: gear });
const torso = (gear?: NpcGear, patch: Partial<FilledAvatar> = {}): THREE.BufferGeometry => buildTorsoAttachments(look(patch), { npcGear: gear });
const bare = (pieces: NpcGear['torso'], accent?: string, patch: Partial<FilledAvatar> = {}): THREE.BufferGeometry =>
  torso({ torso: pieces, neckerchief: false, accent }, patch);

describe('guide gear: headgear on the Kenney Scout', () => {
  it('lists the two kinds', () => {
    expect([...NPC_HEADGEAR].sort()).toEqual(['chef-hat', 'fire-helmet']);
  });

  it.each(NPC_HEADGEAR)('%s is drawn only when asked, in the look\'s hat color', (headgear) => {
    expect(head({ hatColor: '#2f5fa8' })).toBeNull();
    const g = head({ hatColor: '#2f5fa8' }, { headgear })!;
    expect(g).not.toBeNull();
    finite(g);
    expect(vertices(g)).toBeGreaterThan(100);
    expect(vertices(g)).toBeLessThan(1500);
    expect(painted(g, '#2f5fa8')).toBeGreaterThan(40);
    const other = head({ hatColor: '#c63d34' }, { headgear })!;
    expect(painted(other, '#c63d34')).toBeGreaterThan(40);
    expect(painted(other, '#2f5fa8')).toBe(0);
  });

  it.each(NPC_HEADGEAR)('%s takes the place of whatever hat the look names', (headgear) => {
    const reference = head({ hat: 'none' }, { headgear })!;
    for (const hat of HAT_STYLES.map((c) => c.value)) {
      const g = head({ hat }, { headgear })!;
      expect(vertices(g), hat).toBe(vertices(reference));
      expect(Array.from(g.getAttribute('position').array), hat).toEqual(Array.from(reference.getAttribute('position').array));
    }
  });

  it.each(NPC_HEADGEAR)('%s sheds the top of the hair, keeps the glasses, and stays near the head', (headgear) => {
    const hairColor = '#e6c36a';
    const gear = { headgear };
    const g = head({ hairStyle: 'spiky', hairColor }, gear)!;
    expect(Math.max(-Infinity, ...paintedAt(g, hairColor).map((i) => g.getAttribute('position').getY(i)))).toBeLessThanOrEqual(0.81);
    expect(vertices(head({ glasses: true }, gear)!)).toBeGreaterThan(vertices(head({ glasses: false }, gear)!));
    const b = box(g);
    expect(b.min.y).toBeGreaterThanOrEqual(0.5); // sits on the head, no lower than the brim
    expect(b.max.x - b.min.x).toBeGreaterThan(0.85); // wider than the 0.8 head
    expect(b.max.y).toBeLessThan(1.5);
  });

  it('the fire helmet is a dome with a wide brim at the back and a gold plate on the front', () => {
    const g = head({ hatColor: '#c63d34' }, { headgear: 'fire-helmet' })!;
    const b = box(g);
    expect(b.max.y).toBeGreaterThan(1.05);
    expect(b.max.y).toBeLessThan(1.15);
    expect(b.min.z).toBeLessThan(-0.85); // the brim sweeps out behind
    expect(b.max.z).toBeGreaterThan(0.6);
    expect(b.max.x).toBeGreaterThan(0.65);
    const plate = boxOf(g, GEAR_COLORS.gold);
    expect(painted(g, GEAR_COLORS.gold)).toBeGreaterThan(10);
    expect(plate.min.z).toBeGreaterThan(0.5); // on the front (+z)
    expect(Math.abs(plate.getCenter(new THREE.Vector3()).x)).toBeLessThan(0.01); // in the middle
    expect(plate.max.y - plate.min.y).toBeGreaterThan(0.25);
    // The brim is a darker red than the dome.
    expect(painted(g, shaded('#c63d34', 0.78))).toBeGreaterThan(20);
    expect(painted(head({ hat: 'cap', hatColor: '#c63d34' })!, GEAR_COLORS.gold)).toBe(0); // a kid's cap has no plate
  });

  it('the chef hat is a white band with a tall, puffy top, taller than any kid hat', () => {
    const g = head({ hatColor: '#f2f2f2' }, { headgear: 'chef-hat' })!;
    const b = box(g);
    expect(b.max.y).toBeGreaterThan(1.3);
    expect(b.max.y).toBeLessThan(1.45); // tall, not silly: under a head's height above the head
    for (const hat of ['cap', 'bucket', 'beanie', 'scout'] as const) {
      expect(b.max.y, hat).toBeGreaterThan(box(head({ hat })!).max.y + 0.1);
    }
    expect(painted(g, shaded('#f2f2f2', 0.9))).toBeGreaterThan(8); // the band
    expect(painted(g, '#f2f2f2')).toBeGreaterThan(100); // the puffs
    expect(b.max.x).toBeGreaterThan(0.45); // the band is wider than the head
    expect(painted(g, GEAR_COLORS.gold)).toBe(0);
  });
});

describe('guide gear: torso pieces on the Kenney Scout', () => {
  it('lists the five kinds', () => {
    expect([...NPC_TORSO_GEAR].sort()).toEqual(['apron', 'badge', 'reflective-stripes', 'sash', 'whistle']);
  });

  it('a Scout with no gear has none of the gear colors', () => {
    for (const patch of [{}, { backpack: true }, { legs: 'skort' as const }]) {
      const g = torso(undefined, patch);
      for (const hex of Object.values(GEAR_COLORS)) expect(painted(g, hex), hex).toBe(0);
    }
    expect(painted(head({ hat: 'cap' })!, GEAR_COLORS.gold)).toBe(0);
  });

  it.each(NPC_TORSO_GEAR)('%s adds shapes to the torso set, all finite, and nothing outside it', (piece) => {
    const plain = torso();
    const g = torso({ torso: [piece] });
    finite(g);
    expect(vertices(g)).toBeGreaterThan(vertices(plain) + 50);
    expect(vertices(g)).toBeLessThan(1000);
    const b = box(g);
    expect(b.min.y).toBeGreaterThan(-0.1); // from the hips up (the sash ends and the apron hang over the thighs)
    expect(b.max.y).toBeLessThan(1.3); // and not above the shoulders
    expect(b.max.x).toBeLessThan(0.5);
    expect(b.min.x).toBeGreaterThan(-0.5);
    expect(b.max.z).toBeLessThan(0.45);
    expect(b.min.z).toBeGreaterThan(-0.4);
  });

  it('a piece asked for twice is drawn once', () => {
    for (const piece of NPC_TORSO_GEAR) expect(vertices(torso({ torso: [piece, piece] }))).toBe(vertices(torso({ torso: [piece] })));
  });

  it('the accent paints the apron, the sash and the whistle cord; without one it is the neckerchief color', () => {
    for (const piece of ['apron', 'sash', 'whistle'] as const) {
      const byDefault = bare([piece], undefined, { neckerchief: '#7a56b8' });
      expect(painted(byDefault, '#7a56b8'), piece).toBeGreaterThan(20);
      const accented = bare([piece], '#ea8a2c', { neckerchief: '#7a56b8' });
      expect(painted(accented, '#ea8a2c'), piece).toBeGreaterThan(20);
      expect(painted(accented, '#7a56b8'), piece).toBe(0);
    }
    // Stripes and the badge have colors of their own.
    for (const piece of ['reflective-stripes', 'badge'] as const) {
      expect(painted(bare([piece], '#ea8a2c', { neckerchief: '#7a56b8' }), '#ea8a2c'), piece).toBe(0);
    }
  });

  it('the apron hangs from the chest to the thighs, with a pocket and straps up to the neck', () => {
    const g = bare(['apron'], '#f2f2f2');
    const b = box(g);
    expect(b.min.y).toBeLessThan(0.15);
    expect(b.max.y).toBeGreaterThan(1.1);
    expect(b.max.z).toBeGreaterThan(0.33); // in front of the chest
    expect(b.max.z).toBeLessThan(0.4);
    expect(b.min.z).toBeLessThan(-0.3); // straps and a tie round the back
    expect(painted(g, shaded('#f2f2f2', 0.88))).toBeGreaterThan(8); // the pocket and the tie
    const panel = boxOf(g, '#f2f2f2');
    expect(panel.max.x - panel.min.x).toBeGreaterThan(0.6); // as wide as the torso, nearly
    expect(panel.max.x - panel.min.x).toBeLessThan(0.8);
  });

  it('the sash runs from the left shoulder to the right hip, front and back, the other way from the cord', () => {
    const g = bare(['sash'], '#ea8a2c');
    const band = boxOf(g, '#ea8a2c');
    expect(band.min.z).toBeLessThan(-0.3);
    expect(band.max.z).toBeGreaterThan(0.33);
    const pos = g.getAttribute('position');
    const front = paintedAt(g, '#ea8a2c').filter((i) => pos.getZ(i) > 0.3);
    const topX = (indexes: number[]): number => pos.getX(indexes.reduce((a, b) => (pos.getY(b) > pos.getY(a) ? b : a)));
    const bottomX = (indexes: number[]): number => pos.getX(indexes.reduce((a, b) => (pos.getY(b) < pos.getY(a) ? b : a)));
    expect(topX(front)).toBeGreaterThan(0.15); // the character's left shoulder is +x
    expect(bottomX(front)).toBeLessThan(-0.15);
    // The Den Chief's cord goes from the right shoulder to the left hip.
    const withCord = buildTorsoAttachments(look(), { denChiefCord: true });
    const cordPos = withCord.getAttribute('position');
    const cordFront = paintedAt(withCord, CORD).filter((i) => cordPos.getZ(i) > 0.3);
    expect(cordFront.length).toBeGreaterThan(8);
    const cordTop = cordFront.reduce((a, b) => (cordPos.getY(b) > cordPos.getY(a) ? b : a));
    expect(cordPos.getX(cordTop)).toBeLessThan(-0.1);
    // Wider than the cord, and it ends in a knot with two tails hanging past the hip.
    expect(painted(g, shaded('#ea8a2c', 0.85))).toBeGreaterThan(20);
    expect(box(g).min.y).toBeLessThan(0.1);
  });

  it('the whistle hangs on a cord loop, a small silver shape on the chest', () => {
    const g = bare(['whistle'], '#f2f2f2');
    const silver = boxOf(g, GEAR_COLORS.silver);
    expect(painted(g, GEAR_COLORS.silver)).toBeGreaterThan(20);
    expect(painted(g, GEAR_COLORS.hole)).toBeGreaterThan(0);
    expect(silver.min.z).toBeGreaterThan(0.29); // on the chest
    expect(silver.max.x - silver.min.x).toBeLessThan(0.35); // small
    expect(silver.max.y - silver.min.y).toBeLessThan(0.2);
    expect(silver.min.y).toBeGreaterThan(0.7);
    expect(silver.max.y).toBeLessThan(0.95);
    // The cord goes round the collar (front, sides and back) and down to the whistle.
    const cord = boxOf(g, '#f2f2f2');
    expect(cord.min.z).toBeLessThan(-0.3);
    expect(cord.max.x).toBeGreaterThan(0.4);
    expect(cord.min.x).toBeLessThan(-0.4);
    expect(cord.min.y).toBeLessThan(0.9);
    expect(cord.max.y).toBeGreaterThan(1.15);
  });

  it('reflective stripes are yellow bands with a silver line, all the way round, at two heights', () => {
    const g = bare(['reflective-stripes']);
    expect(painted(g, GEAR_COLORS.reflective)).toBeGreaterThan(40);
    expect(painted(g, GEAR_COLORS.silver)).toBeGreaterThan(20);
    const tape = boxOf(g, GEAR_COLORS.reflective);
    expect(tape.min.z).toBeLessThan(-0.3);
    expect(tape.max.z).toBeGreaterThan(0.3);
    expect(tape.min.x).toBeLessThan(-0.4);
    expect(tape.max.x).toBeGreaterThan(0.4);
    expect(tape.max.y - tape.min.y).toBeGreaterThan(0.35); // two bands
    // Wider than the torso (0.8 by 0.6), so it never sinks into the shirt.
    expect(tape.max.x - tape.min.x).toBeGreaterThan(0.82);
    expect(tape.max.z - tape.min.z).toBeGreaterThan(0.62);
    const pos = g.getAttribute('position');
    const ys = new Set(paintedAt(g, GEAR_COLORS.reflective).map((i) => Math.round(pos.getY(i) * 10)));
    expect(ys.size).toBeGreaterThanOrEqual(4); // each band has a top and a bottom
  });

  it('the badge is a small gold shape on the left of the chest', () => {
    const g = bare(['badge']);
    const gold = boxOf(g, GEAR_COLORS.gold);
    expect(painted(g, GEAR_COLORS.gold)).toBeGreaterThan(10);
    expect(gold.min.x).toBeGreaterThan(0.05); // the character's left (+x)
    expect(gold.min.z).toBeGreaterThan(0.29); // on the front
    expect(gold.max.x - gold.min.x).toBeLessThan(0.3);
    expect(gold.max.y - gold.min.y).toBeLessThan(0.35);
    expect(gold.min.y).toBeGreaterThan(0.7);
    expect(gold.max.y).toBeLessThan(1.15);
    expect(painted(g, shaded(GEAR_COLORS.gold, 0.7))).toBeGreaterThan(5); // the darker inset
  });
});

describe('guide gear: the neckerchief', () => {
  it('a Scout always wears one: a collar, the ends and a slide', () => {
    const g = torso(undefined, { neckerchief: '#c63d34' });
    expect(painted(g, '#c63d34')).toBeGreaterThan(30);
    expect(painted(g, SLIDE)).toBeGreaterThan(0);
    // Asking for the neckerchief outright, or leaving gear without an opinion, changes nothing.
    expect(vertices(torso({ neckerchief: true }, { neckerchief: '#c63d34' }))).toBe(vertices(g));
    expect(vertices(torso({ torso: [] }, { neckerchief: '#c63d34' }))).toBe(vertices(g));
  });

  it('a guide with neckerchief: false has no collar, no ends and no slide', () => {
    const g = bare(['badge'], undefined, { neckerchief: '#c63d34' });
    expect(painted(g, '#c63d34')).toBe(0);
    expect(painted(g, SLIDE)).toBe(0);
    // Gear that wears the accent still shows it.
    expect(painted(bare(['sash'], undefined, { neckerchief: '#c63d34' }), '#c63d34')).toBeGreaterThan(20);
  });

  it('with no neckerchief and no torso gear there is nothing to draw', () => {
    expect(vertices(torso({ neckerchief: false }))).toBe(0);
    expect(vertices(torso({ neckerchief: false, torso: [] }))).toBe(0);
    // A backpack or a skort is still drawn.
    expect(vertices(torso({ neckerchief: false }, { backpack: true }))).toBeGreaterThan(0);
  });
});

describe('guide gear: the procedural Scout', () => {
  const plainHead = (patch: Partial<FilledAvatar>, gear?: NpcGear): THREE.BufferGeometry =>
    buildHeadGeometry(look({ hairStyle: 'none', hat: 'none', glasses: false, ...patch }), gear);

  it.each(NPC_HEADGEAR)('%s sits on the smaller head, in the hat color, instead of the look\'s hat', (headgear) => {
    const without = plainHead({ hatColor: '#2f5fa8' });
    const g = plainHead({ hatColor: '#2f5fa8' }, { headgear });
    finite(g);
    expect(painted(without, '#2f5fa8')).toBe(0);
    expect(painted(g, '#2f5fa8')).toBeGreaterThan(40);
    expect(box(g).max.y).toBeGreaterThan(box(without).max.y + 0.15);
    expect(box(g).max.y).toBeLessThan(1.0);
    expect(box(g).max.x).toBeLessThan(0.55); // the plain head is 0.52 wide
    // Whatever hat the look names, the gear is the same.
    const capped = plainHead({ hatColor: '#2f5fa8', hat: 'cap' }, { headgear });
    expect(Array.from(capped.getAttribute('position').array)).toEqual(Array.from(g.getAttribute('position').array));
  });

  it('the fire helmet carries its gold plate; the chef hat does not', () => {
    expect(painted(plainHead({}, { headgear: 'fire-helmet' }), GEAR_COLORS.gold)).toBeGreaterThan(10);
    expect(painted(plainHead({}, { headgear: 'chef-hat' }), GEAR_COLORS.gold)).toBe(0);
    expect(painted(plainHead({}), GEAR_COLORS.gold)).toBe(0);
  });

  it.each(NPC_TORSO_GEAR)('%s fits the torso: flush with the chest, no wider than the arms', (piece) => {
    const plain = buildTorsoGeometry(look(), { npcGear: { neckerchief: false } });
    const g = buildTorsoGeometry(look(), { npcGear: { torso: [piece], neckerchief: false } });
    finite(g);
    expect(vertices(g)).toBeGreaterThan(vertices(plain) + 30);
    const b = box(g);
    expect(b.max.z).toBeLessThan(0.22); // the chest is at 0.15
    expect(b.min.z).toBeGreaterThan(-0.2);
    expect(b.max.x).toBeLessThan(0.3);
    expect(b.min.x).toBeGreaterThan(-0.3);
    expect(b.max.y).toBeLessThan(0.75);
    expect(b.min.y).toBeGreaterThan(-0.25);
  });

  it('a guide has no neckerchief or slide, and the Scout still does', () => {
    const scout = buildTorsoGeometry(look());
    expect(painted(scout, SLIDE)).toBeGreaterThan(0);
    const guide = buildTorsoGeometry(look(), { npcGear: { torso: ['badge'], neckerchief: false } });
    expect(painted(guide, SLIDE)).toBe(0);
    expect(vertices(guide)).toBeLessThan(vertices(scout) + 100);
  });

  it('without gear nothing changes', () => {
    expect(vertices(buildTorsoGeometry(look(), { npcGear: {} }))).toBe(vertices(buildTorsoGeometry(look())));
    expect(vertices(buildHeadGeometry(look(), {}))).toBe(vertices(buildHeadGeometry(look())));
  });
});

describe('guide gear in a rig', () => {
  const meshes = (root: THREE.Object3D): THREE.Mesh[] => {
    const found: THREE.Mesh[] = [];
    root.traverseVisible((o) => {
      if ((o as THREE.Mesh).isMesh) found.push(o as THREE.Mesh);
    });
    return found;
  };
  const named = (rig: AvatarRig, name: string): THREE.Mesh => rig.root.getObjectByName(name) as THREE.Mesh;
  const modelRig = (config: FilledAvatar, options: Parameters<typeof buildAvatar>[1] = {}): AvatarRig => {
    useBlockyModel(model);
    return buildAvatar(config, options);
  };

  const everything: NpcGear = { headgear: 'fire-helmet', torso: ['apron', 'sash', 'whistle', 'reflective-stripes', 'badge'], neckerchief: false };

  it('costs no draw calls: the same nine meshes as a Scout in a hat, gear merged into the two attachment meshes', () => {
    const scout = modelRig(look({ hat: 'cap' }));
    const guide = modelRig(look({ hat: 'none', hairStyle: 'none' }), { npcGear: everything });
    const names = (rig: AvatarRig): string[] => meshes(rig.root).map((m) => m.name).sort();
    expect(meshes(scout.root)).toHaveLength(9);
    expect(names(guide)).toEqual(names(scout));
    expect(painted(named(guide, 'head-attachments').geometry, GEAR_COLORS.gold)).toBeGreaterThan(10);
    expect(painted(named(guide, 'torso-attachments').geometry, GEAR_COLORS.reflective)).toBeGreaterThan(10);
    expect(painted(named(guide, 'torso-attachments').geometry, GEAR_COLORS.silver)).toBeGreaterThan(10);
  });

  it('the plain Scout (before the model arrives) also wears it in the same seven meshes', () => {
    const scout = buildAvatar(look({ hat: 'cap' }));
    const guide = buildAvatar(look({ hat: 'none' }), { npcGear: everything });
    expect(scout.root.getObjectByName('avatar-fallback')).toBeDefined();
    expect(guide.root.getObjectByName('avatar-fallback')).toBeDefined();
    expect(meshes(scout.root)).toHaveLength(7);
    expect(meshes(guide.root)).toHaveLength(7);
    expect(painted((guide.root.getObjectByName('head-mesh') as THREE.Mesh).geometry, GEAR_COLORS.gold)).toBeGreaterThan(10);
    expect(painted((guide.root.getObjectByName('torso-mesh') as THREE.Mesh).geometry, GEAR_COLORS.reflective)).toBeGreaterThan(10);
  });

  it('with no neckerchief and no torso gear, the Kenney Scout has no torso attachment mesh at all', () => {
    const rig = modelRig(look(), { npcGear: { neckerchief: false } });
    expect(meshes(rig.root).map((m) => m.name)).not.toContain('torso-attachments');
    rig.setConfig(look({ shirt: '#c63d34', backpack: true }));
    expect(meshes(rig.root).map((m) => m.name)).toContain('torso-attachments'); // a backpack is drawn
    rig.setConfig(look({ shirt: '#c63d34', backpack: false }));
    expect(meshes(rig.root).map((m) => m.name)).not.toContain('torso-attachments');
    expect(() => rig.dispose()).not.toThrow();
  });

  it.each([
    ['the Kenney Scout', 'head-attachments', 'torso-attachments', true],
    ['the plain Scout', 'head-mesh', 'torso-mesh', false],
  ])('is fixed when the rig is built, and survives a look change (%s)', (_label, headName, torsoName, withModel) => {
    const build = (config: FilledAvatar): AvatarRig => {
      if (withModel) useBlockyModel(model);
      return buildAvatar(config, { npcGear: everything });
    };
    const rig = build(look({ hat: 'none' }));
    rig.setConfig(look({ hat: 'bucket', hatColor: '#2f5fa8', shirt: '#c63d34', hairStyle: 'ponytail', backpack: true }));
    // The same helmet and gear as a rig built with that look from the start.
    const fresh = build(rig.config);
    expect(vertices(named(rig, headName).geometry)).toBe(vertices(named(fresh, headName).geometry));
    expect(vertices(named(rig, torsoName).geometry)).toBe(vertices(named(fresh, torsoName).geometry));
    expect(painted(named(rig, headName).geometry, GEAR_COLORS.gold)).toBeGreaterThan(10);
    expect(painted(named(rig, headName).geometry, '#2f5fa8')).toBeGreaterThan(40); // the helmet follows the hat color
    expect(painted(named(rig, torsoName).geometry, GEAR_COLORS.reflective)).toBeGreaterThan(10);
  });

  it('every kind of gear builds in both Scouts, for every build, and the rig animates', () => {
    for (const withModel of [true, false]) {
      resetBlockyModel();
      if (withModel) useBlockyModel(model);
      for (const headgear of NPC_HEADGEAR) {
        for (const build of BUILDS.map((c) => c.value)) {
          for (const piece of NPC_TORSO_GEAR) {
            const rig = buildAvatar(look({ build }), { npcGear: { headgear, torso: [piece], neckerchief: false } });
            expect(rig.root.getObjectByName(withModel ? 'avatar-blocky' : 'avatar-fallback')).toBeDefined();
            expect(meshes(rig.root).length).toBeLessThanOrEqual(9);
            rig.play('wave');
            rig.update(0.5, { moving: false, speed: 0 });
            rig.play('walk');
            rig.update(0.5, { moving: true, speed: 3 });
            const size = new THREE.Box3().setFromObject(rig.root);
            expect(Number.isFinite(size.max.y)).toBe(true);
            rig.dispose();
          }
        }
      }
    }
  });

  it('a rig with no gear is the plain Scout', () => {
    const plain = modelRig(look());
    const same = buildAvatar(look(), { npcGear: undefined });
    const empty = buildAvatar(look(), { npcGear: {} });
    for (const rig of [same, empty]) {
      expect(vertices(named(rig, 'torso-attachments').geometry)).toBe(vertices(named(plain, 'torso-attachments').geometry));
      expect(meshes(rig.root).map((m) => m.name).sort()).toEqual(meshes(plain.root).map((m) => m.name).sort());
    }
  });

  describe('how tall it stands', () => {
    const top = (rig: AvatarRig): number => {
      rig.root.updateMatrixWorld(true);
      return new THREE.Box3().setFromObject(rig.root).max.y;
    };
    const cases: Array<[string, Partial<FilledAvatar>, NpcGear | undefined]> = [
      ['a bare head', { hairStyle: 'none', hat: 'none' }, undefined],
      ['a scout hat', { hat: 'scout' }, undefined],
      ['spiky hair', { hairStyle: 'spiky', hat: 'none' }, undefined],
      ['a fire helmet', { hat: 'none' }, { headgear: 'fire-helmet' }],
      ['a chef hat', { hat: 'none' }, { headgear: 'chef-hat' }],
    ];

    it.each(cases)('avatarTopHeight is the highest point of either Scout: %s', (_label, patch, gear) => {
      for (const build of BUILDS.map((c) => c.value)) {
        const config = look({ build, ...patch });
        const options = { npcGear: gear, blobShadow: false };
        resetBlockyModel();
        const plain = top(buildAvatar(config, options));
        useBlockyModel(model);
        const kit = top(buildAvatar(config, options));
        const tallest = Math.max(plain, kit);
        expect(avatarTopHeight(config, { npcGear: gear }), build).toBeCloseTo(tallest, 2);
      }
    });

    it('a chef hat makes a regular Scout taller than a scout hat does, and a helmet is lower than the chef hat', () => {
      const tops = (patch: Partial<FilledAvatar>, gear?: NpcGear): number => avatarTopHeight(look({ build: 'regular', ...patch }), { npcGear: gear });
      expect(tops({ hat: 'none', hairStyle: 'none' })).toBeCloseTo(1.8, 2);
      expect(tops({ hat: 'none' }, { headgear: 'chef-hat' })).toBeGreaterThan(tops({ hat: 'scout' }) + 0.15);
      expect(tops({ hat: 'none' }, { headgear: 'chef-hat' })).toBeGreaterThan(tops({ hat: 'none' }, { headgear: 'fire-helmet' }));
    });
  });
});

describe('guide gear stays out of what a kid can pick', () => {
  const names: string[] = [...NPC_HEADGEAR, ...NPC_TORSO_GEAR];

  it('is not a hat style, a cosmetic, or any other option the editor lists', () => {
    const lists = [HAT_STYLES, HAIR_STYLES, EYE_STYLES, LEG_STYLES, BUILDS];
    for (const list of lists) {
      for (const choice of list) {
        expect(names).not.toContain(choice.value);
        expect(names).not.toContain(choice.label.toLowerCase().replace(/ /g, '-'));
      }
    }
    for (const lock of COSMETIC_LOCKS) {
      for (const name of names) {
        expect(lock.id).not.toContain(name);
        expect(lock.value).not.toContain(name);
      }
    }
    expect(HAT_STYLES.map((c) => c.value)).toEqual(['none', 'cap', 'bucket', 'beanie', 'scout']);
  });

  it('fillAvatar drops it: a gear name as a hat becomes no hat, and gear fields never come back', () => {
    for (const name of names) {
      expect(fillAvatar({ bodyColor: '#3d85c6', hat: name }).hat, name).toBe('none');
    }
    const sneaky = { ...defaultAvatar('wolf'), npcGear: { headgear: 'fire-helmet', torso: ['sash'] }, headgear: 'chef-hat' } as unknown as FilledAvatar;
    const filled = fillAvatar(sneaky);
    expect(Object.keys(filled).sort()).toEqual(Object.keys(defaultAvatar('wolf')).sort());
    expect(JSON.stringify(filled)).not.toMatch(/fire-helmet|chef-hat|sash|apron|whistle/);
  });

  it('the Random button never hands it out', () => {
    for (let seed = 1; seed <= 200; seed++) {
      let a = seed;
      const rng = (): number => ((a = (a * 1664525 + 1013904223) >>> 0) / 4294967296);
      const config = randomAvatar('wolf', rng, ['cosmetic:hat-scout', 'cosmetic:hat-beanie', 'cosmetic:hat-bucket']);
      expect(HAT_STYLES.map((c) => c.value)).toContain(config.hat);
      expect(Object.keys(config)).toHaveLength(Object.keys(defaultAvatar('wolf')).length);
    }
  });

  it('is not in the save format or its validation', () => {
    for (const file of ['../../src/save/validate.ts', '../../src/save/types.ts', '../../src/save/migrations.ts']) {
      const source = readFileSync(new URL(file, import.meta.url), 'utf8');
      for (const name of names.filter((n) => n.includes('-'))) expect(source, `${file} mentions ${name}`).not.toContain(name);
      expect(source, file).not.toMatch(/npcGear|NpcGear|npc-gear/);
    }
  });
});
