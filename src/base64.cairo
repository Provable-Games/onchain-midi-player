//! Standard RFC 4648 base64 (alphabet `A-Z a-z 0-9 + /`, `=` padding, no line breaks): the one
//! encoder of this crate. `midi_segment` and the `base64` entry point both call
//! `bytes_base64_encode`, and nothing else in the class encodes base64. Large fixed data (engine,
//! page) is never encoded here; it is stored pre-encoded in `page_data`.
//!
//! # TEMPORARY STAND-IN: the class must not be declared with this encoder
//!
//! The final encoder is the maintainer's optimized word-wise encoder, to be published as the
//! zero-dependency package `game_components_encoding` (`packages/encoding` in
//! Provable-Games/game-components). It then becomes a pinned dependency and this file goes away.
//! The swap changes no call site: the crate calls only `bytes_base64_encode(_bytes: ByteArray) ->
//! ByteArray`, which is the final encoder's signature. The tests in `tests/test_base64.cairo` and
//! the golden fixtures must pass unchanged after the swap, which shows the output is unchanged. The
//! release gate (issue #12) must not pass while this stand-in is in place.
//!
//! # Provenance
//!
//! `get_base64_char_set`, `bytes_base64_encode` and `encode_bytes` below are copied verbatim from
//! Provable-Games/game-components, `packages/utilities/src/utils/encoding.cairo`, lines 3-77, at
//! commit 5e48f22682446e55dfe1b13ab718743c2849d08b (SHA-256 of those lines:
//! 03d3ce9a26c79fc259e50e85e4f431351c3b997a9ea1606e4d14917915aff4b5). That code is the same
//! byte-wise encoder as the Beasts NFT's. game-components is MIT licensed, Copyright (c) Provable
//! Games. The stand-in will not ship, so its notice is not added to `license()` or NOTICE.
//!
//! Edits: none. The file's other helpers (`BytesUsedTrait`, `felt252_to_byte_array`, ...) and its
//! `use core::num::traits::{Bounded, Zero};` line, which only they need, are not copied.

#[inline(always)]
fn get_base64_char_set() -> Span<u8> {
    let mut result = array![
        'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R',
        'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j',
        'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z', '0', '1',
        '2', '3', '4', '5', '6', '7', '8', '9', '+', '/',
    ];
    result.span()
}

pub fn bytes_base64_encode(_bytes: ByteArray) -> ByteArray {
    encode_bytes(_bytes, get_base64_char_set())
}


fn encode_bytes(mut bytes: ByteArray, base64_chars: Span<u8>) -> ByteArray {
    let mut result: ByteArray = "";
    if bytes.len() == 0 {
        return result;
    }
    let mut p: u8 = 0;
    let c = bytes.len() % 3;
    if c == 1 {
        p = 2;
        bytes.append_byte(0_u8);
        bytes.append_byte(0_u8);
    } else if c == 2 {
        p = 1;
        bytes.append_byte(0_u8);
    }

    let mut i = 0;
    let bytes_len = bytes.len();
    let last_iteration = bytes_len - 3;
    loop {
        if i == bytes_len {
            break;
        }
        let n: u32 = (bytes.at(i).unwrap()).into()
            * 65536 | (bytes.at(i + 1).unwrap()).into()
            * 256 | (bytes.at(i + 2).unwrap()).into();
        let e1 = (n / 262144) & 63;
        let e2 = (n / 4096) & 63;
        let e3 = (n / 64) & 63;
        let e4 = n & 63;

        if i == last_iteration {
            if p == 2 {
                result.append_byte(*base64_chars[e1]);
                result.append_byte(*base64_chars[e2]);
                result.append_byte('=');
                result.append_byte('=');
            } else if p == 1 {
                result.append_byte(*base64_chars[e1]);
                result.append_byte(*base64_chars[e2]);
                result.append_byte(*base64_chars[e3]);
                result.append_byte('=');
            } else {
                result.append_byte(*base64_chars[e1]);
                result.append_byte(*base64_chars[e2]);
                result.append_byte(*base64_chars[e3]);
                result.append_byte(*base64_chars[e4]);
            }
        } else {
            result.append_byte(*base64_chars[e1]);
            result.append_byte(*base64_chars[e2]);
            result.append_byte(*base64_chars[e3]);
            result.append_byte(*base64_chars[e4]);
        }

        i += 3;
    }
    result
}
