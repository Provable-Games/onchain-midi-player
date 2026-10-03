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

### Consumer `token_uri` layout

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
- **Settings and MIDI.** It parses `SETTINGS` strictly (`decodeSettings`: the grammar, canonical integers, Cairo type bounds, count bounds, known tags, every token consumed). Range and semantic validation is Cairo's alone: the class runs `settings::validate` before writing `SETTINGS`, and the page does not repeat it (spec Q4, reversed). It decodes the MIDI block (strict base64 after trimming the alignment spaces) and checks it (`checkMidi`). The check guarantees that TinySynth's parser reads the file as written and that looping is safe; its rules and error messages are in the [MIDI contract](#midi-contract).
- **Fail closed (spec D9).** If the engine did not load (its gzip payload did not inflate, or the engine failed when it ran: `engine: TinySynth did not load`), and on any parse or MIDI error, ▶ stays disabled, the exact error is shown at the bottom of the frame and in the button's title, and logged. No synth is created. The art stays: the player that shows it is not compressed, so it never depends on inflation.
- **▶** (a click or tap) constructs TinySynth on the first press (`createSynth`), resumes the `AudioContext` inside the gesture, reloads the MIDI (back to tick 0 at the song's starting tempo, keeping any rest before the first event), loops at End-of-Track with `setLoop(1)` and `setLoopEnd(maxTick)`, and starts playback. It then restarts the art when tick 0 is heard: after TinySynth's scheduling offset (`playTime - currentTime`, 100 ms) plus `AudioContext.outputLatency`, it re-creates the `<img>` with a distinct but equivalent URL (`data:image/svg+xml;r=<n>;base64,...`), so the browser starts a new animation timeline, and swaps it in once decoded.
- **■** stops playback and cancels a pending art restart. It also cuts off every voice, including drum voices and notes already scheduled ahead (which TinySynth's `stopMIDI` leaves running), by replacing each channel's volume node, and drops the controller changes TinySynth had already scheduled, so nothing reaches the next playback. The art keeps running.
- Plain JavaScript (`// @ts-check` and JSDoc), no modules, no `eval`, no network requests, no storage or cookies. It works in `<iframe sandbox="allow-scripts">` and under a CSP that allows only inline scripts and styles and `data:` images.

Sizes (the build prints them; [`src/page_data.cairo`](src/page_data.cairo) records them), against the previous, uncompressed page (`page.5`, with the engine at fork commit `b70ba90`). Now is `tinysynth-4b29ff1+page.7`, whose player is 29 bytes longer than `page.6`'s (its count bounds, and the check of each count against the input left), so `PAGE` is 27 bytes and the segment 48 bytes longer. With the `b70ba90` engine, `page.6` was 23,958 bytes, with 9,862 bytes of gzip and a 42,644-byte segment. The `4b29ff1` engine is 100 bytes smaller (36,960 bytes) but its bounded MIDI parser and transport fixes compress less well, so its gzip payload is 544 bytes larger:

| | `page.5` (bytes) | Now (bytes) |
| --- | --- | --- |
| `PAGE` | 44,298 | 24,714 |
| of which the engine | 37,060 | 13,876: 10,406 bytes of gzip, as base64 |
| of which the gunzip shim (minified) | | 3,247 |
| of which the player (minified) | 6,047 | 6,173 |
| `animation_url_segment()` | 78,804 | 43,988 |
| `license()` | 2,594 | 6,417 |

The player does not re-check settings ranges: dropping that re-check (and the install path's custom-wave guards, which only repeated Cairo rules) saved 1,512 bytes of the uncompressed `PAGE` (45,810 to 44,298). The build fails if a validation rule reappears in the player.

The page is tested in Node ([`player/player.test.js`](player/player.test.js): the page's own shim and minified player script in `node:vm` against a fake DOM, the shim inflating the real engine from the page's payload, with a recording engine and with the real engine on a WebAudio mock; [`player/gunzip.test.js`](player/gunzip.test.js): the shim's inflation) and in headless Chromium, Firefox and WebKit, on the class's output (`npm run page-check` and `npm run drift-check`; see [Browser validation](#browser-validation)).

Engine differences the browser checks show (Playwright's builds: Chromium 153, Firefox 155, WebKit 26.6):

- **Firefox needs an audio output device.** Without one, its `AudioContext` never leaves `suspended` and `resume()` never settles: ▶ turns into ■, but nothing plays and the art does not restart. CI gives Firefox a PulseAudio null sink (see [CI](#ci)). On it, ▶ takes up to about 2 s to start playback, waiting for `resume()` to settle (WebKit up to about 1 s, Chromium under 0.2 s; the checks print each time). The art restart still lands on tick 0, because the player times it from `playTime` once `resume()` has settled.
- **`AudioContext.outputLatency`**: Chromium's headless shell reports 32 ms, Firefox on the null sink 35-50 ms, and WebKit 0 (it has the property but reports no latency). So on WebKit the art restart includes only TinySynth's 100 ms scheduling offset, and any real output latency puts the art that far ahead of the sound. Where the property is missing, the player counts it as 0.
- The art restart, the End-of-Track loop timing (exact to 1e-6 s), the failure paths and the offline renders of the reference timbres agree on all three engines.

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
- **Cost in the browser:** inflating the payload takes about 2 ms cold (0.4 ms warm) in headless Chromium, and the page is ready (▶ enabled) about 3 ms later than the uncompressed one: a median of 12.1 ms instead of 9.2 ms after navigation, as an offline `data:` URI. These were measured with the `b70ba90` engine's 9,862-byte payload; the current 10,406-byte one inflates in the same time (1.4 ms cold and 0.2-0.3 ms warm for both, measured side by side). `npm run page-check` prints the figure for its `data:` page.

| Hash (SHA-256) | Of | Where |
| --- | --- | --- |
| `b49e8ceb802b7665cd6f66100dc390874c806a8894be464273d43c532940fc55` | the engine, decompressed: the fork's `webaudio-tinysynth.min.js` at `4b29ff1` (36,960 bytes) | `script_sha256()`, `page_data::ENGINE_SHA256` |
| `dec711614d61133881b642bc93829a26a7ac1cc8b7b34e5dd25f4f2482aa5d63` | the gzip payload in `PAGE` (10,406 bytes) | `page_data::GZIP_SHA256`, `page_data::GZIP_LEN` |
| `bf6316a818dc7519afafa5af7bf826af5280c9950d208f0a2822f4295ab0d4df` | the minified gunzip shim | `SHIM_PIN` in [`scripts/page.mjs`](scripts/page.mjs) |

## Interface

Declared in [`src/interface.cairo`](src/interface.cairo) as `IOnchainTinySynth`. The doc comments there give exact byte formats and preconditions.

| Function | Returns |
| --- | --- |
| `animation_url_segment() -> ByteArray` | Fixed `"animation_url":"data:text/html;base64,<page>` JSON member, pre-encoded at both layers. No encoding at call time. |
| `midi_segment(midi: ByteArray, settings: SynthSettings) -> ByteArray` | `b64(b64(D))`: the token's settings and MIDI blocks, then opens the art block. Validates `settings` and encodes only per-token data. |
| `base64(data: ByteArray) -> ByteArray` | Standard RFC 4648 base64 with `=` padding, for consumers encoding their own JSON pieces. The same encoder `midi_segment` uses. |
| `script_sha256() -> u256` | Constant SHA-256 of the embedded engine JS, decompressed (big-endian). |
| `version() -> felt252` | Short string identifying the engine and page versions: `'tinysynth-4b29ff1+page.7'`, an interim build (see [Versions](#versions) and [Build pipeline](#build-pipeline)). |
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

How a consumer builds its `token_uri` (the layout above), with the word alignment described below. [`examples/beast_consumer`](examples/beast_consumer) runs exactly this against the class. AI agents can install the [`integrator-guide`](#agent-skills) skill, which walks through it.

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
| The 43,988-byte `animation_url_segment()` ([`tests/test_page_gas.cairo`](tests/test_page_gas.cairo)) | 2.2M | 9.6M |
| Every append of a full-size Beast's `token_uri`: two 40,420-character `b64(S)`, the segment, `midi_segment`, the small pieces (the example's `gas_t4_appends_*`) | 15.8M | 30.4M |

The consumer chooses where its large pieces land by adding spaces between JSON tokens, 3 at a time: 3 spaces are one 3-byte group, so they keep every piece a multiple of 3, and they encode to the constant `'ICAg'`, so they are never base64-encoded at call time. It does this in two places:

- **Before `"image"`, so the first `b64(S)` is aligned.** The consumer encodes `'{' members ',' <pad>`, appends `'ICAg'` until the length plus 48 is a multiple of 31, then the 48-character constant `b64(' "image":"data:image/svg+xml;base64,')`. That is why the image key, with one space in front, is a piece of its own: it is 36 bytes, a multiple of 3.
- **After the comma before `"animation_url"`, so the segment is aligned.** The consumer appends `'LCAg'` (`b64(',  ')`), then `'ICAg'` until the length is a multiple of 31.

At most 30 groups are needed in each place (120 characters), and the decoded JSON only gains insignificant whitespace. `midi_segment` and the second `b64(S)` cannot be aligned this way: they follow the segment directly at both layers.

**Your own encoder.** Consumers may use their own encoder instead of the class's `base64`, provided it produces standard RFC 4648 output. A copy compiled into the consumer also avoids passing the data through the library call: for a 22.7 KB SVG that saves about 7.4M L2 gas (75.2M instead of 82.6M).

## Gas and limits

L2 gas, measured with snforge 0.64.0 and Scarb 2.20.1, with the optimized encoder (see [The base64 encoder](#the-base64-encoder)). Tables that involve base64 give its share. Where it matters, they also give the figure with the byte-wise stand-in encoder that the class used before (about 19.6K L2 gas per input byte, against about 3.3K now).

### Measuring: Sierra gas, not Cairo steps

Every figure here is Sierra gas, snforge's default. The accounting method changes the number about 2.5×. Measured on the example's full-size Beast (`snforge test gas_t4_token_uri`, the call with its test setup): about 299M with `--tracked-resource sierra-gas` and about 762M with `--tracked-resource cairo-steps`. A devnet `starknet_estimateFee` of an INVOKE through devnet's predeployed account measured 740.6M: that account's class is Sierra 1.6, which forces Cairo-steps (VM) accounting for the whole transaction. The same artifact produced the earlier 1.7–1.86B Beasts figures (issue [#11](https://github.com/Provable-Games/onchain-tinysynth/issues/11)).

- Budget a `token_uri` in Sierra gas: snforge's `--gas-report`, or an estimate through an account whose class is Sierra 1.7 or later.
- Treat devnet estimates through its predeployed accounts as inflated by about 2.0–2.6×.
- RPC providers still cap `starknet_call` gas (see [Deployments](#deployments)).

### Entry points

Through `IOnchainTinySynthLibraryDispatcher` on the declared class, as a consumer calls them, including passing the arguments and the result ([`tests/test_class_gas.cairo`](tests/test_class_gas.cairo), `snforge test gas_lc`):

| Entry point | L2 gas | Base64 share |
| --- | --- | --- |
| `animation_url_segment()` | 6.4M: 0.3M to materialize the constant, the rest to return its 43,988 bytes | none |
| `midi_segment(midi, settings)` | 1.6M with no MIDI and the default settings; 60.7M with a score the size of the largest Beast score (3,716 bytes) and the 3 reference sounds (324.3M with the stand-in); 2,681.5M with that score and the largest valid `SETTINGS` in v1 (183,089 bytes; table below) | 53-98% |
| `base64(data)` | 0.2M for 3 bytes, 3.8M for 1,023 bytes, and about 3.6K per input byte for large inputs (20.5M for 1,023 bytes with the stand-in) | nearly all |
| `script_sha256()` | 0.1M | none |
| `version()` | 0.1M | none |
| `license()` | 1.6M | none |

### `midi_segment` by MIDI and `SETTINGS` size

Called directly, net of building the inputs (`snforge test gas_ms gas_b64_midi`). Rows are synthetic scores with the sizes of the onchain composer's production Beast scores ([`tests/fixtures/midi/`](tests/fixtures/midi/README.md)): the gas depends only on the MIDI's length; columns are `SETTINGS` sizes: the defaults, the 3 Beast reference sounds, 6 timbres, one timbre on every slot (175 timbres of one operator) and the largest valid input in v1 (175 timbres of 8 operators with every field at its widest: the most validation and the most encoding work), measured with no MIDI and with the largest score only. Each cell is the total, then the base64 share (`b64(midi)` plus the two passes over `D`):

| MIDI | 16 bytes | 334 bytes | 504 bytes | 9,836 bytes | 183,089 bytes |
| --- | --- | --- | --- | --- | --- |
| none | 1.4M (86%) | 5.8M (63%) | 8.3M (61%) | 144.9M (53%) | 2,527.8M (56%) |
| 816 bytes | 13.2M (97%) | 17.6M (86%) | 19.7M (82%) | 156.6M (56%) | |
| 1,541 bytes | 23.0M (97%) | 27.7M (90%) | 29.9M (87%) | 166.8M (59%) | |
| 2,266 bytes | 33.4M (97%) | 37.4M (92%) | 40.3M (90%) | 176.5M (61%) | |
| 2,991 bytes | 43.0M (98%) | 47.5M (94%) | 49.9M (92%) | 186.4M (63%) | |
| 3,716 bytes (the largest Beast score's size) | 53.5M (98%) | 57.9M (94%) | 60.4M (93%) | 196.6M (65%) | 2,579.7M (57%) |
| 3,716 bytes, with the stand-in encoder | 305.1M (100%) | 321.5M (99%) | 330.4M (99%) | not measured | not measured |

The rest is validating and encoding `SETTINGS` (see [Sound settings](#sound-settings-and-custom-sounds)) and assembling `D`. The library call adds the cost of passing the inputs: 2.8M for the score with the reference sounds, about 102M with the largest `SETTINGS` (2,681.5M in all).

### A full-size example `token_uri` against the 1B target

Token 4 of the example ([`examples/beast_consumer`](examples/beast_consumer/README.md#gas)) is a full-size Beast:
- **art:** the Beasts renderer's SVG for a shiny, animated Warlock, 22,733 bytes;
- **music:** a synthetic score the size of the largest Beast score, 3,716 bytes;
- **sounds:** the 3 reference sounds, 334 bytes of `SETTINGS`;
- **layout:** word-aligned.

Its `token_uri` is 134,869 characters. The whole call is from `snforge test token_uri_4 --gas-report`; the pieces are from the example's `gas_t4_*` tests, each net of its inputs:

| Piece | L2 gas | Of which base64 | With the stand-in encoder |
| --- | --- | --- | --- |
| **Whole `BeastLikeNft.token_uri`** | **286.2M** | **239.5M (84%)** | **1,414.6M** |
| `animation_url_segment()` (library call) | 6.4M | none | 6.2M |
| `midi_segment()` (library call) | 60.1M | 54.6M | 323.7M |
| The consumer's base64 (4 library calls): `b64(svg)` 82.6M, `b64(S)` 110.2M, the head and `'}'` about 1M | about 194M | 184.9M | about 1,059M |
| The appends (word-aligned layout; 30.4M unaligned) | 15.8M | none | 16.0M |
| The rest: SVG and score constants, members, name check | about 10M | none | about 10M |

The stand-in column was measured with the engine at fork commit `b70ba90`, whose segment is 1,344 bytes shorter; it is not re-measured. With that engine the optimized encoder gave 286.2M for the whole call, 6.2M for the segment and 16.0M (29.9M unaligned) for the appends. The `page.7` segment, 43,988 bytes, is a whole number of 31-byte words, so `midi_segment`, which follows it, lands on a word boundary too: the appends cost 15.8M, against 16.1M with `page.6`.

- **A full-size Beast costs 0.29B, well under budget:** less than a third of the 1B target, or of Starknet's limit of 1.1×10^9 L2 gas per transaction. With the stand-in encoder it cost 1.41B, over both. The projection from the encoder's lab figures (62% less encoding gas) was about 0.57B; measured, encoding costs about 83% less per byte than with the stand-in.
- **Most of it is still the SVG.** Base64 is 84% of the total, and the two passes over the SVG are 67%. These are the same two passes Beasts' metadata makes today: it encodes the SVG for `image`, then the whole JSON over it. What sound adds is the segment, `midi_segment` and the appends: about 82M (346M with the stand-in).
- **The sample tokens are cheaper:** a 1 KB SVG and a 112-byte MIDI cost 30.4M to 30.5M (90.2M to 90.6M with the stand-in and the `b70ba90` engine).

### The size of `SETTINGS`: no byte cap

`SETTINGS` has no length limit: issue #1's 8,192-byte cap is gone, and so is any structural maximum. The class checks only what the format and the engine require (see [Sound settings](#sound-settings-and-custom-sounds)). The rest is priced in gas, and served or refused by the RPC node (next section).

- **What bounds it.** Very little, by design:
  - The counts are bounded: at most 175 timbres (each program and drum slot once), 8 operators each, and 256 waves (all that `Waveform::Custom(u8)` can index).
  - A wave's length is not: the engine takes any non-empty table ([webaudio-tinysynth#26](https://github.com/Provable-Games/webaudio-tinysynth/issues/26), the fork's decision D-028).
  - The numbers take any value of their integer type.
  - **In v1, where custom waves and filters still revert,** the largest valid input is 183,089 bytes: 175 timbres of 8 operators, every field at its type's extreme.
  - **With custom waves (issue #2)** there is no largest input.
- **Cost per size.** Linear over every size measured, from 23 KB to 5.4 MB of `SETTINGS`. Every 1,000 bytes add about 14M L2 gas to `midi_segment` through the library call, and about 15M to a full Beast `token_uri`.
  - About 5-6M of that is encoding. The rest is base64, because `SETTINGS` sits inside `D`, which is encoded twice.
  - Validation never exceeds about 23M, because it checks counts, slots and routes, not values or samples.
- **Realistic settings are cheap.** The 3 reference sounds (334 bytes) or 6 timbres (504 bytes) add 4-7M over the defaults, about 2% of a full Beast `token_uri`. A full per-type pack of about 20 two- or three-operator timbres is about 2.6 KB, which adds about 40M.
- **TinyChip's long noise can be carried exactly.** Its 32,767-step LFSR table, as `i8` samples of ±64, is 114,766 bytes of `SETTINGS` with one drum timbre on it. In token 4 in place of the reference sounds, the `token_uri` costs 2.44B, 2.15B more than with the reference sounds.
- **Larger art.** Each byte of SVG costs about 9K L2 gas in the full `token_uri`: the consumer's two base64 passes through the library call, plus appending `b64(S)` twice.

The full Beast `token_uri` above, token 4 of the example, with `SETTINGS` of each size in place of the reference sounds. The inputs were built in loops, every operator with every field at its type's extreme, and the waves' samples at −128:

| `SETTINGS` | Bytes | Calldata of `midi_segment` (felts) | `midi_segment` through the library call | Whole `token_uri` | `token_uri` length | JSON-RPC response (about 2.16 x) |
| --- | --- | --- | --- | --- | --- | --- |
| The 3 reference sounds | 334 | 221 | 60.7M | 286.2M | 134,869 | 0.29 MB |
| 22 timbres x 8 operators | 23,022 | 2,658 | 385.2M | 622.3M | 175,205 | 0.38 MB |
| 44 timbres x 8 operators | 46,034 | 5,188 | 715.0M | 961.2M | 216,117 | 0.47 MB |
| 88 timbres x 8 operators | 92,058 | 10,248 | 1,375.3M | 1,639.0M | 297,941 | 0.64 MB |
| 175 timbres x 8 operators: the largest in v1 | 183,089 | 20,253 | 2,680.5M | 2,995.2M | 459,765 | 0.99 MB |
| The same, plus 256 waves of 256 samples (issue #2) | 517,907 | 87,701 | 7,383.5M | 7,859.5M | 1,054,997 | 2.28 MB |
| The same, plus 256 waves of 1,024 samples (issue #2) | 1,501,203 | 284,309 | 21,163.3M | 22,111.1M | 2,803,077 | 6.05 MB |
| The same, plus 256 waves of 4,096 samples (issue #2) | 5,433,363 | 1,070,741 | 76,270.3M | 79,106.0M | 9,793,589 | 21.15 MB |
| TinyChip's 32,767-step noise and one timbre (issue #2) | 114,766 | 32,915 | 1,825.6M | 2,436.9M | 338,309 | 0.73 MB |

- **Where the limits fall.** A full Beast `token_uri` passes the 1B target at about 48 KB of `SETTINGS`, and 1.11B at about 56 KB. Whether a larger one renders depends on the RPC node that serves the call (next section).
- **How these were measured.** With snforge, through the example's NFT (`--gas-report`, the `token_uri` call itself). The calldata is the `SynthSettings` and the score.
  - Every size runs. The 1.5 MB input takes 174M Cairo steps through `token_uri`, and the 5.4 MB input takes 73 s through `midi_segment`.
  - The library call moves the calldata in and the result out. It costs 1,468M more than calling `midi_segment` directly at 1.5 MB (284,309 felts in and 86,382 out), and 101M at the largest v1 input.
  - The repository's tests go up to the largest v1 input (`structural_max()` in [`tests/settings_fixtures.cairo`](tests/settings_fixtures.cairo), built in a loop and checked against the JS reference's length and SHA-256). It takes about 20M steps through `midi_segment`, so [`Scarb.toml`](Scarb.toml) raises snforge's step limit to 100M. The larger sizes were measured once, outside CI.

### Network and node limits

A consumer's `token_uri` is a view call (`starknet_call`), so what limits it is the node that serves it, not the protocol:

- **No protocol limit applies to a large view call.**
  - `call_contract` and `library_call` have no calldata or retdata cap and no per-felt syscall charge. Their cost is flat: about 91.6K L2 gas for `CallContract` and 89.2K for `LibraryCall` (versioned constants 0.14.3).
  - Moving data costs what the Serde code costs: about 3.3K gas per `felt252` per hop, and about 4.3K per 31-byte `ByteArray` chunk per hop, linear from 10K to 1M felts.
  - Call depth is capped at 50.
  - The 1.11B L2 gas cap per transaction (SNIP-40, Starknet 0.14.3 and later; the docs page still says 1.1B) and the 5,000-felt calldata cap apply only to transactions, never to `starknet_call`. A view call measured at 5.38B passed.
  - Source: [starkware-libs/sequencer](https://github.com/starkware-libs/sequencer) at `16facd2c92`, files `crates/blockifier/src/execution/syscalls/hint_processor.rs`, `entry_point.rs`, `blockifier_versioned_constants_0_14_3.json` and `transaction/account_transaction.rs`.
- **Node limits**, from their configuration or code:

| Node | Gas for a view call | Other limits |
| --- | --- | --- |
| Pathfinder v0.24.0 | 10B, compiled in (`default_initial_gas_cost`, `crates/executor/src/call.rs:47-51`) | Top-level `starknet_call` calldata at most 10,000 felts (`crates/rpc/src/executor.rs:30`), which `token_uri(token_id)` never approaches; no response-size cap found; 120 s timeout |
| Juno v0.16.6 | `--rpc-call-max-gas`, 100M by default (raisable) | No cap on a single response |
| Madara | 10B | Requests and responses at most 15 MiB |
| jsonrpsee, and StarkWare's `apollo_rpc` | | Responses at most 10 MiB: a returned `ByteArray` of about 4.85 MB |
| Katana (development) | 1B by default | |
| Hosted providers | Undocumented. The issue #11 probe found PublicNode capping below about 286M | |

- **Against the table above:**
  - A full Beast with the reference sounds (286.2M) already needs more than Juno's default.
  - The largest v1 input (3.0B) fits Pathfinder's and Madara's 10B. So does TinyChip's long noise (2.44B).
  - With custom waves, 10B is reached at about 670 KB of `SETTINGS`.
  - The responses pass jsonrpsee's 10 MiB at about 4.85 MB of `token_uri`, about 2.7 MB of `SETTINGS`.
- **Hazard for integrators.** If any class in the call chain is Cairo 0 or Sierra before 1.7 (a proxy pointing at an old class, for example), that frame and everything below it switches to Cairo-steps accounting. It is then capped at 10M steps (Juno: 4M), about 1B gas. `midi_segment` alone takes about 20M steps with the largest v1 `SETTINGS`. Keep every class in the chain at Sierra 1.7 or later.

## Sound settings and custom sounds

Declared in [`src/types.cairo`](src/types.cairo). The consumer passes a typed `SynthSettings` value with every `midi_segment` call:

| Type | Contents |
| --- | --- |
| `SynthSettings` | `quality` (0 chip-tune, 1 FM), `reverb` (`u8` percent, 0 off), `master_vol` (`u8` percent), `voices` (`u8`, at least 1), `waves: Span<WaveDef>` (custom waveforms shared by all timbres, 0–256) and `timbres: Span<Timbre>` (0–175: each program and drum slot at most once) |
| `Timbre` | A custom sound replacing General MIDI program `slot` (0–127), or drum note `slot` (35–81) when `drum` is true. Holds 1–8 operators |
| `Operator` | One oscillator, using TinySynth's 13-parameter model: `route` (output, FM or AM target), `wave`, `volume`, `ratio`, `offset_hz`, `attack`, `hold`, `decay`, `sustain`, `release`, `pitch_ratio`, `pitch_time`, `key_scale`, plus an optional `filter`. The values after `wave` are `u32` (`offset_hz` and `key_scale`: `i32`), fixed point ÷10,000, and the class does not range-check them. At extremes, `key_scale`, and `ratio` in long FM chains, make the engine compute non-finite gains or frequencies and throw while playing (see [the note below](#extreme-operator-values)) |
| `Waveform` | `Sine`, `Square`, `Sawtooth`, `Triangle`, `WhiteNoise`, `MetallicNoise`, or `Custom(index)`: entry `index` of `SynthSettings.waves` |
| `WaveDef` | `Harmonics(Span<u16>)` (band-limited custom wave, at least 1 harmonic) or `Samples(Span<i8>)` (single-cycle chip wave played sample-and-hold, at least 1 sample). The engine takes any length |
| `Filter` | `LowPass`, `HighPass` or `BandPass`, with a cutoff (in Hz or key-tracked) and Q. Fixed, with no envelope |

- <a id="extreme-operator-values"></a>**Extreme operator values.** With the 4b29ff1 engine, a note's gain is multiplied by `2^((note - 60) / 12 * key_scale)`, and an FM modulator's frequency and gain by its target's frequency. When a result passes the `float` range of Web Audio (about 3.4e38) or is NaN, the engine throws a `TypeError` for that note and it does not sound. Measured in Chromium:
  - `key_scale` above about 22 at note 127, or below about −25 at note 0, throws.
  - An FM chain (each operator modulating the one before) with `ratio` at its maximum throws from 7 operators. With `ratio`, `pitch_ratio` and `volume` all at their maxima, it throws from 6.
  - The old ranges (`ratio` 64.0, `pitch_ratio` 16.0, `volume` 100.0, `key_scale` ±8.0) play on an 8-operator chain at notes 0 and 127 with no error.
  - Whether the class bounds these fields again or the engine guards the values is open.
- **Units.** Fractional fields are fixed-point integers in units of `1 / FIXED_POINT_SCALE` (10,000), because Cairo has no floating point. For example `5_000` = 0.5.
- **Validation.** `settings::validate` checks only what the format or the engine requires: `quality` is 0 or 1, `voices` at least 1, the counts (256 waves, 175 timbres, 1–8 operators, at least one harmonic or sample per wave), the slots and their uniqueness, the routes and their targets, the wave index, and the gates for issues #2 and #3. Every other number takes any value of its integer type: the engine takes them (`setMasterVol`, `setReverbLev` and `setVoices` assign them, and Web Audio clamps frequencies), though at extremes some make it throw while playing (see [Extreme operator values](#extreme-operator-values)). A failed check reverts with a `'TS: ...'` short string followed by the 0-based indices of the offending wave, timbre or operator, for example `('TS: FM target not earlier', 3, 1)`. Invalid settings never reach the page. The checks and messages are listed in [`src/settings.cairo`](src/settings.cairo).
- **Not yet accepted.** Custom waves (a non-empty `waves`, or `Waveform::Custom`) revert with `'TS: custom wave unsupported'` until issue #2 lands. Filters revert with `'TS: filter unsupported'` until issue #3 lands. Their encoding is already part of the format, so lifting these checks changes neither the grammar nor the format version.
- **Selecting sounds.** A MIDI file selects a custom sound the ordinary way: a program change to its slot, or the drum note on channel 10. Only programs 0–127 and drum notes 35–81 are reachable from MIDI.
- **Consistency.** For a given class hash, the same settings and MIDI always produce the same sound. To keep a token's sound fixed, pass constants, or values derived only from permanent traits.
- **Size.** `SETTINGS` is base64-encoded at call time along with the MIDI.
  - It is 16 bytes with the defaults (`1,1,30,40,64,0,0`), plus about 6 bytes per timbre and 50 bytes per operator.
  - The three Beast reference sounds (a 2-operator lead, kick and snare) come to 334 bytes.
  - There is no byte cap. Each 1,000 bytes add about 14M L2 gas to `midi_segment` (see [The size of `SETTINGS`](#the-size-of-settings-no-byte-cap)).
- **Engine dependencies.** Custom waves need [webaudio-tinysynth#26](https://github.com/Provable-Games/webaudio-tinysynth/issues/26). Its storage question is [decided](https://github.com/Provable-Games/webaudio-tinysynth/issues/26#issuecomment-5965255502): each sample wave is stored as one cycle, with its own home pitch. `Filter` needs [#27](https://github.com/Provable-Games/webaudio-tinysynth/issues/27). Deterministic noise needs [#7](https://github.com/Provable-Games/webaudio-tinysynth/issues/7). All must land before the class is declared.

### The `SETTINGS` format

The class writes settings into the page as `SETTINGS`, format version 1.
- **Syntax.** A flat list of canonical decimal integers separated by commas (`[0-9,-]` only, so it can never close its `<script>` block).
- **Structure.** Fields in declaration order, a length before every list, enums as their variant index, `bool` as 0/1, and `Option` as 0 (`None`) or 1 followed by the value.
- **Spec.** The grammar, the 17 checks and their messages are in [`src/settings.cairo`](src/settings.cairo). They were specified in issue #1 ([spec](https://github.com/Provable-Games/onchain-tinysynth/issues/1#issuecomment-5964892140), [shared-wave-table amendment](https://github.com/Provable-Games/onchain-tinysynth/issues/1#issuecomment-5965159953)).

```text
1,1,0,40,64,0,3,                                         version, quality, reverb, master_vol, voices, 0 waves, 3 timbres
0,0,2,0,3,3000,10000,0,30,0,100,10000,100,10000,10000,0,0,1,3,175,0,60000,2000,0,100,10000,100,10000,10000,0,0,
1,36,2,…                                                 (Beast reference lead, then kick and snare; line breaks for reading only)
```

The crate exports:
- the pure functions `onchain_tinysynth::settings::{validate, encode, validate_and_encode}`;
- the helpers `default_settings()` and `default_operator()` (TinySynth's operator defaults in fixed-point);
- the limits as constants (`MAX_TIMBRES`, `MAX_OPERATORS`, `MAX_WAVES`, `MIN_HARMONICS`, `MIN_SAMPLES`, `MIN_VOICES`, …).

Gas (snforge, L2 gas, net of building the input):

| Input | `SETTINGS` bytes | `validate` | `encode` |
| --- | --- | --- | --- |
| no timbres | 16 | 11K | 107K |
| 6 timbres (Beast lead, kick, snare, two hats, bass) | 504 | 247K | 3.0M |
| one timbre on every slot (175 timbres of one operator) | 9,836 | 9.6M | 58.2M |
| largest valid input in v1: 175 timbres × 8 operators, every field at its type's extreme (most validation and most encoding work) | 183,089 | 22.2M | 1,094.6M |

### Player JavaScript (`player/`)

Plain, dependency-free, CSP-safe JavaScript (`// @ts-check` with JSDoc, no `eval`), used by the page and by the tests:

- [`player/settings.js`](player/settings.js) is the page's settings module. It provides:
  - `decodeSettings(text)`: the strict parser (the grammar, canonical integers, Cairo type bounds, count bounds, known tags, every token consumed); it throws a `SettingsError`. It does not repeat Cairo's range checks. Its count bounds are the limits of the format: 175 timbres, 256 waves and 8 operators; a wave's length has none, and every count must also fit in the input left, so a corrupt count fails at once. Cairo's caps equal them but are separate constants, so a Cairo cap can change within them without a new page;
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

The kick and snare are in `scripts/settings_fixtures.mjs`. `npm run render-check` renders all three sounds in a headless browser (Chromium, Firefox or WebKit; CI runs all three) and measures them (optional; needs Playwright). The checks: pitch and vibrato, the kick's pitch drop, and the snare's noise burst.

## MIDI contract

What a composer can rely on, and what the page rejects. The `midi` argument of `midi_segment` is a Standard MIDI File passed as a `ByteArray`. The class embeds it as base64 and never parses it, so a file that breaks a rule here does not revert: the page shows the error, ▶ stays disabled, and the art still shows. Check files before they go onchain with [`scripts/check_midi.mjs`](#checking-midi-files), which runs the page's own check.

Every rule below is fixed per class hash: the checks are `checkMidi` and `decodeMidi` in [`player/player.js`](player/player.js), and playback is the pinned TinySynth (`4b29ff1`) driven by that player. A later engine pin can change the playback rules. [`scripts/engine_contract.test.mjs`](scripts/engine_contract.test.mjs) pins the less obvious ones on the pinned engine, so a re-pin that changes one of them fails `npm test`.

### Accepted format

`checkMidi` rejects a file unless it meets every rule below. Its errors read `midi: <message> (byte <offset>)`, where the offset is where reading stopped.

| Rule | Message |
| --- | --- |
| The file starts with an `MThd` chunk of length 6. | `not a Standard MIDI File` |
| Format 0 or 1. | `format 2 is not supported` (with the file's format number) |
| At least one track, and exactly one in format 0. | `bad track count` |
| The time division counts ticks per quarter note, 1–32,767. SMPTE timing (top bit set) and 0 are rejected. | `SMPTE or zero time division is not supported` |
| Every chunk after the header, up to the declared number of tracks, is an `MTrk` chunk. | `expected MTrk` |
| Each `MTrk` length stays inside the file. | `MTrk length past the end of the file` |
| Every chunk ends inside the file, and every event inside its chunk. A track with no End-of-Track runs past its chunk and fails here. | `truncated` |
| Delta times and lengths take at most 4 bytes. | `bad variable-length number` |
| End-of-Track (`FF 2F 00`) is the last event of every chunk, so chunk lengths are exact. | `End-of-Track is not at the end of its track` |
| Nothing follows the last track. | `trailing bytes after the last track` |
| Running status follows a channel message in the same track: not at the start of a track, nor after a meta or SysEx event. | `running status without a channel status` |
| Channel message data bytes are 0–127. | `bad data byte` |
| Tempo is exactly `FF 51 03 tt tt tt` (the length a single byte) and not 0. | `bad tempo` |
| Text, copyright, track name, instrument name and device name events (`FF 01`–`FF 04`, `FF 09`) are at most 4,096 bytes. | `text event longer than 4096 bytes` |
| Each SysEx is one `F0` event that holds the whole message and ends with `F7`. | `SysEx not complete in one event` |
| No `F7` events (SysEx continuation or escape). | `SysEx continuation or escape (F7) events are not supported` |
| No other system status bytes as events (`F1`–`F6`, `F8`–`FE`). | `unexpected status byte` |
| One pass lasts at least 50 ms: `maxTick` (see [Playback](#playback)) under the tempo map, which starts at 120 BPM. | `loop shorter than 50 ms` |

Everything else is accepted: any channel message, other meta events and SysEx of any length, and tempo events in any track. The page also rejects a MIDI block that is not strict base64 (`midi: not base64`). The class always writes valid base64, so only `check_midi.mjs` reports it, for a bad base64 input.

The rules follow from how TinySynth reads a file: it stops reading a track at End-of-Track rather than at the chunk length, keeps running status across tracks and after meta and SysEx events, reads tempo at a fixed offset, and turns F7 events into SysEx. On a loop under 50 ms its scheduler would never catch up, and a longer text event can exceed a browser's argument limit.

### Playback

- **Start.** Nothing plays until ▶ is pressed (a click or tap). Each ▶ reloads the MIDI and plays it from tick 0, after resetting every channel: program 0, volume (CC7) 100, pan (CC10) 64, expression (CC11) 127, modulation 0, sustain off, pitch bend centred, bend range MSB 2 (see RPN 0 below), fine, coarse, master and GS scale tuning 0, and channel 10 as the only drum channel. The tempo is 120 BPM until the first tempo event. A rest before the first event is kept.
- **Tracks.** TinySynth merges all tracks into one list by tick; events at the same tick keep file order, track by track. A track does not loop on its own: if it ends before the others, it sends no more events until the next pass, but notes it left sounding (with no note-off yet) keep sounding.
- **Tempo.** A tempo change takes effect at its tick, from any track. The BPM is 60,000,000 divided by the tempo value, kept fractional.
- **Loop.** The song always loops. A pass ends at `maxTick`, the latest End-of-Track tick of any track (the player calls `setLoop(1)` and `setLoopEnd(maxTick)`), and the next pass starts at tick 0, keeping the rest before the first event.
- **State between passes.** At each loop point the tempo returns to 120 BPM, and a tempo event at tick 0 applies at once. Nothing else is reset: programs, controllers, pitch bend, RPN settings and tuning carry over from the end of the previous pass, and notes still sounding at End-of-Track keep sounding. Events at tick 0 run again on every pass, so a song that sets its state at tick 0 starts every pass the same way. Otherwise the first pass starts from the defaults above, and later passes from wherever the previous one ended.
- **■** stops playback, cuts every voice (drum hits and notes already scheduled ahead included), and cancels the volume, expression, pan and modulation changes TinySynth had already scheduled. The art keeps running.
- **Scheduling.** TinySynth schedules events about 0.2 s ahead. Each message takes effect at its own time, except CC120, CC121 and CC123–127 (see below) and the voice limit (see [Limits](#limits)), which act when the event is scheduled.

### Channels and instruments

- **16 channels.** Port and channel-prefix meta events are ignored.
- **Channel 10 (index 9) is percussion.** A note-on from 35 to 81 plays that drum; other notes are silent. Note-offs are ignored: a hit lasts 3.5 × the decay of its sound's first operator. Program changes on channel 10 have no effect.
- **The other channels are melodic.** Program changes 0–127 select the General MIDI instrument, and notes 0–127 all play. Bank select (CC0, CC32) is ignored, so there are 128 programs.
- **Built-in sounds.** `SynthSettings.quality` picks TinySynth's built-in set: 0 chip-tune (one oscillator per note), 1 FM.
- **Custom sounds.** Each entry of `SynthSettings.timbres` replaces program `slot` (0–127) or drum note `slot` (35–81) for the whole song. The MIDI selects it the ordinary way: a program change to the slot, or that drum note on channel 10.

### Messages TinySynth honours

| Message | Effect |
| --- | --- |
| Note on (`9n`) | Velocity 1–127; velocity 0 is a note-off. Loudness follows velocity squared, (velocity / 128)²; FM depth does not change with velocity. |
| Note off (`8n`) | Releases every note of that pitch on the channel that started at or before it and has had no note-off yet. Its velocity is ignored. |
| Program change (`Cn`) | Selects the instrument for the channel's following notes. |
| Pitch bend (`En`) | Bends the channel by (value − 8192) / 8192 × the bend range. Every note that starts later takes the new bend, drum hits included. Of the notes already sounding, it retunes only the oscillator operators of melodic notes: noise operators (`WhiteNoise`, `MetallicNoise` and the built-in noise sounds) and drum hits keep the bend they started with. |
| CC1 modulation | Vibrato of ±(value × 100 / 127) cents from one 5 Hz sine LFO, shared by all channels. |
| CC7 volume, CC11 expression | Channel gain 3 × (CC7 / 127)² × (CC11 / 127)². |
| CC10 pan | Position (value − 64) / 64: 0 is left, 64 centre, 127 almost fully right. |
| CC64 sustain | At 64 or more, notes that get a note-off keep sounding; below 64 releases them. |
| CC101 and CC100 (RPN), CC6 and CC38 (data entry) | RPN 0, bend range: full scale is (MSB × 128 + LSB) × 100 / 127 cents, so the default MSB 2 gives about ±201.6 cents, not ±200. RPN 1, fine tuning: 14 bits, ±1 semitone around 8192. RPN 2, coarse tuning: MSB − 64 semitones. Other RPNs are ignored. |
| CC98, CC99 (NRPN) | Deselect the RPN, so the data entry that follows is ignored. |
| CC120, CC123–127 | Cut every melodic note on the channel at once, when scheduled: up to about 0.2 s before the message's time, including notes due in that window. Drum hits are not cut. |
| CC121 reset all controllers | When scheduled: expression 127, modulation 0, RPN deselected, sustain off, and pitch bend centred for new notes. Notes held by sustain are not released: they sound until the next CC64 below 64, the voice limit or ■. |
| SysEx `F0 7F dd 04 03 ll mm F7` | GM master fine tuning: (mm × 128 + ll − 8192) / 8192 semitones. |
| SysEx `F0 7F dd 04 04 ll mm F7` | GM master coarse tuning: mm − 64 semitones. |
| GS SysEx `F0 41 dd 42 12`, address, data, checksum, `F7`, at its standard length (device ID and checksum are not checked) | `40 00 00`: master tune, four data nibbles n, (n − 0x400) × 0.1 cent. `40 00 05`: master key-shift, data − 64 semitones. `40 1x 40` to `40 1x 4B`: scale tuning of C to B, data − 64 cents. `40 1x 15`: use for rhythm part, which makes part x's channel a drum channel (data not 0) or melodic (0); notes on a melodic channel 10 skip their release envelope. Part x: 0 is channel 10, 1–9 are channels 1–9, A–F channels 11–16. |
| Meta `FF 51` (tempo), `FF 2F` (End-of-Track) | See [Playback](#playback). |

Ignored, with no effect: every other controller, including bank select (CC0, CC32), CC91 reverb send (reverb is engine-wide: `SynthSettings.reverb`), CC93 chorus, portamento (CC5, CC65), CC66 sostenuto, CC67 soft pedal, the sound controllers (CC70–79) and CC122 local control; polyphonic aftertouch (`An`) and channel pressure (`Dn`); every other SysEx, including GM System On, GS Reset and GM Master Volume (master volume is `SynthSettings.master_vol`); and every other meta event (text, markers, lyrics, time and key signatures).

### Limits

- **Polyphony:** at most `SynthSettings.voices` (at least 1) melodic notes at once, across all channels. A note beyond that cuts a released note first (the one ending soonest), otherwise the held note that started earliest (of notes that started together, the one latest in the file). The cut happens when the new note is scheduled, up to about 0.2 s before it sounds, so the cut note ends early. A drum hit takes no voice and is never cut, but it applies the limit too: right after one, at most `voices` − 1 melodic notes remain, so with `voices` 1 every drum hit cuts the melody.
- **Range:** 16 channels, programs 0–127, notes 0–127 (drum notes 35–81), and velocity 1–127, with loudness following its square.
- **Timing:** 1–32,767 ticks per quarter note, tempo 1–16,777,215 µs per quarter note, and a pass of at least 50 ms.
- **Size:** text events at most 4,096 bytes. Nothing else in the page limits the size; gas does (see the recommendations).
- **Mix:** master volume and reverb are `SynthSettings.master_vol` and `SynthSettings.reverb`, the same for the whole song. MIDI cannot change them.

### What's fixed and what's driven

- **Fixed per class hash:** the engine, the player and the page, and so every rule in this section. A new engine or page means a new class hash and `version()`.
- **Driven on each call:** the MIDI (by the composer), and the `SynthSettings` and the art (by the consumer).

The full list is in [Verifying the engine](#verifying-the-engine).

### Recommendations (optional)

Nothing checks these; a file that ignores them still plays.

- **Set the state at tick 0:** tempo, program, volume (CC7), pan (CC10), and any controller or GS scale tuning the song changes, so that every pass, and every ▶, starts the same way.
- **Put End-of-Track at the loop point:** the latest End-of-Track should sit exactly where the song loops, such as the last bar line.
- **Release every note by End-of-Track:** a note still held there sounds into the next pass.
- **Put the note-off first:** at one tick, put a note's note-off before the next note-on of the same pitch on that channel. The other way round, the note-off releases the new note too.
- **Prefer note-offs to CC120–127, and avoid CC121** (see the table).
- **Keep the file small:** `midi_segment` base64-encodes the MIDI at call time, once on its own and twice inside `D`, so gas grows with its length. That is about 14M L2 gas per 1,000 bytes (1.4M with no MIDI and 53.5M with 3,716 bytes, in [the `midi_segment` table](#midi_segment-by-midi-and-settings-size)).

### Checking MIDI files

[`scripts/check_midi.mjs`](scripts/check_midi.mjs) runs the page's own `checkMidi` and `decodeMidi`, imported from `player/player.js`, so a score passes exactly when this checkout's player loads it. It needs Node 22 or later and no `npm install`:

```sh
node scripts/check_midi.mjs song.mid                  # a MIDI file
node scripts/check_midi.mjs a.mid b.mid scores.json   # several inputs at once
node scripts/check_midi.mjs scores.json               # every "midi_b64" string in a JSON file
node scripts/check_midi.mjs TVRoZAAAAAYAAQAG...       # a base64 string (MIDI in base64 starts with TVRoZA)
node scripts/check_midi.mjs - < song.b64              # standard input: MIDI bytes, base64 text or JSON
npm run check-midi -- song.mid                        # the same, through npm
```

- **Inputs.** `.mid` and `.midi` files, and files starting with `MThd`, are MIDI. In a JSON file of any shape, every `midi_b64` string is checked and named by the `name` string next to it, as in [`tests/fixtures/page.json`](tests/fixtures/page.json) and the synthetic scores in [`tests/fixtures/midi/scores.json`](tests/fixtures/midi/scores.json). Any other text file is read as base64, ignoring line breaks and spaces (so `base64 song.mid > song.b64` works as it is).
- **Output.** For each score, PASS or FAIL and the size. A failure gives the page's exact error. A pass gives the loop length, `maxTick`, each track's End-of-Track tick and channels, and each channel's notes and programs, with the drum notes on channel 10 (or that it is not used):

  ```text
  PASS song.mid
    816 bytes, format 1, 6 tracks, 480 ticks per quarter note
    loop 25.480 s, maxTick 26880 (the latest End-of-Track: the player loops there)
    track 1: End-of-Track at tick 0, no channel events
    track 2: End-of-Track at tick 9600, 15 notes on channel 1
    …
    channel 1: 15 notes, no program change (program 0)
    …
    channel 10 (drums): not used
  FAIL bad.mid
    midi: running status without a channel status (byte 24)
    32 bytes
  ```
- **Exit status.** 0 if every score passes, 1 if any fails, and 2 for a usage error or an input it cannot read (a missing file, invalid JSON, or JSON with no `midi_b64` string), so it can gate another repository's CI.
- **Where to run it.** It imports `player/player.js`, so run it from a checkout of this repository rather than copying the file alone. It checks against that checkout's player, and a declared class keeps the player it was declared with. So pin the checkout to the release tag of the class version your consumer stores (see [Versions](#versions)). Until a class is declared there is no tag, and `main` is the only choice; it tracks the page under development. In another repository's CI, for example:

  ```sh
  TAG=main   # the release tag of the class version you target, from the Versions table, once one is declared
  git clone --depth 1 --branch "$TAG" https://github.com/Provable-Games/onchain-tinysynth "$RUNNER_TEMP/onchain-tinysynth"
  node "$RUNNER_TEMP/onchain-tinysynth/scripts/check_midi.mjs" path/to/*.mid
  ```

### Previewing a score

[`scripts/preview.mjs`](scripts/preview.mjs) writes the page a token would get, offline: `PAGE ++ D ++ SVG`, byte for byte as the class and a consumer produce it (built with [`scripts/page.mjs`](scripts/page.mjs)). It needs Node 22 or later and no `npm install`. Run it from a checkout whose `VERSION` (in `src/page_data.cairo`) is your class's `version()` (see [Agent skills](#agent-skills)).

```sh
npm run preview -- song.mid                                        # default settings, placeholder art
npm run preview -- song.mid --settings sound.json --svg art.svg   # the token's settings and art
npm run preview -- song.mid --serve                                # also serve it on http://127.0.0.1:8000/
```

- **Checks first.** It runs the MIDI through `checkMidi` and reports it as `check_midi.mjs` does; the settings through `player/validate.js` and `player/encode.js`, the JS reference of `settings::validate` and the encoder, printing the panic data `midi_segment` would revert with; and the SVG through the [art rule](#art-svg-requirements). Any failure exits 1 and writes nothing.
- **Inputs.** The MIDI in any form `check_midi.mjs` reads (one score). `--settings` takes a `SynthSettings` value as JSON, in the shape of the `settings` objects in [`tests/fixtures/settings.json`](tests/fixtures/settings.json) (a whole fixture entry also works; every field is required and unknown fields are rejected), or a page's `SETTINGS` text, so a deployed token's page can be rebuilt from its blocks. `--out` defaults to `preview.html`; `--serve` takes an optional port (0 picks a free one).
- **Identity.** `npm test` checks that, for the example's token 1, the output equals [`examples/beast_consumer/fixtures/animation.html`](examples/beast_consumer/fixtures/animation.html), decoded from the golden `token_uri` the contract matches byte for byte, and that the `token_uri` around token 4's page has the digest the contract's is tested against.
- **Playback** is the same engine and player code as in every token. Audio can still differ slightly across browsers and sample rates, and noise and reverb vary per load until the fork's deterministic buffers land (roadmap phase 0).

## Art (SVG) requirements

The consumer's SVG must never contain `</script`, in any letter case.

- **Why.** In the `animation_url` page, the SVG is the raw contents of the final `<script type="text/plain" id="art">` block, which stays open until the end of the document (see [Consumer `token_uri` layout](#consumer-token_uri-layout)). The HTML parser ends that block at the first `</script`. The art is cut short there, the player's `<img>` gets a truncated SVG and shows a broken image, and the rest of the SVG leaks into the page as markup. The `image` member still decodes to the whole SVG, so marketplaces' image views do not show the failure.
- **In practice.** No `<script>` elements in the SVG, and no comments or CDATA sections containing `</script`. Nothing else needs care: SVG is XML, so any `<` in text content is already escaped as `&lt;`. Consumers lose nothing, because scripts inside an SVG never run when it is shown through `<img>`, which is how both this page and marketplaces' `image` views show it.
- **Evidence.** Art Blocks' onchain generator broke all five of its `custom@na` projects on mainnet this way: each stored HTML document's own `</script>` ended the generator's `<script>` wrapper early, and the rest was parsed as page markup ([`GenArt721GeneratorV0-custom-na-upgrade.md`](https://github.com/ArtBlocks/artblocks-contracts/blob/main/packages/contracts/deployments/generator/GenArt721GeneratorV0-custom-na-upgrade.md) in `ArtBlocks/artblocks-contracts`).
- **Test it in the consumer.** The class never sees the SVG: it returns the pieces around it, and the consumer splices the art in itself. So the rule belongs in the consumer's own tests, on its renderer's output. [`examples/beast_consumer`](examples/beast_consumer) shows how: `assertArtSafe` in its scripts and `contains_script_end_tag` in its Cairo tests check the rendered SVG; its Node tests and browser check show the truncated art an unsafe SVG produces. A renderer built from fixed, reviewed literals and validated fields meets the rule by construction. In Beasts, for example, names are limited to `A-Z a-z 0-9`, space, `'` and `-`, and art URIs are strict base64.
- **`svg_b64`.** The SVG goes into `S` as `svg_b64`: standard RFC 4648 base64 of the exact SVG bytes, with no line breaks. It may end with `=` padding, because it ends the HTML-layer stream. It is also the `image` value, so marketplaces and the page show the same bytes.
- **Rejected alternatives.** Ending the page with an obsolete `<plaintext>` element instead of the art block, and base64-encoding the art inside the page, which would encode the art again at call time, at both layers.

## Engine provenance and verification

- Engine: TinySynth from the Provable-Games fork, <https://github.com/Provable-Games/webaudio-tinysynth>. The fork removes the GUI and is licensed Apache-2.0, like upstream.
- The class embeds the fork's own minified build at a pinned commit: currently `4b29ff1` (`4b29ff10d40989fd97967ed26ee4b2c95dbd8a26`), SHA-256 `b49e8ceb802b7665cd6f66100dc390874c806a8894be464273d43c532940fc55`, an interim pin (below). It moves to a tagged release once the fork publishes one (roadmap phase 0); re-pinning is a one-line change (see [`tests/vendor/README.md`](tests/vendor/README.md)).
- **Interim pins.** Until the fork tags a release, the engine may be pinned to a commit of the fork's `improve/integration` branch, as it is now, to test the fork's fixes against this class early. Such a build is for compatibility testing only and must never be declared: declaration requires the engine re-pinned to a tagged fork release with a published SHA-256 (the release gate, issue #12), which gives a new `version()`.
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

   The first `grep` expects the JSON to write `/` unescaped, as the consumer layout does. The gzip tag is the page's first: `PAGE` comes before all per-token data, so text in the art cannot take its place. Python's standard library parses the JSON properly, and `gzip.decompress` checks the gzip CRC-32 and length:

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

   For the current version, all three print the gzip payload's SHA-256 `dec711614d61133881b642bc93829a26a7ac1cc8b7b34e5dd25f4f2482aa5d63` (10,406 bytes) and the engine's `b49e8ceb802b7665cd6f66100dc390874c806a8894be464273d43c532940fc55` (36,960 bytes).
3. **Compare.** The engine's SHA-256 must equal the class's `script_sha256()` (the hex form of the `u256` is the `sha256sum` string; a consumer contract or its tests can read it) and the `script_sha256()` column of [Versions](#versions), in the row of the class's `version()`. The gzip payload's SHA-256 and length must match that row too.
4. **Optionally, rebuild the engine** from the fork commit in that row. The fork commits its minified build, and rebuilding it from the source reproduces it:

   ```sh
   git clone https://github.com/Provable-Games/webaudio-tinysynth && cd webaudio-tinysynth
   git checkout 4b29ff10d40989fd97967ed26ee4b2c95dbd8a26
   sha256sum webaudio-tinysynth.min.js   # the committed build
   npm ci && npm run verify              # rebuilds it and compares the bytes
   ```

   The fork pins its build: Terser 5.51.2 exactly, in its `package.json` and `package-lock.json`, with every option in `scripts/build.js`. `npm run verify` rebuilds the minified file and its source map into a temporary directory, fails on any byte difference from the committed files, and prints their SHA-256 (`npm run build` rebuilds them in place instead). A tagged fork release with a published SHA-256 is roadmap phase 0.
5. **Optionally, check the rest of the page and the class.** `verify_engine.mjs` also prints the SHA-256 and length of the fixed page `PAGE` (the decoded page up to the opening tag of the settings block and its alignment spaces), which [`scripts/page_versions.json`](scripts/page_versions.json) records for every `version()`. A matching `PAGE` also proves that the payload you hashed sits in the page's own engine tag, the one that runs, and that the shim and the player around it are the class's. To check the class itself, check out this repository at the row's release tag, rebuild the page with `npm ci && npm run check:page` (the pinned Terser and fflate; it fails on any difference from the committed `PAGE` and `src/page_data.cairo`), run `scarb build`, compute the class hash (for example with `sncast utils class-hash --contract-name OnchainTinySynth`, the class `onchain_tinysynth::contract::OnchainTinySynth`), and compare it with the row's class hash.

## Versioning

Class hashes are immutable. The engine and the player page are stored in the class when it is declared, so they are fixed per class version: a given class hash, called with the same MIDI and `SynthSettings`, always produces the same output and sound. Sound settings and custom sounds come from the consumer on each call, so they can change without a new class. A new engine or page means a new class hash and a new `version()` string. Consumers choose when to switch by updating the class hash they store; old tokens rendered with an old class hash keep working. The versions and their hashes are listed in [Versions](#versions).

## Versions

The class is declared but never deployed, so block explorers cannot call it (`starknet_call` needs a contract address): `version()` and `script_sha256()` cannot be read there. This table is how collectors find these values for a class hash; [Verifying the engine](#verifying-the-engine) checks a token against them.

| `version()` | Class hash (Sepolia) | Class hash (mainnet) | Release tag | `script_sha256()` (decompressed engine) | Gzip payload SHA-256 / length | Engine fork commit |
| --- | --- | --- | --- | --- | --- | --- |
| `tinysynth-4b29ff1+page.7` | **not for declaration** (interim) | **not for declaration** (interim) | none: **interim**, not a release | `b49e8ceb802b7665cd6f66100dc390874c806a8894be464273d43c532940fc55` | `dec711614d61133881b642bc93829a26a7ac1cc8b7b34e5dd25f4f2482aa5d63` / 10,406 bytes | [`4b29ff1`](https://github.com/Provable-Games/webaudio-tinysynth/commit/4b29ff10d40989fd97967ed26ee4b2c95dbd8a26) on the `improve/integration` branch of [Provable-Games/webaudio-tinysynth](https://github.com/Provable-Games/webaudio-tinysynth): **interim** (`improve/integration` commit, not a release; not for declaration) |
| `tinysynth-4b29ff1+page.6` | **not for declaration** (interim) | **not for declaration** (interim) | none: **interim**, not a release | `b49e8ceb802b7665cd6f66100dc390874c806a8894be464273d43c532940fc55` | `dec711614d61133881b642bc93829a26a7ac1cc8b7b34e5dd25f4f2482aa5d63` / 10,406 bytes | [`4b29ff1`](https://github.com/Provable-Games/webaudio-tinysynth/commit/4b29ff10d40989fd97967ed26ee4b2c95dbd8a26) on the `improve/integration` branch of [Provable-Games/webaudio-tinysynth](https://github.com/Provable-Games/webaudio-tinysynth): **interim** (`improve/integration` commit, not a release; not for declaration) |

- The hashes and the length are the build's, from [`src/page_data.cairo`](src/page_data.cairo) (`VERSION`, `ENGINE_SHA256`, `GZIP_SHA256`, `GZIP_LEN`); `npm test` fails if the row for the current `version()` disagrees with them. The SHA-256 of the whole `PAGE` for each `version()` is in [`scripts/page_versions.json`](scripts/page_versions.json).
- **A row is final only once its class is declared.** The class hash covers the class's Cairo code as well as the page. That includes the base64 encoder dependency, game-components `v3.1.0` (commit `66ce934`, recorded in `Scarb.lock`). So the class hashes and the tag are filled in at declaration (roadmap phase 6), and until then the row can still change: a different encoder build changes the class hash, and a re-pinned engine or a new page changes `version()` and the hashes. Once declared, a row never changes.
- **`tinysynth-4b29ff1+page.7` is interim** (`improve/integration` commit, not a release; not for declaration). It pins the engine to a commit of the fork's `improve/integration` branch to test the fork's fixes against this class early (see [Engine provenance](#engine-provenance-and-verification)). Its class must never be declared: the release gate (issue #12) requires the engine re-pinned to a tagged fork release, which gives a new `version()`.
- **Why `page.7`:** the page's parser bounded counts by the class's old caps (32 timbres, 16 waves, 64 harmonics, 256 samples). It now bounds them only by the format: 175 timbres and 256 waves, and no bound on a wave's length, as the engine takes any (fork decision D-028). It also checks every count against the input left. The class accepts the same, and no longer caps `SETTINGS` length or range-checks reverb, master volume, the top of `voices` or the operator values. Its caps are separate constants from the page's bounds, so changing a cap within those bounds will not need a new page.
- `tinysynth-4b29ff1+page.6`, the same engine with the previous page, was the interim build before. Its page rejects the counts above its old caps, so it is superseded. Like every interim row, it was never declared.
- `page.1` to `page.5` were development builds of the page, and `tinysynth-b70ba90+page.6` the same page with the engine at fork commit `b70ba90` (`script_sha256()` `5aa3edbc13371694a83ec0f285a5d39d4e4a31b18a259c0bbdcbd5969f710c2c`, gzip payload `4b3a12672d2580f11f324e27b65d804ae94ca38665c4b9f588e3109cb0b4945e` / 9,862 bytes). None was declared.

## Deployments

Where the class and the example are declared or deployed. A consumer stores a class hash from this table; [Versions](#versions) gives each `version()`'s hashes, and [Verifying the engine](#verifying-the-engine) checks a token against them.

| Network | What | Class hash | Contract address | Built from | Status |
| --- | --- | --- | --- | --- | --- |
| Sepolia | `OnchainTinySynth`, `version()` `tinysynth-4b29ff1+page.6` | `0x442cab13e9049a2eed9e508273ccfad626e690da394de58ba4f62d675b4f85a` | `0x064b629e081c108fef2a39fbd314a792d78be06339a6edc32c397bb7e8aab97d` (inspection instance) | [`d735793`](https://github.com/Provable-Games/onchain-tinysynth/commit/d7357936754b5753ee4e9cc9134a0d373b75c099) | **INTERIM**: engine `4b29ff1`, `page.6`, not for production; superseded by `page.7` once [#28](https://github.com/Provable-Games/onchain-tinysynth/pull/28) merges, redeploy pending |
| Sepolia | Example `BeastLikeNft` ([`examples/beast_consumer`](examples/beast_consumer)), library-calling the class above | `0x7f290530571bdfd547b05125ff87ac54b5b395f580e41c64226e06f3a3b725c` | `0x066dd6aa3b669e66df4cf6fc74cf18a335a95268154292e44ea0c59227caea92` | [`d735793`](https://github.com/Provable-Games/onchain-tinysynth/commit/d7357936754b5753ee4e9cc9134a0d373b75c099) | **INTERIM** test consumer of the `page.6` class, not for production; redeploy pending with `page.7` |
| Sepolia and mainnet | Release `OnchainTinySynth` | not declared yet | | | |

- **Interim.** The Sepolia class was declared only to test explorers and RPC providers against a real class (issue [#12](https://github.com/Provable-Games/onchain-tinysynth/issues/12)). The Versions table's "not for declaration" means not as a release: the release class needs the engine re-pinned to a tagged fork release, which gives a new `version()` and class hash.
- **Built from** is the commit to rebuild each class from. It predates `npm run preview` and the agent skills: run those from the newest commit with the same `VERSION` (see [Agent skills](#agent-skills)).
- **The inspection instance** is a deployment of the class (no storage, no constructor), so explorers and RPC can call `version()`, `script_sha256()` and `license()`. Consumers still `library_call` the class hash.
- **RPC providers** (issue [#11](https://github.com/Provable-Games/onchain-tinysynth/issues/11)). Through zan.top, Cartridge and dRPC, all four example tokens came back byte-identical to the JS reference. PublicNode served tokens 1–3 but reverted `Out of gas` on token 4, the full-size Beast (about 286.5M L2 gas). Providers cap `starknet_call` gas differently: check a full-size token through the providers your marketplaces and indexers use.

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
npm run check-midi -- song.mid   # check MIDI files against the page's MIDI contract
npm run preview -- song.mid      # write (and optionally serve) the page a token with that MIDI gets
PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core PLAYWRIGHT_BROWSER=chromium \
  npm run render-check   # optional: render the reference timbres in a headless browser
PLAYWRIGHT_CORE=... PLAYWRIGHT_BROWSER=firefox npm run page-check   # optional: the page; chromium, firefox or webkit
PLAYWRIGHT_CORE=... PLAYWRIGHT_BROWSER=webkit npm run drift-check -- --minutes 10   # optional: art against sound over a session
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
- the decoded `animation_url` HTML (`PAGE ++ D ++ SVG`) and the consumer-layout `token_uri`, as length and SHA-256. They are 25-60 KB each and fully determined by stored pieces, so they are pinned by digest rather than stored. The example's three tokens hold complete `token_uri` goldens.

Per invalid case: the settings and the panic data `midi_segment` must revert with. `tests/page_fixtures.cairo` has the same data as Cairo functions, and the tests:
- `page_data` against the build: lengths, SHA-256 of the segment and the license, version, engine and gzip payload hashes;
- per valid case: `SETTINGS`; `midi_segment` byte for byte, called directly and through the library dispatcher on the declared class; the decoded HTML (`PAGE ++ D ++ SVG`) and the consumer-layout `token_uri`, rebuilt in Cairo ([`tests/helpers.cairo`](tests/helpers.cairo)), against their length and SHA-256;
- per invalid case: the revert with its exact panic data, directly and through the library call.

### Class size

The class compiled with Scarb 2.20.1, against [Starknet's current limits](https://docs.starknet.io/learn/cheatsheets/chain-info), with and without the encoder, and the page constants alone:

| | The class | The class without the encoder | Page constants only | Page constants only, `const` felt array (`page.6` before this class) | Limit |
| --- | --- | --- | --- | --- | --- |
| Sierra program | 17,625 felts | 12,705 felts | 7,671 felts | 4,369 felts | |
| Contract class as declared (Sierra, entry points, ABI) | 916,094 bytes (22% of the limit) | 627,921 bytes | 337,078 bytes | 191,246 bytes | 4,089,446 bytes |
| CASM bytecode | 28,912 felts (35% of the limit) | 17,764 felts | 5,490 felts | 2,563 felts | 81,920 felts |

- **The class** is `OnchainTinySynth` with the optimized encoder, at `page.7`. It is 16.6 KB, 283 Sierra felts and 530 CASM felts smaller than at `page.6` (932,702 bytes, 17,908 and 29,442 felts), which also checked the numeric ranges and the `SETTINGS` length. "Without the encoder" is the same class with `bytes_base64_encode` returning its input: the encoder adds 4,920 Sierra felts, 288 KB and 11,148 CASM felts. The byte-wise stand-in it replaced added 1,701 Sierra felts, 98 KB and 4,149 CASM felts (the whole class was then 727,248 bytes and 22,242 CASM felts). The optimized encoder costs about 190 KB more class size, for about 83% less gas per encoded byte.
- **Page constants only** is a stub class serving `animation_url_segment`, `script_sha256`, `version` and `license`. With the `b70ba90` engine, the string-literal segment cost about 130 KB and 2,700 CASM felts more than the `const` felt array, and saved 3.4M L2 gas on every call. The last column predates this class and has the `b70ba90` engine's 42,644-byte segment and the 4,104-byte `license()`. The page-constants column has the `page.6` build's 43,940-byte segment (`page.7`'s is 48 bytes longer) and the 6,417-byte `license()`, which adds the game-components notice and the `4b29ff1` fork NOTICE. With them the `page.6` class was 10.5 KB, 232 Sierra felts and 149 CASM felts larger than the `b70ba90` build (922,222 bytes, 17,676 Sierra felts and 29,293 CASM felts for the class).
- **The rest** of the class is the settings validation and encoding.
- The method: `contract_class.json` without debug info, and the `bytecode` of `compiled_contract_class.json`.

### Segment gas

The segment's size sets its cost at every step of a consumer's `token_uri`: the class materializes it, the library call returns it, the consumer appends it to its `ByteArray`, and `token_uri` returns it again. [`tests/test_page_gas.cairo`](tests/test_page_gas.cairo) (`snforge test gas_segment`) measures materializing and appending it, in L2 gas:

| | `page.5` (78,804 bytes), `const` array | `b70ba90+page.6` (42,644 bytes), `const` array | `b70ba90+page.6`, string literal | Now: `4b29ff1+page.7` (43,988 bytes), string literal |
| --- | --- | --- | --- | --- |
| Materializing `animation_url_segment()` | 6.83M | 3.70M | 0.28M | 0.29M |
| Appending it to a `ByteArray` with no pending bytes (word-aligned) | +4.00M | +2.16M | +2.16M | +2.23M |
| Appending it after the 29-byte `data:application/json;base64,` (unaligned) | +17.25M | +9.34M | +9.34M | +9.63M |
| The class's side of the library call that returns it (the example's gas report) | 10.82M | 5.86M | 2.44M | 2.51M |

The consumer's whole library call, including reading the result, is 6.4M (see [Gas and limits](#gas-and-limits)). The [Integration guide](#integration-guide) shows how a consumer lands the segment on a word boundary.

## Browser validation

Issue #11's automatable checks, on Playwright's Chromium 153, Firefox 155 and WebKit 26.6. They load the class's output: every golden case's `token_uri` is checked against the length and SHA-256 that snforge pins the class's output to, then decoded as a marketplace decodes it ([`scripts/fixture_pages.mjs`](scripts/fixture_pages.mjs)); the example decodes its tokens' `token_uri` (token 1 byte for byte the contract's, token 4 pinned by SHA-256). CI runs every check on every engine; it runs the drift check for 1 minute, with the art's drift printed rather than checked (`--drift-info`), because in a minute one audio-clock stall can exceed the limit while the page does nothing wrong.

| Issue #11 scope | Check |
| --- | --- |
| Chromium, Firefox and WebKit | the CI `browser` job: one leg per engine |
| Playback starts only on a tap; ▶/■ toggles | [`page_check.mjs`](scripts/page_check.mjs): `checkDataPage` (clicks), `checkTouch` (taps); `browser_check.mjs` |
| Seamless End-of-Track loop, correct tempo | `checkLoop`: passes start `maxTick x tick2Time` apart, which must equal the pass length of the MIDI's own tempo map, to 1 µs; [`drift_check.mjs`](scripts/drift_check.mjs) for a whole session |
| The art restarts in sync on ▶ | `checkDataPage`: screenshots of a probe animation |
| Drift over a 10-minute session | `drift_check.mjs` (`npm run drift-check -- --minutes 10`): results below |
| Every failure path keeps the art, ▶ disabled | `checkFailures` (settings, MIDI), `checkEngineFailures` (gzip payload), `checkAudioFailures` (no Web Audio; `resume()` rejects); `browser_check.mjs` |
| No network requests; offline from `data:` and `file://` | every load (requests blocked and listed; for the gzip tag's `data:` URI, see [CI](#ci)); `checkDataPage`, `checkFile` |
| Sandboxed iframe, strict CSP, marketplace-style frames | `checkIframe`, `checkCsp` with `checkCspControl`, `checkEmbeds` (a `srcdoc` frame; the page re-served from another origin) |
| Offline renders of the reference timbres | [`render_check.mjs`](scripts/render_check.mjs) |
| Settings at their extremes play without an error | `checkExtremes`: notes 0 and 127 on every custom timbre of the `max_fields` and `min_fields` cases; any error fails it, a non-finite `AudioParam` value included (see [Extreme operator values](#extreme-operator-values)) |
| Which marketplaces render `data:` HTML; iOS Safari and Android Chrome; indexers, wallets and RPC providers on a full-size `token_uri` | manual |

Every check that CI runs passes on all three engines. The 10-minute drift check passes on WebKit and fails on Firefox and Chromium. Runs of the drift check at `9fb9a3b`, on `tinysynth-4b29ff1+page.6` (`page.7` has the same engine and changes only the settings parser), one engine at a time, on a shared 32-core Linux machine, the `beast_140bpm` page with a probe art that sweeps once per pass, a checkpoint every 10 s:

| 10 minutes | Chromium 153 | Firefox 155 | WebKit 26.6 |
| --- | --- | --- | --- |
| The art's drift from the sound (trend; at most 20 ms) | +31.5 ms: fails | +59.9 ms: fails | -0.1 ms: passes |
| The art against the page clock (trend) | +1.8 ms | +94.6 ms | -0.2 ms |
| The audio clock against the page clock | -30.1 ms, in one stall at 7:56 | +35.4 ms (58 ppm) | -0.5 ms (-0.7 ppm) |
| Largest checkpoint distance from the trend (at most 20 ms) | 19.1 ms | 13.4 ms | 8.4 ms |
| Passes, none missing, on the tempo map's grid | 352, within 0.001 µs | 352, within 0.001 µs | 352, within 0.001 µs |
| Messages scheduled, none late; the smallest lead | 6,683; 84.5 ms | 6,683; 82.6 ms | 6,682; 47.8 ms |
| `outputLatency` | 32 ms | 48 ms | 0 |

Findings for the maintainer. Neither is a player bug, and the browser validation made no `PAGE` change:

- **On Firefox the art drifts against the sound: +60 ms over 10 minutes** (+62 ms in an earlier run), the art ahead. In headless Firefox the image's animation runs about 160 ppm fast against `performance.now()`, with or without audio, and the audio clock on the null sink about 60 ppm fast. The player syncs the art once per ▶, so the difference adds up, about 6 ms a minute (12 ms in a minute on CI's arm64 runner). Re-syncing the art on every pass would bound it to one pass; that is a `PAGE` change. Firefox on a real display is a manual check.
- **On Firefox, noise operators at a high frequency ratio play slower than real time.** The `max_length_settings` golden case of `page.6` (88 noise operators at `ratio` 64x) rendered at 0.12x real time: its audio clock runs at an eighth of real time, so the music is slow and broken up. With `ratio` 1x it rendered in real time, and Chromium and WebKit rendered all nine golden cases in real time. Whether to cap the ratio in `settings::validate`, fix it in the engine, or accept it is open; CI does not check it.

Known limitations:

- **The audio devices are virtual.** Chromium's headless shell and WebKit clock their audio themselves, and Firefox plays to a PulseAudio null sink. So the drift check measures the page and TinySynth against those clocks, not a sound card's. A consumer sound card's sample clock is commonly tens of ppm off the system clock, and since the art is synced once per ▶, 50 ppm would move the art 30 ms over 10 minutes. Real hardware is a manual check.
- **Chromium's headless audio clock stalls.** In each of three 10-minute runs it fell behind the page clock in steps, and the art stayed that far ahead of the sound: one 31 ms step at a load average of 2 to 4 (the run above; the offset was flat for the 8 minutes before it), one 30 ms step at 4 to 5 (art +44 ms), and 280 ms of steps while other jobs held the machine at 6.5 to 13.5 (art +379 ms). The art followed the page clock within 2 ms in the two runs that measured it, and the drift check prints the audio clock's largest step, which tells a stall from a page fault. A real device can underrun too, and the art then stays ahead by the stall.
- **WebKit reports `outputLatency` 0**, so on WebKit the drift and the restart are measured against the scheduled sound. Its `getOutputTimestamp().performanceTime` runs at twice the rate in this build, so the drift check samples `currentTime` against `performance.now()` itself.

## Roadmap

0. **Fork release with fixes** (in the `webaudio-tinysynth` fork): MIDI parser bounds fix (#4), pinned tagged build with a published SHA-256 (#5), deterministic reverb and noise buffers (#7), custom waveform API (#26) and per-operator filter (#27). Fractional tempo and `loopEnd` are already merged.
1. **Scaffold** (this): repository layout, toolchain, interface declarations, README.
2. **Player page JS** (done, issue #8): MIDI decode, tap-to-start, play/stop, End-of-Track looping, latency-compensated art restart, offline only.
3. **Offline build pipeline** (done, issue #9): verifies the pinned engine by SHA-256, gzips it (issue #14), assembles and aligns the page, and generates the pre-encoded Cairo constants plus golden fixtures (reference outputs for sample MIDI and art).
4. **Cairo class implementation** (done, issue #10): the class, `midi_segment`, `SynthSettings` validation and encoding (issue #1), byte-for-byte parity with the JS reference fixtures directly and through `library_call`, the example ported to the class, the optimized base64 encoder (`game_components_encoding`), and gas and class-size measurements.
5. **Browser validation** (issue #11): the automatable checks run in CI on Chromium, Firefox and WebKit; the 10-minute drift check passes on WebKit only (see [Browser validation](#browser-validation)). The marketplace survey, mobile, real hardware, and the service and RPC checks are manual.
6. **Docs and declaration**: finalize docs, declare on Sepolia, then on mainnet, and publish the class hashes.

## Open decisions

- **Custom waves and filters**: their types, ranges and encoding are fixed by issue #1, but accepting them, and their player side, belong to issues #2 and #3.

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE). The embedded TinySynth engine is also Apache-2.0: copyright Tatsuya Shinyagaito (g200kg), modified by Provable Games in <https://github.com/Provable-Games/webaudio-tinysynth>. The page's gunzip shim is derived from fflate, MIT License, Copyright (c) 2026 Arjun Barrett ([text](tests/vendor/fflate-0.8.3.LICENSE)). The class's base64 encoder is the `game_components_encoding` package of [game-components](https://github.com/Provable-Games/game-components), MIT License, Copyright (c) 2026 Provable Games ([text](tests/vendor/game-components.LICENSE)). `license()` includes all four notices.

The Beast and MIDI test fixtures are Apache-2.0 as well. The Beast SVG in [`tests/fixtures/beasts/`](tests/fixtures/beasts/README.md) is Beasts artwork that Provable Games licenses under Apache-2.0 for this repository, and the MIDI scores in [`tests/fixtures/midi/`](tests/fixtures/midi/README.md) are synthetic, generated by `scripts/gen_midi_fixtures.mjs`. Neither is part of the class.

## Examples

- [`examples/beast_consumer`](examples/beast_consumer): a runnable end-to-end example of a Beasts-style NFT assembling its `token_uri` with library calls to this class (declared, never deployed), word-aligned, with golden fixtures and decoded output, and a full-size Beast token (a real Beast SVG and a synthetic score of the largest production size) for the full-size gas measurement.

## Agent skills

Four skills help AI agents working in other repositories, such as an NFT contract, integrate the player and drive it with MIDI. They live in [`plugins/onchain-tinysynth/skills/`](plugins/onchain-tinysynth/skills), summarise this README and link to it, and never hardcode class hashes: they point to [Deployments](#deployments).

| Skill | For |
| --- | --- |
| [`integrator-guide`](plugins/onchain-tinysynth/skills/integrator-guide/SKILL.md) | Adding the player to a contract's `token_uri`: the library dispatcher, holding the class hash, the `token_uri` layout, the art rule, snforge tests, gas and RPC caps |
| [`midi-guide`](plugins/onchain-tinysynth/skills/midi-guide/SKILL.md) | Writing MIDI for the player: previewing offline, where it differs from standard MIDI players, every `checkMidi` rule, keeping the music in sync with the art |
| [`sound-design`](plugins/onchain-tinysynth/skills/sound-design/SKILL.md) | The `SynthSettings` a contract passes: engine settings, custom timbres, `'TS: …'` errors, building settings in Cairo |
| [`token-uri-inspector`](plugins/onchain-tinysynth/skills/token-uri-inspector/SKILL.md) | Fetching, decoding, verifying, rebuilding and viewing a deployed or local `token_uri`, and checking RPC call caps |

**Install in Claude Code.** While this repository is private, installing the plugin and cloning it for the tools need GitHub access to it. The repository is a plugin marketplace ([`.claude-plugin/marketplace.json`](.claude-plugin/marketplace.json)) with one plugin, `onchain-tinysynth`. In the other project:

```sh
claude plugin marketplace add Provable-Games/onchain-tinysynth    # or Provable-Games/onchain-tinysynth#<tag> to pin a ref
claude plugin install onchain-tinysynth@onchain-tinysynth --scope project
```

Inside a session, `/plugin marketplace add Provable-Games/onchain-tinysynth` and `/plugin install onchain-tinysynth@onchain-tinysynth` do the same. The skills then run as `/onchain-tinysynth:midi-guide` and so on, and Claude loads them when a task matches. To offer them to everyone who opens the project, commit this to its `.claude/settings.json`. Claude Code prompts each collaborator to install plugins from a marketplace the project declares, and a plugin like this one, kept inside its marketplace, then loads without a per-user install. Cloud sessions skip project marketplaces: they never show the workspace trust dialog.

```json
{
  "extraKnownMarketplaces": {
    "onchain-tinysynth": { "source": { "source": "github", "repo": "Provable-Games/onchain-tinysynth" } }
  },
  "enabledPlugins": { "onchain-tinysynth@onchain-tinysynth": true }
}
```

The plugin sets no `version`, so Claude Code versions it by commit: `claude plugin update onchain-tinysynth@onchain-tinysynth` brings the latest skills (auto-update is off by default for third-party marketplaces).

**Without Claude Code.** Each `SKILL.md` follows the open [Agent Skills](https://agentskills.io/specification) format (YAML frontmatter with `name` and `description`, then Markdown), so any agent can read the files. Copying a skill folder into another agent's skills directory, or into a project's `.claude/skills/`, also works; copy the whole `skills/` folder to keep the links between skills.

**The tools the skills use** (`check-midi`, `preview`, `verify_engine.mjs`, the example's `decode.mjs`, and the skills' helper scripts) need Node 22 or later and a clone whose `PAGE` is the class's: `grep 'pub const VERSION' src/page_data.cairo` must print the class's `version()`. Every commit with the same `VERSION` has the same `PAGE`, byte for byte (the build fails if `PAGE` changes under a `VERSION` recorded in [`scripts/page_versions.json`](scripts/page_versions.json)), so use the newest such commit: `main` while its `VERSION` matches, otherwise the last commit before `VERSION` changed (`git log --oneline -- src/page_data.cairo`). A class's "Built from" commit in [Deployments](#deployments) is for rebuilding the class and can predate the tools. None of the tools needs `npm ci`, and the helper scripts use Node built-ins only.

**Drift guards.** [`scripts/skills.test.mjs`](scripts/skills.test.mjs), run by `npm test`, checks that the frontmatter and the plugin manifests follow the formats, that every README anchor and repository path the skills link to exists, that the MIDI reference lists every `checkMidi` message, that the operator table matches the validator, that every gas figure in the skills appears in this README, that the skills name the settings limits by their `src/settings.cairo` constants rather than as numbers, and that they hardcode nothing a re-pin changes (`VERSION`, the engine commit, page and segment sizes, long hex hashes). The AI reviewers (see [CI](#ci)) catch drift in meaning: they report a skill that a pull request makes wrong or incomplete as a finding, and end every review with non-blocking suggestions for refining a skill or adding one.

## CI

GitHub Actions runs on every pull request and on pushes to `main`, on `ubuntu-24.04-arm`, with every action pinned to a commit SHA ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)):

| Job | What it checks |
| --- | --- |
| `cairo` | Scarb 2.20.1 and snforge 0.64.0 from `.tool-versions`: `scarb fmt --check`, `scarb build` and `snforge test` at the root and in `examples/beast_consumer`; the Scarb lockfiles stay unchanged |
| `javascript` | Node 24: the example's Node tests; `npm ci` (when `package-lock.json` exists) and `npm test` when the root `package.json` has a `test` script; `tsc --checkJs` on `player/` when it exists |
| `generated` | Reruns `scripts/gen_midi_fixtures.mjs` (the synthetic scores) and the example's `gen_fixtures.mjs`, then `npm run check:settings` and `npm run check:page` (the engine hash, the page, `src/page_data.cairo` and the page fixtures) when those scripts exist, then fails on any diff |
| `browser` | Passes when all three engine legs pass. Each leg, `browser (chromium)`, `browser (firefox)` and `browser (webkit)` (fail-fast off), installs that Playwright browser (for Chromium, its headless shell) with its system libraries, then runs the example's `browser_check.mjs` and, when those scripts exist, `npm run render-check`, `npm run page-check` and a 1-minute `npm run drift-check -- --drift-info`, with `PLAYWRIGHT_BROWSER` set to its engine. The Firefox leg first starts PulseAudio with a null sink: Firefox runs an `AudioContext` only with an audio output device, and the runner has no sound card |

The browser checks are the same on every engine but one: that the gzip tag's `data:` URI is never fetched shows directly only through Chromium's DevTools protocol, because Playwright's request events, `route()` and Resource Timing skip `data:` URLs on every engine. On Firefox and WebKit, `page-check` and `browser_check.mjs` print `skip` for that check on each load. `page-check` proves it on every engine another way: its strict-CSP load reports no violation, although the CSP blocks `data:` scripts, and a control page under the same CSP shows that the engine reports a violation for a plain `<script src="data:...">`. The checks also turn off Firefox's tab icons (`browser.chrome.site_icons`): Firefox fetches `/favicon.ico` for every http(s) page by itself, and the page never asks for it.

The optional steps switch on by themselves when the root `package.json`, its scripts or `player/` exist ([`.github/scripts/ci-detect.sh`](.github/scripts/ci-detect.sh)). TypeScript, `@types/node` and `playwright-core` are pinned in [`.github/ci-tools`](.github/ci-tools); Dependabot updates them and the actions monthly.

Codex and Claude review each same-repository pull request ([`.github/workflows/codex-review.yml`](.github/workflows/codex-review.yml), [`claude-review.yml`](.github/workflows/claude-review.yml)) and post one comment each. A HIGH or CRITICAL finding fails that provider's `… review gate` check. The reviewers also check the [agent skills](#agent-skills) against each change, and end every completed review with non-blocking skill suggestions (or `none`), which never affect the gate. Fork and Dependabot pull requests get no review credentials, so their gates fail with a request for manual review. Both reviews are static: they cannot build, test or reach the network, which the checks above cover, so the setup job fetches the head's Scarb dependency sources (without building anything) for the reviewers to read. `Review helper tests` checks the review scripts and lints every workflow. Setup, the trust model and the policies are in [`.github/scripts/README.md`](.github/scripts/README.md). The reviews need these secrets and Actions variables (organization or repository level); without them a review is skipped with a warning:

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
(cd .github/ci-tools && npx playwright-core install --only-shell chromium && npx playwright-core install firefox webkit)   # add --with-deps for system libraries
export PLAYWRIGHT_CORE="$PWD/$T/playwright-core"
for PLAYWRIGHT_BROWSER in chromium firefox webkit; do   # the browser checks, on each engine
  export PLAYWRIGHT_BROWSER
  (cd examples/beast_consumer && node scripts/browser_check.mjs)
  npm run render-check
  npm run page-check
  npm run drift-check -- --minutes 1 --drift-info
done

# Review helpers
python3 -I -B -m unittest discover -s .github/scripts -p 'test_*.py'
```

`PLAYWRIGHT_BROWSER` is `chromium` when unset. Firefox needs an audio output device: on a machine without one (a container or a server), start PulseAudio with a null sink first, as CI does (`pulseaudio --start --exit-idle-time=-1 && pactl load-module module-null-sink && pactl set-default-sink null`). To use a Chromium you already have, set `CHROME=/path/to/chrome-headless-shell` (and `LD_LIBRARY_PATH` if it needs extra libraries) instead of installing one; it applies only to `chromium`.
