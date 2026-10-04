---
name: sound-design
description: Design the sound of an NFT that uses the onchain TinySynth player (Provable-Games/onchain-tinysynth) through the SynthSettings value its contract passes to midi_segment - quality, reverb, master volume, voices, and custom FM or chip timbres that replace General MIDI programs or drum notes. Use when choosing or tuning instruments and drums, converting a TinySynth soundedit timbre to Cairo fixed point, fixing a settings revert from midi_segment (the TS errors), or previewing settings offline before deploying.
license: Apache-2.0
compatibility: Needs Node 22 or later and a clone of https://github.com/Provable-Games/onchain-tinysynth whose VERSION in src/page_data.cairo equals the class's version(); Cairo steps need the Scarb version in its .tool-versions.
---

# Sound design with `SynthSettings`

The contract passes a `SynthSettings` value to `midi_segment` on every `token_uri` call. It sets the built-in sound set, reverb, master volume, voices, and custom timbres. The source of truth is the README's [Sound settings and custom sounds](https://github.com/Provable-Games/onchain-tinysynth/blob/main/README.md#sound-settings-and-custom-sounds) and [`src/types.cairo`](https://github.com/Provable-Games/onchain-tinysynth/blob/main/src/types.cairo).

Boundary: the [midi-guide](../midi-guide/SKILL.md) skill covers what goes in the `.mid` (notes, program changes, controllers). This skill covers what the contract passes in `SynthSettings`. Wiring it into `token_uri` is the [integrator-guide](../integrator-guide/SKILL.md) skill.

## Workflow

1. Write the settings as JSON, in the shape of the `settings` objects in [`tests/fixtures/settings.json`](https://github.com/Provable-Games/onchain-tinysynth/blob/main/tests/fixtures/settings.json) (typedefs in [`player/settings.js`](https://github.com/Provable-Games/onchain-tinysynth/blob/main/player/settings.js)). Every field is required, and stored integers are used as-is.
2. Preview and validate them offline:

   ```sh
   npm run preview -- song.mid --settings sound.json --serve
   ```

   `preview` runs the JS reference of the class's `settings::validate` and encoder (same checks, order, messages and indices; parity fixtures keep them identical). An invalid value prints `midi_segment would revert with ('TS: …', …)`. A misspelt or missing field fails too.
3. Port the values to Cairo (below), then test in the consumer that `midi_segment` accepts them.

Get the tools: Node 22 or later, and a clone whose `grep 'pub const VERSION' src/page_data.cairo` prints the class's `version()`: `main` while it matches, otherwise the last commit before `VERSION` changed. The same `VERSION` always means the same page bytes. `preview` needs no `npm ci`. Details: README [Agent skills](https://github.com/Provable-Games/onchain-tinysynth/blob/main/README.md#agent-skills).

## What the class checks

`midi_segment` reverts on exactly the checks in the table at the top of [`src/settings.cairo`](https://github.com/Provable-Games/onchain-tinysynth/blob/main/src/settings.cairo), in the checkout whose `VERSION` matches your class. Trust that table and `preview`, which runs the same checks; do not rely on remembered ranges, because they differ between class versions:

From `page.7`:

- Validation covers what the format and the engine require: `quality` is 0 or 1, `voices` at least 1, the counts, the slots, the routes, the wave index and the gates for issues #2 and #3. Every other number takes any value of its integer type, except the five operator fields below.
- There is no `SETTINGS` length cap: the network prices the cost ([The size of `SETTINGS`](https://github.com/Provable-Games/onchain-tinysynth/blob/main/README.md#the-size-of-settings-no-byte-cap), [Network and node limits](https://github.com/Provable-Games/onchain-tinysynth/blob/main/README.md#network-and-node-limits)).
- Five operator fields have interim engine bounds: `ratio`, `pitch_ratio`, `volume`, `sustain` and `key_scale`. The pinned engine computes non-finite values past them and throws, and the throwing note stalls the whole song. They are removed once the engine's guard lands (release gate, issue [#12](https://github.com/Provable-Games/onchain-tinysynth/issues/12)). README: [Engine limits on operator values](https://github.com/Provable-Games/onchain-tinysynth/blob/main/README.md#engine-limits-on-operator-values).

The `page.6` class (the Sepolia class in the README's [Deployments](https://github.com/Provable-Games/onchain-tinysynth/blob/main/README.md#deployments)) predates these rules: it range-checks `reverb`, `master_vol`, `voices` and every operator value, and caps the `SETTINGS` length (`'TS: settings too long'`). Design for the class you will call.

The count limits are constants in that file (`MAX_TIMBRES`, `MAX_OPERATORS`, `MAX_WAVES`; wave lengths are in the check table). Read them from your checkout.

## Engine-wide fields

| Field | Default (`default_settings()`) | Meaning |
| --- | --- | --- |
| `quality` | 1 | Built-in sound set: 0 chip-tune (one oscillator per note), 1 FM. |
| `reverb` | 30 | Reverb level in percent; 0 turns reverb off. Engine-wide: MIDI CC91 does nothing. |
| `master_vol` | 40 | Master volume in percent of full scale. The default is below TinySynth's 50, because dense passages clipped at 50 in quality 1. |
| `voices` | 64 | Melodic notes at once across all channels. |
| `waves` | empty | Custom waves revert `'TS: custom wave unsupported'` until issue #2. |
| `timbres` | empty | Custom sounds (below), up to `MAX_TIMBRES`. |

## Custom timbres

- A `Timbre` replaces program `slot` (0–127), or drum note `slot` (35–81) when `drum` is true, for the whole song. The MIDI selects it the ordinary way: a program change, or that note on channel 10. Each `(drum, slot)` pair may appear once.
- It has 1 to `MAX_OPERATORS` operators, TinySynth's 13-parameter model. Fractional fields are fixed point: stored value / 10,000 (`FIXED_POINT_SCALE`), so `5_000` is 0.5.
- A carrier's (`route` 0) frequency is the note frequency × `ratio` + `offset_hz`. `ratio` 0 fixes the frequency at `offset_hz`: that is how LFOs and pitched drums are built.
- A modulator's frequency is its target's frequency × `ratio` + `offset_hz`, and an FM modulator's depth also scales with its target's frequency. So `ratio` compounds along an FM chain: each operator runs at the note frequency × the product of the ratios from the carrier down to it, so three operators at `ratio` 10 put the last at 1,000 × the note. Deep chains of high ratios are what overflow the engine, which is why `ratio` has an interim engine bound; keep chain ratios small, and preview them at the highest notes the score plays.
- Rules the engine imposes:
  - Modulators (`route` 1–10 for FM, 11–18 for AM) must come after the operator they target, so operator 1 always has `route` 0.
  - The first operator's `decay` × 3.5 is the length of every drum hit.
  - The first operator's `release` × 3.5 is how long a melodic voice lasts after note-off.
- Every field, its TinySynth key, type, default and meaning: [references/operator-fields.md](references/operator-fields.md). Preview unusual values: extreme ones can make the engine misbehave while playing.
- From TinySynth's `soundedit.html` (in the fork): `g` becomes `route`; `w` becomes `wave` (`sine`, `square`, `sawtooth`, `triangle`, `n0`, `n1` map to `Sine` … `MetallicNoise`); multiply every other value by 10,000 and round. Fields TinySynth leaves out take `default_operator()`. README: [Designing a custom sound](https://github.com/Provable-Games/onchain-tinysynth/blob/main/README.md#designing-a-custom-sound).

## Not accepted in v1

- Custom waves (a non-empty `waves`, or `Waveform::Custom`): `'TS: custom wave unsupported'` until issue [#2](https://github.com/Provable-Games/onchain-tinysynth/issues/2), which needs fork issue [#26](https://github.com/Provable-Games/webaudio-tinysynth/issues/26). The interim engine pin already has that API (README: [Sound settings and custom sounds](https://github.com/Provable-Games/onchain-tinysynth/blob/main/README.md#sound-settings-and-custom-sounds)); the class and the player use it once issue #2 lands.
- Filters (`filter: Some(...)`): `'TS: filter unsupported'` until issue [#3](https://github.com/Provable-Games/onchain-tinysynth/issues/3), which needs fork issue [#27](https://github.com/Provable-Games/webaudio-tinysynth/issues/27). The interim engine pin already has its fixed operator filters (README: [Sound settings and custom sounds](https://github.com/Provable-Games/onchain-tinysynth/blob/main/README.md#sound-settings-and-custom-sounds)); the class and the player use them once issue #3 lands.
- Their encoding is already in the format, so lifting these checks changes neither the grammar nor the format version.
- `WhiteNoise` and `MetallicNoise` are accepted, but their buffers vary slightly per page load until fork issue [#7](https://github.com/Provable-Games/webaudio-tinysynth/issues/7).

## Wire format, size and gas

- The class validates the settings, then writes them into the page as `SETTINGS`: a flat list of canonical decimal integers (only `0-9`, `-` and `,`), fields in declaration order, a length before every list, enums as their variant index, `bool` as 0/1, `Option` as 0 or 1 followed by the value. Format version 1. README: [The `SETTINGS` format](https://github.com/Provable-Games/onchain-tinysynth/blob/main/README.md#the-settings-format); grammar in [`src/settings.cairo`](https://github.com/Provable-Games/onchain-tinysynth/blob/main/src/settings.cairo).
- Size: `1,1,30,40,64,0,0` with the defaults, plus about 6 bytes per timbre and 50 per operator. `preview` prints the size. From `page.7` the class does not cap the length; the `page.6` class does (above). Either way the gas grows with it.
- Gas: `SETTINGS` is base64-encoded at call time with the MIDI, about 14M L2 gas per 1,000 bytes ([README](https://github.com/Provable-Games/onchain-tinysynth/blob/main/README.md#gas-and-limits)).

## `'TS: …'` errors

`midi_segment` runs `settings::validate`, which applies the checks in the table at the top of `src/settings.cairo` in a fixed order and reverts on the first failure with a `'TS: …'` short string, followed by the 0-based indices of the wave, the timbre, or the timbre and operator. Example: `('TS: volume out of range', 3, 1)`. Through a library call the panic data arrives whole, followed by `'ENTRYPOINT_FAILED'`. An invalid setting reverts the whole `token_uri`. The checks, their order and their messages are the table at the top of [`src/settings.cairo`](https://github.com/Provable-Games/onchain-tinysynth/blob/main/src/settings.cairo).

## Building settings in Cairo

```cairo
use onchain_tinysynth::settings::{default_operator, default_settings};
use onchain_tinysynth::types::{Operator, SynthSettings, Timbre, Waveform};

fn token_settings() -> SynthSettings {
    // Triangle carrier, 3 ms attack, full sustain, 10 ms release.
    let carrier = Operator {
        wave: Waveform::Triangle, volume: 3_000, attack: 30, hold: 0, sustain: 10_000, release: 100,
        ..default_operator()
    };
    // 6 Hz triangle LFO on operator 1's frequency (route 1), faded in over 0.2 s.
    let lfo = Operator {
        route: 1, wave: Waveform::Triangle, volume: 175, ratio: 0, offset_hz: 60_000, attack: 2_000,
        hold: 0, sustain: 10_000, release: 100, ..default_operator()
    };
    let lead = Timbre { drum: false, slot: 0, operators: [carrier, lfo].span() };
    SynthSettings { reverb: 0, timbres: [lead].span(), ..default_settings() }
}
```

Fixed or live: for a given class hash, the same settings and MIDI always give the same sound. Pass constants or values from permanent traits and a token sounds the same forever; derive them from state that changes and the sound follows it (emit an ERC-4906 metadata update when it does; see the [integrator-guide](../integrator-guide/SKILL.md)). The example derives only `reverb` from the token's tier ([`examples/beast_consumer/src/sound.cairo`](https://github.com/Provable-Games/onchain-tinysynth/blob/main/examples/beast_consumer/src/sound.cairo)).

## Example timbres

The repository's test fixtures include three example sounds, a 2-operator lead on program 0, a kick on drum 36 and a snare on drum 38. They are examples for testing and measurement, not canonical sounds for any collection: `BEAST_LEAD`, `BEAST_KICK` and `BEAST_SNARE` in [`scripts/settings_fixtures.mjs`](https://github.com/Provable-Games/onchain-tinysynth/blob/main/scripts/settings_fixtures.mjs), and the `beast_reference` entry of `tests/fixtures/settings.json`. Preview them with any score, or start your own from them (`preview` accepts a whole fixture entry):

```sh
node -e 'const j = require("./tests/fixtures/settings.json"); console.log(JSON.stringify(j.valid.find((v) => v.name === "beast_reference")))' > example.json
npm run preview -- song.mid --settings example.json --serve
```

`npm run render-check` renders the three in a headless browser and measures them (optional; needs Playwright, see the README).
