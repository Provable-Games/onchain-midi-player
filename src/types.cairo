//! Consumer-supplied sound settings for `midi_segment`.
//!
//! `crate::settings::validate` checks only what the format or the engine requires: `quality`
//! is 0 or 1, `voices` at least 1, the counts, slots and routes, and the gates below. Every
//! other numeric field takes any value of its integer type. At extremes, `key_scale`, and `ratio`
//! in long FM chains, make the engine compute non-finite values and throw while playing (README,
//! "Extreme operator values").
//! Custom waveforms (issue #2) and filters (issue #3) are part of the types and of the
//! `SETTINGS` grammar already, but are rejected until those issues land. `midi_segment` reverts
//! with a descriptive error when a check fails; the exact checks, their order and their
//! messages are listed in `crate::settings`. This is the only place they are enforced: the
//! player page parses `SETTINGS` strictly but does not repeat them.
//!
//! # Fixed-point numbers
//!
//! Cairo has no floating point. Every fractional field is an integer in units of
//! `1 / FIXED_POINT_SCALE`: with a scale of 10_000, `5_000` means 0.5 and `-12_000` means
//! -1.2. The player divides by the scale before handing values to TinySynth.
//!
//! # How settings reach the browser
//!
//! The class writes the settings into the page next to the MIDI, as an inert block of
//! ASCII digits, `-` and `,` (the `SETTINGS` format, specified in `crate::settings`). The
//! player reads that block, configures TinySynth, registers the custom waves, then installs
//! each `Timbre` with `setTimbre`. Values are treated as data only, never evaluated. Custom
//! timbres are installed after construction and after the quality mode is applied, because
//! TinySynth's `setQuality()` resets every program and drum to the built-ins.
//!
//! # Wire tags
//!
//! The variant order of `Waveform`, `WaveDef` and `FilterKind` is their tag in `SETTINGS`.
//! Variants must never be reordered or inserted; a new variant may only be appended.
//!
//! # Consistency
//!
//! For a given class hash, the same `SynthSettings` and MIDI always produce the same
//! sound. Consumers that need a token's sound to stay fixed should pass constants, or
//! values derived only from permanent token traits.

/// Denominator for every fixed-point field: a stored value `x` means `x / 10_000`.
pub const FIXED_POINT_SCALE: u32 = 10_000;

/// Engine-wide settings plus optional custom sounds, passed to `midi_segment`.
///
/// Defaults (`crate::settings::default_settings()`): `quality: 1, reverb: 30,
/// master_vol: 40, voices: 64, waves: [].span(), timbres: [].span()`. The volume default
/// is below TinySynth's 50 because dense passages clipped at 50 in quality 1.
#[derive(Copy, Drop, Serde, PartialEq, Debug)]
pub struct SynthSettings {
    /// Built-in timbre set: 0 = chip-tune (one oscillator per note), 1 = FM (two or more).
    /// Range: 0 or 1.
    pub quality: u8,
    /// Reverb level in percent. 0 turns reverb off. Any `u8`: 100 is TinySynth's full level,
    /// and higher values are louder still.
    pub reverb: u8,
    /// Master volume in percent of full scale. Any `u8`; above 100 can clip.
    pub master_vol: u8,
    /// Maximum simultaneous notes; the oldest note is cut beyond this. At least 1, any `u8`.
    pub voices: u8,
    /// Custom waveforms shared by every timbre in this call; operators select one with
    /// `Waveform::Custom(index)`, 0-based. 0..=256 entries, all that `Custom(u8)` can index;
    /// unused and repeated entries are allowed; each is registered once, in order, before any
    /// timbre is installed.
    /// Must be empty until issue #2 lands (`'TS: custom wave unsupported'`).
    pub waves: Span<WaveDef>,
    /// Custom sounds replacing built-in programs or drum notes. Empty means built-ins only.
    /// At most 175 timbres per call: each `(drum, slot)` pair may appear once, and there are 128
    /// programs and 47 drum notes. The encoded `SETTINGS` has no byte cap; it is about 50 bytes per
    /// operator plus 6 per timbre, and its gas grows with it (see the README).
    pub timbres: Span<Timbre>,
}

/// One custom sound, replacing a General MIDI program or a drum note.
///
/// MIDI selects it the ordinary way: a program change to `slot` on a melodic channel, or
/// note `slot` on the percussion channel (channel 10). Only these slots are reachable from
/// a MIDI file; TinySynth ignores bank select.
#[derive(Copy, Drop, Serde, PartialEq, Debug)]
pub struct Timbre {
    /// `false`: replaces program `slot` (range 0..=127).
    /// `true`: replaces drum note `slot` (range 35..=81).
    pub drum: bool,
    pub slot: u8,
    /// The oscillators that make up the sound, in order. Range: 1..=8 operators.
    pub operators: Span<Operator>,
}

/// One oscillator of a timbre: TinySynth's operator model with its 13 parameters, plus an
/// optional filter.
///
/// The operator's frequency is `note_frequency * ratio + offset_hz`. Its envelope ramps up
/// linearly over `attack`, holds for `hold`, then approaches `sustain * volume` with time
/// constant `decay`. After note-off it decays to zero with time constant `release`.
///
/// TinySynth field names are given in brackets, with its defaults:
/// `{g:0, w:"sine", t:1, f:0, v:0.5, a:0, h:0.01, d:0.01, s:0, r:0.05, p:1, q:1, k:0}`.
#[derive(Copy, Drop, Serde, PartialEq, Debug)]
pub struct Operator {
    /// [`g`] Where the output goes. 0 = audio output. 1..=10 = modulates the frequency
    /// (FM) of operator `route` (1-based). 11..=18 = modulates the volume (AM) of operator
    /// `route - 10`. FM and AM targets must be earlier operators in the same timbre, so the
    /// first operator always has `route == 0`.
    pub route: u8,
    /// [`w`] Waveform.
    pub wave: Waveform,
    /// [`v`] Level, fixed-point. For an audio-output operator this is loudness; for a
    /// modulator it is depth. No limit.
    pub volume: u32,
    /// [`t`] Frequency multiple of the note, fixed-point. 0 makes the frequency fixed at
    /// `offset_hz`, which is how LFOs (for example 6 Hz vibrato) are built.
    /// No limit.
    pub ratio: u32,
    /// [`f`] Frequency offset in Hz, fixed-point. No limit: Web Audio clamps frequencies.
    pub offset_hz: i32,
    /// [`a`] Attack time in seconds, fixed-point; 0 jumps straight to full level.
    /// No limit.
    pub attack: u32,
    /// [`h`] Hold time in seconds, fixed-point. No limit.
    pub hold: u32,
    /// [`d`] Decay time constant in seconds, fixed-point. No limit.
    pub decay: u32,
    /// [`s`] Sustain level as a multiple of `volume`, fixed-point. No limit.
    pub sustain: u32,
    /// [`r`] Release time constant in seconds, fixed-point. TinySynth cuts the voice at
    /// 3.5 times this. No limit.
    pub release: u32,
    /// [`p`] Pitch envelope target as a multiple of the starting frequency, fixed-point.
    /// 1 = no pitch change; below 1 = pitch drop (kicks, toms). No limit.
    pub pitch_ratio: u32,
    /// [`q`] Pitch envelope time constant in seconds, fixed-point. No limit.
    pub pitch_time: u32,
    /// [`k`] Volume key scaling, fixed-point: level is multiplied by
    /// `2^((note - 60) / 12 * key_scale)`. Negative values soften high notes. No limit.
    pub key_scale: i32,
    /// Optional fixed filter on this operator's output (issue #3). Allowed only when
    /// `route == 0`. Must be `None` until issue #3 lands (`'TS: filter unsupported'`).
    pub filter: Option<Filter>,
}

/// Operator waveform. Variant order is the wire tag (0..=6).
#[derive(Copy, Drop, Serde, PartialEq, Debug)]
pub enum Waveform {
    Sine,
    Square,
    Sawtooth,
    Triangle,
    /// White noise (TinySynth `n0`). Deterministic once fork issue #7 lands.
    WhiteNoise,
    /// Metallic noise (TinySynth `n1`). Deterministic once fork issue #7 lands.
    MetallicNoise,
    /// Entry `index` (0-based) of `SynthSettings::waves` (issue #2). Rejected until #2 lands
    /// (`'TS: custom wave unsupported'`).
    Custom: u8,
}

/// A custom waveform definition, shared through `SynthSettings::waves` (issue #2).
#[derive(Copy, Drop, Serde, PartialEq, Debug)]
pub enum WaveDef {
    /// Band-limited wave from harmonic amplitudes: element `i` is the relative amplitude of
    /// harmonic `i + 1`. At least 1 element, with no upper bound: the engine takes any length
    /// (fork issue #26, decision D-028).
    Harmonics: Span<u16>,
    /// Single-cycle wave from samples, played sample-and-hold at the note's pitch, giving
    /// exact chip waveforms such as a 4-bit stepped triangle or a 12.5% pulse. Each sample
    /// maps -128..=127 to -1.0..=1.0. At least 1 sample, with no upper bound: the engine takes any
    /// length (fork issue #26, decision D-028).
    Samples: Span<i8>,
}

/// Fixed filter applied to an operator's output (issue #3). It has no envelope.
#[derive(Copy, Drop, Serde, PartialEq, Debug)]
pub struct Filter {
    pub kind: FilterKind,
    /// Cutoff or centre frequency, fixed-point. In Hz (range 20.0..=20_000.0) when
    /// `key_track` is false. As a multiple of the note frequency (range 0.25..=16.0) when
    /// `key_track` is true, so brightness stays even across the keyboard.
    pub cutoff: u32,
    pub key_track: bool,
    /// Resonance (Q), fixed-point. Range: 0.1..=30.0.
    pub q: u32,
}

/// Filter response.
#[derive(Copy, Drop, Serde, PartialEq, Debug)]
pub enum FilterKind {
    LowPass,
    HighPass,
    BandPass,
}
