// Rebuilds the nature models in public/assets/models from the original downloads. Not part of the normal build:
// the finished GLBs are committed, this is here so the art can be reproduced or retuned.
//
//   npm i --no-save @gltf-transform/core@4 @gltf-transform/extensions@4 @gltf-transform/functions@4 pngjs@7
//   node scripts/assets-build-nature.mjs --kaykit <KayKit_Forest_Nature_Pack_1.0_FREE>/Assets/gltf \
//        --public public --kenney <folder holding untouched kenney-nature-kit/, kenney-city-kit-commercial/, kenney-city-kit-suburban/>
//
// Add `--dry <dir>` to write the new models into <dir> and change nothing else. Source downloads:
//   KayKit Forest Nature Pack (free tier): https://kaylousberg.itch.io/kaykit-forest   (CC0 1.0)
//   Kenney Nature Kit and City Kits:       https://kenney.nl/assets                      (CC0 1.0)
// The recipes (which source mesh becomes which manifest id, at what size) are in scripts/assets-nature/recipes.mjs and
// the palette is in scripts/assets-nature/lib.mjs (models) and tune.mjs (Kenney leftovers). See CREDITS.md.
try {
  await import('@gltf-transform/core');
  await import('@gltf-transform/functions');
  await import('pngjs');
} catch {
  console.error(
    'assets-build-nature needs a few packages that are not project dependencies. Run:\n' +
      '  npm i --no-save @gltf-transform/core@4 @gltf-transform/extensions@4 @gltf-transform/functions@4 pngjs@7',
  );
  process.exit(1);
}
await import('./assets-nature/build.mjs');
