# Vendored test engine

`webaudio-tinysynth-b70ba90.min.js` is TinySynth from the Provable-Games fork,
<https://github.com/Provable-Games/webaudio-tinysynth>, at commit
`b70ba90d63c5ea657cb67ca98de90d7f778c29bd`. It is the commit's own `webaudio-tinysynth.min.js`, byte-identical
to rebuilding that commit's `webaudio-tinysynth.js` with its `npm run build`.

- SHA-256: `5aa3edbc13371694a83ec0f285a5d39d4e4a31b18a259c0bbdcbd5969f710c2c`
- License: Apache License 2.0. Copyright Tatsuya Shinyagaito (g200kg), modified by Provable Games (see the
  fork's NOTICE and this repository's [NOTICE](../../NOTICE)).
- Used only by tests (`scripts/engine.mjs` checks the hash on every load): the settings installer and the
  reference timbres are exercised against the real engine, offline. It is not the engine embedded in the class;
  that one is pinned to a tagged fork release (roadmap phase 0).

To verify: `git -C <fork> show b70ba90:webaudio-tinysynth.min.js | sha256sum`.
