---
name: midi-guide
description: Drive the onchain MIDI player for NFTs (Provable-Games/onchain-midi-player) with Standard MIDI Files. Preview a .mid offline in the exact page the chain serves, check it against the player's strict MIDI contract, and learn only where the player differs from standard MIDI players and upstream TinySynth (End-of-Track looping, sounds set by the contract, ignored controllers, pinned engine quirks, gas per byte, keeping the tempo in sync with animated SVG or GIF art), and serve scores from a composer's contract through the sound provider interface (get_sound). Use when composing, converting or debugging MIDI for an NFT that uses this player, when check-midi fails, or when music and art drift apart.
license: Apache-2.0
compatibility: Needs Node 22 or later and a clone of https://github.com/Provable-Games/onchain-midi-player whose VERSION in src/page_data.cairo equals the class's version().
---

# Driving the onchain MIDI player with MIDI

This guide is for experienced MIDI authors. It lists only what differs from standard MIDI players and upstream TinySynth. The source of truth is the [MIDI contract](https://github.com/Provable-Games/onchain-midi-player/blob/main/docs/midi-contract.md); read it when a detail matters.

Boundaries: this skill covers what goes in the `.mid` (notes, program changes, controllers, tempo, loop point), and how a composer's contract serves it ([Serving the score from a contract](#serving-the-score-from-a-contract)). The contract's `TinySynthSettings` (which sounds the programs and drums play, reverb, volume, voices) is the [sound-design](../sound-design/SKILL.md) skill. Wiring the player into a contract is the [integrator-guide](../integrator-guide/SKILL.md) skill.

## Start offchain

Preview the score in the page the chain serves, and check it, before anything goes onchain:

```sh
git clone https://github.com/Provable-Games/onchain-midi-player && cd onchain-midi-player
grep 'pub const VERSION' src/page_data.cairo   # must print the class's version(); see "Get the tools"
npm run check-midi -- song.mid             # the page's own MIDI check
npm run preview -- song.mid --settings sound.json --svg art.svg --serve
```

Open the printed URL and press ▶. If it plays right there, it plays the same from the token. `--settings` and `--svg` are optional (defaults: the class's default settings and a placeholder SVG). In a dev container, forward the port first: a `/tmp` file link does not open on the host.

### Get the tools

- Node 22 or later. `check-midi` and `preview` need no `npm ci`.
- Use a clone whose `PAGE` is your class's: `grep 'pub const VERSION' src/page_data.cairo` must print the class's `version()` (`preview` prints it too). The same `VERSION` always means the same `PAGE` bytes, so the newest commit with it has both the tools and the right page: `main` while its `VERSION` matches, otherwise the last commit before `VERSION` changed (`git log --oneline -- src/page_data.cairo`). Details: README, [Agent skills](https://github.com/Provable-Games/onchain-midi-player/blob/main/README.md#agent-skills).

## What the offline check guarantees

- **Bytes.** `preview` writes exactly the decoded `animation_url` page (`PAGE ++ D ++ SVG`) that the class and a consumer produce for the same MIDI, settings and SVG. `npm test` checks this against the example contract's golden output and the deployed example's `token_uri` is checked against it through several RPC providers.
- **Playback.** Every browser runs the same engine and player code, but audio can differ slightly across browsers and sample rates (see [The player page](https://github.com/Provable-Games/onchain-midi-player/blob/main/docs/token-uri-layout.md#the-player-page)).
- **Noise and reverb** are generated from a fixed seed in the pinned engine, so they are the same on every load at a given sample rate.
- **A bad file does not revert.** The class embeds the MIDI without parsing it. The page shows the error, ▶ stays disabled and the art still shows. Only an offline check catches it before mint.

## Where the player is not a standard MIDI player

Rows trace to the [MIDI contract](https://github.com/Provable-Games/onchain-midi-player/blob/main/docs/midi-contract.md) and to [`scripts/engine_contract.test.mjs`](https://github.com/Provable-Games/onchain-midi-player/blob/main/scripts/engine_contract.test.mjs), which pins the less obvious ones on the pinned engine.

| Behaviour | What to do | Why |
| --- | --- | --- |
| Instruments come from `TinySynthSettings`: `quality` picks the built-in set (0 chip-tune, 1 FM), and each custom timbre replaces program `slot` 0–127 or drum note `slot` 35–81 for the whole song. | Select sounds the ordinary way (program change, drum note on channel 10). Agree the slots with whoever writes the settings. | Onchain control: the contract decides the sound. |
| Reverb, master volume and voices are `TinySynthSettings.reverb`, `master_vol` and `voices`. CC91, CC93, GM Master Volume, GM System On and GS Reset do nothing. | Balance with CC7, CC11 and velocity. Stay within `voices` notes at once. | Onchain control. |
| Bank select (CC0, CC32) is ignored: 128 programs. | Do not rely on banks or GS variations. | Engine: TinySynth has one bank. Those 128 programs and drums 35–81 are also the only slots `TinySynthSettings` can replace. |
| The song always loops. A pass ends at `maxTick`, the latest End-of-Track of any track, not at the last note. | Put the latest End-of-Track exactly on the loop point, such as the last bar line. | Looping with the art: the page repeats the music while the art runs, and the End-of-Track sets the pass length exactly. |
| At each loop point the tempo returns to 120 BPM; a tempo event at tick 0 applies at once. Programs, controllers, bend, RPNs and tuning carry over, and held notes keep sounding. Each ▶ resets the channels and plays from tick 0, which sounds 0.1 s after playback starts; a rest before the first event is kept, on the first pass as on every later one. | Set every state the song changes at tick 0. Release every note by End-of-Track. A leading rest is fine: the first note sounds at its own tick. | Engine: its loop restarts only the tempo map, and it times every pass from tick 0. |
| A track that ends early sends nothing more until the next pass, but its held notes keep sounding. | Release notes before a track's End-of-Track. | Engine: it merges all tracks into one event list. |
| Parsing is strict: files many players accept are rejected (running status after a meta or SysEx event, F7 events, a missing or misplaced End-of-Track, trailing bytes, a tempo event that is not 3 bytes, text over 4,096 bytes, SMPTE timing, format 2, a pass under 50 ms). | Run `check-midi`. The rules and fixes are in [references/checkmidi-rules.md](references/checkmidi-rules.md). | Verifiability: the page must read the file exactly as the pinned TinySynth parser does, and fail closed with a visible error instead of misplaying. |
| Bend range full scale is (MSB × 128 + LSB) × 100 / 127 cents, so the default MSB 2 gives about ±201.6 cents. | For exactly ±s semitones, send RPN 0 with MSB × 128 + LSB = 127 × s (±2: MSB 1, LSB 126). | Pinned engine, documented rather than patched. |
| Pitch bend retunes only the oscillator operators of melodic notes already sounding. Held noise operators, operators on a custom `Samples` wave (they play from a buffer, as noise does) and drum hits keep the bend they started with. A filter never follows the bend: a key-tracked one is set from the note-on frequency before bend. | Bend before a noise or sample-wave note, or a drum hit, starts. | Pinned engine. |
| Channel 10 note-offs are ignored: a hit lasts 3.5 × the decay of its sound's first operator. Notes outside 35–81 are silent. Program changes there do nothing. | Shape drum length in the timbre (sound-design), not with note-offs. | Pinned engine. |
| A note-off releases every note of that pitch on the channel that started at or before it. | At one tick, put the note-off before the next note-on of the same pitch. | Pinned engine. |
| A note-off releases each operator from the level it has reached, so a note shorter than its timbre's attack sounds, more quietly. A note-on and note-off at the same tick sound only the release of the operators with no attack. | Make short notes on slow-attack timbres long enough to reach the level you want. Do not use zero-length notes as silent markers. | Pinned engine. |
| The voice limit cuts a note when the new note is scheduled, up to about 0.2 s before it sounds. A drum hit takes no voice but applies the limit, so with `voices` 1 every hit cuts the melody. | Leave headroom under `voices`. | Pinned engine: it schedules about 0.2 s ahead. |
| CC120 and CC123–127 cut the channel's melodic notes when scheduled (up to about 0.2 s early), not drums. CC121 leaves notes held by sustain sounding. | Prefer note-offs. Avoid CC121. | Pinned engine. |
| CC1 is one 5 Hz LFO shared by all channels, ±(value × 100 / 127) cents. Loudness follows velocity squared; FM depth ignores velocity. Aftertouch, channel pressure, portamento, sostenuto and soft pedal are ignored. | Write vibrato and dynamics with that in mind. | Pinned engine. |
| Tuning far up can silence notes on a deep FM timbre. On a long FM chain of high ratios, or with a large `key_scale`, a high note's computed frequencies or levels can pass the 32-bit float range: the engine skips that note, which makes no sound, and the song plays on. Upward tuning adds to it: coarse tuning +63, GS key-shift +63 and GS master tune at its maximum together are about +190 semitones, and one GS master tune message whose data nibbles are bytes above `0x0F` about +556. `check-midi` accepts all of these. | Keep GS master tune data nibbles within `0x00`–`0x0F`, keep the total upward tuning moderate on deep FM timbres, and audition the score with the contract's settings in `preview`. | Pinned engine. See [Engine limits on operator values](https://github.com/Provable-Games/onchain-midi-player/blob/main/docs/sound-settings.md#engine-limits-on-operator-values). |
| Nothing plays until the viewer taps ▶. | Do not count on autoplay or on the first beat landing at page load. | Browser rule: audio starts only from a user gesture. |
| ▶ also starts a silent media element, so browsers show media controls and keep playing with the screen locked. A pause from the notification, a headset or a call stops the music like ■, and the next ▶ plays from tick 0. Where the host's CSP blocks `blob:` media there are no controls and the music stops when the page is hidden. | Do not count on the music carrying on in the background, or resuming where it paused. | Page behaviour: [Playback](https://github.com/Provable-Games/onchain-midi-player/blob/main/docs/midi-contract.md#playback). |
| Every byte costs gas: `midi_segment` base64-encodes the MIDI at call time, once alone and twice inside the page fragment. The MIDI costs about 14M L2 gas per 1,000 bytes ([`midi_segment` table](https://github.com/Provable-Games/onchain-midi-player/blob/main/docs/gas.md#midi_segment-by-midi-and-settings-size)); `SETTINGS` costs about 14.5M ([The size of `SETTINGS`](https://github.com/Provable-Games/onchain-midi-player/blob/main/docs/gas.md#the-size-of-settings)). | Strip text, marker, lyric and name events (the player ignores them). Use running status, with note-on velocity 0 as note-off. | Gas: the contract pays per byte on every `token_uri` call. |

The full list of honoured and ignored messages is in the MIDI contract: [Messages TinySynth honours](https://github.com/Provable-Games/onchain-midi-player/blob/main/docs/midi-contract.md#messages-tinysynth-honours) and [Limits](https://github.com/Provable-Games/onchain-midi-player/blob/main/docs/midi-contract.md#limits).

## Practical recommendations

- Set tempo, programs, CC7, CC10 and any controller or tuning the song changes at tick 0, so every pass and every ▶ starts the same way.
- End-of-Track at the loop point; give no track a later End-of-Track.
- A pass length that is a whole multiple of every visible art loop (next section): the art restarts at every loop point.
- Note-off before note-on at the same tick and pitch.
- Read the `check-midi` report: loop length, `maxTick`, each track's End-of-Track, and drum notes flagged silent.

## Syncing with the art

The player restarts the art when tick 0 is heard: on ▶, and again at every pass. When the pass is a whole multiple of every period of the art's animation, the art is back at its start at each loop point anyway, so the restart does not show, and music and art stay in step for the whole session. When it is not, the art jumps back to its start at every loop point, and an animation longer than the pass never finishes. Within a pass, the music's beat and the art's frames line up only if their periods match.

1. **Measure the art's periods:** GIF frame delays (in 10 ms units), SMIL `dur` (one repeat of the animation's `values`), and CSS animation durations (one iteration; with `alternate` or `alternate-reverse` the art repeats every two iterations). From the checkout, `node plugins/onchain-midi-player/skills/midi-guide/scripts/art_periods.mjs art.svg` prints them. Ignore animations that change nothing visible.
2. **Choose the tempo:** make the beat, or a subdivision of it, a whole number of frames: for a frame period `F`, a tempo of `n × F` µs per quarter puts `n` frames in a beat (`n = 2` is one frame per eighth), and a tempo that is a multiple of 20,000 µs gives whole-centisecond eighths ([details](references/art-sync.md#3-choose)).
3. **Choose the pass length:** make it (the `loop` that `check-midi` prints, `maxTick` × the tick time) a whole multiple of every visible art period, so every pass starts in phase.

A beat of `b` ms (tempo in µs per quarter / 1000) lines up with an art loop of `P` ms every lcm(`b`, `P`) ms. With 200 ms GIF frames:

| Tempo (µs per quarter) | Beat | Lines up with a 0.4 / 0.6 / 0.8 / 1.2 s loop every | 4/4 bar |
| --- | --- | --- | --- |
| 100 BPM (600,000) | 600 ms, 3 frames | 1.2 / 0.6 / 2.4 / 1.2 s | 2.4 s: in phase with all four |
| 150 BPM (400,000) | 400 ms, 2 frames | 0.4 / 1.2 / 0.8 / 1.2 s | 1.6 s: in phase with 0.4 and 0.8 |
| 75 BPM (800,000) | 800 ms, 4 frames | 0.8 / 2.4 / 0.8 / 2.4 s | 3.2 s: in phase with 0.4 and 0.8 |
| 120 BPM (500,000) | 500 ms, 2.5 frames | 2 / 3 / 4 / 6 s | 2 s: in phase with 0.4 only |
| 131.87 BPM (455,000) | 455 ms, 2.275 frames | 36.4 / 54.6 / 72.8 / 109.2 s | 1.82 s: none |

Retuning the music is usually better than retuning the art: GIF delays come in 10 ms steps, so matching an arbitrary beat needs uneven frames, and the change hits every token's art. Wrapper SVG durations are cheap to set to the music's grid. The Beast worked example, with measured numbers, is in [references/art-sync.md](references/art-sync.md).

Why the art restarts at every pass: the art runs on the page's clock and the sound on the audio clock, and the two drift apart (headless Firefox's image clock runs about 160 ppm fast, and real sound cards are commonly tens of ppm off). A restart at every pass bounds that drift to one pass; with periods that match, it costs nothing visible.

## Serving the score from a contract

A composer whose contract writes the scores onchain implements the sound provider interface, `onchain_midi_player::interface::ISoundProvider`, so any NFT that uses the player can call it. A MIDI file can select an instrument but not define one, so `get_sound` returns the score together with the instrument definitions it plays, as an `onchain_midi_player::types::TinySynthSound`:

```cairo
use onchain_midi_player::interface::ISoundProvider;
use onchain_midi_player::types::TinySynthSound;

// In the composer's contract: `get_sound` is the whole interface.
#[abi(embed_v0)]
impl SoundProviderImpl of ISoundProvider<ContractState> {
    fn get_sound(self: @ContractState, token_id: u256) -> TinySynthSound {
        let midi = compose(self, token_id);
        let settings = instruments_for(@midi);
        TinySynthSound { midi, settings }
    }
}
```

NFTs call `get_sound`: one call that reads the token's state once. It is the interface's only function: interfaces for the MIDI alone or the settings alone belong to your own project, and a contract that already has them (`get_midi`, `get_settings`) adds `get_sound` beside them. If it exposes the MIDI or the settings through its own interfaces, they should equal `get_sound(token_id).midi` and `.settings`; build all of them from one internal function. The provider contract, from [Sound provider interface](https://github.com/Provable-Games/onchain-midi-player/blob/main/docs/sound-provider.md), which has the details:

- **Token IDs as minted:** accept the whole `u256` the NFT minted, decode only the bits you use, and ignore the rest (Beasts' newer IDs are 180 bits).
- **A raw Standard MIDI File** (not base64) that passes `check-midi`. In your CI, check the scores the contract produces for a spread of tokens, read from `get_sound(token_id).midi` or written out by snforge tests.
- **Valid settings:** `settings` passes `settings::validate` in the class version the NFT calls. Return only the timbres and waves this token's score uses, and keep the bank as constants in code (see [sound-design](../sound-design/SKILL.md)).
- **Deterministic:** the same token and live state always give the same bytes, whoever calls.
- **View-only:** no storage writes.
- **Revert only for an unknown token.**

## Reference files

- [references/checkmidi-rules.md](references/checkmidi-rules.md): every `checkMidi` rule and error message, with the usual cause and fix.
- [references/art-sync.md](references/art-sync.md): measuring art periods, the Beast worked example, and when to change the art instead.
- [scripts/art_periods.mjs](scripts/art_periods.mjs): prints the GIF frame delays, SMIL durations and CSS animation durations in an SVG. Node built-ins only.
