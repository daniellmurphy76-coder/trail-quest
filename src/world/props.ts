import * as THREE from 'three';

/** Seeded random source returning floats in [0, 1), for example `mulberry32(2026)`. */
export type Rng = () => number;

export interface Spot {
  x: number;
  z: number;
}

/** A prop that needs per-frame animation. */
export interface AnimatedProp {
  root: THREE.Group;
  update(dt: number): void;
}

const dummy = new THREE.Object3D();

function lambert(color: number, flatShading = true): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color, flatShading });
}

// ---- instanced props ----------------------------------------------------------------------------

/**
 * A stand of low-poly pine trees, one per spot. Size, turn, and leaf color vary using `rng`, so
 * the same seed always gives the same grove. Two draw calls total (trunks, crowns).
 */
export function tree(rng: Rng, spots: readonly Spot[]): THREE.Group {
  const group = new THREE.Group();
  group.name = 'trees';
  const trunkGeo = new THREE.CylinderGeometry(0.3, 0.4, 2, 6).translate(0, 1, 0);
  const crownGeo = new THREE.ConeGeometry(1.6, 4.2, 7).translate(0, 4, 0);
  const trunks = new THREE.InstancedMesh(trunkGeo, lambert(0x7b5230), spots.length);
  const crowns = new THREE.InstancedMesh(crownGeo, lambert(0xffffff), spots.length);
  const leaf = new THREE.Color();

  spots.forEach((spot, i) => {
    const scale = 0.8 + rng() * 0.7;
    dummy.position.set(spot.x, 0, spot.z);
    dummy.rotation.set(0, rng() * Math.PI * 2, 0);
    dummy.scale.setScalar(scale);
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);
    crowns.setMatrixAt(i, dummy.matrix);
    leaf.setHSL(0.36 + rng() * 0.04, 0.45, 0.22 + rng() * 0.08);
    crowns.setColorAt(i, leaf);
  });
  trunks.instanceMatrix.needsUpdate = true;
  crowns.instanceMatrix.needsUpdate = true;
  if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;
  group.add(trunks, crowns);
  return group;
}

/** Gray boulders, one per spot, squashed and turned using `rng`. One draw call. */
export function rock(rng: Rng, spots: readonly Spot[]): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(
    new THREE.DodecahedronGeometry(0.8, 0).translate(0, 0.35, 0),
    lambert(0x8a8f94),
    spots.length,
  );
  mesh.name = 'rocks';
  spots.forEach((spot, i) => {
    const s = 0.7 + rng() * 0.9;
    dummy.position.set(spot.x, 0, spot.z);
    dummy.rotation.set(0, rng() * Math.PI * 2, 0);
    dummy.scale.set(s, s * (0.6 + rng() * 0.3), s * (0.8 + rng() * 0.3));
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

// ---- campfire -----------------------------------------------------------------------------------

/** Stone ring, crossed logs, a glow on the ground, and a flame that flickers in `update`. 5 draw calls. */
export function campfire(): AnimatedProp {
  const root = new THREE.Group();
  root.name = 'campfire';

  const stones = new THREE.InstancedMesh(
    new THREE.DodecahedronGeometry(0.28, 0).translate(0, 0.15, 0),
    lambert(0x777c82),
    8,
  );
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    dummy.position.set(Math.cos(a) * 1.1, 0, Math.sin(a) * 1.1);
    dummy.rotation.set(0, a, 0);
    dummy.scale.set(1, 0.8, 1.2);
    dummy.updateMatrix();
    stones.setMatrixAt(i, dummy.matrix);
  }

  const logs = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.12, 0.12, 1.5, 6).rotateZ(Math.PI / 2),
    lambert(0x5a3a22),
    3,
  );
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI + 0.3;
    dummy.position.set(0, 0.16, 0);
    dummy.rotation.set(0, a, 0);
    dummy.scale.setScalar(1);
    dummy.updateMatrix();
    logs.setMatrixAt(i, dummy.matrix);
  }

  const glow = new THREE.Mesh(
    new THREE.CircleGeometry(2.4, 24).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({
      color: 0xffa33a,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
    }),
  );
  glow.position.y = 0.04;

  const outer = new THREE.Mesh(
    new THREE.ConeGeometry(0.55, 1.5, 8).translate(0, 0.75, 0),
    new THREE.MeshBasicMaterial({ color: 0xff7a1a }),
  );
  outer.position.y = 0.2;
  const inner = new THREE.Mesh(
    new THREE.ConeGeometry(0.3, 0.95, 8).translate(0, 0.475, 0),
    new THREE.MeshBasicMaterial({ color: 0xffd34d }),
  );
  inner.position.y = 0.2;

  root.add(glow, stones, logs, outer, inner);

  let t = 0;
  return {
    root,
    update(dt: number): void {
      t += dt;
      // Sums of sines give a lively flicker with no per-frame randomness.
      const tall = 1 + 0.14 * Math.sin(t * 11) + 0.08 * Math.sin(t * 23 + 1.3);
      const wide = 1 + 0.07 * Math.sin(t * 17 + 0.6);
      outer.scale.set(wide, tall, wide);
      inner.scale.set(1 / wide, 1 + 0.2 * Math.sin(t * 19 + 2.1), 1 / wide);
      glow.scale.setScalar(1 + 0.04 * Math.sin(t * 7));
    },
  };
}

// ---- flagpole, lodge ----------------------------------------------------------------------------

/** A tall pole with a plain flag. Not any real organization's flag. 3 draw calls. */
export function flagpole(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'flagpole';
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.11, 6.4, 8), lambert(0xd9dde0));
  pole.position.y = 3.2;
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), lambert(0xe2b93b));
  ball.position.y = 6.5;
  const flag = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1, 0.05), lambert(0x2f7a46));
  flag.position.set(0.88, 5.7, 0);
  g.add(pole, ball, flag);
  return g;
}

/** A log cabin: box walls, a triangular roof prism, a door, and two windows. Faces +z. 4 draw calls. */
export function lodge(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'lodge';
  const width = 8;
  const depth = 6;
  const wallHeight = 3;

  const walls = new THREE.Mesh(new THREE.BoxGeometry(width, wallHeight, depth), lambert(0x9c6b3f));
  walls.position.y = wallHeight / 2;

  const gable = new THREE.Shape();
  gable.moveTo(-width / 2 - 0.6, 0);
  gable.lineTo(width / 2 + 0.6, 0);
  gable.lineTo(0, 2.6);
  gable.closePath();
  const roofGeo = new THREE.ExtrudeGeometry(gable, { depth: depth + 0.8, bevelEnabled: false });
  roofGeo.translate(0, 0, -(depth + 0.8) / 2);
  const roof = new THREE.Mesh(roofGeo, lambert(0x7a3b2e));
  roof.position.y = wallHeight;

  const door = new THREE.Mesh(new THREE.BoxGeometry(1.3, 2.1, 0.12), lambert(0x4a2e1b));
  door.position.set(0, 1.05, depth / 2 + 0.03);

  const windows = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1.1, 1.1, 0.12),
    lambert(0xbfe3ff),
    2,
  );
  for (let i = 0; i < 2; i++) {
    dummy.position.set(i === 0 ? -2.4 : 2.4, 1.7, depth / 2 + 0.03);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.setScalar(1);
    dummy.updateMatrix();
    windows.setMatrixAt(i, dummy.matrix);
  }

  g.add(walls, roof, door, windows);
  return g;
}

// ---- people -------------------------------------------------------------------------------------

export interface PersonOptions {
  /** Neckerchief color. Defaults to a darker shade of `color`. */
  neckerchief?: number;
  /** Skin tone for the head. */
  skin?: number;
}

/** A placeholder person. `body` holds the visible parts (so it can bob); the shadow stays on the ground. */
export class Person extends THREE.Group {
  readonly body = new THREE.Group();
}

const PERSON_BASE_HEIGHT = 1.95; // capsule 0.35 radius + 0.9 length, plus a head

/**
 * Capsule body (0.35 radius, 0.9 length at the base size), a head, a darker neckerchief ring with
 * a point at the front (so you can tell which way they face), and a soft blob shadow.
 * The front is +z. 5 draw calls. `height` scales the whole figure (1.95 is the base size).
 */
export function personPlaceholder(color: number, height: number, options: PersonOptions = {}): Person {
  const s = height / PERSON_BASE_HEIGHT;
  const person = new Person();
  person.name = 'person';

  const bodyColor = new THREE.Color(color);
  const scarfColor = options.neckerchief ?? bodyColor.clone().multiplyScalar(0.55).getHex();

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.35 * s, 0.9 * s, 4, 10), lambert(color, false));
  torso.position.y = 0.8 * s;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.25 * s, 12, 10), lambert(options.skin ?? 0xf0c9a0, false));
  head.position.y = 1.7 * s;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.31 * s, 0.07 * s, 6, 14), lambert(scarfColor, false));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 1.4 * s;
  const point = new THREE.Mesh(
    new THREE.ConeGeometry(0.13 * s, 0.3 * s, 4).rotateX(Math.PI),
    lambert(scarfColor, false),
  );
  point.position.set(0, 1.28 * s, 0.34 * s);

  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.55 * s, 16).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25, depthWrite: false }),
  );
  shadow.position.y = 0.03;

  person.body.add(torso, head, ring, point);
  person.add(person.body, shadow);
  return person;
}
