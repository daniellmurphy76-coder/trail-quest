import * as THREE from 'three';
import './style.css';
import { mulberry32 } from './engine/seed';

// Phase 0 placeholder scene. Will be refactored into src/engine, src/world and src/player.
const canvas = document.getElementById('game') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLDivElement;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);

scene.add(new THREE.HemisphereLight(0xffffff, 0x4a7c3a, 1.1));
const sun = new THREE.DirectionalLight(0xffffff, 1.4);
sun.position.set(30, 50, 20);
scene.add(sun);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(200, 200),
  new THREE.MeshLambertMaterial({ color: 0x4caf50 }),
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

// Placeholder trees: cone on cylinder, placed from a seeded PRNG so every load looks the same.
const trunkGeo = new THREE.CylinderGeometry(0.3, 0.4, 2, 8);
const leafGeo = new THREE.ConeGeometry(1.6, 4, 8);
const trunkMat = new THREE.MeshLambertMaterial({ color: 0x7b5230 });
const leafMat = new THREE.MeshLambertMaterial({ color: 0x2f6b3a });
const rand = mulberry32(2026);
for (let i = 0; i < 20; i++) {
  const angle = rand() * Math.PI * 2;
  const radius = 8 + rand() * 40; // keep a clearing around the scout
  const scale = 0.8 + rand() * 0.8;
  const tree = new THREE.Group();
  const trunk = new THREE.Mesh(trunkGeo, trunkMat);
  trunk.position.y = 1;
  const leaves = new THREE.Mesh(leafGeo, leafMat);
  leaves.position.y = 4;
  tree.add(trunk, leaves);
  tree.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
  tree.scale.setScalar(scale);
  scene.add(tree);
}

const scout = new THREE.Mesh(
  new THREE.CapsuleGeometry(0.5, 1, 4, 12),
  new THREE.MeshLambertMaterial({ color: 0xf2c14e }),
);
scene.add(scout);

const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 400);
camera.position.set(0, 5, 9);
camera.lookAt(0, 1, 0);

function resize(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// Small top-left pill with a build stamp.
const pill = document.createElement('div');
pill.textContent = `Trail Quest · Phase 0 · ${import.meta.env.MODE}`;
pill.style.cssText =
  'position:absolute;top:max(12px,env(safe-area-inset-top));left:max(12px,env(safe-area-inset-left));' +
  'padding:6px 14px;border-radius:999px;background:rgba(0,0,0,0.55);color:#fff;font-size:20px;';
ui.appendChild(pill);

// THREE.Clock is deprecated since r183 and warns in the console; Timer gives the same delta.
const timer = new THREE.Timer();
let t = 0;
function frame(now: number): void {
  timer.update(now);
  const dt = timer.getDelta();
  t += dt;
  scout.position.y = 1 + Math.sin(t * 2.5) * 0.12;
  scout.rotation.y += dt * 0.6;
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
