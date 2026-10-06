# Gas, payload and class measurements

These 0.5.0 measurements use Scarb 2.20.1, snforge 0.64.0 and **Sierra gas** on 2026-10-06. [Machine-readable results](measurements/issue59.json) record the named probes, payload identities and class sizes. The comparison baseline is the verified **pending, unmerged** #57 head `32f776185370ed519e1f14f94a0975a843069702`; rebase and repeat against its final merged state before release. No class was declared or deployed for these checks.

## Full-size reference and encoding choices

The common input is the shiny Warlock SVG (22,733 bytes), a 3,716-byte synthetic MIDI and the three Beast sounds (334 serialized settings bytes). Both versions preserve the same visible/music/background behavior. The replacement safely frames supplied art as an encoded complete `<img>`, with bootstrap and closing HTML after it.

| Full reference | L2 gas | Token URI characters |
| --- | ---: | ---: |
| Pending 0.4.0 whole-page baseline, same NFT setup and token 4 | 303,820,178 | 150,101 |
| 0.5.0 Beast NFT, direct splicing | 429,355,528 | 167,905 |
| 0.5.0 runtime reconstruction and nested encoding, byte-identical output | 831,613,928 | 167,905 |

The complete safe framing costs **41.3% more** than the previous art-as-document-tail representation. Direct splicing saves **48.4%** relative to reconstructing/encoding the complete replacement page at runtime. This includes each test's input/setup work, not the SHA-256 golden comparison. Both NFT versions have the same separately measured setup cost, 872,340 gas; subtracting it gives 302,947,838 for the pending baseline and 428,483,188 for the replacement. The runtime reconstruction is a compiled reference function and has no NFT deployment setup, so its comparison is conservative for direct splicing. The reference reuses the encoded metadata image attribute while constructing the complete isolated image fragment, applying the remaining outer layer rather than separately encoding the large image twice. Original SVG bytes remain unchanged; alignment spaces belong to its HTML representation and JSON framing.

## Fixed padding, dynamic padding and order

The root composition probes use the same complete document/UI and input constants, with a library dispatcher for each provider. They omit NFT deployment/storage/setup, so their totals differ from the Beast NFT totals above. The independent library is the tiny named-export fixture, not a real p5.js payload.

| Root consumer, same inputs within each pair | Raw fixed padding | L2 gas |
| --- | ---: | ---: |
| Full-size MIDI-only | 279 | 405,289,968 |
| Full-size MIDI-only | 9 | 405,435,158 |
| Small MIDI-only | 279 | 27,828,578 |
| Small MIDI-only | 9 | 28,387,168 |
| Small MIDI + independently called fixture provider | 279 | 28,051,688 |
| Small MIDI + independently called fixture provider | 9 | 28,697,718 |
| Full-size MIDI + fixture, art before data | 279 | 405,512,778 |
| Full-size MIDI + fixture, data before art | 279 | 405,513,178 |
| Small MIDI + fixture, data before art | 279 | 27,910,258 |

Use **279-byte padding for fixed library fragments**: it saves 145,190 gas in the full-size base and 558,590 in the small base. The consumer inserts pre-encoded nine-space fragments until the returned-stream position is on a 31-byte word boundary before large constants. The fixed streams themselves are also word-aligned. Art-before-data wins the full input by only 400 gas; data-before-art wins the small input by 141,430. The reference uses art first, while both orders are valid and tested.

Dynamic data stays at **minimum nine-byte padding**. With the same 3,716-byte MIDI/default settings, encoding the dynamic fragment at 9 costs 53,969,010 gas; expanding it to 279 costs 55,997,370. Encoding extra whitespace costs more than the possible append saving. Settings validation and MIDI encoding retain their earlier algorithms; MIDI is encoded verbatim onchain and validated by the browser.

## Components

| Probe | L2 gas |
| --- | ---: |
| Loader constant materialization | 62,450 |
| Engine constant materialization | 232,050 |
| Headless player constant materialization | 72,050 |
| Loader through `library_call` | 1,336,020 |
| Engine through `library_call` | 5,109,250 |
| Player through `library_call` | 1,549,620 |
| Append engine + player, aligned (including materialization) | 2,565,090 |
| Same append, unaligned | 10,361,090 |
| Default settings/empty MIDI through `library_call` | 1,877,280 |
| Three Beast sounds/3,716-byte MIDI through `library_call` | 61,021,398 |

Library-call probes include serialization and the declaration test setup (17,420 gas). A direct per-token fragment with default settings and 3,716-byte MIDI costs 53,634,110 gas after subtracting its input-build probe; the three-sound input costs 58,211,508. Large settings/custom-wave validation is still priced by execution, without an arbitrary byte cap. Read exact per-size/validation/encoding probes in the JSON record rather than applying these small-input figures to large settings.

## Payloads and release artifacts

| Provider fragment | Source bytes | Gzip bytes | Raw HTML bytes | Returned bytes / serialized felts |
| --- | ---: | ---: | ---: | ---: |
| Shared loader | 4,465 | inline | 4,743 | 8,432 / 275 |
| TinySynth engine | 47,212 | 14,339 | 19,530 | 34,720 / 1,123 |
| Headless player | 8,245 | 3,926 | 5,580 | 9,920 / 323 |

Together the fixed returned streams are 53,072 bytes, versus the pending baseline's 59,220-byte fixed page return. Separate source/gzip/raw/double-encoded hashes are in the [current segment manifest](../scripts/library_versions.json); the independent fixture's [record](../tests/fixtures/libraries/manifest.json) is separate. Fixed 279 padding adds 1,024 returned bytes over minimum 9 for this build.

| Release class | Pending 0.4.0 | 0.5.0 |
| --- | ---: | ---: |
| Sierra JSON bytes | 1,028,322 | 983,489 |
| Sierra program felts | 20,192 | 18,764 |
| CASM JSON bytes | 809,039 | 787,215 |
| CASM bytecode felts | 30,565 | 29,962 |

These are compact JSON build-artifact sizes, not declaration fee estimates. CASM generation is enabled locally in the release target; the ABI contains exactly eight MIDI class selectors. Browser startup/gesture-to-playing measurements are recorded separately in the JSON record after real offline Chromium/Firefox/WebKit checks. Audio output is a null sink and timers are best effort; hardware/device and mobile lock-screen validation remains outstanding.

## Browser startup and first play

Three fresh offline full-size MIDI-only contexts per build use the same timestamps: init script to NFT control enable, then captured user click to engine `playMIDI`. Medians in milliseconds:

| Browser | Pending baseline startup | 0.5.0 startup | Pending baseline first play | 0.5.0 first play |
| --- | ---: | ---: | ---: | ---: |
| Chromium 153.0.8010.12 | 10.1 | 15.0 | 53.1 | 53.4 |
| Firefox 155.0 | 12 | 19 | 1,748 | 1,733 |
| WebKit 26.6 | 12 | 9 | 91 | 82 |

These small descriptive samples do not establish a performance guarantee. Firefox's null-sink backend accounts for substantial first-play variability (recorded samples span roughly 0.7–1.8 seconds); no device latency is inferred. `scripts/startup_check.mjs` reproduces three current samples and accepts a baseline HTML/token URI file for the same measurement. All three browser engines also pass offline page, strict-CSP sandbox/blocked-media, audio-render and one-minute schedule/drift checks. The drift trend is informational in that one-minute run; device/mobile lock-screen checks remain outstanding.

## Reproduce

```sh
npm ci
npm run check:segments
npm run check:data
npm run check:measurements
scarb --release build
node scripts/measure_payloads.mjs /path/to/verified-pr57-baseline
snforge test gas_ --tracked-resource sierra-gas
(cd examples/beast_consumer && snforge test gas_t4_ --tracked-resource sierra-gas)
```

For the baseline, check out the exact recorded #57 head separately, enable `casm = true` in its build target for size measurement, and run this small probe in its Beast `tests/test_gas.cairo`, importing the existing NFT dispatcher trait:

```cairo
#[test]
fn gas_issue59_baseline_token4() {
    let (nft, _) = crate::test_token_uri::setup();
    assert!(nft.token_uri(4).len() > 0);
}
```

Run `snforge test gas_issue59_baseline_token4 --tracked-resource sierra-gas` there. The ordinary baseline token-4 SHA-256 assertion adds substantial hash gas and is not a valid token-URI execution comparison. Run browser checks with the pinned Playwright builds and a PulseAudio null sink for Firefox; see [development](development.md).

RPC call gas/response limits remain provider-specific. The stress example retains its 20 calibrated large tokens and opt-in gas/RPC probes; do not infer public RPC support or a production transaction budget from unit-test execution alone.
