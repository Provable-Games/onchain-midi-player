---
name: integrator-guide
description: Add the onchain TinySynth music player (Provable-Games/onchain-tinysynth) to a Starknet NFT contract's token_uri in Cairo. Library-call the declared OnchainTinySynth class, splice its pre-encoded animation_url segment and midi_segment into a Beasts-layout base64 data URI, keep the SVG art safe, choose and store the class hash, and test with snforge against the JS reference. Use when integrating the player into an NFT such as beasts-v3, reviewing such an integration, budgeting its gas, or debugging a broken animation_url.
license: Apache-2.0
compatibility: Needs the Scarb and Starknet Foundry versions in the repository's .tool-versions, and Node 22 or later with a clone of https://github.com/Provable-Games/onchain-tinysynth for the offline tools.
---

# Integrating the onchain TinySynth player into `token_uri`

The class is declared on Starknet but never deployed. Your NFT stores its class hash and calls it with `library_call`. It returns the pieces of a `token_uri` whose `animation_url` is an offline HTML page: the TinySynth engine gzipped, the player, then the token's settings, MIDI and SVG art.

- **Template:** [`examples/beast_consumer/src/beast_like_nft.cairo`](https://github.com/Provable-Games/onchain-tinysynth/blob/main/examples/beast_consumer/src/beast_like_nft.cairo), commented step by step. Copy its `token_uri`.
- **Source of truth:** the README's [Integration guide](https://github.com/Provable-Games/onchain-tinysynth/blob/main/README.md#integration-guide) and [Consumer `token_uri` layout](https://github.com/Provable-Games/onchain-tinysynth/blob/main/README.md#consumer-token_uri-layout-the-beasts-layout). The interface and its byte formats: [`src/interface.cairo`](https://github.com/Provable-Games/onchain-tinysynth/blob/main/src/interface.cairo).
- **Related skills:** the MIDI comes from the [midi-guide](../midi-guide/SKILL.md), the `SynthSettings` from [sound-design](../sound-design/SKILL.md), and checking a deployed token is the [token-uri-inspector](../token-uri-inspector/SKILL.md).

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

let synth = IOnchainTinySynthLibraryDispatcher { class_hash: self.tinysynth_class_hash.read() };
```

## 2. Hold the class hash

A `library_call` runs the class's code in your contract's context, with full access to your storage. This class has no storage and touches none of yours, but whoever chooses the hash chooses that code. Setting it is as powerful as upgrading your contract.

| Option | How | For | Against |
| --- | --- | --- | --- |
| Fixed | Constructor argument, non-zero check, no setter (the example). | Every token's page is fixed for good; no admin to trust. | Engine fixes and new features (deterministic noise, custom waves) never reach the collection. |
| Settable | Owner-only setter that emits an event (and an ERC-4906 metadata update, if you support it). | Opt into a new engine or page by updating one hash. | Every token's page changes at once; holders trust the owner with code that runs in the contract. |
| Per token | Store the hash at mint; each token renders with its own. | Each token keeps the version it was minted with; new mints get new versions. | A storage write per mint and a read per `token_uri`. |

In a setter, library-call `version()` on the new hash and compare it with the version you expect, so a typo cannot ship. Pick hashes only from the README's [Deployments](https://github.com/Provable-Games/onchain-tinysynth/blob/main/README.md#deployments) table, and check them against [Versions](https://github.com/Provable-Games/onchain-tinysynth/blob/main/README.md#versions) (step 8).

## 3. Assemble the Beasts layout

```text
"data:application/json;base64,"
  ++ b64('{' members ',' <pad>)  ++ 'ICAg'...  ++ b64(' "image":"data:image/svg+xml;base64,')
  ++ b64(S)                       S = svg_b64 '"' <pad>, encoded once, used twice
  ++ 'LCAg' ++ 'ICAg'...          b64(',' and spaces)
  ++ animation_url_segment()      pre-encoded page; never re-encode it
  ++ midi_segment(midi, settings) per-token settings and MIDI, opens the art block
  ++ b64(S)                       the art; closes both data URIs
  ++ b64('}')
```

The rules:

- **Your pieces are multiples of 3 bytes** before encoding: `'{' members ',' <pad>`, the image-key piece, `S` and the comma piece. Pad with spaces between JSON tokens. Only the final `b64('}')` may end in `=`. This works because `b64(X ++ Y) == b64(X) ++ b64(Y)` when `len(X) % 3 == 0`.
- **The class's pieces are already aligned** at both base64 layers (9 bytes). Append them as they come. Never base64-encode the segment yourself: it is the whole engine.
- **`b64(S)` twice.** Encode the SVG once (`svg_b64`), build `S`, encode `S` once, and append it as the `image` value and again as the art that closes `animation_url`.
- **Key order:** your members, then `image`, then `animation_url` last.
- **Word alignment (optional, saves gas):** groups of 3 spaces (`'ICAg'`, a constant) so the first `b64(S)` and the segment start on a 31-byte `ByteArray` word. See `align_to_word` in the template and the README's figures.
- **Your own encoder is fine** if it is standard RFC 4648 base64; one compiled into your contract also saves the library-call overhead.

## 4. Keep the art safe

- **The SVG must never contain `</script`, in any letter case.** In the page, the SVG is the raw text of the last, unclosed `<script type="text/plain">` block, and the HTML parser ends it at the first `</script`. The `image` member would still look fine on marketplaces, so only the page breaks. README: [Art (SVG) requirements](https://github.com/Provable-Games/onchain-tinysynth/blob/main/README.md#art-svg-requirements).
- **Keep names and fields safe.** Build the SVG from fixed, reviewed literals and validated fields: a name charset without `<` or `/` (Beasts: `A-Z a-z 0-9`, space, `'`, `-`), and strict base64 for embedded images. The same charset keeps names JSON-safe (no `"` or `\`).
- **Test it yourself.** The class never sees the SVG. Port `contains_script_end_tag` ([`examples/beast_consumer/tests/test_art_safety.cairo`](https://github.com/Provable-Games/onchain-tinysynth/blob/main/examples/beast_consumer/tests/test_art_safety.cairo)) or `assertArtSafe` ([`examples/beast_consumer/scripts/reference.mjs`](https://github.com/Provable-Games/onchain-tinysynth/blob/main/examples/beast_consumer/scripts/reference.mjs)) and run it on your renderer's real output.

## 5. MIDI and `SynthSettings`

- **MIDI:** the bytes of a Standard MIDI File. The class embeds it without parsing it, so a bad file never reverts: the page shows an error instead. Check every score with `check-midi` in your CI ([Checking MIDI files](https://github.com/Provable-Games/onchain-tinysynth/blob/main/README.md#checking-midi-files) has a CI snippet). See the [midi-guide](../midi-guide/SKILL.md).
- **`SynthSettings`:** validated by `midi_segment`; an invalid value reverts the whole `token_uri`. Pass constants or values derived only from permanent traits, so each token's sound stays fixed. See [sound-design](../sound-design/SKILL.md).

## 6. Test with snforge

```cairo
use snforge_std::{ContractClassTrait, DeclareResultTrait, declare};

// Declare the class (thanks to build-external-contracts) and never deploy it.
let tinysynth = *declare("OnchainTinySynth").unwrap().contract_class().class_hash;
let nft_class = declare("YourNft").unwrap().contract_class();
let (address, _) = nft_class.deploy(@array![tinysynth.into()]).unwrap();
```

- **Golden comparison.** Build the expected `token_uri` in JS and assert byte equality in Cairo, as the example does: [`examples/beast_consumer/scripts/reference.mjs`](https://github.com/Provable-Games/onchain-tinysynth/blob/main/examples/beast_consumer/scripts/reference.mjs) mirrors the contract on top of the repository's [`scripts/page.mjs`](https://github.com/Provable-Games/onchain-tinysynth/blob/main/scripts/page.mjs) (`consumerPieces`, `spliceTokenUri`, `dFragment`), and [`gen_fixtures.mjs`](https://github.com/Provable-Games/onchain-tinysynth/blob/main/examples/beast_consumer/scripts/gen_fixtures.mjs) writes the Cairo golden file. For large tokens, compare length and SHA-256 (`compute_sha256_byte_array`) instead of the bytes.
- **Page check.** Decode your token's `token_uri` (token-uri-inspector) and compare its `animation.html` with `npm run preview -- <midi> --settings <json> --svg <svg>` for the same inputs. They must be identical bytes.
- **Step limit.** Hashing or naive-encoding a full token in a test can exceed snforge's default; the example raises `max_n_steps` in its `Scarb.toml`.

## 7. Gas and RPC caps

- Figures: README [Gas and limits](https://github.com/Provable-Games/onchain-tinysynth/blob/main/README.md#gas-and-limits), including [a full Beasts `token_uri`](https://github.com/Provable-Games/onchain-tinysynth/blob/main/README.md#a-full-beasts-token_uri-against-the-1b-target). Most of it is base64 over the SVG; MIDI and settings add about 14M L2 gas per 1,000 bytes.
- **The measurement method changes the number about 2.5×.** Measured on the example's full-size Beast (`snforge test gas_t4_token_uri`): about 299M with `--tracked-resource sierra-gas`, about 762M with `--tracked-resource cairo-steps`. A devnet `starknet_estimateFee` of an INVOKE through devnet's predeployed account measured 740.6M: that account's class is Sierra 1.6, which forces cairo-steps (VM) accounting for the whole transaction.
  - Budget a `token_uri` in Sierra gas: snforge's `--gas-report`, or an estimate through an account whose class is Sierra 1.7 or later.
  - Treat devnet estimates through the predeployed accounts as inflated by about 2.0–2.6×.
- **Marketplaces call `token_uri` with `starknet_call`, and providers cap call gas.** On Sepolia, one public provider reverted `Out of gas` on the example's full-size Beast while others served it (README [Deployments](https://github.com/Provable-Games/onchain-tinysynth/blob/main/README.md#deployments), issue [#11](https://github.com/Provable-Games/onchain-tinysynth/issues/11)). Call your worst-case token through the providers your marketplaces and indexers use; the token-uri-inspector shows how.

## 8. Choose the class hash

- Take it from the README's [Deployments](https://github.com/Provable-Games/onchain-tinysynth/blob/main/README.md#deployments) table. Today only interim test classes exist there; the release class is not declared yet. Do not ship the interim class to production.
- Check a class before you use it: library-call `version()` and `script_sha256()` in a test, or run `verify_engine.mjs` on a token, and compare both with that version's row in [Versions](https://github.com/Provable-Games/onchain-tinysynth/blob/main/README.md#versions). The README's [Verifying the engine](https://github.com/Provable-Games/onchain-tinysynth/blob/main/README.md#verifying-the-engine) also rebuilds the class hash from source.

## Checklist

- [ ] Crate dependency pinned to the tag or commit of the class you store; `build-external-contracts` for tests.
- [ ] Class hash policy chosen (fixed, settable or per token), with `version()` checked in any setter.
- [ ] Your pieces padded to multiples of 3; class pieces appended untouched; `b64(S)` reused; `animation_url` last.
- [ ] SVG never contains `</script`; names and fields restricted; tested on real renderer output.
- [ ] Every score passes `check-midi` in CI; settings constant or from permanent traits.
- [ ] Golden test against the JS reference; the decoded page equals `npm run preview` for the same inputs.
- [ ] Worst-case `token_uri` measured in Sierra gas and called through your providers.

The example's longer checklist: [Integration checklist for a real NFT](https://github.com/Provable-Games/onchain-tinysynth/blob/main/examples/beast_consumer/README.md#integration-checklist-for-a-real-nft-such-as-beasts).
