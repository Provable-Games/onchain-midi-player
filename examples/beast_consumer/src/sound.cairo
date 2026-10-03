//! The tokens' music: a Standard MIDI File and its `SynthSettings`.
//!
//! In the real Beasts integration the MIDI comes from the onchain composer (an `IMidiProvider`
//! reading the Beast's state). For the sample tokens it is a fixed one-bar loop that exercises what
//! the README's "MIDI requirements" ask for. `scripts/reference.mjs` holds a byte-identical copy
//! that the golden test keeps in lockstep. Token 4 uses a synthetic score the size of the
//! composer's largest production score, and the Beast reference sounds.

use onchain_tinysynth::types::{Operator, SynthSettings, Timbre, Waveform};

/// Format 0, PPQ 48, one 4/4 bar at 120 BPM (192 ticks), 112 bytes.
///
/// - Tempo, time signature, program change and CC7/CC10 at tick 0.
/// - Channel 1: four quarter notes (C5 E5 G5 C6) on program 80, the custom chip lead.
/// - Channel 10: kick (note 36, the custom drum) and snare (38, built-in).
/// - Running status, and note-on with velocity 0 as note-off.
/// - End-of-Track at tick 192, the bar boundary, which is where the player loops.
pub fn midi() -> ByteArray {
    let mut m: ByteArray = "";
    m.append_word(0x4d546864_00000006, 8); // MThd, header length 6
    m.append_word(0x0000_0001_0030, 6); // format 0, 1 track, PPQ 48
    m.append_word(0x4d54726b_0000005a, 8); // MTrk, track length 90
    m.append_word(0x00_ff5103_07a120, 7); // t=0   tempo 500000 us per quarter (120 BPM)
    m.append_word(0x00_ff5804_04021808, 8); // t=0   time signature 4/4
    m.append_word(0x00_c050, 3); // t=0   ch1 program 80 (custom chip lead)
    m.append_word(0x00_b00764, 4); // t=0   ch1 CC7 volume 100
    m.append_word(0x00_0a40, 3); // t=0   (running status B0) CC10 pan 64
    m.append_word(0x00_b9075a, 4); // t=0   ch10 CC7 volume 90
    m.append_word(0x00_904860, 4); // t=0   ch1 C5 on
    m.append_word(0x00_992464, 4); // t=0   ch10 kick on (note 36: the custom drum)
    m.append_word(0x0c_2400, 3); // t=12  (running) kick off, velocity 0
    m.append_word(0x1c_904800, 4); // t=40  C5 off, velocity 0
    m.append_word(0x08_4c60, 3); // t=48  (running) E5 on
    m.append_word(0x00_992664, 4); // t=48  snare on (note 38)
    m.append_word(0x0c_2600, 3); // t=60  (running) snare off
    m.append_word(0x1c_904c00, 4); // t=88  E5 off
    m.append_word(0x08_4f60, 3); // t=96  (running) G5 on
    m.append_word(0x00_992464, 4); // t=96  kick on
    m.append_word(0x0c_2400, 3); // t=108 (running) kick off
    m.append_word(0x1c_904f00, 4); // t=136 G5 off
    m.append_word(0x08_5460, 3); // t=144 (running) C6 on
    m.append_word(0x00_992664, 4); // t=144 snare on
    m.append_word(0x0c_2600, 3); // t=156 (running) snare off
    m.append_word(0x1c_905400, 4); // t=184 C6 off
    m.append_word(0x08_ff2f00, 4); // t=192 End-of-Track (bar boundary)
    m
}

/// An operator with TinySynth-like defaults, to keep the timbre table short.
fn op(
    route: u8,
    wave: Waveform,
    volume: u32,
    ratio: u32,
    offset_hz: i32,
    attack: u32,
    hold: u32,
    decay: u32,
    sustain: u32,
    release: u32,
    pitch_ratio: u32,
    pitch_time: u32,
) -> Operator {
    Operator {
        route,
        wave,
        volume,
        ratio,
        offset_hz,
        attack,
        hold,
        decay,
        sustain,
        release,
        pitch_ratio,
        pitch_time,
        key_scale: 0,
        filter: Option::None,
    }
}

/// Constant custom sounds. Fixed-point fields are in 1/10_000 units (`FIXED_POINT_SCALE`).
fn timbres() -> Span<Timbre> {
    array![
        // Chip lead on program 80.
        Timbre {
            drum: false,
            slot: 80,
            operators: array![
                // Carrier: triangle, 3 ms attack, full sustain, 33 ms release.
                op(
                    0,
                    Waveform::Triangle,
                    5_000,
                    10_000,
                    0,
                    30,
                    0,
                    100,
                    10_000,
                    330,
                    10_000,
                    10_000,
                ),
                // 6 Hz LFO modulating operator 1's frequency (route 1). ratio 0 fixes its
                // frequency at offset_hz; depth 0.0175 of the carrier frequency (about 30 cents);
                // the 0.2 s attack fades the vibrato in.
                op(1, Waveform::Sine, 175, 0, 60_000, 2_000, 0, 100, 10_000, 330, 10_000, 10_000),
            ]
                .span(),
        },
        // Custom kick on drum note 36: a fixed 120 Hz sine dropping to a quarter of its pitch.
        Timbre {
            drum: true,
            slot: 36,
            operators: array![
                op(0, Waveform::Sine, 10_000, 0, 1_200_000, 0, 200, 1_000, 0, 1_000, 2_500, 500),
            ]
                .span(),
        },
    ]
        .span()
}

/// The token's settings. Timbres and engine settings are constants; only `reverb` varies, derived
/// from the permanent `tier` trait, which keeps each token's sound fixed (README, "Consistency").
/// Varying it also changes `len(SETTINGS)`, so the examples exercise different `D` paddings.
pub fn settings_for(tier: u8) -> SynthSettings {
    let reverb = match tier {
        0 | 1 => 100,
        2 => 30,
        _ => 5,
    };
    SynthSettings {
        quality: 1, reverb, master_vol: 40, voices: 64, waves: [].span(), timbres: timbres(),
    }
}

/// The Beast reference sounds (issue #1): a triangle lead with a 6 Hz vibrato LFO on program 0, a
/// kick (triangle pitch drop plus a noise click) on drum 36 and a snare (noise plus a square body)
/// on drum 38, with no reverb, as the production page has none. Encodes to the 334-byte `SETTINGS`
/// of the root crate's `beast_reference` fixture.
pub fn beast_reference_settings() -> SynthSettings {
    let lead = Timbre {
        drum: false,
        slot: 0,
        operators: array![
            op(0, Waveform::Triangle, 3_000, 10_000, 0, 30, 0, 100, 10_000, 100, 10_000, 10_000),
            op(1, Waveform::Triangle, 175, 0, 60_000, 2_000, 0, 100, 10_000, 100, 10_000, 10_000),
        ]
            .span(),
    };
    let kick = Timbre {
        drum: true,
        slot: 36,
        operators: array![
            op(0, Waveform::Triangle, 4_000, 0, 1_600_000, 30, 370, 500, 0, 500, 2_813, 300),
            op(0, Waveform::WhiteNoise, 1_000, 0, 4_400_000, 20, 0, 30, 0, 500, 10_000, 10_000),
        ]
            .span(),
    };
    let snare = Timbre {
        drum: true,
        slot: 38,
        operators: array![
            op(0, Waveform::WhiteNoise, 3_500, 0, 2_640_000, 30, 0, 500, 0, 500, 10_000, 10_000),
            op(0, Waveform::Square, 700, 0, 2_000_000, 30, 0, 200, 0, 500, 5_500, 170),
        ]
            .span(),
    };
    SynthSettings {
        quality: 1,
        reverb: 0,
        master_vol: 40,
        voices: 64,
        waves: [].span(),
        timbres: array![lead, kick, snare].span(),
    }
}

/// The token's MIDI: the sample loop, or for token 4 the full-size synthetic score (3,716 bytes).
pub fn token_midi(token_id: u256) -> ByteArray {
    if token_id == 4 {
        crate::beast_data::heaviest_midi()
    } else {
        midi()
    }
}

/// The token's settings: `settings_for(tier)`, or for token 4 the Beast reference sounds.
pub fn token_settings(token_id: u256, tier: u8) -> SynthSettings {
    if token_id == 4 {
        beast_reference_settings()
    } else {
        settings_for(tier)
    }
}
