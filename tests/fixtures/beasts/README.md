# Real Beast data (test and gas fixtures)

Real inputs for the gas measurements and the full Beasts-shaped `token_uri` in [`examples/beast_consumer`](../../../examples/beast_consumer). They are test fixtures only: the class never contains them.

| File | Source | SHA-256 |
| --- | --- | --- |
| `warlock_shiny_animated.svg` (22,733 bytes) | [Provable-Games/beasts-v3](https://github.com/Provable-Games/beasts-v3) at commit `42511842894ef7e98bf0e1c26b0be6f671c3175f`, `assets/examples/warlock_shiny_animated.svg`, copied byte for byte: the Beasts renderer's output for a shiny, animated Warlock | `6ad6b67b75f45d04831c03c9167965c288e5729153a933e9f8c31168421dd658` |
| `midi.json` | [loothero/midi_fun_contract](https://github.com/loothero/midi_fun_contract) at commit `64f64c460300d7fef45814419fbf50998c8fc8e4` (branch `feat/tinysynth-sol61`), `offchain/beast-sound/onchain/fixtures/midi.json`: five of its sixteen scores from the onchain composer, one per size (816, 1,541, 2,266, 2,991 and 3,716 bytes; `heaviest` is the largest real score), with their recorded Beast and live state. The MIDI bytes are unchanged | per score, in the file |

## Licenses

These files are third-party data under their own terms, **not** under this repository's Apache-2.0 license. They are used only as non-production test and gas fixtures: the class never contains them. The example's generated `examples/beast_consumer/src/beast_data.cairo` copies the SVG and the largest score, and carries the same notice.

- **`warlock_shiny_animated.svg`** is Beasts artwork, Copyright (c) 2025 Provable Games Inc. The beasts-v3 repository distributes it with two license files, copied verbatim from the same commit into [`licenses/`](licenses):
  - [`licenses/beasts-v3-BUSL_LICENSE`](licenses/beasts-v3-BUSL_LICENSE), the Business Source License 1.1 for "Beast Collectibles";
  - [`licenses/beasts-v3-MIT_LICENSE`](licenses/beasts-v3-MIT_LICENSE).

  BUSL 1.1 grants copying, redistribution and non-production use, and requires the license to be displayed on each copy; that is why the texts are here.
- **`midi.json`** comes from loothero/midi_fun_contract, which has no license file. Nothing here grants rights to the scores. Whether they may be redistributed is the maintainer's decision, open on the pull request that added them (#18).

If either is not cleared, replace it with synthetic data of the same size: the gas measurements depend only on sizes. Then rerun `node scripts/gen_fixtures.mjs` in the example and the gas tests.

All five scores pass the page's MIDI checks (`checkMidi` in `player/player.js`), so the player loads them as they are.
