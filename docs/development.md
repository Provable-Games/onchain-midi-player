# Development and release

Use the pinned `.tool-versions`, `Scarb.lock`, `package-lock.json` and `.github/ci-tools/package-lock.json`. The current implementation depends on [PR #57](https://github.com/Provable-Games/onchain-midi-player/pull/57)'s final merged 0.4.0 baseline; while that prerequisite remains open, implementation/measurement results describe its verified pending head, not a landed release.

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

The Beast-owned UI/document assets are generated separately into its own Cairo constants. Consumers compile their own encoder. Generators use the pinned Scarb formatter. Regeneration plus `scarb fmt` must leave the committed tree unchanged. ABI generation builds release/test artifacts and checks the seven-entry interface and sound-provider ABI. Current build assertions never mark 0.5.0 declared.

## Browser validation

Install the pinned tools with `(cd .github/ci-tools && npm ci)`. Set `PLAYWRIGHT_CORE` to that `node_modules/playwright-core`, `PLAYWRIGHT_BROWSER=chromium|firefox|webkit`, and install the corresponding browser/runtime dependencies. Then run:

```sh
npm run page-check
npm run render-check
npm run hosting-check
npm run drift-check -- --minutes 1 --every 10
node examples/beast_consumer/scripts/browser_check.mjs
# CI reports image/audio drift while asserting schedule/rests/restarts/cancellation:
npm run drift-check -- --minutes 1 --drift-info
```

Composed pages run offline with request blocking, complete namespaced data and independently provided fixture/dependent libraries. Hosting checks use `sandbox="allow-scripts"` with data/srcdoc frames and strict CSP: `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; media-src blob:`. Blocked-blob variants retain ordinary playback and exercise the NFT's hidden-page fallback; only the expected blob-media CSP report is accepted. No eval/network dependency is introduced. Audio render checks retain PCM/engine/noise/reverb comparisons against the pinned engine. Drift probes use the new consumer harness and the existing audio/image clock measurements.

Headless browsers do not establish Android/iOS lock-screen, silent-switch, calls/headset or desktop hardware-media behavior. Validate those on devices before making support claims; the outstanding device matrix is recorded with implementation results.

## Measurements

[Gas documentation](gas.md) reports like-for-like MIDI-only pending-0.4.0/new pages and the independent-fixture composition, runtime encoder, fixed/dynamic alignment, payload/token URI sizes, materialization/appending/data encoding and release Sierra/CASM size. Fixture figures are not p5.js benchmarks. For reproducible L2 values use `snforge test gas_` in root and Beast packages; pass/fail checks are separate from measurement overhead.

## Release process

After #57 lands, rebase onto its final merged artifacts and revalidate. After this breaking implementation is reviewed/merged, prepare the 0.5.0 declaration/release artifacts with the release profile, class hash and final manifests/ABI. A declared class or deployment remains a separate maintainer-authorized transaction. Do not merge/deploy/declare or publish a release as part of implementation. Keep `deployments/` truthful: historical network records remain historical, and current build readiness is independent of them.
