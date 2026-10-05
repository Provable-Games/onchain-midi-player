# Gas and limits

L2 gas, measured with snforge 0.64.0 and Scarb 2.20.1. The short version, for budgeting a token, is in the [README](../README.md#how-much-fits-gas-and-limits).

## Measure in Sierra gas

Every figure here is Sierra gas, snforge's default. Cairo-steps accounting gives numbers about 2.5× higher. On the example's full-size token (`snforge test gas_t4_token_uri`, the call with its test setup): about 301M with `--tracked-resource sierra-gas` and about 765M with `--tracked-resource cairo-steps`. A devnet `starknet_estimateFee` of an INVOKE through devnet's predeployed account measured 740.6M, because that account's class is Sierra 1.6, which forces Cairo-steps accounting for the whole transaction.

- Budget a `token_uri` in Sierra gas: snforge's `--gas-report`, or an estimate through an account whose class is Sierra 1.7 or later.
- Treat devnet estimates through its predeployed accounts as inflated by about 2.0–2.6×.

## Entry points

Through `IOnchainTinySynthLibraryDispatcher` on the declared class, as a consumer calls them, including passing the arguments and the result ([`tests/test_class_gas.cairo`](../tests/test_class_gas.cairo), `snforge test gas_lc`):

| Entry point | L2 gas |
| --- | --- |
| `animation_url_segment()` | 7.8M: 0.35M to materialize the constant, the rest to return its 53,476 bytes |
| `midi_segment(midi, settings)` | 1.6M with no MIDI and the default settings; 60.7M with a 3,716-byte score and the 3 reference sounds (334 bytes of `SETTINGS`); 3,162.7M with that score and the largest valid `SETTINGS` without custom waves (218,264 bytes) |
| `base64(data)` | 0.2M for 3 bytes, 3.8M for 1,023 bytes, and about 3.6K per input byte for large inputs |
| `script_sha256()` | 0.1M |
| `engine()` | 0.1M |
| `version()` | 0.1M |
| `license()` | 2.2M |

## `midi_segment` by MIDI and `SETTINGS` size

Called directly, net of building the inputs (`snforge test gas_ms gas_b64_midi`). Rows are synthetic scores with the sizes of production Beast scores ([`tests/fixtures/midi/`](../tests/fixtures/midi/README.md)); the gas depends only on the MIDI's length. Columns are `SETTINGS` sizes: the defaults, the 3 Beast reference sounds, 6 timbres, one timbre on every slot (175 timbres of one operator), and the largest valid input without custom waves (175 timbres of 8 filtered operators, every field at its type's extreme). Each cell is the total, then the share spent on base64:

| MIDI | 16 bytes | 334 bytes | 504 bytes | 9,836 bytes | 218,264 bytes |
| --- | --- | --- | --- | --- | --- |
| none | 1.4M (86%) | 5.8M (63%) | 8.3M (61%) | 144.8M (53%) | 3,000.6M (56%) |
| 816 bytes | 13.2M (97%) | 17.6M (86%) | 19.7M (82%) | 156.6M (56%) | |
| 1,541 bytes | 23.0M (97%) | 27.7M (90%) | 29.9M (87%) | 166.8M (59%) | |
| 2,266 bytes | 33.4M (97%) | 37.4M (92%) | 40.3M (90%) | 176.4M (61%) | |
| 2,991 bytes | 43.0M (98%) | 47.5M (94%) | 49.9M (92%) | 186.4M (63%) | |
| 3,716 bytes | 53.5M (98%) | 57.9M (94%) | 60.4M (93%) | 196.5M (65%) | 3,052.3M (57%) |

The rest is validating and encoding `SETTINGS` and assembling the page fragment. The library call adds the cost of passing the inputs: 2.8M for the 3,716-byte score with the reference sounds, about 110M with the largest `SETTINGS`.

## A full-size token

Token 4 of the example ([`examples/beast_consumer`](../examples/beast_consumer/README.md#gas)) is a full-size Beast:

- **art:** the Beasts renderer's SVG for a shiny, animated Warlock, 22,733 bytes;
- **music:** a synthetic score the size of the largest Beast score, 3,716 bytes;
- **sounds:** the 3 reference sounds, 334 bytes of `SETTINGS`;
- **layout:** word-aligned.

Its `token_uri` is 144,357 characters. The whole call is from `snforge test token_uri_4 --gas-report`; the pieces are from the example's `gas_t4_*` tests, each net of its inputs:

| Piece | L2 gas | Of which base64 |
| --- | --- | --- |
| **Whole `BeastLikeNft.token_uri`** | **288.6M** | **239.5M (83%)** |
| `animation_url_segment()` (library call) | 7.8M | none |
| `midi_segment()` (library call) | 60.1M | 54.6M |
| The consumer's base64 (4 library calls): `b64(svg)` 82.6M, `b64(S)` 110.2M, the head and `'}'` about 1M | about 194M | 184.9M |
| The appends (word-aligned layout; 32.6M unaligned) | 16.4M | none |
| The rest: SVG and score constants, members, name check | about 10M | none |

- **Most of it is the SVG.** The two base64 passes over the SVG are 67% of the total: the same two passes any onchain SVG NFT makes, encoding the SVG for `image`, then the whole JSON over it. What sound adds is the segment, `midi_segment` and the appends: about 84M.
- **Each byte of SVG** costs about 9K L2 gas in the full `token_uri`: two base64 passes through the library call, plus appending `b64(S)` twice.
- **Small tokens are cheap:** the example's sample tokens, with a 1 KB SVG and a 112-byte MIDI, cost 32.7M to 32.9M.

## The size of `SETTINGS`

`SETTINGS` has no length limit. The class checks only what the format and the engine require (see [Sound settings](sound-settings.md)). The rest is priced in gas, and served or refused by the RPC node.

- **Counts are bounded:** at most 175 timbres (each program and drum slot once), 8 operators each, and 256 waves. A wave's length is not bounded, and numbers take any value of their integer type. So without custom waves the largest valid input is 218,264 bytes, and with custom waves there is no largest input.
- **Cost is linear,** over every size measured, from 23 KB to 5.4 MB: about 14.5M L2 gas per KB through `midi_segment`. About 5–6M of that is encoding; the rest is base64, because `SETTINGS` is encoded twice. Validation never exceeds about 23M, because it checks counts, slots, routes, wave indices and filters, not samples.
- **Realistic settings are cheap.** The 3 reference sounds (334 bytes) or 6 timbres (504 bytes) add 4–7M over the defaults, about 2% of a full-size token. A full pack of about 20 two- or three-operator timbres is about 2.6 KB, which adds about 40M.

`midi_segment` through the library call, with a 3,716-byte score:

| `SETTINGS` | Bytes | Calldata (felts) | `midi_segment` |
| --- | --- | --- | --- |
| The 3 reference sounds | 334 | 221 | 60.7M |
| 22 timbres × 8 operators | 23,022 | 2,658 | 385.2M |
| 44 timbres × 8 operators | 46,034 | 5,188 | 715.0M |
| 88 timbres × 8 operators | 92,058 | 10,248 | 1,375.3M |
| The long reference LFSR (32,767 samples) and one drum timbre | 147,532 | | 2,192.8M |
| The largest input without custom waves: 175 timbres × 8 filtered operators, every field at its type's extreme | 218,264 | | 3,162.7M |
| 175 timbres × 8 operators, plus 256 waves of 1,024 samples | 1,501,203 | 284,309 | 21,163.3M |

- **Where the limits fall.** A full-size token passes 1B at about 48 KB of `SETTINGS`, and the 1.11B transaction cap at about 56 KB. It reaches 10B at about 670 KB.
- **Every size runs.** The 1.5 MB input takes 174M Cairo steps through `token_uri`. The repository's tests go up to the largest input without custom waves, which takes about 22M steps through `midi_segment`, so [`Scarb.toml`](../Scarb.toml) raises snforge's step limit to 100M.

## Node limits

A `token_uri` is a view call (`starknet_call`), so what limits it is the node that serves it, not the protocol.

**No protocol limit applies to a large view call.**

- `call_contract` and `library_call` have no calldata or retdata cap and no per-felt syscall charge. Their cost is flat: about 91.6K L2 gas for `CallContract` and 89.2K for `LibraryCall`.
- Moving data costs what the Serde code costs: about 3.3K gas per `felt252` per hop, and about 4.3K per 31-byte `ByteArray` chunk per hop.
- Call depth is capped at 50.
- The 1.11B L2 gas cap per transaction and the 5,000-felt calldata cap apply only to transactions, never to `starknet_call`. A view call measured at 5.38B passed.
- Source: [starkware-libs/sequencer](https://github.com/starkware-libs/sequencer) at `16facd2c92`, files `crates/blockifier/src/execution/syscalls/hint_processor.rs`, `entry_point.rs`, `blockifier_versioned_constants_0_14_3.json` and `transaction/account_transaction.rs`.

**Node limits**, from their configuration or code:

| Node | Gas for a view call | Other limits |
| --- | --- | --- |
| Pathfinder v0.24.0 | 10B, compiled in (`default_initial_gas_cost`, `crates/executor/src/call.rs`) | Top-level `starknet_call` calldata at most 10,000 felts, which `token_uri(token_id)` never approaches; 120 s timeout |
| Juno v0.16.6 | `--rpc-call-max-gas`, 100M by default (raisable) | No cap on a single response |
| Madara | 10B | Requests and responses at most 15 MiB |
| jsonrpsee, and StarkWare's `apollo_rpc` | | Responses at most 10 MiB: a returned `ByteArray` of about 4.85 MB, or about 2.7 MB of `SETTINGS` |
| Katana (development) | 1B by default | |
| Hosted providers | Undocumented | On Sepolia, zan.top, Cartridge and dRPC served the example's full-size token; PublicNode reverted `Out of gas` on it |

- A full-size token with the reference sounds (288.6M) already needs more than Juno's default.
- Check a full-size token through the providers your marketplaces and indexers use. The [`token-uri-inspector`](../plugins/onchain-midi-player/skills/token-uri-inspector/SKILL.md) skill shows how.
- **Keep every class in the call chain at Sierra 1.7 or later.** If any class in the chain is Cairo 0 or Sierra before 1.7 (a proxy pointing at an old class, for example), that frame and everything below it switches to Cairo-steps accounting. It is then capped at 10M steps (Juno: 4M), about 1B gas. `midi_segment` alone takes about 22M steps with the largest `SETTINGS` without custom waves.
