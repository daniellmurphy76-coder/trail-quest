/**
 * The 3D world that runs underneath every screen: renderer, loop, input, the zones, the player,
 * the follow camera and the floating name tags. Nothing here knows about profiles or quests;
 * the app sets what happens when the player talks to the Den Chief with `setDenChiefHandler`
 * and what the "Back to camp" trail sign does with `setReturnHandler`.
 *
 * Zones are swapped by `travelTo` (see travel.ts): one zone is in the scene at a time, and the
 * update loop always works on the current one (bounds, animation, interactables).
 */
import * as THREE from 'three';
import type { RankId, ZoneId } from '../activities/types';
import { FollowCamera, type FollowTarget } from '../engine/camera';
import { initDevtools } from '../engine/devtools';
import { createEnvironment } from '../engine/environment';
import { Input } from '../engine/input';
import { WorldLabels, type WorldLabel } from '../engine/labels';
import { createLookStore, type LookStore } from '../engine/look';
import { GameLoop } from '../engine/loop';
import { createPostPipeline, type PostPipeline } from '../engine/post';
import { AutoDowngrade, getQuality, parseQualityOverride, setQuality, type QualityTier } from '../engine/quality';
import { Renderer } from '../engine/renderer';
import { defaultAvatar } from '../player/avatar/options';
import { Player } from '../player/controller';
import type { AvatarConfig } from '../save/types';
import { setHorizonQuality } from '../world/horizon';
import { setOccluderTarget } from '../world/occluder';
import { tickWind } from '../world/wind';
import { findInteractableInRange, type Interactable, type Zone } from '../world/zone';
import { createZone, type ZoneDeps } from '../world/zones';
import { guidedStartPose } from './guided-start';
import { ObjectiveCue } from './objective';
import { createCompass, type Compass } from './screens/compass';
import { createZoneTraveler } from './travel';
import { createVeil } from './veil';

const DEN_CHIEF_ID = 'den-chief';

export interface World {
  renderer: Renderer;
  /** The look of the world (light, sky, fog, post effects). `look.set({ ... })` tunes it live. */
  look: LookStore;
  /** The post pipeline: ambient occlusion, bloom, tone mapping, SMAA. Draws the scene every frame. */
  post: PostPipeline;
  loop: GameLoop;
  input: Input;
  scene: THREE.Scene;
  /** The zone the player is in now. It changes when the player travels. */
  readonly zone: Zone;
  player: Player;
  /**
   * Change the Scout's look in place (the avatar editor, or a profile being chosen). Pass the
   * profile's `rank` so a v1 avatar with no neckerchief color gets its rank's color.
   */
  setPlayerAvatar(config: AvatarConfig, rank?: RankId): void;
  labels: WorldLabels;
  follow: FollowCamera;
  /** What happens when the player talks to the Den Chief. Replaces any earlier handler. */
  setDenChiefHandler(handler: () => void): void;
  /** The name floating above the guide (a profile can rename the Den Chief). */
  setGuideName(name: string): void;
  /** The HUD compass. Point it at a waypoint with `compass.setTarget(point, 'Label')`. */
  compass: Compass;
  /**
   * Seconds the player has stood still at Base Camp with nothing open. Drops to 0 whenever the
   * player moves or a dialog or screen is open. Drives the "stuck for 8 seconds" controls hint.
   */
  readonly idleSeconds: number;
  /**
   * Guided start: put the player two units from the Den Chief, facing them, with the camera
   * snapped behind. Called when a Scout arrives at Base Camp. Jumps to Base Camp first (no fade)
   * when the player is somewhere else.
   */
  placeAtGuide(): void;
  /**
   * Show or hide the "go here" cues for the Den Chief: the bobbing arrow over their head and the
   * compass pointing at them. Turn it on while today's trail is waiting; off while a session runs.
   * Safe to call as often as you like: it acts on changes only, and it never clears a compass
   * target someone else has set (a waypoint) when it turns off. The cues only ever show at Base
   * Camp; asking for them elsewhere is remembered and takes effect on arrival.
   */
  setObjectiveVisible(visible: boolean): void;
  /** Which zone the player is in. */
  currentZoneId(): ZoneId;
  /**
   * Walk to another zone: the screen fades out, the zone swaps, the player stands at its spawn
   * looking in, and the screen fades back in. Resolves when it is clear again. Does nothing when
   * the player is already there. Requests queue, so asking twice in a row is safe.
   */
  travelTo(zoneId: ZoneId): Promise<void>;
  /** What the "Back to camp" trail sign does. Defaults to `travelTo('base-camp')`. */
  setReturnHandler(handler: () => void): void;
  /** Hear about every zone change (right after the swap, while the screen is still covered). Returns a stop function. */
  onZoneChange(listener: (zone: Zone) => void): () => void;
  /** Run a function on every fixed simulation step, after the zone has updated. Returns a stop function. */
  onUpdate(fn: (dt: number) => void): () => void;
}

export function createWorld(canvas: HTMLCanvasElement, ui: HTMLElement): World {
  const scene = new THREE.Scene();
  const look = createLookStore();
  // The renderer comes first: the sky is baked into an environment map with it.
  const renderer = new Renderer(canvas, look.get());
  let tier: QualityTier = getQuality();
  // Sun, sky, fog and clouds belong to the scene, not to a zone, so they carry across travel.
  const environment = createEnvironment(scene, { quality: tier, look: look.get(), renderer: renderer.gl });

  let denChiefHandler: () => void = () => {};
  let returnHandler: () => void = () => {
    traveler.travelTo('base-camp').catch((err: unknown) => console.error(err));
  };
  const zoneDeps: ZoneDeps = {
    onTalkToDenChief: () => denChiefHandler(),
    onReturnToBaseCamp: () => returnHandler(),
  };
  const baseCamp = createZone('base-camp', zoneDeps);
  scene.add(baseCamp.root);
  // Every zone built so far, the same set the traveler keeps (it builds each zone once and caches it).
  // A tier drop reaches all of them, including the ones that are not in the scene right now.
  const builtZones = new Map<ZoneId, Zone>([[baseCamp.id, baseCamp]]);

  // The look is replaced by the profile's avatar once the app knows who is playing (setPlayerAvatar).
  const player = new Player({ avatar: defaultAvatar('wolf'), rank: 'wolf' });
  player.setPosition(baseCamp.spawn, Math.PI); // facing -z, toward the campfire
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

  const post = createPostPipeline(renderer.gl, scene, follow.camera, look.get(), tier);
  renderer.onResize((w, h) => {
    follow.setAspect(w / h);
    post.setSize(w, h);
  });
  look.subscribe((next) => {
    environment.setLook(next);
    renderer.applyLook(next);
    post.setSettings(next);
  });

  // Quality: a tier forced with ?quality= stays; otherwise a slow device steps down a tier and
  // never back up (see AutoDowngrade).
  const autoDowngrade = parseQualityOverride(window.location.search) === null ? new AutoDowngrade(tier) : null;
  function applyTier(next: QualityTier): void {
    if (next === tier) return;
    tier = next;
    setQuality(next);
    environment.setQuality(next);
    post.setTier(next);
    // The horizon of every built zone follows the tier (low drops the far peaks and half the distant
    // trees). A zone built later reads the new tier itself (setQuality above), so it needs no call.
    for (const zone of builtZones.values()) setHorizonQuality(zone.root, next);
  }
  const devtools = initDevtools({
    renderer: renderer.gl,
    ui,
    look,
    post,
    tier: {
      get: () => tier,
      set(next) {
        applyTier(next);
        autoDowngrade?.setTier(next);
      },
    },
  });

  const input = new Input({ target: canvas, ui });

  const labels = new WorldLabels(ui, follow.camera);

  // Name tags follow the current zone's interactables: rebuilt on every swap.
  let nameTags = new Map<string, WorldLabel>();
  let guideName = baseCamp.interactables.find((item) => item.id === DEN_CHIEF_ID)?.nameTag ?? 'Den Chief';
  function bindNameTags(zone: Zone): void {
    for (const tag of nameTags.values()) labels.remove(tag);
    nameTags = new Map();
    for (const item of zone.interactables) {
      if (!item.nameTag) continue;
      const text = item.id === DEN_CHIEF_ID ? guideName : item.nameTag;
      nameTags.set(item.id, labels.add({ text, position: item.position, offsetY: 0.5, className: 'tq-nametag' }));
    }
  }
  bindNameTags(baseCamp);
  const guide = baseCamp.interactables.find((item) => item.id === DEN_CHIEF_ID) ?? null;

  // A bobbing arrow above the Den Chief says "go here". It sits above the prompt (which stacks
  // 52px over the name tag), so the two never overlap. The text-style selector (FE0E) keeps iPad
  // Safari from swapping the glyph for a colour emoji.
  const objective = labels.add({
    text: '⬇︎',
    position: guide ? guide.position : new THREE.Vector3(),
    offsetY: 0.5,
    screenOffsetY: -96,
    className: 'tq-objective',
  });
  objective.element.setAttribute('aria-hidden', 'true');
  objective.visible = false;

  const compass = createCompass(ui);
  const cue = new ObjectiveCue(objective, compass, guide ? guide.position : null, guideName);
  let objectiveWanted = false;
  /** The cues belong to Base Camp: wanted and here, or off. */
  function applyObjective(): void {
    cue.setVisible(objectiveWanted && traveler.zone.id === 'base-camp');
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

  let idleSeconds = 0;
  const zoneListeners = new Set<(zone: Zone) => void>();
  const updaters = new Set<(dt: number) => void>();

  const veil = createVeil(ui);
  const traveler = createZoneTraveler({
    scene,
    initial: baseCamp,
    createZone: (id) => {
      const zone = createZone(id, zoneDeps);
      builtZones.set(id, zone);
      return zone;
    },
    player,
    follow,
    followTarget,
    veil,
    onSwap(zone) {
      bindNameTags(zone);
      prompt.visible = false;
      input.setActionLabel('');
      idleSeconds = 0;
      applyObjective();
      for (const listener of [...zoneListeners]) listener(zone);
    },
  });

  const loop = new GameLoop({
    onUpdate(dt) {
      const zone = traveler.zone;
      const state = input.update();
      player.viewYaw = follow.viewYaw;
      player.update(dt, state, zone);
      // Time spent in a dialog or screen is not "standing still": input is off, so restart the count.
      idleSeconds = player.isMoving || !input.isEnabled ? 0 : idleSeconds + dt;
      zone.update(dt);
      tickWind(dt); // one wind clock for every swaying plant and tree, whichever zone is showing
      for (const fn of [...updaters]) fn(dt);
      const near = findInteractableInRange(player.position.x, player.position.z, zone.interactables);
      handleInteraction(near, state.actionPressed);
    },
    onRender(alpha, frameDt) {
      player.interpolate(alpha);
      follow.update(frameDt, followTarget);
      compass.update(player.root.position, follow.viewYaw);
      labels.update(renderer.width, renderer.height);
      environment.update(frameDt, player.root.position, follow.camera);
      setOccluderTarget(player.root.position); // props between the camera and the Scout fade
      renderer.beginFrame();
      post.render(frameDt);
      devtools.frame(frameDt);
      const cheaper = autoDowngrade?.sample(frameDt);
      if (cheaper) applyTier(cheaper);
    },
  });
  loop.start();

  return {
    renderer,
    look,
    post,
    loop,
    input,
    scene,
    get zone() {
      return traveler.zone;
    },
    player,
    setPlayerAvatar(config, rank) {
      player.setAvatar(config, rank);
    },
    labels,
    follow,
    setDenChiefHandler(handler) {
      denChiefHandler = handler;
    },
    setGuideName(name) {
      guideName = name;
      nameTags.get(DEN_CHIEF_ID)?.setText(name);
      cue.setName(name);
    },
    compass,
    get idleSeconds() {
      return idleSeconds;
    },
    placeAtGuide() {
      if (!guide) return;
      traveler.jumpTo('base-camp');
      const pose = guidedStartPose(guide.position, baseCamp.spawn, guide.radius, baseCamp.bounds);
      player.setPosition(new THREE.Vector3(pose.x, 0, pose.z), pose.facing);
      follow.snapTo(followTarget);
      idleSeconds = 0;
    },
    setObjectiveVisible(visible) {
      objectiveWanted = visible;
      applyObjective();
    },
    currentZoneId: () => traveler.zone.id,
    travelTo: (zoneId) => traveler.travelTo(zoneId),
    setReturnHandler(handler) {
      returnHandler = handler;
    },
    onZoneChange(listener) {
      zoneListeners.add(listener);
      return () => zoneListeners.delete(listener);
    },
    onUpdate(fn) {
      updaters.add(fn);
      return () => updaters.delete(fn);
    },
  };
}
