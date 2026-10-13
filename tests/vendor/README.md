# Current engine provenance

The unissued 0.6.0 class embeds `webaudio-tinysynth-2cb8b40.min.js` from fork CI distribution commit `2cb8b405ede0d91a431f3ef3e4175f0bf3b0c18a`. Its bot commit names merged source `8fd8b94c8bb1fd2df3d144404620520c4b7f3725` and [the successful build workflow](https://github.com/Provable-Games/webaudio-tinysynth/actions/runs/38269640215). The established `scripts/vendor_engine.mjs` helper copies that commit's exact minified script and NOTICE; neither file is patched locally.

`ENGINE_BUILD` and the manifest are non-provisional and record the source SHA-256, build recipe, lockfile, source map and CI workflow. To reproduce, check out the distribution commit in an isolated fork clone, run `npm ci`, then `node scripts/build.js <output-dir>` and compare both outputs against the committed files. The pinned compiler is Terser 5.51.2.

- Engine: 47,424 bytes, SHA-256 `df839b0d8b0479e799b2b19bdf5c714d92287a501d9d026335a0854ad491da65`.
- Source: SHA-256 `8ca7fa60212ac58649337c507549b985f12c238da2c003aae3e0ee5db7109fb7`.
- Source map: SHA-256 `55d24636b60db7a6b7d16b557dc7eb89a387580ce2978d8d10e9054ef33ce60c`.
- NOTICE: SHA-256 `9b4effe6aa89960e79172b20469634f905857fdd3b63e97ec5055349b2a23708`.
- `scripts/build.js`: SHA-256 `ec9bbbf2adc1da286af30698fa1889d71142e95b88a83b2d94c2b9fc82f51728`.
- `package-lock.json`: SHA-256 `67402d41acd7d49ed3c1a1f689e7f91a81bff1b7dc1727b355d1d3b3dec4197d`.

The earlier local development build and current CI distribution have identical engine/NOTICE bytes. Historical development capture metadata remains in [the measurements](../../docs/measurements/issue62.json) and its original Git revisions; the redundant `dev-` files are removed from the current checkout. The retained 31fb18d files below support 0.5.0 provenance. Current `license()` attribution names the CI distribution commit, so its hash and compiled class identity change even though browser payloads do not.

This is a verified CI commit, not a tagged fork release. Tagged-fork-release and applicable device/provider evidence remain release prerequisites; the unissued candidate is not a declared or mainnet-qualified release.

## Historical engine and licenses

The retained 0.5.0 TinySynth engine, from the Provable-Games fork, <https://github.com/Provable-Games/webaudio-tinysynth>,
at commit `31fb18d8e04125519776773042da0d5b2db591a9` on the fork's `improve/integration` branch (the NOTICE entry for the
lazy n1 noise build and `prewarm()`, fork PRs #63 and #64; the minified build is the one the fork's CI made for `16d7cad`,
and the library source has not changed since):

- `webaudio-tinysynth-31fb18d.min.js`: the commit's own `webaudio-tinysynth.min.js` (47,212 bytes), byte-identical to
  rebuilding that commit's `webaudio-tinysynth.js` with its pinned build (`npm ci && npm run verify`, Terser 5.51.2).
  SHA-256 `bcb498b915beb397f0333b22a59a4485d00025ff1e098cbf65823b9646759d74`.
- `webaudio-tinysynth-31fb18d.NOTICE`: the commit's `NOTICE` (the fork's list of modifications), which goes into the
  class's `license()` text. SHA-256 `c9c18d9103a8759d3d8048dd5847044c6d779fdb5b06e8d359af6a79b29dd914`.
- License: Apache License 2.0. Copyright Tatsuya Shinyagaito (g200kg), modified by Provable Games (see the fork's NOTICE
  and this repository's [NOTICE](../../NOTICE)).

A class whose engine pin is not a tagged fork release is a test class, without a `v<version>` release tag. A release
pins a tagged fork release with a published SHA-256.

For the current ENGINE_PIN, the class embeds that selected engine: `scripts/build_segments.mjs` gzips the minified file's exact bytes, a statement delimiter and a separately compiled headless API into one player fragment (the
shared loader inflates it in the browser), and `script_sha256()` returns the SHA-256 of the exact embedded engine
bytes, independently of the combined source/gzip hashes. The engine tests and the render and page checks run the same file. The pin is
the one line `ENGINE_PIN` in [`scripts/engine.mjs`](../../scripts/engine.mjs), which checks both hashes on every load,
so a mismatch fails before anything is generated. Nothing needs network access.

To verify the historical file: `git -C <fork> show 31fb18d:webaudio-tinysynth.min.js | sha256sum`.

## Re-pinning

To a later commit, or to a tagged fork release once the fork publishes them:

1. Pick the ref. On `improve/integration`, pin a commit the fork's CI made after a merge, "Rebuild
   webaudio-tinysynth.min.js for `<sha>`" (by github-actions[bot]), not the merge commit: pull requests do not carry
   the minified build, so a merge commit can carry a stale one. Check that the fork's `webaudio-tinysynth.min.js` at the
   ref is its reproducible build: check out the ref in a clone, then `npm ci && npm run verify` (it rebuilds the file
   with the fork's pinned Terser and compares the bytes; commits before `npm run verify` existed: `npm ci && npm run
   build`, then compare).
2. `node scripts/vendor_engine.mjs <fork checkout> <commit or tag>` copies the two files here (named after the short
   commit or the tag) and prints the new `ENGINE_PIN` line. It only reads the checkout.
3. Replace `ENGINE_PIN` in `scripts/engine.mjs` and update the verified `ENGINE_BUILD` source/build/CI identities.
   Remove old vendor files only when no historical verification requires them. Choose a new `VERSION` in
   `scripts/segments.mjs`: changes to any recorded entry are rejected even with `--record`.
   The explicitly documented unissued 0.6.0 CI-pin finalization and paused-position and terminal-failure
   candidate refreshes are recorded in the development guide; they do not change this immutable-version guard.
4. From the full checkout with `npm ci` installed, regenerate:

   ```sh
   npm run gen:segments -- --record
   npm run gen:data
   npm run gen:settings
   npm run gen:measurements
   (cd examples/beast_consumer && node scripts/gen_fixtures.mjs)
   (cd examples/stress_nft && node scripts/gen_fixtures.mjs)
   npm run gen:abi
   ```

   The combined player payload, `src/segment_data.cairo` (`VERSION`, `ENGINE_SHA256`, segments and
   license), consumer fixtures and ABI follow. The manifest records separate combined source/gzip
   hashes and exact embedded-engine/API ranges and hashes; there is no whole-page gzip constant.
5. Run the generated-file checks, full JS/Cairo suites and documented browser/audio checks in
   [Development](../../docs/development.md), and remeasure affected payload/class/gas rows in
   [Gas](../../docs/gas.md). Updating the pin or generated files does not authorize a declaration or release.

## fflate license

- `fflate-0.8.3.LICENSE`: the MIT License of [fflate](https://github.com/101arrowz/fflate) 0.8.3, exactly as distributed
  in its npm package (Copyright (c) 2026 Arjun Barrett). SHA-256
  `0a1df3a083d0c010560aa342e87959c8c1070e6fd54545741f083f22d0c8b551`.

The shared gunzip loader, [`player/gunzip.js`](../../player/gunzip.js), is derived from fflate 0.8.3's `gunzipSync`, and the
build compresses the engine with the same fflate version (pinned in `package-lock.json`). This file goes into the
class's `license()` text. `SHIM_PIN` in [`scripts/segments.mjs`](../../scripts/segments.mjs) checks its SHA-256 whenever it is read,
and the build checks that it equals the installed fflate's `LICENSE` and that the installed version is 0.8.3. Moving to
another fflate version means re-deriving and reviewing the shim, vendoring that version's license, and updating
`SHIM_PIN`.

## game-components license

- `game-components.LICENSE`: the MIT License of [game-components](https://github.com/Provable-Games/game-components)
  (Copyright (c) 2026 Provable Games), byte for byte as its `LICENSE` file at the pinned release `v3.1.0`, commit
  `66ce934e750f8162de4f6a377357b2b8f8e5c4c0` (added in game-components PR #161; Git blob `de51257`). SHA-256
  `4f7adc00655ded5638937698858cd3b302ee48069b924c6e456b9ef6e3f35f10`.

The class's base64 encoder is the package `game_components_encoding` (`packages/encoding` of game-components), a Scarb
dependency pinned in [`Scarb.toml`](../../Scarb.toml). It is compiled into the class, so its license goes into the class's
`license()` text. `ENCODER_PIN` in [`scripts/segments.mjs`](../../scripts/segments.mjs) checks the file's SHA-256 whenever it is
read. To verify: `git -C <game-components> show v3.1.0:LICENSE | sha256sum`. When the dependency moves to another
release, check this file against that release's `LICENSE`.
