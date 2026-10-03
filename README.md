# onchain-tinysynth

A Cairo class library for Starknet that serves a fully onchain, offline-playable music player for NFTs. The class embeds the TinySynth General MIDI synthesizer (oscillator/FM, no samples) and a small player page. A collectible contract passes in a token's MIDI file, SVG art and sound settings (including optional custom instrument and drum sounds), and the class returns the pieces of a `token_uri` whose `animation_url` plays that MIDI in the browser with no network requests. The class is declared but never deployed, has no storage and no constructor, and contains no collectible-specific logic. The first consumer is the Beasts NFT.

## Status

The interface is declared in [`src/interface.cairo`](src/interface.cairo) and the settings types in [`src/types.cairo`](src/types.cairo).

Implemented so far:
- **Settings (issue #1):** validation and the `SETTINGS` encoding in [`src/settings.cairo`](src/settings.cairo), with its JavaScript counterpart in [`player/`](player). See [Sound settings and custom sounds](#sound-settings-and-custom-sounds).
- **The player page (issue #8):** [`player/player.js`](player/player.js), with the settings module, in the fixed page `PAGE`. See [The player page](#the-player-page).
- **The offline build pipeline (issue #9):** the pinned engine, the page build, the generated [`src/page_data.cairo`](src/page_data.cairo) and the golden fixtures for the class. See [Build pipeline](#build-pipeline).
- **The gzipped engine (issue #14):** `PAGE` carries the engine gzipped, with a small gunzip shim, which nearly halves the segment and its gas. See [The gzipped engine](#the-gzipped-engine).

The class itself (`midi_segment`, the fast `base64`, the contract) is not implemented yet (phase 4, issue #10). See [Roadmap](#roadmap).

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
- The HTML page is TinySynth (gzipped, with a gunzip shim that inflates it in the browser) + the player + the token's MIDI (in an inert text block) + the token's SVG art (in an inert text block, shown through an `<img>`).

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
- `S = svg_b64 '"' <pad>` is encoded once and used twice. The first time it is the `image` value. The second time, at the HTML layer, it is the tail of the `animation_url` base64 stream: `svg_b64` decodes to the raw SVG, which becomes the contents of the open art block, and the `"` closes the `animation_url` string. The SVG must therefore never contain `</script` (see [Art (SVG) requirements](#art-svg-requirements)).

Decoded, the `animation_url` value after its `data:text/html;base64,` prefix is `b64(PAGE) ++ b64(D) ++ svg_b64`, which is standard base64 of `PAGE ++ D ++ SVG`. Since `svg_b64` ends that stream, it may end with `=` padding. `b64(PAGE)` and `b64(D)` are mid-stream and must be unpadded.

Alignment. The consumer's own pieces (`'{' ... base64,'`, `S`, `',' <pad>`) must each have a length that is a multiple of 3 before encoding. The class's pre-encoded pieces sit at both layers, so they need `len(X) % 9 == 0`: 3-alignment at the HTML layer, and `len(b64(X)) = 4·len(X)/3` must also be a multiple of 3 at the JSON layer. The class pads `PAGE` and `D` to multiples of 9 itself. The 39-byte `"animation_url":"data:text/html;base64,` prefix is already a multiple of 3.

### The player page

`PAGE` is [`tests/fixtures/page.html`](tests/fixtures/page.html), byte for byte: head and styles, the engine gzipped in a `<script type="text/javascript+gzip" src="data:text/javascript;base64,...">` tag (it inflates to the pinned fork build's exact bytes), the gunzip shim `<script>`, a small ▶/■ button, the player `<script>` (not compressed), then the opening of the settings block and its alignment spaces. The per-token `D` and the SVG follow it at call time. The shim inflates the engine while the page is parsed (see [The gzipped engine](#the-gzipped-engine)). The player ([`player/player.js`](player/player.js) and [`player/settings.js`](player/settings.js), flattened into one plain script and minified) starts on DOMContentLoaded:

- **Art first.** It shows the art block in an `<img>` as `data:image/svg+xml;base64,...` (the SVG re-encoded as UTF-8), before and independently of the settings and the MIDI. The art fills the frame; the button overlays the bottom-right corner.
- **Settings and MIDI.** It parses `SETTINGS` strictly (`decodeSettings`: the grammar, canonical integers, Cairo type bounds, count caps, known tags, every token consumed). Range and semantic validation is Cairo's alone: the class runs `settings::validate` before writing `SETTINGS`, and the page does not repeat it (spec Q4, reversed). It decodes the MIDI block (strict base64 after trimming the alignment spaces) and checks it (`checkMidi`). The check guarantees that TinySynth's parser reads the file as written and that looping is safe: it rejects running status without a channel status, tempo events that are not 3 bytes (with a one-byte length) or are 0, text events over 4 KB, F7 events and SysEx split over several events, a track without End-of-Track at its end, format 2, SMPTE timing, and a loop shorter than 50 ms.
- **Fail closed (spec D9).** If the engine did not load (its gzip payload did not inflate, or the engine failed when it ran: `engine: TinySynth did not load`), and on any parse or MIDI error, ▶ stays disabled, the exact error is shown at the bottom of the frame and in the button's title, and logged. No synth is created. The art stays: the player that shows it is not compressed, so it never depends on inflation.
- **▶** (a click or tap) constructs TinySynth on the first press (`createSynth`), resumes the `AudioContext` inside the gesture, reloads the MIDI (back to tick 0 at the song's starting tempo, keeping any rest before the first event), loops at End-of-Track with `setLoop(1)` and `setLoopEnd(maxTick)`, and starts playback. It then restarts the art when tick 0 is heard: after TinySynth's scheduling offset (`playTime - currentTime`, 100 ms) plus `AudioContext.outputLatency`, it re-creates the `<img>` with a distinct but equivalent URL (`data:image/svg+xml;r=<n>;base64,...`), so the browser starts a new animation timeline, and swaps it in once decoded.
- **■** stops playback and cancels a pending art restart. It also cuts off every voice, including drum voices and notes already scheduled ahead (which TinySynth's `stopMIDI` leaves running), by replacing each channel's volume node, and drops the controller changes TinySynth had already scheduled, so nothing reaches the next playback. The art keeps running.
- Plain JavaScript (`// @ts-check` and JSDoc), no modules, no `eval`, no network requests, no storage or cookies. It works in `<iframe sandbox="allow-scripts">` and under a CSP that allows only inline scripts and styles and `data:` images.

Sizes (the build prints them; [`src/page_data.cairo`](src/page_data.cairo) records them), against the previous, uncompressed page (`page.5`):

| | `page.5` (bytes) | Now (bytes) |
| --- | --- | --- |
| `PAGE` | 44,298 | 23,958 |
| of which the engine | 37,060 | 13,152: 9,862 bytes of gzip, as base64 |
| of which the gunzip shim (minified) | | 3,247 |
| of which the player (minified) | 6,047 | 6,144 |
| `animation_url_segment()` | 78,804 | 42,644 |
| `license()` | 2,594 | 4,104 |

The player does not re-check settings ranges: dropping that re-check (and the install path's custom-wave guards, which only repeated Cairo rules) saved 1,512 bytes of the uncompressed `PAGE` (45,810 to 44,298). The build fails if a validation rule reappears in the player.

The page is tested in Node ([`player/player.test.js`](player/player.test.js): the page's own shim and minified player script in `node:vm` against a fake DOM, the shim inflating the real engine from the page's payload, with a recording engine and with the real engine on a WebAudio mock; [`player/gunzip.test.js`](player/gunzip.test.js): the shim's inflation) and in headless Chromium (`npm run page-check`: as an offline `data:` URI, in a sandboxed iframe and under a strict CSP; the inflation and its order, the loop period against `maxTick x tick2Time`, the art restart by screenshots of a probe animation, and the failure paths, including a corrupt, truncated or missing gzip payload).

### The gzipped engine

The engine was 37,060 of the uncompressed page's 44,298 bytes, and the segment's size sets its gas at every step of a consumer's `token_uri` (see [Segment gas](#segment-gas)), so `PAGE` carries it gzipped. The markup follows the convention of Art Blocks' `GenArt721GeneratorV0` and scripty.sol's `gunzipScripts`:

```html
<script type="text/javascript+gzip" src="data:text/javascript;base64,H4sIAAAAAAACA..."></script>
<script>/* the gunzip shim */</script>
```

- **Inert until inflated.** A browser neither runs nor fetches a `<script>` of an unknown type, so the tag is just data. The payload is base64, whose alphabet (`A-Z a-z 0-9 + / =`) has no `<`, `"` or `&`: it can close neither its tag nor its attribute.
- **The shim** ([`player/gunzip.js`](player/gunzip.js), 3,247 bytes minified) runs next, while `<head>` is parsed. For each `text/javascript+gzip` tag it base64-decodes the `src`, gunzips it, and replaces the tag with an inline `<script>` holding the source. A script inserted that way runs synchronously, so the engine has run before the shim returns, before the player's `<script>` is parsed, and so before the player registers its DOMContentLoaded listener (`npm run page-check` asserts this order). No `eval` or `Function`: the source becomes a script element's text, which a CSP allowing inline scripts permits, also in `<iframe sandbox="allow-scripts">`. No network requests, and the output depends only on the payload.
- **Integrity.** The shim checks the CRC-32 and the length in the gzip trailer. Most single-byte changes deep in a deflate stream still inflate, to wrong bytes; the CRC-32 rejects them. On any failure the shim logs the error and leaves the tag; the player then finds no engine and fails closed (D9).
- **What is not compressed:** the player, so the art and its errors never depend on inflation. Compressing the player with the engine would save about 1.7 KB of `PAGE` (about 3 KB of segment, 7%), but needs a second, raw copy of the art and error code to keep D9.
- **Provenance.** The shim is derived from [fflate](https://github.com/101arrowz/fflate) 0.8.3's `gunzipSync` (MIT, Copyright (c) 2026 Arjun Barrett; the license is [vendored](tests/vendor/fflate-0.8.3.LICENSE) and in `license()`), trimmed to one-shot inflation, with the trailer checks added; [`player/gunzip.js`](player/gunzip.js) lists every change. The build minifies it with the pinned Terser and checks the result against `SHIM_PIN` in [`scripts/page.mjs`](scripts/page.mjs) (SHA-256 `bf6316a818dc7519afafa5af7bf826af5280c9950d208f0a2822f4295ab0d4df`), so the bytes that inflate the engine in every token change only deliberately.
- **Compression.** The pinned fflate (pure JavaScript, in `package-lock.json` with Terser) compresses at level 9 with no timestamp and no file name, so the payload depends only on the engine bytes, never on the system zlib or the OS.
- **Cost in the browser:** inflating the 9,862-byte payload takes about 2 ms cold (0.4 ms warm) in headless Chromium, and the page is ready (▶ enabled) about 3 ms later than the uncompressed one: a median of 12.1 ms instead of 9.2 ms after navigation, as an offline `data:` URI. `npm run page-check` prints the figure for its `data:` page.

| Hash (SHA-256) | Of | Where |
| --- | --- | --- |
| `5aa3edbc13371694a83ec0f285a5d39d4e4a31b18a259c0bbdcbd5969f710c2c` | the engine, decompressed: the fork's `webaudio-tinysynth.min.js` at `b70ba90` | `script_sha256()`, `page_data::ENGINE_SHA256` |
| `4b3a12672d2580f11f324e27b65d804ae94ca38665c4b9f588e3109cb0b4945e` | the gzip payload in `PAGE` (9,862 bytes) | `page_data::GZIP_SHA256`, `page_data::GZIP_LEN` |
| `bf6316a818dc7519afafa5af7bf826af5280c9950d208f0a2822f4295ab0d4df` | the minified gunzip shim | `SHIM_PIN` in [`scripts/page.mjs`](scripts/page.mjs) |

## Interface

Declared in [`src/interface.cairo`](src/interface.cairo) as `IOnchainTinySynth`. The doc comments there give exact byte formats and preconditions.

| Function | Returns |
| --- | --- |
| `animation_url_segment() -> ByteArray` | Fixed `"animation_url":"data:text/html;base64,<page>` JSON member, pre-encoded at both layers. No encoding at call time. |
| `midi_segment(midi: ByteArray, settings: SynthSettings) -> ByteArray` | `b64(b64(D))`: the token's settings and MIDI blocks, then opens the art block. Validates `settings` and encodes only per-token data. |
| `base64(data: ByteArray) -> ByteArray` | Standard RFC 4648 base64 with `=` padding, for consumers encoding their own JSON pieces. |
| `script_sha256() -> u256` | Constant SHA-256 of the embedded engine JS, decompressed (big-endian). |
| `version() -> felt252` | Short string identifying the engine and page versions: `'tinysynth-b70ba90+page.6'` (see [Build pipeline](#build-pipeline)). |
| `license() -> ByteArray` | Apache-2.0 notice for this library and the embedded TinySynth, including the fork's modification notice, then the MIT license of fflate, from which the page's gunzip shim derives. |

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
| `SynthSettings` | `quality` (0 chip-tune, 1 FM), `reverb` (0–100 %), `master_vol` (0–100 %), `voices` (1–64), `waves: Span<WaveDef>` (custom waveforms shared by all timbres, 0–16) and `timbres: Span<Timbre>` (0–32) |
| `Timbre` | A custom sound replacing General MIDI program `slot` (0–127), or drum note `slot` (35–81) when `drum` is true. Holds 1–8 operators |
| `Operator` | One oscillator, using TinySynth's 13-parameter model: `route` (output, FM or AM target), `wave`, `volume`, `ratio`, `offset_hz`, `attack`, `hold`, `decay`, `sustain`, `release`, `pitch_ratio`, `pitch_time`, `key_scale`, plus an optional `filter` |
| `Waveform` | `Sine`, `Square`, `Sawtooth`, `Triangle`, `WhiteNoise`, `MetallicNoise`, or `Custom(index)`: entry `index` of `SynthSettings.waves` |
| `WaveDef` | `Harmonics(Span<u16>)` (band-limited custom wave, 1–64 harmonics) or `Samples(Span<i8>)` (single-cycle chip wave played sample-and-hold, 2–256 samples) |
| `Filter` | `LowPass`, `HighPass` or `BandPass`, with a cutoff (in Hz or key-tracked) and Q. Fixed, with no envelope |

- **Units.** Fractional fields are fixed-point integers in units of `1 / FIXED_POINT_SCALE` (10,000), because Cairo has no floating point. For example `5_000` = 0.5.
- **Validation.** `settings::validate` checks every field, in a fixed order, and reverts with a `'TS: ...'` short string followed by the 0-based indices of the offending wave, timbre or operator, for example `('TS: volume out of range', 3, 1)`. Invalid settings never reach the page. The ranges are documented on each field in `types.cairo`. The checks and messages are listed in [`src/settings.cairo`](src/settings.cairo).
- **Not yet accepted.** Custom waves (a non-empty `waves`, or `Waveform::Custom`) revert with `'TS: custom wave unsupported'` until issue #2 lands. Filters revert with `'TS: filter unsupported'` until issue #3 lands. Their encoding is already part of the format, so lifting these checks changes neither the grammar nor the format version.
- **Selecting sounds.** A MIDI file selects a custom sound the ordinary way: a program change to its slot, or the drum note on channel 10. Only programs 0–127 and drum notes 35–81 are reachable from MIDI.
- **Consistency.** For a given class hash, the same settings and MIDI always produce the same sound. To keep a token's sound fixed, pass constants, or values derived only from permanent traits.
- **Size.** `SETTINGS` is base64-encoded at call time along with the MIDI.
  - It is 16 bytes with the defaults (`1,1,30,40,64,0,0`), plus about 6 bytes per timbre and 50 bytes per operator.
  - The three Beast reference sounds (a 2-operator lead, kick and snare) come to 334 bytes.
  - The cap is 8,192 bytes.
- **Engine dependencies.** Custom waves need [webaudio-tinysynth#26](https://github.com/Provable-Games/webaudio-tinysynth/issues/26). Its storage question is [decided](https://github.com/Provable-Games/webaudio-tinysynth/issues/26#issuecomment-5965255502): each sample wave is stored as one cycle, with its own home pitch. `Filter` needs [#27](https://github.com/Provable-Games/webaudio-tinysynth/issues/27). Deterministic noise needs [#7](https://github.com/Provable-Games/webaudio-tinysynth/issues/7). All must land before the class is declared.

### The `SETTINGS` format

The class writes settings into the page as `SETTINGS`, format version 1.
- **Syntax.** A flat list of canonical decimal integers separated by commas (`[0-9,-]` only, so it can never close its `<script>` block).
- **Structure.** Fields in declaration order, a length before every list, enums as their variant index, `bool` as 0/1, and `Option` as 0 (`None`) or 1 followed by the value.
- **Spec.** The grammar, the 31 checks and their messages are in [`src/settings.cairo`](src/settings.cairo). They were specified in issue #1 ([spec](https://github.com/Provable-Games/onchain-tinysynth/issues/1#issuecomment-5964892140), [shared-wave-table amendment](https://github.com/Provable-Games/onchain-tinysynth/issues/1#issuecomment-5965159953)).

```text
1,1,0,40,64,0,3,                                         version, quality, reverb, master_vol, voices, 0 waves, 3 timbres
0,0,2,0,3,3000,10000,0,30,0,100,10000,100,10000,10000,0,0,1,3,175,0,60000,2000,0,100,10000,100,10000,10000,0,0,
1,36,2,…                                                 (Beast reference lead, then kick and snare; line breaks for reading only)
```

The crate exports:
- the pure functions `onchain_tinysynth::settings::{validate, encode, validate_and_encode}`;
- the helpers `default_settings()` and `default_operator()` (TinySynth's operator defaults in fixed-point);
- the limits as constants (`MAX_TIMBRES`, `MAX_OPERATORS`, `MAX_WAVES`, `MAX_SETTINGS_LEN`, …).

Gas (snforge, L2 gas, net of building the input):

| Input | `SETTINGS` bytes | `validate` | `encode` |
| --- | --- | --- | --- |
| no timbres | 16 | 12K | 108K |
| 6 timbres (Beast lead, kick, snare, two hats, bass) | 504 | 306K | 3.0M |
| 32 timbres × 8 operators, all fields 0 (most validation work) | 7,437 | 6.2M | 49.6M |
| largest valid input, 32 timbres filled to 8,192 bytes (most encoding work) | 8,192 | 2.5M | 48.2M |

### Player JavaScript (`player/`)

Plain, dependency-free, CSP-safe JavaScript (`// @ts-check` with JSDoc, no `eval`), used by the page and by the tests:

- [`player/settings.js`](player/settings.js) is the page's settings module. It provides:
  - `decodeSettings(text)`: the strict parser (the grammar, canonical integers, Cairo type bounds, count caps, known tags, every token consumed); it throws a `SettingsError`. It does not repeat Cairo's range checks;
  - `createSynth(WebAudioTinySynth, settings)`: constructs TinySynth with `quality`, `useReverb` and `voices`, then calls `installSettings`;
  - `installSettings(synth, settings)`: calls `setQuality`, then sets master volume, reverb level and voices, then calls `setTimbre` for each timbre. Call it again after anything that changes the quality.

  On any parse error the page fails closed: no audio, and a visible error.
- [`player/player.js`](player/player.js) is the rest of the page's player (see [The player page](#the-player-page)).
- [`player/gunzip.js`](player/gunzip.js) is the page's gunzip shim (see [The gzipped engine](#the-gzipped-engine)): `gunzip(bytes)`, derived from fflate, and `gunzipScripts()`, which replaces each `text/javascript+gzip` tag with the inflated inline script.
- [`player/validate.js`](player/validate.js) is the JS reference of Cairo's `settings::validate` (`validateSettings`, the same checks in the same order with the same messages and indices), and [`player/encode.js`](player/encode.js) the reference encoder. Both are for Node and tooling only (the fixture generators and parity tests), not the page.

Shared fixtures keep Cairo and JavaScript byte-for-byte identical:
- `scripts/settings_fixtures.mjs` defines them, including the Beast reference timbres.
- `scripts/gen_settings_fixtures.mjs` writes `tests/fixtures/settings.json` and `tests/settings_fixtures.cairo` (generated; do not edit).
- Every fixture is asserted on both sides: the encoded bytes for valid input, and the exact panic data for invalid input.

### Designing a custom sound

1. **Design the sound** in TinySynth's `soundedit.html` (in the fork) or by hand, as a TinySynth timbre: a list of operators `{g, w, t, f, v, a, h, d, s, r, p, q, k}`.
2. **Convert each operator:**
   - `g` becomes `route`;
   - `w` becomes `wave`: `sine`, `square`, `sawtooth`, `triangle`, `n0`, `n1` map to `Sine` … `MetallicNoise`;
   - multiply every other value by 10,000 and round to an integer: `v` (`volume`), `t` (`ratio`), `f` (`offset_hz`), `a` (`attack`), `h` (`hold`), `d` (`decay`), `s` (`sustain`), `r` (`release`), `p` (`pitch_ratio`), `q` (`pitch_time`), `k` (`key_scale`).

   Fields TinySynth leaves out take its defaults (`default_operator()`).
3. **Respect the engine's rules:**
   - Modulators (`route` 1–10 for FM, 11–18 for AM) must come after the operator they target, so operator 1 always has `route: 0`.
   - The first operator's `decay` × 3.5 is the length of every drum note.
   - The first operator's `release` × 3.5 is how long a melodic voice lasts after note-off.
4. **Choose a slot.** Put the timbre in a program slot (0–127) or a drum slot (35–81), and select it from the MIDI with a program change or a drum note on channel 10.

The Beast reference lead, as Cairo:

```cairo
use onchain_tinysynth::settings::default_operator;
use onchain_tinysynth::types::{Operator, Timbre, Waveform};

// Triangle carrier, 3 ms attack, full sustain, 10 ms release.
let carrier = Operator {
    wave: Waveform::Triangle, volume: 3_000, attack: 30, hold: 0, sustain: 10_000, release: 100,
    ..default_operator()
};
// 6 Hz triangle LFO on operator 1's frequency: +-30 cents (2^(30/1200) - 1 = 0.0175), faded in over 0.2 s.
let lfo = Operator {
    route: 1, wave: Waveform::Triangle, volume: 175, ratio: 0, offset_hz: 60_000, attack: 2_000,
    hold: 0, sustain: 10_000, release: 100, ..default_operator()
};
let lead = Timbre { drum: false, slot: 0, operators: [carrier, lfo].span() };
```

The kick and snare are in `scripts/settings_fixtures.mjs`. `npm run render-check` renders all three sounds in headless Chromium and measures them (optional; needs Playwright). The checks: pitch and vibrato, the kick's pitch drop, and the snare's noise burst.

## MIDI requirements

The `midi` argument must be a Standard MIDI File (SMF) passed as `ByteArray`:

- PPQN (ticks-per-quarter-note) timing; SMPTE time division is not supported.
- Every track ends with an End-of-Track meta event, and every `MTrk` chunk length is exact.
- Tempo, program changes and controllers are set at tick 0.
- Custom sounds are selected with program changes (0–127) or drum notes (35–81 on channel 10), matching the `slot` values in `SynthSettings`.
- The player loops at the End-of-Track time, so End-of-Track should sit at the intended loop point, such as the end of the last bar.

The class embeds the bytes as base64 text and does not parse or validate them. Invalid MIDI shows up as a player failure in the browser, not as a revert.

## Art (SVG) requirements

The consumer's SVG must never contain `</script`, in any letter case.

- **Why.** In the `animation_url` page, the SVG is the raw contents of the final `<script type="text/plain" id="art">` block, which stays open until the end of the document (see [Consumer `token_uri` layout](#consumer-token_uri-layout-the-beasts-layout)). The HTML parser ends that block at the first `</script`. The art is cut short there, the player's `<img>` gets a truncated SVG and shows a broken image, and the rest of the SVG leaks into the page as markup. The `image` member still decodes to the whole SVG, so marketplaces' image views do not show the failure.
- **In practice.** No `<script>` elements in the SVG, and no comments or CDATA sections containing `</script`. Nothing else needs care: SVG is XML, so any `<` in text content is already escaped as `&lt;`. Consumers lose nothing, because scripts inside an SVG never run when it is shown through `<img>`, which is how both this page and marketplaces' `image` views show it.
- **Evidence.** Art Blocks' onchain generator broke all five of its `custom@na` projects on mainnet this way: each stored HTML document's own `</script>` ended the generator's `<script>` wrapper early, and the rest was parsed as page markup ([`GenArt721GeneratorV0-custom-na-upgrade.md`](https://github.com/ArtBlocks/artblocks-contracts/blob/main/packages/contracts/deployments/generator/GenArt721GeneratorV0-custom-na-upgrade.md) in `ArtBlocks/artblocks-contracts`).
- **Test it in the consumer.** The class never sees the SVG: it returns the pieces around it, and the consumer splices the art in itself. So the rule belongs in the consumer's own tests, on its renderer's output. [`examples/beast_consumer`](examples/beast_consumer) shows how: `assertArtSafe` in its scripts and `contains_script_end_tag` in its Cairo tests check the rendered SVG; its Node tests and browser check show the truncated art an unsafe SVG produces. A renderer built from fixed, reviewed literals and validated fields meets the rule by construction. In Beasts, for example, names are limited to `A-Z a-z 0-9`, space, `'` and `-`, and art URIs are strict base64.
- **`svg_b64`.** The SVG goes into `S` as `svg_b64`: standard RFC 4648 base64 of the exact SVG bytes, with no line breaks. It may end with `=` padding, because it ends the HTML-layer stream. It is also the `image` value, so marketplaces and the page show the same bytes.
- **Rejected alternatives.** Ending the page with an obsolete `<plaintext>` element instead of the art block, and base64-encoding the art inside the page, which would encode the art again at call time, at both layers.

## Engine provenance and verification

- Engine: TinySynth from the Provable-Games fork, <https://github.com/Provable-Games/webaudio-tinysynth>. The fork removes the GUI and is licensed Apache-2.0, like upstream.
- The class embeds the fork's own minified build at a pinned commit: currently `b70ba90` (`b70ba90d63c5ea657cb67ca98de90d7f778c29bd`), SHA-256 `5aa3edbc13371694a83ec0f285a5d39d4e4a31b18a259c0bbdcbd5969f710c2c`. It moves to a tagged release once the fork publishes one (roadmap phase 0); re-pinning is a one-line change (see [`tests/vendor/README.md`](tests/vendor/README.md)).
- The build is offline: the minified file and the fork's NOTICE are vendored in [`tests/vendor/`](tests/vendor), and `ENGINE_PIN` in [`scripts/engine.mjs`](scripts/engine.mjs) checks both SHA-256 hashes on every load, failing before anything is generated.
- Anyone can check the engine in any token against these values, and rebuild it: see [Verifying the engine](#verifying-the-engine).

## Verifying the engine

The class is declared but never deployed, so an explorer cannot call `script_sha256()` on it. It does not need to: every token's `animation_url` carries the engine, and the steps below check it offline with standard tools, against the values in [Versions](#versions).

What a class hash fixes, and what the consumer supplies:

- **Fixed per class hash:** the engine (gzipped in the page), the gunzip shim, the player, and with them the whole fixed page `PAGE`, plus `version()`, `script_sha256()` and `license()`. The class hash also covers the class's Cairo code (its base64 encoder and settings validation), so it changes when that code changes, even if the page does not.
- **Supplied by the consumer on each call:** the MIDI and the `SynthSettings` (through `midi_segment`), and the SVG art and the other JSON members (which the class never sees).

1. **Get the `token_uri`.** Read it from the collection's contract, which is deployed: in an explorer's read tab, with `sncast call`, or from a marketplace's metadata view. Save the string, `data:application/json;base64,...`, to `token_uri.txt`.
2. **Decode it and hash the engine.** The JSON layer, then the `animation_url` HTML layer, then the gzip payload of the page's `<script type="text/javascript+gzip" src="data:text/javascript;base64,...">` tag, base64-decoded and gunzipped. With a shell (GNU coreutils, grep and gzip):

   ```sh
   cut -d, -f2- token_uri.txt | base64 -d \
     | grep -o '"animation_url": *"data:text/html;base64,[^"]*' | cut -d, -f2- | base64 -d \
     | grep -o 'type="text/javascript+gzip" src="data:text/javascript;base64,[^"]*' | cut -d, -f2- \
     | base64 -d > engine.js.gz
   sha256sum engine.js.gz              # the gzip payload
   gunzip -c engine.js.gz | sha256sum  # the engine: script_sha256()
   ```

   The first `grep` expects the JSON to write `/` unescaped, as the Beasts layout does. Python's standard library parses the JSON properly, and `gzip.decompress` checks the gzip CRC-32 and length:

   ```sh
   python3 - token_uri.txt <<'EOF'
   import base64, gzip, hashlib, json, re, sys
   uri = open(sys.argv[1]).read().strip()
   token = json.loads(base64.b64decode(uri.split(",", 1)[1]))        # JSON layer
   html = base64.b64decode(token["animation_url"].split(",", 1)[1])  # HTML layer, as bytes
   tag = rb'<script type="text/javascript\+gzip" src="data:text/javascript;base64,([^"]*)"'
   payload = base64.b64decode(re.search(tag, html).group(1))         # the gzip payload
   engine = gzip.decompress(payload)                                 # the engine
   print("gzip payload", hashlib.sha256(payload).hexdigest(), len(payload), "bytes")
   print("engine      ", hashlib.sha256(engine).hexdigest(), len(engine), "bytes")
   EOF
   ```

   Or, with Node 22 or later, [`scripts/verify_engine.mjs`](scripts/verify_engine.mjs) (Node built-ins only, so the file can be copied and run on its own; it also accepts the token JSON, the `animation_url` or the decoded page, and decodes base64 strictly):

   ```sh
   node scripts/verify_engine.mjs token_uri.txt --expect <script_sha256()>
   ```

   For the current version, all three print the gzip payload's SHA-256 `4b3a12672d2580f11f324e27b65d804ae94ca38665c4b9f588e3109cb0b4945e` (9,862 bytes) and the engine's `5aa3edbc13371694a83ec0f285a5d39d4e4a31b18a259c0bbdcbd5969f710c2c` (37,060 bytes).
3. **Compare.** The engine's SHA-256 must equal the class's `script_sha256()` (the hex form of the `u256` is the `sha256sum` string; a consumer contract or its tests can read it) and the `script_sha256()` column of [Versions](#versions), in the row of the class's `version()`. The gzip payload's SHA-256 and length must match that row too.
4. **Optionally, rebuild the engine** from the fork commit in that row. The fork commits its minified build, and rebuilding it from the source reproduces it:

   ```sh
   git clone https://github.com/Provable-Games/webaudio-tinysynth && cd webaudio-tinysynth
   git checkout b70ba90d63c5ea657cb67ca98de90d7f778c29bd
   sha256sum webaudio-tinysynth.min.js   # the committed build
   npm install --no-save terser@5.51.2 && npm run build
   sha256sum webaudio-tinysynth.min.js   # rebuilt: the same hash
   ```

   The fork's `package.json` accepts any Terser 5 from 5.14.0, so the command pins the version the build was reproduced with (5.51.2). A tagged fork release with a published SHA-256 is roadmap phase 0.
5. **Optionally, check the rest of the page and the class.** `verify_engine.mjs` also prints the SHA-256 and length of the fixed page `PAGE` (the decoded page up to the opening tag of the settings block and its alignment spaces), which [`scripts/page_versions.json`](scripts/page_versions.json) records for every `version()`. To check the class itself, check out this repository at the row's release tag, rebuild the page with `npm ci && npm run check:page` (the pinned Terser and fflate; it fails on any difference from the committed `PAGE` and `src/page_data.cairo`), run `scarb build`, compute the class hash (for example with `sncast utils class-hash --contract-name <the class's contract>`), and compare it with the row's class hash.

## Versioning

Class hashes are immutable. The engine and the player page are stored in the class when it is declared, so they are fixed per class version: a given class hash, called with the same MIDI and `SynthSettings`, always produces the same output and sound. Sound settings and custom sounds come from the consumer on each call, so they can change without a new class. A new engine or page means a new class hash and a new `version()` string. Consumers choose when to switch by updating the class hash they store; old tokens rendered with an old class hash keep working. The versions and their hashes are listed in [Versions](#versions).

## Versions

The class is declared but never deployed, so block explorers cannot call it (`starknet_call` needs a contract address): `version()` and `script_sha256()` cannot be read there. This table is how collectors find these values for a class hash; [Verifying the engine](#verifying-the-engine) checks a token against them.

| `version()` | Class hash (Sepolia) | Class hash (mainnet) | Release tag | `script_sha256()` (decompressed engine) | Gzip payload SHA-256 / length | Engine fork commit |
| --- | --- | --- | --- | --- | --- | --- |
| `tinysynth-b70ba90+page.6` | not declared yet | not declared yet | not declared yet | `5aa3edbc13371694a83ec0f285a5d39d4e4a31b18a259c0bbdcbd5969f710c2c` | `4b3a12672d2580f11f324e27b65d804ae94ca38665c4b9f588e3109cb0b4945e` / 9,862 bytes | [`b70ba90`](https://github.com/Provable-Games/webaudio-tinysynth/commit/b70ba90d63c5ea657cb67ca98de90d7f778c29bd) in [Provable-Games/webaudio-tinysynth](https://github.com/Provable-Games/webaudio-tinysynth) |

- The hashes and the length are the build's, from [`src/page_data.cairo`](src/page_data.cairo) (`VERSION`, `ENGINE_SHA256`, `GZIP_SHA256`, `GZIP_LEN`); `npm test` fails if the row for the current `version()` disagrees with them. The SHA-256 of the whole `PAGE` for each `version()` is in [`scripts/page_versions.json`](scripts/page_versions.json).
- **A row is final only once its class is declared.** The class hash covers the class's Cairo code as well as the page, and the base64 encoder that phase 4 implements is temporary, until the maintainer's optimized encoder is published. So the class hashes and the tag are filled in at declaration (roadmap phase 6), and until then the row can still change: a new encoder changes the class hash, and a re-pinned engine or a new page changes `version()` and the hashes. Once declared, a row never changes.
- `page.1` to `page.5` were development builds of the page and were never declared.

## Toolchain

- Scarb 2.20.1 (Cairo 2.20)
- Starknet Foundry 0.64.0 (`snforge`, `sncast`)
- Node 22 or later (CI uses 24)

Scarb and Starknet Foundry are pinned in [`.tool-versions`](.tool-versions) for asdf.

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
npm ci && npm run gen:page   # rebuild the page, src/page_data.cairo and the page fixtures
npm run check:page       # fail if any of them is out of date
PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core CHROME=/path/to/chrome \
  npm run render-check   # optional: render the reference timbres in headless Chromium
PLAYWRIGHT_CORE=... CHROME=... npm run page-check   # optional: the page in headless Chromium
```

The engine tests, the page build and the page checks use the vendored engine (`tests/vendor/`, SHA-256 checked on every load).

## Build pipeline

[`scripts/build_page.mjs`](scripts/build_page.mjs) (`npm run gen:page`, or `npm run check:page` to verify) is offline and reproducible: running it twice gives byte-identical files.

1. Loads the pinned engine and its NOTICE; a hash mismatch fails here.
2. Gzips the engine with fflate, pinned exactly in `package-lock.json` (level 9, no timestamp, no file name), and checks that the payload inflates back to the engine with both Node's zlib and the page's shim.
3. Flattens `player/gunzip.js` into a plain script and minifies it with Terser, pinned exactly in `package-lock.json`, then checks it against `SHIM_PIN`. Flattens `player/settings.js` and `player/player.js` into one script (their `import` lines and `export` keywords removed) and minifies it.
4. Assembles `PAGE` and pads it with spaces to `len % 9 == 0`; the spaces fall inside the settings block, where the player trims them.
5. Writes:
   - [`tests/fixtures/page.html`](tests/fixtures/page.html): `PAGE`;
   - [`src/page_data.cairo`](src/page_data.cairo) (generated, do not edit): `animation_url_segment()` pre-encoded at both base64 layers, `PAGE_LEN`, `SEGMENT_LEN`, `ENGINE_SHA256`, `GZIP_SHA256`, `GZIP_LEN`, `VERSION` and `license()`. The large constants are `const` felt arrays (stored once as data in the class bytecode) deserialized into a `ByteArray`; materializing the segment costs about 3.7M L2 gas;
   - the golden fixtures for the class: [`tests/fixtures/page.json`](tests/fixtures/page.json) and [`tests/page_fixtures.cairo`](tests/page_fixtures.cairo) (below).

`VERSION` is `tinysynth-<engine ref>+page.<PAGE_VERSION>`. [`scripts/page_versions.json`](scripts/page_versions.json) records the SHA-256 of `PAGE` for every `VERSION`, and the build (and `check:page`) fails if the page changes while `VERSION` stays the same. To change the page: bump `PAGE_VERSION` in [`scripts/page.mjs`](scripts/page.mjs) (a re-pin changes `VERSION` by itself), then run `npm run gen:page -- --record`.

### Golden fixtures

Computed by the JS reference ([`scripts/page.mjs`](scripts/page.mjs)) from the inputs in [`scripts/page_fixtures.mjs`](scripts/page_fixtures.mjs). Nine valid cases (MIDI, settings, SVG, JSON members) cover every `D` padding length (0-8) and every consumer padding length (0-2 for the head and for `S`); six invalid cases cover settings reverts. Per valid case:

- the expected `midi_segment(midi, settings)` in full, with `SETTINGS`, `D` and its pad;
- the decoded `animation_url` HTML (`PAGE ++ D ++ SVG`) and the Beasts-layout `token_uri`, as length and SHA-256. They are 25-60 KB each and fully determined by stored pieces, so they are pinned by digest rather than stored. The example's three tokens hold complete `token_uri` goldens.

Per invalid case: the settings and the panic data `midi_segment` must revert with. `tests/page_fixtures.cairo` has the same data as Cairo functions, plus the tests that already apply: `page_data` against the build (lengths, SHA-256 of the segment and the license, version, engine and gzip payload hashes) and each case's settings against `src/settings.cairo`.

### Class size

A stub class serving only the `page_data` constants (`animation_url_segment`, `script_sha256`, `version`, `license`), compiled with Scarb 2.20.1, against [Starknet's current limits](https://docs.starknet.io/learn/cheatsheets/chain-info):

| | Stub class | Same class, `page.5` (uncompressed) | Same class, empty constants | Limit |
| --- | --- | --- | --- | --- |
| Sierra program | 4,369 felts | 7,226 felts | 204 felts | |
| Contract class as declared (Sierra, entry points, ABI) | 191 KB | 319 KB | 9 KB | 4,089,446 bytes |
| CASM bytecode | 2,563 felts | 3,681 felts | 311 felts | 81,920 felts |

The constants take about 5% of the class size limit and 3% of the bytecode limit.

### Segment gas

The segment's size sets its cost at every step of a consumer's `token_uri`: the class materializes it, the library call returns it, the consumer appends it to its `ByteArray`, and `token_uri` returns it again. [`tests/test_page_gas.cairo`](tests/test_page_gas.cairo) (`snforge test gas_segment`) measures materializing and appending it, in L2 gas, now and with the uncompressed `page.5` page:

| | `page.5` (78,804 bytes) | Now (42,644 bytes) |
| --- | --- | --- |
| Materializing `animation_url_segment()` | 6.83M | 3.70M |
| Appending it to a `ByteArray` with no pending bytes (word-aligned) | +4.00M | +2.16M |
| Appending it after the 29-byte `data:application/json;base64,` (unaligned) | +17.25M | +9.34M |
| The library call that returns it to a consumer (the example's gas report) | 10.82M | 5.86M |

The example's whole `token_uri` went from 131.0M-131.2M to 113.1M-113.5M (see [`examples/beast_consumer`](examples/beast_consumer/README.md#gas-informational)).

## Roadmap

0. **Fork release with fixes** (in the `webaudio-tinysynth` fork): MIDI parser bounds fix (#4), pinned tagged build with a published SHA-256 (#5), deterministic reverb and noise buffers (#7), custom waveform API (#26) and per-operator filter (#27). Fractional tempo and `loopEnd` are already merged.
1. **Scaffold** (this): repository layout, toolchain, interface declarations, README.
2. **Player page JS** (done, issue #8): MIDI decode, tap-to-start, play/stop, End-of-Track looping, latency-compensated art restart, offline only.
3. **Offline build pipeline** (done, issue #9): verifies the pinned engine by SHA-256, gzips it (issue #14), assembles and aligns the page, and generates the pre-encoded Cairo constants plus golden fixtures (reference outputs for sample MIDI and art).
4. **Cairo class implementation**: `SynthSettings` validation and encoding (issues #1–#3), byte-for-byte parity tests against the JS reference fixtures, a `library_call` test from a mock consumer, and measurements of gas per call and class size.
5. **Browser validation**: Chromium, Firefox and WebKit; playback, looping, art sync, and offline behaviour.
6. **Docs and declaration**: finalize docs, declare on Sepolia, then on mainnet, and publish the class hashes.

## Open decisions

- **Custom waves and filters**: their types, ranges and encoding are fixed by issue #1, but accepting them, and their player side, belong to issues #2 and #3.

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE). The embedded TinySynth engine is also Apache-2.0: copyright Tatsuya Shinyagaito (g200kg), modified by Provable Games in <https://github.com/Provable-Games/webaudio-tinysynth>. The page's gunzip shim is derived from fflate, MIT License, Copyright (c) 2026 Arjun Barrett ([text](tests/vendor/fflate-0.8.3.LICENSE)); `license()` includes all three notices.

## Examples

- [`examples/beast_consumer`](examples/beast_consumer): a runnable end-to-end example of a Beasts-style NFT assembling its `token_uri` with library calls, against a mock of this class that already serves the real page, with golden fixtures and decoded output.

## CI

GitHub Actions runs on every pull request and on pushes to `main`, on `ubuntu-24.04-arm`, with every action pinned to a commit SHA ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)):

| Job | What it checks |
| --- | --- |
| `cairo` | Scarb 2.20.1 and snforge 0.64.0 from `.tool-versions`: `scarb fmt --check`, `scarb build` and `snforge test` at the root and in `examples/beast_consumer`; the Scarb lockfiles stay unchanged |
| `javascript` | Node 24: the example's Node tests; `npm ci` (when `package-lock.json` exists) and `npm test` when the root `package.json` has a `test` script; `tsc --checkJs` on `player/` when it exists |
| `generated` | Reruns the example's `gen_fixtures.mjs`, then `npm run check:settings` and `npm run check:page` (the engine hash, the page, `src/page_data.cairo` and the page fixtures) when those scripts exist, then fails on any diff |
| `browser` | Installs Playwright's Chromium headless shell with its system libraries, then runs the example's `browser_check.mjs` and, when those scripts exist, `npm run render-check` and `npm run page-check`. Firefox and WebKit follow in roadmap phase 5 |

The optional steps switch on by themselves when the root `package.json`, its scripts or `player/` exist ([`.github/scripts/ci-detect.sh`](.github/scripts/ci-detect.sh)). TypeScript, `@types/node` and `playwright-core` are pinned in [`.github/ci-tools`](.github/ci-tools); Dependabot updates them and the actions monthly.

Codex and Claude review each same-repository pull request ([`.github/workflows/codex-review.yml`](.github/workflows/codex-review.yml), [`claude-review.yml`](.github/workflows/claude-review.yml)) and post one comment each. A HIGH or CRITICAL finding fails that provider's `… review gate` check. Fork and Dependabot pull requests get no review credentials, so their gates fail with a request for manual review. `Review helper tests` checks the review scripts and lints every workflow. Setup, the trust model and the policies are in [`.github/scripts/README.md`](.github/scripts/README.md). The reviews need these secrets and Actions variables (organization or repository level); without them a review is skipped with a warning:

| Name | Kind | Use |
| --- | --- | --- |
| `CLAUDE_CODE_OAUTH_TOKEN` | secret | Claude Code OAuth token |
| `CODEX_AUTH_DOT_JSON` | secret | Codex `auth.json` (ChatGPT login) |
| `CLAUDE_REVIEW_MODEL`, `CLAUDE_REVIEW_EFFORT` | variables | Claude model ID and effort |
| `CODEX_REVIEW_MODEL`, `CODEX_REVIEW_EFFORT` | variables | Codex model ID and reasoning effort |

Run the same checks locally from the repository root (Scarb and snforge from `.tool-versions`, Node 24):

```sh
scarb fmt --check && scarb build && snforge test
(cd examples/beast_consumer && scarb fmt --check && scarb build && snforge test)
(cd examples/beast_consumer && node --test scripts/*.test.mjs && node scripts/gen_fixtures.mjs)
npm ci && npm test && npm run check:settings && npm run check:page
git diff --exit-code                     # generators left no drift

# Pinned tools for the type check and the browser checks
(cd .github/ci-tools && npm ci --ignore-scripts)
T=.github/ci-tools/node_modules
$T/.bin/tsc --noEmit --allowJs --checkJs --target es2022 --module nodenext \
  --moduleResolution nodenext --lib es2022,dom --typeRoots $T/@types --types node player/*.js
(cd .github/ci-tools && npx playwright-core install --only-shell chromium)   # add --with-deps for system libraries
PLAYWRIGHT_CORE="$PWD/$T/playwright-core" sh -c \
  'cd examples/beast_consumer && node scripts/browser_check.mjs'
PLAYWRIGHT_CORE="$PWD/$T/playwright-core" npm run render-check
PLAYWRIGHT_CORE="$PWD/$T/playwright-core" npm run page-check

# Review helpers
python3 -I -B -m unittest discover -s .github/scripts -p 'test_*.py'
```

To use a Chromium you already have, set `CHROME=/path/to/chrome-headless-shell` (and `LD_LIBRARY_PATH` if it needs extra libraries) instead of installing one.
