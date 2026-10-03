# Real Beast data (test and gas fixtures)

Real inputs for the gas measurements and the full Beasts-shaped `token_uri` in [`examples/beast_consumer`](../../../examples/beast_consumer). They are test fixtures only: the class never contains them.

| File | Source | SHA-256 |
| --- | --- | --- |
| `warlock_shiny_animated.svg` (22,733 bytes) | [Provable-Games/beasts-v3](https://github.com/Provable-Games/beasts-v3) at commit `42511842894ef7e98bf0e1c26b0be6f671c3175f`, `assets/examples/warlock_shiny_animated.svg`, copied byte for byte: the Beasts renderer's output for a shiny, animated Warlock | `6ad6b67b75f45d04831c03c9167965c288e5729153a933e9f8c31168421dd658` |
| `midi.json` | [loothero/midi_fun_contract](https://github.com/loothero/midi_fun_contract) at commit `64f64c460300d7fef45814419fbf50998c8fc8e4` (branch `feat/tinysynth-sol61`), `offchain/beast-sound/onchain/fixtures/midi.json`: five of its sixteen scores from the onchain composer, one per size (816, 1,541, 2,266, 2,991 and 3,716 bytes; `heaviest` is the largest real score), with their recorded Beast and live state. The MIDI bytes are unchanged | per score, in the file |

Licenses: the SVG is Beasts artwork, Copyright (c) 2025 Provable Games Inc., under the terms in the beasts-v3 repository's `licenses/` (MIT and the Business Source License 1.1 for Beast Collectibles). The scores come from a repository without a license file. Both are used here as non-production test data; the maintainer decides whether they stay.

All five scores pass the page's MIDI checks (`checkMidi` in `player/player.js`), so the player loads them as they are.
