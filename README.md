# Onchain MIDI Player

`TinySynth` is a storage-free Starknet class, declared and called with `library_call`. The 0.12.0 class supplies independently composable, offline browser libraries. NFTs own their JSON, complete HTML document, art and UI.

The engine is the signed release `v2.1.2` of [pocket-synth](https://github.com/Provable-Games/pocket-synth), Provable Games' fork of g200kg's webaudio-tinysynth, a reproducibly verified build; its exact source/build/NOTICE identities are recorded in the [vendor provenance](tests/vendor/README.md) and library manifest. Release readiness still requires device validation. 0.12.0 has not been declared. Against 0.11.0 it changes only the engine (0.11.0 embeds `v2.1.1`), and with it the player segment and the license text; the API wrapper, the shared loader and the ABI are unchanged. The previous class, 0.11.0, is declared on Sepolia as a test class without a release tag, with the Beast reference example deployed against it ([deployment record](deployments/sepolia.json)). Against 0.10.0 it changes only the engine (0.10.0, 0.9.0 and 0.8.0 embed `v2.1.0`), and with it the player segment and the license text; the API wrapper, the shared loader and the ABI are unchanged. 0.10.0 differs from 0.9.0 only in the name of its types package, `tinysynth_interface` (formerly `onchain_midi_types`), which renames the types in the ABI and so changes the class hash. 0.9.0 has the engine and segments of 0.8.0 and differs only in declaring its sound types in a package of their own. 0.10.0, 0.9.0, 0.8.0 and 0.7.0 (engine `v2.0.1`) remain declared on Sepolia as test classes. None has been released or declared on mainnet.

| `ITinySynth` entry point | Result |
| --- | --- |
| `gunzip_segment()` | Generic inline loader fragment |
| `player_segment()` | Pinned TinySynth engine and headless API in one gzip fragment |
| `midi_segment(midi, settings)` | Complete validated-settings/verbatim-MIDI data fragments |
| `engine()` | `'tinysynth'` |
| `version()` | Class SemVer |
| `script_sha256()` | Exact decompressed engine SHA-256 |
| `license()` | Library/dependency notices and licenses |

The sound types (`TinySynthSound`, `TinySynthSettings`), `ISoundProvider`, `ITinySynth` and `settings::validate` are also a package of their own, `tinysynth_interface` ([`types/`](types)), which depends on nothing but `starknet`: composers, NFTs and renderers can share them without the class's dependencies, importing them from the package root (`use tinysynth_interface::{ISoundProvider, TinySynthSound, validate};`), and the class re-exports them at its earlier paths ([Depending on the types](docs/sound-provider.md#depending-on-the-types)).

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

A pass is heard at `event.audibleTime` (`startTime + latencySeconds`); `outputLatency` and `baseLatency` are informational components, so `startTime + outputLatency` is early. `onStateChange` subscribers also receive accepted latency updates without a state change, for example `playing` then `playing`; compare `state`, `runId` and `latencyRevision` rather than treating every snapshot as a new run.

Readiness creates no synth, audio context or UI. Play from stopped resumes audio inside the user gesture and starts from tick zero; play from paused resumes the existing score. Pause suspends the AudioContext; resume retains the score, voices and envelopes. `play()` also resumes a paused score. The player exposes status and pass/state subscriptions; NFTs choose media-session/background behavior. The [Beast reference](examples/beast_consumer/README.md) preserves art synchronization, button positioning and background-media behavior in a separate NFT-owned asset, and draws optional notes ([`player/notes.js`](player/notes.js), its own NFT-owned fragment) behind art whose frame is marked `data-notes-bg`. The trusted Genesis reference opts into inline SVG and controls outer and nested timelines, with a read-only drift monitor. Arbitrary/community SVG belongs in an encoded `<img>`; scripts/data/closing HTML may follow it safely.

The independent composition fixture is a 78-byte named-export library from a separate Cairo provider. A second dependent test library demonstrates execution order. A future independent p5.js provider can use the same format and shared loader; real p5.js packaging, integration and benchmarking are outside this implementation.

Useful references: [composition/encoding](docs/token-uri-layout.md), [headless API](player/api.d.ts), [settings](docs/sound-settings.md), [MIDI contract](docs/midi-contract.md), [sound providers and the types package](docs/sound-provider.md), [verification](docs/verifying.md), [gas measurements](docs/gas.md), [development/release process](docs/development.md), and the [stress consumer](examples/stress_nft/README.md).

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

## Sync your art

Art synced to the music is the experience, and it needs no scheduling. Let the art animate on the page clock, and seek it to the music's position at moments the player already announces: the first pass event (the music is audible), each later pass, and transport or latency changes. Each seek reads `getPlayStatus()` at that moment, so a late event can't misalign the art. [`art_sync.js`](examples/beast_consumer/art_sync.js) is a small reference to copy into your NFT-owned bootstrap; the Beast reference uses it.

```js
// After OnchainLibraries.ready and OnchainMidiPlayer.ready.
// Inline SVG your renderer controls: seeks the root and every nested <svg> timeline.
const sync = syncSvgToMusic(document.getElementById("art"), OnchainMidiPlayer);
// Isolated art (community art) in an <img src="data:...">: restarts it at each pass, with its GIF timed
// to the beat (the MIDI header's ticks per beat; null keeps the GIF's own timing).
const header = Uint8Array.from(atob(document.getElementById("onchain-midi-data").textContent.trim().slice(0, 20)), (c) => c.charCodeAt(0));
const dispose = restartImgOnPass(document.getElementById("art-img"), OnchainMidiPlayer, { beat: (s) => beatSeconds(s, header) });
// Its pause/play/stop freeze the image with the music: pass them to syncSvgToMusic(null, ..., { img: dispose }).
```

Before the music is audible and after stop, the SVG animates freely; a pause freezes it where the audio stops. When the music becomes audible, the art jumps once from wherever it was to the music's position; draw frame 0 as a natural rest pose, and make the art's loop a whole fraction of the pass, so the jump and every pass boundary look intended. `sync.clock()` gives optional notes the same audible clock. An `<img>` restart lands up to one decode late. With `beat`, each restart shows the art with its first embedded GIF retimed in the browser (`retimeGif`): one frame per eighth note, or per beat above 150 BPM (`frameUs`), uneven frames in whole steps in proportion; for a GIF that loops forever, every frame change within 10 ms of the beat over a pass of up to a few minutes (the frames repeated inside the GIF, up to 64 times, where whole centiseconds would drift; on longer passes, or where a GIF cannot be repeated, as close as that allows: up to 11.7 ms measured on 200-300 s passes). Only the delays change; the pixels and the rest of the art stay byte for byte. A pause freezes the image: the page shows a still of the frame the GIF it shows is on (worked out from that GIF's delays, also up to one decode late), and resume restarts the retimed GIF on the frame the music is on, shortened to fit (one frame change per loop of that GIF can then be up to about 14 ms off the beat), up to one decode late; so does a hidden page made visible while the music plays. Other animation inside the image keeps running. GIF frames inside inline SVG art can't be controlled: use SMIL sprite animation there.

## Agent skills

The repository plugin provides [integration](plugins/onchain-midi-player/skills/integrator-guide/SKILL.md), [MIDI authoring](plugins/onchain-midi-player/skills/midi-guide/SKILL.md), [sound design](plugins/onchain-midi-player/skills/sound-design/SKILL.md) and [token inspection](plugins/onchain-midi-player/skills/token-uri-inspector/SKILL.md) skills; the [marketplace manifest](.claude-plugin/marketplace.json) registers the plugin. Run checkout-based tooling against the targeted class version. `npm ci` installs pinned offchain dependencies for verification and HTML extraction; these are not browser/onchain dependencies.
