/**
 * What the zone guides wear on top of a look: two kinds of headgear and five torso pieces. One set of shapes serves
 * both Scouts: they are drawn in the Kenney Blocky model's units (see blocky/attachments.ts), and the procedural Scout
 * (parts.ts) sets a `frame` on the mesher so the same shapes shrink onto its smaller head and torso.
 *
 *  - head space: origin at the middle of the head's base, the head is 0.8 wide, tall and deep (y 0 to 0.8), the face
 *    looks toward +z, the character's left is +x;
 *  - torso space: the torso is 0.8 wide and 0.6 deep, from the hips (y = 0.3) to the shoulders (y = 1.2).
 *
 * Shapes are sharp boxes, low-poly cylinders and puffs, like the kit's own parts. Every piece is merged into the
 * attachment meshes that already exist, so gear costs no draw calls. Nothing here carries text or a real-world logo.
 * Nothing here is part of an `AvatarConfig`: the editor and the save never see it.
 */
import * as THREE from 'three';
import type { Mesher } from './parts';
import type { NpcHeadgear, NpcTorsoGear } from './rig-types';

/** The colors gear brings with it. Headgear takes the look's hat color; the sash, apron and cord take the accent. */
export const GEAR_COLORS = {
  /** The helmet shield and the badge: the same gold as the earned shirt. */
  gold: '#e0a82e',
  /** The whistle, and the silver line down the middle of the reflective tape. */
  silver: '#c8ced4',
  /** The whistle's sound hole. */
  hole: '#6b7280',
  /** The reflective tape. */
  reflective: '#f2c230',
} as const;

const tint = new THREE.Color();

/** `hex` darkened (factor under 1) or lightened (over 1). parts.ts imports this file, so it has its own copy. */
function shaded(hex: string, factor: number): string {
  return `#${tint.set(hex).multiplyScalar(factor).getHexString()}`;
}

// ---- head ---------------------------------------------------------------------------------------

/** A dome in the hat color with a wide brim at the back and a plate on the front. */
function fireHelmet(m: Mesher, color: string): void {
  const dark = shaded(color, 0.78);
  // A wall round the head (it clears the corners of the 0.8 head), a lip at its foot, a low dome and a comb along the dome.
  m.add(new THREE.CylinderGeometry(0.6, 0.62, 0.2, 8), color, { y: 0.72 });
  m.add(new THREE.CylinderGeometry(0.7, 0.7, 0.04, 8), dark, { y: 0.62 });
  m.add(new THREE.SphereGeometry(1, 8, 3, 0, Math.PI * 2, 0, Math.PI / 2), color, { y: 0.82, sx: 0.6, sy: 0.26, sz: 0.6 });
  m.box(0.1, 0.08, 0.7, 0, dark, { y: 1.07 });
  // The brim sweeps out behind the neck and drops a little at its far edge.
  m.box(0.96, 0.05, 0.5, 0, dark, { y: 0.66, z: -0.7, rx: -0.3 });
  // A plain shield plate on the front, in a color that stands out from the dome.
  const plate = new THREE.Shape();
  plate.moveTo(-0.15, 0.12);
  plate.lineTo(0.15, 0.12);
  plate.lineTo(0.15, -0.04);
  plate.lineTo(0, -0.18);
  plate.lineTo(-0.15, -0.04);
  plate.closePath();
  m.add(new THREE.ExtrudeGeometry(plate, { depth: 0.04, bevelEnabled: false }), GEAR_COLORS.gold, { y: 0.8, z: 0.57, rx: -0.28 });
}

/** A band round the head and a tall, puffy top: about as tall above the head as the head is wide. */
function chefHat(m: Mesher, color: string): void {
  m.box(0.86, 0.26, 0.86, 0, shaded(color, 0.9), { y: 0.77 });
  m.add(new THREE.CylinderGeometry(0.5, 0.42, 0.2, 8), color, { y: 1.0 });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    m.add(new THREE.IcosahedronGeometry(0.2, 0), color, { x: Math.cos(a) * 0.34, y: 1.14, z: Math.sin(a) * 0.34 });
  }
  m.add(new THREE.IcosahedronGeometry(0.28, 0), color, { y: 1.12 });
}

const HEADGEAR: Readonly<Record<NpcHeadgear, (m: Mesher, color: string) => void>> = {
  'fire-helmet': fireHelmet,
  'chef-hat': chefHat,
};

/** Every kind of headgear (the record above has to list them all). For tests and dev tools. */
export const NPC_HEADGEAR = Object.keys(HEADGEAR) as readonly NpcHeadgear[];

/** Headgear in head space, painted in the look's hat color. Replaces the look's own hat. */
export function addHeadgear(m: Mesher, kind: NpcHeadgear, color: string): void {
  HEADGEAR[kind](m, color);
}

// ---- torso --------------------------------------------------------------------------------------

/** A bib, a skirt, a pocket and a tie round the waist, with straps up to the neck. */
function apron(m: Mesher, color: string): void {
  const pocket = shaded(color, 0.88);
  const z = 0.335; // a hair off the chest (0.3), and not on the same plane as a neckerchief end or the cord
  m.box(0.66, 0.62, 0.04, 0, color, { y: 0.41, z });
  m.box(0.44, 0.34, 0.04, 0, color, { y: 0.89, z });
  m.box(0.34, 0.16, 0.025, 0, pocket, { y: 0.36, z: z + 0.03 });
  m.box(0.84, 0.07, 0.64, 0, pocket, { y: 0.73 });
  for (const side of [1, -1]) {
    m.box(0.06, 0.14, 0.04, 0, color, { x: side * 0.17, y: 1.13, z });
    m.box(0.06, 0.5, 0.03, 0, color, { x: side * 0.17, y: 0.96, z: -0.315 });
  }
}

/** A band from the left shoulder to the right hip, front and back, tied off in a knot with two ends. */
function sash(m: Mesher, color: string): void {
  const tilt = 0.54;
  m.box(0.2, 1.05, 0.04, 0, color, { y: 0.75, z: 0.335, rz: -tilt });
  m.box(0.2, 1.05, 0.04, 0, color, { y: 0.75, z: -0.325, rz: -tilt });
  const knot = shaded(color, 0.85);
  m.box(0.2, 0.17, 0.06, 0, knot, { x: -0.27, y: 0.34, z: 0.335 });
  for (const side of [1, -1]) m.box(0.09, 0.26, 0.035, 0, knot, { x: -0.27 - side * 0.06, y: 0.15, z: 0.335, rz: side * 0.12 });
}

/** A cord ring round the collar, a V of cord down to a small silver whistle on the chest. */
function whistle(m: Mesher, color: string): void {
  const z = 0.33;
  m.box(0.86, 0.04, 0.03, 0, color, { y: 1.17, z });
  m.box(0.86, 0.04, 0.03, 0, color, { y: 1.17, z: -z });
  for (const side of [1, -1]) {
    m.box(0.03, 0.04, 0.66, 0, color, { x: side * 0.415, y: 1.17 });
    m.box(0.035, 0.41, 0.03, 0, color, { x: side * 0.165, y: 1.035, z, rz: -side * 0.717 });
  }
  m.add(new THREE.CylinderGeometry(0.06, 0.06, 0.17, 6).rotateZ(Math.PI / 2), GEAR_COLORS.silver, { y: 0.82, z: 0.36 });
  m.box(0.1, 0.05, 0.06, 0, GEAR_COLORS.silver, { x: 0.13, y: 0.82, z: 0.36 });
  m.box(0.05, 0.02, 0.05, 0, GEAR_COLORS.hole, { y: 0.88, z: 0.36 });
}

/** Yellow bands round the chest and the hem, each with a silver line down the middle. */
function reflectiveStripes(m: Mesher): void {
  for (const y of [0.5, 0.86]) {
    m.box(0.86, 0.12, 0.66, 0, GEAR_COLORS.reflective, { y });
    m.box(0.87, 0.03, 0.67, 0, GEAR_COLORS.silver, { y });
  }
}

/** A small gold shield over the left side of the chest, with a darker one set into it. */
function badge(m: Mesher): void {
  const shield = (half: number): THREE.Shape => {
    const s = new THREE.Shape();
    s.moveTo(-half, half * 1.1);
    s.lineTo(half, half * 1.1);
    s.lineTo(half, -half * 0.2);
    s.lineTo(0, -half * 1.3);
    s.lineTo(-half, -half * 0.2);
    s.closePath();
    return s;
  };
  m.add(new THREE.ExtrudeGeometry(shield(0.1), { depth: 0.035, bevelEnabled: false }), GEAR_COLORS.gold, { x: 0.22, y: 0.95, z: 0.302 });
  m.add(new THREE.ExtrudeGeometry(shield(0.055), { depth: 0.03, bevelEnabled: false }), shaded(GEAR_COLORS.gold, 0.7), { x: 0.22, y: 0.95, z: 0.327 });
}

const TORSO_GEAR: Readonly<Record<NpcTorsoGear, (m: Mesher, accent: string) => void>> = {
  apron,
  sash,
  whistle,
  'reflective-stripes': reflectiveStripes,
  badge,
};

/** Every kind of torso gear (the record above has to list them all). For tests and dev tools. */
export const NPC_TORSO_GEAR = Object.keys(TORSO_GEAR) as readonly NpcTorsoGear[];

/** The pieces in torso space, each once. `accent` paints the apron, the sash and the whistle cord. */
export function addTorsoGear(m: Mesher, pieces: readonly NpcTorsoGear[], accent: string): void {
  for (const piece of new Set(pieces)) TORSO_GEAR[piece](m, accent);
}
