/**
 * The 3D world that runs underneath every screen: renderer, loop, input, Base Camp, the player,
 * the follow camera and the floating name tags. Nothing here knows about profiles or quests;
 * the app sets what happens when the player talks to the Den Chief with `setDenChiefHandler`.
 */
import * as THREE from 'three';
import { FollowCamera, type FollowTarget } from '../engine/camera';
import { Input } from '../engine/input';
import { WorldLabels, type WorldLabel } from '../engine/labels';
import { GameLoop } from '../engine/loop';
import { Renderer } from '../engine/renderer';
import { Player } from '../player/controller';
import { createBaseCamp } from '../world/base-camp';
import { findInteractableInRange, type Interactable, type Zone } from '../world/zone';

const SKY = 0x87ceeb;
const DEN_CHIEF_ID = 'den-chief';

export interface World {
  renderer: Renderer;
  loop: GameLoop;
  input: Input;
  scene: THREE.Scene;
  zone: Zone;
  player: Player;
  labels: WorldLabels;
  follow: FollowCamera;
  /** What happens when the player talks to the Den Chief. Replaces any earlier handler. */
  setDenChiefHandler(handler: () => void): void;
  /** The name floating above the guide (a profile can rename the Den Chief). */
  setGuideName(name: string): void;
}

export function createWorld(canvas: HTMLCanvasElement, ui: HTMLElement): World {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY);
  scene.fog = new THREE.Fog(SKY, 45, 95);

  let denChiefHandler: () => void = () => {};
  const zone = createBaseCamp({ onTalkToDenChief: () => denChiefHandler() });
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

  const renderer = new Renderer(canvas);
  renderer.onResize((w, h) => follow.setAspect(w / h));

  const input = new Input({ target: canvas, ui });

  const labels = new WorldLabels(ui, follow.camera);
  const nameTags = new Map<string, WorldLabel>();
  for (const item of zone.interactables) {
    if (item.nameTag) {
      nameTags.set(
        item.id,
        labels.add({ text: item.nameTag, position: item.position, offsetY: 0.5, className: 'tq-nametag' }),
      );
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

  return {
    renderer,
    loop,
    input,
    scene,
    zone,
    player,
    labels,
    follow,
    setDenChiefHandler(handler) {
      denChiefHandler = handler;
    },
    setGuideName(name) {
      nameTags.get(DEN_CHIEF_ID)?.setText(name);
    },
  };
}
