# Stress NFT

A view-only consumer with twenty implicit tokens, configurable by its owner. Each token repeats a generated MIDI bar; the default counts in `repetitions.json` probe RPC view-call and response limits. Network deployments in `sepolia.json` describe historical contracts and do not imply a deployment of the new implementation.

The current consumer owns its complete document and art/UI assets, compiles its own encoder, and directly splices the generic loader, combined engine/headless player and complete data blocks. Art is a complete isolated encoded image. It uses the Beast-owned reference UI, the [`owned_assets`](../owned_assets) package; no UI belongs to the MIDI class. See the [composition format](../../docs/token-uri-layout.md).

```sh
scarb build
snforge test
node scripts/gen_fixtures.mjs
node --test scripts/*.test.mjs
```

The large-token gas tests are ignored by default and can be run selectively with `--include-ignored`. Recalibrate counts against the final merged baseline before deploying a new stress contract. Runtime metadata/art/settings/MIDI encoding and returned ByteArray sizes all contribute to the budget.

To probe providers, use a checkout matching the deployed stress consumer and pass its address explicitly. The default `sepolia.json` address is historical and does not use the current fragments. Set `STRESS_NFT_ADDRESS` to the contract to inspect, then run from the repository root:

```sh
node examples/stress_nft/scripts/rpc_check.mjs /private/path/rpc.env \
  --no-public --only PROVIDER --address "$STRESS_NFT_ADDRESS" \
  --tokens 1,5,9 --timeout 180 --out rpc-results.json
```

The private env file contains `NAME=URL` lines; `PROVIDER` is one of those names. Drop `--no-public --only PROVIDER` to include the built-in public endpoints too. The helper records each token's success/error, response size and latency, reads live repetition counts when available, and checks results against this checkout's independent reference. A DIFF can reflect a consumer/build mismatch; it is not itself a provider fault. See the [inspector](../../plugins/onchain-midi-player/skills/token-uri-inspector/SKILL.md) for sncast/raw RPC fetching with full u256 calldata and layer decoding, and [node limits](../../docs/gas.md#node-limits) for interpreting gas, size and timeout failures.
