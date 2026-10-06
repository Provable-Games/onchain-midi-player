---
name: midi-guide
description: Drive the onchain MIDI player for NFTs (Provable-Games/onchain-midi-player) with Standard MIDI Files. Preview a .mid offline in the exact page the chain serves, check it against the player's strict MIDI contract, and learn only where the player differs from standard MIDI players and upstream TinySynth (End-of-Track looping, sounds set by the contract, ignored controllers, pinned engine quirks, gas per byte, keeping the tempo in sync with animated SVG or GIF art), and serve scores from a composer's contract through the sound provider interface (get_sound). Use when composing, converting or debugging MIDI for an NFT that uses this player, when check-midi fails, or when music and art drift apart.
license: Apache-2.0
compatibility: Needs Node 22 or later and a clone of https://github.com/Provable-Games/onchain-midi-player whose VERSION in src/segment_data.cairo equals the class's version().
---

Author a Standard MIDI File accepted by the strict browser validator. The class validates settings, encodes MIDI verbatim and does not validate MIDI onchain. Use npm run check-midi -- score.mid before integration; read [MIDI rules](https://github.com/Provable-Games/onchain-midi-player/blob/main/docs/midi-contract.md) and [checkmidi reference](references/checkmidi-rules.md) for nonstandard engine restrictions, controllers, text limits, safe loops and timing.

Serve raw MIDI plus TinySynthSettings through ISoundProvider.get_sound(token_id), preserving the complete u256 token ID. Instrument definitions belong to [sound-design](../sound-design/SKILL.md); library/document composition belongs to [integrator-guide](../integrator-guide/SKILL.md).

The headless player reloads tick zero/starting tempo, preserves leading/trailing rests, loops at End-of-Track, and cancels scheduled voices on stop. It emits audible pass-start events; NFT code owns art synchronization, media/background policy and controls. Read [art synchronization](references/art-sync.md) when choosing a loop compatible with GIF/SVG periods. A future p5.js visual can subscribe to the same event; no p5 integration is required to author/test MIDI.

Use npm run preview -- score.mid --svg art.svg --out preview.html to build an offline complete consumer page. Community SVG is isolated as an encoded image; scripts can follow art safely. Run the strict MIDI check and composed browser checks independently of metadata verification.
