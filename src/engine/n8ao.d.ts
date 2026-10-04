/**
 * Types for the parts of n8ao 2.0 this game uses. The package ships no declarations; this covers
 * `N8AOPostPass`, the pass for the pmndrs `postprocessing` composer, as documented in its README.
 */
declare module 'n8ao' {
  import type { Pass } from 'postprocessing';
  import type { Camera, Color, Scene } from 'three';

  export type N8AOQualityMode =
    | 'Performance'
    | 'Low'
    | 'Medium'
    | 'High'
    | 'Ultra'
    | 'Neural-Low'
    | 'Neural-Medium'
    | 'Neural-High';

  export interface N8AOConfiguration {
    /** World units. How far an occluder can be and still darken a point. */
    aoRadius: number;
    /** The occlusion is raised to this power: bigger is darker. */
    intensity: number;
    /** Fades the occlusion with distance, as a ratio of the radius. 1 is the safe default. */
    distanceFalloff: number;
    aoSamples: number;
    denoiseSamples: number;
    denoiseRadius: number;
    denoiseIterations: number;
    /** Compute at half resolution, then upsample with depth awareness. */
    halfRes: boolean;
    depthAwareUpsampling: boolean;
    /** Draw transparent objects twice more to keep them from being occluded. Expensive. */
    transparencyAware: boolean;
    /** Color of the occlusion (sRGB). Black by default. */
    color: Color;
    colorMultiply: boolean;
    gammaCorrection: boolean;
    screenSpaceRadius: boolean;
    accumulate: boolean;
    neuralDenoise: boolean;
  }

  export class N8AOPostPass extends Pass {
    constructor(scene: Scene, camera: Camera, width?: number, height?: number);
    /** Live settings. Assigning a changed value restarts the effect (some also rebuild shaders). */
    configuration: N8AOConfiguration;
    /**
     * While true (the default), the pass looks through the scene every frame and switches
     * `transparencyAware` on if it finds anything transparent. Set false to stop that.
     */
    autoDetectTransparency: boolean;
    setQualityMode(mode: N8AOQualityMode): void;
    enableDebugMode(): void;
    disableDebugMode(): void;
  }
}
