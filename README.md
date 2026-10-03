# onchain-tinysynth

A Cairo class library for Starknet that serves a fully onchain, offline-playable music player for NFTs. The class embeds the TinySynth General MIDI synthesizer (oscillator/FM, no samples) and a small player page. A collectible contract passes in a token's MIDI file, SVG art and sound settings (including optional custom instrument and drum sounds), and the class returns the pieces of a `token_uri` whose `animation_url` plays that MIDI in the browser with no network requests. The class is declared but never deployed, has no storage and no constructor, and contains no collectible-specific logic. The first consumer is the Beasts NFT.

## Status

The interface is declared in [`src/interface.cairo`](src/interface.cairo) and the settings types in [`src/types.cairo`](src/types.cairo).

Implemented:
- **Settings (issue #1):** validation and the `SETTINGS` encoding in [`src/settings.cairo`](src/settings.cairo), with its JavaScript counterpart in [`player/`](player). See [Sound settings and custom sounds](#sound-settings-and-custom-sounds).
- **The player page (issue #8):** [`player/player.js`](player/player.js), with the settings module, in the fixed page `PAGE`. See [The player page](#the-player-page).
- **The offline build pipeline (issue #9):** the pinned engine, the page build, the generated [`src/page_data.cairo`](src/page_data.cairo) and the golden fixtures for the class. See [Build pipeline](#build-pipeline).
- **The gzipped engine (issue #14):** `PAGE` carries the engine gzipped, with a small gunzip shim, which nearly halves the segment and its gas. See [The gzipped engine](#the-gzipped-engine).
- **The class (issue #10):** `OnchainTinySynth` in [`src/contract.cairo`](src/contract.cairo), with `midi_segment` in [`src/segment.cairo`](src/segment.cairo). It matches every golden fixture byte for byte, directly and through a library call. See [Gas and limits](#gas-and-limits).
- **The optimized base64 encoder:** the maintainer's `game_components_encoding` package, from the game-components release `v3.1.0`, which [`src/base64.cairo`](src/base64.cairo) re-exports. A full-size Beast `token_uri` costs 0.29B L2 gas. See [The base64 encoder](#the-base64-encoder).

> **Release gate (issue #12), the encoder: satisfied.** The stand-in encoder is gone, and the encoder is a tagged release: game-components `v3.1.0`, which resolves to commit `66ce934e750f8162de4f6a377357b2b8f8e5c4c0` (recorded in `Scarb.lock`). The gate's other items in issue #12 still apply before the class is declared.

See [Roadmap](#roadmap).

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

Alignment. The consumer's own pieces (`'{' ... base64,'`, `S`, `',' <pad>`) must each have a length that is a multiple of 3 before encoding. The class's pre-encoded pieces sit at both layers, so they need `len(X) % 9 == 0`: 3-alignment at the HTML layer, and `len(b64(X)) = 4·len(X)/3` must also be a multiple of 3 at the JSON layer. The class pads `PAGE` and `D` to multiples of 9 itself. The 39-byte `"animation_url":"data:text/html;base64,` prefix is already a multiple of 3. Consumers can also add spaces between JSON tokens, 3 at a time, so that their large appends start on a 31-byte `ByteArray` word, which makes them about 4x cheaper (see the [Integration guide](#integration-guide)).

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
| `license()` | 2,594 | 5,721 |

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
| `base64(data: ByteArray) -> ByteArray` | Standard RFC 4648 base64 with `=` padding, for consumers encoding their own JSON pieces. The same encoder `midi_segment` uses. |
| `script_sha256() -> u256` | Constant SHA-256 of the embedded engine JS, decompressed (big-endian). |
| `version() -> felt252` | Short string identifying the engine and page versions: `'tinysynth-b70ba90+page.6'` (see [Build pipeline](#build-pipeline)). |
| `license() -> ByteArray` | Apache-2.0 notice for this library and the embedded TinySynth, including the fork's modification notice, then the MIT licenses of fflate, from which the page's gunzip shim derives, and of game-components, whose base64 encoder the class embeds. |

Only contracts can call these functions. The class is never deployed, so RPC nodes and block explorers cannot call it directly (`starknet_call` needs a contract address). For that reason the class does not store the raw engine script or a standalone single-layer `animation_url`: each would be a second or third stored copy of the page, adding class size for callers that cannot reach it.

The class is `onchain_tinysynth::contract::OnchainTinySynth`: an empty `#[storage]` struct, no constructor, every entry point a view. `animation_url_segment`, `script_sha256`, `version` and `license` return the generated constants of [`src/page_data.cairo`](src/page_data.cairo). `midi_segment` validates and encodes the settings ([`src/settings.cairo`](src/settings.cairo)), builds `D` and returns `b64(b64(D))` ([`src/segment.cairo`](src/segment.cairo)). Invalid settings revert with the `'TS: ...'` short string and the indices as extra panic felts; through a library call the panic data arrives whole, followed by `'ENTRYPOINT_FAILED'`.

## The base64 encoder

All base64 in the class goes through one function, `onchain_tinysynth::base64::bytes_base64_encode(_bytes: ByteArray) -> ByteArray`: `midi_segment` (three passes) and the `base64` entry point.

- **The encoder: `game_components_encoding`.** [`src/base64.cairo`](src/base64.cairo) re-exports `bytes_base64_encode` from the maintainer's optimized word-wise encoder, the zero-dependency package `game_components_encoding` (`packages/encoding` in [game-components](https://github.com/Provable-Games/game-components)). It encodes 93-byte blocks into four 31-byte words. For large inputs it costs about 3.3K L2 gas per input byte, or 3.6K through the library call. It uses the unstable corelib features `bounded-int-utils`, `byte-span` and `corelib-get-trait`, which compile as a dependency under Scarb 2.20.1. It is MIT licensed: its license is [vendored](tests/vendor/game-components.LICENSE) and in `license()`.
- **The pin.** [`Scarb.toml`](Scarb.toml) pins it to the game-components release tag `v3.1.0`. `Scarb.lock` records the commit the tag resolves to, `66ce934e750f8162de4f6a377357b2b8f8e5c4c0`, and CI fails if a build changes the lockfile. The SHA-256 of its `packages/encoding/src/encoding.cairo` is `ef6d2fc50e1b5d1d81cd81091d3c34402ad41ebcd670d03e38a2a82b74c13883`.
- **The output did not change.** It replaced a byte-wise stand-in, copied from game-components' utilities, which cost about 19.6K L2 gas per input byte. The encoder's tests ([`tests/test_base64.cairo`](tests/test_base64.cairo)) cover RFC 4648 vectors, every byte value, every length from 0 to 100, the 31/62/93-byte word boundaries, 1-16 KB inputs, and PAGE encoded twice at call time equal to the pre-encoded segment. They passed unchanged, and so did every golden fixture.
- **Release gate.** Issue #12 required the stand-in to be replaced by the released encoder before declaring. That item is satisfied: the encoder is game-components `v3.1.0` (commit `66ce934`).

## Integration guide

How a consumer such as Beasts builds its `token_uri` (the layout above), with the word alignment described below. [`examples/beast_consumer`](examples/beast_consumer) runs exactly this against the class.

```cairo
use onchain_tinysynth::interface::{
    IOnchainTinySynthDispatcherTrait, IOnchainTinySynthLibraryDispatcher,
};
use onchain_tinysynth::types::SynthSettings;

/// Appends spaces (between JSON tokens) until `(s.len() + extra) % 3 == 0`.
fn pad3(ref s: ByteArray, extra: u32) {
    while (s.len() + extra) % 3 != 0 {
        s.append_byte(' ');
    }
}

/// Appends 'ICAg', which is b64('   '): 3 spaces between JSON tokens, until `uri.len() + extra` is
/// a multiple of 31. At most 30 times, since 4 and 31 are coprime.
fn align_to_word(ref uri: ByteArray, extra: u32) {
    while (uri.len() + extra) % 31 != 0 {
        uri.append(@"ICAg");
    }
}

fn token_uri(
    tinysynth: starknet::ClassHash,
    members: ByteArray, // "name":...,"attributes":[...]   (no braces)
    svg: ByteArray, // raw SVG; must never contain `</script`
    midi: ByteArray,
    settings: SynthSettings,
) -> ByteArray {
    let synth = IOnchainTinySynthLibraryDispatcher { class_hash: tinysynth };

    // '{' members ',' <pad>, a multiple of 3 bytes.
    let mut open: ByteArray = "{";
    open.append(@members);
    open.append_byte(',');
    pad3(ref open, 0);

    // S = svg_b64 '"' <pad>, encoded once and used twice.
    let mut s = synth.base64(svg);
    s.append_byte('"');
    pad3(ref s, 0);
    let s_b64 = synth.base64(s);

    let mut uri: ByteArray = "data:application/json;base64,";
    uri.append(@synth.base64(open));
    // b64(' "image":"data:image/svg+xml;base64,'): the image key after one space (36 bytes), a
    // constant. The spaces before it put b64(S) on a word boundary.
    let image_key: ByteArray = "ICJpbWFnZSI6ImRhdGE6aW1hZ2Uvc3ZnK3htbDtiYXNlNjQs";
    align_to_word(ref uri, image_key.len());
    uri.append(@image_key);
    uri.append(@s_b64);
    // b64(',  '), then spaces until the segment starts on a word boundary.
    uri.append(@"LCAg");
    align_to_word(ref uri, 0);
    uri.append(@synth.animation_url_segment());
    uri.append(@synth.midi_segment(midi, settings));
    uri.append(@s_b64);
    uri.append(@synth.base64("}"));
    uri
}
```

**Art (required).** The SVG must never contain `</script`, in any letter case; see [Art (SVG) requirements](#art-svg-requirements).

**Base64 alignment (required).** Every piece passed to `base64`, except the final `'}'`, must be a multiple of 3 bytes long. Otherwise the encoder emits `=` padding mid-stream and the concatenation is no longer valid base64. The consumer pads with spaces between JSON tokens (`pad3`); the class pads `PAGE` and `D` itself.

**Word alignment (optional, saves gas).** A Cairo `ByteArray` stores 31-byte words. `append` onto a `ByteArray` whose length is a multiple of 31 copies whole words; at any other length it splits every word of the appended piece in two, which costs about 4x as much. Measured in L2 gas:

| Append | Word-aligned | Unaligned |
| --- | --- | --- |
| The 42,644-byte `animation_url_segment()` ([`tests/test_page_gas.cairo`](tests/test_page_gas.cairo)) | 2.2M | 9.3M |
| Every append of a full-size Beast's `token_uri`: two 40,420-character `b64(S)`, the segment, `midi_segment`, the small pieces (the example's `gas_t4_appends_*`) | 16.0M | 29.9M |

The consumer chooses where its large pieces land by adding spaces between JSON tokens, 3 at a time: 3 spaces are one 3-byte group, so they keep every piece a multiple of 3, and they encode to the constant `'ICAg'`, so they are never base64-encoded at call time. It does this in two places:

- **Before `"image"`, so the first `b64(S)` is aligned.** The consumer encodes `'{' members ',' <pad>`, appends `'ICAg'` until the length plus 48 is a multiple of 31, then the 48-character constant `b64(' "image":"data:image/svg+xml;base64,')`. That is why the image key, with one space in front, is a piece of its own: it is 36 bytes, a multiple of 3.
- **After the comma before `"animation_url"`, so the segment is aligned.** The consumer appends `'LCAg'` (`b64(',  ')`), then `'ICAg'` until the length is a multiple of 31.

At most 30 groups are needed in each place (120 characters), and the decoded JSON only gains insignificant whitespace. `midi_segment` and the second `b64(S)` cannot be aligned this way: they follow the segment directly at both layers.

**Your own encoder.** Consumers may use their own encoder instead of the class's `base64`, provided it produces standard RFC 4648 output. A copy compiled into the consumer also avoids passing the data through the library call: for a 22.7 KB SVG that saves about 7.4M L2 gas (75.2M instead of 82.6M).

## Gas and limits

L2 gas, measured with snforge 0.64.0 and Scarb 2.20.1, with the optimized encoder (see [The base64 encoder](#the-base64-encoder)). Tables that involve base64 give its share. Where it matters, they also give the figure with the byte-wise stand-in encoder that the class used before (about 19.6K L2 gas per input byte, against about 3.3K now).

### Entry points

Through `IOnchainTinySynthLibraryDispatcher` on the declared class, as a consumer calls them, including passing the arguments and the result ([`tests/test_class_gas.cairo`](tests/test_class_gas.cairo), `snforge test gas_lc`):

| Entry point | L2 gas | Base64 share |
| --- | --- | --- |
| `animation_url_segment()` | 6.2M: 0.3M to materialize the constant, the rest to return its 42,644 bytes | none |
| `midi_segment(midi, settings)` | 1.6M with no MIDI and the default settings; 60.7M with a score the size of the largest Beast score (3,716 bytes) and the 3 reference sounds (324.3M with the stand-in); 178.2M with that score and 8,192 bytes of `SETTINGS` (739.6M with the stand-in; table below) | 51-98% |
| `base64(data)` | 0.2M for 3 bytes, 3.8M for 1,023 bytes, and about 3.6K per input byte for large inputs (20.5M for 1,023 bytes with the stand-in) | nearly all |
| `script_sha256()` | 0.1M | none |
| `version()` | 0.1M | none |
| `license()` | 1.4M | none |

### `midi_segment` by MIDI and `SETTINGS` size

Called directly, net of building the inputs (`snforge test gas_ms gas_b64_midi`). Rows are synthetic scores with the sizes of the onchain composer's production Beast scores ([`tests/fixtures/midi/`](tests/fixtures/midi/README.md)): the gas depends only on the MIDI's length; columns are `SETTINGS` sizes: the defaults, the 3 Beast reference sounds, 6 timbres, 32 timbres of 8 minimal operators (the most validation work) and the largest valid input (the most encoding work). Each cell is the total, then the base64 share (`b64(midi)` plus the two passes over `D`):

| MIDI | 16 bytes | 334 bytes | 504 bytes | 7,437 bytes | 8,192 bytes |
| --- | --- | --- | --- | --- | --- |
| none | 1.4M (86%) | 5.8M (62%) | 8.4M (60%) | 113.9M (51%) | 115.1M (56%) |
| 816 bytes | 13.2M (97%) | 17.6M (86%) | 19.8M (82%) | 126.1M (56%) | 126.7M (60%) |
| 1,541 bytes | 23.0M (97%) | 27.8M (90%) | 30.0M (87%) | 135.8M (59%) | 136.5M (62%) |
| 2,266 bytes | 33.4M (97%) | 37.4M (92%) | 40.3M (90%) | 146.0M (61%) | 146.7M (65%) |
| 2,991 bytes | 43.0M (97%) | 47.6M (93%) | 49.9M (92%) | 155.9M (64%) | 156.2M (67%) |
| 3,716 bytes (the largest Beast score's size) | 53.5M (98%) | 57.9M (94%) | 60.5M (93%) | 166.3M (66%) | 167.0M (69%) |
| 3,716 bytes, with the stand-in encoder | 305.1M (100%) | 321.5M (99%) | 330.4M (99%) | 699.0M (92%) | 728.4M (93%) |

The rest is validating and encoding `SETTINGS` (see [Sound settings](#sound-settings-and-custom-sounds)) and assembling `D`. The library call adds the cost of passing the inputs: 2.8M for the score with the reference sounds, 11.2M with 8,192 bytes of `SETTINGS`.

### A full Beasts `token_uri` against the 1B target

Token 4 of the example ([`examples/beast_consumer`](examples/beast_consumer/README.md#gas)) is a full-size Beast:
- **art:** the Beasts renderer's SVG for a shiny, animated Warlock, 22,733 bytes;
- **music:** a synthetic score the size of the largest Beast score, 3,716 bytes;
- **sounds:** the 3 reference sounds, 334 bytes of `SETTINGS`;
- **layout:** word-aligned.

Its `token_uri` is 133,525 characters. The whole call is from `snforge test token_uri_4 --gas-report`; the pieces are from the example's `gas_t4_*` tests, each net of its inputs:

| Piece | L2 gas | Of which base64 | With the stand-in encoder |
| --- | --- | --- | --- |
| **Whole `BeastLikeNft.token_uri`** | **286.2M** | **239.5M (84%)** | **1,414.6M** |
| `animation_url_segment()` (library call) | 6.2M | none | 6.2M |
| `midi_segment()` (library call) | 60.1M | 54.6M | 323.7M |
| The consumer's base64 (4 library calls): `b64(svg)` 82.6M, `b64(S)` 110.2M, the head and `'}'` about 1M | about 194M | 184.9M | about 1,059M |
| The appends (word-aligned layout; 29.9M unaligned) | 16.0M | none | 16.0M |
| The rest: SVG and score constants, members, name check | about 10M | none | about 10M |

- **A full-size Beast costs 0.29B, well under budget:** less than a third of the 1B target, or of Starknet's limit of 1.1×10^9 L2 gas per transaction. With the stand-in encoder it cost 1.41B, over both. The projection from the encoder's lab figures (62% less encoding gas) was about 0.57B; measured, encoding costs about 83% less per byte than with the stand-in.
- **Most of it is still the SVG.** Base64 is 84% of the total, and the two passes over the SVG are 67%. These are the same two passes Beasts' metadata makes today: it encodes the SVG for `image`, then the whole JSON over it. What sound adds is the segment, `midi_segment` and the appends: about 82M (346M with the stand-in).
- **The sample tokens are cheaper:** a 1 KB SVG and a 112-byte MIDI cost 30.1M to 30.2M (90.2M to 90.6M with the stand-in).

### The 8,192-byte `SETTINGS` cap (issue #1, Q3)

- **Cost per size.** Every 1,000 bytes of `SETTINGS` add about 14M to `midi_segment` (52M with the stand-in). About 6M of that is validating and encoding. The rest is base64, because `SETTINGS` sits inside `D`, which is encoded twice.
- **Realistic settings are cheap.** The 3 reference sounds (334 bytes) or 6 timbres (504 bytes) add 4-7M over the defaults, about 2% of a full Beast `token_uri`.
- **Worst case at the cap: about 0.4B.** A score of the largest Beast score's size with 8,192 bytes of `SETTINGS` costs 178.2M through the library call (739.6M with the stand-in). In the full Beast `token_uri` above, it replaces the reference sounds' 60.1M, which gives 404.3M (1.83B with the stand-in). A direct measurement agrees: token 4 with the 8,192-byte fixture `valid_max_length` in place of the reference sounds gives a 147,493-character `token_uri` that costs 407.4M.
- **Larger art.** Each byte of SVG costs about 9K L2 gas in the full `token_uri`: the consumer's two base64 passes through the library call, plus appending `b64(S)` twice. At that rate, the worst case reaches 1B only with an SVG of roughly 85 KB, almost 4 times the animated Warlock's 22.7 KB. This is an extrapolation: the release gate (issue #12) still measures a full-size Beast `token_uri` through the RPC providers.
- **Recommendation: keep 8,192 bytes.** The worst case is 0.41B measured: the cap, a score of the largest Beast score's size and a full-size animated Beast SVG together. That is less than half the 1B target. Lowering the cap to 4,096 bytes would save at most about 60M (the full token at about 0.34B). Realistic sounds are far below either cap: the reference sounds are 334 bytes, and a full per-type pack of about 20 two- or three-operator timbres would be about 2.6 KB.

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
  - The cap is 8,192 bytes. Each 1,000 bytes add about 14M L2 gas to `midi_segment` (see [Gas and limits](#gas-and-limits)).
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
     | grep -o 'type="text/javascript+gzip" src="data:text/javascript;base64,[^"]*' | head -n 1 \
     | cut -d, -f2- | base64 -d > engine.js.gz
   sha256sum engine.js.gz              # the gzip payload
   gunzip -c engine.js.gz | sha256sum  # the engine: script_sha256()
   ```

   The first `grep` expects the JSON to write `/` unescaped, as the Beasts layout does. The gzip tag is the page's first: `PAGE` comes before all per-token data, so text in the art cannot take its place. Python's standard library parses the JSON properly, and `gzip.decompress` checks the gzip CRC-32 and length:

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

   Or, with Node 22 or later, [`scripts/verify_engine.mjs`](scripts/verify_engine.mjs) (Node built-ins only, so the file can be copied and run on its own). It also accepts the token JSON, the `animation_url` or the decoded page, decodes base64 strictly, and looks for the tag only in the fixed page, outside HTML comments:

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
5. **Optionally, check the rest of the page and the class.** `verify_engine.mjs` also prints the SHA-256 and length of the fixed page `PAGE` (the decoded page up to the opening tag of the settings block and its alignment spaces), which [`scripts/page_versions.json`](scripts/page_versions.json) records for every `version()`. A matching `PAGE` also proves that the payload you hashed sits in the page's own engine tag, the one that runs, and that the shim and the player around it are the class's. To check the class itself, check out this repository at the row's release tag, rebuild the page with `npm ci && npm run check:page` (the pinned Terser and fflate; it fails on any difference from the committed `PAGE` and `src/page_data.cairo`), run `scarb build`, compute the class hash (for example with `sncast utils class-hash --contract-name OnchainTinySynth`, the class `onchain_tinysynth::contract::OnchainTinySynth`), and compare it with the row's class hash.

## Versioning

Class hashes are immutable. The engine and the player page are stored in the class when it is declared, so they are fixed per class version: a given class hash, called with the same MIDI and `SynthSettings`, always produces the same output and sound. Sound settings and custom sounds come from the consumer on each call, so they can change without a new class. A new engine or page means a new class hash and a new `version()` string. Consumers choose when to switch by updating the class hash they store; old tokens rendered with an old class hash keep working. The versions and their hashes are listed in [Versions](#versions).

## Versions

The class is declared but never deployed, so block explorers cannot call it (`starknet_call` needs a contract address): `version()` and `script_sha256()` cannot be read there. This table is how collectors find these values for a class hash; [Verifying the engine](#verifying-the-engine) checks a token against them.

| `version()` | Class hash (Sepolia) | Class hash (mainnet) | Release tag | `script_sha256()` (decompressed engine) | Gzip payload SHA-256 / length | Engine fork commit |
| --- | --- | --- | --- | --- | --- | --- |
| `tinysynth-b70ba90+page.6` | not declared yet | not declared yet | not declared yet | `5aa3edbc13371694a83ec0f285a5d39d4e4a31b18a259c0bbdcbd5969f710c2c` | `4b3a12672d2580f11f324e27b65d804ae94ca38665c4b9f588e3109cb0b4945e` / 9,862 bytes | [`b70ba90`](https://github.com/Provable-Games/webaudio-tinysynth/commit/b70ba90d63c5ea657cb67ca98de90d7f778c29bd) in [Provable-Games/webaudio-tinysynth](https://github.com/Provable-Games/webaudio-tinysynth) |

- The hashes and the length are the build's, from [`src/page_data.cairo`](src/page_data.cairo) (`VERSION`, `ENGINE_SHA256`, `GZIP_SHA256`, `GZIP_LEN`); `npm test` fails if the row for the current `version()` disagrees with them. The SHA-256 of the whole `PAGE` for each `version()` is in [`scripts/page_versions.json`](scripts/page_versions.json).
- **A row is final only once its class is declared.** The class hash covers the class's Cairo code as well as the page. That includes the base64 encoder dependency, game-components `v3.1.0` (commit `66ce934`, recorded in `Scarb.lock`). So the class hashes and the tag are filled in at declaration (roadmap phase 6), and until then the row can still change: a different encoder build changes the class hash, and a re-pinned engine or a new page changes `version()` and the hashes. Once declared, a row never changes.
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
node scripts/gen_midi_fixtures.mjs   # regenerate the synthetic scores (then gen:page)
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
   - [`src/page_data.cairo`](src/page_data.cairo) (generated, do not edit): `animation_url_segment()` pre-encoded at both base64 layers, `PAGE_LEN`, `SEGMENT_LEN`, `ENGINE_SHA256`, `GZIP_SHA256`, `GZIP_LEN`, `VERSION` and `license()`. The segment is a string literal: the compiler stores its words as constants, so materializing it costs 0.28M L2 gas, against 3.70M for a `const` felt array deserialized into a `ByteArray`, for a larger class (see [Class size](#class-size)). `license()`, rarely called, stays a `const` felt array;
   - the golden fixtures for the class: [`tests/fixtures/page.json`](tests/fixtures/page.json) and [`tests/page_fixtures.cairo`](tests/page_fixtures.cairo) (below);
   - the class's test fixtures, [`tests/class_fixtures.cairo`](tests/class_fixtures.cairo): the raw `PAGE`, base64 vectors from Node's encoder, and the synthetic scores of [`tests/fixtures/midi/`](tests/fixtures/midi/README.md).

`VERSION` is `tinysynth-<engine ref>+page.<PAGE_VERSION>`. [`scripts/page_versions.json`](scripts/page_versions.json) records the SHA-256 of `PAGE` for every `VERSION`, and the build (and `check:page`) fails if the page changes while `VERSION` stays the same. To change the page: bump `PAGE_VERSION` in [`scripts/page.mjs`](scripts/page.mjs) (a re-pin changes `VERSION` by itself), then run `npm run gen:page -- --record`.

### Golden fixtures

Computed by the JS reference ([`scripts/page.mjs`](scripts/page.mjs)) from the inputs in [`scripts/page_fixtures.mjs`](scripts/page_fixtures.mjs). Nine valid cases (MIDI, settings, SVG, JSON members) cover every `D` padding length (0-8) and every consumer padding length (0-2 for the head and for `S`); six invalid cases cover settings reverts. Per valid case:

- the expected `midi_segment(midi, settings)` in full, with `SETTINGS`, `D` and its pad;
- the decoded `animation_url` HTML (`PAGE ++ D ++ SVG`) and the Beasts-layout `token_uri`, as length and SHA-256. They are 25-60 KB each and fully determined by stored pieces, so they are pinned by digest rather than stored. The example's three tokens hold complete `token_uri` goldens.

Per invalid case: the settings and the panic data `midi_segment` must revert with. `tests/page_fixtures.cairo` has the same data as Cairo functions, and the tests:
- `page_data` against the build: lengths, SHA-256 of the segment and the license, version, engine and gzip payload hashes;
- per valid case: `SETTINGS`; `midi_segment` byte for byte, called directly and through the library dispatcher on the declared class; the decoded HTML (`PAGE ++ D ++ SVG`) and the Beasts-layout `token_uri`, rebuilt in Cairo ([`tests/helpers.cairo`](tests/helpers.cairo)), against their length and SHA-256;
- per invalid case: the revert with its exact panic data, directly and through the library call.

### Class size

The class compiled with Scarb 2.20.1, against [Starknet's current limits](https://docs.starknet.io/learn/cheatsheets/chain-info), with and without the encoder, and the page constants alone:

| | The class | The class without the encoder | Page constants only | Page constants only, `const` felt array (`page.6` before this class) | Limit |
| --- | --- | --- | --- | --- | --- |
| Sierra program | 17,676 felts | 12,755 felts | 7,438 felts | 4,369 felts | |
| Contract class as declared (Sierra, entry points, ABI) | 922,222 bytes (23% of the limit) | 634,194 bytes | 326,475 bytes | 191,246 bytes | 4,089,446 bytes |
| CASM bytecode | 29,293 felts (36% of the limit) | 18,145 felts | 5,341 felts | 2,563 felts | 81,920 felts |

- **The class** is `OnchainTinySynth` with the optimized encoder. "Without the encoder" is the same class with `bytes_base64_encode` returning its input: the encoder adds 4,921 Sierra felts, 288 KB and 11,148 CASM felts. The byte-wise stand-in it replaced added 1,701 Sierra felts, 98 KB and 4,149 CASM felts (the whole class was then 727,248 bytes and 22,242 CASM felts). The optimized encoder costs about 190 KB more class size, for about 83% less gas per encoded byte.
- **Page constants only** is a stub class serving `animation_url_segment`, `script_sha256`, `version` and `license`. The string-literal segment costs about 130 KB and 2,700 CASM felts more than the `const` felt array, and saves 3.4M L2 gas on every call. The last column predates this class and has the 4,104-byte `license()`. The other columns have the 5,721-byte `license()`, which adds the game-components notice.
- **The rest** of the class is the settings validation and encoding.
- The method: `contract_class.json` without debug info, and the `bytecode` of `compiled_contract_class.json`.

### Segment gas

The segment's size sets its cost at every step of a consumer's `token_uri`: the class materializes it, the library call returns it, the consumer appends it to its `ByteArray`, and `token_uri` returns it again. [`tests/test_page_gas.cairo`](tests/test_page_gas.cairo) (`snforge test gas_segment`) measures materializing and appending it, in L2 gas:

| | `page.5` (78,804 bytes), `const` array | `page.6` (42,644 bytes), `const` array | Now: `page.6`, string literal |
| --- | --- | --- | --- |
| Materializing `animation_url_segment()` | 6.83M | 3.70M | 0.28M |
| Appending it to a `ByteArray` with no pending bytes (word-aligned) | +4.00M | +2.16M | +2.16M |
| Appending it after the 29-byte `data:application/json;base64,` (unaligned) | +17.25M | +9.34M | +9.34M |
| The class's side of the library call that returns it (the example's gas report) | 10.82M | 5.86M | 2.44M |

The consumer's whole library call, including reading the result, is 6.2M (see [Gas and limits](#gas-and-limits)). The [Integration guide](#integration-guide) shows how a consumer lands the segment on a word boundary.

## Roadmap

0. **Fork release with fixes** (in the `webaudio-tinysynth` fork): MIDI parser bounds fix (#4), pinned tagged build with a published SHA-256 (#5), deterministic reverb and noise buffers (#7), custom waveform API (#26) and per-operator filter (#27). Fractional tempo and `loopEnd` are already merged.
1. **Scaffold** (this): repository layout, toolchain, interface declarations, README.
2. **Player page JS** (done, issue #8): MIDI decode, tap-to-start, play/stop, End-of-Track looping, latency-compensated art restart, offline only.
3. **Offline build pipeline** (done, issue #9): verifies the pinned engine by SHA-256, gzips it (issue #14), assembles and aligns the page, and generates the pre-encoded Cairo constants plus golden fixtures (reference outputs for sample MIDI and art).
4. **Cairo class implementation** (done, issue #10): the class, `midi_segment`, `SynthSettings` validation and encoding (issue #1), byte-for-byte parity with the JS reference fixtures directly and through `library_call`, the example ported to the class, the optimized base64 encoder (`game_components_encoding`), and gas and class-size measurements.
5. **Browser validation**: Chromium, Firefox and WebKit; playback, looping, art sync, and offline behaviour.
6. **Docs and declaration**: finalize docs, declare on Sepolia, then on mainnet, and publish the class hashes.

## Open decisions

- **Custom waves and filters**: their types, ranges and encoding are fixed by issue #1, but accepting them, and their player side, belong to issues #2 and #3.

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE). The embedded TinySynth engine is also Apache-2.0: copyright Tatsuya Shinyagaito (g200kg), modified by Provable Games in <https://github.com/Provable-Games/webaudio-tinysynth>. The page's gunzip shim is derived from fflate, MIT License, Copyright (c) 2026 Arjun Barrett ([text](tests/vendor/fflate-0.8.3.LICENSE)). The class's base64 encoder is the `game_components_encoding` package of [game-components](https://github.com/Provable-Games/game-components), MIT License, Copyright (c) 2026 Provable Games ([text](tests/vendor/game-components.LICENSE)). `license()` includes all four notices.

The Beast and MIDI test fixtures are Apache-2.0 as well. The Beast SVG in [`tests/fixtures/beasts/`](tests/fixtures/beasts/README.md) is Beasts artwork that Provable Games licenses under Apache-2.0 for this repository, and the MIDI scores in [`tests/fixtures/midi/`](tests/fixtures/midi/README.md) are synthetic, generated by `scripts/gen_midi_fixtures.mjs`. Neither is part of the class.

## Examples

- [`examples/beast_consumer`](examples/beast_consumer): a runnable end-to-end example of a Beasts-style NFT assembling its `token_uri` with library calls to this class (declared, never deployed), word-aligned, with golden fixtures and decoded output, and a full-size Beast token (a real Beast SVG and a synthetic score of the largest production size) for the full-size gas measurement.

## CI

GitHub Actions runs on every pull request and on pushes to `main`, on `ubuntu-24.04-arm`, with every action pinned to a commit SHA ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)):

| Job | What it checks |
| --- | --- |
| `cairo` | Scarb 2.20.1 and snforge 0.64.0 from `.tool-versions`: `scarb fmt --check`, `scarb build` and `snforge test` at the root and in `examples/beast_consumer`; the Scarb lockfiles stay unchanged |
| `javascript` | Node 24: the example's Node tests; `npm ci` (when `package-lock.json` exists) and `npm test` when the root `package.json` has a `test` script; `tsc --checkJs` on `player/` when it exists |
| `generated` | Reruns `scripts/gen_midi_fixtures.mjs` (the synthetic scores) and the example's `gen_fixtures.mjs`, then `npm run check:settings` and `npm run check:page` (the engine hash, the page, `src/page_data.cairo` and the page fixtures) when those scripts exist, then fails on any diff |
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
node scripts/gen_midi_fixtures.mjs
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
