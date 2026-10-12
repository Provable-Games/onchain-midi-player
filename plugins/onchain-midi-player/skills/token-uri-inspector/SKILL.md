---
name: token-uri-inspector
description: Inspect a deployed or local NFT token_uri built with the onchain MIDI player (Provable-Games/onchain-midi-player). Fetch it with sncast or a raw starknet_call, decode its JSON, image and animation_url page, verify separate loader/combined-player artifacts and the embedded engine byte range, check the embedded MIDI and SETTINGS, inspect NFT-owned content, view the complete page in a browser, and find which RPC providers can serve it. Use when a token's animation does not play or looks wrong, when verifying a token against a class version, or when checking RPC call gas caps.
license: Apache-2.0
compatibility: Needs Node 22 or later and npm ci once for verification and HTML splitting, a full clone of https://github.com/Provable-Games/onchain-midi-player whose VERSION in src/segment_data.cairo equals the class's version(), curl or sncast, and network access to a Starknet RPC.
---

Inspect a token URI by fetching its view result, decoding Cairo ByteArray felts, then decoding canonical JSON/HTML data URIs. Network calls are read-only. Use the token's complete u256 ID and the correct chain/deployed NFT address. Historical deployments do not establish that a new class version has been declared.

For an already-declared older class, check out its matching release tag or build commit and run that revision's verifier and inspector. The current manifest covers the current fragment architecture; historical deployment/build records document provenance but do not add compatibility to its verifier. A matching version number alone is insufficient for an unreleased build: match its recorded artifact hashes too.

From the matching repository root, run `npm ci`. Set `RPC_URL` and `NFT_ADDRESS` for the correct chain and deployed NFT. These two fetch methods are alternatives; both write `call.json`. Cairo serializes a u256 as its low limb followed by its high limb, so token 4 uses `0x4 0x0`. Preserve both limbs for larger IDs.

```sh
TOKEN_LOW=0x4
TOKEN_HIGH=0x0
sncast call --json --url "$RPC_URL" --block-id latest \
  --contract-address "$NFT_ADDRESS" --function token_uri \
  --calldata "$TOKEN_LOW" "$TOKEN_HIGH" > call.json
```

For a raw RPC call, compute the selector with the pinned sncast rather than copying a hash:

```sh
TOKEN_URI_SELECTOR=$(sncast utils selector --json token_uri | node -e 'process.stdout.write(JSON.parse(require("node:fs").readFileSync(0,"utf8")).selector)')
curl --fail-with-body --silent --show-error -H 'Content-Type: application/json' \
  --data-binary @- "$RPC_URL" > call.json <<JSON
{"jsonrpc":"2.0","id":1,"method":"starknet_call","params":{"request":{"contract_address":"$NFT_ADDRESS","entry_point_selector":"$TOKEN_URI_SELECTOR","calldata":["$TOKEN_LOW","$TOKEN_HIGH"]},"block_id":"latest"}}
JSON
```

Decode and verify the result using the full checkout paths:

```sh
node plugins/onchain-midi-player/skills/token-uri-inspector/scripts/bytearray.mjs call.json > token_uri.txt
node scripts/validate_token_uri.mjs token_uri.txt --json
node scripts/verify_engine.mjs token_uri.txt
node examples/beast_consumer/scripts/decode.mjs token_uri.txt decoded
node plugins/onchain-midi-player/skills/token-uri-inspector/scripts/split_page.mjs decoded/animation.html decoded
npm run check-midi -- decoded/midi.b64
node --input-type=module - decoded/settings.txt <<'JS'
import { readFileSync } from 'node:fs';
import { decodeSettings } from './player/settings.js';
import { validateSettings } from './player/validate.js';
validateSettings(decodeSettings(readFileSync(process.argv[2], 'utf8')));
console.log('SETTINGS valid');
JS
```

The bytearray helper accepts raw RPC felts or sncast's decoded response and reports RPC errors instead of treating them as token data. The decode helper writes `token.json` and exact `animation.html`, plus `image.svg` only for a base64 SVG metadata image. The verifier checks uniquely identified loader and combined-player artifacts separately and the exact embedded engine bytes against `scripts/library_versions.json`. Comments, inert data, template/raw-text content and encoded art are excluded; additional gzip libraries and changed NFT heads/body layouts are allowed. Matching class-library hashes do not certify additional NFT scripts or media policy.

The splitter extracts complete `onchain-midi-settings`/`onchain-midi-data` blocks. No art block or image/art equality assumption exists. Data IDs must be unique across document elements, excluding template contents, and identify complete HTML `text/plain` scripts. Library selection excludes SVG/MathML scripts but includes HTML scripts inside `foreignObject`. Missing/duplicate required blocks and modified libraries fail explicitly. Art belongs to NFT-owned isolated image markup and may differ from `metadata.image`.

For a StressNft provider-cap matrix, use the matching checkout and its deployed stress address explicitly. Supply a private env file of `NAME=URL` lines; the helper redacts those URLs/keys and stores only provider names. This example probes selected tokens against only the named configured provider:

```sh
node examples/stress_nft/scripts/rpc_check.mjs /private/path/rpc.env \
  --no-public --only PROVIDER --address "$STRESS_NFT_ADDRESS" \
  --tokens 1,5,9 --timeout 180 --out rpc-results.json
```

The helper records success/error, response bytes, latency and comparison with this checkout's stress reference. It reads live `repetitions` where available. Its default address in `examples/stress_nft/sepolia.json` is historical; a current checkout can report DIFF for that older consumer. DIFF alone does not establish a provider defect. Record address/build/block and observed errors, and distinguish gas limits from response limits/timeouts. See the [stress workflow](https://github.com/Provable-Games/onchain-midi-player/blob/main/examples/stress_nft/README.md). For an arbitrary NFT, use the fetch commands above with its realistic largest IDs; stress token calibration is not its budget.

Preserve exact source/payload bytes when reporting hashes. Report verified library identities, independent/consumer scripts, metadata/data validity, response size and RPC gas limits separately.

For custom layouts inspect script namespaces, data-ID collisions and inert parser contexts as well as markup order. Open complete decoded animation HTML offline using the documented browser tools. Check custom controls after OnchainLibraries.ready and OnchainMidiPlayer.ready. Core readiness creates no synth/audio/UI; user gestures drive playback. If art remains visible while libraries fail, inspect the readiness error's affected block ID. Background-media fallbacks belong to the consumer; lock-screen claims require actual devices.

References: [verification](https://github.com/Provable-Games/onchain-midi-player/blob/main/docs/verifying.md), [layout](https://github.com/Provable-Games/onchain-midi-player/blob/main/docs/token-uri-layout.md), [gas](https://github.com/Provable-Games/onchain-midi-player/blob/main/docs/gas.md), [browser checks](https://github.com/Provable-Games/onchain-midi-player/blob/main/docs/development.md).
