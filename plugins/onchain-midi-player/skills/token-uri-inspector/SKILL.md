---
name: token-uri-inspector
description: Inspect a deployed or local NFT token_uri built with the onchain MIDI player (Provable-Games/onchain-midi-player). Fetch it with sncast or a raw starknet_call, decode its JSON, image and animation_url page, verify separate loader/engine/headless-player artifacts, check the embedded MIDI and SETTINGS, inspect NFT-owned content, view the complete page in a browser, and find which RPC providers can serve it. Use when a token's animation does not play or looks wrong, when verifying a token against a class version, or when checking RPC call gas caps.
license: Apache-2.0
compatibility: Needs Node 22 or later (and npm ci once for npm run validate-token-uri), a clone of https://github.com/Provable-Games/onchain-midi-player whose VERSION in src/segment_data.cairo equals the class's version(), curl or sncast, and network access to a Starknet RPC.
---

Inspect a token URI by fetching its view result, decoding Cairo ByteArray felts, then decoding canonical JSON/HTML data URIs. Network calls are read-only. Use the token's complete u256 ID and the correct chain/deployed NFT address. Historical deployments do not establish that a new class version has been declared.

Use scripts/bytearray.mjs for RPC/sncast response decoding. From a matching checkout run node scripts/validate_token_uri.mjs token_uri.txt --json and node scripts/verify_engine.mjs token_uri.txt. They verify uniquely identified loader, engine and headless player artifacts separately against scripts/library_versions.json. Comments, inert data, template/raw-text content and encoded art are excluded; additional gzip libraries and changed NFT heads/body layouts are allowed. Matching class-library hashes do not certify additional NFT scripts or media policy.

Use node plugins/onchain-midi-player/skills/token-uri-inspector/scripts/split_page.mjs animation.html out to extract complete onchain-midi-settings/onchain-midi-data blocks. No art block or image/art equality assumption exists. Missing/duplicate required blocks and modified libraries fail explicitly. Art belongs to NFT-owned isolated image markup and may differ from metadata.image.

Decode/check settings with the existing strict decoder/validator and MIDI with npm run check-midi. Preserve exact source/payload bytes when reporting hashes. Report verified library identities, independent/consumer scripts, metadata/data validity, response size and RPC gas limits separately.

Open complete decoded animation HTML offline using the documented browser tools. Check custom controls after OnchainLibraries.ready and OnchainMidiPlayer.ready. Core readiness creates no synth/audio/UI; user gestures drive playback. If art remains visible while libraries fail, inspect the readiness error's affected block ID. Background-media fallbacks belong to the consumer; lock-screen claims require actual devices.

References: [verification](https://github.com/Provable-Games/onchain-midi-player/blob/main/docs/verifying.md), [layout](https://github.com/Provable-Games/onchain-midi-player/blob/main/docs/token-uri-layout.md), [gas](https://github.com/Provable-Games/onchain-midi-player/blob/main/docs/gas.md), [browser checks](https://github.com/Provable-Games/onchain-midi-player/blob/main/docs/development.md).
