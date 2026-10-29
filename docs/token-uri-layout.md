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

Settings use the canonical [validated serialization](sound-settings.md). The class encodes MIDI bytes verbatim; strict [MIDI validation](midi-contract.md) runs in the browser before synth creation. Each data ID must occur exactly once across document elements and identify a complete HTML-namespace `script` with `type="text/plain"`; non-script/foreign-namespace collisions reject readiness. Inert template contents do not belong to the document.

The NFT's JSON opening includes its own metadata/image and `"animation_url":"data:text/html;base64,`. Its JSON-layer byte length before splicing is a multiple of three. It then appends independently double-encoded HTML fragments and finally its own encoded closing quote/brace:

```text
JSON data URI prefix
++ B64(NFT JSON opening, image, aligned animation_url prefix)
++ segment(NFT head)
++ gunzip_segment()
++ independent_provider.library_segment()    optional
++ player_segment()                          engine and headless API together
++ segment(NFT body/control markup)
++ segment(NFT image element)                may precede or follow data
++ midi_segment(midi, settings)
++ segment(NFT notes UI)                     optional, before the bootstrap
++ segment(NFT bootstrap and closing HTML)
++ B64('"}')
```

The reference reuses the already encoded metadata image attribute at the inner HTML base64 layer when building a complete isolated `<img>`, then applies its outer layer. This encodes the image attribute again for the HTML layer; the class-owned payload is not the only runtime encoding cost. The matched gas figures measure the complete assembly, without attributing its increase over the earlier whole-page layout to this pass alone. Its 93-byte opening tag prefix and separately padded closing pieces preserve both complete framing and concatenation alignment.

Direct splicing is the recommended efficient pattern. Consumers may decode fragments, reconstruct HTML and encode the result again if the resulting metadata/HTML is valid. The runtime full-page comparison supports this integration and measures its extra work. Generated metadata, art, settings and MIDI may be encoded at runtime; prepared token-specific constants may be pre-encoded.

## Shared loader and dependencies

HTML-namespace library data blocks use `type="text/javascript+gzip"`, unique IDs and `src="data:application/gzip;base64,PAYLOAD"`. The loader is an inline classic script with `id="onchain-gunzip"`. It exposes `window.OnchainLibraries.ready` synchronously, including before payload parsing, and inflates/executes actual selected script elements in document order after parsing. A repeated loader reuses readiness. Duplicate IDs among selected HTML gzip scripts reject before execution. SVG/MathML script decoys and template contents are excluded; HTML scripts inside SVG `foreignObject` remain candidates. Corruption, noncanonical base64, invalid UTF-8 and synchronous evaluation failures identify the affected library; independent remaining blocks still execute.

Readiness covers synchronous classic-script initialization. Each library remains responsible for any asynchronous work it starts. Parser-time ordinary scripts cannot assume gzip globals are already available.

The reference NFT awaits `OnchainLibraries.ready`, then `OnchainMidiPlayer.ready`, and keeps playback disabled if any library fails. This is its whole-composition policy: a partly initialized artwork should show its error rather than enable its normal controls. A different NFT can explicitly recover MIDI-only controls after an unrelated library fails, while leaving controls that need that library disabled. For example, in an async NFT bootstrap:

```js
try {
  await window.OnchainLibraries.ready;
} catch (error) {
  console.warn("Some artwork libraries failed", error);
}
const player = window.OnchainMidiPlayer;
if (!player) throw new Error("MIDI library did not load");
await player.ready; // MIDI/data failures still prevent playback.
const button = document.getElementById("midi-only-play");
button.onclick = () => player.play().catch(console.error);
button.disabled = false;
```

Global readiness settles after all selected blocks have been attempted, so this needs no per-library readiness framework. A successful MIDI API/data check does not establish that unrelated artwork initialized.

The delivered Cairo fixture calls TinySynth and a separate small fixture provider. Its `CompositionFixture.label()` export is used by NFT code; a dependent gzip block consumes that export. This proves generic independent-provider assembly and ordering. A future p5.js provider can use the same interface without MIDI-specific loader behavior; no real p5.js code or benchmark is included.

## Player events and NFT policy

The [headless API](../player/api.d.ts) supplies `ready`, `play()`, `pause()`, `resume()`, synchronous `stop()`, fresh `getPlayStatus()`, `onPassStart()` and `onStateChange()`. Readiness creates no audio or UI. Play starts tick zero or resumes a paused score. Pause suspends the AudioContext without reloading MIDI, rebuilding voices, restarting envelopes or changing the run ID; resume explicitly calls the engine's public `resume()`. The synth uses `autoResume: false`: scheduler sends cannot undo intentional or external suspension. Pending transport calls share a promise; stop/cancelled starts reject with `AbortError`. Stop cancels voices, timing and queued transport; the next play reloads tick zero. Initialization/audio failure is terminal; it rejects a pending `play()`/`resume()` with the failure cause and keeps the first error.

State is `loading`, `stopped`, `starting`, `playing`, `paused` or `failed`. External non-running audio freezes playback status and synced NFT visuals; an actual external resume updates the state. Status exposes `audioState`, scheduled `startTime`, fixed first-pass `originTime`, `audioTime`, `passSeconds`, estimated `positionSeconds`, raw validated `outputLatency`/`baseLatency`, shared `latencySeconds` and `latencyRevision`. Unavailable times are null. State subscriptions also receive accepted latency updates, even when the state name stays the same. Composers compare `state`, `runId` and `latencyRevision` rather than treating every snapshot as a new run. Captured callback transitions are delivered in order; subscription exceptions are isolated. Reentrant stop/pause commands win over stale async completions. Unsubscribe is idempotent.

All times use AudioContext seconds. The shared estimate is `outputLatency + baseLatency`: each component must be finite and in [0, 1] seconds, otherwise it contributes zero. The player polls every 250 ms and updates compensation for changes of at least 2 ms. Art, optional NFT-owned notes and pass events use this same estimate. Engine `startTime` can announce a scheduled future pass; pass events wait for the audio clock to reach `startTime + latencySeconds`. Initial events follow a successful start; subsequent missed/over-50-ms-late boundaries are skipped. Suspended audible position holds while current latency metadata continues updating; the latest compensation applies when the audio clock resumes. Pending audible boundaries survive pause and use current compensation after resume. Null-origin/tempo-only scores emit one immediate initial event and no fictitious recurring passes. Browser timers remain best effort.

The core owns no UI, art or media policy. The Genesis reference explicitly marks its NFT-owned body `data-trusted-art="inline-svg"`; its bootstrap decodes only that trusted art into inline SVG and syncs it with [`syncSvgToMusic`](../examples/beast_consumer/art_sync.js). The art is never scheduled: it animates from page load on the page clock, and every timeline (the root and each nested SVG) is seeked to the estimated audible position (`positionSeconds` plus the display lead, wrapped to one pass) only at moments the player announces. Once the run is audible (its initial pass event, or the audio clock past tick zero's audible start when that event never reaches the helper: mounted mid-run, or an earlier pass listener paused during it) the art is seeked and follows the music; each later pass, accepted latency change and resume seeks it again. Where the art belongs is worked out from `getPlayStatus()` each time, never from a notification's possibly out-of-date snapshot. Each seek reads `getPlayStatus()` at that moment, so a late event cannot misalign it. A pause stays audible until the AudioContext's asynchronous suspend completes, so the art runs on until an animation frame sees the suspended clock, then freezes and seeks to the held `positionSeconds` plus the display lead; an external suspension freezes at the same held position. Pause and resume before the music is audible leave the art animating freely, unless the audio clock passes the audible start before the suspend completes; the initial pass event still follows the resume. Stop, a new run or a failure release the art: it animates freely from where it is, without a rewind. The read-only `OnchainArtMonitor` records current/maximum drift, the alignment right after the initial pass seek, and latency events. Sampling never corrects drift: there is no periodic drift-correction configuration, checkbox or seek path.

SVG timeline control applies to SVG/SMIL animation. Embedded animated GIFs have an independent image clock: `pauseAnimations()` cannot freeze them and seeks cannot move them, in trusted and isolated art alike. Use SMIL sprite animation for motion synced to the music. The unchanged historical Warlock measurement fixture embeds a GIF, so it demonstrates composition and size parity rather than paused sprite animation. Browser synchronization acceptance uses explicit outer and nested SVG/SMIL timelines.

`REFERENCE_DISPLAY_LEAD_SECONDS = 0.017` is a provisional NFT reference value from the lab, pending physical display/audio validation in [#52](https://github.com/Provable-Games/onchain-midi-player/issues/52). It is separate from the engine and shared latency estimate and does not establish physical accuracy.

## Optional notes behind the art

The notes module, [`player/notes.js`](../player/notes.js), draws the token's MIDI as a piano roll on a canvas behind the art, from the MIDI, a canvas and a clock only. It is NFT-owned UI, never a class segment. The Beast reference ships it as its own fragment, [`notes.html`](../examples/beast_consumer/fixtures/notes.html): the module minified offline by `scripts/build_segments.mjs` (the class's Terser settings and unsafe-source check; `npm run check:segments` rejects drift) into one plain inline script, behind a license comment, that exposes `mount` and `cutout` as `window.OnchainMidiNotes`. The reference splices it after the data and before its bootstrap, each on a 31-byte word; it runs during parsing, before the bootstrap.

The bootstrap draws notes only when that global is present and the art's root `<svg>` has a child marked `data-notes-bg` (the opaque background the notes show through, such as the art frame's rect) with numeric `x`, `y`, `width` and `height`, and the root has a four-number `viewBox`. The box comes from that element and the units from the viewBox, so a change of card layout moves the notes with it. It then shows the page's own copy of the art with that background cut out (`cutout`; the metadata `image` is never touched), mounts the canvas just before the art, and passes the notes' `play/pause/stop` to `syncSvgToMusic` with its returned `clock()`: the notes stand still before the music is audible and after stop, scroll with it, and freeze where the audio stops, as the art does; under `prefers-reduced-motion` they stand still, and a hidden page draws no frames. Isolated `<img>` art gets the same transport from `syncSvgToMusic(null, player, { notes })`, which seeks nothing, while the image restarts at each pass from the cut-out copy (a percent-encoded `data:image/svg+xml,` URL). Without the fragment or the marker, or when `cutout` or `mount` throws (a MIDI the notes cannot read, say), the page has no canvas and plays exactly as it would without notes.

The fragment is plain rather than a gzip library. The shared loader would find a gzip block after the data, but only after parsing, when this bootstrap has already looked for the notes; and a library that fails to inflate or run rejects `OnchainLibraries.ready`, which this reference treats as a failed page. Plain, a failing notes script only leaves the global undefined. Gzip would store about 1.7 KB less of this fragment. No dimming policy is shipped here.

The reference's ▶/❚❚ button and media-session play action resume; media pause **and stop** preserve the approved prototype's pause policy. Public `player.stop()` remains a full transport reset. The silent background element pauses with audio; external element pause pauses the transport, and a hidden page without a playing background element pauses. Strict CSP can allow inline scripts/styles, `img-src data:` and `media-src blob:`. Trusted inline art with embedded data fonts also needs `font-src data:`; otherwise `default-src 'none'` blocks those fonts. Actual phones, routes and lock-screen behavior remain #52 device validation.

## Isolated community art

Use a complete `<img src="data:image/svg+xml;base64,...">` element. Original SVG bytes can remain unchanged, including script-like text; browser image isolation keeps that markup out of the parent document. An image can be neither paused nor seeked, so the reference restarts it instead with [`restartImgOnPass`](../examples/beast_consumer/art_sync.js): at the initial pass event and every later pass, the image's own data URL with a distinct `r=<n>` parameter (`data:image/svg+xml;r=<n>;base64,...`, the payload byte for byte; with notes, the page's cut-out copy, `data:image/svg+xml;r=<n>,...`) decodes afresh and replaces the image once loaded, unless a newer restart is already shown or the run changed. The restart lands up to one decode late, and the image keeps animating while paused. Independently align/encode the whole HTML representation so later scripts and closing HTML remain intact. Do not insert supplied SVG markup into the parent, or splice a padded final-image base64 shortcut in the middle of the HTML stream. The metadata image and the document's art are independent consumer choices.
