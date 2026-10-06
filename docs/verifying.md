# Verifying library provenance

Verification identifies the class-owned loader, engine and headless player independently. NFT layout, UI, art and additional library code remain consumer-owned; matching library hashes does not certify their behavior.

From a matching checkout:

```sh
npm ci
node scripts/verify_engine.mjs token_uri.txt
node scripts/verify_engine.mjs token_uri.txt --expect ENGINE_SHA256
node scripts/validate_token_uri.mjs token_uri.txt --json
```

The engine verifier accepts raw HTML, animation data URIs, token JSON and JSON data URIs. The metadata validator additionally handles Cairo ByteArray/RPC/sncast results, checks metadata, UTF-8/base64/XML, settings and strict MIDI, and reports sizes/provider limits. The inspector's [splitter](../plugins/onchain-midi-player/skills/token-uri-inspector/scripts/split_page.mjs) extracts complete unique `onchain-midi-settings` and `onchain-midi-data` blocks without depending on art or document ordering.

`scripts/html_blocks.mjs` selects actual document script blocks, excluding comments, inert data, template contents, raw-text elements and SVG/MathML art. Required IDs must be unique and tags complete. Additional gzip blocks and variable NFT heads/body layouts are accepted. Missing/duplicate required blocks, changed wrappers/source/alignment, corrupt gzip and modified class artifacts fail explicitly.

The active [segment manifest](../scripts/library_versions.json) records class version, format/alignment, deterministic fflate/Terser toolchain, engine pin/decompressed SHA-256, loader/player source hashes, raw/returned lengths/hashes and gzip lengths/hashes. It contains no class-owned whole-page identity. Independent test libraries have their own [manifest](../tests/fixtures/libraries/manifest.json); future third-party providers maintain theirs separately. [Historical build records](../deployments/historical-builds.json) support already-declared test-class provenance without asserting that those classes implement the new architecture.

The [engine pin](../scripts/engine.mjs) checks vendored bytes against the fork commit. `script_sha256()` interprets the exact decompressed hash as a big-endian u256. Node's gunzip checks CRC and trailer size; the generic browser loader checks the same integrity, strict data-URI/base64 framing and fatal UTF-8 decoding. It inserts classic inline scripts without eval, Function, fetching payload URIs or external requests.

Brief dependency attribution stays with the relevant loader/engine fragment. `license()` remains a function returning the full library/dependency notices, including the engine fork NOTICE, fflate MIT and the compiled game-components encoder MIT license. No full license getter is duplicated into every segment.
