# `token_uri` layout and the player page

How a consumer builds a `token_uri` around the class's pieces, and what the page does in the browser. The interface and its byte formats are documented in [`src/interface.cairo`](../src/interface.cairo). [`examples/beast_consumer`](../examples/beast_consumer) builds exactly this layout against the class.

## Output format

The output uses standard nested base64 data URIs:

- `token_uri` is `data:application/json;base64,` followed by the token JSON.
- The JSON's `animation_url` is `data:text/html;base64,` followed by the HTML page.
- The HTML page is the engine (gzipped, with a gunzip shim that inflates it in the browser), the player, the token's settings and MIDI (in inert text blocks), and the token's SVG art (in an inert text block, shown through an `<img>`).

The class is called with `library_call` from the consumer's contract. It is never deployed, so RPC nodes and explorers cannot call it directly. It has no storage, so it reads and writes nothing in the caller's context. Invalid settings revert with a `'TS: ...'` short string followed by the offending indices; through a library call the panic data arrives whole, followed by `'ENTRYPOINT_FAILED'`.

## Pre-encoding the fixed page

The engine and the player are the same for every token. The class stores them already base64-encoded at both layers, computed offline, and the consumer splices them in. This relies on the base64 identity

```
b64(X ++ Y) == b64(X) ++ b64(Y)    when len(X) % 3 == 0
```

With aligned pieces, only per-token data (MIDI, settings, art, JSON members) is encoded at call time, and the result is still ordinary standard base64 that any decoder accepts. The engine is never encoded onchain.

## Consumer `token_uri` layout

The consumer builds the JSON itself, and pads with spaces between JSON tokens so that each piece starts on a 3-byte boundary:

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
- `midi_segment(midi, settings)` = `b64(b64(D))`, with `D = SETTINGS '</script><script type="text/plain" id="midi">' b64(midi) <pad> '</script><script type="text/plain" id="art">'`. `SETTINGS` is the ASCII encoding of the `TinySynthSettings` value (see [Sound settings](sound-settings.md#the-settings-format)).
- `S = svg_b64 '"' <pad>` is encoded once and used twice. The first time it is the `image` value. The second time, at the HTML layer, it is the tail of the `animation_url` base64 stream: `svg_b64` decodes to the raw SVG, which becomes the contents of the open art block, and the `"` closes the `animation_url` string. So the SVG must never contain `</script` (see [Art (SVG) requirements](#art-svg-requirements)).

Decoded, the `animation_url` value after its `data:text/html;base64,` prefix is `b64(PAGE) ++ b64(D) ++ svg_b64`, which is standard base64 of `PAGE ++ D ++ SVG`. Since `svg_b64` ends that stream, it may end with `=` padding. `b64(PAGE)` and `b64(D)` are mid-stream and unpadded.

## Alignment

**Base64 alignment (required).** Every piece passed to `base64`, except the final `'}'`, must be a multiple of 3 bytes long. Otherwise the encoder emits `=` padding mid-stream and the concatenation is no longer valid base64. The consumer pads with spaces between JSON tokens. The class pads `PAGE` and `D` itself, to multiples of 9, because its pieces sit at both layers: 3-alignment at the HTML layer, and `len(b64(X)) = 4·len(X)/3` must also be a multiple of 3 at the JSON layer. The 39-byte `"animation_url":"data:text/html;base64,` prefix is already a multiple of 3.

**Word alignment (optional, saves gas).** A Cairo `ByteArray` stores 31-byte words. `append` onto a `ByteArray` whose length is a multiple of 31 copies whole words. At any other length it splits every word of the appended piece in two, which costs about 4x as much. Measured in L2 gas:

| Append | Word-aligned | Unaligned |
| --- | --- | --- |
| The 53,476-byte `animation_url_segment()` | 2.7M | 11.7M |
| Every append of the example's full-size token: two 40,420-character `b64(S)`, the segment, `midi_segment` and the small pieces | 16.4M | 32.6M |

The consumer chooses where its large pieces land by adding spaces between JSON tokens, 3 at a time. Three spaces are one 3-byte group, so they keep every piece a multiple of 3, and they encode to the constant `'ICAg'`, so they are never encoded at call time. It does this in two places:

- **Before `"image"`, so the first `b64(S)` is aligned.** The consumer encodes `'{' members ',' <pad>`, appends `'ICAg'` until the length plus 48 is a multiple of 31, then the 48-character constant `b64(' "image":"data:image/svg+xml;base64,')`. The image key, with one space in front, is a piece of its own: it is 36 bytes, a multiple of 3.
- **After the comma before `"animation_url"`, so the segment is aligned.** The consumer appends `'LCAg'` (`b64(',  ')`), then `'ICAg'` until the length is a multiple of 31.

At most 30 groups are needed in each place (120 characters), and the decoded JSON only gains insignificant whitespace. `midi_segment` and the second `b64(S)` cannot be aligned this way: they follow the segment directly at both layers.

## Building `token_uri` in Cairo

The layout above, with word alignment:

```cairo
use onchain_midi_player::interface::{
    IOnchainTinySynthDispatcherTrait, IOnchainTinySynthLibraryDispatcher,
};
use onchain_midi_player::types::TinySynthSettings;

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
    settings: TinySynthSettings,
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

**MIDI and settings** come from wherever the collection keeps its sound: constants in the NFT or its renderer, as in the example, or a composer's contract that implements `ISoundProvider` (see [Sound provider interface](sound-provider.md)).

**Your own encoder.** You may use your own encoder instead of the class's `base64`, if it produces standard RFC 4648 output. A copy compiled into your contract also avoids passing the data through the library call: for a 22.7 KB SVG that saves about 7.4M L2 gas (75.2M instead of 82.6M). It adds the encoder's size to your class (see [Class size](development.md#class-size)).

## Art (SVG) requirements

The consumer's SVG must never contain `</script`, in any letter case.

- **Why.** In the `animation_url` page, the SVG is the raw contents of the final `<script type="text/plain" id="art">` block, which stays open until the end of the document. The HTML parser ends that block at the first `</script`. The art is cut short there, the player's `<img>` gets a truncated SVG and shows a broken image, and the rest of the SVG leaks into the page as markup. The `image` member still decodes to the whole SVG, so marketplaces' image views do not show the failure.
- **In practice.** No `<script>` elements in the SVG, and no comments or CDATA sections containing `</script`. Nothing else needs care: SVG is XML, so any `<` in text content is already escaped as `&lt;`. You lose nothing, because scripts inside an SVG never run when it is shown through `<img>`, which is how both this page and marketplaces' `image` views show it.
- **Test it in your contract.** The class never sees the SVG: it returns the pieces around it, and you splice the art in. So the rule belongs in your own tests, on your renderer's output. [`examples/beast_consumer`](../examples/beast_consumer) shows how: `assertArtSafe` in its scripts and `contains_script_end_tag` in its Cairo tests check the rendered SVG. A renderer built from fixed, reviewed literals and validated fields meets the rule by construction. In Beasts, for example, names are limited to `A-Z a-z 0-9`, space, `'` and `-`, and art URIs are strict base64.
- **`svg_b64`** is standard RFC 4648 base64 of the exact SVG bytes, with no line breaks. It may end with `=` padding, because it ends the HTML-layer stream. It is also the `image` value, so marketplaces and the page show the same bytes.

## The player page

`PAGE` is [`tests/fixtures/page.html`](../tests/fixtures/page.html), byte for byte: head and styles, the engine gzipped in a `<script type="text/javascript+gzip" src="data:text/javascript;base64,...">` tag, the gunzip shim, a small ▶/■ button, the player script, then the opening of the settings block. The per-token `D` and the SVG follow it. The shim inflates the engine while the page is parsed; the player ([`player/player.js`](../player/player.js) and [`player/settings.js`](../player/settings.js)) starts on DOMContentLoaded:

- **Art first.** It shows the art in an `<img>`, before and independently of the settings and the MIDI. The art fills the frame, and the button overlays the bottom-right corner.
- **Settings and MIDI.** It parses `SETTINGS` strictly, and checks the MIDI with the page's MIDI check (the [MIDI contract](midi-contract.md)). Range checks on the settings are the class's alone: the class validates them before writing `SETTINGS`.
- **Fail closed.** If the engine did not load, or on any settings or MIDI error, ▶ stays disabled, the exact error is shown at the bottom of the frame and in the button's title, and it is logged. The art stays: the player that shows it is not compressed, so it never depends on inflation.
- **▶** (a click or tap) creates the synth on the first press, resumes audio inside the gesture, plays the MIDI from tick 0, and loops at End-of-Track. It restarts the art when tick 0 is heard, using the engine's start time plus the audio output latency, so the browser starts the art's animation again in step with the sound.
- **Every pass** restarts the art the same way, so the art can drift from the sound only by what builds up within one pass. When the pass is a whole multiple of the art's period, the restart is not seen; otherwise the art jumps back to its start at every loop point.
- **■** stops playback, cuts every voice, and cancels a pending art restart. The art keeps running.
- **Safe to embed.** Plain JavaScript with no modules, no `eval`, no network requests, and no storage or cookies. It works in `<iframe sandbox="allow-scripts">` and under a CSP that allows only inline scripts and styles and `data:` images.

**The gzipped engine.** A browser neither runs nor fetches a `<script>` of an unknown type, so the `text/javascript+gzip` tag is just data, and its base64 payload cannot close the tag. The shim ([`player/gunzip.js`](../player/gunzip.js), derived from fflate) base64-decodes and gunzips it, checks the gzip CRC-32 and length, and replaces the tag with an inline `<script>`, which runs before the player's script is parsed. On any failure the shim leaves the tag, and the player fails closed.

**Browsers.** Firefox runs Web Audio only with an audio output device: without one, ▶ turns into ■ but nothing plays. WebKit reports an `outputLatency` of 0, so there the art restart includes only the engine's 100 ms scheduling offset. Audio can differ slightly across browsers and sample rates. The checks that CI runs on Chromium, Firefox and WebKit are in [Development](development.md#browser-validation).
