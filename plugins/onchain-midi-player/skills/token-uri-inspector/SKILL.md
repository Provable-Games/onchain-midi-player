---
name: token-uri-inspector
description: Inspect a deployed or local NFT token_uri built with the onchain MIDI player (Provable-Games/onchain-midi-player). Fetch it with sncast or a raw starknet_call, decode its JSON, image and animation_url page, verify the embedded engine against the published hash, check the embedded MIDI and SETTINGS, check the art is safe, rebuild and view the page in a browser, and find which RPC providers can serve it. Use when a token's animation does not play or looks wrong, when verifying a token against a class version, or when checking RPC call gas caps.
license: Apache-2.0
compatibility: Needs Node 22 or later, a clone of https://github.com/Provable-Games/onchain-midi-player whose VERSION in src/page_data.cairo equals the class's version(), curl or sncast, and network access to a Starknet RPC.
---

# Inspecting a `token_uri`

A `token_uri` from this player is `data:application/json;base64,` + JSON whose `animation_url` is `data:text/html;base64,` + one HTML page: the fixed `PAGE` (engine gzipped, player), then the token's `SETTINGS`, MIDI and SVG art blocks. See [Consumer `token_uri` layout](https://github.com/Provable-Games/onchain-midi-player/blob/main/docs/token-uri-layout.md#consumer-token_uri-layout) and [Verifying the engine](https://github.com/Provable-Games/onchain-midi-player/blob/main/docs/verifying.md).

Run everything from a clone whose `grep 'pub const VERSION' src/page_data.cairo` prints the class's `version()`: `main` while it matches, otherwise the last commit before `VERSION` changed (README, [Agent skills](https://github.com/Provable-Games/onchain-midi-player/blob/main/README.md#agent-skills)). The same `VERSION` always means the same page bytes, and newer commits have the tools. Node 22 or later; no `npm ci`. `I=plugins/onchain-midi-player/skills/token-uri-inspector/scripts` below.

## 1. Fetch

The NFT contract is deployed, so any RPC can call it. `token_uri` takes a `u256`: pass its low and high felts.

With `sncast` (it decodes the `ByteArray` for you):

```sh
sncast --json call --url "$RPC" --contract-address "$NFT" --function token_uri --calldata 4 0 > call.json 2>&1
node $I/bytearray.mjs call.json > token_uri.txt
```

With a raw `starknet_call` over curl (`sncast` only computes the selector; any starknet_keccak tool works):

```sh
SEL=$(sncast utils selector token_uri | awk '/Selector/ {print $2}')   # starknet_keccak of the name
curl -s -X POST "$RPC" -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"starknet_call",
  "params":{"request":{"contract_address":"'"$NFT"'","entry_point_selector":"'"$SEL"'","calldata":["0x4","0x0"]},"block_id":"latest"}}' > call.json
node $I/bytearray.mjs call.json > token_uri.txt
```

`bytearray.mjs` turns the result felts (`[full words, 31-byte words…, pending word, pending length]`) into the string. On a revert it prints the error with its short strings decoded, such as `revert reason: Out of gas, ENTRYPOINT_FAILED`, and exits 1.

For a local contract, print the `token_uri` from an snforge test instead, as the example's `print_sample_token_uri` does ([example README](https://github.com/Provable-Games/onchain-midi-player/blob/main/examples/beast_consumer/README.md#run-it)).

## 2. Decode

```sh
node examples/beast_consumer/scripts/decode.mjs token_uri.txt out/   # out/token.json, out/image.svg, out/animation.html
```

It writes `out/image.svg` only when the `image` is a base64 SVG data URI, as when the consumer reuses its onchain SVG as the art. For any other `image` (an external URL, a PNG) it prints the value and writes no `image.svg`: the art then comes only from the page (step 4). It checks that every base64 layer is canonical standard base64 and that the JSON is valid UTF-8. A failure here means the consumer's splicing is wrong: usually a piece that is not a multiple of 3 bytes, which leaves `=` padding mid-stream (see [Alignment](https://github.com/Provable-Games/onchain-midi-player/blob/main/docs/token-uri-layout.md#alignment)).

## 3. Verify the engine

```sh
node scripts/verify_engine.mjs token_uri.txt --expect <script_sha256() of the class>
```

It prints the SHA-256 and length of the gzip payload, the engine and the fixed `PAGE`, and exits 1 unless the engine matches `--expect`. Compare all three with the class's row in [Versions](https://github.com/Provable-Games/onchain-midi-player/blob/main/docs/versions.md#versions) and [`scripts/page_versions.json`](https://github.com/Provable-Games/onchain-midi-player/blob/main/scripts/page_versions.json). A matching `PAGE` also proves the shim and the player around the engine are the class's.

## 4. Split the page, check the MIDI and the art

```sh
node $I/split_page.mjs out/animation.html out/image.svg   # writes out/settings.txt, out/midi.b64, out/art.svg
# no out/image.svg (the image is not an onchain SVG)? leave it off: node $I/split_page.mjs out/animation.html
npm run check-midi -- out/midi.b64
```

- `split_page.mjs` checks the art contains no `</script` and, given `image.svg`, that the art block holds exactly the `image` bytes. A failure means the page shows a broken image even though marketplaces show the `image` fine (see [Art (SVG) requirements](https://github.com/Provable-Games/onchain-midi-player/blob/main/docs/token-uri-layout.md#art-svg-requirements)).
- `check-midi` runs the page's own MIDI check. A failure is the error the page shows with ▶ disabled ([midi-guide](../midi-guide/SKILL.md)).
- `out/settings.txt` is the token's `SETTINGS`; the class validated it before writing it ([sound-design](../sound-design/SKILL.md)).

## 5. Rebuild the page from its blocks

```sh
npm run preview -- out/midi.b64 --settings out/settings.txt --svg out/art.svg --out out/rebuilt.html
cmp out/rebuilt.html out/animation.html && echo identical
```

Identical bytes prove the token's page is exactly what this checkout's class produces for those inputs: the right version and correct splicing. A difference at the start means another `PAGE` (a different `version()`); later, a consumer bug.

## 6. View it

Serve the page and open it in a browser; press ▶ to play:

```sh
(cd out && python3 -m http.server 8000 --bind 127.0.0.1)   # then open http://localhost:8000/animation.html
```

`npm run preview -- … --serve` does the same for a page it builds. In a dev container, forward the port to the host first (VS Code: the Ports panel): a link to a `/tmp` path opens nothing on the host.

## 7. Check RPC call caps

Marketplaces read `token_uri` with `starknet_call`, and each provider caps call gas. Call the token through several providers and compare: an `Out of gas` revert is that provider's cap, not a bug in the token.

```sh
for RPC in https://api.zan.top/public/starknet-sepolia/rpc/v0_10 https://api.cartridge.gg/x/starknet/sepolia https://starknet-sepolia-rpc.publicnode.com; do
  sncast --json call --url "$RPC" --contract-address "$NFT" --function token_uri --calldata 4 0 > call.json 2>&1
  node $I/bytearray.mjs call.json | sha256sum
done
```

[Node limits](https://github.com/Provable-Games/onchain-midi-player/blob/main/docs/gas.md#node-limits) records which Sepolia providers served the example's full-size Beast (issue [#11](https://github.com/Provable-Games/onchain-midi-player/issues/11)). Use your marketplaces' and indexers' actual providers, on the network you deploy to.
