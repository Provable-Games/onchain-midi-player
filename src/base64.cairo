//! Standard RFC 4648 base64 encoder (planned).
//!
//! Will hold the felt-wise encoder used for per-token data (MIDI, art, metadata) and
//! exposed through `IOnchainTinySynth::base64`. Output is standard base64 with `=`
//! padding and no line breaks, byte-for-byte equal to the offline reference encoder.
//! Large fixed data (engine, page) is never encoded here; it is stored pre-encoded in
//! `page_data`.
