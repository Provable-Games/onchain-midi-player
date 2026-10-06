---
name: token-uri-inspector
description: Inspect a deployed or local NFT token_uri built with the onchain MIDI player (Provable-Games/onchain-midi-player). Fetch it with sncast or a raw starknet_call, decode its JSON, image and animation_url page, verify the embedded engine against the published hash, check the embedded MIDI and SETTINGS, check the art is safe, rebuild and view the page in a browser, and find which RPC providers can serve it. Use when a token's animation does not play or looks wrong, when verifying a token against a class version, or when checking RPC call gas caps.
license: Apache-2.0
compatibility: Needs Node 22 or later (and npm ci once for npm run validate-token-uri), a clone of https://github.com/Provable-Games/onchain-midi-player whose VERSION in src/page_data.cairo equals the class's version(), curl or sncast, and network access to a Starknet RPC.
---

# Inspecting a `token_uri`

A `token_uri` from this player is `data:application/json;base64,` + JSON whose `animation_url` is `data:text/html;base64,` + one HTML page: the fixed `PAGE` (engine gzipped, player), then the token's `SETTINGS`, MIDI and SVG art blocks. See [Consumer `token_uri` layout](https://github.com/Provable-Games/onchain-midi-player/blob/main/docs/token-uri-layout.md#consumer-token_uri-layout) and [Verifying the engine](https://github.com/Provable-Games/onchain-midi-player/blob/main/docs/verifying.md).

The class's `engine()` names its engine, and so the format of the `SETTINGS` block: `'tinysynth'` is the format these tools decode. RPC can call it only on a deployed instance of the class or through a getter of the NFT. The inspection instance in [`deployments/<network>.json`](https://github.com/Provable-Games/onchain-midi-player/blob/main/deployments/sepolia.json) (`class.inspection_instance.address`) answers it, and `version()`, `script_sha256()` and `license()`.

Run everything from a clone whose `grep 'pub const VERSION' src/page_data.cairo` prints the class's `version()`: `main` while it matches, otherwise the last commit before `VERSION` changed (README, [Agent skills](https://github.com/Provable-Games/onchain-midi-player/blob/main/README.md#agent-skills)). The same `VERSION` always means the same page bytes, and newer commits have the tools; a released class's tag, `v<version>`, has its page too. `version()` is SemVer. Node 22 or later; no `npm ci`, except for the validator in step 1. `I=plugins/onchain-midi-player/skills/token-uri-inspector/scripts` below.

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

To check the whole token in one run (it needs `npm ci` once, for the pinned SVG parser, unlike the scripts below), including the OpenSea metadata fields and attributes and every layer below, use the validator ([Validating a token_uri](https://github.com/Provable-Games/onchain-midi-player/blob/main/docs/verifying.md#validating-a-token_uri)):

```sh
npm run validate-token-uri -- token_uri.txt            # or call.json from step 1
npm run validate-token-uri -- --rpc "$RPC" --contract "$NFT" --token 4   # fetches it; no stderr mixing; STARKNET_RPC_URL works too
```

It prints PASS, WARN and FAIL with the source of each, and never prints the RPC URL. Exit status 0 means nothing failed (warnings allowed), 1 a failed check, 2 a usage error or an input it could not read or fetch. It does not rebuild the page (step 5) or compare RPC providers (step 7), and `--expect <script_sha256>` replaces only its engine comparison: the gzip payload and `PAGE` are still compared with the record of `VERSION`, or of `--version`. The steps below show each layer separately.

## 2. Decode

```sh
node examples/beast_consumer/scripts/decode.mjs token_uri.txt out/   # out/token.json, out/image.svg, out/animation.html
```

It writes `out/image.svg` only when the `image` is a base64 SVG data URI, as when the consumer reuses its onchain SVG as the art. For any other `image` (an external URL, a PNG) it prints the value and writes no `image.svg`: the art then comes only from the page (step 4). It checks that every base64 layer is canonical standard base64 and that the JSON is valid UTF-8. A failure here means the consumer's splicing is wrong: usually a piece that is not a multiple of 3 bytes, which leaves `=` padding mid-stream (see [Alignment](https://github.com/Provable-Games/onchain-midi-player/blob/main/docs/token-uri-layout.md#alignment)).

## 3. Verify the engine

```sh
node scripts/verify_engine.mjs token_uri.txt --expect <script_sha256() of the class>
```

It prints the SHA-256 and length of the gzip payload, the engine and the fixed `PAGE`, and exits 1 unless the engine matches `--expect`. Compare all three with the class's record in [`scripts/page_versions.json`](https://github.com/Provable-Games/onchain-midi-player/blob/main/scripts/page_versions.json), keyed by its `version()`: `gzip_sha256` and `gzip_len`, `script_sha256`, and `page_sha256`. A matching `PAGE` also proves the shim and the player around the engine are the class's. If the token's `version()` has no record, report the version as unknown rather than as a mismatch, and look its record up with `git log -p scripts/page_versions.json`.

`npm run validate-token-uri` makes this comparison with the record of `VERSION` itself, and reports a version the record lacks as a failure (exit status 1), or as a warning when `--expect` is given: read that as an unknown version, not a mismatch.

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

If the page plays here but not inside a marketplace's frame, the host is withholding something: a frame sandboxed without `allow-scripts`, or a host CSP without `script-src 'unsafe-inline'` (a `data:` or `srcdoc` frame inherits it), leaves the frame black, and a host CSP with `default-src 'none'` also needs `frame-src data:` for a `data:` frame. The page needs only inline script, inline style and `data:` images; a sandbox without `allow-same-origin` still plays. See [Browser validation](https://github.com/Provable-Games/onchain-midi-player/blob/main/docs/development.md#browser-validation).

## 7. Check RPC call caps

Marketplaces read `token_uri` with `starknet_call`, and each provider caps call gas. Call the token through several providers and compare: an `Out of gas` revert is that provider's cap, not a bug in the token.

```sh
# The providers your marketplaces and indexers use, on the network you deploy to
for RPC in "$RPC_1" "$RPC_2" "$RPC_3"; do
  sncast --json call --url "$RPC" --contract-address "$NFT" --function token_uri --calldata 4 0 > call.json 2>&1
  node $I/bytearray.mjs call.json | sha256sum
done
```

[Node limits](https://github.com/Provable-Games/onchain-midi-player/blob/main/docs/gas.md#node-limits) lists what each node software caps. Use your marketplaces' and indexers' actual providers, on the network you deploy to.
