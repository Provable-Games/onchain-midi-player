# Verifying the engine

Consumers library-call the class, so an explorer can call `script_sha256()` only on its inspection instance, listed in [`deployments/<network>.json`](../deployments). It does not need to: every token's `animation_url` carries the engine, and the steps below check it offline with standard tools, against the class's record in [`scripts/page_versions.json`](../scripts/page_versions.json), keyed by its `version()`. The file holds the current version; for an earlier one, find its record with `git log -p scripts/page_versions.json`.

What a class hash fixes, and what the consumer supplies:

- **Fixed per class hash:** the engine (gzipped in the page), the gunzip shim, the player, and with them the whole fixed page `PAGE`, plus `version()`, `script_sha256()` and `license()`. The class hash also covers the class's Cairo code (its base64 encoder and settings validation), so it changes when that code changes, even if the page does not.
- **Supplied by the consumer on each call:** the MIDI and the `TinySynthSettings` (through `midi_segment`), and the SVG art and the other JSON members (which the class never sees).

1. **Get the `token_uri`.** Read it from the collection's contract, which is deployed: in an explorer's read tab, with `sncast call`, or from a marketplace's metadata view. Save the string, `data:application/json;base64,...`, to `token_uri.txt`.
2. **Decode it and hash the engine.** The JSON layer, then the `animation_url` HTML layer, then the gzip payload of the page's `<script type="text/javascript+gzip" src="data:text/javascript;base64,...">` tag, base64-decoded and gunzipped. With a shell (GNU coreutils, grep and gzip):

   ```sh
   cut -d, -f2- token_uri.txt | base64 -d \
     | grep -o '"animation_url": *"data:text/html;base64,[^"]*' | cut -d, -f2- | base64 -d \
     | grep -o 'type="text/javascript+gzip" src="data:text/javascript;base64,[^"]*' | head -n 1 \
     | cut -d, -f2- | base64 -d > engine.js.gz
   sha256sum engine.js.gz              # the gzip payload
   wc -c < engine.js.gz                # its length: gzip_len
   gunzip -c engine.js.gz | sha256sum  # the engine: script_sha256()
   ```

   The first `grep` expects the JSON to write `/` unescaped, as the consumer layout does. The gzip tag is the page's first: `PAGE` comes before all per-token data, so text in the art cannot take its place. Python's standard library parses the JSON properly, and `gzip.decompress` checks the gzip CRC-32 and length:

   ```sh
   python3 - token_uri.txt <<'EOF'
   import base64, gzip, hashlib, json, re, sys
   uri = open(sys.argv[1]).read().strip()
   token = json.loads(base64.b64decode(uri.split(",", 1)[1]))        # JSON layer
   html = base64.b64decode(token["animation_url"].split(",", 1)[1])  # HTML layer, as bytes
   tag = rb'<script type="text/javascript\+gzip" src="data:text/javascript;base64,([^"]*)"'
   payload = base64.b64decode(re.search(tag, html).group(1))         # the gzip payload
   engine = gzip.decompress(payload)                                 # the engine
   print("gzip payload", hashlib.sha256(payload).hexdigest(), len(payload), "bytes")
   print("engine      ", hashlib.sha256(engine).hexdigest(), len(engine), "bytes")
   EOF
   ```

   Or, with Node 22 or later, [`scripts/verify_engine.mjs`](../scripts/verify_engine.mjs) (Node built-ins only, so the file can be copied and run on its own). It also accepts the token JSON, the `animation_url` or the decoded page, decodes base64 strictly, and looks for the tag only in the fixed page, outside HTML comments:

   ```sh
   node scripts/verify_engine.mjs token_uri.txt --expect <script_sha256()>
   ```

   For a given `version()`, all three print the gzip payload's SHA-256 and length, which must equal the record's `gzip_sha256` and `gzip_len`, and the engine's SHA-256, which must equal `script_sha256`.
3. **Compare.** The engine's SHA-256 must equal the class's `script_sha256()` (the hex form of the `u256` is the `sha256sum` string; a consumer contract or its tests can read it) and the `script_sha256` of the class's record in [`scripts/page_versions.json`](../scripts/page_versions.json). The gzip payload's SHA-256 and length must match the record's `gzip_sha256` and `gzip_len`.
4. **Check the engine against the fork.** When `engine_ref` in the record is a fork release tag, the [release](https://github.com/Provable-Games/webaudio-tinysynth/releases)'s `SHA256SUMS` lists the SHA-256 of `webaudio-tinysynth.min.js`, which must equal `script_sha256`. To rebuild it, use the fork commit in the record (`engine_commit`; a release tag points at it). The fork commits its minified build, and rebuilding it from the source reproduces it:

   ```sh
   git clone https://github.com/Provable-Games/webaudio-tinysynth && cd webaudio-tinysynth
   git checkout <engine fork commit>       # engine_commit
   sha256sum webaudio-tinysynth.min.js   # the committed build
   npm ci && npm run verify              # rebuilds it and compares the bytes
   ```

   The fork pins its build: Terser 5.51.2 exactly, in its `package.json` and `package-lock.json`, with every option in `scripts/build.js`. `npm run verify` rebuilds the minified file and its source map into a temporary directory, fails on any byte difference from the committed files, and prints their SHA-256 (`npm run build` rebuilds them in place instead).
5. **Optionally, check the rest of the page and the class.** `verify_engine.mjs` also prints the SHA-256 and length of the fixed page `PAGE` (the decoded page up to the opening tag of the settings block and its alignment spaces), which [`scripts/page_versions.json`](../scripts/page_versions.json) records for the current `version()`. A matching `PAGE` also proves that the payload you hashed sits in the page's own engine tag, the one that runs, and that the shim and the player around it are the class's. To check the class itself, check out this repository at the tag `v<version>` of a released class (the class's `release_tag`; for a test class, the `built_from` commit in [`deployments/<network>.json`](../deployments); a superseded class's entry is in that file's history, `git log -p deployments/<network>.json`), rebuild the page with `npm ci && npm run check:page` (the pinned Terser and fflate; it fails on any difference from the committed `PAGE` and `src/page_data.cairo`), run `scarb build`, compute the class hash (for example with `sncast utils class-hash --contract-name <contract>`, where `<contract>` is the `contract` field of the class's entry in the deployment file, or in its git history for a superseded class), and compare it with the deployment file's `class_hash`.

## Validating a `token_uri`

[`scripts/validate_token_uri.mjs`](../scripts/validate_token_uri.mjs) checks a whole `token_uri` against OpenSea's metadata standards and against the player page this repository produces. It needs Node 22 or later, `npm ci` (the SVG is parsed with the pinned dev dependency [`@xmldom/xmldom`](https://github.com/xmldom/xmldom)) and a checkout whose `VERSION` equals the class's `version()` (or pass `--version`). `--expect <script_sha256>` replaces only the engine comparison: the gzip payload and `PAGE` are always compared with the record, and warn if the version has none:

```sh
npm run validate-token-uri -- token_uri.txt                    # a file, or - for stdin
npm run validate-token-uri -- --rpc "$RPC" --contract "$NFT" --token 4   # fetch with starknet_call (or set STARKNET_RPC_URL)
npm run validate-token-uri -- call.json --json                 # machine-readable report
```

The input is a `token_uri`, the token JSON, a raw `starknet_call` response (or its result felts), or `sncast --json call` output. The report lists PASS, WARN and FAIL checks with the source of each, the SHA-256 of `PAGE`, and the size of every layer. It exits 0 unless a check fails, 1 on a failure and 2 for a usage error or an input it cannot read or fetch. The RPC URL, which may hold an API key, is never printed, and neither is any of an RPC error's payload: a failed call shows only its code, a fixed name for it, and known revert reasons (`Out of gas`, `ENTRYPOINT_NOT_FOUND`, the class's `TS: ...`).

| Layer | Checks | Source |
| --- | --- | --- |
| input | the `ByteArray` felts decode to one string | [`bytearray.mjs`](../plugins/onchain-midi-player/skills/token-uri-inspector/scripts/bytearray.mjs) |
| `token_uri` | printable ASCII, the `data:application/json;base64,` prefix, canonical base64 with the offset of the first bad character, UTF-8 | OpenSea [Metadata storage](https://docs.opensea.io/docs/metadata-storage) |
| JSON | strict parse; `name` and `image` present and strings, `description` a string (warn if absent); `external_url` an http(s) URL; `background_color` six hex digits without `#`; unknown and legacy fields (`youtube_url`, `image_data`) warn | OpenSea [Media and traits](https://docs.opensea.io/docs/media-and-traits), [ERC-721](https://eips.ethereum.org/EIPS/eip-721) metadata schema |
| `attributes` | an array of objects with a `value` (string or number); `display_type` one of `number`, `boost_number`, `boost_percentage`, `date` with a numeric value (`date` in Unix seconds); `max_value` a number; a quoted number is a string trait (warn) | OpenSea [Media and traits](https://docs.opensea.io/docs/media-and-traits) |
| `image` | an SVG data URI of canonical base64, UTF-8, well-formed XML in the SVG namespace (no `<!ENTITY>` declarations), no `<script>`, event handler or processing instruction, no `</script` in any case, no reference outside the document (`href`, `src`, `url()`, `@import`, with CSS escapes decoded, must be `#fragment` or `data:`); warns above 1 MiB | OpenSea Media and traits, [Art (SVG) requirements](token-uri-layout.md#art-svg-requirements) |
| `animation_url` | an HTML data URI of canonical base64; no element or CSS reference outside the page, and a warning for network URLs in the page text | OpenSea Media and traits |
| player page | the engine inflates and its SHA-256, the gzip payload and `PAGE` equal the record of the version in [`page_versions.json`](../scripts/page_versions.json); the settings, MIDI and art blocks follow `PAGE`; `SETTINGS` decodes and passes the class's checks; the MIDI passes [`check_midi`](midi-contract.md)'s check; the art block equals the `image` | steps 2 to 5 above, [Sound settings](sound-settings.md), [MIDI contract](midi-contract.md) |
| sizes | the JSON-RPC response (measured when fetched, otherwise estimated from the felts) against the 10 MiB cap of jsonrpsee nodes; a warning above 80% of it | [Node limits](gas.md#node-limits) |

OpenSea documents no size limit for data URIs, and shows an `animation_url` HTML page in a sandboxed iframe. A token whose `animation_url` is another media type fails the player checks. An external `image` skips the image checks with a warning, and the art block is checked as an SVG instead.

## Engine provenance

- **Engine:** TinySynth from the Provable Games fork, <https://github.com/Provable-Games/webaudio-tinysynth>. The fork removes the GUI and adds the features the player uses (lifecycle, loop timing, custom waves, filters, seeded noise and reverb, input validation). It is licensed Apache-2.0, like upstream, and its NOTICE lists every change.
- **The pin:** the class embeds the fork's own minified build at the ref and commit in its [`scripts/page_versions.json`](../scripts/page_versions.json) record. The build is offline: the minified file and the fork's NOTICE are vendored in [`tests/vendor/`](../tests/vendor), and `ENGINE_PIN` in [`scripts/engine.mjs`](../scripts/engine.mjs) checks both SHA-256 hashes on every load, before anything is generated. Re-pinning is described in [`tests/vendor/README.md`](../tests/vendor/README.md).
- **The gunzip shim:** [`player/gunzip.js`](../player/gunzip.js) is derived from [fflate](https://github.com/101arrowz/fflate) 0.8.3's `gunzipSync` (MIT; the license is [vendored](../tests/vendor/fflate-0.8.3.LICENSE) and in `license()`), trimmed to one-shot inflation, with the gzip trailer checks added. The file lists every change. The build minifies it with the pinned Terser and checks the result against `SHIM_PIN` in [`scripts/page.mjs`](../scripts/page.mjs), so the bytes that inflate the engine change only deliberately.
- **Compression:** the pinned fflate compresses at level 9 with no timestamp and no file name, so the payload depends only on the engine bytes.

| Hash (SHA-256) | Of | Where |
| --- | --- | --- |
| the engine's | the engine, decompressed: the fork's `webaudio-tinysynth.min.js` at the pinned ref | `script_sha256()`, `page_data::ENGINE_SHA256`, `script_sha256` in the record |
| the payload's | the gzip payload in `PAGE` | `page_data::GZIP_SHA256`, `page_data::GZIP_LEN`, `gzip_sha256` and `gzip_len` in the record |
| `bf6316a818dc7519afafa5af7bf826af5280c9950d208f0a2822f4295ab0d4df` | the minified gunzip shim | `SHIM_PIN` in [`scripts/page.mjs`](../scripts/page.mjs) |
