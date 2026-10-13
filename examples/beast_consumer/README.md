# Beast reference consumer

The NFT owns its complete document, SVG image, styles, title/favicon, controls, anchoring, controlled inline SVG timelines and background/media-session policy. Its generated `owned_assets.cairo` is separate from every TinySynth class constant. `assembly.cairo` directly splices standalone library fragments and runtime metadata/art/data using an encoder compiled into the consumer.

Metadata and initial document art use a complete encoded `<img>`. Only this contract's own renderer opts into `data-trusted-art="inline-svg"`: bootstrap imports trusted Genesis art as inline SVG, which animates from page load. Generic composition defaults to isolated images for arbitrary/community SVG. A failed library still leaves ordinary art visible.

The NFT-owned ▶/❚❚ button suspends/resumes the AudioContext through the public player API. Art sync is a small reference to copy, [`art_sync.js`](art_sync.js): the art is never scheduled, only seeked to the music's position when the player announces a moment. Trusted inline SVG runs freely until the initial pass event (the music is audible), then is seeked there and at each later pass, latency change and resume. A pause stays audible until its suspend completes: the art runs on, then freezes at the player's held audio position. Stop releases it to run freely, without a rewind. An isolated `<img>` can't be paused or seeked: it is restarted at each pass with a freshly decoded copy, up to one decode late, and keeps animating while paused. Optional notes, such as the prototype [`player/notes.js`](../../player/notes.js), may share the helper clock and transport controls; this example includes no notes and no dimming. The read-only `OnchainArtMonitor` samples drift and latency events without continuous correction. Its 17 ms display lead is the provisional lab setting, pending [#52](https://github.com/Provable-Games/onchain-midi-player/issues/52) hardware evidence.

The silent six-second WAV, iOS playback session, bitmap artwork and media handlers remain NFT policy. Media play resumes; both media pause and media stop pause, as explicitly selected in the prototype. Public player stop resets the score. Blocked blob media permits ordinary audio and pauses on hiding. Real mobile/route/lock-screen acceptance remains #52.

The independent multi-provider Cairo fixture lives in root tests: TinySynth supplies loader/combined player/data and `FixtureProvider` supplies a tiny named-export library. NFT code uses that export after readiness, and a dependent test block proves ordering. No p5.js implementation, integration or benchmark is included.

```sh
scarb build
snforge test
node scripts/gen_fixtures.mjs
node --test scripts/*.test.mjs
node scripts/browser_check.mjs
```

Tokens 1–3 have complete independent JS goldens; token 4 uses unchanged 22,733-byte Warlock art, 3,716-byte MIDI and reference sounds for full-size parity/measurement. That historical SVG embeds an animated GIF; neither SVG timeline control nor an image restart controls the GIF image clock, so use SMIL sprite animation for motion synced to the music. Synchronization acceptance uses outer and nested SVG/SMIL animations. `tests/naive.cairo` constructs equivalent complete HTML and performs runtime full-page encoding; direct splicing is the efficient recommended integration, while consumer re-encoding remains supported. See [layout](../../docs/token-uri-layout.md), [gas](../../docs/gas.md) and [validation](../../docs/development.md).
