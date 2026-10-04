---
name: sound-design
description: Design the sound of an NFT that uses the onchain TinySynth player (Provable-Games/onchain-tinysynth) through the SynthSettings value its contract passes to midi_segment - quality, reverb, master volume, voices, custom waveforms (single-cycle sample tables and harmonic waves), fixed low-, high- and band-pass filters, and custom FM or chip timbres that replace General MIDI programs or drum notes. Use when choosing or tuning instruments and drums, defining chip waves such as stepped triangles, pulses or LFSR noise, filtering a voice (chip hi-hats, filtered leads and basses), converting a TinySynth soundedit timbre to Cairo fixed point, fixing a settings revert from midi_segment (the TS errors), or previewing settings offline before deploying.
license: Apache-2.0
compatibility: Needs Node 22 or later and a clone of https://github.com/Provable-Games/onchain-tinysynth whose VERSION in src/page_data.cairo equals the class's version(); Cairo steps need the Scarb version in its .tool-versions.
---

# Sound design with `SynthSettings`

The contract passes a `SynthSettings` value to `midi_segment` on every `token_uri` call. It sets the built-in sound set, reverb, master volume, voices, custom waves and custom timbres, whose outputs can carry a fixed filter. The source of truth is the README's [Sound settings and custom sounds](https://github.com/Provable-Games/onchain-tinysynth/blob/main/README.md#sound-settings-and-custom-sounds) and [`src/types.cairo`](https://github.com/Provable-Games/onchain-tinysynth/blob/main/src/types.cairo).

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

- Validation covers what the format and the engine require: `quality` is 0 or 1, `voices` at least 1, the counts, the slots, the routes, the wave index, and that a filter sits on an audio output with a cutoff and a Q above 0. Every other number takes any value of its integer type, every wave sample and harmonic included, except the five operator fields below.
- From `page.9` custom waves are accepted (issue #2, below). A `page.7` or `page.8` class reverts them with `'TS: custom wave unsupported'`.
- From `page.10` filters are accepted (issue #3, below). A `page.7`, `page.8` or `page.9` class reverts them with `'TS: filter unsupported'`.
- There is no `SETTINGS` length cap: the network prices the cost ([The size of `SETTINGS`](https://github.com/Provable-Games/onchain-tinysynth/blob/main/README.md#the-size-of-settings-no-byte-cap), [Network and node limits](https://github.com/Provable-Games/onchain-tinysynth/blob/main/README.md#network-and-node-limits)).
- Five operator fields have interim engine bounds: `ratio`, `pitch_ratio`, `volume`, `sustain` and `key_scale`. The pinned engine computes non-finite values past them and throws, and the throwing note stalls the whole song. The `page.9` engine validates the values `setTimbre` receives but not what they multiply into, so the bounds stay. They are removed once the engine's guard for computed values lands (the fork's task T5.2; release gate, issue [#12](https://github.com/Provable-Games/onchain-tinysynth/issues/12)). README: [Engine limits on operator values](https://github.com/Provable-Games/onchain-tinysynth/blob/main/README.md#engine-limits-on-operator-values).

The `page.6` class (the Sepolia class in the README's [Deployments](https://github.com/Provable-Games/onchain-tinysynth/blob/main/README.md#deployments)) predates these rules: it range-checks `reverb`, `master_vol`, `voices` and every operator value, and caps the `SETTINGS` length (`'TS: settings too long'`). Design for the class you will call.

The count limits are constants in that file (`MAX_TIMBRES`, `MAX_OPERATORS`, `MAX_WAVES`; wave lengths are in the check table). Read them from your checkout.

## Engine-wide fields

| Field | Default (`default_settings()`) | Meaning |
| --- | --- | --- |
| `quality` | 1 | Built-in sound set: 0 chip-tune (one oscillator per note), 1 FM. |
| `reverb` | 30 | Reverb level in percent; 0 turns reverb off. Engine-wide: MIDI CC91 does nothing. |
| `master_vol` | 40 | Master volume in percent of full scale. The default is below TinySynth's 50, because dense passages clipped at 50 in quality 1. |
| `voices` | 64 | Melodic notes at once across all channels. |
| `waves` | empty | Custom waveforms shared by every timbre, up to `MAX_WAVES` (below). |
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

## Custom waves

From `page.9` (issue [#2](https://github.com/Provable-Games/onchain-tinysynth/issues/2)). README: [Custom waves](https://github.com/Provable-Games/onchain-tinysynth/blob/main/README.md#custom-waves), the source of truth for this section.

- **Define each wave once** in `SynthSettings.waves`, shared by every timbre, and select it in an operator with `wave: Waveform::Custom(index)`, 0-based. An index past the table reverts `'TS: wave index out of range'`. Up to `MAX_WAVES` entries; unused and repeated entries are allowed.
- **`WaveDef::Samples(Span<i8>)`** is one cycle of a chip wave, played sample-and-hold: sample `s` is `s / 128` (−128 is −1.0, 127 is 0.9921875). The note sets the cycle rate, whatever the table's length, so a melodic wave keeps the usual `ratio` and `offset_hz`. The engine holds each sample for the same number of frames, so steps stay sharp.
- **`WaveDef::Harmonics(Span<u16>)`** is a band-limited wave: element `i` is the amplitude of harmonic `i + 1`, as a sine term. The browser normalizes the peak, so only the ratios matter; all zeros is silent.
- **Porting a TinySynth wave** (soundedit, or a page that calls the engine directly): `setSampleWave` floats `x` become `i8` samples `clamp(round(x × 128), −128, 127)`. From `setHarmonicWave(name, real, imag)` only non-negative sine amplitudes `imag[1..]` carry over, scaled to `u16`; cosine (`real`) terms, DC and negative amplitudes have no `Harmonics` form, so sample one cycle of such a wave into a `Samples` table instead. Nothing fails if you get this wrong: the wave just sounds different, so preview it. README: [Designing a custom sound](https://github.com/Provable-Games/onchain-tinysynth/blob/main/README.md#designing-a-custom-sound).
- **The player** registers entry `i` with the engine as `nS<i>` (samples) or `wH<i>` (harmonics), before installing any timbre. A held note on a `Samples` wave keeps the pitch bend it started with, as noise does; see the midi-guide.
- **Reference shapes**, generated from their definitions in [`scripts/reference_waves.mjs`](https://github.com/Provable-Games/onchain-tinysynth/blob/main/scripts/reference_waves.mjs) (generic chip shapes, not any collection's presets): a 64-sample 4-bit stepped triangle (`triangle4()`), 12.5%, 25% and 50% pulses of eight samples (`pulse(1)`, `pulse(2)`, `pulse(4)`), a 16-step 4-bit saw (`saw4()`), and 15-bit LFSR noise, short (93 steps) and long (32,767 steps) (`lfsr("short")`, `lfsr("long")`). The `reference_waves` entry of `tests/fixtures/settings.json` puts each on a timbre; preview it as the example timbres below.
- **Noise tables are set by their step rate:** a table of `N` samples steps `N` times per cycle, so use `ratio` 0 and `offset_hz` = steps per second / `N` (the short LFSR at 20 kHz: 215.0538 Hz, stored as 2,150,538).
- **Retune rule.** A noise table written straight into the engine's `noiseBuf`, as TinyChip does, plays one sample per frame at `playbackRate = f / 440`, so its step rate depends on the sample rate `R` it was tuned at. Registered as a `Samples` wave it steps at `f × N` on every device. Keep the sound with `f_new = f_old × R / (440 × N)`.
- **Cost.** Each sample or harmonic is 2 to 6 bytes of `SETTINGS` (about 4.5 at full scale), and `SETTINGS` costs about 14M L2 gas per 1,000 bytes through `midi_segment`. Short chip waves are cheap: the six short reference waves on eight timbres take `midi_segment` with a full-size score to 77.3M, against 60.7M for the three reference sounds. The long LFSR (147,532 bytes) adds about 2.1B, which needs a node with a large call budget (README [Network and node limits](https://github.com/Provable-Games/onchain-tinysynth/blob/main/README.md#network-and-node-limits)); deterministic `WhiteNoise` is the cheap alternative.
- **Same on every load.** The waves' tables, and the engine's noise and reverb (seeded, fork issue [#7](https://github.com/Provable-Games/webaudio-tinysynth/issues/7)), are the same on every load at a given sample rate. Browsers differ slightly, so audition in more than one.

```cairo
use onchain_tinysynth::settings::default_operator;
use onchain_tinysynth::types::{Operator, WaveDef, Waveform};

// A 12.5% pulse (one high sample of eight) and a harmonic organ (harmonics 1, 3 and 5).
let waves = [
    WaveDef::Samples([127, -128, -128, -128, -128, -128, -128, -128].span()),
    WaveDef::Harmonics([100, 0, 50, 0, 25].span()),
]
    .span();
let pulse_carrier = Operator { wave: Waveform::Custom(0), ..default_operator() };
```

## Filters

From `page.10` (issue [#3](https://github.com/Provable-Games/onchain-tinysynth/issues/3), using the engine's fixed operator filter from fork issue [#27](https://github.com/Provable-Games/webaudio-tinysynth/issues/27)). README: [Filters](https://github.com/Provable-Games/onchain-tinysynth/blob/main/README.md#filters), the source of truth for this section.

- **One fixed filter per audio output:** `filter: Option::Some(Filter { kind, cutoff, key_track, q })` on an operator whose `route` is 0. It sits between the operator's envelope and the channel, is set at note-on and has no envelope, so no sweeps. FM and AM paths are never filtered: a filter on a modulator reverts `'TS: filter on modulator'`.
- **`kind`:** `LowPass`, `HighPass` or `BandPass`.
- **`cutoff`**, fixed point: Hz, or with `key_track` a multiple of the note's frequency (tuned, before `ratio`, `offset_hz`, bend and the pitch envelope), so a lead keeps its brightness across the keyboard. On drums use Hz: a drum timbre's note is its drum note.
- **`q`**, fixed point: a linear Q. `7_071` (0.7071) is flat for a low- or high-pass, and higher values add a resonant peak at the cutoff. A band-pass's bandwidth is its centre ÷ `q`.
- **Ranges:** a cutoff and a Q above 0 (`'TS: filter cutoff out of range'`, `'TS: filter q out of range'`); nothing else is checked. The engine clamps the computed cutoff to 0.45 × the sample rate (21,600 Hz at 48 kHz, 19,845 Hz at 44.1 kHz). Very high or key-tracked cutoffs are therefore safe, and filters add no interim engine bound, but the ceiling, and so how a very high cutoff sounds, depends on the listener's device.
- **Chip hi-hats are now possible:** `MetallicNoise` at `ratio` 0 and `offset_hz` 390 Hz through a 3 kHz high-pass (`cutoff` 30,000,000, `q` 7,071), as the closed and open hats of the `filters` entry in [`tests/fixtures/settings.json`](https://github.com/Provable-Games/onchain-tinysynth/blob/main/tests/fixtures/settings.json). They measure at least 24 dB less energy below 1 kHz than above 4 kHz (about 34 to 36 dB, against about 9 dB unfiltered).
- **Filtered leads and basses:** a sawtooth or square through a key-tracked low-pass, for example `cutoff` 40,000 (4× the note); a band-pass on `WhiteNoise` gives breath and formant textures.
- **Porting from TinySynth:** `fl`, `ff`, `fq` and `fk` become `kind` (`lowpass` is `LowPass`, and so on), `cutoff` = `ff` × 10,000, `q` = `fq` × 10,000 (TinySynth's default `fq` is 0.7071) and `key_track` = `fk` == 1.
- **Cost:** a filter adds 8 to 26 bytes of `SETTINGS` (a typical one 15 to 18). Six filtered voices take `midi_segment` with a full-size score to 62.4M, against 60.7M for the three reference sounds.
- **Without a filter** an operator plays exactly as before: the player passes no filter fields, and the engine builds no filter node.

```cairo
use onchain_tinysynth::settings::default_operator;
use onchain_tinysynth::types::{Filter, FilterKind, Operator, Waveform};

// A closed chip hi-hat: metallic noise through a flat 3 kHz high-pass.
let hat = Operator {
    wave: Waveform::MetallicNoise, volume: 2_000, ratio: 0, offset_hz: 3_900_000, hold: 0,
    decay: 150,
    filter: Option::Some(
        Filter { kind: FilterKind::HighPass, cutoff: 30_000_000, key_track: false, q: 7_071 },
    ),
    ..default_operator()
};
```

## Not accepted yet

- Nothing from `page.10`: the class accepts every part of the format. An earlier class reverts filters (`'TS: filter unsupported'`, before `page.10`) and custom waves (`'TS: custom wave unsupported'`, before `page.9`).
- `WhiteNoise` and `MetallicNoise` are accepted and seeded from `page.9`; with an earlier class their buffers vary slightly per page load.

## Wire format, size and gas

- The class validates the settings, then writes them into the page as `SETTINGS`: a flat list of canonical decimal integers (only `0-9`, `-` and `,`), fields in declaration order, a length before every list, enums as their variant index, `bool` as 0/1, `Option` as 0 or 1 followed by the value. Format version 1. README: [The `SETTINGS` format](https://github.com/Provable-Games/onchain-tinysynth/blob/main/README.md#the-settings-format); grammar in [`src/settings.cairo`](https://github.com/Provable-Games/onchain-tinysynth/blob/main/src/settings.cairo).
- Size: `1,1,30,40,64,0,0` with the defaults, plus about 6 bytes per timbre, 50 per operator and 2 to 6 per wave sample or harmonic. `preview` prints the size. From `page.7` the class does not cap the length; the `page.6` class does (above). Either way the gas grows with it.
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

`npm run render-check` renders the three in a headless browser and measures them, and the reference waves too: the stepped triangle's pitch and steps, the pulse widths, and that two page loads sound the same (optional; needs Playwright, see the README).
