---
name: integrator-guide
description: Add the onchain TinySynth music player (Provable-Games/onchain-tinysynth) to any Starknet NFT whose token_uri is a base64 JSON data URI. Turn the usual one-pass token_uri into base64 pieces, inject the player's pre-encoded animation_url segment and the token's midi_segment, keep the SVG art safe, decide where the class hash lives (in the NFT or in a small renderer contract), handle failures, and test with snforge against the JS reference. Use when integrating the player into an NFT contract, reviewing such an integration, budgeting its gas, or debugging a broken animation_url.
license: Apache-2.0
compatibility: Needs the Scarb and Starknet Foundry versions in the repository's .tool-versions, and Node 22 or later with a clone of https://github.com/Provable-Games/onchain-tinysynth for the offline tools.
---

# Integrating the onchain TinySynth player into `token_uri`

The class is declared on Starknet but never deployed. Your contract reaches it with `library_call` and gets back the pieces of a `token_uri` whose `animation_url` is an offline HTML page: the TinySynth engine gzipped, the player, then the token's settings, MIDI and SVG art.

- **Supported today:** `token_uri`s that are base64 JSON data URIs (`data:application/json;base64,…`). Plain-JSON `token_uri`s are issue [#29](https://github.com/Provable-Games/onchain-tinysynth/issues/29).
- **Source of truth:** the README's [Integration guide](https://github.com/Provable-Games/onchain-tinysynth/blob/main/README.md#integration-guide) and [Consumer `token_uri` layout](https://github.com/Provable-Games/onchain-tinysynth/blob/main/README.md#consumer-token_uri-layout). The interface and its byte formats: [`src/interface.cairo`](https://github.com/Provable-Games/onchain-tinysynth/blob/main/src/interface.cairo).
- **Reference implementation:** [`examples/beast_consumer/src/beast_like_nft.cairo`](https://github.com/Provable-Games/onchain-tinysynth/blob/main/examples/beast_consumer/src/beast_like_nft.cairo), commented step by step, with golden tests.
- **Related skills:** the MIDI comes from the [midi-guide](../midi-guide/SKILL.md), the `SynthSettings` from [sound-design](../sound-design/SKILL.md) (both often from a composer's contract through the sound provider interface, step 5), and checking a deployed token is the [token-uri-inspector](../token-uri-inspector/SKILL.md).

## 1. Depend on the crate

```toml
[dependencies]
onchain_tinysynth = { git = "https://github.com/Provable-Games/onchain-tinysynth", tag = "<release tag>" }
# Until a release is tagged: rev = "<commit>" (README "Deployments")

[[target.starknet-contract]]
sierra = true
# Builds the class from the dependency, so your tests can declare it (never deploy it).
build-external-contracts = ["onchain_tinysynth::contract::OnchainTinySynth"]
```

Use the Scarb and Starknet Foundry versions in its [`.tool-versions`](https://github.com/Provable-Games/onchain-tinysynth/blob/main/.tool-versions): the crate's base64 encoder uses unstable corelib features ([The base64 encoder](https://github.com/Provable-Games/onchain-tinysynth/blob/main/README.md#the-base64-encoder)).

```cairo
use onchain_tinysynth::interface::{IOnchainTinySynthDispatcherTrait, IOnchainTinySynthLibraryDispatcher};

let synth = IOnchainTinySynthLibraryDispatcher { class_hash: tinysynth_class_hash };
```

## 2. Change your `token_uri`

A typical onchain NFT builds its JSON, then base64-encodes it in one pass:

```text
"data:application/json;base64," ++ b64('{"name":…,"description":…,"attributes":[…],"image":"data:image/svg+xml;base64,' ++ b64(svg) ++ '"}')
```

With the player, the one structural change is to encode in pieces whose lengths are multiples of 3 bytes, and join them. That works because `b64(X ++ Y) == b64(X) ++ b64(Y)` when `len(X) % 3 == 0`, and it lets you inject the class's pre-encoded pieces without ever encoding the engine:

```text
"data:application/json;base64,"
  ++ b64('{' your members ',' <pad>)
  ++ b64(<pad> '"image":"data:image/svg+xml;base64,')
  ++ b64(S)                         S = b64(svg) '"' <pad>
  ++ b64(',' <pad>)
  ++ animation_url_segment()        ← INJECT: the player page
  ++ midi_segment(midi, settings)   ← INJECT: this token's music and sounds
  ++ b64(S)                         ← your SVG again, as the art the player shows
  ++ b64('}')                       the constant 'fQ==', no library call needed
```

- **`<pad>`** is spaces between JSON tokens, never inside a string, so each of your pieces is a multiple of 3 bytes: one space before the 35-byte image key, for example. Only the final `'fQ=='` may end in `=`.
- **The class's pieces are aligned already**, at both base64 layers. Append them as they come; never base64-encode them yourself.
- **`animation_url` must be the last member.** Its string is left open by the segment, and the second `b64(S)` closes it: at the HTML layer `b64(svg)` decodes to the raw SVG, the last block of the page, and the `"` ends both the HTML data URI and the JSON string. Strict JSON validators that require a fixed key order will reject this metadata.
- **`b64(S)` twice** is an optimization for an onchain SVG `image`: encode it once, append it twice. If your `image` is an external URL or another format, the art block still needs an SVG (step 3), so the layout drops the image-key piece, the first `b64(S)` and the separate comma piece; the segment then follows your members directly:

  ```text
  "data:application/json;base64,"
    ++ b64('{' your members, including "image":… ',' <pad>)
    ++ animation_url_segment()
    ++ midi_segment(midi, settings)
    ++ b64(S)                       S = b64(art_svg) '"' <pad>
    ++ 'fQ=='
  ```
- **Word alignment (optional gas tip).** A Cairo `ByteArray` appends whole 31-byte words only when it ends on a word boundary. Groups of 3 spaces encode to the constant `'ICAg'`, and `',  '` to `'LCAg'`, so you can add them, without encoding anything, until your largest appends (the first `b64(S)` and the segment) start on a word. See `align_to_word` in the reference implementation and the README's figures.
- **Your own encoder** works if it is standard RFC 4648 base64. Compiled into your contract it saves the library-call overhead, but it adds about 11K CASM felts ([Class size](https://github.com/Provable-Games/onchain-tinysynth/blob/main/README.md#class-size)), which matters near the 81,920-felt CASM limit. The class's `base64` entry point costs you nothing in class size.

## 3. Keep the art safe

- **The SVG must never contain `</script`, in any letter case.** In the page, the SVG is the raw text of the last, unclosed `<script type="text/plain">` block, and the HTML parser ends it at the first `</script`. The `image` member would still look fine on marketplaces, so only the page breaks. README: [Art (SVG) requirements](https://github.com/Provable-Games/onchain-tinysynth/blob/main/README.md#art-svg-requirements).
- **Non-SVG art** goes inside an SVG: the player shows the art as an SVG, so wrap a PNG or GIF in `<svg …><image href="data:image/png;base64,…" …/></svg>`. Strict base64 in the `href` cannot form `</script`.
- **Keep names and fields safe.** Build the SVG from fixed, reviewed literals and validated fields: a name charset without `<` or `/` (for example `A-Z a-z 0-9`, space, `'`, `-`), and strict base64 for embedded images. The same charset keeps names JSON-safe (no `"` or `\`).
- **Test it yourself.** The class never sees the SVG. Port `contains_script_end_tag` ([`examples/beast_consumer/tests/test_art_safety.cairo`](https://github.com/Provable-Games/onchain-tinysynth/blob/main/examples/beast_consumer/tests/test_art_safety.cairo)) or `assertArtSafe` ([`examples/beast_consumer/scripts/reference.mjs`](https://github.com/Provable-Games/onchain-tinysynth/blob/main/examples/beast_consumer/scripts/reference.mjs)) and run it on your renderer's real output.

## 4. Decide where the class hash lives

A `library_call` runs the class's code with your contract's storage. This class has no storage and touches none of yours, but whoever chooses the hash chooses the code that runs: a settable class hash in your NFT is effectively an upgrade path.

| Option | How | For | Against |
| --- | --- | --- | --- |
| In the NFT, fixed | Constructor argument, non-zero check, no setter (the reference implementation). | No admin to trust. | Engine fixes, new sounds and layout changes never reach the collection. `SynthSettings` compiled into an immutable NFT are frozen too. |
| In the NFT, settable | Owner-only setter. | One hash to opt into a new engine or page. | Every token changes at once, and the owner can run any class with the NFT's storage. |
| In the NFT, per token | Store the hash at mint. | Each token keeps the version it was minted with. | A storage write per mint and a read per `token_uri`. |
| **In a small renderer contract** | A deployed contract with no storage of value holds the layout, the `SynthSettings` and the class hash (or receives it), and library-calls the class. The NFT `call_contract`s the renderer. | The NFT's storage is never exposed to the class. The renderer, its sounds and the layout are replaceable without redeploying the NFT. Its CASM stays out of the NFT. | One more contract and call. |

Prefer the renderer for an NFT that cannot be upgraded, or whenever the hash is settable. beasts-v3 does this ([PR #124](https://github.com/Provable-Games/beasts-v3/pull/124)). In any setter, check the new value before storing it: library-call `version()` on a new hash and compare it with the version you expect, or have the renderer render a probe token.

## 5. MIDI and `SynthSettings`

- **Where they come from:** constants in your NFT or renderer (the reference implementation), or a composer's contract that implements the sound provider interface, `onchain_tinysynth::provider`. A MIDI file can select an instrument but not define one, so the composer's contract returns both: `ISoundProvider::get_sound(token_id) -> TokenSound { midi, settings }`. README: [Sound provider interface](https://github.com/Provable-Games/onchain-tinysynth/blob/main/README.md#sound-provider-interface), with the contract a provider must honour.
  - Call it with `try_get_sound(provider, token_id)`, which returns `None` instead of reverting (step 6), and pass `sound.midi` and `sound.settings` straight to `midi_segment`.
  - Let your renderer call the provider itself, rather than the NFT fetching the sound and passing it on: that saves a calldata hop for the MIDI and the settings.
  - Pass token IDs exactly as minted; the provider ignores the bits it does not use.
  - Store the provider address with a setter that calls `get_sound` once (an undeployed address reverts uncatchably), and let zero turn sound off: `try_get_sound` makes no call for it.
- **MIDI:** the bytes of a Standard MIDI File. The class embeds it without parsing it, so a bad file never reverts: the page shows an error instead. Check every score with `check-midi` in your CI ([Checking MIDI files](https://github.com/Provable-Games/onchain-tinysynth/blob/main/README.md#checking-midi-files) has a CI snippet). See the [midi-guide](../midi-guide/SKILL.md).
- **`SynthSettings`:** checked by `midi_segment`; an invalid value reverts the call. See [sound-design](../sound-design/SKILL.md).
- **Fixed or live sound.** For a given class hash, the same MIDI and settings always give the same sound. Fixed: pass constants or values from permanent traits, and a token sounds the same forever. Live: derive the MIDI and settings from state that changes (a level, a season, an onchain composer), and the sound follows it. When state changes what `token_uri` returns, emit an ERC-4906 `MetadataUpdate` (or `BatchMetadataUpdate`) so marketplaces refetch; the same applies when you switch the class hash or the renderer.

## 6. Handle failures

Decide what `token_uri` returns when the sound path fails: usually the token without sound.

- **What can be caught.** Since Starknet 0.13.4 a callee's panic, a missing entry point, and malformed or oversized return data come back to the caller as an error instead of reverting it. Call through a raw `call_contract_syscall` (or `library_call_syscall`), check the reply before using it (`Serde::deserialize` returns `None` on a truncated or malformed reply; reject trailing felts too), and fall back on any error. A generated safe dispatcher panics in your frame on malformed return data.
- **A sound provider:** `try_get_sound` does all of this. It returns `None` for a zero address (without calling), a provider that panics or has no `get_sound`, and a reply that is not exactly one `TokenSound`. It does not validate the settings, which `midi_segment` does: to fall back on invalid settings too, test the provider's output against the class in CI, or call `midi_segment` through `library_call_syscall` and treat an error as no sound.
- **What cannot.** An undeployed address, an undeclared class and running out of gas still revert the whole call. Probe them in your setters (step 4) and keep a kill switch, such as a zero value that turns sound off.
- **snforge 0.64.0 bug:** catching a panic from a safe *library* call leaves the caller's class hash replaced for the rest of the test, so later calls fail with `ENTRYPOINT_NOT_FOUND`. Test the failure paths with `call_contract` into mock contracts.

These findings come from the beasts-v3 integration ([PR #124](https://github.com/Provable-Games/beasts-v3/pull/124)).

## 7. Test with snforge

```cairo
use snforge_std::{ContractClassTrait, DeclareResultTrait, declare};

// Declare the class (thanks to build-external-contracts) and never deploy it.
let tinysynth = *declare("OnchainTinySynth").unwrap().contract_class().class_hash;
let nft_class = declare("YourNft").unwrap().contract_class();
let (address, _) = nft_class.deploy(@array![tinysynth.into()]).unwrap();
```

- **Golden comparison.** Build the expected `token_uri` in JS and assert byte equality in Cairo, as the reference implementation does: [`examples/beast_consumer/scripts/reference.mjs`](https://github.com/Provable-Games/onchain-tinysynth/blob/main/examples/beast_consumer/scripts/reference.mjs) mirrors the contract on top of the repository's [`scripts/page.mjs`](https://github.com/Provable-Games/onchain-tinysynth/blob/main/scripts/page.mjs) (`consumerPieces`, `spliceTokenUri`, `dFragment`), and [`gen_fixtures.mjs`](https://github.com/Provable-Games/onchain-tinysynth/blob/main/examples/beast_consumer/scripts/gen_fixtures.mjs) writes the Cairo golden file. For large tokens, compare length and SHA-256 (`compute_sha256_byte_array`) instead of the bytes.
- **Page check.** Decode your token's `token_uri` (token-uri-inspector) and compare its `animation.html` with `npm run preview -- <midi> --settings <json> --svg <svg>` for the same inputs. They must be identical bytes.
- **Step limit.** Hashing or naive-encoding a full token in a test can exceed snforge's default; the example raises `max_n_steps` in its `Scarb.toml`.

## 8. Gas and RPC caps

- **Worst case = your largest art plus your largest MIDI and settings.** Base64 over the SVG dominates (it is encoded twice); MIDI and settings add about 14M L2 gas per 1,000 bytes, custom wave tables included (from `page.9`; a long noise table can add billions: README [Custom waves](https://github.com/Provable-Games/onchain-tinysynth/blob/main/README.md#custom-waves)); from `page.7`, `SETTINGS` has no length cap ([The size of `SETTINGS`](https://github.com/Provable-Games/onchain-tinysynth/blob/main/README.md#the-size-of-settings-no-byte-cap)), and five operator fields have interim [engine limits](https://github.com/Provable-Games/onchain-tinysynth/blob/main/README.md#engine-limits-on-operator-values). Figures: README [Gas and limits](https://github.com/Provable-Games/onchain-tinysynth/blob/main/README.md#gas-and-limits), including [a full-size example `token_uri`](https://github.com/Provable-Games/onchain-tinysynth/blob/main/README.md#a-full-size-example-token_uri-against-the-1b-target). Measure your own worst token.
- **The measurement method changes the number about 2.5×.** Measured on the example's full-size token (`snforge test gas_t4_token_uri`): about 301M with `--tracked-resource sierra-gas`, about 765M with `--tracked-resource cairo-steps`. A devnet `starknet_estimateFee` of an INVOKE through devnet's predeployed account measured 740.6M: that account's class is Sierra 1.6, which forces cairo-steps (VM) accounting for the whole transaction.
  - Budget a `token_uri` in Sierra gas: snforge's `--gas-report`, or an estimate through an account whose class is Sierra 1.7 or later.
  - Treat devnet estimates through the predeployed accounts as inflated by about 2.0–2.6×.
- **Keep every class in the `token_uri` call chain at Sierra 1.7 or later:** the NFT, any proxy, the renderer, the sound provider and this class. A Cairo 0 or older-Sierra frame switches itself and every call below it to Cairo-steps accounting, which is sticky downward and has its own step cap.
- **Providers' call caps decide who can read a full token, not the protocol.** Node software caps `starknet_call` differently, and hosted providers do not document their caps (README [Network and node limits](https://github.com/Provable-Games/onchain-tinysynth/blob/main/README.md#network-and-node-limits)). On Sepolia, one public provider reverted `Out of gas` on the example's full-size token while others served it (README [Deployments](https://github.com/Provable-Games/onchain-tinysynth/blob/main/README.md#deployments), issue [#11](https://github.com/Provable-Games/onchain-tinysynth/issues/11)). Call your worst token through the providers your marketplaces and indexers use; the token-uri-inspector shows how.

## 9. Choose the class hash

- Take it from the README's [Deployments](https://github.com/Provable-Games/onchain-tinysynth/blob/main/README.md#deployments) table. Today only interim test classes exist there; the release class is not declared yet. Do not ship the interim class to production.
- Check a class before you use it: library-call `version()` and `script_sha256()` in a test, or run `verify_engine.mjs` on a token, and compare both with that version's row in [Versions](https://github.com/Provable-Games/onchain-tinysynth/blob/main/README.md#versions). The README's [Verifying the engine](https://github.com/Provable-Games/onchain-tinysynth/blob/main/README.md#verifying-the-engine) also rebuilds the class hash from source.

## Checklist

- [ ] `token_uri` is a base64 JSON data URI; strict key-order validators are not in your pipeline.
- [ ] Crate dependency pinned to the tag or commit of the class you use; `build-external-contracts` for tests.
- [ ] Your pieces padded to multiples of 3; class pieces appended untouched; `animation_url` last.
- [ ] The art is an SVG (raster art wrapped in `<image>`) that never contains `</script`; tested on real renderer output.
- [ ] Class hash placement chosen (NFT or renderer), with setters that probe the new value.
- [ ] MIDI and settings from constants or from a sound provider through `try_get_sound`, called by the renderer with the token ID as minted.
- [ ] Failures fall back to the token without sound; uncatchable cases probed in setters; a kill switch.
- [ ] Every score passes `check-midi` in CI; fixed or live sound chosen, with metadata-update events for live changes.
- [ ] Golden test against the JS reference; the decoded page equals `npm run preview` for the same inputs.
- [ ] Every class in the call chain at Sierra 1.7 or later; the worst token measured in Sierra gas and called through your providers.

The reference implementation's own checklist: [Integration checklist for a real NFT](https://github.com/Provable-Games/onchain-tinysynth/blob/main/examples/beast_consumer/README.md#integration-checklist-for-a-real-nft-such-as-beasts).
