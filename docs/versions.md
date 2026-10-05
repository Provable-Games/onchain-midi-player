# Versions and deployments

Class hashes are immutable. The engine and the player page are stored in the class when it is declared, so they are fixed per class version: a given class hash, called with the same MIDI and `SynthSettings`, always produces the same output and sound. Sound settings come from the consumer on each call, so they can change without a new class. A new engine or page means a new class hash and a new `version()`. Consumers choose when to switch by updating the class hash they store, and tokens keep working with the class hash they have.

## Versions

The class is declared but never deployed, so block explorers cannot call `version()` or `script_sha256()` on it. This table is how collectors find these values for a class; [Verifying the engine](verifying.md) checks a token against them.

| `version()` | Class hash (Sepolia) | Class hash (mainnet) | Release tag | `script_sha256()` (decompressed engine) | Gzip payload SHA-256 / length | Engine fork commit |
| --- | --- | --- | --- | --- | --- | --- |
| `tinysynth-fc04dbe+page.10` | not declared | not declared | none | `4135920f9591e37e1c6f9f839e0756cccb30e3b2cd3b4972f6f68860821e8c2c` | `3a0f61485f5ac3bd723566adbcdb595da7a7bfa93f9d28fd29c22f0408270310` / 14,056 bytes | [`fc04dbe`](https://github.com/Provable-Games/webaudio-tinysynth/commit/fc04dbe7d78bd0a4de5eb80887756f31c2c373f2) |
| `tinysynth-3d965d1+page.9` | `0x1a0c989b6cb7d5f045e526728fb22069fa584515e17c77ad4f0da5932161b66` (test class) | not declared | none | `95d8947a460a2e3ca410a285822668c76b65493b88094b9c83a0207311206c31` | `3087c4a65f8d7fc24ca73621d5812855bed3b4877e4f6c153e5dca2792ac57de` / 13,994 bytes | [`3d965d1`](https://github.com/Provable-Games/webaudio-tinysynth/commit/3d965d1cef4756bb85b9dd307b85511fd543afbf) |
| `tinysynth-4b29ff1+page.6` | `0x442cab13e9049a2eed9e508273ccfad626e690da394de58ba4f62d675b4f85a` (test class) | not declared | none | `b49e8ceb802b7665cd6f66100dc390874c806a8894be464273d43c532940fc55` | `dec711614d61133881b642bc93829a26a7ac1cc8b7b34e5dd25f4f2482aa5d63` / 10,406 bytes | [`4b29ff1`](https://github.com/Provable-Games/webaudio-tinysynth/commit/4b29ff10d40989fd97967ed26ee4b2c95dbd8a26) |

- The first row is the version this repository builds. Its hashes and length come from [`src/page_data.cairo`](../src/page_data.cairo) (`VERSION`, `ENGINE_SHA256`, `GZIP_SHA256`, `GZIP_LEN`), and `npm test` fails if the row disagrees with them.
- The SHA-256 of the whole `PAGE` for each `version()` is in [`scripts/page_versions.json`](../scripts/page_versions.json).
- The class hash covers the class's Cairo code as well as the page, so it is known only once a class is declared. A declared row never changes.

## Deployments

Where the class and the example are declared or deployed. A consumer stores a class hash from this table.

| Network | What | Class hash | Contract address | Built from |
| --- | --- | --- | --- | --- |
| Sepolia | Test class, `version()` `tinysynth-3d965d1+page.9`, not for production | `0x1a0c989b6cb7d5f045e526728fb22069fa584515e17c77ad4f0da5932161b66` | `0x073956b0a1dd278fe75a9a190afba520cc5ea1a10036264e640791a29dbdb511` (inspection instance) | [`7f5d592`](https://github.com/Provable-Games/onchain-midi-player/commit/7f5d592) |
| Sepolia | Example `BeastLikeNft` ([`examples/beast_consumer`](../examples/beast_consumer)), library-calling the class above | `0x7f290530571bdfd547b05125ff87ac54b5b395f580e41c64226e06f3a3b725c` | `0x02afe413608e07eb426344cd9108440e9304321fc55626f7e91e1ba6655f8392` | [`7f5d592`](https://github.com/Provable-Games/onchain-midi-player/commit/7f5d592) |
| Sepolia | Test class, `version()` `tinysynth-4b29ff1+page.6`, not for production | `0x442cab13e9049a2eed9e508273ccfad626e690da394de58ba4f62d675b4f85a` | `0x064b629e081c108fef2a39fbd314a792d78be06339a6edc32c397bb7e8aab97d` (inspection instance) | [`d735793`](https://github.com/Provable-Games/onchain-midi-player/commit/d7357936754b5753ee4e9cc9134a0d373b75c099) |
| Sepolia | Example `BeastLikeNft` ([`examples/beast_consumer`](../examples/beast_consumer)), library-calling the class above | `0x7f290530571bdfd547b05125ff87ac54b5b395f580e41c64226e06f3a3b725c` | `0x066dd6aa3b669e66df4cf6fc74cf18a335a95268154292e44ea0c59227caea92` | [`d735793`](https://github.com/Provable-Games/onchain-midi-player/commit/d7357936754b5753ee4e9cc9134a0d373b75c099) |

- **The Sepolia classes** were declared before the project was renamed, as `OnchainTinySynth` in the package `onchain_tinysynth`.
- **The `page.6` class** restarts the art only on ▶, not at every pass, and its page rejects settings counts above its older, lower caps.
- **The inspection instance** is a deployment of the class (no storage, no constructor), so explorers and RPC can call `version()`, `script_sha256()` and `license()`. Consumers still `library_call` the class hash.
- **Built from** is the commit to rebuild each class from. To run `npm run preview` and the agent skills' tools against a class, use the newest commit with the same `VERSION` (see [Agent skills](../README.md#agent-skills)).
