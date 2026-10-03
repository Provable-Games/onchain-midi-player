# Vendored engine and licenses

The pinned TinySynth engine, from the Provable-Games fork, <https://github.com/Provable-Games/webaudio-tinysynth>,
at commit `b70ba90d63c5ea657cb67ca98de90d7f778c29bd`:

- `webaudio-tinysynth-b70ba90.min.js`: the commit's own `webaudio-tinysynth.min.js`, byte-identical to rebuilding
  that commit's `webaudio-tinysynth.js` with its `npm run build`.
  SHA-256 `5aa3edbc13371694a83ec0f285a5d39d4e4a31b18a259c0bbdcbd5969f710c2c`.
- `webaudio-tinysynth-b70ba90.NOTICE`: the commit's `NOTICE` (the fork's list of modifications), which goes into the
  class's `license()` text. SHA-256 `249bb81dc7026d89edf1a36f6f5b53a04c3ffd116a57deef6fb4df2a0388ee39`.
- License: Apache License 2.0. Copyright Tatsuya Shinyagaito (g200kg), modified by Provable Games (see the fork's NOTICE
  and this repository's [NOTICE](../../NOTICE)).

This is the engine the class embeds: `scripts/build_page.mjs` gzips the minified file's exact bytes into the page (the
page's gunzip shim inflates them back in the browser), and `script_sha256()` returns the SHA-256 of the decompressed
bytes. The engine tests and the render and page checks run the same file. The pin is
the one line `ENGINE_PIN` in [`scripts/engine.mjs`](../../scripts/engine.mjs), which checks both hashes on every load,
so a mismatch fails before anything is generated. Nothing needs network access.

To verify: `git -C <fork> show b70ba90:webaudio-tinysynth.min.js | sha256sum`.

## Re-pinning

To a later commit, or to a tagged fork release once the fork publishes them:

1. Check that the fork's `webaudio-tinysynth.min.js` at the new ref is its reproducible build (check out the ref,
   `npm ci && npm run build`, compare).
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
  (Copyright (c) 2026 Provable Games), byte for byte as its `LICENSE` file at commit
  `fd4ed385671e5ab610bc5c9c48cfc819ff4965eb` (game-components PR #161, Git blob `de51257`). SHA-256
  `4f7adc00655ded5638937698858cd3b302ee48069b924c6e456b9ef6e3f35f10`.

The class's base64 encoder is the package `game_components_encoding` (`packages/encoding` of game-components), a Scarb
dependency pinned in [`Scarb.toml`](../../Scarb.toml). It is compiled into the class, so its license goes into the class's
`license()` text. The pinned commit, `652b349`, predates the `LICENSE` file: game-components' README declared the MIT
License there, and `fd4ed38`, the next commit, adds only this file. `ENCODER_PIN` in
[`scripts/page.mjs`](../../scripts/page.mjs) checks its SHA-256 whenever it is read. When the dependency moves to a release
tag, check this file against the tag's `LICENSE`.
