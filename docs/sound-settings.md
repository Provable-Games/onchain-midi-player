# Sound settings

The consumer passes a typed `TinySynthSettings` value with every `midi_segment` call. The types are declared in [`src/types.cairo`](../src/types.cairo), and the checks and their messages are in [`src/settings.cairo`](../src/settings.cairo).

## Types

| Type | Contents |
| --- | --- |
| `TinySynthSettings` | `quality` (0 chip-tune, 1 FM), `reverb` (`u8` percent, 0 off), `master_vol` (`u8` percent), `voices` (`u8`, at least 1), `waves: Span<WaveDef>` (custom waveforms shared by all timbres, up to 256: `MAX_WAVES`) and `timbres: Span<Timbre>` (up to 175, `MAX_TIMBRES`: each program and drum slot at most once) |
| `Timbre` | A custom sound replacing General MIDI program `slot` (0–127), or drum note `slot` (35–81) when `drum` is true. Holds 1 to 8 operators (`MAX_OPERATORS`) |
| `Operator` | One oscillator, in TinySynth's 13-parameter model: `route` (output, FM or AM target), `wave`, `volume`, `ratio`, `offset_hz`, `attack`, `hold`, `decay`, `sustain`, `release`, `pitch_ratio`, `pitch_time`, `key_scale`, plus an optional `filter`. The values after `wave` are `u32` (`offset_hz` and `key_scale`: `i32`), fixed point ÷10,000, with no limit (see [Engine limits](#engine-limits-on-operator-values)) |
| `Waveform` | `Sine`, `Square`, `Sawtooth`, `Triangle`, `WhiteNoise`, `MetallicNoise`, or `Custom(index)`: entry `index` of `TinySynthSettings.waves` |
| `WaveDef` | `Harmonics(Span<u16>)` (a band-limited wave, at least 1 harmonic) or `Samples(Span<i8>)` (one cycle of a chip wave, played sample-and-hold, at least 1 sample). See [Custom waves](#custom-waves) |
| `Filter` | `LowPass`, `HighPass` or `BandPass`, with a cutoff (in Hz, or a multiple of the note frequency when `key_track` is set) and a linear Q, on an audio-output operator. Fixed, with no envelope. See [Filters](#filters) |

- **Units.** Fractional fields are fixed-point integers in units of `1 / FIXED_POINT_SCALE` (10,000), because Cairo has no floating point. For example `5_000` = 0.5.
- **Validation.** `settings::validate` checks only what the format or the engine requires: `quality` is 0 or 1, `voices` at least 1, the counts, the slots and their uniqueness, the routes and their targets, the wave indices, and that a filter is on an audio output with a cutoff and a Q above 0. Every other number takes any value of its integer type. A failed check reverts with a `'TS: ...'` short string followed by the 0-based indices of the offending wave, timbre or operator, for example `('TS: FM target not earlier', 3, 1)`. Invalid settings never reach the page. The checks and messages are listed in [`src/settings.cairo`](../src/settings.cairo).
- **Selecting sounds.** A MIDI file selects a custom sound the ordinary way: a program change to its slot, or the drum note on channel 10. Only programs 0–127 and drum notes 35–81 are reachable from MIDI.
- **Consistency.** For a given class hash, the same settings and MIDI always produce the same sound. To keep a token's sound fixed, pass constants, or values derived only from permanent traits.
- **Size.** `SETTINGS` is base64-encoded at call time along with the MIDI.
  - It is 16 bytes with the defaults (`1,1,30,40,64,0,0`), plus about 6 bytes per timbre, 50 bytes per operator, 8 to 26 more per filter (a typical one 15 to 18), and 2 to 6 bytes per wave sample or harmonic (about 4.5 per sample at full scale).
  - The three Beast reference sounds (a 2-operator lead, kick and snare) come to 334 bytes.
  - There is no byte cap. Each 1,000 bytes costs about 14.5M L2 gas through `midi_segment` (see [Gas and limits](gas.md#the-size-of-settings)).

## The `SETTINGS` format

The class writes settings into the page as `SETTINGS`, format version 1.

- **Syntax.** A flat list of canonical decimal integers separated by commas (`[0-9,-]` only, so it can never close its `<script>` block).
- **Structure.** Fields in declaration order, a length before every list, enums as their variant index, `bool` as 0/1, and `Option` as 0 (`None`) or 1 followed by the value.
- **Spec.** The grammar, the checks and their messages are in [`src/settings.cairo`](../src/settings.cairo).

```text
1,1,0,40,64,0,3,                                         version, quality, reverb, master_vol, voices, 0 waves, 3 timbres
0,0,2,0,3,3000,10000,0,30,0,100,10000,100,10000,10000,0,0,1,3,175,0,60000,2000,0,100,10000,100,10000,10000,0,0,
1,36,2,…                                                 (Beast reference lead, then kick and snare; line breaks for reading only)
```

The crate exports:

- the pure functions `onchain_midi_player::settings::{validate, encode, validate_and_encode}`;
- the helpers `default_settings()` and `default_operator()` (TinySynth's operator defaults in fixed point);
- the limits as constants (`MAX_TIMBRES`, `MAX_OPERATORS`, `MAX_WAVES`, `MIN_HARMONICS`, `MIN_SAMPLES`, `MIN_VOICES`, …).

## Custom waves

`TinySynthSettings.waves` holds up to 256 wave definitions (`MAX_WAVES`), shared by every timbre. An operator plays entry `i` with `wave: Waveform::Custom(i)` (`'TS: wave index out of range'` past the end). Unused and repeated entries are allowed.

- **`Samples(Span<i8>)`: one cycle, played sample-and-hold.** Each sample `s` is `s / 128`: −128 is −1.0, 0 is 0 and 127 is 0.9921875. The note's frequency is the cycle rate, whatever the table's length: a 64-sample stepped triangle at A4 plays at 440 Hz, stepping 64 × 440 times a second.
- **`Harmonics(Span<u16>)`: a band-limited wave.** Element `i` is the amplitude of harmonic `i + 1`, as a sine term. The browser normalizes the peak to full scale, so only the ratios matter (`[2, 1]` sounds like `[65_535, 32_767]`), and all zeros is silent.
- **Lengths.** At least one sample or harmonic, with no upper bound. A 1-sample table is a constant (DC) level.
- **Pitch bend.** Like the noise waves, a sample wave plays from a buffer, so a note already sounding keeps the bend it started with (see [Messages TinySynth honours](midi-contract.md#messages-tinysynth-honours)). Harmonic waves are oscillators and follow it.
- **Determinism.** The engine generates its reverb and noise from a fixed seed, and the custom waves' tables from their definitions, so they are the same on every load at a given sample rate. Browsers and sample rates differ slightly.

**Reference waves.** [`scripts/reference_waves.mjs`](../scripts/reference_waves.mjs) generates generic chip shapes as `Samples` tables:

| Wave | Samples | Definition |
| --- | --- | --- |
| 4-bit stepped triangle (`triangle4()`) | 64 | Levels 15 down to 0 and back up to 15, each held 2 samples; a level `v` is the sample `17v − 128` |
| 12.5%, 25% and 50% pulses (`pulse(1)`, `pulse(2)`, `pulse(4)`) | 8 | 1, 2 or 4 samples at 127, the rest at −128 |
| 4-bit saw (`saw4()`) | 16 | Levels 0 up to 15 |
| Short LFSR noise (`lfsr("short")`) | 93 | A 15-bit linear-feedback shift register from state 1, as chip noise channels clock it: each step outputs bit 0 (1 is −128, 0 is 127), shifts right and feeds back bit 0 XOR bit 6 |
| Long LFSR noise (`lfsr("long")`) | 32,767 | The same, feeding back bit 0 XOR bit 1 |

- **Melodic waves** (the triangle, pulses and saw) keep their usual `ratio` and `offset_hz`: the note sets the pitch.
- **Noise tables** are set by their step rate: a table of `N` samples steps `N` times per cycle, so use `ratio` 0 and `offset_hz` = steps per second / `N`. The reference snare and hat step the short LFSR at 20 and 40 kHz (`offset_hz` 215.0538 and 430.1075 Hz), and the long-LFSR snare at 48 kHz (1.4649 Hz).
- **Retuning a noise table tuned at the 440 Hz basis.** TinySynth's built-in noise, and a table written straight into the engine's internal `noiseBuf`, play one sample per frame at `playbackRate = f / 440`, so their step rate depends on the sample rate `R` they were tuned at: `R × f / 440`. As a `Samples` wave, the same table steps at `f × N` at every sample rate. To keep the sound, set `f_new = f_old × R / (440 × N)`.

**Cost.** Short chip waves are cheap; long noise tables are not. `midi_segment` through the library call, with a 3,716-byte score:

| Settings (fixtures in [`scripts/settings_fixtures.mjs`](../scripts/settings_fixtures.mjs)) | `SETTINGS` bytes | `midi_segment` |
| --- | --- | --- |
| The 3 Beast reference sounds, no custom wave (`beast_reference`) | 334 | 60.7M |
| One wave: the reference lead on the 64-sample stepped triangle (`one_wave`) | 365 | 61.3M |
| The six short reference waves on eight timbres (`reference_waves`) | 1,356 | 77.2M |
| The long LFSR, 32,767 samples, on one drum timbre (`longLfsr`) | 147,532 | 2,192.8M |

The long LFSR adds about 2.1B to a `token_uri`, which fits Pathfinder's 10B call cap but not every RPC provider's (see [Node limits](gas.md#node-limits)). `WhiteNoise` needs no table and is the cheap alternative.

**In Cairo.** A 12.5% pulse lead and a harmonic organ:

```cairo
use onchain_midi_player::settings::{default_operator, default_settings};
use onchain_midi_player::types::{Operator, TinySynthSettings, Timbre, WaveDef, Waveform};

fn chip_settings() -> TinySynthSettings {
    let waves = [
        WaveDef::Samples([127, -128, -128, -128, -128, -128, -128, -128].span()), // 0: 12.5% pulse
        WaveDef::Harmonics([100, 0, 50, 0, 25].span()), // 1: harmonics 1, 3 and 5
    ]
        .span();
    let voice = |w: u8| Operator {
        wave: Waveform::Custom(w), volume: 3_000, attack: 30, hold: 0, sustain: 10_000, release: 100,
        ..default_operator()
    };
    let lead = Timbre { drum: false, slot: 80, operators: [voice(0)].span() };
    let organ = Timbre { drum: false, slot: 16, operators: [voice(1)].span() };
    TinySynthSettings { waves, timbres: [lead, organ].span(), ..default_settings() }
}
```

## Filters

An audio-output operator (`route` 0) can carry a fixed filter, `filter: Option::Some(Filter { kind, cutoff, key_track, q })`: a Web Audio biquad between the operator's envelope and the channel, set at note-on and released with the voice, with no envelope. FM and AM paths are never filtered, so a filter on a modulator reverts (`'TS: filter on modulator'`).

- **`kind`:** `LowPass`, `HighPass` or `BandPass`.
- **`cutoff`:** the cutoff (low- and high-pass) or centre (band-pass) frequency, fixed point. In Hz; with `key_track`, a multiple of the note's frequency, so a filtered lead keeps the same brightness across the keyboard. That frequency is the note-on frequency with tuning applied, before `ratio`, `offset_hz`, bend, the pitch envelope and modulation, and it is fixed for the note's life. A drum's note is its drum note, so fixed Hz is the usual choice there.
- **`q`:** a conventional linear Q, fixed point: 0.7071 (`7_071`) gives a flat (Butterworth) low- or high-pass, and higher values a resonant peak at the cutoff. A band-pass's bandwidth is the centre frequency ÷ `q`.
- **Validation:** an audio output, and a cutoff and a Q above 0 (`'TS: filter cutoff out of range'`, `'TS: filter q out of range'`). Any `u32` value above 0 is accepted.
- **The Nyquist clamp:** the engine clamps the computed cutoff to 0.45 × the sample rate (21,600 Hz at 48 kHz, 19,845 Hz at 44.1 kHz), so a higher cutoff, or a key-tracked one on high notes, plays as that frequency.
- **Cost:** a filter adds 8 to 26 bytes of `SETTINGS`. Six filtered voices (the `filters` fixture, 465 bytes) cost 62.4M through `midi_segment` with a 3,716-byte score, against 60.7M for the reference sounds.
- **Hi-hats:** metallic noise through a 3 kHz high-pass gives a chip hi-hat, as in the `filters` fixture.

**In Cairo.** A closed chip hi-hat and a key-tracked sawtooth lead:

```cairo
use onchain_midi_player::settings::{default_operator, default_settings};
use onchain_midi_player::types::{Filter, FilterKind, Operator, TinySynthSettings, Timbre, Waveform};

fn filtered_settings() -> TinySynthSettings {
    // Metallic noise at playback rate 390 / 440 through a flat 3 kHz high-pass.
    let hat = Operator {
        wave: Waveform::MetallicNoise, volume: 2_000, ratio: 0, offset_hz: 3_900_000, hold: 0,
        decay: 150,
        filter: Option::Some(
            Filter { kind: FilterKind::HighPass, cutoff: 30_000_000, key_track: false, q: 7_071 },
        ),
        ..default_operator()
    };
    // A sawtooth through a low-pass at 4x the note frequency.
    let lead = Operator {
        wave: Waveform::Sawtooth, volume: 3_000, attack: 30, hold: 0, sustain: 10_000, release: 100,
        filter: Option::Some(
            Filter { kind: FilterKind::LowPass, cutoff: 40_000, key_track: true, q: 7_071 },
        ),
        ..default_operator()
    };
    let timbres = [
        Timbre { drum: true, slot: 42, operators: [hat].span() },
        Timbre { drum: false, slot: 80, operators: [lead].span() },
    ]
        .span();
    TinySynthSettings { timbres, ..default_settings() }
}
```

## Engine limits on operator values

The class bounds no operator value: every field takes any value of its integer type, so composers can use everything the engine can do.

- **A note whose values overflow is skipped.** The operator values multiply into the frequencies and levels the engine passes to Web Audio, which requires them finite as 32-bit floats (at most about 3.4e38). A note's level is multiplied by `2^((note - 60) / 12 * key_scale)`, and an FM modulator's frequency and depth by its target's frequency, so a long FM chain of high ratios, or a large `key_scale`, can overflow at some notes and tunings. The engine then skips the note: it makes no sound, takes no voice and throws nothing, and the song plays on. [`scripts/engine_contract.test.mjs`](../scripts/engine_contract.test.mjs) pins this.
- **How to avoid it.** Keep FM chains short or their ratios low, and `key_scale` moderate. For reference, an 8-operator FM chain with `volume` 100.0, `ratio` 64.0, `pitch_ratio` 16.0, `sustain` 100.0 and `key_scale` ±8.0 sounds at notes 0 and 127 without tuning. A skipped note logs no error, so only listening shows it: preview the score with its settings ([Previewing a score](midi-contract.md#previewing-a-score)) at its highest and lowest notes and its tuning.

## Designing a custom sound

1. **Design the sound** in TinySynth's `soundedit.html` (in the [fork](https://github.com/Provable-Games/webaudio-tinysynth)) or by hand, as a TinySynth timbre: a list of operators `{g, w, t, f, v, a, h, d, s, r, p, q, k}`.
2. **Convert each operator:**
   - `g` becomes `route`;
   - `w` becomes `wave`: `sine`, `square`, `sawtooth`, `triangle`, `n0`, `n1` map to `Sine` … `MetallicNoise`. A wave registered with `setSampleWave` or `setHarmonicWave` becomes an entry of `waves` and `Custom(index)` (see [Custom waves](#custom-waves)), converted to what the format holds:
     - `setSampleWave` samples `x` (−1 to 1) become `i8` samples `clamp(round(x × 128), −128, 127)`; the player plays `s / 128`;
     - of `setHarmonicWave(name, real, imag)`, only non-negative sine amplitudes `imag[1..]` carry over, scaled to `u16` (the browser normalizes the peak, so only the ratios matter). Cosine (`real`) terms, the DC term and negative amplitudes have no `Harmonics` form: such a wave needs a `Samples` table of one cycle instead;
   - multiply every other value by 10,000 and round to an integer: `v` (`volume`), `t` (`ratio`), `f` (`offset_hz`), `a` (`attack`), `h` (`hold`), `d` (`decay`), `s` (`sustain`), `r` (`release`), `p` (`pitch_ratio`), `q` (`pitch_time`), `k` (`key_scale`);
   - `fl`, `ff`, `fq` and `fk` become `filter: Option::Some(Filter { kind, cutoff, key_track, q })`: `lowpass`, `highpass`, `bandpass` map to `LowPass` … `BandPass`, `cutoff` and `q` are `ff` and `fq` × 10,000 (TinySynth's default `fq` is 0.7071, `7_071`), and `key_track` is `fk == 1` (see [Filters](#filters)).

   Fields TinySynth leaves out take its defaults (`default_operator()`).
3. **Respect the engine's rules:**
   - Modulators (`route` 1–10 for FM, 11–18 for AM) must come after the operator they target, so operator 1 always has `route: 0`.
   - Only an audio output (`route: 0`) may have a filter.
   - The first operator's `decay` × 3.5 is the length of every drum note.
   - The first operator's `release` × 3.5 is how long a melodic voice lasts after note-off.
4. **Choose a slot.** Put the timbre in a program slot (0–127) or a drum slot (35–81), and select it from the MIDI with a program change or a drum note on channel 10.

The Beast reference lead, as Cairo:

```cairo
use onchain_midi_player::settings::default_operator;
use onchain_midi_player::types::{Operator, Timbre, Waveform};

// Triangle carrier, 3 ms attack, full sustain, 10 ms release.
let carrier = Operator {
    wave: Waveform::Triangle, volume: 3_000, attack: 30, hold: 0, sustain: 10_000, release: 100,
    ..default_operator()
};
// 6 Hz triangle LFO on operator 1's frequency: +-30 cents (2^(30/1200) - 1 = 0.0175), faded in over 0.2 s.
let lfo = Operator {
    route: 1, wave: Waveform::Triangle, volume: 175, ratio: 0, offset_hz: 60_000, attack: 2_000,
    hold: 0, sustain: 10_000, release: 100, ..default_operator()
};
let lead = Timbre { drum: false, slot: 0, operators: [carrier, lfo].span() };
```

The kick and snare are in [`scripts/settings_fixtures.mjs`](../scripts/settings_fixtures.mjs). `npm run render-check` renders all three in a headless browser and measures them (see [Development](development.md#browser-validation)).
