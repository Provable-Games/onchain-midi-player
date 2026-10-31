# Current engine provenance

The engine is [pocket-synth](https://github.com/Provable-Games/pocket-synth), Provable Games' fork of g200kg's [webaudio-tinysynth](https://github.com/g200kg/webaudio-tinysynth); its distribution files keep the `webaudio-tinysynth.*` names. The 0.12.0 class embeds `webaudio-tinysynth-v2.1.2.min.js` from the signed fork release tag `v2.1.2` (GPG-signed by loothero), commit `4a2dc1cd7e43e9a8df26dd3e96f41eed62e2c9b9` on the fork's main. The release pull request #128 built and committed the minified script and source map on `release/v2.1.2` at `f1276f041271d392f7043e47c0a1b12438a6e572`; [its CI run](https://github.com/Provable-Games/pocket-synth/actions/runs/41020790486) verified that the committed files equal a fresh build. The tag commit is that pull request's merge and has the identical tree: the same source, NOTICE, lock, script and map. The established `scripts/vendor_engine.mjs` helper copies the tag's exact minified script and NOTICE; neither file is patched locally.

`ENGINE_PIN` names the tag commit. `ENGINE_BUILD` and the manifest are non-provisional and record the release build commit (`sourceCommit` and `distributionCommit`), its CI run, the source SHA-256, build recipe, that commit's lockfile and the source map. To reproduce, check out `v2.1.2` in an isolated fork clone, run `npm ci`, then `node scripts/build.js <output-dir>` and compare both outputs against the committed files. The pinned compiler is Terser 5.51.2. The release's published assets have the same SHA-256 as the script and map.

- Engine: 48,696 bytes, SHA-256 `1cc2fe98bdd9c8ae0d030d00f5b5350f139a4062a314176f07ca4b820debe4f4`.
- Source: SHA-256 `b53678d784d85f16b1bb6fbcb7cd50277df6192ec011e79940e8a8d5bb7d06d0`.
- Source map: 77,578 bytes, SHA-256 `15a3a957614d8c29445692d2b8ad3524ccf9eb4748200697e62019233913752e`.
- NOTICE: SHA-256 `6ff04a5bc4e832ce90f2e3c033eacb68777d58bfc66708f2347a2e059d614595`.
- `scripts/build.js`: SHA-256 `ec9bbbf2adc1da286af30698fa1889d71142e95b88a83b2d94c2b9fc82f51728`.
- `package-lock.json` (`f1276f0` and the tag): SHA-256 `dd87c94ac3137b2d0ca8187868066da31f193fe8c3432bf20013bda6e51537e8`.

This pin is a tagged fork release. Applicable device/provider evidence remains a release prerequisite; the 0.8.0, 0.9.0, 0.10.0, 0.11.0 and 0.12.0 classes are declared on Sepolia only as test classes without a release tag, not mainnet-qualified releases.

## Historical engine and licenses

The retained 0.11.0 engine, `webaudio-tinysynth-v2.1.1.min.js` (48,645 bytes, SHA-256
`b0be448e3c0959862e1f83f3b22c0550dc27d13094757430bf2ed4a28a28ceed`) and `webaudio-tinysynth-v2.1.1.NOTICE` (SHA-256
`ff3f337c324f6522c6831fe096076d6eba672ef03e40608a5fcf1bf59dd3fca0`), is the signed fork release tag `v2.1.1`, commit
`e0b1a897f34968ba3ecfad3fddfbac815499c9c0`, built by release pull request #126 at `fbe394e86fa7ba2e2581aad018e94b10eadc52e1`
([its CI run](https://github.com/Provable-Games/pocket-synth/actions/runs/41007922128)). The 0.11.0 class declared on Sepolia
as a test class embeds it. Its provenance is recorded in the 0.11.0 manifest entry.

The retained 0.8.0, 0.9.0 and 0.10.0 engine, `webaudio-tinysynth-v2.1.0.min.js` (48,746 bytes, SHA-256
`9be3f30479321274aff644a0a5d1ab8aa0e431f9f8e9a2548cdd89f72c4281b4`) and `webaudio-tinysynth-v2.1.0.NOTICE` (SHA-256
`57e35bc6d5e34f54efccfdfe4c50a695679810ac586fb24d7d1242bfb07067df`), is the signed fork release tag `v2.1.0`, commit
`92e3bef0eac09a5ccbdaca2b07f6ba348c2f1cd2`, built by release pull request #124 at `a5b5c98716d390542738d87b29d1cc5664316081`
([its CI run](https://github.com/Provable-Games/pocket-synth/actions/runs/40908453483)). The 0.8.0, 0.9.0 and 0.10.0 classes
declared on Sepolia as test classes embed it. Its provenance is recorded in their manifest entries.

The retained 0.7.0 engine, `webaudio-tinysynth-v2.0.1.min.js` (47,804 bytes, SHA-256
`8ffa2519cdd0ac9c4876101681014e39cbfd07e71d45ea1fa5dc15d53233f94b`) and `webaudio-tinysynth-v2.0.1.NOTICE` (SHA-256
`0e4f6ad003a1cf9e2ea2620b57a8a7eec4b396064e222316782b70cb6693652b`), is the signed fork release tag `v2.0.1`, commit
`4b829693d112d27e4dfaeb126d1912ff89216324`, built by release pull request #111 at `c17c7427031f489f27d11d83d5502c1d4746fa77`
([its CI run](https://github.com/Provable-Games/pocket-synth/actions/runs/38368777784)). The 0.7.0 class declared on Sepolia
as a test class embeds it. Its provenance is recorded in the 0.7.0 manifest entry.

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

Audit the current pin without changing generated files or making network calls:

```sh
git -C <pocket-synth-checkout> fetch origin --tags
npm run check:engine-pin -- --fork <pocket-synth-checkout> --latest
```

The audit verifies the annotated GPG-signed tag resolves to the full pinned commit; requires the signature to match `ENGINE_RELEASE_SIGNER` in `scripts/engine.mjs`; checks source, build recipe, lockfile, map, engine and NOTICE hashes against the source/distribution commits; and checks the actual decompressed player fragment. `--latest` additionally compares the engine inputs with the **locally fetched** `origin/main`; it does not fetch automatically or claim the remote has not changed since the fetch. GPG must have the release signer's public key. Confirm that key's fingerprint independently against the maintainer's signing identity before trusting it; review signer changes when re-pinning. The current `v2.1.2` signer fingerprint is `B3B5E2A6C50C29F90A868653CD7025F6005367A5`.

Reproducibility is a separate check: in an isolated checkout of the pinned tag, use its `.nvmrc`, `npm ci` and `npm run verify`. The fork's `release:prepare` helper also produces a machine-readable manifest and checksummed upload directory for signed release tags. Newly published fork releases use immutable GitHub releases; upload all assets to a draft before publishing. Historical releases remain auditable by their signed tags and published hashes. Neither audit qualifies a player class for mainnet or authorizes publishing a release.

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
