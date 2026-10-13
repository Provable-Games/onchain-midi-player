# Current engine provenance

The engine is [pocket-synth](https://github.com/Provable-Games/pocket-synth), Provable Games' fork of g200kg's [webaudio-tinysynth](https://github.com/g200kg/webaudio-tinysynth); its distribution files keep the `webaudio-tinysynth.*` names. The unissued 0.7.0 class embeds `webaudio-tinysynth-v2.0.1.min.js` from the signed fork release tag `v2.0.1` (GPG-signed by loothero), commit `4b829693d112d27e4dfaeb126d1912ff89216324` on the fork's main. The release pull request #111 built and committed the minified script and source map on `release/v2.0.1` at `c17c7427031f489f27d11d83d5502c1d4746fa77`; [its CI run](https://github.com/Provable-Games/pocket-synth/actions/runs/38368777784) verified that the committed files equal a fresh build. Main's squash merge `f53de0814539a78f57b41a2b89593e1815967121` and the tag carry the identical source, NOTICE, script and map; the tag's `package-lock.json` differs from `c17c742`'s only in the test-only `playwright-core` version. No post-merge Dist rebuild exists for this release. The established `scripts/vendor_engine.mjs` helper copies the tag's exact minified script and NOTICE; neither file is patched locally.

`ENGINE_PIN` names the tag commit. `ENGINE_BUILD` and the manifest are non-provisional and record the release build commit (`sourceCommit` and `distributionCommit`), its CI run, the source SHA-256, build recipe, that commit's lockfile and the source map. To reproduce, check out `v2.0.1` in an isolated fork clone, run `npm ci`, then `node scripts/build.js <output-dir>` and compare both outputs against the committed files. The pinned compiler is Terser 5.51.2.

- Engine: 47,804 bytes, SHA-256 `8ffa2519cdd0ac9c4876101681014e39cbfd07e71d45ea1fa5dc15d53233f94b`.
- Source: SHA-256 `a741647d1b6e4c94a7630da5b0b457377879f37f17971f4b42f704f1244839e0`.
- Source map: 76,015 bytes, SHA-256 `0afc9143aff436bdb165619f8f8229ca3ac9d87529f00ff1dbbd420e6c762f6a`.
- NOTICE: SHA-256 `0e4f6ad003a1cf9e2ea2620b57a8a7eec4b396064e222316782b70cb6693652b`.
- `scripts/build.js`: SHA-256 `ec9bbbf2adc1da286af30698fa1889d71142e95b88a83b2d94c2b9fc82f51728`.
- `package-lock.json` (`c17c742`, used by the CI build): SHA-256 `8e929f89b90456fcc607b9396d80d465deffd8f915a6a2c963901883175ae5b0`. The tag's lock (SHA-256 `e778921a16bcbd0541718eb4466ed3149269d509970434eba0a3c1411a39337a`) differs only in the test-only `playwright-core` version; a fresh `npm ci` build of the tag reproduces the same script and map.

This pin is a tagged fork release. Applicable device/provider evidence remains a release prerequisite; the unissued candidate is not a declared or mainnet-qualified release.

## Historical engine and licenses

The retained 0.6.0 engine, `webaudio-tinysynth-2cb8b40.min.js` (47,424 bytes, SHA-256
`df839b0d8b0479e799b2b19bdf5c714d92287a501d9d026335a0854ad491da65`) and `webaudio-tinysynth-2cb8b40.NOTICE` (SHA-256
`9b4effe6aa89960e79172b20469634f905857fdd3b63e97ec5055349b2a23708`), is fork CI distribution commit
`2cb8b405ede0d91a431f3ef3e4175f0bf3b0c18a`, built from source `8fd8b94c8bb1fd2df3d144404620520c4b7f3725` by
[its workflow](https://github.com/Provable-Games/webaudio-tinysynth/actions/runs/38269640215). Its provenance is recorded
in the 0.6.0 manifest entry.

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

To verify a historical file: `git -C <fork> show 31fb18d:webaudio-tinysynth.min.js | sha256sum` (or `2cb8b40`).

## Re-pinning

To a later tagged fork release (or, for a test class, a CI commit):

1. Pick the ref. Prefer a signed fork release tag (`git tag -v <tag>`) of
   [pocket-synth](https://github.com/Provable-Games/pocket-synth). Find the commit that built its minified files (a
   release pull request's build commit, checked against a fresh build by that pull request's CI, or an
   `improve/integration` "Rebuild webaudio-tinysynth.min.js for `<sha>`" commit by github-actions[bot]) and check that
   the tag carries the same files: ordinary pull requests do not carry the minified build, so a merge can carry a
   stale one. Without a tag, pin that build commit itself. Check that the fork's `webaudio-tinysynth.min.js` at the ref is its reproducible build: check out
   the ref in a clone, then `npm ci && npm run verify` (it rebuilds the file with the fork's pinned Terser and compares
   the bytes; commits before `npm run verify` existed: `npm ci && npm run build`, then compare).
2. `node scripts/vendor_engine.mjs <fork checkout> <commit or tag>` copies the two files here (named after the short
   commit or the tag) and prints the new `ENGINE_PIN` line. It only reads the checkout.
3. Replace `ENGINE_PIN` in `scripts/engine.mjs` and update the verified `ENGINE_BUILD` source/build/CI identities.
   Remove old vendor files only when no historical verification requires them. Choose a new `VERSION` in
   `scripts/segments.mjs`: changes to any recorded entry are rejected even with `--record`.
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
