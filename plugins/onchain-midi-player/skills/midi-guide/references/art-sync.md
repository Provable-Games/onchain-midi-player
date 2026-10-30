# Syncing the music with the art

## NFT-owned pass synchronization

The headless player emits onPassStart at each audible boundary (engine startTime plus the shared latencySeconds estimate, in AudioContext seconds). The NFT-owned reference, [art_sync.js](https://github.com/Provable-Games/onchain-midi-player/blob/main/examples/beast_consumer/art_sync.js), never schedules the art: it animates on the page clock and is seeked to the music's position, read from getPlayStatus() at that moment, when the player announces one. For trusted inline SVG, `syncSvgToMusic` seeks the outer and every nested timeline when the music becomes audible (its initial pass event, or the audio clock if that event never reaches it), at each later pass, accepted latency changes and resume, working out where the art belongs from getPlayStatus() each time. A pause stays audible until the AudioContext's suspend completes, so the art runs on and then freezes at the player's held audio position. Before the music is audible, and after stop, a new run or a failure, the art animates freely. Arbitrary/community art stays isolated in an encoded image, which `restartImgOnPass` restarts at each pass with a freshly decoded copy, up to one decode late; with its `pause`/`play`/`stop` passed to `syncSvgToMusic(null, player, { img })`, a pause shows a still of the frame its GIF showed when the audio stopped (from the AudioContext time since the image started). With `beat` (`beatSeconds`), each restart shows the GIF retimed to the beat (`retimeGif`) and resume restarts it on the frame the music is on; without it, resume restarts the image from its first frame. Under `prefers-reduced-motion` the reference holds a still of the first frame instead, with the controls not attached to the transport; art it cannot still keeps moving and restarting at passes. Core code never reads or replaces art. The shared estimate is outputLatency + baseLatency, polled every 250 ms with a 2 ms update threshold. The reference monitor is read-only; there is no continuous drift-correction path. The 17 ms NFT display lead remains provisional pending issue #52 hardware evidence. Initial events always follow successful start; missed/late later boundaries are skipped and stop invalidates stale events. Browser timers are best effort.

SVG timeline APIs do not pause or seek an embedded animated GIF. On the isolated path, a restart (a freshly decoded `r=<n>` copy of the image) starts it from its first frame, up to one decode late, and a pause shows a still of its current frame; with `beat` the restart's GIF is retimed to the beat (`beatSeconds`, `retimeGif`; see the isolated image below). On the inline-SVG path, and in the metadata `image`, nothing aligns a GIF's phase to the beat: use an SVG/SMIL sprite timeline there for animation synced to the music. The historical GIF fixture below remains useful for measuring periods.

Choose a score pass that is a whole multiple of the art's visible periods to avoid visible resets. The ordinary composed preview intentionally uses an isolated image and does not demonstrate controlled SVG pause/seek. For that acceptance use the trusted renderer-owned reference (`trusted_art: true`, `trusted_body_segment()` and `syncSvgToMusic`) or the browser synchronization probes in the [development guide](https://github.com/Provable-Games/onchain-midi-player/blob/main/docs/development.md), selecting each browser engine; matching engine hashes alone says nothing about consumer visuals. Future independent visual libraries can subscribe to the same API.

## 1. Measure the art's periods

From the checkout root:

```sh
node plugins/onchain-midi-player/skills/midi-guide/scripts/art_periods.mjs art.svg
```

For the full-size Beast fixture, [`tests/fixtures/beasts/warlock_shiny_animated.svg`](https://github.com/Provable-Games/onchain-midi-player/blob/main/tests/fixtures/beasts/warlock_shiny_animated.svg), it prints:

```text
GIF: 4 frames, delays 200, 200, 200, 200 ms, loop 800 ms
SMIL dur 2.2s
SMIL dur 6s
SMIL dur 3s
```

If it warns about GIF delays under 20 ms, measure that GIF's period in a browser: browsers show very short delays longer than encoded.

A CSS duration is one iteration. With `animation-direction: alternate` or `alternate-reverse` the art plays forward then back, so it repeats every two iterations: `art_periods.mjs` doubles a shorthand entry it can see is alternate, and flags a separate `animation-direction` for you to match by hand. A SMIL `dur` covers the whole `values` list, so `values='1;0.4;1'` with `dur='3s'` repeats every 3 s.

Then look at what each animation does. In that SVG:

- the GIF loops every 0.8 s;
- `3s` is an opacity pulse between 0.6 and 1;
- `6s` rotates a gradient;
- `2.2s` animates opacity from 1 to 0.999, a keep-alive no one can see. Ignore it.

## 2. Compute

- Beat `b` = tempo in µs per quarter / 1000, in ms. A beat lines up with an art loop of `P` ms every lcm(`b`, `P`) ms. Work in whole milliseconds.
- One pass `L` = the `loop` that `check-midi` prints: `maxTick` × the tick time, under the tempo map. With one tempo, `L` = `maxTick` / ticks per quarter × `b`.
- Every pass starts in phase with an animation only if `L` / `P` is a whole number. For several animations, make `L` a multiple of the lcm of their periods.

## 3. Choose

**From the frame period to a tempo.** For art made of frames, with frame period `F` in µs (a GIF's delay, a sprite sheet's step), the tempo `Q` in µs per quarter note that puts `n` frames in each quarter is `Q = n × F`. This matches periods; phase alignment additionally requires NFT code to control the animation timeline or actively align/restart the image.

- One frame per eighth note is `n = 2` (`Q = 2F`), per triplet eighth `n = 3`, per sixteenth `n = 4`.
- GIF delays are whole centiseconds (10,000 µs), so an eighth note is a whole number of them only when `Q` is a multiple of 20,000 µs (a sixteenth: 40,000 µs). That includes 60, 75, 100, 120, 125 and 150 BPM, but not 140 (428,571 µs) or 131.87 BPM (455,000 µs).
- Write the tempo in the file as µs per quarter note (the Set Tempo event). An editor that takes BPM may round it.
- Use ticks per quarter note that the subdivision divides evenly (480, for example), so every frame boundary lands on a tick.
- When NFT code seeks trusted SVG from `onPassStart`, only drift within one pass matters. The headless player emits timing events and never controls art itself.

On the isolated path with `beat`, `frameUs` sets the GIF's frame step (an eighth note, or a quarter note above 150 BPM), so the period arithmetic below applies only to the inline path, sprites and the metadata `image`.

For a transport-controlled SVG/SMIL sprite with the Beast GIF's 20 cs (200 ms) frame periods: 150 BPM (400,000 µs) is exactly one frame per eighth note, 75 BPM (800,000 µs) one per sixteenth, and 100 BPM (600,000 µs) one per triplet eighth. At 150 BPM a 4/4 bar is 1.6 s, two loops of the 4-frame sprite, so transport alignment and a whole number of bars preserve that sprite's phase.

Pick a tempo whose beat, or a subdivision of it, is a whole number of frames. Then pick a pass length that is a whole number of bars and a multiple of the art's loops. For 200 ms frames and 0.4, 0.6, 0.8 or 1.2 s loops:

- **100 BPM** (600,000 µs per quarter): the beat is 3 frames, and a 4/4 bar is 2.4 s, the lcm of all four loops. Any whole number of bars stays in phase with all of them.
- **150 BPM** (400,000) or **75 BPM** (800,000): the bar is a multiple of 0.4 and 0.8 s loops, but not of 0.6 or 1.2 s.
- **120 BPM** (500,000): the beat is 2.5 frames. A 0.8 s loop lines up only every 4 s (2 bars), so the pass must be a multiple of 4 s.
- **131.87 BPM** (455,000): a 0.8 s loop lines up only every 72.8 s.

## The Beast worked example

The example's token 4 is a full-size Beast on Sepolia (the example in [`deployments/sepolia.json`](https://github.com/Provable-Games/onchain-midi-player/blob/main/deployments/sepolia.json)). Its synthetic score uses a production Beast tempo, 455,000 µs per quarter (131.87 BPM; the production tempos are in [`scripts/gen_midi_fixtures.mjs`](https://github.com/Provable-Games/onchain-midi-player/blob/main/scripts/gen_midi_fixtures.mjs)). `check-midi` reports `loop 55.510 s, maxTick 58560`.

- 55,510 ms / 800 ms = 69.39 GIF loops per pass, so a pass ends 0.39 of the way through a GIF loop.
- The 455 ms beat and the 800 ms GIF loop line up every lcm(455, 800) = 72,800 ms, longer than the pass. Within a pass, the beat never lines up with the GIF again.

The GIF and beat therefore have different periods. On each path the reference treats an embedded GIF differently:

- **Trusted inline SVG:** seeks and pauses move the SVG/SMIL timelines only; an embedded GIF runs on its own image clock through them.
- **Isolated image:** `restartImgOnPass` restarts the image at each pass, up to one decode late. With `beat` (the Beast reference passes `beatSeconds`), each restart retimes the GIF in the browser (`retimeGif`): a frame per eighth note, or per beat above 150 BPM (`frameUs`), uneven frames in whole steps in proportion; for a GIF that loops forever, every frame change within 10 ms of the beat over a pass of up to a few minutes (the frames repeated inside the GIF, up to 64 times, where whole centiseconds would drift; on longer passes, or where a GIF cannot be repeated, as close as that allows: up to 11.7 ms measured on 200-300 s passes). While paused it shows a computed still of the frame the audio stopped on, and resume restarts the retimed GIF on the frame the music is on (up to one decode late, and up to about 14 ms off the beat at one frame change per loop).

So on the isolated path the GIF keeps the beat whatever its own delays; the metadata `image` keeps them. On the inline path, and in the metadata image, the following arithmetic applies (and to a transport-controlled SVG/SMIL sprite with the same frame durations):

- At 100 BPM, a pass of whole bars keeps the controlled sprite in phase (3 sprite loops per 2.4 s bar). Retune the wrapper's 3 s and 6 s animations to 2.4 s and 4.8 s, or keep them and make the pass a multiple of 12 s (5 bars), the lcm of 2.4, 3 and 6 s.
- At 120 BPM (500,000 µs, the other production tempo), make the pass a multiple of 4 s for the controlled sprite; 3 s and 6 s then need a multiple of 12 s (6 bars).

## Changing the art instead

Possible, but usually worse:

- GIF delays come in 10 ms steps. Matching a beat that is not a multiple of 10 ms, such as 455 ms, needs uneven frame delays.
- Changing the art changes every token's art, and existing art may be fixed.
- Wrapper SVG durations (`dur`, CSS) are literals in the renderer, cheap to set to the music's grid: a whole number of beats or bars.
