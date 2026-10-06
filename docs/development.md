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

The tests and the example need only Node, no `npm install`. Rebuilding the page, the shim's tests and the token_uri validator's tests in `npm test` need the pinned Terser, fflate and @xmldom/xmldom (`npm ci`, once):

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
PLAYWRIGHT_CORE=... PLAYWRIGHT_BROWSER=firefox npm run hosting-check   # optional: the page in a sandboxed iframe under a host CSP
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

`VERSION` is the class's SemVer version, returned by `version()`. [`scripts/page_versions.json`](../scripts/page_versions.json) records, for the current `VERSION`, the SHA-256 of `PAGE`, the engine pin (`engine_ref`, `engine_commit`), the page revision (`page`, from `PAGE_VERSION`), `script_sha256()` (`script_sha256`) and the gzip payload's SHA-256 and length (`gzip_sha256`, `gzip_len`), and the build fails if any of them changes while `VERSION` stays the same. A new `VERSION` must be SemVer and come after every recorded one; several versions may share a `PAGE`, because a class's Cairo code can change while its page does not. When a newer class is declared, remove the superseded record; git history keeps it (`git log -p scripts/page_versions.json`).

- To change the page, bump `PAGE_VERSION` and `VERSION` in [`scripts/page.mjs`](../scripts/page.mjs) (a re-pin needs a new `VERSION` too), and run `npm run gen:page -- --record`.
- Bump `VERSION` for every class that is declared, even when only its Cairo code changed.
- When you declare a class or deploy the example, record it in [`deployments/<network>.json`](../deployments), replacing the previous entry (git history keeps superseded entries: `git log -p deployments/<network>.json`): `class` (its `version()`, class hash, declare transaction, the full commit it was built from, `release_tag`, `null` for a test class, and its inspection instance) and `example` (`null` when none is deployed). Hashes and addresses are `0x` and 64 lowercase hex digits. `scripts/deployments.test.mjs` checks the shape, that the version is in `scripts/page_versions.json`, that `release_tag` is `null` or `v<version>`, that `mainnet.json` holds a release (a `release_tag`) and that the example's `player_class_hash` is the class beside it. The file names are `sepolia.json` and `mainnet.json`, with the `chain_id`s `SN_SEPOLIA` and `SN_MAIN`.

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

The class compiled with the Scarb version above, at the current `VERSION`, against [Starknet's current limits](https://docs.starknet.io/learn/cheatsheets/chain-info):

| | The class | Limit |
| --- | --- | --- |
| Sierra program | 19,827 felts | |
| Contract class as declared (Sierra, entry points, ABI) | 1,013,097 bytes (25% of the limit) | 4,089,446 bytes |
| CASM bytecode | 30,337 felts (37% of the limit) | 81,920 felts |

The base64 encoder accounts for 4,921 Sierra felts, 288 KB and 11,148 CASM felts. Measured from `contract_class.json` without debug info, and the `bytecode` of `compiled_contract_class.json`.

## Browser validation

The checks run on Playwright's Chromium, Firefox and WebKit. They load the class's output: every golden case's `token_uri` is checked against the length and SHA-256 that snforge pins the class's output to, then decoded as a marketplace decodes it.

| Scope | Check |
| --- | --- |
| Playback starts only on a tap; ▶/■ toggles | [`page_check.mjs`](../scripts/page_check.mjs): `checkDataPage` (clicks), `checkTouch` (taps); the example's `browser_check.mjs` |
| Seamless End-of-Track loop, correct tempo | `checkLoop`: passes start exactly one pass of the MIDI's own tempo map apart, to 1 µs |
| The art restarts in sync on ▶ and at every pass | `checkDataPage`: screenshots of a probe animation, and each pass's restart timed against that pass's tick 0 |
| Drift over a session | [`drift_check.mjs`](../scripts/drift_check.mjs) (`npm run drift-check -- --minutes 10`), run for 10 minutes by [`drift.yml`](../.github/workflows/drift.yml) |
| Background audio: the silent element plays on ▶ and pauses on ■; the media session's play, pause and stop handlers drive ▶/■; with the element blocked (host CSP) the music plays and a hidden page stops | `page_check.mjs`: `checkBackgroundAudio`, `checkCsp`; `hosting_check.mjs`; the page's behaviour in `player.test.js` |
| Media session artwork is the art's own bitmap, upscaled without smoothing: every source pixel a solid block in the 512×512 and 256×256 PNGs | `page_check.mjs`: `checkArtwork` |
| Every failure path keeps the art, ▶ disabled | `checkFailures` (settings, MIDI), `checkEngineFailures` (gzip payload), `checkAudioFailures` (no Web Audio; `resume()` rejects) |
| No network requests; offline from `data:` and `file://` (on WebKit every request is blocked and listed instead of using the offline emulation, which also blocks the page's own `blob:` media) | every load; `checkDataPage`, `checkFile` |
| Sandboxed iframe, strict CSP, marketplace-style frames | `page_check.mjs`: `checkIframe`, `checkCsp` with `checkCspControl`, `checkEmbeds`; [`hosting_check.mjs`](../scripts/hosting_check.mjs): `data:` and `srcdoc` frames in a host with a strict CSP, and the hosts where the page cannot run |
| Offline renders of the reference timbres, custom waves and filters; two page loads render the same audio (Firefox bit for bit, Chromium and WebKit within 80 float32 ULPs, 9.5e-6, from rounding in the browser's mixing) | [`render_check.mjs`](../scripts/render_check.mjs) |
| Settings at their extremes play without an error | `checkExtremes` |
| Marketplaces, mobile browsers, real audio hardware, indexers, wallets and RPC providers | manual |

Media controls and background playback are best effort and need real devices: Android Chrome's notification and lock screen, pausing from the notification and a call, iOS ignoring the silent switch, the lock screen and Now Playing, and the media hub of desktop Chrome and Brave.

- **Hosting.** `hosting_check.mjs` embeds the page in `<iframe sandbox="allow-scripts">`, as `src="data:..."` and as `srcdoc`, in a host with and without a CSP. The page plays in every one, with the same results on all three engines: the art is drawn, ▶ starts the `AudioContext` and ■ stops it, nothing is requested and nothing is logged or reported. A sandbox without `allow-same-origin` (an opaque origin) does not block audio. A host's CSP needs only `script-src 'unsafe-inline'`, `style-src 'unsafe-inline'` and `img-src data:`, because a `data:` or `srcdoc` frame inherits it; add `media-src blob:` for the media controls and background playback: without it (`media-src 'none'`, or `default-src 'none'` with no `media-src`) the music still plays, but the browser blocks the silent `blob:` element, so there are no media controls, playback stops when the page is hidden, and the browser reports one CSP violation for the blocked media (the only report the page causes, which `hosting_check.mjs` expects in those cases and nowhere else). Nothing else (`connect-src`, `worker-src`) is used. A `data:` frame also needs `frame-src data:` (or `child-src`) in the host's CSP, which a `srcdoc` frame does not. The page cannot run where the host withholds scripts: `<iframe sandbox>` without `allow-scripts`, or a host CSP without `'unsafe-inline'` for scripts. The art is drawn by the page's script, so the frame stays black (▶ is in the HTML, disabled), and a host CSP that blocks the `data:` frame shows nothing of the page. `hosting_check.mjs` checks each of these. Top-level `data:` and `file://` are `page_check.mjs`'s.
- **Drift.** The drift check allows the art's offset from the sound to change by at most 20 ms over a session, and no checkpoint to be more than 20 ms off the trend. The art restarts at every pass, so the drift is bounded by one pass rather than accumulating. [`drift.yml`](../.github/workflows/drift.yml) runs 10 minutes on each engine weekly, on demand (Actions, "Drift", Run workflow, with the minutes) and on a pull request that changes the check, and fails past those limits. The browser job runs 1 minute and only prints the drift, because in a minute one stall of a headless audio clock can exceed the limit while the page does nothing wrong. Over 10 minutes on Linux (Firefox on a PulseAudio null sink) the art's offset drifted +0.9 ms on Chromium, -1.7 ms on Firefox and -1.4 ms on WebKit, no checkpoint more than 10, 16 and 6 ms off the trend. The audio clock ran +0.1 ms, +71.5 ms (114 ppm) and -0.2 ms against the page clock; the per-pass restart keeps that out of the art.
- **Firefox needs an audio output device.** Without one, its `AudioContext` never leaves `suspended`. On a machine without one, start PulseAudio with a null sink first, as CI does: `pulseaudio --start --exit-idle-time=-1 && pactl load-module module-null-sink && pactl set-default-sink null`.
- **`data:` requests** show directly only through Chromium's DevTools protocol, so on Firefox and WebKit the checks print `skip` for that one check. The strict-CSP load proves it on every engine instead.
- `PLAYWRIGHT_BROWSER` is `chromium` when unset. To use a Chromium you already have, set `CHROME=/path/to/chrome-headless-shell` instead of installing one.

## CI

GitHub Actions runs on every pull request and on pushes to `main` ([`.github/workflows/ci.yml`](../.github/workflows/ci.yml)):

| Job | What it checks |
| --- | --- |
| `cairo` | `scarb fmt --check`, `scarb build` and `snforge test` at the root and in `examples/beast_consumer` and `examples/stress_nft`; the Scarb lockfiles stay unchanged |
| `javascript` | The examples' Node tests, `npm ci`, `npm test`, and `tsc --checkJs` on `player/` |
| `generated` | Reruns the fixture generators, `npm run check:settings`, `npm run check:page` and the ABI generator, then fails on any diff |
| `browser` | One leg per engine (Chromium, Firefox, WebKit): the example's `browser_check.mjs`, `render-check`, `page-check`, `hosting-check` and a 1-minute `drift-check` |

The 10-minute drift check is a separate workflow, [`drift.yml`](../.github/workflows/drift.yml), with one leg per engine: weekly (Mondays), on demand, and on a pull request that changes the check or the workflow. It is not a required check. Each leg uploads `drift_check_result.json` (every checkpoint and the summary) and the first and last screenshots.

**Drift guards.** [`scripts/skills.test.mjs`](../scripts/skills.test.mjs), run by `npm test`, keeps the agent skills in step with the code and these docs. It checks the skills' frontmatter and the plugin manifests, that every link in the skills, the README and `docs/` resolves (files and anchors), that the MIDI reference lists every `checkMidi` message, that the operator table matches the validator, that every gas figure in the skills appears in the README or `docs/` and the MIDI and `SETTINGS` rates agree with [`docs/gas.md`](gas.md), that the skills name settings limits by their `src/settings.cairo` constants, and that they hardcode nothing a re-pin changes. `scripts/page.test.mjs` checks `scripts/page_versions.json` against the build, `scripts/deployments.test.mjs` checks `deployments/`, and `scripts/check_midi.test.mjs` checks that the [MIDI contract](midi-contract.md) lists every MIDI error.

**Reviews.** Codex and Claude review each same-repository pull request ([`codex-review.yml`](../.github/workflows/codex-review.yml), [`claude-review.yml`](../.github/workflows/claude-review.yml)) and post one comment each. A HIGH or CRITICAL finding fails that provider's review gate. The reviewers also check the agent skills against each change. Setup, secrets and policies are in [`.github/scripts/README.md`](../.github/scripts/README.md).

Run the same checks locally from the repository root:

```sh
scarb fmt --check && scarb build && snforge test
(cd examples/beast_consumer && scarb fmt --check && scarb build && snforge test)
(cd examples/stress_nft && scarb fmt --check && scarb build && snforge test)
node scripts/gen_midi_fixtures.mjs
(cd examples/beast_consumer && node --test scripts/*.test.mjs && node scripts/gen_fixtures.mjs)
(cd examples/stress_nft && node --test scripts/*.test.mjs && node scripts/gen_fixtures.mjs)
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
  npm run hosting-check
  npm run drift-check -- --minutes 1 --drift-info
done

# Review helpers
python3 -I -B -m unittest discover -s .github/scripts -p 'test_*.py'
```

## Releasing

A release is a tagged commit whose class is declared on Sepolia, then on mainnet. A declared class is permanent, so declaring needs the maintainer's explicit go-ahead at the time. Every step before it can be redone.

1. **Re-pin the engine to a tagged fork release.** The fork publishes a signed tag with `webaudio-tinysynth.min.js`, its source map, `SHA256SUMS` and the `npm run verify` output in the release notes.
   - Check the tag (`git tag -v`) and that the release's `webaudio-tinysynth.min.js` matches `SHA256SUMS` (`sha256sum -c`) and the file in the tag.
   - Run `node scripts/vendor_engine.mjs <fork checkout> <tag>`, put the printed `ENGINE_PIN` in [`scripts/engine.mjs`](../scripts/engine.mjs), delete the old vendored files, and update [`tests/vendor/README.md`](../tests/vendor/README.md).
2. **Bump the version and regenerate.** Set `VERSION` in [`scripts/page.mjs`](../scripts/page.mjs) to the release's SemVer version, run `npm run gen:page -- --record`, then the generators and checks under [CI](#ci), and commit what they change, including the [Class size](#class-size) table. `git diff --exit-code` must be clean afterwards.
3. **Validate in three browsers.** Run `render-check`, `page-check`, `hosting-check` and a 10-minute `drift-check` on Chromium, Firefox and WebKit (CI runs the first three per pull request and [`drift.yml`](../.github/workflows/drift.yml) the last). The rows marked manual in [Browser validation](#browser-validation) are still checked by hand.
4. **Tag.** After the pull request merges, tag the merged commit `v<version>` (signed) and push the tag.
5. **Build the class from the tag.** In a clean checkout of the tag, with the versions in [`.tool-versions`](../.tool-versions): `scarb --release build` (the profile the ABIs and earlier declarations use), then `sncast --scarb-profile release utils class-hash --contract-name TinySynth`. Repeat on a second machine; the hashes must agree, and `npm ci && npm run check:page && npm run check:abi` must pass.
6. **Declare on Sepolia, then mainnet.** Declare the same build on each network, and check that the hash `sncast` prints equals step 5's:

   ```sh
   sncast --account <account> declare --url <rpc url> --contract-name TinySynth
   ```
7. **Deploy the inspection instance** on each network: a deployment of the class with no constructor, so explorers and RPC calls can read `version()`, `engine()`, `script_sha256()` and `license()`. Consumers never call it.

   ```sh
   sncast --account <account> deploy --url <rpc url> --class-hash <class hash> --salt <salt>
   ```

   The address depends on the class hash, the salt and, with `--unique`, the deploying account. Once the final class hash is known, a vanity address can be mined offline: compute the address for many salts and deploy with the best one.
8. **Deploy the example,** if wanted: declare and deploy `BeastLikeNft` from [`examples/beast_consumer`](../examples/beast_consumer) with the class hash as its constructor argument.
   Deploy [`examples/stress_nft`](../examples/stress_nft) the same way (its constructor also takes an owner), and update its [`sepolia.json`](../examples/stress_nft/sepolia.json): its RPC check builds the reference from the checked-out page, so it matches only a `StressNft` that pins the current class.
9. **Record each network** in `deployments/<network>.json`: `version`, `release_tag` `v<version>`, class hash, declare and deploy transactions, `built_from` (the tagged commit's full SHA), the inspection instance and the example (`null` if none). Remove the superseded record from `scripts/page_versions.json` (step 2 added the new one beside it). `npm test` checks the files.
10. **Verify the declared class.** Call `version()`, `engine()` and `script_sha256()` on the inspection instance, and compare them with [`scripts/page_versions.json`](../scripts/page_versions.json). Call a real consumer's `token_uri` (the example's, or the NFT's) through several RPC providers (the [`token-uri-inspector`](../plugins/onchain-midi-player/skills/token-uri-inspector/SKILL.md) skill has the commands) and compare each result byte for byte with the JS reference ([`gen_fixtures.mjs`](../examples/beast_consumer/scripts/gen_fixtures.mjs)). Record any provider that fails, such as an `Out of gas` revert.
11. **Publish a GitHub release** for the tag. List the class hash and declare transaction per network, the inspection instances, the engine's fork tag and SHA-256, the toolchain versions, and how to reproduce the build: check out the tag, install the versions in `.tool-versions`, run `scarb --release build` and `sncast --scarb-profile release utils class-hash --contract-name TinySynth`, and compare with the class hash. Link [Verifying the engine](verifying.md).
