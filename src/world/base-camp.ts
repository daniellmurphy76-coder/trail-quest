import * as THREE from 'three';
import { mulberry32 } from '../engine/seed';
import { perimeterPoint, squareBounds } from './bounds';
import { campfire, flagpole, lodge, personPlaceholder, rock, tree, type Spot } from './props';
import type { Interactable, Zone } from './zone';

export interface BaseCampOptions {
  onTalkToDenChief: () => void;
}

const GROUND_SIZE = 60;
/** The player may walk this far from the center in x and z. Trees stand just outside. */
const WALK_HALF = 25;
const TREE_COUNT = 40;
const SEED = 2026;

const DEN_CHIEF_COLOR = 0x2f6fd0; // blue, easy to tell from the scout's gold
const DEN_CHIEF_HEIGHT = 2.3;

/** Base Camp: the hub. Flat clearing, a ring of trees, a campfire, a flagpole, a lodge, and the Den Chief. */
export function createBaseCamp(opts: BaseCampOptions): Zone {
  const root = new THREE.Group();
  root.name = 'base-camp';
  const rng = mulberry32(SEED);

  // Lighting lives with the zone so each zone can set its own mood.
  root.add(new THREE.HemisphereLight(0xe4f4ff, 0x4a7c3a, 1.1));
  const sun = new THREE.DirectionalLight(0xfff4e0, 1.4);
  sun.position.set(30, 50, 20);
  root.add(sun);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE).rotateX(-Math.PI / 2),
    new THREE.MeshLambertMaterial({ color: 0x4caf50 }),
  );
  root.add(ground);

  const clearing = new THREE.Mesh(
    new THREE.CircleGeometry(9, 40).rotateX(-Math.PI / 2),
    new THREE.MeshLambertMaterial({ color: 0xc9ad78 }),
  );
  clearing.position.y = 0.02;
  root.add(clearing);

  // Ring of trees just outside the walkable square, so the edge reads as a forest wall.
  const treeSpots: Spot[] = [];
  for (let i = 0; i < TREE_COUNT; i++) {
    treeSpots.push(perimeterPoint((i + rng() * 0.7) / TREE_COUNT, WALK_HALF + 1.5 + rng() * 2));
  }
  root.add(tree(rng, treeSpots));

  const rockSpots: Spot[] = [
    { x: 10, z: 7 },
    { x: 11.2, z: 8.1 },
    { x: -12, z: 11 },
    { x: 14, z: -10 },
    { x: -6, z: 17 },
    { x: 19, z: 3 },
  ];
  root.add(rock(rng, rockSpots));

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

  const denChief = personPlaceholder(DEN_CHIEF_COLOR, DEN_CHIEF_HEIGHT);
  denChief.position.set(3.4, 0, -1.8);
  denChief.rotation.y = Math.atan2(spawn.x - denChief.position.x, spawn.z - denChief.position.z);
  root.add(denChief);

  const talk: Interactable = {
    id: 'den-chief',
    // y is the label height (see Interactable): just above the Den Chief's head.
    position: new THREE.Vector3(denChief.position.x, DEN_CHIEF_HEIGHT, denChief.position.z),
    radius: 2,
    label: 'Talk',
    nameTag: 'Den Chief',
    onInteract: opts.onTalkToDenChief,
  };

  return {
    id: 'base-camp',
    root,
    bounds: squareBounds(WALK_HALF),
    spawn,
    interactables: [talk],
    update: (dt: number) => fire.update(dt),
  };
}
