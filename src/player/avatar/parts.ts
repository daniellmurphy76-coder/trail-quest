/**
 * Geometry for the blocky Scout. Each body part (head, torso, arm, leg) is ONE merged geometry
 * with vertex colors, so the whole figure draws with a single shared material and a handful of
 * draw calls. Boxes have a small chamfered bevel (rounded boxes with one corner segment) and
 * render with flat shading, which gives the toy-brick look.
 *
 * Space: y is up, feet at y = 0, the front is +z, the character's left hand is +x. Every builder
 * returns geometry relative to its joint (see `JOINTS`), so the rig can rotate the part about it.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { FilledAvatar } from './options';

// ---- layout -------------------------------------------------------------------------------------

/** Where the joints sit, in rig space (regular build, before the build scale). */
export const JOINTS = {
  /** Hip height; the legs hang from here and the torso stands on it. */
  hipY: 0.62,
  legX: 0.13,
  /** Base of the neck; the head turns about here. */
  neckY: 1.26,
  shoulderY: 1.2,
  armX: 0.35,
} as const;

/** Height of the bare head's top in a regular build: the figure stands 1.8 units tall. */
export const AVATAR_HEIGHT = 1.8;

const TORSO = { w: 0.52, d: 0.3, h: 0.62 } as const;
const HEAD = { w: 0.52, h: 0.52, d: 0.48 } as const;
const FACE_Z = HEAD.d / 2;
const ARM = { w: 0.16, d: 0.18 } as const;
const LEG = { w: 0.25, d: 0.25 } as const;

const INK = '#23262b';
const MOUTH = '#6b2f26';
const GLASSES = '#2b2b30';
const SLIDE = '#c9a46a';
const PACK = '#7b5a3a';
const PACK_STRAP = '#3b2a1d';
const CORD = '#f2c230';

// ---- merging ------------------------------------------------------------------------------------

export interface Placement {
  x?: number;
  y?: number;
  z?: number;
  rx?: number;
  ry?: number;
  rz?: number;
  sx?: number;
  sy?: number;
  sz?: number;
}

const matrix = new THREE.Matrix4();
const normalMatrix = new THREE.Matrix3();
const quaternion = new THREE.Quaternion();
const euler = new THREE.Euler();
const position = new THREE.Vector3();
const scale = new THREE.Vector3();
const vec = new THREE.Vector3();
const tint = new THREE.Color();

/** `hex` darkened (factor under 1) or lightened (over 1). */
export function shade(hex: string, factor: number): string {
  return `#${tint.set(hex).multiplyScalar(factor).getHexString()}`;
}

/** Collects shapes into one non-indexed, vertex-colored geometry. */
export class Mesher {
  private readonly positions: number[] = [];
  private readonly normals: number[] = [];
  private readonly colors: number[] = [];

  /** Add a copy of `geometry` placed by `at` and painted `color`. Takes ownership: disposes it. */
  add(geometry: THREE.BufferGeometry, color: string, at: Placement = {}): this {
    euler.set(at.rx ?? 0, at.ry ?? 0, at.rz ?? 0);
    quaternion.setFromEuler(euler);
    position.set(at.x ?? 0, at.y ?? 0, at.z ?? 0);
    scale.set(at.sx ?? 1, at.sy ?? 1, at.sz ?? 1);
    matrix.compose(position, quaternion, scale);
    normalMatrix.getNormalMatrix(matrix);
    tint.set(color);

    const pos = geometry.getAttribute('position');
    const nor = geometry.getAttribute('normal');
    const index = geometry.index;
    const count = index ? index.count : pos.count;
    for (let k = 0; k < count; k++) {
      const i = index ? index.getX(k) : k;
      vec.fromBufferAttribute(pos, i).applyMatrix4(matrix);
      this.positions.push(vec.x, vec.y, vec.z);
      vec.fromBufferAttribute(nor, i).applyMatrix3(normalMatrix).normalize();
      this.normals.push(vec.x, vec.y, vec.z);
      this.colors.push(tint.r, tint.g, tint.b);
    }
    geometry.dispose();
    return this;
  }

  /** A box with a chamfered edge of `bevel` (0 for sharp), centered on `at`. */
  box(w: number, h: number, d: number, bevel: number, color: string, at: Placement = {}): this {
    const geometry = bevel > 0 ? new RoundedBoxGeometry(w, h, d, 1, bevel) : new THREE.BoxGeometry(w, h, d);
    return this.add(geometry, color, at);
  }

  /** How many vertices have been added so far (0 means nothing to draw). */
  get vertexCount(): number {
    return this.positions.length / 3;
  }

  build(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
  }
}

function starShape(outer: number, inner: number): THREE.Shape {
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 === 0 ? outer : inner;
    const angle = Math.PI / 2 + (i * Math.PI) / 5;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  return shape;
}

// ---- head ---------------------------------------------------------------------------------------

/** Head top, in head space (the neck is the origin). */
const HEAD_TOP = 0.02 + HEAD.h;

function eyes(m: Mesher, style: FilledAvatar['eyes']): void {
  const y = 0.31;
  const z = FACE_Z + 0.005;
  const round = (x: number): void => void m.box(0.075, 0.11, 0.02, 0.03, INK, { x, y, z });
  const arc = (x: number): void =>
    void m.add(new THREE.TorusGeometry(0.055, 0.014, 4, 8, Math.PI), INK, { x, y: y - 0.02, z, sz: 0.5 });
  const star = (x: number): void =>
    void m.add(new THREE.ExtrudeGeometry(starShape(0.08, 0.034), { depth: 0.02, bevelEnabled: false }), INK, {
      x,
      y,
      z: FACE_Z,
    });
  switch (style) {
    case 'happy':
      arc(0.115);
      arc(-0.115);
      break;
    case 'wink':
      arc(0.115); // the character's left eye is shut
      round(-0.115);
      break;
    case 'star':
      star(0.115);
      star(-0.115);
      break;
    default:
      round(0.115);
      round(-0.115);
  }
}

function glasses(m: Mesher): void {
  const z = FACE_Z + 0.012;
  for (const side of [1, -1]) {
    m.add(new THREE.TorusGeometry(0.075, 0.012, 5, 12), GLASSES, { x: side * 0.115, y: 0.31, z });
    m.box(0.07, 0.014, 0.014, 0, GLASSES, { x: side * 0.225, y: 0.325, z });
    m.box(0.014, 0.014, 0.26, 0, GLASSES, { x: side * 0.268, y: 0.325, z: 0.115 });
  }
  m.box(0.05, 0.014, 0.014, 0, GLASSES, { y: 0.325, z });
}

/** Hair. `hatted` keeps only what shows under a hat (the back and the sides). */
function hair(m: Mesher, cfg: FilledAvatar, hatted: boolean): void {
  const c = cfg.hairColor;
  const cap = (h: number): void => void m.box(0.56, h, 0.52, 0.06, c, { y: HEAD_TOP - h / 2 + 0.012 });
  const back = (h: number): void => void m.box(0.55, h, 0.09, 0.03, c, { y: 0.5 - h / 2, z: -0.225 });
  const sides = (h: number): void => {
    for (const side of [1, -1]) m.box(0.06, h, 0.3, 0.02, c, { x: side * 0.272, y: 0.48 - h / 2, z: -0.04 });
  };

  switch (cfg.hairStyle) {
    case 'none':
      return;
    case 'buzz':
      if (!hatted) m.box(0.54, 0.08, 0.5, 0.03, c, { y: HEAD_TOP - 0.04 + 0.01 });
      return;
    case 'short':
      if (!hatted) cap(0.15);
      back(0.28);
      sides(0.16);
      return;
    case 'spiky':
      if (!hatted) {
        cap(0.1);
        const spikes: Array<[number, number, number, number, number]> = [
          [0, 0.66, 0, 0, 0],
          [0.15, 0.63, 0.08, 0, -0.35],
          [-0.15, 0.63, 0.08, 0, 0.35],
          [0.11, 0.63, -0.12, -0.3, -0.25],
          [-0.11, 0.63, -0.12, -0.3, 0.25],
        ];
        for (const [x, y, z, rx, rz] of spikes) m.add(new THREE.ConeGeometry(0.1, 0.24, 4), c, { x, y, z, rx, rz });
      }
      back(0.2);
      sides(0.1);
      return;
    case 'curly': {
      const puff = (x: number, y: number, z: number, r: number): void =>
        void m.add(new THREE.IcosahedronGeometry(r, 0), c, { x, y, z });
      if (!hatted) {
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          puff(Math.cos(a) * 0.2, 0.55, Math.sin(a) * 0.19, 0.12);
        }
        puff(0, 0.62, 0, 0.14);
        puff(0.1, 0.6, -0.08, 0.11);
        puff(-0.1, 0.6, 0.06, 0.11);
      }
      puff(0.27, 0.4, -0.02, 0.11);
      puff(-0.27, 0.4, -0.02, 0.11);
      puff(0.14, 0.38, -0.25, 0.12);
      puff(-0.14, 0.38, -0.25, 0.12);
      puff(0, 0.42, -0.27, 0.13);
      return;
    }
    case 'long':
      if (!hatted) cap(0.15);
      back(0.62);
      for (const side of [1, -1]) m.box(0.06, 0.46, 0.28, 0.02, c, { x: side * 0.275, y: 0.25, z: -0.06 });
      return;
    case 'ponytail':
      if (!hatted) cap(0.15);
      back(0.28);
      sides(0.16);
      m.box(0.13, 0.36, 0.13, 0.04, c, { y: 0.24, z: -0.34, rx: 0.2 });
      m.add(new THREE.TorusGeometry(0.075, 0.02, 5, 10), cfg.neckerchief, { y: 0.4, z: -0.28, rx: Math.PI / 2 - 0.2 });
      return;
    case 'braids':
      if (!hatted) cap(0.15);
      back(0.28);
      sides(0.16);
      for (const side of [1, -1]) {
        [0.32, 0.2, 0.08].forEach((y, i) => m.box(0.12, 0.13, 0.12, 0.04, c, { x: side * (0.27 + (i % 2) * 0.012), y, z: -0.1 }));
        m.box(0.13, 0.03, 0.13, 0, cfg.neckerchief, { x: side * 0.27, y: 0.03, z: -0.1 });
      }
      return;
  }
}

function hat(m: Mesher, style: FilledAvatar['hat'], color: string): void {
  const dark = shade(color, 0.78);
  switch (style) {
    case 'cap':
      m.box(0.57, 0.17, 0.53, 0.07, color, { y: 0.5 });
      m.box(0.5, 0.035, 0.26, 0.012, dark, { y: 0.435, z: 0.37, rx: 0.1 });
      m.box(0.06, 0.04, 0.06, 0.01, dark, { y: 0.595 });
      return;
    case 'bucket':
      m.add(new THREE.CylinderGeometry(0.34, 0.39, 0.22, 10), color, { y: 0.52 });
      m.add(new THREE.CylinderGeometry(0.53, 0.53, 0.035, 12), dark, { y: 0.43 });
      return;
    case 'beanie':
      m.box(0.58, 0.2, 0.54, 0.09, color, { y: 0.49 });
      m.box(0.6, 0.07, 0.56, 0.02, dark, { y: 0.425 });
      m.add(new THREE.IcosahedronGeometry(0.09, 0), dark, { y: 0.66 });
      return;
    case 'scout':
      m.add(new THREE.CylinderGeometry(0.52, 0.52, 0.03, 10), color, { y: 0.455 });
      m.add(new THREE.CylinderGeometry(0.29, 0.37, 0.25, 8), color, { y: 0.58 });
      m.add(new THREE.CylinderGeometry(0.375, 0.375, 0.05, 8), shade(color, 0.55), { y: 0.5 });
      return;
    default:
      return;
  }
}

/** The head, with ears, face, glasses, hair and hat. Origin at the base of the neck. */
export function buildHeadGeometry(cfg: FilledAvatar): THREE.BufferGeometry {
  const m = new Mesher();
  m.box(HEAD.w, HEAD.h, HEAD.d, 0.09, cfg.skin, { y: 0.02 + HEAD.h / 2 });
  for (const side of [1, -1]) m.box(0.05, 0.12, 0.09, 0, cfg.skin, { x: side * 0.285, y: 0.26 });
  eyes(m, cfg.eyes);
  m.add(new THREE.TorusGeometry(0.075, 0.013, 4, 8, Math.PI), MOUTH, {
    y: 0.185,
    z: FACE_Z + 0.005,
    rz: Math.PI,
    sz: 0.5,
  });
  if (cfg.glasses) glasses(m);
  const hatted = cfg.hat !== 'none';
  hair(m, cfg, hatted);
  if (hatted) hat(m, cfg.hat, cfg.hatColor);
  return m.build();
}

// ---- torso --------------------------------------------------------------------------------------

export interface TorsoOptions {
  /** Draw the Den Chief cord across the chest and back. */
  denChiefCord?: boolean;
}

/** The torso with neck, waist band, neckerchief, slide, and optional skirt, backpack and cord. Origin at the hip. */
export function buildTorsoGeometry(cfg: FilledAvatar, options: TorsoOptions = {}): THREE.BufferGeometry {
  const m = new Mesher();
  const frontZ = TORSO.d / 2;

  // Waist band and shirt. The seam between the two boxes reads as a belt line.
  m.box(TORSO.w, 0.13, TORSO.d, 0.04, cfg.legColor, { y: 0.065 });
  m.box(TORSO.w, TORSO.h - 0.12, TORSO.d, 0.05, cfg.shirt, { y: 0.12 + (TORSO.h - 0.12) / 2 });
  m.box(0.16, 0.12, 0.16, 0, cfg.skin, { y: 0.62 });

  if (cfg.legs === 'skort') {
    // A flared, four-sided skirt that hangs over the tops of the legs.
    m.add(new THREE.CylinderGeometry(0.37, 0.5, 0.26, 4, 1).rotateY(Math.PI / 4), cfg.legColor, { sz: 0.62 });
  }

  // Neckerchief: a collar around the neck, a triangle down the chest, and a slide at the throat.
  m.box(0.24, 0.09, 0.22, 0.03, cfg.neckerchief, { y: 0.625 });
  const point = new THREE.Shape();
  point.moveTo(-0.18, 0);
  point.lineTo(0.18, 0);
  point.lineTo(0, -0.3);
  point.closePath();
  m.add(new THREE.ExtrudeGeometry(point, { depth: 0.024, bevelEnabled: false }), cfg.neckerchief, {
    y: 0.585,
    z: frontZ + 0.002,
  });
  m.add(new THREE.TorusGeometry(0.032, 0.011, 5, 8), SLIDE, { y: 0.55, z: frontZ + 0.03 });

  if (cfg.backpack) {
    m.box(0.4, 0.44, 0.17, 0.04, PACK, { y: 0.32, z: -frontZ - 0.085 });
    m.box(0.38, 0.12, 0.19, 0.03, shade(PACK, 0.78), { y: 0.5, z: -frontZ - 0.085 });
    m.box(0.26, 0.14, 0.05, 0.02, shade(PACK, 1.18), { y: 0.2, z: -frontZ - 0.19 });
    for (const side of [1, -1]) m.box(0.05, 0.36, 0.02, 0, PACK_STRAP, { x: side * 0.205, y: 0.43, z: frontZ + 0.01 });
  }

  if (options.denChiefCord) {
    // A cord over the right shoulder to the left hip, front and back, ending in a loop and tassels.
    const length = 0.62;
    const tilt = 0.72;
    m.box(0.045, length, 0.03, 0.01, CORD, { y: 0.37, z: frontZ + 0.03, rz: tilt });
    m.box(0.045, length, 0.03, 0.01, CORD, { y: 0.37, z: -frontZ - 0.03, rz: tilt });
    m.add(new THREE.TorusGeometry(0.06, 0.018, 5, 10), CORD, { x: 0.2, y: 0.12, z: frontZ + 0.045 });
    m.box(0.03, 0.12, 0.03, 0.01, CORD, { x: 0.18, y: 0.02, z: frontZ + 0.045 });
    m.box(0.03, 0.12, 0.03, 0.01, CORD, { x: 0.23, y: 0.02, z: frontZ + 0.045 });
  }
  return m.build();
}

// ---- limbs --------------------------------------------------------------------------------------

/** One arm, hanging from the shoulder (the origin): a short sleeve and a bare forearm and hand. */
export function buildArmGeometry(cfg: FilledAvatar): THREE.BufferGeometry {
  const m = new Mesher();
  m.box(ARM.w, 0.3, ARM.d, 0.03, cfg.shirt, { y: 0.04 - 0.15 });
  m.box(ARM.w - 0.015, 0.27, ARM.d - 0.02, 0.035, cfg.skin, { y: -0.26 - 0.125 });
  return m.build();
}

/** One leg and shoe, hanging from the hip (the origin) down to the ground. */
export function buildLegGeometry(cfg: FilledAvatar): THREE.BufferGeometry {
  const m = new Mesher();
  if (cfg.legs === 'pants') {
    m.box(LEG.w, 0.52, LEG.d, 0.04, cfg.legColor, { y: -0.26 });
  } else {
    m.box(LEG.w, 0.27, LEG.d, 0.04, cfg.legColor, { y: -0.135 });
    m.box(LEG.w - 0.04, 0.27, LEG.d - 0.04, 0.03, cfg.skin, { y: -0.27 - 0.115 });
  }
  m.box(LEG.w, 0.11, 0.34, 0.045, cfg.shoes, { y: -0.565, z: 0.045 });
  return m.build();
}
