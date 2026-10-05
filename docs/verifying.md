# Verifying the engine

Consumers library-call the class, so an explorer can call `script_sha256()` only on its inspection instance, listed in [`deployments/<network>.json`](../deployments/sepolia.json). It does not need to: every token's `animation_url` carries the engine, and the steps below check it offline with standard tools, against the class's record in [`scripts/page_versions.json`](../scripts/page_versions.json), keyed by its `version()`.

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

   For the current version, all three print the gzip payload's SHA-256 `61b365e518ad022c344cb60d99ae4d43aa640c6a2121d9605a75f75b28da0b64` (14,074 bytes) and the engine's `8ad79ab8214e45a601e7d929e676b34b78e3f2b4200fd751d6548cf2b7df7749` (46,504 bytes).
3. **Compare.** The engine's SHA-256 must equal the class's `script_sha256()` (the hex form of the `u256` is the `sha256sum` string; a consumer contract or its tests can read it) and the `script_sha256` of the class's record in [`scripts/page_versions.json`](../scripts/page_versions.json). The gzip payload's SHA-256 and length must match the record's `gzip_sha256` and `gzip_len`.
4. **Optionally, rebuild the engine** from the fork commit in that record (`engine_commit`). The fork commits its minified build, and rebuilding it from the source reproduces it:

   ```sh
   git clone https://github.com/Provable-Games/webaudio-tinysynth && cd webaudio-tinysynth
   git checkout <engine fork commit>       # engine_commit, for example 4bf982994dc3d1187661385726fed2e6595fafbe
   sha256sum webaudio-tinysynth.min.js   # the committed build
   npm ci && npm run verify              # rebuilds it and compares the bytes
   ```

   The fork pins its build: Terser 5.51.2 exactly, in its `package.json` and `package-lock.json`, with every option in `scripts/build.js`. `npm run verify` rebuilds the minified file and its source map into a temporary directory, fails on any byte difference from the committed files, and prints their SHA-256 (`npm run build` rebuilds them in place instead).
5. **Optionally, check the rest of the page and the class.** `verify_engine.mjs` also prints the SHA-256 and length of the fixed page `PAGE` (the decoded page up to the opening tag of the settings block and its alignment spaces), which [`scripts/page_versions.json`](../scripts/page_versions.json) records for every `version()`. A matching `PAGE` also proves that the payload you hashed sits in the page's own engine tag, the one that runs, and that the shim and the player around it are the class's. To check the class itself, check out this repository at the tag `v<version>` of a released class (for a test class, the `built_from` commit in [`deployments/<network>.json`](../deployments/sepolia.json); a superseded class's entry is in that file's history, `git log -p deployments/<network>.json`), rebuild the page with `npm ci && npm run check:page` (the pinned Terser and fflate; it fails on any difference from the committed `PAGE` and `src/page_data.cairo`), run `scarb build`, compute the class hash (for example with `sncast utils class-hash --contract-name <contract>`, where `<contract>` is the deployment file's `contract` field, `TinySynth`), and compare it with the deployment file's `class_hash`.

## Engine provenance

- **Engine:** TinySynth from the Provable Games fork, <https://github.com/Provable-Games/webaudio-tinysynth>. The fork removes the GUI and adds the features the player uses (lifecycle, loop timing, custom waves, filters, seeded noise and reverb, input validation). It is licensed Apache-2.0, like upstream, and its NOTICE lists every change.
- **The pin:** the class embeds the fork's own minified build at the commit in its [`scripts/page_versions.json`](../scripts/page_versions.json) record. The build is offline: the minified file and the fork's NOTICE are vendored in [`tests/vendor/`](../tests/vendor), and `ENGINE_PIN` in [`scripts/engine.mjs`](../scripts/engine.mjs) checks both SHA-256 hashes on every load, before anything is generated. Re-pinning is described in [`tests/vendor/README.md`](../tests/vendor/README.md).
- **The gunzip shim:** [`player/gunzip.js`](../player/gunzip.js) is derived from [fflate](https://github.com/101arrowz/fflate) 0.8.3's `gunzipSync` (MIT; the license is [vendored](../tests/vendor/fflate-0.8.3.LICENSE) and in `license()`), trimmed to one-shot inflation, with the gzip trailer checks added. The file lists every change. The build minifies it with the pinned Terser and checks the result against `SHIM_PIN` in [`scripts/page.mjs`](../scripts/page.mjs), so the bytes that inflate the engine change only deliberately.
- **Compression:** the pinned fflate compresses at level 9 with no timestamp and no file name, so the payload depends only on the engine bytes.

| Hash (SHA-256) | Of | Where |
| --- | --- | --- |
| `8ad79ab8214e45a601e7d929e676b34b78e3f2b4200fd751d6548cf2b7df7749` | the engine, decompressed: the fork's `webaudio-tinysynth.min.js` at `4bf9829` (46,504 bytes) | `script_sha256()`, `page_data::ENGINE_SHA256` |
| `61b365e518ad022c344cb60d99ae4d43aa640c6a2121d9605a75f75b28da0b64` | the gzip payload in `PAGE` (14,074 bytes) | `page_data::GZIP_SHA256`, `page_data::GZIP_LEN` |
| `bf6316a818dc7519afafa5af7bf826af5280c9950d208f0a2822f4295ab0d4df` | the minified gunzip shim | `SHIM_PIN` in [`scripts/page.mjs`](../scripts/page.mjs) |
