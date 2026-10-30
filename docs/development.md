# Development and release

Use the pinned `.tool-versions`, `Scarb.lock`, `package-lock.json` and `.github/ci-tools/package-lock.json`. The class supplies composable shared-loader and combined engine/API fragments; NFTs own their document, art, controls and media policy. Earlier measurements retain their original source and artifact bindings; later provenance/revalidation is recorded separately.

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
(cd types && scarb fmt && scarb build)
(cd examples/owned_assets && scarb fmt && scarb build)
(cd examples/beast_consumer && scarb fmt && scarb build && snforge test)
(cd examples/stress_nft && scarb fmt && scarb build && snforge test)
npm test
npm run check:segments
npm run check:data
npm run check:measurements
npm run check:settings
npm run check:abi
```

The generator builds standalone shared loader and combined engine/headless-player fragments; the canonical class artifacts are segments. Consumer fixtures are complete pages generated separately. The combined player uses deterministic fflate 0.8.3 level 9, `mtime: 0`, no filename. Terser 5.51.2 minifies the loader and API classic IIFEs. The already minified engine is copied byte for byte, followed by a statement delimiter and the separately compiled API; it is not minified again. Build records contain the exact raw/returned/source/compressed identities. A recorded artifact change without a class-version bump fails. Version 0.5.0 remains unreleased, and its finalized record is unchanged. `--record` adds a new version; it cannot overwrite an existing version. The source of the independent fixture provider/dependent library and their records remains separate from the class.

The sound types, `ITinySynth`, `ISoundProvider` and `settings::validate` are the package `tinysynth_interface` in [`types/`](../types), a member of the root workspace that depends on nothing but `starknet`, so other projects can depend on it without the class's dependencies ([Depending on the types](sound-provider.md#depending-on-the-types)). Its root (`types/src/lib.cairo`) re-exports every public item of its `types`, `interface` and `settings` modules, so consumers import from `tinysynth_interface::` directly; the items stay declared in their modules, so the re-exports change no ABI or class hash, and `tests/test_root_exports.cairo` checks that each root item is the module's. The root package depends on it by path and re-exports it at the earlier paths (`src/types.cairo`, `src/interface.cairo`, and `src/settings.cairo`, which keeps the `SETTINGS` encoder); the root's tests cover `validate`. Commands in the root act on the root package (`--workspace` for both); in `types/` they act on `tinysynth_interface`, with the root's `Scarb.lock` and `target/`. The ABIs name the types and interfaces by their declaring path, `tinysynth_interface::...`, so the package name is part of the TinySynth class hash. Moving them into the package (then named `onchain_midi_types`) changed the class hash, though not the CASM bytecode beyond the version constant or any measured gas, so it shipped as class 0.9.0. Renaming the package to `tinysynth_interface` changed the class hash again in the same way, so it ships as class 0.10.0.

The Beast-owned UI/document assets are generated separately into their own Cairo package, [`examples/owned_assets`](../examples/owned_assets), which both examples depend on and the root package's tests use as a dev-dependency. It depends on nothing, so no dependency cycle forms. Consumers compile their own encoder. Generators use the pinned Scarb formatter. Regeneration plus `scarb fmt` must leave the committed tree unchanged. ABI generation builds release/test artifacts and checks the seven-entry interface and sound-provider ABI. 0.5.0 and 0.6.0 have not been declared. 0.7.0, 0.8.0, 0.9.0, 0.10.0 and 0.11.0 remain declared on Sepolia as earlier test classes. 0.12.0 is declared on Sepolia as a test class (`release_tag` null) with the Beast reference example deployed against it; [`deployments/sepolia.json`](../deployments/sepolia.json) records the class hash, transactions, addresses and build commit.

## Browser validation

Install the pinned tools with `(cd .github/ci-tools && npm ci)`. Set `PLAYWRIGHT_CORE` to that `node_modules/playwright-core`, `PLAYWRIGHT_BROWSER=chromium|firefox|webkit`, and install the corresponding browser/runtime dependencies. Then run:

```sh
npm run page-check
npm run render-check
npm run hosting-check
# Asserts pause/resume, boundaries, latency resynchronization and a coarse per-engine limit on
# trusted SVG/audio drift (the CI browser job runs 1 minute; the Drift workflow runs 10 weekly
# and on demand, 3 on pull requests):
npm run drift-check -- --minutes 1 --every 10
node examples/beast_consumer/scripts/browser_check.mjs
```

The drift check then plays an isolated `<img>` whose GIF the footer retimes to the music (frame changes within 10 ms of the beat for passes of up to a few minutes; see the [layout guide](token-uri-layout.md#isolated-community-art)) (the Warlock reference's 131.87 BPM score), for the session's length up to 2 minutes, and asserts that within each run of the GIF (one pass, between restarts) its frame changes drift under 30 ms against the beat grid (the GIF itself keeps the grid exactly; the rest is the page's image clock against the audio clock, 0.04% apart in headless Chromium, and screenshot timing), from screenshots between reads of the audible position. Headless Firefox shows no GIF animation inside an SVG image, so it skips that part; `page_check` checks the retimed GIF's bytes, frame period, phase, pause still, resume and visibility restarts in every engine (timing in Chromium and WebKit only).

Composed pages run offline with request blocking, complete namespaced data and independently provided fixture/dependent libraries. Hosting checks use `sandbox="allow-scripts"` with data/srcdoc frames and strict CSP: `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src blob:`. Blocked-blob variants retain ordinary playback and exercise the NFT's hidden-page fallback; only the expected blob-media CSP report is accepted. No eval/network dependency is introduced. Audio render checks retain PCM/engine/noise/reverb comparisons against the pinned engine. Drift probes use the new consumer harness and the audio/SVG clock measurements.

Headless browsers do not establish Android/iOS lock-screen, silent-switch, calls/headset or desktop hardware-media behavior. Validate those on devices before making support claims; the outstanding device matrix is recorded with implementation results.


The [#62 browser capture](measurements/issue62.json) binds the loaded 0.6.0 player/engine hashes and records both one-minute and ten-minute sessions on Chromium 153.0.8010.12, Firefox 155.0 and WebKit 26.6 with a Linux PulseAudio null sink. The ten-minute sessions each observed 350 passes and exactly 700 SVG seeks (two timelines per boundary), with no steady-state correction seeks.

| Browser | Initial clock alignment (ms) | Maximum observed drift (ms) | Latency records |
| --- | ---: | ---: | ---: |
| chromium | -0.001 | 27.880 | 5 |
| firefox | 0.376 | 31.639 | 3 |
| webkit | 0.040 | 4.014 | 3 |

These are SVG versus estimated audible-clock observations, including the provisional display lead and transport/latency exercises. The separate one-minute capture overlapped builds/browser work and reached 105.273 ms in Chromium and 117.196 ms in Firefox; the monitor reports those excursions without correction. Initial alignment measures the timeline after seeking, not physical sound/display output. The unchanged historical Warlock fixture's embedded GIF has its own image clock; controlled animation acceptance uses outer/nested SVG/SMIL timelines.


Historical restack and constructor-review checks remain recorded in the [source-bound measurements](measurements/issue62.json). Through the NFT-only follow-ups, engine source, shared loader and player remained byte-identical. Those UI fixes change the bootstrap and prepared token outputs; earlier long captures retain their original UI/source bindings. Constructor checks changed compiled NFT artifacts, so earlier NFT/token URI/gas captures keep their original artifact identities; the separate constructor-review gas capture is not a new 0.6.0 measurement.

The 0.12.0 engine is pinned to the signed release tag `v2.1.2` of [pocket-synth](https://github.com/Provable-Games/pocket-synth), Provable Games' fork of g200kg's webaudio-tinysynth, at commit `4a2dc1cd7e43e9a8df26dd3e96f41eed62e2c9b9`, the merge of release pull request #128. That pull request built and committed the minified script and source map at `f1276f041271d392f7043e47c0a1b12438a6e572`, and [its CI run](https://github.com/Provable-Games/pocket-synth/actions/runs/41020790486) checked them against a fresh build; the tag commit has the identical tree. A fresh pinned build of the tag reproduces both minified script and source map. `ENGINE_BUILD` records the verified source, recipe and lock identities and is non-provisional. The engine change was recorded as a new 0.12.0 manifest entry; the earlier records are unchanged, 0.11.0 keeps the signed release `v2.1.1`, and 0.8.0, 0.9.0 and 0.10.0 keep `v2.1.0` ([vendor provenance](../tests/vendor/README.md)). v2.1.0 changed engine behavior that the [MIDI contract](midi-contract.md) documents and `scripts/engine_contract.test.mjs` pins: the sequencer looks 1 s ahead on a coarse pointer, the voice limit cuts at the new note's start, and CC120, CC121 and CC123–127 act at their own time. Its synth-owned contexts on a coarse pointer also asked for `latencyHint: "playback"`; v2.1.1 drops that hint, so every synth-owned context is a default `new AudioContext()`, and keeps the rest. v2.1.2 sets the oscillators' `detune` to `automationRate = "k-rate"` where the browser supports it, so pitch bend and CC1 vibrato are computed once per 128-frame render quantum instead of per sample; browsers without `automationRate` keep per-sample detune. The 0.12.0 player wrapper and shared loader are byte-identical to 0.11.0's; the browser captures above and below are bound to 0.6.0 payloads and are not browser evidence for any later class.

The current review validation separately records fresh one-minute Chromium/Firefox/WebKit runs against the updated NFT UI. Test-only public `synth.send` observations independently check every scheduled message against the audio clock and the fixture's unique tick-zero opening note against `origin + k * midi_loop_seconds`, with a 1 µs grid tolerance and zero late sends. Captured API pass announcements must match their actual scheduled opening notes; live engine `startTime` is unsuitable because lookahead can advance it into a later pass. Negative controls detect a shifted grid, missing/duplicate openings, mismatched API announcements and a late non-opening message. The historical ten-minute capture did not record these independent send observations and is not new scheduling evidence for the updated UI.

Fresh runs each observed 35 steady passes and 70 boundary-only SVG seeks, with maximum engine-grid error below 4e-13 seconds and zero late sends across pause/resume and external suspension. That capture's 31 composed-page cases per engine include trusted outer/nested SVG recovery after missing-player readiness failure. A queued captured-snapshot unit regression covers an earlier stopped subscriber immediately replaying: under [#64](https://github.com/Provable-Games/onchain-midi-player/pull/64)'s UI, each new run held zero until audible start, while same-run resume retained phase. Capture-specific artifact hashes and results are appended to the measurements without relabeling historical NFT/gas or long browser captures. The terminal-failure follow-up adds a 32nd page case per engine: a public engine resume rejection leaves the player failed and controls disabled, while trusted outer/nested SVG timelines continue independently. First-start, active and paused failure regressions also verify cancellation of synchronization frames and pausing of optional synced notes. Under that UI, normal stopped/paused states stayed frozen, with healthy starts held at zero until audibility; the follow-up recorded fresh short synchronization smoke against those UI bytes. Since [#72](https://github.com/Provable-Games/onchain-midi-player/pull/72) the reference no longer holds or rewinds the art: it runs freely before the initial pass event and after stop, a new run or a failure, and freezes only on pause or suspension (see the [layout guide](token-uri-layout.md#player-events-and-nft-policy)).


A later paused-position fix changes the combined player payload: suspended `positionSeconds` is anchored at the actual frozen audio clock before accepted latency updates, while current latency/revision metadata continues publishing. The latest compensation applies once audio runs again. Asynchronous suspension keeps its last advancing clock time; stop/new run clears the held position. The **unissued, undeployed 0.6.0 candidate** record was explicitly refreshed through the existing remove-one-entry/`--record` process, preserving the 0.5.0 record exactly and the normal immutable-version guard. This is a candidate iteration, not permission to rewrite issued versions. Exact CI engine bytes, source/build provenance, NOTICE, license and shared gunzip remain unchanged. Earlier player/grid/gas captures keep their original payload identities; fresh one-minute schedule/page/hosting acceptance is bound to the updated player in the measurements.

The strict-CSP host matrix now includes both isolated art and the trusted font-bearing Warlock reference in data/srcdoc sandboxes with allowed, blocked and omitted blob-media policies. Inline data fonts require `font-src data:`: a Chromium negative probe without it produced a `font-src` violation and an errored VT323 face, while all three engines loaded VT323 under the updated policy without font violations. This changes no remote font or media-policy dependency.

A subsequent terminal-failure fix (#67) changes the combined player payload again: a failure (including a closed AudioContext, which previously rejected as a cancellation) now invalidates in-flight transport and rejects a pending `play()`/`resume()` with its cause, so a late engine resume can neither move the player out of `failed` nor leave that promise unsettled, and a later stale failure cannot replace the first error. The **unissued, undeployed 0.6.0 candidate** record was refreshed through the same remove-one-entry/`--record` process, preserving the 0.5.0 record exactly and the immutable-version guard. Engine bytes, provenance, NOTICE, license, shared gunzip and the returned segment lengths are unchanged. Earlier source-bound captures, including the paused-position refresh's browser acceptance, keep their original player bindings; this refresh records headless, generation and Cairo checks only, with no new browser, drift or gas capture.

## Measurements

[Gas documentation](gas.md) distinguishes the matched split/combined packaging experiment, its review refresh and historical 0.4.0 whole-page evidence. It also records independent-fixture composition, runtime encoding, fixed/dynamic alignment, payload/token URI sizes and release Sierra/CASM size. Fixture figures are not p5.js benchmarks. For reproducible L2 values use the documented production-shaped selector commands; root helper `gas_` test-wide figures include different work.

## Release process

`tinysynth_interface` is released on its own, with a tag `tinysynth_interface-v<version>` on the commit to pin, `<version>` being the `version` in [`types/Scarb.toml`](../types/Scarb.toml); bump it for every release that changes the package, and keep the felt layouts of `TinySynthSettings` and `TinySynthSound` fixed once released. Consumers pin that tag with one identical source string ([Depending on the types](sound-provider.md#depending-on-the-types)). Class releases keep the tag `v<version>`. The package was first tagged under its earlier name as `onchain_midi_types-v0.1.0`; that tag stays for existing pins.

Release readiness requires a tagged fork release with its published SHA-256, applicable real-device/provider validation and release-profile class/manifest/ABI artifacts. A verified CI build alone does not establish a tagged release or mainnet readiness. Declaration, deployment and release transactions remain separately authorized maintainer actions. Keep `deployments/` truthful: historical network records remain historical, and current build readiness is independent of them.
