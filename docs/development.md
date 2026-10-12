# Development and release

Use the pinned `.tool-versions`, `Scarb.lock`, `package-lock.json` and `.github/ci-tools/package-lock.json`. The implementation builds on [PR #57](https://github.com/Provable-Games/onchain-midi-player/pull/57)'s merged 0.4.0 baseline, main commit `d92159283dc71e76000d6338f53f0f79f9ea1522`. Earlier measurements retain their original revision and artifact bindings; merged-baseline revalidation is recorded separately.

```sh
npm ci
npm run gen:segments
npm run gen:data
npm run gen:measurements
npm run gen:settings
node examples/beast_consumer/scripts/gen_fixtures.mjs
node examples/stress_nft/scripts/gen_fixtures.mjs
scarb fmt
scarb build
snforge test
(cd examples/beast_consumer && scarb fmt && scarb build && snforge test)
(cd examples/stress_nft && scarb fmt && scarb build && snforge test)
npm test
npm run check:segments
npm run check:data
npm run check:measurements
npm run check:settings
npm run check:abi
```

The generator builds standalone shared loader and combined engine/headless-player fragments; the canonical class artifacts are segments. Consumer fixtures are complete pages generated separately. The combined player uses deterministic fflate 0.8.3 level 9, `mtime: 0`, no filename. Terser 5.51.2 minifies the loader and API classic IIFEs. The already minified engine is copied byte for byte, followed by a statement delimiter and the separately compiled API; it is not minified again. Build records contain the exact raw/returned/source/compressed identities. A recorded artifact change without a class-version bump fails. Version 0.5.0 remains unreleased: its manifest was regenerated for the reviewed combined packaging decision, while the generator still rejects overwriting any recorded version. `--record` adds a new version; it cannot overwrite an existing version. The source of the independent fixture provider/dependent library and their records remains separate from the class.

The Beast-owned UI/document assets are generated separately into its own Cairo constants. Consumers compile their own encoder. Generators use the pinned Scarb formatter. Regeneration plus `scarb fmt` must leave the committed tree unchanged. ABI generation builds release/test artifacts and checks the seven-entry interface and sound-provider ABI. Current build assertions never mark 0.5.0 or 0.6.0 declared.

## Browser validation

Install the pinned tools with `(cd .github/ci-tools && npm ci)`. Set `PLAYWRIGHT_CORE` to that `node_modules/playwright-core`, `PLAYWRIGHT_BROWSER=chromium|firefox|webkit`, and install the corresponding browser/runtime dependencies. Then run:

```sh
npm run page-check
npm run render-check
npm run hosting-check
npm run drift-check -- --minutes 1 --every 10
node examples/beast_consumer/scripts/browser_check.mjs
# CI reports trusted SVG/audio drift while asserting pause/resume, boundaries and latency resynchronization:
npm run drift-check -- --minutes 1 --drift-info
```

Composed pages run offline with request blocking, complete namespaced data and independently provided fixture/dependent libraries. Hosting checks use `sandbox="allow-scripts"` with data/srcdoc frames and strict CSP: `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; media-src blob:`. Blocked-blob variants retain ordinary playback and exercise the NFT's hidden-page fallback; only the expected blob-media CSP report is accepted. No eval/network dependency is introduced. Audio render checks retain PCM/engine/noise/reverb comparisons against the pinned engine. Drift probes use the new consumer harness and the audio/SVG clock measurements.

Headless browsers do not establish Android/iOS lock-screen, silent-switch, calls/headset or desktop hardware-media behavior. Validate those on devices before making support claims; the outstanding device matrix is recorded with implementation results.


The [#62 browser capture](measurements/issue62.json) binds the loaded 0.6.0 player/engine hashes and records both one-minute and ten-minute sessions on Chromium 153.0.8010.12, Firefox 155.0 and WebKit 26.6 with a Linux PulseAudio null sink. The ten-minute sessions each observed 350 passes and exactly 700 SVG seeks (two timelines per boundary), with no steady-state correction seeks.

| Browser | Initial clock alignment (ms) | Maximum observed drift (ms) | Latency records |
| --- | ---: | ---: | ---: |
| chromium | -0.001 | 27.880 | 5 |
| firefox | 0.376 | 31.639 | 3 |
| webkit | 0.040 | 4.014 | 3 |

These are SVG versus estimated audible-clock observations, including the provisional display lead and transport/latency exercises. The separate one-minute capture overlapped builds/browser work and reached 105.273 ms in Chromium and 117.196 ms in Firefox; the monitor reports those excursions without correction. Initial alignment measures the timeline after seeking, not physical sound/display output. The unchanged historical Warlock fixture's embedded GIF has its own image clock; controlled animation acceptance uses outer/nested SVG/SMIL timelines.


The initial 2026-10-12 restack built on #61 head `6e93957ed7112cca3bd21ae8757f1f1cfb17c670` and the merged #57 main baseline. The [separate restack record](measurements/issue62.json) preserves the historical captures and verifies identical runtime/source/payload hashes plus the unchanged 0.5.0 and 0.6.0 records. Current checks pass 332 root JavaScript, 43 consumer and 304 Cairo cases, generation/ABI/types/format, and all three browsers' one-minute transport, composition and sandbox/media acceptance. The original ten-minute evidence is reused because those runtime bytes are unchanged, rather than presented as a new capture.

Engine #99 has merged; #98 remains open and aligned on that integration head. The existing provisional source build stays pinned to its recorded original source commit until #98 merges and distribution CI supplies the final pin; no dependency merge or engine-byte rewrite is part of this restack.

The final review restack builds on #61 head `5ce9bd9aed9fd895d1d5ffcc81413fe7e7197e0d`. It inherits compiled `VERSION` checks in both reference constructors (0.6.0 for this candidate), two older-version rejection tests, parsed active-resource validation and explicit MIDI-only recovery guidance. Current validation passes 334 root JavaScript, 43 consumer and 306 Cairo cases, generation/ABI/player-UI types/format, and 30 composed-page checks in each browser. The [final review restack record](measurements/issue62.json) verifies unchanged runtime, manifests and prepared assets while preserving all earlier capture identities.

The constructor checks change current NFT compiled artifacts. Historical token URI/NFT/gas captures are not relabeled as current-artifact captures; the separate constructor-review gas evidence remains bound to its recorded 0.5.0 builds. Browser runtime/source-bound evidence stays applicable because its engine, loader, player and NFT bootstrap bytes are unchanged. No long drift or native capture was repeated for this restack.

## Playback certification

`scripts/certification/` keeps an independent MIDI/state/pitch/demand oracle, a deterministic recorder that executes the actual composed NFT page, and a manifest-driven native-evidence validator. The page uses the current shared gunzip loader, combined engine/API payload, complete data blocks and NFT-owned UI. No fixed-page builder or legacy playback harness is retained.

```sh
npm run certify:fixture
node scripts/certification/cli.mjs --scope fixture --case bend-known-bad
npm run certify:production
```

The supported fixture checks settings installation, three loop passes, event/source timing, UI pause/resume retention and public API stop/replay. Pause/resume must retain the score, voices, run ID, origin and position without reload or new nodes; stop resets the run and the next play reloads. The known-bad RPN bend fixture must exit 1. This recorder provides software scheduling evidence only; it renders no native audio and cannot qualify a production pair.

Two certification review follow-ups remain before production qualification: the recorder's immediate transport-state/call/origin checks must also observe retained sources and subsequent playback after resume/replay, and the native validator must establish full-score capture coverage rather than only self-reported capture bounds, aggregate PCM metrics and separate note probes. The incomplete production manifest does not represent completed evidence for either requirement.

Production scope reads [`production-manifest.v1.json`](../scripts/certification/production-manifest.v1.json) and a local `scripts/certification/production-results.v1.json`. For every approved pair it hashes the exact MIDI, setup, settings and conversion inputs, requires the reviewed `wire-json-identity` mapping to produce semantically identical setup/settings JSON, and runs that pair through the current composed page. Pins include `segmentFormat`, the versioned library-manifest hash, the complete reference-page hash and each pair's complete composed-page hash. The reference page is an NFT fixture; the class publishes independent segments. There is no `PAGE_VERSION` or whole-page class artifact.

Qualification additionally requires the exact 12 first-attempt browser/build/sample-rate rows, raw float32 stereo audio, source/min engine hashes, timing-policy approval, live/offline voice budgets, versioned metrics/tolerances and physical-device evidence. Every native row binds the reviewed runtime and exact pair inputs. Browser versions alone are insufficient: evidence also pins Playwright Core, its `browsers.json` hash, browser revision and installation bundle. Raw PCM features are recomputed; unsupported analysis, missing evidence and retries remain incomplete or fail. Exit codes are 0 for a complete pass, 1 for observed failure and 2 for incomplete evidence. [Checked invariants](improvements/contracts.md) describe the current bounds.

The checked-in manifest deliberately has zero approved pairs and is incomplete; fixture results cannot make a stable release pass. `npm run check:segments` enforces certification for every candidate with major version >=1, including release candidates, while interim 0.x builds remain usable. From a 0.x checkout, `node scripts/build_segments.mjs --check --check-release-version 1.0.0` exercises the stricter preflight; either flag order works, and the actual candidate's version is always checked too. These repository checks do not prevent a direct `sncast declare`; the administrative release process must require them.

## Measurements

[Gas documentation](gas.md) distinguishes the matched split/combined packaging experiment, its review refresh and historical 0.4.0 whole-page evidence. It also records independent-fixture composition, runtime encoding, fixed/dynamic alignment, payload/token URI sizes and release Sierra/CASM size. Fixture figures are not p5.js benchmarks. For reproducible L2 values use the documented production-shaped selector commands; root helper `gas_` test-wide figures include different work.

## Release process

This 0.6.0 candidate is stacked on #61 (0.5.0) and engine PR #98. Its provisional local engine build records exact source/build-recipe/package-lock hashes in ENGINE_BUILD and the manifest; it is not the stale min.js committed at the source-only upstream PR. Before marking #62 ready, repin to the upstream post-merge CI-generated engine commit and revalidate. Release readiness requires a tagged fork release. After the implementation is reviewed/merged, prepare declaration/release artifacts with the release profile, class hash and final manifests/ABI. A declared class or deployment remains a separate maintainer-authorized transaction. Do not merge/deploy/declare or publish a release as part of implementation. Keep `deployments/` truthful: historical network records remain historical, and current build readiness is independent of them.

For a stable release, bump `VERSION` and generate/record all candidate artifacts first. Complete and review the production manifest and native/device results, then require `npm run certify:production` to exit 0. Before tagging, write that version's record in `scripts/certification/release-certificates.v1.json`: `version`, `librarySha256` from `expectedReleasePins()`, the manifest/results byte hashes and `certificateSha256` from `releaseCertificateDigest(version, librarySha256, manifestSha256, resultsSha256)` in `scripts/certification/release.mjs`. The certificate binds the immutable library version and its evidence; historical releases keep their own records. Require `npm run check:segments` and the other generated/ABI/tests to pass, commit the reviewed evidence/certificate with the release candidate, then create the release tag. Check out the tag and rerun production certification and the segment gate before declaration. This order avoids a tag that would immediately fail its own release check.
