// Shared helpers for the nature kit pipeline: palette, KayKit import, small procedural builders.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { NodeIO } from '@gltf-transform/core';

// ---- color ---------------------------------------------------------------------------------------
export const s2l = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
export const l2s = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
export const hexS = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255].map((v) => v / 255); // sRGB 0..1
export const hexL = (h) => hexS(h).map(s2l); // linear

/** A vertical gradient from sRGB hex stops [[t, hex], ...] (t 0 = top/light, 1 = bottom/dark). Returns t => linear rgb. */
export function ramp(stops) {
  return (t) => {
    const x = Math.min(1, Math.max(0, t));
    let i = 0;
    while (i < stops.length - 2 && x > stops[i + 1][0]) i++;
    const [t0, h0] = stops[i];
    const [t1, h1] = stops[i + 1];
    const k = t1 === t0 ? 0 : Math.min(1, Math.max(0, (x - t0) / (t1 - t0)));
    const a = hexS(h0);
    const b = hexS(h1);
    return a.map((v, j) => s2l(v + (b[j] - v) * k));
  };
}
/** Same ramp, lightened or darkened by `f` in linear space (1 = unchanged). */
export const shade = (fn, f) => (t) => fn(t).map((v) => Math.min(1, v * f));

// ---- palette (the one set of colors every nature model is painted from) -----------------------------
// Greens keep KayKit's light end, but the dark end is pulled from emerald-teal toward leaf green so
// nothing in shadow reads blue-green next to the grass (the ground is 0x5f9e45).
export const PAL = {
  green: ramp([[0, 0x92c940], [0.25, 0x6db03c], [0.5, 0x4a983a], [0.75, 0x2f8034], [1, 0x1d6b30]]),
  greenLight: ramp([[0, 0xb4d94a], [0.5, 0x7cb83c], [1, 0x3f8a32]]),
  bark: ramp([[0, 0xe08a45], [0.25, 0xcc7a3e], [0.5, 0xb0653a], [0.75, 0x8c4c30], [1, 0x663024]]),
  barkDark: ramp([[0, 0xa46f48], [0.5, 0x805238], [1, 0x573526]]),
  birch: ramp([[0, 0xf6f1e6], [0.5, 0xddd7c8], [1, 0x908a7a]]),
  stone: ramp([[0, 0xbdb9ae], [0.25, 0xaaa69c], [0.5, 0x8e8b83], [0.75, 0x727068], [1, 0x5a5851]]),
  autumn: ramp([[0, 0xf7c948], [0.25, 0xf2a73a], [0.5, 0xe4772f], [0.75, 0xc8532b], [1, 0x9d3a28]]),
  cut: ramp([[0, 0xecc58a], [1, 0xd6a566]]),
  cutRing: ramp([[0, 0xc9965a], [1, 0xb7834c]]),
  cutPith: ramp([[0, 0xb98450], [1, 0xa87444]]),
  petalRed: ramp([[0, 0xf0645a], [1, 0xd23a3c]]),
  petalYellow: ramp([[0, 0xffe05a], [1, 0xf5b81e]]),
  petalPurple: ramp([[0, 0xc09af5], [1, 0x8a62d0]]),
  petalWhite: ramp([[0, 0xfffaf0], [1, 0xe9e1cd]]),
  flowerEye: ramp([[0, 0xffd23f], [1, 0xf0a41c]]),
  capRed: ramp([[0, 0xee5545], [1, 0xb83230]]),
  stalk: ramp([[0, 0xf6ecd2], [1, 0xd8c59f]]),
  spot: ramp([[0, 0xfffaea], [1, 0xf0e6cc]]),
};
/** KayKit atlas rows (v 0..0.25 green, 0.25..0.5 orange trunk, 0.5..0.75 gray) mapped to our ramps. */
export const KAYKIT_FAMILIES = [PAL.green, PAL.bark, PAL.stone];

// ---- KayKit import ---------------------------------------------------------------------------------
const io = new NodeIO();
/** Read a KayKit .gltf into an indexed BufferGeometry with position, normal, color (linear). `families` replaces the row ramps. */
export async function kaykit(dir, name, families = KAYKIT_FAMILIES) {
  const doc = await io.read(`${dir}/${name}.gltf`);
  const mesh = doc.getRoot().listMeshes()[0];
  const prims = mesh.listPrimitives();
  if (prims.length !== 1) throw new Error(`${name}: expected one primitive`);
  const p = prims[0];
  const pos = p.getAttribute('POSITION').getArray();
  const nrm = p.getAttribute('NORMAL').getArray();
  const uv = p.getAttribute('TEXCOORD_0').getArray();
  const idx = p.getIndices().getArray();
  const col = new Float32Array(pos.length);
  for (let i = 0; i < pos.length / 3; i++) {
    const py = uv[i * 2 + 1] * 1024;
    const family = Math.min(2, Math.max(0, Math.floor(py / 256)));
    const t = (py - family * 256) / 255;
    col.set(families[family](t), i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(pos), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(Float32Array.from(nrm), 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(new THREE.BufferAttribute(Uint32Array.from(idx), 1));
  return g;
}

// ---- geometry helpers ------------------------------------------------------------------------------
/** Strip to position/normal/color, indexed. */
export function clean(g) {
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', g.getAttribute('position').clone());
  out.setAttribute('normal', g.getAttribute('normal').clone());
  if (g.getAttribute('color')) out.setAttribute('color', g.getAttribute('color').clone());
  if (g.index) out.setIndex(g.index.clone());
  return out;
}
/** Paint a geometry: fn(x, y, z, nx, ny, nz) => linear rgb. */
export function paint(g, fn) {
  const p = g.getAttribute('position');
  const n = g.getAttribute('normal');
  const c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) c.set(fn(p.getX(i), p.getY(i), p.getZ(i), n.getX(i), n.getY(i), n.getZ(i)), i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}
export function xf(g, { s = [1, 1, 1], r = [0, 0, 0], t = [0, 0, 0] } = {}) {
  const m = new THREE.Matrix4().compose(new THREE.Vector3(...t), new THREE.Quaternion().setFromEuler(new THREE.Euler(...r, 'YXZ')), new THREE.Vector3(...(typeof s === 'number' ? [s, s, s] : s)));
  g.applyMatrix4(m);
  return g;
}
export function merge(list) {
  const geos = list.map(clean);
  const merged = mergeGeometries(geos, false);
  if (!merged) throw new Error('merge failed');
  return merged;
}
export function bounds(g) {
  g.computeBoundingBox();
  return g.boundingBox.clone();
}
/** Move so the lowest point is at `y` (default 0) and the model is centered on x and z. */
export function ground(g, { y = 0, center = true } = {}) {
  const b = bounds(g);
  g.translate(center ? -(b.min.x + b.max.x) / 2 : 0, y - b.min.y, center ? -(b.min.z + b.max.z) / 2 : 0);
  return g;
}
/** Deterministic random in [0,1). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const lerp3 = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);
