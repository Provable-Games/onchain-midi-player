# Gas, payload and class measurements

The unreleased 0.5.0 build combines the unchanged TinySynth engine and headless API in one gzip fragment. The original packaging capture compares combined head `f1ee9c5df6cb73a84fcb42f627b9503e26678dab` with the recoverable split-fragment head `4a76614193d87f045230693fe972bbd5ac457386`. [Results and bindings](measurements/issue59.json) record the tool binaries, source/input/artifact hashes, complete case inventory and repeated captures from 2026-10-07. Prerequisite #57 remains open at `32f776185370ed519e1f14f94a0975a843069702`; rebase and revalidate against its final merged state before release. No declaration, deployment or release occurred.

## Production-shaped comparison

These tables are the 2026-10-07 frozen packaging experiment, bound to the revisions above. The namespace review fixes change browser code bytes; the [review refresh](#review-refresh) records their fresh production capture separately.

Both revisions use Scarb 2.20.1, Cairo/CASM compiler 2.20.0, Sierra 1.9.3 and snforge 0.64.0, default features, release profile and Sierra gas. `--no-optimization` builds separate contract targets, avoiding test-specialized contract artifacts. Each capture ran twice with identical results.

The actual Beast NFT uses the same setup, local caller/block context and token 4: the 22,733-byte shiny Warlock SVG, 3,716-byte MIDI and three Beast sounds (334 serialized settings bytes).

| Actual full NFT measurement | Split | Combined | Change |
| --- | ---: | ---: | ---: |
| `BeastLikeNft.token_uri` selector L2 gas | 413,985,168 | 413,511,218 | −473,950 (0.1145%) |
| Test-wide L2 gas, including fixture/setup | 429,355,528 | 428,752,938 | −602,590 (0.1403%) |
| Complete token URI characters | 167,905 | 166,417 | −1,488 |

Selector gas includes nested library calls; adding those costs again would double count them. Test-wide and selector measurements describe different work. These are execution measurements, not transaction/declaration fees or RPC support guarantees.

A temporary separately compiled `CompositionProbe.token_uri` returns the complete ByteArray and calls the actual MIDI and independent fixture providers. Its runtime class-hash arguments and small/full selector exercise both compositions without folding the result to a length. Each test validates the whole URI length and SHA-256 against the independent JS nesting/splicing reference. A same-length incorrect URI prefix compiles successfully and fails the content assertion, qualifying the oracle. Complete layers decode correctly, and split/combined metadata, original SVG, settings, MIDI and exact engine bytes agree; HTML payload identity intentionally changes.

| Composition selector L2 gas | Split | Combined | Change |
| --- | ---: | ---: | ---: |
| Small MIDI-only, fixed279 | 31,153,288 | 30,679,338 | −473,950 |
| Small independent fixture, fixed279 | 31,387,298 | 30,913,348 | −473,950 |
| Full MIDI-only, fixed279 | 413,782,418 | 413,308,468 | −473,950 |
| Full independent fixture, fixed279 | 414,016,428 | 413,542,478 | −473,950 |
| Small MIDI-only, minimum9 | 31,686,758 | 31,226,728 | −460,030 |
| Small independent fixture, minimum9 | 32,008,208 | 31,548,178 | −460,030 |
| Full MIDI-only, minimum9 | 413,902,488 | 412,770,838 | −1,131,650 |
| Full independent fixture, minimum9 | 414,223,938 | 413,092,288 | −1,131,650 |

The independent library is the 78-byte named-export fixture, with its own provider and manifest. Browser tests also include a dependent gzip block and verify once-only shared loading and actual use of the export. These measurements contain no real p5.js payload or integration.

## Alignment trade-off

Neither fixed alignment dominates. In the combined build, 279-byte raw padding saves 547,390 gas (about 1.75%) on small MIDI-only composition; minimum9 saves 537,630 (about 0.13%) on full composition. Keep **279 as the default** for straightforward word-aligned fixed returns and its small-input advantage. The nine-byte fragment contract remains the interoperability requirement. The fixture follows the same trade-off: 279 saves 634,830 on small, while nine saves 450,190 on full.

Dynamic data remains at **minimum nine-byte padding**. The unchanged encoding probes with a 3,716-byte MIDI/default settings cost 53,969,010 test-wide gas at nine versus 55,997,370 at 279. These helper measurements describe dynamic encoding separately, rather than substituting for production selector gas. Both art/data orders and byte-identical runtime reconstruction of each revision remain covered by the Cairo/JS suites.

## Payload and class sizes

| Frozen combined provider fragment | Source bytes | Gzip bytes | Raw HTML bytes | Returned bytes / serialized felts |
| --- | ---: | ---: | ---: | ---: |
| Shared loader | 4,465 | inline | 4,743 | 8,432 /275 |
| Combined engine/headless API | 55,687 | 17,970 | 24,273 | 43,152 /1,395 |

Fixed returns total **51,584 bytes**, down from 53,072 (−1,488; 2.8037%). Minimum9 totals 51,152 bytes. The loader bytes are unchanged. The combined source contains the exact 47,212 engine bytes at offset 0, a three-byte statement delimiter and the separately minified 8,472-byte API. The frozen manifest is bound in the [capture record](measurements/issue59.json); the active [manifest](../scripts/library_versions.json) now contains the review refresh below. Both record combined source/gzip hashes and distinct embedded-engine/API byte ranges and hashes. `script_sha256()` still identifies the original engine: `bcb498b915beb397f0333b22a59a4485d00025ff1e098cbf65823b9646759d74`.

| Separately built release artifact | Split | Combined | Change |
| --- | ---: | ---: | ---: |
| TinySynth Sierra JSON bytes | 983,489 | 973,255 | −10,234 |
| TinySynth Sierra program felts | 18,764 | 18,581 | −183 |
| TinySynth CASM JSON bytes | 787,215 | 780,098 | −7,117 |
| TinySynth CASM bytecode felts | 29,962 | 29,730 | −232 |
| Composition consumer Sierra JSON bytes | 710,451 | 705,788 | −4,663 |
| Composition consumer Sierra program felts | 13,447 | 13,374 | −73 |
| Composition consumer CASM JSON bytes | 575,265 | 573,400 | −1,865 |
| Composition consumer CASM bytecode felts | 23,163 | 23,069 | −94 |

These are emitted compact artifact sizes. The public MIDI ABI has exactly seven entries. The final 0.5.0 composition carries NFT-owned UI, isolated image framing and composability work; the small split-to-combined savings above are **not** a saving over the previous whole-page architecture. The prior pending 0.4.0 default test-wide measurement of 303,820,178 gas/150,101 URI characters is historical architecture evidence; it was not remeasured for this packaging update and is not the matched comparator above.

## Review refresh

The 2026-10-08 namespace review fixes preserve fixed279 returned lengths and the full 166,417-character Beast URI. Fresh production-shaped Beast captures, run twice with the same compiler/profile/resources/setup/input, remain **413,511,218 selector L2 gas** and **428,752,938 test-wide L2 gas**. The [record](measurements/issue59.json) binds the revised sources, emitted artifacts and both captures separately from the frozen packaging experiment.

| Revised provider fragment | Source bytes | Gzip bytes | Raw HTML bytes | Returned bytes / serialized felts |
| --- | ---: | ---: | ---: | ---: |
| Shared loader | 4,524 | inline | 4,743 | 8,432 /275 |
| Combined engine/headless API | 55,739 | 18,008 | 24,273 | 43,152 /1,395 |

The exact 47,212-byte engine remains unchanged; the wrapper is now 8,524 bytes. Fixed279 still totals 51,584 returned bytes; the refreshed minimum9 payload totals 51,360 bytes. Minimum9 gas and the eight-case temporary comparison were not remeasured for these initialization fixes, so their tables remain frozen historical evidence. The default remains 279, with its previously measured small/full trade-off.

The current separately built TinySynth has 973,661 compact Sierra JSON bytes /18,589 program felts and 780,098 compact CASM JSON bytes /29,730 bytecode felts. Compared with the frozen combined class, Sierra grows 406 bytes /8 felts; CASM size is unchanged. Payload hashes and byte values change even where sizes/gas do not.

## A full-size token

Budget the complete NFT selector, including its art and metadata, provider calls and encoding. The production-shaped full Beast example above costs about 413.5 million L2 gas; the smaller isolated `midi_segment` call does not establish its RPC budget. Measure the actual largest token and the service that will fetch it before deployment.

## `midi_segment` by MIDI and SETTINGS size

The frozen production selector captures include a small 32-byte score and 16-byte defaults (`midi_segment`: 8,669,288 L2 gas), and the full 3,716-byte score with 334-byte Beast settings (`midi_segment`: 59,244,958). Both MIDI and settings change between these examples, so they do not define a per-byte slope. Do not apply historical whole-page or settings rates to this replacement.

For your own distribution, run the named root `gas_` probes with fixed compiler/profile/resources and compare matching inputs. The [sound settings fixtures](../scripts/settings_fixtures.mjs) provide defaults, Beast timbres, custom waves and filters. Root helper test-wide totals include their setup; report them separately from nested selector gas. The [Beast selector reproduction](#reproduce) measures the complete NFT path.

## The size of `SETTINGS`

Defaults serialize to 16 bytes; the three Beast sounds serialize to 334 bytes. Every supplied wave/timbre/operator is validated, serialized and encoded at call time; the class imposes no serialized byte cap. Count the actual encoded settings (preview reports that length) and measure both the provider and `midi_segment`. Prefer the per-token subset and short wave tables. A historical per-KB estimate is not a current measurement, and large sample tables also cost the provider work to construct or return.

## Node limits

A successful local snforge call does not establish a hosted `starknet_call` budget. Nodes impose configurable gas/step caps, timeouts and response limits. Juno v0.16.7 defines defaults of 100,000,000 Sierra gas and 4,000,000 VM steps in [its VM source](https://github.com/NethermindEth/juno/blob/v0.16.7/vm/vm.go); [its CLI](https://github.com/NethermindEth/juno/blob/v0.16.7/cmd/juno/juno.go) exposes `rpc-call-max-gas` and `rpc-call-max-steps`. The full Beast capture exceeds that default gas budget; hosted providers may configure a different cap. These source defaults were checked on 2026-10-08, and are not observed budgets for PublicNode, dRPC or any other service.

[Starknet's accounting rules](https://docs.starknet.io/learn/protocol/fees#l2-computation) distinguish Sierra ≥1.7.0 from older Sierra/CairoZero; Sierra gas tracking depends on the parent call's accounting too. Use Sierra ≥1.7.0 across the NFT/renderer/provider library path to reproduce these Sierra-gas measurements; include the account when estimating a transaction. Older paths require VM-resource/step measurements instead. This is measurement guidance, not a new runtime restriction.

Check realistic largest token IDs against the actual provider/marketplace fetch path. Record chain, endpoint, block, call inputs and observed errors; repeat when those conditions change. The stress consumer's opt-in probes support this work. Historical Sepolia deployment/provider observations remain historical and cannot guarantee a new class is served.

## Browser evidence

The 2026-10-07 frozen packaging revision passed the evidence below. The review revision additionally reran the complete composed/custom-control page checks in all three engines, including SVG gzip decoys, foreignObject HTML libraries, document-wide data collisions, inert template contents and foreign-only data rejection. Audio-render/drift and hosting probes were not repeated for the initialization-only fixes.

Chromium 153.0.8010.12, Firefox 155 and WebKit 26.6 pass composed pages, independent/dependent providers, custom NFT controls, loader lifecycle/errors, parser agreement on normal/self-closing SVG/plaintext, six strict-CSP sandbox/media cases and the retained audio-render suite. A focused one-minute combined Chromium drift probe passes schedule/rest/cancellation/restart checks; the drift trend remains informational. The prior split three-engine drift checks remain historical evidence.

In that frozen experiment, three fresh full-size MIDI-only contexts per build measure init-script to NFT control enable and captured click to engine `playMIDI`. Median milliseconds:

| Browser | Split startup | Combined startup | Split first play | Combined first play |
| --- | ---: | ---: | ---: | ---: |
| Chromium | 9.8 | 17.3 | 59.9 | 67.9 |
| Firefox |15 |19 |1,735 |1,748 |
| WebKit |8 |10 |90 |88 |

These descriptive samples are not performance guarantees. The initial Firefox run timed out because the prior local PulseAudio socket had expired; restoring the null sink made the complete suites pass. Hardware/mobile lock-screen, silent-switch, calls/headset and media controls remain device validation.

## Reproduce

Use separate checkouts of the frozen split head and this revision, with their pinned locks/tools. Run each actual NFT capture twice:

```sh
npm ci
npm run check:segments
npm run check:data
npm run check:measurements
npm run check:abi
scarb --release build
node scripts/measure_payloads.mjs /path/to/split-checkout
(cd examples/beast_consumer && snforge test --release --no-optimization --tracked-resource sierra-gas --gas-report gas_t4_direct_splicing)
```

The eight-case composition lab is **temporary snapshot evidence**, not a checked-in clone-and-run benchmark. The review workspace retains its preparation scripts, copied fixture sources, full-return wrapper, complete golden cases and two captures per revision under `/tmp/issue61-*`; the JSON record binds these files and separately compiled artifacts by hash. Its command was `snforge test --release --no-optimization --tracked-resource sierra-gas --gas-report test_measure`. Those paths support auditing this captured experiment in the shared review workspace. The checked-in Beast commands above are the permanent reproduction route for the actual full NFT selector comparison. No diagnostic contract is part of the production MIDI package or ABI.

Standard root helper gas probes remain available with `snforge test gas_ --tracked-resource sierra-gas`, but their default test-wide numbers are not interchangeable with production selector captures. Run browser checks with the established pinned Playwright/null-sink setup; [development](development.md) documents the commands. The stress consumer retains its opt-in large-token gas/RPC probes; unit execution does not establish public RPC call budgets.
