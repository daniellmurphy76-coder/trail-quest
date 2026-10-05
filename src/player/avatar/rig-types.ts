/**
 * The avatar rig contract: what the player controller, the Den Chief and the editor preview call.
 * Two things implement it: the procedural Scout (procedural.ts) and the composite `buildAvatar`
 * (rig.ts), which wears the Kenney model once it has loaded.
 */
import type * as THREE from 'three';
import type { RankId } from '../../activities/types';
import type { AvatarConfig } from '../../save/types';
import type { FilledAvatar } from './options';

export type Emote = 'idle' | 'walk' | 'cheer' | 'wave';

export interface AvatarState {
  /** True while the character is walking. Changes start and stop the walk cycle. */
  moving: boolean;
  /** Ground speed in units per second; scales the stride. */
  speed: number;
}

/** Headgear only a grown-up guide wears. It is drawn instead of the look's hat, in the look's hat color. */
export type NpcHeadgear = 'fire-helmet' | 'chef-hat';

/** Things a grown-up guide wears on the torso. */
export type NpcTorsoGear = 'apron' | 'sash' | 'whistle' | 'reflective-stripes' | 'badge';

/**
 * What the zone guides wear on top of a look. It is NOT part of `AvatarConfig`: it is never saved, never offered in
 * the avatar editor, and `fillAvatar` knows nothing about it. Like the cord, it is fixed when the rig is built.
 */
export interface NpcGear {
  headgear?: NpcHeadgear;
  torso?: readonly NpcTorsoGear[];
  /** Wear the Scout neckerchief. Default true; grown-ups leave it off. */
  neckerchief?: boolean;
  /** Color of the sash, the apron and the whistle cord. Default: the look's neckerchief color. */
  accent?: string;
}

export interface AvatarRigOptions {
  /** Decides defaults for fields the config leaves out (the neckerchief color). Default 'wolf'. */
  rank?: RankId;
  /** Draw the Den Chief cord across the chest. */
  denChiefCord?: boolean;
  /** Gear for a zone guide (see `NpcGear`). Default: none, the plain Scout. */
  npcGear?: NpcGear;
  /** Draw the soft blob shadow under the feet. Default true. */
  blobShadow?: boolean;
}

export interface AvatarRig {
  /** Add this to the scene. Feet at y = 0, front is +z. */
  readonly root: THREE.Group;
  /** The look now showing, with every field filled in. */
  readonly config: Readonly<FilledAvatar>;
  /** What the rig is playing now. A one-shot (cheer, wave) returns to idle or walk by itself. */
  readonly emote: Emote;
  /** Change the look. Only the parts whose look changed are rebuilt. */
  setConfig(config: AvatarConfig): void;
  /** Advance the animation. Call every step. A change in `moving` starts or stops the walk cycle. */
  update(dt: number, state: AvatarState): void;
  /** Start an emote. 'cheer' and 'wave' play once; 'idle' and 'walk' loop until changed. */
  play(emote: Emote): void;
  /** Free the geometry. The rig must not be used afterwards. */
  dispose(): void;
}
