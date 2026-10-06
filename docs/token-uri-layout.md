# Composing a token URI

The NFT owns the document and metadata. The class returns only complete independently encoded fragments. No fragment contains a JSON member name, data URI prefix, document wrapper or tag that another provider must close.

Define `B64` as canonical RFC 4648 base64, counting UTF-8 **bytes**:

```text
segment(F) = B64(B64(F))
len(F) % 9 = 0
```

The splicing identity `B64(X ++ Y) = B64(X) ++ B64(Y)` holds when `len(X) % 3 = 0`. Two layers require nine-byte alignment. Ordinary whitespace goes outside completed elements, so both intermediate streams have no `=` padding. MIDI's own inner data base64 may contain `=`.

Fixed code is minified/compressed/encoded offline. Fixed MIDI-class fragments use raw 279-byte alignment (`9 * 31`), yielding returned lengths divisible by Cairo's 31-byte word size. Consumers align their returned-stream append positions with insignificant HTML whitespace; the [reference assembler](../examples/beast_consumer/src/assembly.cairo) tracks the actual ByteArray position and adds a pre-encoded nine-space fragment before large constants. [Measurements](gas.md) compare this with minimum nine-byte fixed padding. Dynamic data uses minimum nine-byte padding because encoding extra spaces has a measurable runtime cost.

The complete data fragment is exactly:

```html
<script type="text/plain" id="onchain-midi-settings">SETTINGS</script><script type="text/plain" id="onchain-midi-data">B64(MIDI)</script>ALIGNMENT_WHITESPACE
```

Settings use the canonical [validated serialization](sound-settings.md). The class encodes MIDI bytes verbatim; strict [MIDI validation](midi-contract.md) runs in the browser before synth creation. Missing or duplicate data blocks reject player readiness.

The NFT's JSON opening includes its own metadata/image and `"animation_url":"data:text/html;base64,`. Its JSON-layer byte length before splicing is a multiple of three. It then appends independently double-encoded HTML fragments and finally its own encoded closing quote/brace:

```text
JSON data URI prefix
++ B64(NFT JSON opening, image, aligned animation_url prefix)
++ segment(NFT head)
++ gunzip_segment()
++ engine_segment()
++ independent_provider.library_segment()    optional
++ player_segment()
++ segment(NFT body/control markup)
++ segment(NFT image element)                may precede or follow data
++ midi_segment(midi, settings)
++ segment(NFT bootstrap and closing HTML)
++ B64('"}')
```

The reference reuses the already encoded metadata image attribute at the inner HTML base64 layer when building a complete isolated `<img>`, then applies its outer layer. Its 93-byte opening tag prefix and separately padded closing pieces preserve both complete framing and concatenation alignment.

Direct splicing is the recommended efficient pattern. Consumers may decode fragments, reconstruct HTML and encode the result again if the resulting metadata/HTML is valid. The runtime full-page comparison supports this integration and measures its extra work. Generated metadata, art, settings and MIDI may be encoded at runtime; prepared token-specific constants may be pre-encoded.

## Shared loader and dependencies

Library data blocks use `type="text/javascript+gzip"`, unique IDs and `src="data:application/gzip;base64,PAYLOAD"`. The loader is an inline classic script with `id="onchain-gunzip"`. It exposes `window.OnchainLibraries.ready` synchronously, including before payload parsing, and inflates/executes actual selected script elements in document order after parsing. A repeated loader reuses readiness. Duplicate library IDs reject before execution. Corruption, noncanonical base64, invalid UTF-8 and synchronous evaluation failures identify the affected library; independent remaining blocks still execute.

Readiness covers synchronous classic-script initialization. Each library remains responsible for any asynchronous work it starts. A consumer bootstrap awaits `OnchainLibraries.ready`, then `OnchainMidiPlayer.ready`. Parser-time ordinary scripts cannot assume gzip globals are already available.

The delivered Cairo fixture calls TinySynth and a separate small fixture provider. Its `CompositionFixture.label()` export is used by NFT code; a dependent gzip block consumes that export. This proves generic independent-provider assembly and ordering. A future p5.js provider can use the same interface without MIDI-specific loader behavior; no real p5.js code or benchmark is included.

## Player events and NFT policy

The [six-member headless API](../player/api.d.ts) supplies `ready`, `play()`, synchronous `stop()`, fresh `getPlayStatus()`, `onPassStart()` and `onStateChange()`. A start before readiness rejects; concurrent starting calls share one promise and playing calls are idempotent. Stop invalidates pending starts with `AbortError`, cancels current/scheduled voices and event timers, and the next play reloads tick zero. Initialization/audio failure is terminal; subscription exceptions cannot restart or interrupt the player.

Status state is `loading`, `stopped`, `starting`, `playing` or `failed`. Tick, maxTick, startTime, audioTime and passSeconds are null until available. Output latency is finite/nonnegative, falling back to zero. Each run has a monotonically increasing ID. State callbacks emit on transitions without replaying history. Both subscription methods return idempotent unsubscribe functions.

Times are AudioContext seconds. Engine `startTime` may describe a pass scheduled ahead of audibility; the event waits for `startTime + outputLatency`. Initial notifications always follow a successful start; subsequent missed boundaries or notifications more than 50 ms late are skipped, preserving pass indices across short loops. Long delays wait until within setTimeout's range. Tempo-only scores with null engine startTime emit one immediate initial event and no fictitious recurring passes. Browser timers are best effort rather than sample-accurate.

The core owns no art, CSS, buttons, anchoring, title/favicon, background element, media-session handlers/artwork or visibility policy. The Beast-owned UI subscribes to events, safely replaces its image each pass, positions its own control, and implements the 0.4.0 media fallback. Strict CSP can allow inline scripts/styles, `img-src data:` and `media-src blob:`. Blocking blob media still permits ordinary Web Audio, with the reference stopping when hidden. Actual device lock-screen behavior remains separate device validation.

## Isolated community art

Use a complete `<img src="data:image/svg+xml;base64,...">` element. Original SVG bytes can remain unchanged, including script-like text; browser image isolation keeps that markup out of the parent document. Independently align/encode the whole HTML representation so later scripts and closing HTML remain intact. Do not insert supplied SVG markup into the parent, or splice a padded final-image base64 shortcut in the middle of the HTML stream. The metadata image and the document's art are independent consumer choices.
