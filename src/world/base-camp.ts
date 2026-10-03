import * as THREE from 'three';
import { assets } from '../engine/assets';
import { setShadowCasting } from '../engine/environment';
import { mulberry32 } from '../engine/seed';
import { createDenChief } from '../player/avatar/presets';
import { perimeterPoint, squareBounds } from './bounds';
import { createGround, createGroundApron } from './ground';
import {
  campfire,
  flagpole,
  instancedModel,
  lodge,
  rock,
  scatterModels,
  scatterPlants,
  tree,
  type AvoidCircle,
  type Placement,
  type Spot,
} from './props';
import type { Interactable, Zone } from './zone';

export interface BaseCampOptions {
  onTalkToDenChief: () => void;
}

const GROUND_SIZE = 60;
/** The player may walk this far from the center in x and z. Trees stand just outside. */
const WALK_HALF = 25;
const TREE_COUNT = 40;
const SEED = 2026;

const GRASS_COLOR = 0x5f9e45;
const DIRT_COLOR = 0xb89a6a;
/** Solid dirt out to this radius around the campfire, then it fades to grass over the feather. */
const CLEARING_RADIUS = 8;
const CLEARING_FEATHER = 3;
const PLANT_COUNT = 150;

/** Label height for the Den Chief: just above the hat of the tall avatar build (about 2.15 units). */
const DEN_CHIEF_HEIGHT = 2.3;
/** Seconds between the Den Chief's friendly waves. */
const WAVE_EVERY = 14;

/** Models that replace or add to the primitive props once they load. */
const TREE_MODELS = ['tree.pine', 'tree.pine.tall', 'tree.round', 'tree.oak'] as const;
const ROCK_MODELS = ['rock.large', 'rock.tall', 'rock.small'] as const;
const BASE_CAMP_MODELS = [
  ...TREE_MODELS,
  ...ROCK_MODELS,
  'campfire',
  'tent',
  'tent.small',
  'cabin',
  'signpost',
] as const;

/** Yaw that turns a model whose front is +z to look at (tx, tz) from (x, z). */
function yawToward(x: number, z: number, tx: number, tz: number): number {
  return Math.atan2(tx - x, tz - z);
}

/**
 * Base Camp: the hub. A dirt clearing in rolling grass, a ring of trees, a campfire, a flagpole, a
 * lodge, and the Den Chief. The zone carries no lights: the world's environment (sun, sky light,
 * fog) lights every zone, and the campfire adds its own warm point light.
 */
export function createBaseCamp(opts: BaseCampOptions): Zone {
  const root = new THREE.Group();
  root.name = 'base-camp';
  const rng = mulberry32(SEED);

  // Ground and plants use their own random streams, so the trees and rocks never move when the
  // ground or the plants change.
  root.add(createGroundApron(GRASS_COLOR));
  root.add(
    createGround({
      size: GROUND_SIZE,
      rng: mulberry32(SEED + 2),
      grass: GRASS_COLOR,
      dirt: DIRT_COLOR,
      path: { center: { x: 0, z: 0 }, radius: CLEARING_RADIUS, feather: CLEARING_FEATHER },
    }),
  );

  // Ring of trees just outside the walkable square, so the edge reads as a forest wall.
  const treeSpots: Spot[] = [];
  for (let i = 0; i < TREE_COUNT; i++) {
    treeSpots.push(perimeterPoint((i + rng() * 0.7) / TREE_COUNT, WALK_HALF + 1.5 + rng() * 2));
  }
  const primitiveTrees = tree(rng, treeSpots);
  root.add(primitiveTrees);

  const rockSpots: Spot[] = [
    { x: 10, z: 7 },
    { x: 11.2, z: 8.1 },
    { x: -12, z: 11 },
    { x: 14, z: -10 },
    { x: -6, z: 17 },
    { x: 19, z: 3 },
  ];
  const primitiveRocks = rock(rng, rockSpots);
  root.add(primitiveRocks);

  const fire = campfire();
  root.add(fire.root);

  const pole = flagpole();
  pole.position.set(-8, 0, -8);
  root.add(pole);

  const cabin = lodge();
  cabin.position.set(-17, 0, -12);
  cabin.rotation.y = Math.atan2(-cabin.position.x, -cabin.position.z); // door faces the campfire
  root.add(cabin);

  const spawn = new THREE.Vector3(0, 0, 9);

  // The Den Chief is the same blocky avatar rig as the player, in a preset look (see player/avatar/presets).
  const denChief = createDenChief();
  denChief.root.position.set(3.4, 0, -1.8);
  denChief.root.rotation.y = Math.atan2(spawn.x - denChief.root.position.x, spawn.z - denChief.root.position.z);
  root.add(denChief.root);

  // Plants gather around the clearing's edge and at the feet of props, and keep off the dirt, the
  // spawn point, and the doorsteps. They are decoration only: nothing here blocks the player.
  const tentSpots = [
    { x: 6, z: -16.5 },
    { x: 13.5, z: -15.5 },
  ];
  const smallTentSpot = { x: -1.5, z: -18.5 };
  const keepClear: AvoidCircle[] = [
    { x: 0, z: 0, radius: CLEARING_RADIUS + 2 },
    { x: spawn.x, z: spawn.z, radius: 2.5 },
    { x: pole.position.x, z: pole.position.z, radius: 1.8 },
    { x: cabin.position.x, z: cabin.position.z, radius: 7 },
    { x: -5.5, z: 3.5, radius: 1.6 }, // signpost
    ...rockSpots.map((r) => ({ x: r.x, z: r.z, radius: 1.8 })),
    ...tentSpots.map((t) => ({ ...t, radius: 3.2 })),
    { ...smallTentSpot, radius: 2.6 },
  ];
  const plantRng = mulberry32(SEED + 3);
  root.add(
    scatterPlants(
      plantRng,
      PLANT_COUNT,
      { minX: -(WALK_HALF - 0.5), maxX: WALK_HALF - 0.5, minZ: -(WALK_HALF - 0.5), maxZ: WALK_HALF - 0.5 },
      keepClear,
      { edgeFalloff: 3.5 },
    ),
  );

  const talk: Interactable = {
    id: 'den-chief',
    // y is the label height (see Interactable): just above the Den Chief's head.
    position: new THREE.Vector3(denChief.root.position.x, DEN_CHIEF_HEIGHT, denChief.root.position.z),
    radius: 2,
    label: 'Talk',
    nameTag: 'Den Chief',
    onInteract: opts.onTalkToDenChief,
  };

  // ---- progressive swap: primitives stay until the models arrive -----------------------------------
  // Draw calls after the swap (about 33): ground 2 (apron + ground), trees up to 4, rocks up to 3,
  // campfire 5 (model 2, flames 2, embers 1), flagpole 3, cabin 1, tents 2, signpost 1, plants up
  // to 8, Den Chief 7 (head, torso, two arms, two legs, blob shadow). Primitives only: about 28.
  // The sun's shadow pass draws the casting props a second time, about 20 more.
  let waveClock = 5; // the first wave comes a few seconds after the Scout arrives

  const swapInModels = (): void => {
    const modelRng = mulberry32(SEED + 1); // separate stream, so the primitive layout never shifts

    const trees = scatterModels('trees', TREE_MODELS, treeSpots, modelRng, [0.85, 1.3]);
    if (trees) {
      root.remove(primitiveTrees);
      root.add(trees);
    }

    const rocks = scatterModels('rocks', ROCK_MODELS, rockSpots, modelRng, [0.8, 1.4]);
    if (rocks) {
      root.remove(primitiveRocks);
      root.add(rocks);
    }

    fire.useModel();

    if (assets.has('cabin')) {
      const model = assets.instance('cabin');
      model.position.copy(cabin.position);
      model.rotation.y = cabin.rotation.y;
      setShadowCasting(model, true, true);
      root.remove(cabin);
      root.add(model);
    }

    // Camp extras that only exist once the art is here: tents ringed around the fire, a signpost.
    const tentPlacements: Placement[] = tentSpots.map((p) => ({ ...p, yaw: yawToward(p.x, p.z, 0, 0) }));
    const tents = instancedModel('tent', tentPlacements);
    if (tents) root.add(tents);
    const smallTent = instancedModel('tent.small', [
      { ...smallTentSpot, yaw: yawToward(smallTentSpot.x, smallTentSpot.z, 0, 0) },
    ]);
    if (smallTent) root.add(smallTent);

    if (assets.has('signpost')) {
      const sign = assets.instance('signpost');
      sign.position.set(-5.5, 0, 3.5);
      sign.rotation.y = 0.3;
      setShadowCasting(sign, true, true);
      root.add(sign);
    }
  };

  assets
    .load(BASE_CAMP_MODELS)
    .then(swapInModels)
    .catch((err: unknown) => {
      console.warn('[base-camp] could not swap in models, keeping placeholder art', err);
    });

  return {
    id: 'base-camp',
    root,
    bounds: squareBounds(WALK_HALF),
    spawn,
    interactables: [talk],
    update: (dt: number) => {
      fire.update(dt);
      waveClock -= dt;
      if (waveClock <= 0) {
        denChief.play('wave');
        waveClock = WAVE_EVERY;
      }
      denChief.update(dt, { moving: false, speed: 0 });
    },
  };
}
