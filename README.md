# Onchain MIDI library

`TinySynth` is a storage-free Starknet class, declared and called with `library_call`. The unissued 0.6.0 candidate supplies independently composable, offline browser libraries. NFTs own their JSON, complete HTML document, art and UI.

This pause/synchronization implementation is stacked on [PR #61](https://github.com/Provable-Games/onchain-midi-player/pull/61)'s 0.5.0 composable architecture and depends on [engine PR #98](https://github.com/Provable-Games/webaudio-tinysynth/pull/98). Its engine build is explicitly provisional: repin to the fork's post-merge CI-generated commit before marking this draft ready, and to a tagged fork release for release readiness. Neither candidate has been declared or released; [deployment records](deployments/sepolia.json) describe historical test classes.

| `ITinySynth` entry point | Result |
| --- | --- |
| `gunzip_segment()` | Generic inline loader fragment |
| `player_segment()` | Pinned TinySynth engine and headless API in one gzip fragment |
| `midi_segment(midi, settings)` | Complete validated-settings/verbatim-MIDI data fragments |
| `engine()` | `'tinysynth'` |
| `version()` | Class SemVer |
| `script_sha256()` | Exact decompressed engine SHA-256 |
| `license()` | Library/dependency notices and licenses |

Every segment is `B64(B64(F))`, where `F` is a complete HTML fragment with external whitespace bringing its UTF-8 byte length to a multiple of nine. Fixed library fragments additionally use 279-byte alignment. Both returned encoding layers are canonical and unpadded. NFT-owned JSON framing and HTML fragments can be directly spliced around these constants. Decoding, reconstructing and re-encoding a valid page also works, with additional encoding gas.

A consumer includes the loader once, then optional independent libraries, the combined MIDI player, complete settings/MIDI blocks and its own art/bootstrap. The generic loader defines `OnchainLibraries.ready` synchronously, waits for parsing and executes gzip blocks once in document order. Consumer code awaits that promise and `OnchainMidiPlayer.ready` before attaching controls.

```js
await OnchainLibraries.ready;
await OnchainMidiPlayer.ready;
OnchainMidiPlayer.onPassStart(event => restartMyVisual(event));
myPlayButton.onclick = () => OnchainMidiPlayer.play().catch(showError);
myPauseButton.onclick = () => OnchainMidiPlayer.pause().catch(showError);
myResumeButton.onclick = () => OnchainMidiPlayer.resume().catch(showError);
myStopButton.onclick = () => OnchainMidiPlayer.stop();
```

Readiness creates no synth, audio context or UI. Playback resumes audio inside the user gesture, then starts from tick zero. Pause suspends the AudioContext; resume retains the score, voices and envelopes. `play()` also resumes a paused score. The player exposes status and pass/state subscriptions; NFTs choose media-session/background behavior. The [Beast reference](examples/beast_consumer/README.md) preserves art synchronization, button positioning and background-media behavior in a separate NFT-owned asset. The trusted Genesis reference opts into inline SVG and controls outer and nested timelines, with a read-only drift monitor. Arbitrary/community SVG belongs in an encoded `<img>`; scripts/data/closing HTML may follow it safely.

The independent composition fixture is a 78-byte named-export library from a separate Cairo provider. A second dependent test library demonstrates execution order. A future independent p5.js provider can use the same format and shared loader; real p5.js packaging, integration and benchmarking are outside this implementation.

Useful references: [composition/encoding](docs/token-uri-layout.md), [headless API](player/api.d.ts), [settings](docs/sound-settings.md), [MIDI contract](docs/midi-contract.md), [sound providers](docs/sound-provider.md), [verification](docs/verifying.md), [gas measurements](docs/gas.md), [development/release process](docs/development.md), and the [stress consumer](examples/stress_nft/README.md).

```sh
npm ci
npm run gen:segments -- --record  # only when recording a new class version
npm run check:segments
npm run gen:data
npm test
scarb build
snforge test
npm run check:abi
node scripts/validate_token_uri.mjs examples/beast_consumer/fixtures/token_uri.txt
```

## Agent skills

The repository plugin provides [integration](plugins/onchain-midi-player/skills/integrator-guide/SKILL.md), [MIDI authoring](plugins/onchain-midi-player/skills/midi-guide/SKILL.md), [sound design](plugins/onchain-midi-player/skills/sound-design/SKILL.md) and [token inspection](plugins/onchain-midi-player/skills/token-uri-inspector/SKILL.md) skills; the [marketplace manifest](.claude-plugin/marketplace.json) registers the plugin. Run checkout-based tooling against the targeted class version. `npm ci` installs pinned offchain dependencies for verification and HTML extraction; these are not browser/onchain dependencies.
