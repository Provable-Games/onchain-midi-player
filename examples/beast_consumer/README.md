# Beast reference consumer

The NFT owns its complete document, SVG image, styles, title/favicon, controls, anchoring, pass-synchronized image restarts and background/media-session policy. Its generated `owned_assets.cairo` is separate from every TinySynth class constant. `assembly.cairo` directly splices standalone library fragments and runtime metadata/art/data using an encoder compiled into the consumer.

Art uses a complete encoded `<img>` so script-like SVG bytes cannot terminate parent data/scripts. Art may precede or follow data, and bootstrap/closing HTML follow it. The bootstrap awaits shared-library and headless-player readiness; combined-player failure leaves the ordinary image visible. UI uses only the six-member player API. Optional media APIs are best effort: the silent six-second WAV, iOS playback session, bitmap artwork and media controls preserve the useful 0.4.0 behavior. Blocked blob media permits ordinary audio and stops on hiding. Actual mobile/lock-screen behavior remains device validation.

The independent multi-provider Cairo fixture lives in root tests: TinySynth supplies loader/combined player/data and `FixtureProvider` supplies a tiny named-export library. NFT code uses that export after readiness, and a dependent test block proves ordering. No p5.js implementation, integration or benchmark is included.

```sh
scarb build
snforge test
node scripts/gen_fixtures.mjs
node --test scripts/*.test.mjs
node scripts/browser_check.mjs
```

Tokens 1–3 have complete independent JS goldens; token 4 uses unchanged 22,733-byte Warlock art, 3,716-byte MIDI and reference sounds for full-size parity/measurement. `tests/naive.cairo` constructs equivalent complete HTML and performs runtime full-page encoding; direct splicing is the efficient recommended integration, while consumer re-encoding remains supported. See [layout](../../docs/token-uri-layout.md), [gas](../../docs/gas.md) and [validation](../../docs/development.md).
