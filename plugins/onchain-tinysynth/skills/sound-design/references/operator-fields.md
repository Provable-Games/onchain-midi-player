# Operator fields

`Operator` in [`src/types.cairo`](https://github.com/Provable-Games/onchain-tinysynth/blob/main/src/types.cairo), which documents each field. Values are stored integers of the Cairo type shown; fractional fields are fixed point, value / 10,000. Defaults are `default_operator()`, TinySynth's own operator defaults. What the class rejects is the check table in [`src/settings.cairo`](https://github.com/Provable-Games/onchain-tinysynth/blob/main/src/settings.cairo), in the checkout that matches your class. Numbers take any value of their type, except the rows marked *engine limit*: an interim bound because the pinned engine fails beyond it ([Engine limits on operator values](https://github.com/Provable-Games/onchain-tinysynth/blob/main/README.md#engine-limits-on-operator-values); the values are in the check table). This table gives no ranges, because they can differ between class versions. `npm test` fails if a row here disagrees with `player/settings.js` or the fixture defaults.

| Field | TinySynth key | Type | Default (stored) | Meaning |
| --- | --- | --- | --- | --- |
| `route` | `g` | `u8` | 0 | 0 audio output; 1–10 modulates the frequency (FM) of operator `route`; 11–18 the volume (AM) of operator `route` − 10. Targets must be earlier operators. |
| `wave` | `w` | `Waveform` | `Sine` | `Sine`, `Square`, `Sawtooth`, `Triangle`, `WhiteNoise`, `MetallicNoise`, or `Custom(i)`: entry `i` of `SynthSettings.waves` (issue #2, from `page.9`; an earlier class reverts it). The player passes it as `w` `nS<i>` or `wH<i>`. |
| `volume` | `v` | `u32` | 5,000 | Level: loudness for an output, depth for a modulator. *Engine limit.* |
| `ratio` | `t` | `u32` | 10,000 | Frequency multiple of the note. 0 fixes the frequency at `offset_hz`. *Engine limit.* |
| `offset_hz` | `f` | `i32` | 0 | Frequency offset in Hz. |
| `attack` | `a` | `u32` | 0 | Seconds; 0 jumps straight to full level. |
| `hold` | `h` | `u32` | 100 | Seconds. |
| `decay` | `d` | `u32` | 100 | Time constant in seconds. On a drum's first operator, × 3.5 is the hit's length. |
| `sustain` | `s` | `u32` | 0 | Level as a multiple of `volume`. *Engine limit.* |
| `release` | `r` | `u32` | 500 | Time constant in seconds. The voice is cut at 3.5 × this. |
| `pitch_ratio` | `p` | `u32` | 10,000 | Pitch envelope target as a multiple of the start frequency. Below 1 drops the pitch (kicks, toms). *Engine limit.* |
| `pitch_time` | `q` | `u32` | 10,000 | Pitch envelope time constant in seconds. |
| `key_scale` | `k` | `i32` | 0 | Level × 2^((note − 60) / 12 × `key_scale`). Negative softens high notes. *Engine limit.* |
| `filter` | | `Option<Filter>` | `None` | `Some` reverts in v1 (issue #3). |

The envelope ramps up linearly over `attack`, holds for `hold`, then approaches `sustain` × `volume` with time constant `decay`. After note-off it decays to zero with time constant `release`.
