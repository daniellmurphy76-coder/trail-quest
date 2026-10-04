// Original, hand-coded gap fillers in the same chunky, smooth-shaded, gradient-painted style as the KayKit
// models: stump, logs, flowers, mushrooms, flagstones. Built in world units (1 unit = 1 metre-ish).
import * as THREE from 'three';
import { PAL, merge, xf, rng } from './lib.mjs';

function build(positions, normals, colors, indices) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(positions), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(Float32Array.from(normals), 3));
  g.setAttribute('color', new THREE.BufferAttribute(Float32Array.from(colors), 3));
  g.setIndex(indices);
  fixWinding(g);
  return g;
}

/** Flip any triangle whose winding disagrees with its vertex normals, so every builder is outward-facing. */
function fixWinding(g) {
  const p = g.getAttribute('position');
  const n = g.getAttribute('normal');
  const idx = g.index.array;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const nn = new THREE.Vector3();
  const tmpN = new THREE.Vector3();
  for (let t = 0; t < idx.length; t += 3) {
    a.fromBufferAttribute(p, idx[t]);
    b.fromBufferAttribute(p, idx[t + 1]);
    c.fromBufferAttribute(p, idx[t + 2]);
    e1.subVectors(b, a);
    e2.subVectors(c, a);
    e1.cross(e2);
    nn.set(0, 0, 0);
    for (let k = 0; k < 3; k++) nn.add(tmpN.fromBufferAttribute(n, idx[t + k]));
    if (e1.dot(nn) < 0) {
      const tmp = idx[t + 1];
      idx[t + 1] = idx[t + 2];
      idx[t + 2] = tmp;
    }
  }
}

/** Surface of revolution about y. profile: [[radius, y], ...] bottom to top. color(r, y, ringIndex) => linear rgb. */
export function lathe(profile, seg, color) {
  const pos = [];
  const nrm = [];
  const col = [];
  const idx = [];
  const rings = profile.length;
  const ringNormal = profile.map((_, i) => {
    const a = profile[Math.max(0, i - 1)];
    const b = profile[Math.min(rings - 1, i + 1)];
    const dr = b[0] - a[0];
    const dy = b[1] - a[1];
    const l = Math.hypot(dr, dy) || 1;
    return [dy / l, -dr / l];
  });
  for (let i = 0; i < rings; i++) {
    const [r, y] = profile[i];
    const c = color(r, y, i);
    for (let j = 0; j <= seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      pos.push(r * Math.sin(a), y, r * Math.cos(a));
      nrm.push(ringNormal[i][0] * Math.sin(a), ringNormal[i][1], ringNormal[i][0] * Math.cos(a));
      col.push(...c);
    }
  }
  for (let i = 0; i < rings - 1; i++) {
    for (let j = 0; j < seg; j++) {
      const a = i * (seg + 1) + j;
      const b = a + 1;
      const c = a + seg + 1;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  return build(pos, nrm, col, idx);
}

/** Flat disc or ring at height y (normal +y, or -y when down). color(r) => linear rgb. */
export function disc(r0, r1, y, seg, color, down = false) {
  const pos = [];
  const nrm = [];
  const col = [];
  const idx = [];
  for (let j = 0; j <= seg; j++) {
    const a = (j / seg) * Math.PI * 2;
    pos.push(r1 * Math.sin(a), y, r1 * Math.cos(a));
    nrm.push(0, down ? -1 : 1, 0);
    col.push(...color(r1));
    pos.push(r0 * Math.sin(a), y, r0 * Math.cos(a));
    nrm.push(0, down ? -1 : 1, 0);
    col.push(...color(r0));
  }
  for (let j = 0; j < seg; j++) {
    const a = j * 2;
    idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  return build(pos, nrm, col, idx);
}

/** Ellipsoid (or dome when thetaMax < PI). color(x, y, z, nx, ny, nz) => linear rgb, in local space. */
export function ellipsoid(radii, seg, rings, color, thetaMax = Math.PI) {
  const [rx, ry, rz] = radii;
  const pos = [];
  const nrm = [];
  const col = [];
  const idx = [];
  for (let i = 0; i <= rings; i++) {
    const th = (i / rings) * thetaMax;
    for (let j = 0; j <= seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      const x = rx * Math.sin(th) * Math.sin(a);
      const y = ry * Math.cos(th);
      const z = rz * Math.sin(th) * Math.cos(a);
      const n = new THREE.Vector3(x / (rx * rx), y / (ry * ry), z / (rz * rz)).normalize();
      pos.push(x, y, z);
      nrm.push(n.x, n.y, n.z);
      col.push(...color(x, y, z, n.x, n.y, n.z));
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < seg; j++) {
      const a = i * (seg + 1) + j;
      const b = a + 1;
      const c = a + seg + 1;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  return build(pos, nrm, col, idx);
}

/** A straight tapered tube from p0 to p1 (radius r0 at p0, r1 at p1). color(k) and capColor(k) take 0..1. */
export function tube(p0, p1, r0, r1, seg, color, capColor) {
  const v0 = new THREE.Vector3(...p0);
  const v1 = new THREE.Vector3(...p1);
  const len = v0.distanceTo(v1);
  const parts = [lathe([[r0, 0], [r1, len]], seg, (r, y) => color(y / len))];
  if (capColor) {
    parts.push(disc(0, r1, len, seg, (r) => capColor(r / r1)));
    parts.push(disc(0, r0, 0, seg, (r) => capColor(r / r0), true));
  }
  const g = merge(parts);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), v1.clone().sub(v0).normalize());
  g.applyMatrix4(new THREE.Matrix4().compose(v0, q, new THREE.Vector3(1, 1, 1)));
  return g;
}

/** Tree-ring pattern on a flat cut face of radius r, as bands of color. */
export function woodFace(r, y, seg, down = false) {
  const bands = [
    [0, 0.24, PAL.cutPith],
    [0.24, 0.52, PAL.cut],
    [0.52, 0.72, PAL.cutRing],
    [0.72, 1, PAL.cut],
  ];
  return merge(bands.map(([a, b, ramp]) => disc(r * a, r * b, y, seg, () => ramp(0.5), down)));
}

// ---- recipes ---------------------------------------------------------------------------------------
const SEG = 10;

export function stump() {
  const h = 0.8;
  const barkAt = (y) => PAL.bark(0.15 + 0.7 * (1 - y / h));
  const body = lathe([[0.68, 0], [0.64, 0.14], [0.55, 0.42], [0.53, 0.72], [0.5, h]], SEG, (r, y) => barkAt(y));
  const parts = [body, woodFace(0.5, h + 0.002, SEG)];
  const r = rng(11);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.5 + r() * 0.4;
    const root = ellipsoid([0.3, 0.14, 0.15], 8, 5, (x, y) => PAL.bark(0.55 + 0.3 * (1 - (y + 0.15) / 0.3)));
    // the ellipsoid is long along local x; turn it so that axis points away from the trunk
    xf(root, { r: [0, a - Math.PI / 2, 0], t: [Math.sin(a) * 0.6, 0.06, Math.cos(a) * 0.6] });
    parts.push(root);
  }
  return merge(parts);
}

function logAlongZ(radius, length, seg, tone = 0) {
  const side = lathe([[radius, 0], [radius, length]], seg, () => PAL.bark(0.12 + tone));
  const g = merge([side, woodFace(radius * 0.97, length + 0.002, seg), woodFace(radius * 0.97, -0.002, seg, true)]);
  g.rotateX(Math.PI / 2); // axis y -> z
  g.translate(0, 0, -length / 2);
  // bark: lighter on top, darker underneath; the cut faces keep their rings
  const p = g.getAttribute('position');
  const n = g.getAttribute('normal');
  const c = g.getAttribute('color');
  for (let i = 0; i < p.count; i++) {
    if (Math.abs(n.getZ(i)) > 0.9) continue;
    const t = 0.1 + 0.7 * (1 - (p.getY(i) / radius + 1) / 2);
    c.setXYZ(i, ...PAL.bark(Math.min(1, t + tone)));
  }
  return g;
}

export function logSingle() {
  const g = logAlongZ(0.3, 2.2, SEG);
  g.translate(0, 0.28, 0);
  return g;
}

export function logLarge() {
  const main = logAlongZ(0.52, 2.6, 12);
  main.rotateY(Math.PI / 2); // long axis along x, as the Kenney log was
  main.translate(0, 0.5, 0);
  const stub = (x, z, a) => {
    const t = tube([0, 0, 0], [0.34 * Math.sin(a), 0.2, 0.34 * Math.cos(a)], 0.1, 0.075, 6, (k) => PAL.bark(0.3 + 0.3 * k), () => PAL.cut(0.5));
    t.translate(x, 0.56, z);
    return t;
  };
  return merge([main, stub(0.5, -0.4, Math.PI), stub(-0.6, 0.45, 0)]);
}

export function logStack() {
  const r = 0.23;
  const rnd = rng(5);
  const spec = [
    [-0.46, r, 2.0],
    [0, r, 2.1],
    [0.46, r, 1.95],
    [-0.23, r + 0.4, 2.05],
    [0.23, r + 0.4, 2.0],
    [0, r + 0.8, 1.95],
  ];
  return merge(
    spec.map(([x, y, len]) => {
      const g = logAlongZ(r, len, 8, (rnd() - 0.5) * 0.25);
      g.translate(x, y - 0.04, (rnd() - 0.5) * 0.12); // sunk a little so the pile never floats on a slope
      return g;
    }),
  );
}

/** Push a round stone toward a rounded square (superellipse of exponent n), so neighbours tile with thin gaps. */
function squircle(g, n) {
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const z = p.getZ(i);
    const r = Math.hypot(x, z);
    if (r < 1e-6) continue;
    const k = 1 / Math.pow(Math.pow(Math.abs(x / r), n) + Math.pow(Math.abs(z / r), n), 1 / n);
    p.setX(i, x * k);
    p.setZ(i, z * k);
  }
}

/** A 3 by 2 floor of flat stones filling a 4.0 by 2.3 slab, top at +0.05 and sunk to -0.15. */
export function pathStone() {
  const rnd = rng(23);
  const parts = [];
  const cw = 4.0 / 3;
  const cd = 2.3 / 2;
  for (let ix = 0; ix < 3; ix++) {
    for (let iz = 0; iz < 2; iz++) {
      const sx = (cw / 2) * (0.93 + rnd() * 0.06);
      const sz = (cd / 2) * (0.92 + rnd() * 0.06);
      const top = 0.05 + (rnd() - 0.5) * 0.04;
      const tone = (rnd() - 0.5) * 0.5;
      const clampT = (v) => Math.min(1, Math.max(0, v));
      const stone = lathe(
        [[0.0, -0.15], [0.97, -0.15], [1.0, top - 0.1], [0.94, top - 0.02], [0.82, top]],
        12,
        (rr, y, i) => PAL.stone(clampT((i >= 3 ? 0.18 : 0.5) + tone * 0.5)),
      );
      const cap = disc(0, 0.82, top, 12, () => PAL.stone(clampT(0.16 + tone * 0.5)));
      const g = merge([stone, cap]);
      squircle(g, 3.4);
      g.scale(sx, 1, sz);
      g.rotateY((rnd() - 0.5) * 0.5);
      g.translate(-2.0 + cw * (ix + 0.5) + (rnd() - 0.5) * 0.08, 0, -1.15 + cd * (iz + 0.5) + (rnd() - 0.5) * 0.08);
      parts.push(g);
    }
  }
  return merge(parts);
}

function flowerLeaf(a) {
  const g = ellipsoid([0.11, 0.022, 0.045], 5, 3, (x, y, z, nx, ny) => PAL.green(0.1 + 0.3 * (1 - (x / 0.11 + 1) / 2) + (ny < 0 ? 0.25 : 0)));
  xf(g, { r: [0, a, -0.45], t: [Math.sin(a) * 0.1, 0.05, Math.cos(a) * 0.1] });
  return g;
}

export function flower(petalRamp, seed) {
  const rnd = rng(seed);
  const parts = [];
  const stems = [
    [0, 0, 0.58, 0.0, 0.0],
    [0.15, 0.09, 0.42, 0.3, 1.0],
    [-0.13, 0.12, 0.33, -0.35, 2.4],
  ];
  for (const [x, z, h, lean, dir] of stems) {
    const tx = x + Math.sin(dir) * lean * h;
    const tz = z + Math.cos(dir) * lean * h;
    parts.push(tube([x, 0, z], [tx, h, tz], 0.028, 0.02, 5, (k) => PAL.green(0.55 - 0.4 * k)));
    // bloom: a ring of rounded petals around an eye, tipped a little toward the lean
    const bloom = [];
    const petals = 5;
    for (let i = 0; i < petals; i++) {
      const a = (i / petals) * Math.PI * 2 + rnd() * 0.15;
      const p = ellipsoid([0.085, 0.022, 0.058], 5, 3, (px, py, pz, nx, ny) => petalRamp(0.15 + 0.55 * (1 - (px / 0.085 + 1) / 2) + (ny < 0 ? 0.2 : 0)));
      xf(p, { r: [0, a - Math.PI / 2, 0.2], t: [Math.sin(a) * 0.1, 0.0, Math.cos(a) * 0.1] });
      bloom.push(p);
    }
    bloom.push(ellipsoid([0.058, 0.04, 0.058], 6, 3, () => PAL.flowerEye(0.3)));
    const b = merge(bloom);
    xf(b, { r: [Math.cos(dir) * lean * 0.9, 0, -Math.sin(dir) * lean * 0.9], t: [tx, h, tz] });
    parts.push(b);
  }
  parts.push(flowerLeaf(0.6), flowerLeaf(2.7), flowerLeaf(4.6));
  return merge(parts);
}

export function mushrooms() {
  const parts = [];
  const specs = [
    [0, 0, 0.36, 0.27],
    [0.32, 0.14, 0.25, 0.19],
    [-0.2, 0.27, 0.18, 0.14],
  ];
  const rnd = rng(3);
  for (const [x, z, h, cr] of specs) {
    const stalk = lathe([[cr * 0.36, 0], [cr * 0.26, h * 0.5], [cr * 0.23, h]], 6, (rr, y) => PAL.stalk(0.1 + 0.6 * (1 - y / h)));
    parts.push(xf(stalk, { t: [x, 0, z] }));
    const capH = cr * 0.62;
    const cap = ellipsoid([cr, capH, cr], 8, 4, (px, py) => PAL.capRed(Math.min(1, 0.05 + 0.75 * (1 - py / capH))), Math.PI / 2);
    xf(cap, { t: [x, h - 0.02, z] });
    parts.push(cap);
    parts.push(xf(disc(0, cr, h - 0.02, 8, () => PAL.stalk(0.7), true), { t: [x, 0, z] }));
    for (let i = 0; i < 3; i++) {
      const th = 0.35 + rnd() * 0.6;
      const a = rnd() * Math.PI * 2;
      const sx = cr * Math.sin(th) * Math.sin(a);
      const sy = capH * Math.cos(th);
      const sz = cr * Math.sin(th) * Math.cos(a);
      const spot = ellipsoid([cr * 0.2, cr * 0.07, cr * 0.2], 5, 2, () => PAL.spot(0.2));
      const n = new THREE.Vector3(sx / (cr * cr), sy / (capH * capH), sz / (cr * cr)).normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
      spot.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x + sx * 0.99, h - 0.02 + sy * 0.99, z + sz * 0.99), q, new THREE.Vector3(1, 1, 1)));
      parts.push(spot);
    }
  }
  return merge(parts);
}
