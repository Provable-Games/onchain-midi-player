# onchain-tinysynth

A Cairo class library for Starknet that serves a fully onchain, offline-playable music player for NFTs. The class embeds the TinySynth General MIDI synthesizer (oscillator/FM, no samples) and a small player page. A collectible contract passes in a token's MIDI file, SVG art and sound settings (including optional custom instrument and drum sounds), and the class returns the pieces of a `token_uri` whose `animation_url` plays that MIDI in the browser with no network requests. The class is declared but never deployed, has no storage and no constructor, and contains no collectible-specific logic. The first consumer is the Beasts NFT.

## Status

Scaffold only. The interface is declared in [`src/interface.cairo`](src/interface.cairo) and the settings types in [`src/types.cairo`](src/types.cairo); there is no implementation yet, and none will be written until the design below is approved. Nothing described here as behaviour of the class or the player page exists yet. See [Roadmap](#roadmap).

## How it works

### Class library, called with `library_call`

The class is declared on Starknet but never deployed. Consumers hold its class hash and call it with `library_call` through the dispatcher generated from the interface:

```cairo
let synth = IOnchainTinySynthLibraryDispatcher { class_hash: TINYSYNTH_CLASS_HASH };
```

Because the class has no storage, running it in the caller's context reads and writes nothing on the caller's storage. All functions are view-only and deterministic for a given class hash.

### Output format

The output uses standard nested base64 data URIs:

- `token_uri` is `data:application/json;base64,` followed by the token JSON.
- The JSON's `animation_url` is `data:text/html;base64,` followed by the HTML page.
- The HTML page is TinySynth + the player + the token's MIDI (in an inert text block) + the token's SVG art (in an inert text block, shown through an `<img>`).

### Pre-encoding the fixed page

The engine and page are the same for every token, so they are stored in the class already base64-encoded at both layers (computed offline) and spliced in. This works because of the base64 identity

```
b64(X ++ Y) == b64(X) ++ b64(Y)    when len(X) % 3 == 0
```

With aligned segments, only per-token data (MIDI, art, JSON members) is encoded at call time, and the result is still ordinary standard base64 that any decoder accepts.

During design, the author measured base64-encoding the ~36 KB engine at runtime at about 622M L2 gas per layer. The engine must therefore never be encoded onchain.

### Consumer `token_uri` layout (the Beasts layout)

The consumer builds the JSON itself and pads with spaces between JSON tokens so that each piece starts on a 3-byte boundary:

```
"data:application/json;base64,"
  ++ b64('{' members ',' <pad> '"image":"data:image/svg+xml;base64,')
  ++ b64(S)                       S = svg_b64 '"' <pad>   (encoded once, used twice)
  ++ b64(',' <pad>)
  ++ animation_url_segment()      pre-encoded engine + page, never encoded at call time
  ++ midi_segment(midi, settings) per-token: settings and MIDI blocks, then opens art
  ++ b64(S)                       art closes both data URIs
  ++ b64('}')
```

Where:

- `PAGE` is the fixed HTML page. It ends by opening the settings text block (`<script type="text/plain" id="settings">`).
- `animation_url_segment()` = `b64('"animation_url":"data:text/html;base64,' ++ b64(PAGE))`.
- `midi_segment(midi, settings)` = `b64(b64(D))`, with `D = SETTINGS '</script><script type="text/plain" id="midi">' b64(midi) <pad> '</script><script type="text/plain" id="art">'`. `SETTINGS` is an ASCII encoding of the `SynthSettings` value (digits, `-` and separators only); its exact format is specified with issue #1.
- `S = svg_b64 '"' <pad>` is encoded once and used twice. The first time it is the `image` value. The second time, at the HTML layer, it is the tail of the `animation_url` base64 stream: `svg_b64` decodes to the raw SVG, which becomes the contents of the open art block, and the `"` closes the `animation_url` string.

Decoded, the `animation_url` value after its `data:text/html;base64,` prefix is `b64(PAGE) ++ b64(D) ++ svg_b64`, which is standard base64 of `PAGE ++ D ++ SVG`. Since `svg_b64` ends that stream, it may end with `=` padding. `b64(PAGE)` and `b64(D)` are mid-stream and must be unpadded.

Alignment. The consumer's own pieces (`'{' ... base64,'`, `S`, `',' <pad>`) must each have a length that is a multiple of 3 before encoding. The class's pre-encoded pieces sit at both layers, so they need `len(X) % 9 == 0`: 3-alignment at the HTML layer, and `len(b64(X)) = 4·len(X)/3` must also be a multiple of 3 at the JSON layer. The class pads `PAGE` and `D` to multiples of 9 itself. The 39-byte `"animation_url":"data:text/html;base64,` prefix is already a multiple of 3.

### What the player page does (planned)

- Reads the settings block, configures TinySynth (quality, reverb, volume, voices) and installs any custom sounds.
- Decodes the embedded MIDI from its text block.
- Starts audio on tap, since browser autoplay rules block audio before a user gesture.
- Play/stop control.
- Loops at the MIDI's End-of-Track time.
- On tap, restarts the art together with the audio, compensating for audio output latency, so the music stays in sync with GIF-style animated art.
- Makes no network requests and plays offline.

## Interface

Declared in [`src/interface.cairo`](src/interface.cairo) as `IOnchainTinySynth`. The doc comments there give exact byte formats and preconditions.

| Function | Returns |
| --- | --- |
| `animation_url_segment() -> ByteArray` | Fixed `"animation_url":"data:text/html;base64,<page>` JSON member, pre-encoded at both layers. No encoding at call time. |
| `midi_segment(midi: ByteArray, settings: SynthSettings) -> ByteArray` | `b64(b64(D))`: the token's settings and MIDI blocks, then opens the art block. Validates `settings` and encodes only per-token data. |
| `base64(data: ByteArray) -> ByteArray` | Standard RFC 4648 base64 with `=` padding, for consumers encoding their own JSON pieces. |
| `script_sha256() -> u256` | Constant SHA-256 of the embedded engine JS (big-endian). |
| `version() -> felt252` | Short string identifying the engine and page versions, e.g. `'tinysynth-pg.1+page.1'`. |
| `license() -> ByteArray` | Apache-2.0 notice for this library and the embedded TinySynth, including the fork's modification notice. |

Only contracts can call these functions. The class is never deployed, so RPC nodes and block explorers cannot call it directly (`starknet_call` needs a contract address). For that reason the class does not store the raw engine script or a standalone single-layer `animation_url`: each would be a second or third stored copy of the page, adding class size for callers that cannot reach it.

## Integration guide (planned)

This is a sketch of how a consumer such as Beasts would build its `token_uri`. It depends on the unimplemented class and will change with the design.

```cairo
use onchain_tinysynth::interface::{
    IOnchainTinySynthDispatcherTrait, IOnchainTinySynthLibraryDispatcher,
};
use onchain_tinysynth::types::SynthSettings;

fn token_uri(
    tinysynth: starknet::ClassHash,
    members: ByteArray,
    svg_b64: ByteArray,
    midi: ByteArray,
    settings: SynthSettings,
) -> ByteArray {
    let synth = IOnchainTinySynthLibraryDispatcher { class_hash: tinysynth };

    // '{' members ',' <pad> '"image":"data:image/svg+xml;base64,'
    // <pad> is chosen so the whole piece is a multiple of 3 bytes long.
    // `spaces(n)` is the consumer's own helper returning n ASCII spaces.
    let image_key: ByteArray = "\"image\":\"data:image/svg+xml;base64,";
    let mut head: ByteArray = "{";
    head.append(@members);
    head.append(@",");
    head.append(@spaces((3 - (head.len() + image_key.len()) % 3) % 3));
    head.append(@image_key);

    // S = svg_b64 '"' <pad>, encoded once and used twice.
    let mut s = svg_b64;
    s.append(@"\"");
    s.append(@spaces((3 - s.len() % 3) % 3));
    let s_b64 = synth.base64(s);

    let mut uri: ByteArray = "data:application/json;base64,";
    uri.append(@synth.base64(head));
    uri.append(@s_b64);
    uri.append(@synth.base64(",  ")); // ',' <pad>, 3 bytes
    uri.append(@synth.animation_url_segment());
    uri.append(@synth.midi_segment(midi, settings));
    uri.append(@s_b64);
    uri.append(@synth.base64("}"));
    uri
}
```

The alignment rule: every piece passed to `base64` except the final `'}'` must have a length that is a multiple of 3. Otherwise the encoder emits `=` padding mid-stream and the concatenation is no longer valid base64. Consumers may also use their own base64 encoder, provided it produces standard RFC 4648 output.

## Sound settings and custom sounds

Declared in [`src/types.cairo`](src/types.cairo). The consumer passes a typed `SynthSettings` value with every `midi_segment` call:

| Type | Contents |
| --- | --- |
| `SynthSettings` | `quality` (0 chip-tune, 1 FM), `reverb` (0–100 %), `master_vol` (0–100 %), `voices` (1–64), and `timbres: Span<Timbre>` |
| `Timbre` | A custom sound replacing General MIDI program `slot` (0–127), or drum note `slot` (35–81) when `drum` is true. Holds 1–8 operators |
| `Operator` | One oscillator, using TinySynth's 13-parameter model: `route` (output, FM or AM target), `wave`, `volume`, `ratio`, `offset_hz`, `attack`, `hold`, `decay`, `sustain`, `release`, `pitch_ratio`, `pitch_time`, `key_scale`, plus an optional `filter` |
| `Waveform` | `Sine`, `Square`, `Sawtooth`, `Triangle`, `WhiteNoise`, `MetallicNoise`, `Harmonics(Span<u16>)` (band-limited custom wave), `Samples(Span<i8>)` (single-cycle chip wave, played sample-and-hold) |
| `Filter` | `LowPass`, `HighPass` or `BandPass`, with a cutoff (in Hz or key-tracked) and Q. Fixed, with no envelope |

- **Units.** Fractional fields are fixed-point integers in units of `1 / FIXED_POINT_SCALE` (10,000), because Cairo has no floating point. For example `5_000` = 0.5.
- **Validation.** `midi_segment` range-checks every field and reverts with a descriptive error, so invalid settings never reach the page. The proposed ranges are documented on each field and finalized in issues #1–#3.
- **Selecting sounds.** A MIDI file selects a custom sound the ordinary way: a program change to its slot, or the drum note on channel 10. Only programs 0–127 and drum notes 35–81 are reachable from MIDI.
- **Consistency.** For a given class hash, the same settings and MIDI always produce the same sound. To keep a token's sound fixed, pass constants, or values derived only from permanent traits.
- **Cost.** Each custom sound adds roughly 100–200 bytes of page text, which is base64-encoded at call time along with the MIDI.
- **Engine dependencies.** `Harmonics` and `Samples` need [webaudio-tinysynth#26](https://github.com/Provable-Games/webaudio-tinysynth/issues/26). `Filter` needs [#27](https://github.com/Provable-Games/webaudio-tinysynth/issues/27). Deterministic noise needs [#7](https://github.com/Provable-Games/webaudio-tinysynth/issues/7). All must land before the class is declared.

## MIDI requirements

The `midi` argument must be a Standard MIDI File (SMF) passed as `ByteArray`:

- PPQN (ticks-per-quarter-note) timing; SMPTE time division is not supported.
- Every track ends with an End-of-Track meta event, and every `MTrk` chunk length is exact.
- Tempo, program changes and controllers are set at tick 0.
- Custom sounds are selected with program changes (0–127) or drum notes (35–81 on channel 10), matching the `slot` values in `SynthSettings`.
- The player loops at the End-of-Track time, so End-of-Track should sit at the intended loop point, such as the end of the last bar.

The class embeds the bytes as base64 text and does not parse or validate them. Invalid MIDI shows up as a player failure in the browser, not as a revert.

## Engine provenance and verification

- Engine: TinySynth from the Provable-Games fork, <https://github.com/Provable-Games/webaudio-tinysynth>. The fork removes the GUI and is licensed Apache-2.0, like upstream.
- The class embeds the minified JS of a pinned, tagged release of the fork. The tag and its SHA-256 will be recorded here once the release is cut (Roadmap phase 0).
- The build pipeline downloads or rebuilds the pinned release, checks its SHA-256 against the recorded value, and fails on mismatch before generating any Cairo constants.
- Anyone can verify a declared class:
  1. Check out the pinned tag of the fork and run its build (`npm install && npm run build`) to reproduce the minified file.
  2. Decode a consumer's `token_uri` offchain (JSON layer, then HTML layer), extract the engine script from the page, and compare it byte-for-byte with the rebuilt file.
  3. Compare the SHA-256 of both with the release's published SHA-256 and with `script_sha256()` (readable by a consumer contract or its tests).
  4. Rebuild this repository at the matching commit and compare the resulting class hash with the declared one.

## Versioning

Class hashes are immutable. The engine and the player page are stored in the class when it is declared, so they are fixed per class version: a given class hash, called with the same MIDI and `SynthSettings`, always produces the same output and sound. Sound settings and custom sounds come from the consumer on each call, so they can change without a new class. A new engine or page means a new class hash and a new `version()` string. Consumers choose when to switch by updating the class hash they store; old tokens rendered with an old class hash keep working.

## Toolchain

- Scarb 2.20.1 (Cairo 2.20)
- Starknet Foundry 0.64.0 (`snforge`, `sncast`)

Both are pinned in [`.tool-versions`](.tool-versions) for asdf.

```sh
scarb build      # compile
snforge test     # run tests (none yet)
scarb fmt        # format
```

## Roadmap

0. **Fork release with fixes** (in the `webaudio-tinysynth` fork): MIDI parser bounds fix (#4), pinned tagged build with a published SHA-256 (#5), deterministic reverb and noise buffers (#7), custom waveform API (#26) and per-operator filter (#27). Fractional tempo and `loopEnd` are already merged.
1. **Scaffold** (this): repository layout, toolchain, interface declarations, README.
2. **Player page JS**: MIDI decode, tap-to-start, play/stop, End-of-Track looping, latency-compensated art restart, offline only.
3. **Offline build pipeline**: verifies the pinned engine by SHA-256, assembles and aligns the page, and generates the pre-encoded Cairo constants plus golden fixtures (reference outputs for sample MIDI and art).
4. **Cairo class implementation**: `SynthSettings` validation and encoding (issues #1–#3), byte-for-byte parity tests against the JS reference fixtures, a `library_call` test from a mock consumer, and measurements of gas per call and class size.
5. **Browser validation**: Chromium, Firefox and WebKit; playback, looping, art sync, and offline behaviour.
6. **Docs and declaration**: finalize docs, declare on Sepolia, then on mainnet, and publish the class hashes.

## Open decisions

- **Settings encoding and ranges**: the fixed-point scale, per-field ranges, caps (timbres per call, operators per timbre, wave lengths) and the ASCII `SETTINGS` format are proposals until issues #1–#3 settle them.
- **Alignment of pre-encoded pieces**: as described above, `PAGE` and `D` need 9-byte alignment (not just 3-byte) to splice at both base64 layers. Where the padding spaces go in `PAGE` should be confirmed during phase 2/3.

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE). The embedded TinySynth engine is also Apache-2.0: copyright Tatsuya Shinyagaito (g200kg), modified by Provable Games in <https://github.com/Provable-Games/webaudio-tinysynth>.
