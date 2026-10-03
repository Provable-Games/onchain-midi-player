# Example: a Beasts-style NFT with the onchain TinySynth player

A runnable end-to-end example of how an NFT that already renders its own SVG (modelled on the Beasts NFT) adds the onchain TinySynth player to its `token_uri`. The TinySynth class does not exist yet, so `MockOnchainTinySynth` stands in for it: it implements the declared `IOnchainTinySynth` interface and returns output in the exact layout the real class will use. Its page is already the real one (the pinned TinySynth engine and the real player, from the crate's generated `page_data`), and its settings validation and encoding are real; only its `base64` is a simple byte-wise stand-in until the class lands (phase 4, issue #10).

```
examples/beast_consumer/
├── Scarb.toml                     separate package; depends on the root crate (path = "../..")
├── src/
│   ├── mock_tinysynth.cairo       MockOnchainTinySynth: the class library stand-in (real page_data)
│   ├── beast_like_nft.cairo       BeastLikeNft: render_svg, members, token_uri assembly
│   └── sound.cairo                the token's MIDI file and SynthSettings
├── tests/
│   ├── golden.cairo               generated: expected token_uri / SVG per token, and the raw PAGE
│   ├── naive.cairo                naive reference: plain JSON, base64-encoded once
│   ├── test_token_uri.cairo       golden parity, naive parity, library call without deployment
│   └── test_reverts.cairo         invalid SynthSettings and unknown tokens revert
├── scripts/
│   ├── reference.mjs              independent JS reference of everything above
│   ├── gen_fixtures.mjs           writes tests/golden.cairo and fixtures/
│   ├── decode.mjs                 decodes any token_uri into its layers
│   ├── reference.test.mjs         Node tests: the MIDI (incl. SysEx), UTF-8 decoding
│   ├── player.test.mjs            Node tests: the page's player on the tokens, and its failure paths
│   └── browser_check.mjs          optional headless check of the decoded page
└── fixtures/                      the sample token (token 1, "Warlock"), decoded
```

## Data flow

```
1. Marketplace calls BeastLikeNft.token_uri(token_id)
2. BeastLikeNft, exactly as without sound:
     token data -> render_svg(name, tier, png)  -> raw SVG
                -> members(...)                 -> "name":...,"description":...,"attributes":[...]
3. BeastLikeNft, new: library calls to the declared TinySynth class (never deployed)
     IOnchainTinySynthLibraryDispatcher { class_hash }   class hash stored at construction
       .base64(svg)                       svg_b64, computed once
       .base64(head), .base64(S), .base64(",  "), .base64("}")
       .animation_url_segment()           constant: the page, encoded offline at both layers
       .midi_segment(midi, settings)      validates settings; b64(b64(SETTINGS + MIDI blocks))
4. Assembled payload (all pieces concatenated, nothing re-encoded):
     "data:application/json;base64," b64(head) b64(S) b64(",  ")
       animation_url_segment  midi_segment  b64(S)  b64("}")
5. Marketplace base64-decodes once and gets ordinary JSON:
     { "name", "description", "attributes",
       "image":         "data:image/svg+xml;base64,<svg_b64>",
       "animation_url": "data:text/html;base64,<b64(PAGE ++ D ++ SVG)>" }
6. animation_url decodes to one HTML document:
     PAGE  <head> engine </head> <body> player <script type="text/plain" id="settings">
     D     SETTINGS </script><script type="text/plain" id="midi"> b64(midi) </script>
           <script type="text/plain" id="art">
     SVG   raw SVG, the unclosed art block, ending at EOF
7. Player, on DOMContentLoaded: shows #art first (re-encoded as data:image/svg+xml;base64 in an
   <img>), then parses #settings and decodes and checks #midi; ▶ starts TinySynth with the
   settings, loops at End-of-Track and restarts the art in sync. See the root README.
```

`token_uri` is assembled from base64 pieces that are each encoded on their own, using `b64(X ++ Y) == b64(X) ++ b64(Y)` when `len(X) % 3 == 0`. The full layout and alignment rules are in the root [README](../../README.md#consumer-token_uri-layout-the-beasts-layout) and walked through step by step in the comments of [`beast_like_nft.cairo`](src/beast_like_nft.cairo). In short:

- The consumer's pieces (`head`, `S`, `",  "`) are padded with spaces between JSON tokens to multiples of 3 bytes.
- The class pads `PAGE` and `D` to multiples of 9, because they are spliced at both layers.
- `S = svg_b64 '"' <pad>` is encoded once and appended twice. The first copy is the `image` value; the second, at the HTML layer, is the SVG that closes the art block, and its `"` closes the `animation_url` string.

The three example tokens are chosen so that every pad length occurs:

| token | name | head pad | S pad | D pad | `token_uri` chars |
| --- | --- | --- | --- | --- | --- |
| 1 | Warlock | 0 | 2 | 4 | 85,469 |
| 2 | Night's Wyvern | 2 | 0 | 5 | 85,497 |
| 3 | Fen-Troll | 1 | 1 | 6 | 85,481 |

Only `reverb` varies between tokens (derived from the tier), which changes `len(SETTINGS)` and so the `D` padding.

### Compared with today's Beasts

Today, Beasts renders the SVG, base64-encodes it for `image`, builds the whole JSON, then base64-encodes the whole JSON in one more pass, including the already-encoded image. With sound, the NFT stops encoding the whole JSON: it encodes only its own small pieces and the SVG (once), and splices in the class's pieces. The renderer does not change.

## Mocked here vs. the real class

| | This example | Real class |
| --- | --- | --- |
| Page (engine and player) | real: `onchain_tinysynth::page_data`, generated by the root `scripts/build_page.mjs` around the pinned TinySynth build | same |
| `animation_url_segment`, `script_sha256`, `version`, `license` | real `page_data` constants | same |
| `SETTINGS` format | real (issue #1): the crate's `settings::encode` | same |
| Validation | real: the crate's `settings::validate`, every field, `'TS: ...'` messages | same |
| Custom waves (`SynthSettings.waves`, `Waveform::Custom`), filters | revert (`'TS: custom wave unsupported'`, `'TS: filter unsupported'`), as in the real class until issues #2 and #3 | issues #2 and #3 |
| `base64` | byte-wise, encoded at call time | planned word-wise, about 3.4x cheaper in prior art (phase 4) |
| MIDI | a fixed one-bar SMF in `sound.cairo` | the onchain composer's output |

The page is built offline at the repository root (`npm run gen:page`): assembled and padded, pre-encoded at both layers, and stored as a generated constant. The example's scripts read the built page from `tests/fixtures/page.html` and need no `npm install`.

## Run it

From `examples/beast_consumer` (Scarb 2.20.1 and Starknet Foundry 0.64.0, per the root `.tool-versions`; the scripts need only Node, no `npm install`):

```sh
node scripts/gen_fixtures.mjs   # regenerate tests/golden.cairo and fixtures/; prints the pad table
scarb build
snforge test                    # 17 tests, plus 1 ignored print helper
node --test "scripts/**/*.test.mjs"  # 15 Node tests: reference, decoder, MIDI, the page's player
snforge test matches_js_golden --gas-report   # token_uri gas, per contract and selector
```

The generator is deterministic: running it again leaves `git diff` empty, and its output is already in `scarb fmt` style. The naive-nesting tests base64-encode the whole ~64 KB token JSON byte by byte, so `Scarb.toml` raises snforge's step limit (`max_n_steps`).

To decode the actual contract output rather than the JS reference:

```sh
snforge test print_sample_token_uri --include-ignored | grep '^data:application/json' > uri.txt
node scripts/decode.mjs uri.txt out/    # out/token.json, out/image.svg, out/animation.html
```

`decode.mjs` writes `image.svg` and `animation.html` as the exact decoded bytes, and decodes the JSON as strict UTF-8 (invalid UTF-8 is an error).

### How parity is established

1. `gen_fixtures.mjs` builds every token's `token_uri` twice in JS: spliced, as the contract does, and naive, as the whole JSON (with `animation_url = "data:text/html;base64," + b64(PAGE ++ D ++ SVG)`) base64-encoded once with Node's encoder. It checks that they are equal, that the decoded `image` is the rendered SVG, that `animation_url` decodes to `PAGE ++ D ++ SVG`, and that the decoded JSON equals the compact JSON (so the pad spaces are insignificant). It then writes `tests/golden.cairo`.
2. `test_token_uri.cairo` asserts that the contract's `token_uri` equals the JS golden byte for byte, for each token.
3. The same tests also compare it with `tests/naive.cairo`, a Cairo naive reference using its own byte-at-a-time encoder.

So the contract's output equals both an independent JS implementation and plain nested base64. A mismatch prints the first differing byte.

## Inspect the fixtures

- `fixtures/token_uri.txt`: the exact `token_uri` of token 1, identical to the contract's output.
- `fixtures/token.json`: the decoded JSON, pretty-printed. Keys are `name`, `description`, `attributes`, `image`, `animation_url`.
- `fixtures/image.svg`: the `image`, decoded. Open it in a browser.
- `fixtures/animation.html`: the `animation_url`, decoded. Open it in a browser, offline: it shows the art with the ▶/■ button, and plays the one-bar MIDI (112 bytes, PPQ 48, 120 BPM, End-of-Track at tick 192) in a loop with the token's custom lead and kick.

The optional headless check loads the page four ways:
- from disk;
- from the exact `data:` URI in `token.json`;
- as a variant whose MIDI block holds a file with SysEx (F0) and escape (F7) events;
- as a variant with invalid settings (`1,2,30,40,64,0,0`).

For the valid pages it confirms that the art renders (it samples a pixel of the PNG inside the SVG's `foreignObject`), that ▶ is enabled, and that ▶ starts TinySynth with the token's settings: the custom lead on program 80, the custom kick on drum 36, the reverb and volume, and the End-of-Track loop at tick 192.

For the invalid variant it confirms that the page fails closed: the art still renders, ▶ is disabled, the validator's error is shown, and no synth is created.

Every page must make no network requests and log no console errors other than the expected one. The repository's `npm run page-check` checks the page in more depth: in a sandboxed iframe, under a strict CSP, the loop timing and the art restart.

The same player paths (the tokens' settings, invalid or unparsable settings, corrupt MIDI) are also tested without a browser in `scripts/player.test.mjs`, which runs the page's player script in `node:vm`.

```sh
PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core CHROME=/path/to/chrome \
  node scripts/browser_check.mjs
```

## Integration checklist for a real NFT (such as Beasts)

- [ ] **The SVG never contains `</script`** (case-insensitive). It is the unclosed last block of the page, so the HTML parser would end it there. Beasts' guarantees carry over: name charset `A-Z a-z 0-9`, space, `'`, `-` (no `<` or `/`); fixed reviewed literals; art URIs validated as strict base64.
- [ ] **Base64 the SVG once** and reuse `b64(S)` for both `image` and the art.
- [ ] **Pad your pieces to multiples of 3** with spaces between JSON tokens: `'{' members ',' <pad> '"image":"data:image/svg+xml;base64,'`, then `svg_b64 '"' <pad>`, then `',  '`. Only the final `'}'` may produce `=`.
- [ ] **Key order**: members, then `image`, then `animation_url` last, because the art closes the `animation_url` string.
- [ ] **`animation_url_segment` and `midi_segment` come from library calls** on the stored class hash (`IOnchainTinySynthLibraryDispatcher`). The class is declared, never deployed. Store the class hash; updating it is how you opt into a new engine or page.
- [ ] **No change to the renderer.** It keeps returning raw SVG.
- [ ] Pass `SynthSettings` that are constants or derived from permanent traits, so each token's sound stays fixed. Invalid settings revert the whole `token_uri`.
- [ ] Use the class's `base64` or your own encoder, as long as it is standard RFC 4648.

## Gas (informational)

`snforge test matches_js_golden --gas-report`, L2 gas:

| Call | L2 gas |
| --- | --- |
| `BeastLikeNft.token_uri`, tokens 1-3 | 131.8M-132.2M |
| of which `animation_url_segment` (materializing the 80 KB constant and returning it through the library call) | 11.1M |
| of which `midi_segment` (validation, `SETTINGS`, two base64 passes) | 26.6M |
| of which 5 `base64` library calls (SVG, `S`, head, `',  '`, `'}'`) | about 61M in total, the largest single call 31M |

The mock's byte-wise `base64` dominates, and every library call also serializes its `ByteArray` argument. Treat these figures as an upper bound, not a forecast for the real class.
