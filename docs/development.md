# Development

For contributors: the toolchain, how the page is built, the tests, and CI.

## Toolchain

- Scarb 2.20.1 (Cairo 2.20)
- Starknet Foundry 0.64.0 (`snforge`, `sncast`)
- Node 22 or later (CI uses 24)

Scarb and Starknet Foundry are pinned in [`.tool-versions`](../.tool-versions) for asdf.

```sh
scarb build      # compile
snforge test     # Cairo tests, including the generated parity fixtures and the gas_ tests
scarb fmt        # format
```

The tests and the example need only Node, no `npm install`. Rebuilding the page, and the shim's tests in `npm test`, need the pinned Terser and fflate (`npm ci`, once):

```sh
npm test                 # node --test "player/**/*.test.js" "scripts/**/*.test.mjs"
npm run gen:settings     # regenerate tests/fixtures/settings.json and tests/settings_fixtures.cairo
npm run check:settings   # fail if they are out of date
node scripts/gen_midi_fixtures.mjs   # regenerate the synthetic scores (then gen:page)
npm ci && npm run gen:page   # rebuild the page, src/page_data.cairo and the page fixtures
npm run check:page       # fail if any of them is out of date
npm run gen:abi          # scarb --release build (and --test), then write abi/
npm run check:abi        # fail if abi/ is out of date
npm run check-midi -- song.mid   # check MIDI files against the page's MIDI contract
npm run preview -- song.mid      # write (and optionally serve) the page a token with that MIDI gets
PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core PLAYWRIGHT_BROWSER=chromium \
  npm run render-check   # optional: render the reference timbres in a headless browser
PLAYWRIGHT_CORE=... PLAYWRIGHT_BROWSER=firefox npm run page-check   # optional: the page; chromium, firefox or webkit
PLAYWRIGHT_CORE=... PLAYWRIGHT_BROWSER=webkit npm run drift-check -- --minutes 10   # optional: art against sound over a session
```

The engine tests, the page build and the page checks use the vendored engine (`tests/vendor/`, SHA-256 checked on every load).

## The base64 encoder

All base64 in the class goes through `onchain_midi_player::base64::bytes_base64_encode`, which [`src/base64.cairo`](../src/base64.cairo) re-exports from `game_components_encoding` (`packages/encoding` in [game-components](https://github.com/Provable-Games/game-components)). [`Scarb.toml`](../Scarb.toml) pins it to the release tag `v3.1.0`, and `Scarb.lock` records the commit. It costs about 3.3K L2 gas per input byte for large inputs (3.6K through the library call). It uses the unstable corelib features `bounded-int-utils`, `byte-span` and `corelib-get-trait`, so use the Scarb version in `.tool-versions`. It is MIT licensed: its license is [vendored](../tests/vendor/game-components.LICENSE) and in `license()`. Its tests are in [`tests/test_base64.cairo`](../tests/test_base64.cairo).

## Build pipeline

[`scripts/build_page.mjs`](../scripts/build_page.mjs) (`npm run gen:page`, or `npm run check:page` to verify) is offline and reproducible: running it twice gives byte-identical files.

1. Loads the pinned engine and its NOTICE; a hash mismatch fails here.
2. Gzips the engine with fflate, pinned exactly in `package-lock.json` (level 9, no timestamp, no file name), and checks that the payload inflates back to the engine with both Node's zlib and the page's shim.
3. Flattens `player/gunzip.js` into a plain script and minifies it with Terser, pinned exactly in `package-lock.json`, then checks it against `SHIM_PIN`. Flattens `player/settings.js` and `player/player.js` into one script and minifies it.
4. Assembles `PAGE` and pads it with spaces to `len % 9 == 0`; the spaces fall inside the settings block, where the player trims them.
5. Writes:
   - [`tests/fixtures/page.html`](../tests/fixtures/page.html): `PAGE`;
   - [`src/page_data.cairo`](../src/page_data.cairo) (generated, do not edit): `animation_url_segment()` pre-encoded at both base64 layers, `PAGE_LEN`, `SEGMENT_LEN`, `ENGINE_SHA256`, `GZIP_SHA256`, `GZIP_LEN`, `VERSION` and `license()`;
   - the golden fixtures for the class: [`tests/fixtures/page.json`](../tests/fixtures/page.json) and [`tests/page_fixtures.cairo`](../tests/page_fixtures.cairo);
   - the class's test fixtures, [`tests/class_fixtures.cairo`](../tests/class_fixtures.cairo): the raw `PAGE`, base64 vectors from Node's encoder, and the synthetic scores of [`tests/fixtures/midi/`](../tests/fixtures/midi/README.md).

`VERSION` is the class's SemVer version, returned by `version()`. [`scripts/page_versions.json`](../scripts/page_versions.json) records, for every `VERSION`, the SHA-256 of `PAGE`, the engine pin (`engine_ref`, `engine_commit`), the page revision (`page`, from `PAGE_VERSION`), `script_sha256()` (`script_sha256`) and the gzip payload's SHA-256 and length (`gzip_sha256`, `gzip_len`), and the build fails if any of them changes while `VERSION` stays the same. A new `VERSION` must be SemVer and come after every recorded one; several versions may share a `PAGE`, because a class's Cairo code can change while its page does not.

- To change the page, bump `PAGE_VERSION` and `VERSION` in [`scripts/page.mjs`](../scripts/page.mjs) (a re-pin needs a new `VERSION` too), and run `npm run gen:page -- --record`.
- Bump `VERSION` for every class that is declared, even when only its Cairo code changed.
- When you declare a class or deploy the example, record it in [`deployments/<network>.json`](../deployments/sepolia.json), replacing the previous entry (git history keeps superseded entries: `git log -p deployments/<network>.json`): `class` (its `version()`, class hash, declare transaction, the full commit it was built from, `release_tag`, `null` for a test class, and its inspection instance) and `example`. Hashes and addresses are `0x` and 64 lowercase hex digits. `scripts/deployments.test.mjs` checks the shape, that the version is in `scripts/page_versions.json`, and that the example's `player_class_hash` is the class beside it.

**Golden fixtures.** The JS reference ([`scripts/page.mjs`](../scripts/page.mjs)) computes them from the inputs in [`scripts/page_fixtures.mjs`](../scripts/page_fixtures.mjs). The valid cases cover every `D` padding length and every consumer padding length, and include custom waves and filters; the invalid cases cover settings reverts. snforge checks `midi_segment` byte for byte against each, directly and through the library call, and the decoded page and consumer-layout `token_uri` against their length and SHA-256.

## ABIs

[`abi/`](../abi) holds the ABIs integrators load into starknet.js, starknet.py or another client. [`scripts/gen_abi.mjs`](../scripts/gen_abi.mjs) (`npm run gen:abi`, or `npm run check:abi` to verify) writes them from the release build's artifacts in `target/release/`:

- `abi/TinySynth.json`: the `abi` array of the class's `contract_class.json`.
- `abi/ISoundProvider.json`: the provider interface and the types it uses. No contract of the crate implements it, so it comes from the test crate's `MockSoundProvider` ([`tests/test_provider.cairo`](../tests/test_provider.cairo)), less the mock's own `impl` and `event` entries.

## Player JavaScript

Plain, dependency-free, CSP-safe JavaScript (`// @ts-check` with JSDoc, no `eval`), used by the page and by the tests:

- [`player/settings.js`](../player/settings.js): the page's settings module. `decodeSettings` is the strict parser (it does not repeat Cairo's range checks); `createSynth` and `installSettings` set up the engine, register the custom waves and install the timbres.
- [`player/player.js`](../player/player.js): the rest of the player, including `checkMidi` and `decodeMidi`.
- [`player/gunzip.js`](../player/gunzip.js): the page's gunzip shim.
- [`player/validate.js`](../player/validate.js) and [`player/encode.js`](../player/encode.js): the JS reference of Cairo's `settings::validate` and of the encoder, for Node and tooling only.

Shared fixtures keep Cairo and JavaScript byte-for-byte identical: [`scripts/settings_fixtures.mjs`](../scripts/settings_fixtures.mjs) defines them, and `scripts/gen_settings_fixtures.mjs` writes `tests/fixtures/settings.json` and `tests/settings_fixtures.cairo` (generated; do not edit). Every fixture is asserted on both sides: the encoded bytes for valid input, and the exact panic data for invalid input.

## Class size

The class compiled with Scarb 2.20.1, at `0.3.0`, against [Starknet's current limits](https://docs.starknet.io/learn/cheatsheets/chain-info):

| | The class | Limit |
| --- | --- | --- |
| Sierra program | 19,252 felts | |
| Contract class as declared (Sierra, entry points, ABI) | 987,638 bytes (24% of the limit) | 4,089,446 bytes |
| CASM bytecode | 29,974 felts (37% of the limit) | 81,920 felts |

The base64 encoder accounts for 4,921 Sierra felts, 288 KB and 11,148 CASM felts. Measured from `contract_class.json` without debug info, and the `bytecode` of `compiled_contract_class.json`.

## Browser validation

The checks run on Playwright's Chromium, Firefox and WebKit. They load the class's output: every golden case's `token_uri` is checked against the length and SHA-256 that snforge pins the class's output to, then decoded as a marketplace decodes it.

| Scope | Check |
| --- | --- |
| Playback starts only on a tap; ▶/■ toggles | [`page_check.mjs`](../scripts/page_check.mjs): `checkDataPage` (clicks), `checkTouch` (taps); the example's `browser_check.mjs` |
| Seamless End-of-Track loop, correct tempo | `checkLoop`: passes start exactly one pass of the MIDI's own tempo map apart, to 1 µs |
| The art restarts in sync on ▶ and at every pass | `checkDataPage`: screenshots of a probe animation, and each pass's restart timed against that pass's tick 0 |
| Drift over a session | [`drift_check.mjs`](../scripts/drift_check.mjs) (`npm run drift-check -- --minutes 10`) |
| Every failure path keeps the art, ▶ disabled | `checkFailures` (settings, MIDI), `checkEngineFailures` (gzip payload), `checkAudioFailures` (no Web Audio; `resume()` rejects) |
| No network requests; offline from `data:` and `file://` | every load; `checkDataPage`, `checkFile` |
| Sandboxed iframe, strict CSP, marketplace-style frames | `checkIframe`, `checkCsp` with `checkCspControl`, `checkEmbeds` |
| Offline renders of the reference timbres, custom waves and filters | [`render_check.mjs`](../scripts/render_check.mjs) |
| Settings at their extremes play without an error | `checkExtremes` |
| Marketplaces, mobile browsers, real audio hardware, indexers, wallets and RPC providers | manual |

- **Drift.** The drift check allows the art's offset from the sound to change by at most 20 ms over a session. CI runs it for 1 minute and only prints the drift, because in a minute one stall of a headless audio clock can exceed the limit while the page does nothing wrong. Longer runs check it: WebKit drifted +2.3 ms over 10 minutes and Chromium +5.5 ms over 5 minutes. A 10-minute Firefox run needs a real audio device.
- **Firefox needs an audio output device.** Without one, its `AudioContext` never leaves `suspended`. On a machine without one, start PulseAudio with a null sink first, as CI does: `pulseaudio --start --exit-idle-time=-1 && pactl load-module module-null-sink && pactl set-default-sink null`.
- **`data:` requests** show directly only through Chromium's DevTools protocol, so on Firefox and WebKit the checks print `skip` for that one check. The strict-CSP load proves it on every engine instead.
- `PLAYWRIGHT_BROWSER` is `chromium` when unset. To use a Chromium you already have, set `CHROME=/path/to/chrome-headless-shell` instead of installing one.

## CI

GitHub Actions runs on every pull request and on pushes to `main` ([`.github/workflows/ci.yml`](../.github/workflows/ci.yml)):

| Job | What it checks |
| --- | --- |
| `cairo` | `scarb fmt --check`, `scarb build` and `snforge test` at the root and in `examples/beast_consumer`; the Scarb lockfiles stay unchanged |
| `javascript` | The example's Node tests, `npm ci`, `npm test`, and `tsc --checkJs` on `player/` |
| `generated` | Reruns the fixture generators, `npm run check:settings`, `npm run check:page` and the ABI generator, then fails on any diff |
| `browser` | One leg per engine (Chromium, Firefox, WebKit): the example's `browser_check.mjs`, `render-check`, `page-check` and a 1-minute `drift-check` |

**Drift guards.** [`scripts/skills.test.mjs`](../scripts/skills.test.mjs), run by `npm test`, keeps the agent skills in step with the code and these docs. It checks the skills' frontmatter and the plugin manifests, that every link in the skills, the README and `docs/` resolves (files and anchors), that the MIDI reference lists every `checkMidi` message, that the operator table matches the validator, that every gas figure in the skills appears in the README or `docs/` and the MIDI and `SETTINGS` rates agree with [`docs/gas.md`](gas.md), that the skills name settings limits by their `src/settings.cairo` constants, and that they hardcode nothing a re-pin changes. `scripts/page.test.mjs` checks `scripts/page_versions.json` against the build, `scripts/deployments.test.mjs` checks `deployments/`, and `scripts/check_midi.test.mjs` checks that the [MIDI contract](midi-contract.md) lists every MIDI error.

**Reviews.** Codex and Claude review each same-repository pull request ([`codex-review.yml`](../.github/workflows/codex-review.yml), [`claude-review.yml`](../.github/workflows/claude-review.yml)) and post one comment each. A HIGH or CRITICAL finding fails that provider's review gate. The reviewers also check the agent skills against each change. Setup, secrets and policies are in [`.github/scripts/README.md`](../.github/scripts/README.md).

Run the same checks locally from the repository root:

```sh
scarb fmt --check && scarb build && snforge test
(cd examples/beast_consumer && scarb fmt --check && scarb build && snforge test)
node scripts/gen_midi_fixtures.mjs
(cd examples/beast_consumer && node --test scripts/*.test.mjs && node scripts/gen_fixtures.mjs)
npm ci && npm test && npm run check:settings && npm run check:page && npm run check:abi
git diff --exit-code                     # generators left no drift

# Pinned tools for the type check and the browser checks
(cd .github/ci-tools && npm ci --ignore-scripts)
T=.github/ci-tools/node_modules
$T/.bin/tsc --noEmit --allowJs --checkJs --target es2022 --module nodenext \
  --moduleResolution nodenext --lib es2022,dom --typeRoots $T/@types --types node player/*.js
(cd .github/ci-tools && npx playwright-core install --only-shell chromium && npx playwright-core install firefox webkit)   # add --with-deps for system libraries
export PLAYWRIGHT_CORE="$PWD/$T/playwright-core"
for PLAYWRIGHT_BROWSER in chromium firefox webkit; do   # the browser checks, on each engine
  export PLAYWRIGHT_BROWSER
  (cd examples/beast_consumer && node scripts/browser_check.mjs)
  npm run render-check
  npm run page-check
  npm run drift-check -- --minutes 1 --drift-info
done

# Review helpers
python3 -I -B -m unittest discover -s .github/scripts -p 'test_*.py'
```
