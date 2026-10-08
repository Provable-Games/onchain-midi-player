# Stress NFT

A view-only consumer with twenty implicit tokens, configurable by its owner. Each token repeats a generated MIDI bar; the default counts in `repetitions.json` probe RPC view-call and response limits. Network deployments in `sepolia.json` describe historical contracts and do not imply a deployment of the new implementation.

The current consumer owns its complete document and art/UI assets, compiles its own encoder, and directly splices the generic loader, combined engine/headless player and complete data blocks. Art is a complete isolated encoded image. It uses the Beast-owned reference UI; no UI belongs to the MIDI class. See the [composition format](../../docs/token-uri-layout.md).

```sh
scarb build
snforge test
node scripts/gen_fixtures.mjs
node --test scripts/*.test.mjs
```

The large-token gas tests are ignored by default and can be run selectively with `--include-ignored`. Recalibrate counts against the final merged baseline before deploying a new stress contract. Runtime metadata/art/settings/MIDI encoding and returned ByteArray sizes all contribute to the budget.
