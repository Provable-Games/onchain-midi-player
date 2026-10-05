# `checkMidi` rules and messages

The page runs `checkMidi` (in [`player/player.js`](https://github.com/Provable-Games/onchain-midi-player/blob/main/player/player.js)) on the token's MIDI before ▶ is enabled. `npm run check-midi` and `npm run preview` run the same function. The source of truth is the README's [Accepted format](https://github.com/Provable-Games/onchain-midi-player/blob/main/README.md#accepted-format) table; `npm test` fails if this file misses one of the player's messages.

Errors read `midi: <message> (byte <offset>)`, where the offset is where reading stopped. A failing file does not revert onchain: the page shows the error, ▶ stays disabled and the art still shows.

| Message | What it means | Usual cause and fix |
| --- | --- | --- |
| `not a Standard MIDI File` | The file does not start with an `MThd` chunk of length 6. | A RIFF (`.rmi`), XMF or other wrapper, or a truncated header. Export a plain `.mid`. |
| `format 2 is not supported` | Format 2 (independent sequences). The number in the message is the file's format. | Export as format 0 or 1. |
| `bad track count` | No tracks, or format 0 with more than one track. | Export format 1 for several tracks. |
| `SMPTE or zero time division is not supported` | The division is SMPTE (top bit set) or 0. | Export with ticks per quarter note, 1–32,767 (480 is common). |
| `expected MTrk` | A chunk other than `MTrk` where one of the declared tracks should be. | Strip vendor chunks between tracks. |
| `MTrk length past the end of the file` | A track's declared length runs past the end of the file. | A truncated file or a wrong length field. Re-export. |
| `truncated` | An event runs past the end of its chunk. A track without End-of-Track also ends here. | Make sure every track ends with End-of-Track (`FF 2F 00`). |
| `bad variable-length number` | A delta time or length longer than 4 bytes. | A corrupt file. Re-export. |
| `End-of-Track is not at the end of its track` | Bytes follow End-of-Track inside its chunk, or End-of-Track has a non-zero length. | Make End-of-Track the last event and the chunk length exact. |
| `trailing bytes after the last track` | Data after the last declared track. | Strip trailing chunks or padding. |
| `running status without a channel status` | Running status at the start of a track, or right after a meta or SysEx event. | Write the status byte again after every meta and SysEx event. Some writers keep running status across them; TinySynth would misread that. |
| `bad data byte` | A channel message data byte above 127. | A corrupt file or a writer bug. |
| `bad tempo` | A tempo event that is not exactly `FF 51 03 tt tt tt`, or a tempo of 0. | Write tempo with a one-byte length of 3. |
| `text event longer than 4096 bytes` | A text, copyright, track name, instrument name or device name event over 4,096 bytes. | Shorten or strip it. The player ignores these events, and every byte costs gas. |
| `SysEx not complete in one event` | An `F0` event that is empty or does not end with `F7`. | Send each SysEx as one complete `F0 … F7` event. |
| `SysEx continuation or escape (F7) events are not supported` | An `F7` event. | Merge split SysEx into one `F0` event; drop escapes. |
| `unexpected status byte` | A system status byte (`F1`–`F6`, `F8`–`FE`) used as an event. | Strip real-time and system common bytes from the file. |
| `loop shorter than 50 ms` | One pass, `maxTick` under the tempo map (120 BPM until the first tempo event), is under 50 ms. | Put End-of-Track at the real loop point, not at tick 0. |
| `midi: not base64` | The input is not strict base64. Only `check-midi` and `preview` show it, for a bad base64 input; the class always writes valid base64. | Pass the `.mid` file, or base64 without stray characters. |

Everything else is accepted: any channel message, other meta events, SysEx of any length, and tempo events in any track.

The rules follow from how TinySynth reads a file: it stops reading a track at End-of-Track rather than at the chunk length, keeps running status across tracks and after meta and SysEx events, reads tempo at a fixed offset, and turns F7 events into SysEx. On a pass under 50 ms its scheduler would never catch up, and a longer text event can exceed a browser's argument limit.
