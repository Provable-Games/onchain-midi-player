//! Correctness of the crate's base64 encoder (`base64::bytes_base64_encode`, re-exported from the
//! `game_components_encoding` package; see `src/base64.cairo`). These tests guard whatever encoder
//! is in place: they passed unchanged when it replaced the byte-wise stand-in. Expected outputs
//! come from RFC 4648 and from Node's encoder (the JS reference, `tests/class_fixtures.cairo`).

use onchain_midi_player::base64::bytes_base64_encode;
use crate::class_fixtures::{all_bytes_b64, seq_b64_long, seq_b64_short, seq_bytes};
use crate::helpers::sha256;

/// RFC 4648, section 10.
#[test]
fn rfc4648_test_vectors() {
    assert_eq!(bytes_base64_encode(""), "");
    assert_eq!(bytes_base64_encode("f"), "Zg==");
    assert_eq!(bytes_base64_encode("fo"), "Zm8=");
    assert_eq!(bytes_base64_encode("foo"), "Zm9v");
    assert_eq!(bytes_base64_encode("foob"), "Zm9vYg==");
    assert_eq!(bytes_base64_encode("fooba"), "Zm9vYmE=");
    assert_eq!(bytes_base64_encode("foobar"), "Zm9vYmFy");
}

/// The whole alphabet, `+` and `/` included, and the bytes that are not ASCII.
#[test]
fn every_byte_value() {
    let mut all: ByteArray = "";
    let mut b: u32 = 0;
    while b != 256 {
        all.append_byte(b.try_into().unwrap());
        b += 1;
    }
    assert_eq!(bytes_base64_encode(all), all_bytes_b64());
}

/// Every length from 0 to 100 bytes: each remainder of `len % 3` (padding `=`, `==` and none),
/// and the 31-byte word boundaries 31, 62 and 93, with the lengths one either side.
#[test]
fn every_length_up_to_100() {
    let expected = seq_b64_short();
    let mut n: u32 = 0;
    while n != expected.len() {
        let got = bytes_base64_encode(seq_bytes(n));
        assert(got == expected[n].clone(), n.into());
        assert_eq!(got.len(), (n + 2) / 3 * 4);
        n += 1;
    }
}

/// Larger inputs, around 1, 4, 8 and 16 KB, against the length and SHA-256 of Node's output.
fn check_long(i: u32) {
    let (n, len, digest) = *seq_b64_long()[i];
    let got = bytes_base64_encode(seq_bytes(n));
    assert_eq!(got.len(), len);
    assert(sha256(@got) == digest, 'sha256');
}

#[test]
fn large_input_1023() {
    check_long(0);
}

#[test]
fn large_input_1024() {
    check_long(1);
}

#[test]
fn large_input_1025() {
    check_long(2);
}

#[test]
fn large_input_4096() {
    check_long(3);
}

#[test]
fn large_input_8191() {
    check_long(4);
}

#[test]
fn large_input_8192() {
    check_long(5);
}

#[test]
fn large_input_8193() {
    check_long(6);
}

#[test]
fn large_input_16384() {
    check_long(7);
}

#[test]
fn large_inputs_cover_the_fixture() {
    assert_eq!(seq_b64_long().len(), 8);
}
/// The largest input in the crate's tests: PAGE (24,714 bytes), then the 32,991-byte JSON-layer
/// string, encoded at call time must give the segment that was encoded offline, byte for byte.
