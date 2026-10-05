/**
 * The things that stick out of a Blocky Scout: hair shapes, hats, glasses, the neckerchief, the backpack,
 * the skort's flared skirt and the Den Chief cord, plus a guide's gear (npc-gear.ts). Each group is merged
 * into ONE vertex-colored geometry, so the whole set costs two draw calls: one parented to the `head` node,
 * one to the `torso` node.
 *
 * Space and units are the kit's own (the model is 2.7 tall before the rig scales it to 1.8):
 *  - head space: origin at the middle of the head's base, the head is 0.8 wide, tall and deep (y 0 to 0.8),
 *    the face looks toward +z, the character's left is +x;
 *  - torso space: origin at the torso node (the hips are at y = 0.3, the shoulders at y = 1.2), the torso is
 *    0.8 wide and 0.6 deep.
 * Shapes are sharp-edged boxes like the kit's own parts, plus a few cones, cylinders and low-poly puffs.
 */
import * as THREE from 'three';
import type { FilledAvatar } from '../options';
import { addHeadgear, addTorsoGear } from '../npc-gear';
import { Mesher, shade } from '../parts';
import type { NpcGear } from '../rig-types';

const H = 0.8;

/**
 * The model's own numbers, in its units (it is 2.7 tall before the rig scales it to SCOUT_HEIGHT): where the head's
 * base sits above the feet and how tall the head is. `avatarTopHeight` (../height.ts) works from these.
 */
export const KIT = { height: 2.7, headBase: 1.9, headHeight: H } as const;
const GLASSES = '#2b2b30';
const SLIDE = '#c9a46a';
const PACK = '#7b5a3a';
const PACK_STRAP = '#3b2a1d';
const CORD = '#f2c230';

/** The look's hair as shapes. `hatted` keeps only what shows under a hat: the back and the sides. */
function hair(m: Mesher, cfg: FilledAvatar, hatted: boolean): void {
  const c = cfg.hairColor;
  const cap = (h: number): void => void m.box(0.9, h, 0.9, 0, c, { y: H + 0.05 - h / 2 });
  const back = (h: number): void => void m.box(0.88, h, 0.1, 0, c, { y: H - h / 2, z: -0.44 });
  const sides = (h: number): void => {
    for (const side of [1, -1]) m.box(0.1, h, 0.56, 0, c, { x: side * 0.44, y: H - h / 2, z: -0.1 });
  };
  const puff = (x: number, y: number, z: number, r: number): void =>
    void m.add(new THREE.IcosahedronGeometry(r, 0), c, { x, y, z });

  switch (cfg.hairStyle) {
    case 'none':
    case 'buzz':
      return; // painted on the skin only
    case 'short':
      if (!hatted) cap(0.2);
      back(0.42);
      sides(0.3);
      return;
    case 'spiky': {
      if (!hatted) {
        cap(0.12);
        const spikes: Array<[number, number, number, number, number]> = [
          [0, 1.0, 0, 0, 0],
          [0.24, 0.96, 0.16, 0, -0.35],
          [-0.24, 0.96, 0.16, 0, 0.35],
          [0.2, 0.96, -0.2, -0.3, -0.25],
          [-0.2, 0.96, -0.2, -0.3, 0.25],
        ];
        for (const [x, y, z, rx, rz] of spikes) m.add(new THREE.ConeGeometry(0.15, 0.36, 4), c, { x, y, z, rx, rz });
      }
      back(0.3);
      sides(0.18);
      return;
    }
    case 'curly':
      if (!hatted) {
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          puff(Math.cos(a) * 0.34, 0.8, Math.sin(a) * 0.32, 0.2);
        }
        puff(0, 0.95, 0, 0.22);
        puff(0.17, 0.92, -0.12, 0.17);
        puff(-0.17, 0.92, 0.1, 0.17);
      }
      puff(0.44, 0.6, -0.05, 0.17);
      puff(-0.44, 0.6, -0.05, 0.17);
      puff(0.24, 0.55, -0.43, 0.19);
      puff(-0.24, 0.55, -0.43, 0.19);
      puff(0, 0.62, -0.46, 0.2);
      return;
    case 'long':
      if (!hatted) cap(0.2);
      back(1.05);
      for (const side of [1, -1]) m.box(0.1, 0.72, 0.5, 0, c, { x: side * 0.44, y: H - 0.36, z: -0.12 });
      return;
    case 'ponytail':
      if (!hatted) cap(0.2);
      back(0.42);
      sides(0.3);
      m.box(0.22, 0.62, 0.22, 0, c, { y: 0.3, z: -0.62, rx: 0.2 });
      m.add(new THREE.TorusGeometry(0.13, 0.035, 5, 10), cfg.neckerchief, { y: 0.58, z: -0.52, rx: Math.PI / 2 - 0.2 });
      return;
    case 'braids':
      if (!hatted) cap(0.2);
      back(0.42);
      sides(0.3);
      for (const side of [1, -1]) {
        [0.4, 0.24, 0.08].forEach((y, i) => m.box(0.17, 0.18, 0.17, 0, c, { x: side * (0.45 + (i % 2) * 0.015), y, z: -0.1 }));
        m.box(0.19, 0.05, 0.19, 0, cfg.neckerchief, { x: side * 0.45, y: -0.03, z: -0.1 });
      }
      return;
  }
}

function hat(m: Mesher, style: FilledAvatar['hat'], color: string): void {
  const dark = shade(color, 0.78);
  switch (style) {
    case 'cap':
      m.box(0.92, 0.26, 0.92, 0, color, { y: H + 0.06 });
      m.box(0.78, 0.05, 0.42, 0, dark, { y: 0.76, z: 0.62, rx: 0.12 });
      m.box(0.1, 0.06, 0.1, 0, dark, { y: H + 0.21 });
      return;
    case 'bucket':
      m.add(new THREE.CylinderGeometry(0.5, 0.62, 0.34, 10), color, { y: 0.93 });
      m.add(new THREE.CylinderGeometry(0.85, 0.85, 0.05, 12), dark, { y: 0.75 });
      return;
    case 'beanie':
      m.box(0.94, 0.3, 0.94, 0, color, { y: 0.9 });
      m.box(0.98, 0.1, 0.98, 0, dark, { y: 0.77 });
      m.add(new THREE.IcosahedronGeometry(0.13, 0), dark, { y: 1.12 });
      return;
    case 'scout':
      m.add(new THREE.CylinderGeometry(0.85, 0.85, 0.045, 10), color, { y: 0.76 });
      m.add(new THREE.CylinderGeometry(0.44, 0.58, 0.3, 8), color, { y: 0.93 });
      m.add(new THREE.CylinderGeometry(0.585, 0.585, 0.08, 8), shade(color, 0.55), { y: 0.82 });
      return;
    default:
      return;
  }
}

function glasses(m: Mesher): void {
  const z = 0.42;
  const y = 0.4;
  for (const side of [1, -1]) {
    const x = side * 0.15;
    m.box(0.28, 0.035, 0.035, 0, GLASSES, { x, y: y + 0.12, z });
    m.box(0.28, 0.035, 0.035, 0, GLASSES, { x, y: y - 0.12, z });
    m.box(0.035, 0.24, 0.035, 0, GLASSES, { x: x - 0.14, y, z });
    m.box(0.035, 0.24, 0.035, 0, GLASSES, { x: x + 0.14, y, z });
    m.box(0.035, 0.035, 0.42, 0, GLASSES, { x: side * 0.43, y: y + 0.12, z: 0.21 });
  }
  m.box(0.08, 0.035, 0.035, 0, GLASSES, { y: y + 0.1, z });
}

export interface HeadAttachmentOptions {
  /** A guide's gear: its headgear is drawn instead of the look's hat. */
  npcGear?: NpcGear;
}

/**
 * Hair, hat and glasses, as one geometry for the `head` node. Returns null when there is nothing to draw
 * (a bald or buzz-cut head with no hat and no glasses).
 */
export function buildHeadAttachments(cfg: FilledAvatar, options: HeadAttachmentOptions = {}): THREE.BufferGeometry | null {
  const m = new Mesher();
  const headgear = options.npcGear?.headgear;
  const hatted = cfg.hat !== 'none' || headgear !== undefined;
  hair(m, cfg, hatted);
  if (headgear) addHeadgear(m, headgear, cfg.hatColor);
  else if (hatted) hat(m, cfg.hat, cfg.hatColor);
  if (cfg.glasses) glasses(m);
  return m.vertexCount > 0 ? m.build() : null;
}

export interface TorsoAttachmentOptions {
  /** Draw the Den Chief cord across the chest and back. */
  denChiefCord?: boolean;
  /** A guide's gear: torso pieces, and whether to leave the neckerchief off. */
  npcGear?: NpcGear;
}

/**
 * Neckerchief (a collar, a triangle down the chest and a slide), the backpack, the skort's flared skirt, the
 * Den Chief cord and a guide's torso gear, as one geometry for the `torso` node. A Scout always wears a
 * neckerchief, so for a Scout it is never empty; a guide's gear leaves it off, and a guide with no torso gear
 * gets an empty geometry.
 */
export function buildTorsoAttachments(cfg: FilledAvatar, options: TorsoAttachmentOptions = {}): THREE.BufferGeometry {
  const m = new Mesher();
  const gear = options.npcGear;

  if (gear?.neckerchief !== false) {
    // Neckerchief, worn the Scout way: rolled into a collar under the head, the point hanging down the back,
    // and the two ends running down the front through a slide at the throat.
    m.box(0.84, 0.12, 0.64, 0, cfg.neckerchief, { y: 1.13 });
    const point = new THREE.Shape();
    point.moveTo(-0.28, 0);
    point.lineTo(0.28, 0);
    point.lineTo(0, -0.48);
    point.closePath();
    // Its outer face at z = -0.34, just off the back (-0.3) and under the Den Chief cord (-0.35).
    m.add(new THREE.ExtrudeGeometry(point, { depth: 0.03, bevelEnabled: false }), cfg.neckerchief, { y: 1.09, z: -0.34 });
    for (const side of [1, -1]) {
      // An end from the side of the collar in to the slide, then a short tail below it.
      m.box(0.09, 0.2, 0.03, 0, cfg.neckerchief, { x: side * 0.1, y: 1.03, z: 0.325, rz: -side * 0.82 });
      m.box(0.08, 0.16, 0.03, 0, cfg.neckerchief, { x: side * 0.04, y: 0.86, z: 0.325, rz: side * 0.15 });
    }
    m.add(new THREE.TorusGeometry(0.045, 0.016, 5, 8), SLIDE, { y: 0.96, z: 0.35 });
  }

  if (cfg.legs === 'skort') {
    // A flared, four-sided skirt over the tops of the legs.
    m.add(new THREE.CylinderGeometry(0.6, 0.88, 0.44, 4, 1).rotateY(Math.PI / 4), cfg.legColor, { y: 0.11, sz: 0.76 });
  }

  if (cfg.backpack) {
    m.box(0.62, 0.7, 0.26, 0, PACK, { y: 0.72, z: -0.43 });
    m.box(0.6, 0.2, 0.28, 0, shade(PACK, 0.78), { y: 0.98, z: -0.43 });
    m.box(0.4, 0.22, 0.08, 0, shade(PACK, 1.18), { y: 0.52, z: -0.6 });
    for (const side of [1, -1]) m.box(0.08, 0.52, 0.03, 0, PACK_STRAP, { x: side * 0.3, y: 0.9, z: 0.315 });
  }

  if (options.denChiefCord) {
    // Over the right shoulder to the left hip, front and back, ending in a loop and two tassels.
    const length = 0.96;
    const tilt = 0.675;
    // Over the neckerchief ends on the chest (z = 0.34) and its point on the back (z = -0.34), so the two
    // never share a plane.
    m.box(0.07, length, 0.04, 0, CORD, { y: 0.78, z: 0.34, rz: tilt });
    m.box(0.07, length, 0.04, 0, CORD, { y: 0.78, z: -0.33, rz: tilt });
    m.add(new THREE.TorusGeometry(0.09, 0.026, 5, 10), CORD, { x: 0.3, y: 0.4, z: 0.35 });
    m.box(0.05, 0.16, 0.04, 0, CORD, { x: 0.26, y: 0.24, z: 0.35 });
    m.box(0.05, 0.16, 0.04, 0, CORD, { x: 0.34, y: 0.24, z: 0.35 });
  }

  if (gear?.torso?.length) addTorsoGear(m, gear.torso, gear.accent ?? cfg.neckerchief);
  return m.build();
}
