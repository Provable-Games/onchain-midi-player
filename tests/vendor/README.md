# Vendored engine

The pinned TinySynth engine, from the Provable-Games fork, <https://github.com/Provable-Games/webaudio-tinysynth>,
at commit `b70ba90d63c5ea657cb67ca98de90d7f778c29bd`:

- `webaudio-tinysynth-b70ba90.min.js`: the commit's own `webaudio-tinysynth.min.js`, byte-identical to rebuilding
  that commit's `webaudio-tinysynth.js` with its `npm run build`.
  SHA-256 `5aa3edbc13371694a83ec0f285a5d39d4e4a31b18a259c0bbdcbd5969f710c2c`.
- `webaudio-tinysynth-b70ba90.NOTICE`: the commit's `NOTICE` (the fork's list of modifications), which goes into the
  class's `license()` text. SHA-256 `249bb81dc7026d89edf1a36f6f5b53a04c3ffd116a57deef6fb4df2a0388ee39`.
- License: Apache License 2.0. Copyright Tatsuya Shinyagaito (g200kg), modified by Provable Games (see the fork's NOTICE
  and this repository's [NOTICE](../../NOTICE)).

This is the engine the class embeds: `scripts/build_page.mjs` puts the minified file's exact bytes into the page, and
`script_sha256()` returns its SHA-256. The engine tests and the render and page checks run the same file. The pin is
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
   page, `src/page_data.cairo` (including `VERSION`, `ENGINE_SHA256` and the license text) and the fixtures follow.
