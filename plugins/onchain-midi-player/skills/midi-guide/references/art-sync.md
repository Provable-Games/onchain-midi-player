# Syncing the music with the art

## How the player handles the art

On ▶ the player reloads the MIDI from tick 0 and restarts the art when tick 0 is heard: at TinySynth's `startTime` (when tick 0 of the pass sounds) plus the audio output latency, it swaps in a fresh `<img>` with a distinct URL, so the browser starts a new animation timeline. It then does the same at every pass ([`player/player.js`](https://github.com/Provable-Games/onchain-midi-player/blob/main/player/player.js), steps 3–4 of its header; see [The player page](https://github.com/Provable-Games/onchain-midi-player/blob/main/docs/token-uri-layout.md#the-player-page)).

The [browser checks](https://github.com/Provable-Games/onchain-midi-player/blob/main/docs/development.md#browser-validation) prove the restarts with a probe SVG animation that sweeps once per pass; watch your own art (an embedded GIF, for example) restart in `npm run preview`.

The restart at every pass keeps the art's clock from drifting away from the audio clock over a long session. Its cost is that a pass which is not a whole multiple of the art's periods makes the art jump back to its start at every loop point, and an animation longer than the pass never finishes. So make the pass a whole multiple of every visible period.

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

Pick a tempo whose beat, or a subdivision of it, is a whole number of frames. Then pick a pass length that is a whole number of bars and a multiple of the art's loops. For 200 ms frames and 0.4, 0.6, 0.8 or 1.2 s loops:

- **100 BPM** (600,000 µs per quarter): the beat is 3 frames, and a 4/4 bar is 2.4 s, the lcm of all four loops. Any whole number of bars stays in phase with all of them.
- **150 BPM** (400,000) or **75 BPM** (800,000): the bar is a multiple of 0.4 and 0.8 s loops, but not of 0.6 or 1.2 s.
- **120 BPM** (500,000): the beat is 2.5 frames. A 0.8 s loop lines up only every 4 s (2 bars), so the pass must be a multiple of 4 s.
- **131.87 BPM** (455,000): a 0.8 s loop lines up only every 72.8 s.

## The Beast worked example

The example's token 4 is a full-size Beast on Sepolia (see [Deployments](https://github.com/Provable-Games/onchain-midi-player/blob/main/docs/versions.md#deployments)). Its synthetic score uses a production Beast tempo, 455,000 µs per quarter (131.87 BPM; the production tempos are in [`scripts/gen_midi_fixtures.mjs`](https://github.com/Provable-Games/onchain-midi-player/blob/main/scripts/gen_midi_fixtures.mjs)). `check-midi` reports `loop 55.510 s, maxTick 58560`.

- 55,510 ms / 800 ms = 69.39 GIF loops per pass, so a pass ends 0.39 of the way through a GIF loop.
- The 455 ms beat and the 800 ms GIF loop line up every lcm(455, 800) = 72,800 ms, longer than the pass. Within a pass, the beat never lines up with the GIF again.

The GIF therefore jumps from 0.39 of the way through its loop back to its first frame at every loop point, and within a pass the beat drifts across the GIF's frames. The fix is the numbers, not the player:

- At 100 BPM, a pass of whole bars keeps the GIF in phase (3 GIF loops per 2.4 s bar). Retune the wrapper's 3 s and 6 s animations to 2.4 s and 4.8 s, or keep them and make the pass a multiple of 12 s (5 bars), the lcm of 2.4, 3 and 6 s.
- At 120 BPM (500,000 µs, the other production tempo), make the pass a multiple of 4 s for the GIF; 3 s and 6 s then need a multiple of 12 s (6 bars).

## Changing the art instead

Possible, but usually worse:

- GIF delays come in 10 ms steps. Matching a beat that is not a multiple of 10 ms, such as 455 ms, needs uneven frame delays.
- Changing the art changes every token's art, and existing art may be fixed.
- Wrapper SVG durations (`dur`, CSS) are literals in the renderer, cheap to set to the music's grid: a whole number of beats or bars.
