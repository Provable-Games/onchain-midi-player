# Operator fields

`Operator` in [`src/types.cairo`](https://github.com/Provable-Games/onchain-tinysynth/blob/main/src/types.cairo), which documents each field. Ranges and defaults are stored integers: fixed point, value / 10,000. The ranges are the checks of `settings::validate` ([`src/settings.cairo`](https://github.com/Provable-Games/onchain-tinysynth/blob/main/src/settings.cairo)); the defaults are `default_operator()`, TinySynth's own operator defaults. `npm test` fails if a row here disagrees with the JS reference of those checks.

| Field | TinySynth key | Range (stored) | Default (stored) | Meaning |
| --- | --- | --- | --- | --- |
| `route` | `g` | 0 to 18 | 0 | 0 audio output; 1–10 modulates the frequency (FM) of operator `route`; 11–18 the volume (AM) of operator `route` − 10. Targets must be earlier operators. |
| `wave` | `w` | `Sine`, `Square`, `Sawtooth`, `Triangle`, `WhiteNoise`, `MetallicNoise` | `Sine` | `Custom(i)` reverts in v1 (issue #2). |
| `volume` | `v` | 0 to 1,000,000 | 5,000 | Level (0–100.0): loudness for an output, depth for a modulator. |
| `ratio` | `t` | 0 to 640,000 | 10,000 | Frequency multiple of the note (0–64.0). 0 fixes the frequency at `offset_hz`. |
| `offset_hz` | `f` | -200,000,000 to 200,000,000 | 0 | Frequency offset in Hz (±20,000.0). |
| `attack` | `a` | 0 to 200,000 | 0 | Seconds (0–20.0); 0 jumps straight to full level. |
| `hold` | `h` | 0 to 200,000 | 100 | Seconds (0–20.0). |
| `decay` | `d` | 0 to 200,000 | 100 | Time constant in seconds (0–20.0). On a drum's first operator, × 3.5 is the hit's length. |
| `sustain` | `s` | 0 to 1,000,000 | 0 | Level as a multiple of `volume` (0–100.0). |
| `release` | `r` | 0 to 200,000 | 500 | Time constant in seconds (0–20.0). The voice is cut at 3.5 × this. |
| `pitch_ratio` | `p` | 0 to 160,000 | 10,000 | Pitch envelope target as a multiple of the start frequency (0–16.0). Below 1 drops the pitch (kicks, toms). |
| `pitch_time` | `q` | 0 to 200,000 | 10,000 | Pitch envelope time constant in seconds (0–20.0). |
| `key_scale` | `k` | -80,000 to 80,000 | 0 | Level × 2^((note − 60) / 12 × `key_scale`) (±8.0). Negative softens high notes. |
| `filter` | | `None` | `None` | Reverts in v1 (issue #3). |

The envelope ramps up linearly over `attack`, holds for `hold`, then approaches `sustain` × `volume` with time constant `decay`. After note-off it decays to zero with time constant `release`.
