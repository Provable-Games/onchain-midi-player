# MIDI contract

What a composer can rely on, and what the page rejects. The `midi` argument of `midi_segment` is a Standard MIDI File passed as a `ByteArray`. The class embeds it as base64 and never parses it, so a file that breaks a rule here does not revert: the page shows the error, ▶ stays disabled, and the art still shows. Check files before they go onchain with [`check-midi`](#checking-midi-files), which runs the page's own check.

Every rule below is fixed per class hash: the checks are `checkMidi` and `decodeMidi` in [`player/player.js`](../player/player.js), and playback is the pinned engine driven by that player. A new engine pin can change the playback rules. [`scripts/engine_contract.test.mjs`](../scripts/engine_contract.test.mjs) pins the less obvious ones, so a re-pin that changes one of them fails `npm test`.

## Accepted format

`checkMidi` rejects a file unless it meets every rule below. Its errors read `midi: <message> (byte <offset>)`, where the offset is where reading stopped.

| Rule | Message |
| --- | --- |
| The file starts with an `MThd` chunk of length 6. | `not a Standard MIDI File` |
| Format 0 or 1. | `format 2 is not supported` (with the file's format number) |
| At least one track, and exactly one in format 0. | `bad track count` |
| The time division counts ticks per quarter note, 1–32,767. SMPTE timing (top bit set) and 0 are rejected. | `SMPTE or zero time division is not supported` |
| Every chunk after the header, up to the declared number of tracks, is an `MTrk` chunk. | `expected MTrk` |
| Each `MTrk` length stays inside the file. | `MTrk length past the end of the file` |
| Every chunk ends inside the file, and every event inside its chunk. A track with no End-of-Track runs past its chunk and fails here. | `truncated` |
| Delta times and lengths take at most 4 bytes. | `bad variable-length number` |
| End-of-Track (`FF 2F 00`) is the last event of every chunk, so chunk lengths are exact. | `End-of-Track is not at the end of its track` |
| Nothing follows the last track. | `trailing bytes after the last track` |
| Running status follows a channel message in the same track: not at the start of a track, nor after a meta or SysEx event. | `running status without a channel status` |
| Channel message data bytes are 0–127. | `bad data byte` |
| Tempo is exactly `FF 51 03 tt tt tt` (the length a single byte) and not 0. | `bad tempo` |
| Text, copyright, track name, instrument name and device name events (`FF 01`–`FF 04`, `FF 09`) are at most 4,096 bytes. | `text event longer than 4096 bytes` |
| Each SysEx is one `F0` event that holds the whole message and ends with `F7`. | `SysEx not complete in one event` |
| No `F7` events (SysEx continuation or escape). | `SysEx continuation or escape (F7) events are not supported` |
| No other system status bytes as events (`F1`–`F6`, `F8`–`FE`). | `unexpected status byte` |
| One pass lasts at least 50 ms: `maxTick` (see [Playback](#playback)) under the tempo map, which starts at 120 BPM. | `loop shorter than 50 ms` |

Everything else is accepted: any channel message, other meta events and SysEx of any length, and tempo events in any track. The page also rejects a MIDI block that is not strict base64 (`midi: not base64`). The class always writes valid base64, so only `check_midi.mjs` and the `token_uri` validator (which passes the page's MIDI block to the same check) report it, for a bad base64 input.

The rules follow from how the TinySynth engine reads a file: it stops reading a track at End-of-Track rather than at the chunk length, keeps running status across tracks and after meta and SysEx events, reads tempo at a fixed offset, and turns F7 events into SysEx. On a loop under 50 ms its scheduler would never catch up, and a longer text event can exceed a browser's argument limit.

## Playback

- **Start.** Nothing plays until ▶ is pressed (a click or tap). Each ▶ reloads the MIDI and plays it from tick 0, after resetting every channel: program 0, volume (CC7) 100, pan (CC10) 64, expression (CC11) 127, modulation 0, sustain off, pitch bend centred, bend range MSB 2 (see RPN 0 below), fine, coarse, master and GS scale tuning 0, and channel 10 as the only drum channel. The tempo is 120 BPM until the first tempo event. Tick 0 sounds 0.1 s after playback starts (once the browser has resumed audio), and a rest before the first event is kept: every event sounds at its own tick's time.
- **Tracks.** The TinySynth engine merges all tracks into one list by tick; events at the same tick keep file order, track by track. A track does not loop on its own: if it ends before the others, it sends no more events until the next pass, but notes it left sounding (with no note-off yet) keep sounding.
- **Tempo.** A tempo change takes effect at its tick, from any track. The BPM is 60,000,000 divided by the tempo value, kept fractional.
- **Loop.** The song always loops. A pass ends at `maxTick`, the latest End-of-Track tick of any track (the player calls `setLoop(1)` and `setLoopEnd(maxTick)`), and the next pass starts at tick 0, keeping the rest before the first event.
- **State between passes.** At each loop point the tempo returns to 120 BPM, and a tempo event at tick 0 applies at once. Nothing else is reset: programs, controllers, pitch bend, RPN settings and tuning carry over from the end of the previous pass, and notes still sounding at End-of-Track keep sounding. Events at tick 0 run again on every pass, so a song that sets its state at tick 0 starts every pass the same way. Otherwise the first pass starts from the defaults above, and later passes from wherever the previous one ended.
- **The art.** The player restarts the art when tick 0 is heard, on ▶ and again at every pass (see [The player page](token-uri-layout.md#the-player-page)). A pass that is a whole multiple of every period of the art's animation keeps them in step with no visible jump. Otherwise the art jumps back to its start at every loop point, and an animation longer than the pass never finishes.
- **■** stops playback: the TinySynth engine's `stopMIDI` cuts every voice (drum hits and notes already scheduled ahead included), and cancels the volume, expression, pan and modulation changes it had already scheduled. The art keeps running.
- **Scheduling.** The TinySynth engine schedules events about 0.2 s ahead. Each message takes effect at its own time, except CC120, CC121 and CC123–127 (see below) and the voice limit (see [Limits](#limits)), which act when the event is scheduled.
- **Notes the engine cannot compute.** A note whose computed frequencies or levels overflow the 32-bit float range, at a high note or tuning on a long FM chain or with a large `key_scale`, is skipped: it makes no sound and takes no voice, and the song plays on (see [Engine limits on operator values](sound-settings.md#engine-limits-on-operator-values)). Tuning adds to the note's pitch, so upward tuning can push such a timbre over.

## Channels and instruments

- **16 channels.** Port and channel-prefix meta events are ignored.
- **Channel 10 (index 9) is percussion.** A note-on from 35 to 81 plays that drum; other notes are silent. Note-offs are ignored: a hit lasts 3.5 × the decay of its sound's first operator. Program changes on channel 10 have no effect.
- **The other channels are melodic.** Program changes 0–127 select the General MIDI instrument, and notes 0–127 all play. Bank select (CC0, CC32) is ignored, so there are 128 programs.
- **Built-in sounds.** `TinySynthSettings.quality` picks the TinySynth engine's built-in set: 0 chip-tune (one oscillator per note), 1 FM.
- **Custom sounds.** Each entry of `TinySynthSettings.timbres` replaces program `slot` (0–127) or drum note `slot` (35–81) for the whole song. The MIDI selects it the ordinary way: a program change to the slot, or that drum note on channel 10.

## Messages TinySynth honours

| Message | Effect |
| --- | --- |
| Note on (`9n`) | Velocity 1–127; velocity 0 is a note-off. Loudness follows velocity squared, (velocity / 128)²; FM depth does not change with velocity. |
| Note off (`8n`) | Releases every note of that pitch on the channel that started at or before it and has had no note-off yet. Its velocity is ignored. Each operator is released from the level it has reached: one still in its attack fades out from part of the way up, so a note shorter than its timbre's attack still sounds, more quietly. A note-off at the note-on's own time leaves only the release of the operators with no attack. |
| Program change (`Cn`) | Selects the instrument for the channel's following notes. |
| Pitch bend (`En`) | Bends the channel by (value − 8192) / 8192 × the bend range. Every note that starts later takes the new bend, drum hits included. Of the notes already sounding, it retunes only the oscillator operators of melodic notes: noise operators (`WhiteNoise`, `MetallicNoise` and the built-in noise sounds), custom `Samples` waves (which play from a buffer, as noise does) and drum hits keep the bend they started with. A filter's cutoff never follows the bend: a key-tracked one is set from the note-on frequency before bend (see [Filters](sound-settings.md#filters)). |
| CC1 modulation | Vibrato of ±(value × 100 / 127) cents from one 5 Hz sine LFO, shared by all channels. |
| CC7 volume, CC11 expression | Channel gain 3 × (CC7 / 127)² × (CC11 / 127)². |
| CC10 pan | Position (value − 64) / 64: 0 is left, 64 centre, 127 almost fully right. |
| CC64 sustain | At 64 or more, notes that get a note-off keep sounding; below 64 releases them. |
| CC101 and CC100 (RPN), CC6 and CC38 (data entry) | RPN 0, bend range: full scale is (MSB × 128 + LSB) × 100 / 127 cents, so the default MSB 2 gives about ±201.6 cents, not ±200. RPN 1, fine tuning: 14 bits, ±1 semitone around 8192. RPN 2, coarse tuning: MSB − 64 semitones. Other RPNs are ignored. |
| CC98, CC99 (NRPN) | Deselect the RPN, so the data entry that follows is ignored. |
| CC120, CC123–127 | Cut every melodic note on the channel at once, when scheduled: up to about 0.2 s before the message's time, including notes due in that window. Drum hits are not cut. |
| CC121 reset all controllers | When scheduled: expression 127, modulation 0, RPN deselected, sustain off, and pitch bend centred for new notes. Notes held by sustain are not released: they sound until the next CC64 below 64, the voice limit or ■. |
| SysEx `F0 7F dd 04 03 ll mm F7` | GM master fine tuning: (mm × 128 + ll − 8192) / 8192 semitones. |
| SysEx `F0 7F dd 04 04 ll mm F7` | GM master coarse tuning: mm − 64 semitones. |
| GS SysEx `F0 41 dd 42 12`, address, data, checksum, `F7`, at its standard length (device ID and checksum are not checked) | `40 00 00`: master tune, four data nibbles n, (n − 0x400) × 0.1 cent. `40 00 05`: master key-shift, data − 64 semitones. `40 1x 40` to `40 1x 4B`: scale tuning of C to B, data − 64 cents. `40 1x 15`: use for rhythm part, which makes part x's channel a drum channel (data not 0) or melodic (0); notes on a melodic channel 10 skip their release envelope. Part x: 0 is channel 10, 1–9 are channels 1–9, A–F channels 11–16. |
| Meta `FF 51` (tempo), `FF 2F` (End-of-Track) | See [Playback](#playback). |

Ignored, with no effect: every other controller, including bank select (CC0, CC32), CC91 reverb send (reverb is engine-wide: `TinySynthSettings.reverb`), CC93 chorus, portamento (CC5, CC65), CC66 sostenuto, CC67 soft pedal, the sound controllers (CC70–79) and CC122 local control; polyphonic aftertouch (`An`) and channel pressure (`Dn`); every other SysEx, including GM System On, GS Reset and GM Master Volume (master volume is `TinySynthSettings.master_vol`); and every other meta event (text, markers, lyrics, time and key signatures).

## Limits

- **Polyphony:** at most `TinySynthSettings.voices` (at least 1) melodic notes at once, across all channels. A note beyond that cuts a released note first (the one ending soonest), otherwise the held note that started earliest (of notes that started together, the one latest in the file). The cut happens when the new note is scheduled, up to about 0.2 s before it sounds, so the cut note ends early. A drum hit takes no voice and is never cut, but it applies the limit too: right after one, at most `voices` − 1 melodic notes remain, so with `voices` 1 every drum hit cuts the melody.
- **Range:** 16 channels, programs 0–127, notes 0–127 (drum notes 35–81), and velocity 1–127, with loudness following its square.
- **Timing:** 1–32,767 ticks per quarter note, tempo 1–16,777,215 µs per quarter note, and a pass of at least 50 ms.
- **Size:** text events at most 4,096 bytes. Nothing else in the page limits the size; gas does (see the recommendations).
- **Mix:** master volume and reverb are `TinySynthSettings.master_vol` and `TinySynthSettings.reverb`, the same for the whole song. MIDI cannot change them.

## What's fixed and what's driven

- **Fixed per class hash:** the engine, the player and the page, and so every rule in this section. A new engine or page means a new class hash and `version()`.
- **Driven on each call:** the MIDI (by the composer), and the `TinySynthSettings` and the art (by the consumer).

The full list is in [Verifying the engine](verifying.md).

## Recommendations (optional)

Nothing checks these; a file that ignores them still plays.

- **Set the state at tick 0:** tempo, program, volume (CC7), pan (CC10), and any controller or GS scale tuning the song changes, so that every pass, and every ▶, starts the same way.
- **Put End-of-Track at the loop point:** the latest End-of-Track should sit exactly where the song loops, such as the last bar line.
- **Make the pass a whole multiple of the art's animation periods:** the art restarts at every loop point, so any other length makes it jump there (see the [`midi-guide`](../plugins/onchain-midi-player/skills/midi-guide/SKILL.md) skill for measuring the periods).
- **Release every note by End-of-Track:** a note still held there sounds into the next pass.
- **Put the note-off first:** at one tick, put a note's note-off before the next note-on of the same pitch on that channel. The other way round, the note-off releases the new note too.
- **Prefer note-offs to CC120–127, and avoid CC121** (see the table).
- **Keep the file small:** `midi_segment` base64-encodes the MIDI at call time, once on its own and twice inside `D`, so gas grows with its length. That is about 14M L2 gas per 1,000 bytes (1.4M with no MIDI and 53.5M with 3,716 bytes, in [the `midi_segment` table](gas.md#midi_segment-by-midi-and-settings-size)).

## Checking MIDI files

[`scripts/check_midi.mjs`](../scripts/check_midi.mjs) runs the page's own `checkMidi` and `decodeMidi`, imported from `player/player.js`, so a score passes exactly when this checkout's player loads it. It needs Node 22 or later and no `npm install`:

```sh
node scripts/check_midi.mjs song.mid                  # a MIDI file
node scripts/check_midi.mjs a.mid b.mid scores.json   # several inputs at once
node scripts/check_midi.mjs scores.json               # every "midi_b64" string in a JSON file
node scripts/check_midi.mjs TVRoZAAAAAYAAQAG...       # a base64 string (MIDI in base64 starts with TVRoZA)
node scripts/check_midi.mjs - < song.b64              # standard input: MIDI bytes, base64 text or JSON
npm run check-midi -- song.mid                        # the same, through npm
```

- **Inputs.** `.mid` and `.midi` files, and files starting with `MThd`, are MIDI. In a JSON file of any shape, every `midi_b64` string is checked and named by the `name` string next to it, as in [`tests/fixtures/page.json`](../tests/fixtures/page.json) and the synthetic scores in [`tests/fixtures/midi/scores.json`](../tests/fixtures/midi/scores.json). Any other text file is read as base64, ignoring line breaks and spaces (so `base64 song.mid > song.b64` works as it is).
- **Output.** For each score, PASS or FAIL and the size. A failure gives the page's exact error. A pass gives the loop length, `maxTick`, each track's End-of-Track tick and channels, and each channel's notes and programs, with the drum notes on channel 10 (or that it is not used):

  ```text
  PASS song.mid
    816 bytes, format 1, 6 tracks, 480 ticks per quarter note
    loop 25.480 s, maxTick 26880 (the latest End-of-Track: the player loops there)
    track 1: End-of-Track at tick 0, no channel events
    track 2: End-of-Track at tick 9600, 15 notes on channel 1
    …
    channel 1: 15 notes, no program change (program 0)
    …
    channel 10 (drums): not used
  FAIL bad.mid
    midi: running status without a channel status (byte 24)
    32 bytes
  ```
- **Exit status.** 0 if every score passes, 1 if any fails, and 2 for a usage error or an input it cannot read (a missing file, invalid JSON, or JSON with no `midi_b64` string), so it can gate another repository's CI.
- **Where to run it.** It imports `player/player.js`, so run it from a checkout of this repository rather than copying the file alone. It checks against that checkout's player, and a declared class keeps the player it was declared with. So use a checkout whose `VERSION` (in `src/page_data.cairo`) is the `version()` of the class your consumer stores: its release tag `v<version>`, or `main` while its `VERSION` matches. In another repository's CI, for example:

  ```sh
  REF=main   # or v<version>, the release tag of the class you target
  git clone --depth 1 --branch "$REF" https://github.com/Provable-Games/onchain-midi-player "$RUNNER_TEMP/onchain-midi-player"
  node "$RUNNER_TEMP/onchain-midi-player/scripts/check_midi.mjs" path/to/*.mid
  ```

## Previewing a score

[`scripts/preview.mjs`](../scripts/preview.mjs) writes the page a token would get, offline: `PAGE ++ D ++ SVG`, byte for byte as the class and a consumer produce it (built with [`scripts/page.mjs`](../scripts/page.mjs)). It needs Node 22 or later and no `npm install`. Run it from a checkout whose `VERSION` (in `src/page_data.cairo`) is your class's `version()` (see [Agent skills](../README.md#agent-skills)).

```sh
npm run preview -- song.mid                                        # default settings, placeholder art
npm run preview -- song.mid --settings sound.json --svg art.svg   # the token's settings and art
npm run preview -- song.mid --serve                                # also serve it on http://127.0.0.1:8000/
```

- **Checks first.** It runs the MIDI through `checkMidi` and reports it as `check_midi.mjs` does; the settings through `player/validate.js` and `player/encode.js`, the JS reference of `settings::validate` and the encoder, printing the panic data `midi_segment` would revert with; and the SVG through the [art rule](token-uri-layout.md#art-svg-requirements). Any failure exits 1 and writes nothing.
- **Inputs.** The MIDI in any form `check_midi.mjs` reads (one score). `--settings` takes a `TinySynthSettings` value as JSON, in the shape of the `settings` objects in [`tests/fixtures/settings.json`](../tests/fixtures/settings.json) (a whole fixture entry also works; every field is required and unknown fields are rejected), or a page's `SETTINGS` text, so a deployed token's page can be rebuilt from its blocks. `--out` defaults to `preview.html`; `--serve` takes an optional port (0 picks a free one).
- **Identity.** `npm test` checks that, for the example's token 1, the output equals [`examples/beast_consumer/fixtures/animation.html`](../examples/beast_consumer/fixtures/animation.html), decoded from the golden `token_uri` the contract matches byte for byte, and that the `token_uri` around token 4's page has the digest the contract's is tested against.
- **Playback** is the same engine and player code as in every token. Audio can still differ slightly across browsers and sample rates. Noise and reverb are generated from a fixed seed, so they are the same on every load at a given sample rate.
