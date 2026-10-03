import * as THREE from 'three';
import './style.css';
import { FollowCamera, type FollowTarget } from './engine/camera';
import { Input } from './engine/input';
import { WorldLabels } from './engine/labels';
import { GameLoop } from './engine/loop';
import { Renderer } from './engine/renderer';
import { Player } from './player/controller';
import { createBaseCamp } from './world/base-camp';
import { findInteractableInRange, type Interactable } from './world/zone';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLDivElement;

// ---- scene --------------------------------------------------------------------------------------

const SKY = 0x87ceeb;
const scene = new THREE.Scene();
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, 45, 95);

const zone = createBaseCamp({ onTalkToDenChief: () => showToast("Den Chief: Hi! Today's Trail is coming soon.") });
scene.add(zone.root);

const player = new Player({ bodyColor: 0xf2c14e });
player.setPosition(zone.spawn, Math.PI); // facing -z, toward the campfire
scene.add(player.root);

const follow = new FollowCamera();
const followTarget: FollowTarget = {
  position: player.root.position,
  get facing() {
    return player.facing;
  },
  get isMoving() {
    return player.isMoving;
  },
};
follow.snapTo({ position: player.position, facing: player.facing, isMoving: false });

// ---- engine -------------------------------------------------------------------------------------

const renderer = new Renderer(canvas);
renderer.onResize((w, h) => follow.setAspect(w / h));

const input = new Input({ target: canvas, ui });

// ---- overlay ------------------------------------------------------------------------------------

const pill = document.createElement('div');
pill.className = 'tq-pill';
pill.textContent = 'Trail Quest · Phase 2';
ui.appendChild(pill);

const labels = new WorldLabels(ui, follow.camera);
for (const item of zone.interactables) {
  if (item.nameTag) {
    labels.add({ text: item.nameTag, position: item.position, offsetY: 0.5, className: 'tq-nametag' });
  }
}
// The prompt sits just above the name tag, stacked in screen pixels so it never overlaps at any distance.
const prompt = labels.add({
  text: '',
  position: new THREE.Vector3(),
  offsetY: 0.5,
  screenOffsetY: -52,
  className: 'tq-prompt',
});
prompt.visible = false;

let toastEl: HTMLDivElement | null = null;
let toastTimer = 0;

/** Temporary message. A real dialog UI replaces this later. */
function showToast(text: string): void {
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.className = 'tq-toast';
    toastEl.setAttribute('role', 'status');
    ui.appendChild(toastEl);
  }
  toastEl.textContent = text;
  toastEl.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    if (toastEl) toastEl.hidden = true;
  }, 3000);
}

function promptText(item: Interactable): string {
  switch (input.lastDevice) {
    case 'keyboard':
      return 'Press E';
    case 'gamepad':
      return 'Press A';
    default:
      return item.label; // the touch button already says it; this is only a fallback
  }
}

/** Show the prompt and action label for whatever is in reach, and fire it on an action press. */
function handleInteraction(near: Interactable | null, actionPressed: boolean): void {
  const touch = input.lastDevice === 'touch';
  input.setActionLabel(near ? near.label : '');
  prompt.visible = near !== null && !touch;
  if (near) {
    prompt.position.copy(near.position);
    prompt.setText(promptText(near));
    if (actionPressed) near.onInteract();
  }
}

// ---- loop ---------------------------------------------------------------------------------------

const loop = new GameLoop({
  onUpdate(dt) {
    const state = input.update();
    player.viewYaw = follow.viewYaw;
    player.update(dt, state, zone);
    zone.update(dt);
    const near = findInteractableInRange(player.position.x, player.position.z, zone.interactables);
    handleInteraction(near, state.actionPressed);
  },
  onRender(alpha, frameDt) {
    player.interpolate(alpha);
    follow.update(frameDt, followTarget);
    labels.update(renderer.width, renderer.height);
    renderer.render(scene, follow.camera);
  },
});
loop.start();

// Dev-only handle so the browser tools can read draw calls and drive the player.
if (import.meta.env.DEV) {
  Object.assign(window, { __tq: { renderer, scene, zone, player, follow, input, loop } });
}
