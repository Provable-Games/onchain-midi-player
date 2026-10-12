# Example: a stress NFT for RPC providers, wallets and explorers

`StressNft` is a view-only test contract with twenty tokens whose `token_uri` grows from 30M to over 10B Sierra gas. It exists to find where each RPC provider, wallet and explorer stops serving a large onchain MIDI token. Token 1 is as cheap as a small token. Tokens 18, 19 and 20 sit just under, at and just over the 10B view-call budget of Pathfinder (see [Node limits](../../docs/gas.md#node-limits)), so a Pathfinder-backed endpoint should serve 19 and fail 20.

The `token_uri` assembly is [`examples/beast_consumer`](../beast_consumer/README.md)'s: the same library calls to the TinySynth class, the same pieces and the same word alignment ([layout](../../docs/token-uri-layout.md)). What differs is the data:

- **art:** a small fixed SVG card with the token's name and its number of bars;
- **sound:** `default_settings()`, one preset;
- **music:** one bar of eight eighth notes (C5 E5 G5 C6 G5 E5 C5 G4), repeated `repetitions(token_id)` times in a format 0 Standard MIDI File of 48 bytes plus 64 per bar, ending with End-of-Track on the last bar line. It passes the [MIDI contract](../../docs/midi-contract.md) (`scripts/check_midi.mjs`);
- **metadata:** `name` ("Stress #7"), `description`, `image`, `animation_url` (the player with ▶ and ■) and `attributes` (`Token ID`, `Bars`).

Tokens 1 to 20 exist implicitly. There is no minting, ownership or transfer. The constructor takes the TinySynth class hash, which it checks (`engine() == 'tinysynth'`), and an owner. The owner can retune a token with `set_repetitions(token_id, n)`, without a redeploy.

```
examples/stress_nft/
├── Scarb.toml, Scarb.lock    separate package; depends on the root crate and builds its TinySynth class
├── repetitions.json          the calibrated bars per token: the source of src/repetitions.cairo
├── sepolia.json              the Sepolia deployment
├── src/
│   ├── stress_nft.cairo      StressNft: token_uri, the score, the SVG and the members
│   └── repetitions.cairo     generated: the table the constructor stores
├── tests/                    snforge tests (below); golden.cairo is generated
└── scripts/
    ├── reference.mjs         independent JS reference of token_uri and of the response size
    ├── gen_fixtures.mjs      checks every token, writes src/repetitions.cairo and tests/golden.cairo
    ├── rpc_check.mjs         calls token_uri(1..20) through RPC providers (below)
    └── reference.test.mjs    Node tests
```

## Calibration

Measured with snforge 0.64.0 and Scarb 2.20.1 in Sierra gas, as the `token_uri` row of `snforge test gas_token --ignored --gas-report`: the whole call, including its library calls (the setup is not counted). Gas is linear in the number of bars, about 1.005M per bar plus about 24M for the rest, so each count was fitted to its target and then adjusted by one or two bars. The last column is the size of the JSON-RPC response, with every felt a minimal hex string; the largest is a third of the 10 MiB response cap of jsonrpsee.

| token | target | bars | MIDI bytes | L2 gas | `token_uri` chars | JSON-RPC response bytes |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 30M | 6 | 432 | 30,017,180 | 57,057 | 123,369 |
| 2 | 60M | 36 | 2,352 | 60,240,210 | 61,617 | 133,224 |
| 3 | 100M | 76 | 4,912 | 100,295,320 | 67,681 | 146,331 |
| 4 | 200M | 175 | 11,248 | 200,067,050 | 82,709 | 178,812 |
| 5 | 286M | 261 | 16,752 | 286,240,480 | 95,749 | 206,993 |
| 6 | 400M | 374 | 23,984 | 399,542,940 | 112,885 | 244,029 |
| 7 | 600M | 573 | 36,720 | 599,934,850 | 143,077 | 309,284 |
| 8 | 800M | 772 | 49,456 | 800,171,090 | 173,269 | 374,538 |
| 9 | 1B | 971 | 62,192 | 1,000,278,080 | 203,461 | 439,792 |
| 10 | 1.2B | 1,170 | 74,928 | 1,200,427,260 | 233,653 | 505,046 |
| 11 | 1.6B | 1,567 | 100,336 | 1,599,550,040 | 293,877 | 635,205 |
| 12 | 2B | 1,965 | 125,808 | 1,999,607,710 | 354,245 | 765,680 |
| 13 | 3B | 2,960 | 189,488 | 3,000,053,320 | 505,205 | 1,091,946 |
| 14 | 4B | 3,955 | 253,168 | 3,999,946,390 | 656,149 | 1,418,183 |
| 15 | 5B | 4,949 | 316,784 | 4,999,193,420 | 806,933 | 1,744,071 |
| 16 | 6.5B | 6,442 | 412,336 | 6,500,444,310 | 1,033,429 | 2,233,593 |
| 17 | 8B | 7,934 | 507,824 | 7,999,994,320 | 1,259,765 | 2,722,771 |
| 18 | 9.9B | 9,824 | 628,784 | 9,900,049,950 | 1,546,485 | 3,342,456 |
| 19 | 9.99B | 9,914 | 634,544 | 9,990,341,500 | 1,560,149 | 3,371,988 |
| 20 | 10.1B | 10,023 | 641,520 | 10,100,192,480 | 1,576,685 | 3,407,726 |

The targets are the limits we know of: Juno's 100M default (token 3 is 0.3% above it), the 290.0M of a full-size Beast (token 5), which PublicNode does not serve, Katana's 1B default, and Pathfinder's 10B. The first live run found PublicNode's limit at about 100M: it serves tokens 1 and 2.

To recalibrate, edit `repetitions.json`, run `node scripts/gen_fixtures.mjs`, and measure again:

```sh
snforge test gas_token --ignored --gas-report
```

The gas tests are ignored because the large tokens take a few seconds each. Live nodes can account slightly differently from snforge: after calling a deployed contract, retune a token with `set_repetitions` (the owner's account) instead of redeploying. `rpc_check.mjs` reads the live counts from the contract, so it compares with the right reference either way.

## Tests

```sh
cd examples/stress_nft
scarb fmt --check && scarb build && snforge test
node --test scripts/*.test.mjs && node scripts/gen_fixtures.mjs
```

- **`token_uri`:** the length and SHA-256 of a small token (1) and a large one (12) equal the JS reference's, whose layers are checked against naive nesting and the page.
- **`set_repetitions`:** only the owner can call it, and it rejects zero bars and unknown tokens. Unknown tokens revert in the views too.
- **The engine check:** the constructor rejects a class that answers `engine()` with anything but `'tinysynth'`.
- **Node:** the score passes the page's MIDI check for every size, `token_uri` decodes to valid JSON with its page, and the largest response is under the 10 MiB cap.

## Deploy

```sh
cd examples/stress_nft
scarb --release build
sncast --account <account> --scarb-profile release declare --network sepolia --contract-name StressNft
sncast --account <account> deploy --network sepolia --class-hash <StressNft class hash> \
  --arguments '<TinySynth class hash>, <owner address>'
```

[`sepolia.json`](sepolia.json) records the Sepolia deployment: `StressNft` class `0x07d4855b…afccd`, contract `0x06f81222…d11d`, library-calling the TinySynth class `0.3.0` (`0x01f89374…83b0`), with the account `sdm-sepolia-deployer` as owner.

## Calling it through RPC providers

```sh
node scripts/rpc_check.mjs [env-file] [--only NAME,NAME] [--tokens 18-20] [--no-public] [--timeout 180] [--out FILE]
```

For each provider and token it calls `token_uri` (`starknet_call`), and records success or the error, the response size, the latency and whether the result is byte-identical to the JS reference. It prints a Markdown matrix and writes the details as JSON (`rpc_check_results.json`, ignored by Git). Providers run in parallel and each calls its tokens one at a time. The timeout is 180 s per call.

- **Public endpoints** are built in: zan.top, Cartridge, dRPC and PublicNode, the Sepolia endpoints that answered when this was written. Lava and BlastAPI report that they are discontinued, and Nethermind's free endpoint no longer resolves.
- **Providers with keys** go in a file of `NAME=URL` lines, outside every repository: the default is `~/.config/omp-rpc.env`, or pass another path. Blank lines and `#` comments are ignored. The script prints only the NAME: it never prints, logs or writes the URLs or keys, and it strips them from error messages. Never commit that file.
- **Cells:** `ok` with the latency is byte-identical to the reference; `OOG` is an out-of-gas revert (`Out of gas`, or Pathfinder's "could not reach the end of the program"); `TIMEOUT`, `TOO BIG`, `HTTP n` and `ERR` are the other failures, and `DIFF` is a result that differs from the reference. The distinct error messages follow the table.
- **Another network:** `--address` takes the contract on another network, with providers for it in the env file and `--no-public`.
