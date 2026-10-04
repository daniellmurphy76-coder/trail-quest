/**
 * `buildAvatar`: the Scout the game draws, for the player, the Den Chief and the editor preview.
 *
 * It wears Kenney's Blocky Scout model (see blocky/): a rigged, animated CC0 character with a skin painted from
 * the `AvatarConfig`, hair, hat and the rest as attachments, and idle, walk, run, cheer and wave clips.
 *
 * The model is a small file loaded once. Until it arrives (and for good if it never does) the Scout is the
 * procedural blocky figure from procedural.ts, so a Scout is on screen from the first frame. When the model is
 * ready the rig swaps itself in place: same `root`, same look, same emote, no caller has to do anything.
 *
 * The contract is exactly the one the callers already use: `root`, `config`, `emote`, `setConfig`, `update`,
 * `play`, `dispose`. Feet at y = 0, the front is +z, a regular build stands 1.8 units tall.
 */
import * as THREE from 'three';
import type { AvatarConfig } from '../../save/types';
import { createBlockyRig, type BlockyRig } from './blocky/rig';
import { cancelBlockyWait, getBlockyAsset, requestBlockyModel } from './blocky/model';
import { fillAvatar } from './options';
import { buildProceduralAvatar } from './procedural';
import type { AvatarRig, AvatarRigOptions, AvatarState, Emote } from './rig-types';

export type { AvatarRig, AvatarRigOptions, AvatarState, Emote } from './rig-types';

export function buildAvatar(config: AvatarConfig, options: AvatarRigOptions = {}): AvatarRig {
  const rank = options.rank ?? 'wolf';
  const cord = options.denChiefCord ?? false;
  const blob = options.blobShadow ?? true;
  let current = fillAvatar(config, rank);

  const root = new THREE.Group();
  root.name = 'avatar';

  let fallback: AvatarRig | null = null;
  let blocky: BlockyRig | null = null;
  let disposed = false;

  /** Put the Kenney model on, if it is loaded, carrying the look and the emote over. */
  const showModel = (): void => {
    if (disposed || blocky) return;
    const model = getBlockyAsset();
    if (!model) return;
    try {
      const next = createBlockyRig(model, current, { rank, denChiefCord: cord, blobShadow: blob });
      if (fallback) next.play(fallback.emote);
      root.add(next.group);
      blocky = next;
    } catch (err) {
      console.warn('[avatar] the Scout model would not build, keeping the plain blocky Scout', err);
      return;
    }
    if (fallback) {
      fallback.dispose();
      fallback = null;
    }
  };

  const onSettled = (): void => showModel();

  showModel();
  if (!blocky) {
    const plain = buildProceduralAvatar(config, options);
    plain.root.name = 'avatar-fallback';
    root.add(plain.root);
    fallback = plain;
    requestBlockyModel(onSettled);
  }

  const active = (): { config: Readonly<AvatarRig['config']>; emote: Emote } & Pick<AvatarRig, 'setConfig' | 'update' | 'play'> =>
    (blocky ?? fallback)!;

  return {
    root,
    get config() {
      return active().config;
    },
    get emote() {
      return active().emote;
    },
    setConfig(next) {
      current = fillAvatar(next, rank);
      active().setConfig(next);
    },
    update(dt: number, state: AvatarState) {
      active().update(dt, state);
    },
    play(emote: Emote) {
      active().play(emote);
    },
    dispose() {
      disposed = true;
      cancelBlockyWait(onSettled);
      blocky?.dispose();
      fallback?.dispose();
      blocky = null;
      fallback = null;
      root.removeFromParent();
    },
  };
}
