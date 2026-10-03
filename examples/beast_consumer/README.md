# Example: a Beasts-style NFT with the onchain TinySynth player

A runnable end-to-end example of how an NFT that already renders its own SVG (modelled on the Beasts NFT) adds the onchain TinySynth player to its `token_uri`. The TinySynth class does not exist yet, so `MockOnchainTinySynth` stands in for it: it implements the declared `IOnchainTinySynth` interface and returns output in the exact layout the real class will use, with a tiny mock page in place of the engine and player.

```
examples/beast_consumer/
├── Scarb.toml                     separate package; depends on the root crate (path = "../..")
├── src/
│   ├── mock_tinysynth.cairo       MockOnchainTinySynth: the class library stand-in
│   ├── mock_page_data.cairo       generated: the mock PAGE, pre-encoded at both layers
│   ├── beast_like_nft.cairo       BeastLikeNft: render_svg, members, token_uri assembly
│   └── sound.cairo                the token's MIDI file and SynthSettings
├── tests/
│   ├── golden.cairo               generated: expected token_uri / SVG per token, and raw PAGE
│   ├── naive.cairo                naive reference: plain JSON, base64-encoded once
│   ├── test_token_uri.cairo       golden parity, naive parity, library call without deployment
│   └── test_reverts.cairo         invalid SynthSettings and unknown tokens revert
├── scripts/
│   ├── reference.mjs              independent JS reference of everything above
│   ├── gen_page.mjs               writes src/mock_page_data.cairo
│   ├── gen_fixtures.mjs           writes tests/golden.cairo and fixtures/
│   ├── decode.mjs                 decodes any token_uri into its layers
│   ├── reference.test.mjs         Node tests: MIDI parsing (incl. SysEx), UTF-8 decoding
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
7. Player, on DOMContentLoaded: reads #settings (parse), #midi (strip whitespace, decode),
   #art (re-encode as data:image/svg+xml;base64 and show it in an <img>); Play starts the synth
   (mock: no audio).
```

`token_uri` is assembled from base64 pieces that are each encoded on their own, using `b64(X ++ Y) == b64(X) ++ b64(Y)` when `len(X) % 3 == 0`. The full layout and alignment rules are in the root [README](../../README.md#consumer-token_uri-layout-the-beasts-layout) and walked through step by step in the comments of [`beast_like_nft.cairo`](src/beast_like_nft.cairo). In short:

- The consumer's pieces (`head`, `S`, `",  "`) are padded with spaces between JSON tokens to multiples of 3 bytes.
- The class pads `PAGE` and `D` to multiples of 9, because they are spliced at both layers.
- `S = svg_b64 '"' <pad>` is encoded once and appended twice. The first copy is the `image` value; the second, at the HTML layer, is the SVG that closes the art block, and its `"` closes the `animation_url` string.

The three example tokens are chosen so that every pad length occurs:

| token | name | head pad | S pad | D pad | `token_uri` chars |
| --- | --- | --- | --- | --- | --- |
| 1 | Warlock | 0 | 2 | 2 | 13,853 |
| 2 | Night's Wyvern | 2 | 0 | 3 | 13,881 |
| 3 | Fen-Troll | 1 | 1 | 4 | 13,865 |

Only `reverb` varies between tokens (derived from the tier), which changes `len(SETTINGS)` and so the `D` padding.

### Compared with today's Beasts

Today, Beasts renders the SVG, base64-encodes it for `image`, builds the whole JSON, then base64-encodes the whole JSON in one more pass, including the already-encoded image. With sound, the NFT stops encoding the whole JSON: it encodes only its own small pieces and the SVG (once), and splices in the class's pieces. The renderer does not change.

## Mocked here vs. the real class

| | This example | Real class |
| --- | --- | --- |
| Engine | a one-line placeholder `<script>` with the same global name; no sound | the ~37 KB minified TinySynth from a pinned release of the Provable-Games fork |
| Player | parses and displays the blocks; Play is a no-op | tap-to-start audio, play/stop, End-of-Track looping, art restart in sync |
| `SETTINGS` format | placeholder: `quality,reverb,master_vol,voices{;drum,slot{:op}}`, op = 13 comma-separated integers | specified with issue #1 |
| Validation | a few ranges (quality, reverb, master_vol, voices, slots, operator count, route) | every field, per `types.cairo` |
| `Harmonics`, `Samples`, filters | revert ("unsupported") | issues #2 and #3 |
| `base64` | byte-wise | planned word-wise, about 3.4x cheaper in prior art |
| `script_sha256` | SHA-256 of the placeholder script | SHA-256 of the pinned engine release |
| `version`, `license` | mock strings | real version string and Apache-2.0 notice |
| MIDI | a fixed one-bar SMF in `sound.cairo` | the onchain composer's output |

The page is built the same way the real build pipeline will build it: assembled and padded offline, pre-encoded at both layers, and stored as a generated constant (`gen_page.mjs` mirrors roadmap phase 3).

## Run it

From `examples/beast_consumer` (Scarb 2.20.1 and Starknet Foundry 0.64.0, per the root `.tool-versions`; the scripts need only Node, no `npm install`):

```sh
node scripts/gen_page.mjs       # regenerate src/mock_page_data.cairo
node scripts/gen_fixtures.mjs   # regenerate tests/golden.cairo and fixtures/; prints the pad table
scarb build
snforge test                    # 15 tests, plus 1 ignored print helper
node --test scripts/*.test.mjs  # 9 Node tests: reference, decoder, the player's MIDI parser
snforge test matches_js_golden --gas-report   # token_uri gas, per contract and selector
```

Both generators are deterministic: running them again leaves `git diff` empty, and their output is already in `scarb fmt` style.

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
- `fixtures/animation.html`: the `animation_url`, decoded. Open it in a browser, offline: it shows the art, the raw and parsed settings, and the MIDI summary (112 bytes, format 0, PPQ 48, 120 BPM, 4 notes, 4 drum hits, End-of-Track at tick 192).

The optional headless check loads the page from disk, from the exact `data:` URI in `token.json`, and as a variant whose MIDI block holds a file with SysEx (F0) and escape (F7) events. It confirms that the settings and MIDI parse, that the art renders (it samples a pixel of the PNG inside the SVG's `foreignObject`), that there are no console errors, and that there are no network requests:

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
| `BeastLikeNft.token_uri`, tokens 1-3 | 96.0M-96.5M |
| of which `animation_url_segment` (materializing the 9 KB constant) | 1.8M |
| of which `midi_segment` (validation, `SETTINGS`, two base64 passes) | 25.7M |
| of which 5 `base64` library calls (SVG, `S`, head, `',  '`, `'}'`) | about 61M in total, the largest single call 31M |

The mock's byte-wise `base64` dominates, and every library call also serializes its `ByteArray` argument. Treat these figures as an upper bound, not a forecast for the real class.
