# Sound provider interface

The class plays a token's MIDI with its `SynthSettings`; it does not know where they come from. [`ISoundProvider`](../src/interface.cairo) (`onchain_midi_player::interface::ISoundProvider`) and [`TokenSound`](../src/types.cairo) (`onchain_midi_player::types::TokenSound`) fix how a composer's contract serves them, so any NFT can call any composer, and an NFT can change composers without changing its code. **The class does not implement or call `ISoundProvider`**: it is a convention between composers and NFTs, declared in this crate so that both compile against the same types. It changes neither the class hash nor `PAGE`.

A Standard MIDI File can select an instrument, with a program change or a note on channel 10, but it cannot define one. So the composer's contract owns both the score and the instrument definitions it plays, as `SynthSettings`. The NFT, or its renderer, calls `get_sound` and passes both straight to `midi_segment`:

```cairo
// onchain_midi_player::types
#[derive(Drop, Clone, Serde, PartialEq, Debug)]
pub struct TokenSound {
    pub midi: ByteArray, // a raw Standard MIDI File
    pub settings: SynthSettings, // the instruments it plays
}

// onchain_midi_player::interface
#[starknet::interface]
pub trait ISoundProvider<T> {
    /// The score and the instruments in one call: what NFTs call.
    fn get_sound(self: @T, token_id: u256) -> TokenSound;
}
```

**One function, because the player needs one thing from a provider:** the token's sound, the MIDI and its instruments, in one call that reads the token's state once. Interfaces for the MIDI alone or the settings alone belong to the composer's own project, not to this crate.

**A provider adds `get_sound` beside the interfaces it already has.** The Beast composer's contract (`midi_fun_contract`) keeps its own `IMidiProvider` (`get_midi`, `get_midi_for`) and `ISynthSettingsProvider` (`get_settings`), and implements only `get_sound` from this crate. Cairo reports a name clash when one contract implements two traits that share a function name; with `get_sound` alone, the provider's own `get_midi` and `get_settings` interfaces keep their names.

**Tools that need only the settings** call `get_sound` and take `.settings`. That costs extra latency, not money: views are free.

A provider is deployed, so unlike the class it can be read with `starknet_call` from any RPC client or explorer.

## The provider contract

A contract that implements `ISoundProvider` must honour all of these:

1. **Token IDs as minted.** `get_sound` takes the NFT's token ID exactly as the NFT minted it, the whole `u256`. Decode only the bits the provider uses and ignore the rest: a provider that rejects unused bits breaks when the NFT's ID layout grows, as Beasts' newer 180-bit token IDs do.
2. **A raw Standard MIDI File.** `midi` is the file's bytes, not base64 and not a data URI, and it passes the page's MIDI check, `check-midi` ([MIDI contract](midi-contract.md), [Checking MIDI files](midi-contract.md#checking-midi-files)). The class embeds the bytes without parsing them, so a bad file does not revert: the page shows an error instead of playing.
3. **Valid settings.** `settings` passes `settings::validate` ([`src/settings.cairo`](../src/settings.cairo)) in the class version the NFT calls; otherwise `midi_segment` reverts.
4. **Deterministic.** The same token and the same live state always give the same bytes, whoever calls. Derive the sound from the token and contract state, never from the caller or the transaction. When state changes a token's sound, the NFT emits an ERC-4906 metadata update so marketplaces refetch.
5. **View-only.** No storage writes, no events, no calls that change state.
6. **Reverts only for an unknown token.** Every token the NFT has minted gets a sound.

Recommended:

- **Keep the provider's other interfaces consistent with `get_sound`.** If the provider also exposes the MIDI or the settings through its own interfaces, they should equal `get_sound(id).midi` and `get_sound(id).settings`, for every token, at every state. One internal function that builds the `TokenSound` for all of them keeps that true by construction. Sharing it also matters because a per-token subset of the settings depends on the programs the token's MIDI uses: the settings have to be worked out from the same score the MIDI returns.
- **Return only what the token's MIDI uses:** the timbres of the programs and drum notes it plays, and the waves those timbres select. `SETTINGS` costs about 14.5M L2 gas per 1,000 bytes through `midi_segment` ([The size of `SETTINGS`](gas.md#the-size-of-settings)). A Beast's subset is about 0.9–1.4 KB, against about 3.9 KB for a full chip bank: about 13–20M L2 gas against about 57M, on every `token_uri` call.
- **Hold the preset bank as constants in the provider's code,** and pick each token's subset from them. Storage reads cost about 24K L2 gas per felt, and a `SynthSettings` stored field by field takes a felt per field.
- **Keep sample tables short.** Each sample is 2 to 6 bytes of `SETTINGS`. The 32,767-step reference LFSR (147,532 bytes) adds about 2.1B L2 gas to `midi_segment`, more than many RPC nodes serve ([Node limits](gas.md#node-limits)), and the provider pays again to hold or build it (277.9M to build it in a Cairo loop). `WhiteNoise` and `MetallicNoise` need no table.
- **Keep the provider's class at Sierra 1.7 or later,** like every class in the `token_uri` call chain ([Node limits](gas.md#node-limits)).

## Calling a provider

The crate has no helper for the call: copy this one into your NFT or renderer. It returns `None` when the token should play without sound, whatever the provider does.

```cairo
use core::num::traits::Zero;
use onchain_midi_player::types::TokenSound;
use starknet::ContractAddress;
use starknet::syscalls::call_contract_syscall;

/// The largest reply, in felts, that this renderer will decode: set it from your own gas budget.
const MAX_REPLY_FELTS: u32 = 4_000;

/// `provider.get_sound(token_id)`, or `None` when the token should play without sound.
fn fetch_sound(provider: ContractAddress, token_id: u256) -> Option<TokenSound> {
    if provider.is_zero() {
        return Option::None; // no provider set: sound is off, and no call is made
    }
    let mut calldata = array![];
    token_id.serialize(ref calldata);
    let mut reply = call_contract_syscall(provider, selector!("get_sound"), calldata.span()).ok()?;
    if reply.len() > MAX_REPLY_FELTS {
        return Option::None; // larger than this renderer decodes
    }
    let sound: TokenSound = Serde::deserialize(ref reply)?; // `None` if truncated or malformed
    if !reply.is_empty() {
        return Option::None; // it starts like a `TokenSound` but carries more
    }
    Option::Some(sound)
}
```

Set `MAX_REPLY_FELTS` from your own gas budget, taking your largest real token's reply with some headroom (the golden `beast_140bpm` fixture's reply is 106 felts). The check reads only the reply's length and runs before the decoding, which is where the gas goes.

- **Why a raw syscall and `Serde::deserialize`, not the generated "safe" dispatcher.** `call_contract_syscall` returns a provider's panic, or a missing `get_sound` entry point, as an `Err` instead of reverting the caller (since Starknet 0.13.4). The safe dispatcher decodes the reply itself, and a malformed reply makes it panic in the caller's frame. Decoding the reply yourself turns that into `None`.
- **What decoding rejects.** The derived `Serde` rejects a truncated reply, an integer out of its type's range, an unknown enum tag (a `WaveDef`, `Waveform` or `FilterKind` tag, or an `Option` tag), and a `ByteArray` with a full word wider than 31 bytes, a pending length over 30, or a pending word wider than its length. The last check, `reply.is_empty()`, rejects a reply that merely starts like a `TokenSound` and carries more felts.
- **What cannot be caught.** Two failures revert the whole call, uncatchably: calling an undeployed address, and running out of gas. Call `get_sound` once in the setter that changes the provider, so an undeployed address reverts the setter rather than every `token_uri`, and keep a kill switch: the zero address, as in the snippet, turns sound off without a call.
- **Settings are not validated by the snippet.** `midi_segment` validates them anyway; the class version the NFT calls is the authority on what is valid, and this crate's `settings::validate` may be another version's; and `validate` reverts rather than returning a result. To fall back on invalid settings too, test the provider's output against the class in CI, or call `midi_segment` through `library_call_syscall` and treat an error as no sound.

The generated `ISoundProviderDispatcher` suits callers that should revert when the provider fails.

**The call path.** Have the NFT's renderer call the provider itself: the NFT `call_contract`s its renderer, the renderer calls `get_sound` and library-calls the class with the result. An NFT that fetches the sound and passes it on to its renderer moves the MIDI and settings through one more calldata hop.

**Tests.** [`tests/test_provider.cairo`](../tests/test_provider.cairo) holds a mock provider that implements only `get_sound`. It checks the sound, passed to `midi_segment` through the class, against a golden fixture byte for byte, for a 180-bit token ID, and a Serde round trip of a `TokenSound` with custom waves and filters. The same file holds a copy of the snippet above, so CI type-checks it, and runs it against a zero address, a panicking provider, a provider without `get_sound`, truncated, trailing and malformed replies, and a reply one felt over the cap. The copy is a test helper, not part of the crate: keep it identical to the snippet when you change either. snforge 0.64.0 cannot test the failure paths of a safe *library* call (catching its panic replaces the caller's class hash for the rest of the test), so test them, as these tests do, with `call_contract` into mock contracts.
