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

export interface AvatarRigOptions {
  /** Decides defaults for fields the config leaves out (the neckerchief color). Default 'wolf'. */
  rank?: RankId;
  /** Draw the Den Chief cord across the chest. */
  denChiefCord?: boolean;
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
