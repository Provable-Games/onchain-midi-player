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
| The 59,220-byte `animation_url_segment()` | 3.0M | 12.9M |
| Every append of the example's full-size token: two 40,420-character `b64(S)`, the segment, `midi_segment` and the small pieces | 16.7M | 33.8M |

The consumer chooses where its large pieces land by adding spaces between JSON tokens, 3 at a time. Three spaces are one 3-byte group, so they keep every piece a multiple of 3, and they encode to the constant `'ICAg'`, so they are never encoded at call time. It does this in two places:

- **Before `"image"`, so the first `b64(S)` is aligned.** The consumer encodes `'{' members ',' <pad>`, appends `'ICAg'` until the length plus 48 is a multiple of 31, then the 48-character constant `b64(' "image":"data:image/svg+xml;base64,')`. The image key, with one space in front, is a piece of its own: it is 36 bytes, a multiple of 3.
- **After the comma before `"animation_url"`, so the segment is aligned.** The consumer appends `'LCAg'` (`b64(',  ')`), then `'ICAg'` until the length is a multiple of 31.

At most 30 groups are needed in each place (120 characters), and the decoded JSON only gains insignificant whitespace. `midi_segment` and the second `b64(S)` cannot be aligned this way: they follow the segment directly at both layers.

## Building `token_uri` in Cairo

The layout above, with word alignment:

```cairo
use onchain_midi_player::interface::{
    ITinySynthDispatcherTrait, ITinySynthLibraryDispatcher,
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
    let synth = ITinySynthLibraryDispatcher { class_hash: tinysynth };

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
- **Where the ▶/❚❚ button goes (optional).** The root `<svg>` may carry `data-play-anchor="X Y S"`: a point (X, Y) in the SVG's own units (its `viewBox`, else `width` and `height`), and optionally the button's diameter S in the same units. The page puts the button's bottom-right corner at the point, inset by max(S/8, 6) units (6 px without S), wherever the `<img>` draws the art (it follows the image's own box, on resize too). The diameter is S times the art's scale on screen, between 44 CSS px (a touch target) and 128; without S it is 48 px. The icon scales with it. The Beasts card (250×350 viewBox) uses `data-play-anchor="235 202 32"`: the bottom-right corner of its 220×144 art frame, `<rect x='15' y='58' width='220' height='144' rx='8'>`, which surrounds the 32×32 Beast drawn at (62, 66) to (190, 194); the 6-unit inset clears the frame's 8-unit rounded corner. A last word `top-right` (`"235 58 20 top-right"`) makes the point the button's top-right corner instead, inset the same way, with the button growing down and left from it. The mapping assumes the default `preserveAspectRatio` (`xMidYMid meet`) and, with a `viewBox`, a `width` and `height` (if any) of the same aspect ratio: the art scaled uniformly to fit and centred. Without the attribute, or with a malformed or out-of-range one (not two or three numbers, S not positive, the point outside the art), the button stays 40 px in the viewport's bottom-right corner.
- **`svg_b64`** is standard RFC 4648 base64 of the exact SVG bytes, with no line breaks. It may end with `=` padding, because it ends the HTML-layer stream. It is also the `image` value, so marketplaces and the page show the same bytes.

## The player page

`PAGE` is [`tests/fixtures/page.html`](../tests/fixtures/page.html), byte for byte: head and styles, the engine gzipped in a `<script type="text/javascript+gzip" src="data:text/javascript;base64,...">` tag, the gunzip shim, a small ▶/❚❚ button, the player script, then the opening of the settings block. The per-token `D` and the SVG follow it. The shim inflates the engine while the page is parsed; the player ([`player/player.js`](../player/player.js) and [`player/settings.js`](../player/settings.js)) starts on DOMContentLoaded:

- **Art first.** It shows the art in an `<img>`, before and independently of the settings and the MIDI. The art fills the frame, and the button overlays its `data-play-anchor` (see [Art (SVG) requirements](#art-svg-requirements)), else the bottom-right corner.
- **Settings and MIDI.** It parses `SETTINGS` strictly, and checks the MIDI with the page's MIDI check (the [MIDI contract](midi-contract.md)). Range checks on the settings are the class's alone: the class validates them before writing `SETTINGS`.
- **Fail closed.** If the engine did not load, or on any settings or MIDI error, ▶ stays disabled, the exact error is shown at the bottom of the frame and in the button's title, and it is logged. The art stays: the player that shows it is not compressed, so it never depends on inflation.
- **▶** (a click or tap) creates the synth (and builds its noise buffer) on the first press, resumes audio inside the gesture, plays the MIDI from tick 0, and loops at End-of-Track. It restarts the art when tick 0 is heard, using the engine's start time plus the audio output latency, so the browser starts the art's animation again in step with the sound.
- **Every pass** restarts the art the same way, so the art can drift from the sound only by what builds up within one pass. When the pass is a whole multiple of the art's period, the restart is not seen; otherwise the art jumps back to its start at every loop point.
- **❚❚** pauses: the `AudioContext` is suspended, so its clock stands still and every voice, envelope and scheduled event holds where it is; the next ▶ resumes it and the song carries on. Nothing is stopped or reloaded (to start over, reload the page). The art stands still with the music: ❚❚ restarts it at once with every SMIL animation that has no `begin` given `begin='-<p>s' repeatDur='<p+0.001>s' fill='freeze'` (p being the music's position in the pass), so it shows the frame at p, motionless; ▶ restarts it with `begin='-<p>s'` alone, so it runs on from there. Both are plain images, so this works in every engine and frame (a GIF in the art runs on, and starts at its first frame).
- **Background audio and media controls.** ▶ also plays a silent, looping 6-second `<audio>` element (a WAV the page generates, as a `blob:` URL), and ❚❚ pauses it. Browsers treat the page as a media player: Android Chrome and desktop browsers show media controls, and playback continues with the screen locked or the tab hidden. `navigator.mediaSession` carries the title (the art SVG's `<title>`, else "Onchain music"), artwork made of the art's own bitmap (the first embedded PNG, GIF or WebP): a static 512×512 and 256×256 PNG with the bitmap's square frames (a sprite sheet's, else its one frame) side by side in one centred row on the card colour `#1e1e22`, scaled up without smoothing to a whole factor (a 32×32 sprite is 5× at 512 and 2× at 256). The row stays in the middle band because Android 13+ crops the artwork to a wide panel, while iOS shows the whole square, and play, pause and stop handlers that do what ▶ and ❚❚ do (stop pauses too). Pausing from the notification, a headset or a call pauses the player. On iOS, `navigator.audioSession.type = "playback"` makes the sound ignore the silent switch. The synth still plays through the `AudioContext`, so latency and the art's sync are unchanged. The artwork is never animated (updating the metadata would flicker and cost battery). Art without an embedded bitmap gets a title only: the card SVG itself is never drawn to a canvas, because its `<foreignObject>` can taint it. All of this is best effort and fails silently: where the element cannot play (a host CSP without `media-src blob:`), the music still plays, but there are no media controls and playback stops when the page is hidden.
- **Safe to embed.** Plain JavaScript with no modules, no `eval`, no network requests, and no storage or cookies. It works in `<iframe sandbox="allow-scripts">` and under a CSP that allows only inline scripts and styles and `data:` images; add `media-src blob:` for the media controls and background playback.

**The gzipped engine.** A browser neither runs nor fetches a `<script>` of an unknown type, so the `text/javascript+gzip` tag is just data, and its base64 payload cannot close the tag. The shim ([`player/gunzip.js`](../player/gunzip.js), derived from fflate) base64-decodes and gunzips it, checks the gzip CRC-32 and length, and replaces the tag with an inline `<script>`, which runs before the player's script is parsed. On any failure the shim leaves the tag, and the player fails closed.

**Browsers.** Firefox runs Web Audio only with an audio output device: without one, ▶ turns into ❚❚ but nothing plays. WebKit reports an `outputLatency` of 0, so there the art restart includes only the engine's 100 ms scheduling offset. Audio can differ slightly across browsers and sample rates. The checks that CI runs on Chromium, Firefox and WebKit are in [Development](development.md#browser-validation).
