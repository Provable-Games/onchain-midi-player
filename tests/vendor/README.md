# Vendored engine and licenses

The pinned TinySynth engine, from the Provable-Games fork, <https://github.com/Provable-Games/webaudio-tinysynth>,
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

This is the engine the class embeds: `scripts/build_page.mjs` gzips the minified file's exact bytes into the page (the
page's gunzip shim inflates them back in the browser), and `script_sha256()` returns the SHA-256 of the decompressed
bytes. The engine tests and the render and page checks run the same file. The pin is
the one line `ENGINE_PIN` in [`scripts/engine.mjs`](../../scripts/engine.mjs), which checks both hashes on every load,
so a mismatch fails before anything is generated. Nothing needs network access.

To verify: `git -C <fork> show 31fb18d:webaudio-tinysynth.min.js | sha256sum`.

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
3. Replace the `ENGINE_PIN` line in `scripts/engine.mjs`, delete the old files here, and run
   `npm run gen:page -- --record` (the new engine ref is a new `VERSION`). The
   page (with a new gzip payload), `src/page_data.cairo` (including `VERSION`, `ENGINE_SHA256`, `GZIP_SHA256` and the
   license text) and the fixtures follow.

## fflate license

- `fflate-0.8.3.LICENSE`: the MIT License of [fflate](https://github.com/101arrowz/fflate) 0.8.3, exactly as distributed
  in its npm package (Copyright (c) 2026 Arjun Barrett). SHA-256
  `0a1df3a083d0c010560aa342e87959c8c1070e6fd54545741f083f22d0c8b551`.

The page's gunzip shim, [`player/gunzip.js`](../../player/gunzip.js), is derived from fflate 0.8.3's `gunzipSync`, and the
build compresses the engine with the same fflate version (pinned in `package-lock.json`). This file goes into the
class's `license()` text. `SHIM_PIN` in [`scripts/page.mjs`](../../scripts/page.mjs) checks its SHA-256 whenever it is read,
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
`license()` text. `ENCODER_PIN` in [`scripts/page.mjs`](../../scripts/page.mjs) checks the file's SHA-256 whenever it is
read. To verify: `git -C <game-components> show v3.1.0:LICENSE | sha256sum`. When the dependency moves to another
release, check this file against that release's `LICENSE`.
