# Example: a Beasts-style NFT with the onchain TinySynth player

A runnable end-to-end example of how an NFT that already renders its own SVG (modelled on the Beasts NFT) adds the onchain TinySynth player to its `token_uri`. It calls the real class, `onchain_tinysynth::contract::OnchainTinySynth`, which the tests declare and never deploy: the NFT stores its class hash and reaches it with library calls. The class's base64 encoder is still the temporary stand-in (see the root [README](../../README.md#the-base64-encoder-temporary-stand-in)), so the gas figures here are with that encoder.

Tokens 1-3 are small samples that together cover every padding length. Token 4 is a real Beast, for a full-size measurement:
- **art:** the Beasts renderer's SVG for a shiny, animated Warlock, 22,733 bytes;
- **music:** the largest real score from the onchain composer, 3,716 bytes;
- **sounds:** the 3 Beast reference sounds.

Token 4's art and score are third-party data under their own terms, not this example's Apache-2.0 license. They are copied into the generated `src/beast_data.cairo` for testing only; see [`tests/fixtures/beasts/`](../../tests/fixtures/beasts/README.md#licenses).

```
examples/beast_consumer/
├── Scarb.toml                     separate package; depends on the root crate (path = "../..") and
│                                  builds its OnchainTinySynth class (build-external-contracts)
├── src/
│   ├── beast_like_nft.cairo       BeastLikeNft: render_svg, members, word-aligned token_uri assembly
│   ├── sound.cairo                the tokens' MIDI files and SynthSettings
│   └── beast_data.cairo           generated: token 4's real Beast SVG and score
├── tests/
│   ├── golden.cairo               generated: expected token_uri / SVG per sample token, token 4's
│   │                              token_uri length and SHA-256, and the raw PAGE
│   ├── naive.cairo                naive reference: plain JSON, base64-encoded once
│   ├── test_token_uri.cairo       golden parity, naive parity, library call without deployment
│   ├── test_art_safety.cairo      the art rule on the rendered SVG (no `</script`)
│   ├── test_reverts.cairo         invalid SynthSettings and unknown tokens revert
│   └── test_gas.cairo             token 4's token_uri, piece by piece
├── scripts/
│   ├── reference.mjs              independent JS reference of everything above
│   ├── gen_fixtures.mjs           writes tests/golden.cairo and fixtures/
│   ├── decode.mjs                 decodes any token_uri into its layers
│   ├── reference.test.mjs         Node tests: the MIDI (incl. SysEx), UTF-8 decoding
│   ├── player.test.mjs            Node tests: the page's player on the tokens, and its failure paths
│   ├── art_safety.test.mjs        Node tests: the art rule, and the truncated art an unsafe SVG gives
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
       .base64(open), .base64(S), .base64("}")
       .animation_url_segment()           constant: the page, encoded offline at both layers
       .midi_segment(midi, settings)      validates settings; b64(b64(SETTINGS + MIDI blocks))
4. Assembled payload (all pieces concatenated, nothing re-encoded):
     "data:application/json;base64," b64(open) 'ICAg'... b64(' "image":...base64,') b64(S)
       'LCAg' 'ICAg'...  animation_url_segment  midi_segment  b64(S)  b64("}")
5. Marketplace base64-decodes once and gets ordinary JSON:
     { "name", "description", "attributes",
       "image":         "data:image/svg+xml;base64,<svg_b64>",
       "animation_url": "data:text/html;base64,<b64(PAGE ++ D ++ SVG)>" }
6. animation_url decodes to one HTML document:
     PAGE  <head> gzipped engine (text/javascript+gzip data: URI), gunzip shim </head>
           <body> player <script type="text/plain" id="settings">
     D     SETTINGS </script><script type="text/plain" id="midi"> b64(midi) </script>
           <script type="text/plain" id="art">
     SVG   raw SVG, the unclosed art block, ending at EOF
7. While <head> is parsed, the shim inflates the engine and runs it as an inline <script>.
8. Player, on DOMContentLoaded: shows #art first (re-encoded as data:image/svg+xml;base64 in an
   <img>), then parses #settings and decodes and checks #midi; ▶ starts TinySynth with the
   settings, loops at End-of-Track and restarts the art in sync. See the root README.
```

`token_uri` is assembled from base64 pieces that are each encoded on their own, using `b64(X ++ Y) == b64(X) ++ b64(Y)` when `len(X) % 3 == 0`. The full layout and alignment rules are in the root [README](../../README.md#consumer-token_uri-layout-the-beasts-layout) and walked through step by step in the comments of [`beast_like_nft.cairo`](src/beast_like_nft.cairo). In short:

- The consumer's pieces (`'{' members ',' <pad>`, `S`, the comma and the image key) are padded with spaces between JSON tokens to multiples of 3 bytes.
- The class pads `PAGE` and `D` to multiples of 9, because they are spliced at both layers.
- `S = svg_b64 '"' <pad>` is encoded once and appended twice. The first copy is the `image` value; the second, at the HTML layer, is the SVG that closes the art block, and its `"` closes the `animation_url` string.
- **Word alignment.** The consumer adds 3 spaces at a time between JSON tokens, so that its two largest appends start on a 31-byte `ByteArray` word: the first `b64(S)` and the segment. Each group is the constant `'ICAg'` (`b64('   ')`), and the image key and the comma are constants too: `b64(' "image":"data:image/svg+xml;base64,')` and `'LCAg'` (`b64(',  ')`). So no alignment space is base64-encoded at call time. For token 4 this saves 13.9M L2 gas of appends (16.0M instead of 29.9M). The root [README](../../README.md#integration-guide) explains it.

The tokens:

| token | name | head spaces | comma piece | S pad | D pad | `token_uri` chars |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Warlock | 68 | 12 bytes | 2 | 4 | 47,585 |
| 2 | Night's Wyvern | 61 | 6 bytes | 0 | 5 | 47,593 |
| 3 | Fen-Troll | 66 | 9 bytes | 1 | 6 | 47,589 |
| 4 | Shiny Warlock (a real Beast) | 62 | 3 bytes | 2 | 3 | 133,525 |

Tokens 1-3 cover every pad length: `len('{' members ',')` and `len(S)` take every remainder mod 3, and `D` three different pads. Only `reverb` varies between them (derived from the tier), which changes `len(SETTINGS)` and so the `D` padding. The head spaces include the alignment groups.

### Compared with today's Beasts

Today, Beasts renders the SVG, base64-encodes it for `image`, builds the whole JSON, then base64-encodes the whole JSON in one more pass, including the already-encoded image. With sound, the NFT stops encoding the whole JSON: it encodes only its own small pieces and the SVG (once), and splices in the class's pieces. The renderer does not change.

## What is real

Everything the NFT calls is the real class: the page (the gzipped engine, the gunzip shim and the player, from the crate's generated `page_data`), `animation_url_segment`, `script_sha256`, `version`, `license`, `midi_segment` with the real validation and `SETTINGS`, and `base64`. Custom waves and filters revert (`'TS: custom wave unsupported'`, `'TS: filter unsupported'`) until issues #2 and #3. Two things differ from a production Beasts deployment:

| | This example | Production |
| --- | --- | --- |
| The class's base64 encoder | the temporary byte-wise stand-in | the maintainer's optimized encoder (about 62% less encoding gas in its lab), with the same output |
| MIDI | a fixed one-bar SMF in `sound.cairo` (tokens 1-3); a real score copied from the composer (token 4) | the onchain composer's output |
| Art | `render_svg` (tokens 1-3); a real Beasts SVG (token 4) | the Beasts renderer |

The page is built offline at the repository root (`npm run gen:page`): assembled and padded, pre-encoded at both layers, and stored as a generated constant. The example's scripts read the built page from `tests/fixtures/page.html` and need no `npm install`.

## Run it

From `examples/beast_consumer` (Scarb 2.20.1 and Starknet Foundry 0.64.0, per the root `.tool-versions`; the scripts need only Node, no `npm install`):

```sh
node scripts/gen_fixtures.mjs   # regenerate tests/golden.cairo, src/beast_data.cairo and fixtures/
scarb build
snforge test                    # 36 tests, plus 1 ignored print helper
node --test "scripts/**/*.test.mjs"  # 29 Node tests: reference, alignment, decoder, MIDI, the player, the art rule
snforge test matches_js --gas-report   # token_uri gas, per contract and selector
snforge test gas_                      # token 4 piece by piece (see Gas)
```

The generator is deterministic: running it again leaves `git diff` empty, and its output is already in `scarb fmt` style. The naive-nesting tests base64-encode the whole ~36 KB token JSON byte by byte, and token 4 encodes a 22.7 KB SVG with the class's byte-wise stand-in, so `Scarb.toml` raises snforge's step limit (`max_n_steps`).

To decode the actual contract output rather than the JS reference:

```sh
snforge test print_sample_token_uri --include-ignored | grep '^data:application/json' > uri.txt
node scripts/decode.mjs uri.txt out/    # out/token.json, out/image.svg, out/animation.html
```

`decode.mjs` writes `image.svg` and `animation.html` as the exact decoded bytes, and decodes the JSON as strict UTF-8 (invalid UTF-8 is an error).

### How parity is established

1. `gen_fixtures.mjs` builds every token's `token_uri` twice in JS: spliced, as the contract does, and naive, as the whole JSON (with `animation_url = "data:text/html;base64," + b64(PAGE ++ D ++ SVG)`) base64-encoded once with Node's encoder. It checks that they are equal, that the decoded `image` is the token's SVG, that `animation_url` decodes to `PAGE ++ D ++ SVG`, that the decoded JSON equals the compact JSON (so the pad spaces are insignificant), and that the first `b64(S)` and the segment start on 31-byte words. It then writes `tests/golden.cairo`.
2. `test_token_uri.cairo` asserts that the contract's `token_uri` equals the JS golden byte for byte for tokens 1-3, and its length and SHA-256 for token 4.
3. The same tests also compare tokens 1-3 with `tests/naive.cairo`, a Cairo naive reference using its own byte-at-a-time encoder.

So the contract's output equals both an independent JS implementation and plain nested base64. A mismatch prints the first differing byte.

## Inspect the fixtures

- `fixtures/token_uri.txt`: the exact `token_uri` of token 1, identical to the contract's output.
- `fixtures/token.json`: the decoded JSON, pretty-printed. Keys are `name`, `description`, `attributes`, `image`, `animation_url`.
- `fixtures/image.svg`: the `image`, decoded. Open it in a browser.
- `fixtures/animation.html`: the `animation_url`, decoded. Open it in a browser, offline: it shows the art with the ▶/■ button, and plays the one-bar MIDI (112 bytes, PPQ 48, 120 BPM, End-of-Track at tick 192) in a loop with the token's custom lead and kick.

The optional headless check loads the page seven ways:
- from disk;
- from the exact `data:` URI in `token.json`;
- as a variant whose MIDI block holds a file with SysEx (F0) events;
- as a variant with settings that do not parse (`1,1,30,40,64,0`, a token missing);
- as a variant whose gzipped engine is corrupt (one payload byte changed);
- as a variant whose SVG breaks the [art rule](../../README.md#art-svg-requirements) (a `<script>` element in it);
- token 4's page, a real Beast, as a `data:` URI.

For the valid pages it confirms that the page's shim inflated the engine (its gzip tag replaced by the pinned build, byte for byte), that the art renders (for token 1 it samples a pixel of the PNG inside the SVG's `foreignObject`), that ▶ is enabled, and that ▶ starts TinySynth with the token's settings: for token 1 the custom lead on program 80, the custom kick on drum 36, the reverb and volume, and the End-of-Track loop at tick 192; for token 4 the reference lead on program 0, the reference kick on drum 36, no reverb, and the loop at the score's End-of-Track (tick 49,440).

For the invalid variants it confirms that the page fails closed: the art still renders, ▶ is disabled, the error is shown (the parser's, or `engine: TinySynth did not load`), and no synth is created. (Range checks are Cairo's job: the page only parses `SETTINGS`.)

For the unsafe SVG it confirms the failure the art rule prevents: Chromium ends the art block at the SVG's `</script>` (exactly where `parseArtBlock` in `scripts/reference.mjs` predicts), the art `<img>` is broken, and the rest of the SVG lands in the page as elements (its `<style>`, and a `<text>` holding the token's name). The engine and ▶ are unaffected. `scripts/art_safety.test.mjs` shows the same truncation without a browser.

Every page must make no network requests (the gzip tag's `data:` URI included, which the check watches through the DevTools protocol) and log no console errors other than the expected ones. The repository's `npm run page-check` checks the page in more depth: in a sandboxed iframe, under a strict CSP, the inflation order, the loop timing, the art restart, and more failure variants.

The same player paths (the tokens' settings, unparsable settings, corrupt MIDI, a corrupt gzipped engine) are also tested without a browser in `scripts/player.test.mjs`, which runs the page's shim and player scripts in `node:vm`.

```sh
PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core CHROME=/path/to/chrome \
  node scripts/browser_check.mjs
```

## Integration checklist for a real NFT (such as Beasts)

- [ ] **The SVG never contains `</script`** (case-insensitive). It is the unclosed last block of the page, so the HTML parser would end it there (see [Art (SVG) requirements](../../README.md#art-svg-requirements)). Beasts' guarantees carry over: name charset `A-Z a-z 0-9`, space, `'`, `-` (no `<` or `/`); fixed reviewed literals; art URIs validated as strict base64. The class never sees the SVG, so check the rule in your own tests, as this example does: `assertArtSafe` in `scripts/reference.mjs` and `contains_script_end_tag` in `tests/test_art_safety.cairo`.
- [ ] **Base64 the SVG once** and reuse `b64(S)` for both `image` and the art.
- [ ] **Pad your pieces to multiples of 3** with spaces between JSON tokens: `'{' members ',' <pad>`, then the image key, then `svg_b64 '"' <pad>`, then `',  '`. Only the final `'}'` may produce `=`.
- [ ] **Word-align the large appends** (optional, saves gas): add `'ICAg'` (3 spaces) before the constant image key until `b64(S)` starts at a multiple of 31 bytes, and after `'LCAg'` until the segment does (see `align_to_word` in `beast_like_nft.cairo`).
- [ ] **Key order**: members, then `image`, then `animation_url` last, because the art closes the `animation_url` string.
- [ ] **`animation_url_segment` and `midi_segment` come from library calls** on the stored class hash (`IOnchainTinySynthLibraryDispatcher`). The class is declared, never deployed. Store the class hash; updating it is how you opt into a new engine or page.
- [ ] **No change to the renderer.** It keeps returning raw SVG.
- [ ] Pass `SynthSettings` that are constants or derived from permanent traits, so each token's sound stays fixed. Invalid settings revert the whole `token_uri`.
- [ ] Use the class's `base64` or your own encoder, as long as it is standard RFC 4648.

## Gas

L2 gas, with the class's **stand-in encoder (v1)**; the root [README](../../README.md#gas-and-limits) has the class's own measurements and the projection with the optimized encoder.

`snforge test matches_js --gas-report`:

| Call | Tokens 1-3 (1 KB SVG, 112-byte MIDI) | Token 4 (a real Beast) |
| --- | --- | --- |
| `BeastLikeNft.token_uri` | 90.2M-90.6M | 1,414.6M |
| of which `animation_url_segment` (the class's side) | 2.4M | 2.4M |
| of which `midi_segment` (the class's side) | 23.5M | 322.5M |
| of which 4 `base64` calls (the class's side): SVG, `S`, the head, `'}'` | 52.3M-52.6M | 1,049.8M |

Token 4 piece by piece, in the consumer's context, each net of its inputs (`snforge test gas_`, [`tests/test_gas.cairo`](tests/test_gas.cairo)):

| Piece | L2 gas |
| --- | --- |
| `animation_url_segment()` through the library call, reading the result included | 6.2M |
| `midi_segment()` through the library call | 323.7M |
| `b64(svg)`, 22,733 bytes: through the class's `base64` / with the same encoder compiled in | 451.8M / 444.4M |
| `b64(S)`, 30,315 bytes, through the class's `base64` | 602.4M |
| Every append, in the word-aligned layout / without the alignment spaces | 16.0M / 29.9M |

Base64 is 97% of token 4's `token_uri`, and the two passes over the SVG alone are 74%. With the stand-in that is 1.41B, over the 1B target; with the optimized encoder it is projected at about 0.57B.

Before this example called the real class, its mock gave 113.1M-113.5M for tokens 1-3. Three changes brought that down to 90.2M-90.6M: the segment became a string literal, the comma piece became a constant, and the layout was aligned.
