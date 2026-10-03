//! Standard RFC 4648 base64 (alphabet `A-Z a-z 0-9 + /`, `=` padding, no line breaks): the one
//! encoder of this crate. `midi_segment` and the `base64` entry point both call
//! `bytes_base64_encode`, and nothing else in the class encodes base64. Large fixed data (engine,
//! page) is never encoded here; it is stored pre-encoded in `page_data`.
//!
//! The encoder is `bytes_base64_encode(_bytes: ByteArray) -> ByteArray` of
//! `game_components_encoding`, the maintainer's optimized word-wise encoder: the zero-dependency
//! package `packages/encoding` of Provable-Games/game-components, pinned in `Scarb.toml` (commit
//! 652b349baa0059f1c51a060676068bf6180fd895; SHA-256 of its `src/encoding.cairo`
//! ef6d2fc50e1b5d1d81cd81091d3c34402ad41ebcd670d03e38a2a82b74c13883). It encodes 93-byte blocks
//! into four 31-byte words, and uses the unstable corelib features `bounded-int-utils`,
//! `byte-span` and `corelib-get-trait`. It is MIT licensed: its notice is in NOTICE and in
//! `license()`.
//!
//! This module re-exports it, so the crate keeps one path for its encoder. The tests in
//! `tests/test_base64.cairo` and every golden fixture check its output.

pub use game_components_encoding::bytes_base64_encode;
