//! Gas of each token's `token_uri`, one call per test (calibration: README.md). The tests are
//! ignored because the large tokens take about a minute each. Run them all with
//!
//!     snforge test gas_token --ignored --gas-report
//!
//! and read the `token_uri` row of each test's StressNft table (Sierra gas of the call, with its
//! library calls).

use stress_nft::stress_nft::IStressNftDispatcherTrait;
use crate::helpers::setup;

#[test]
#[ignore]
fn gas_token_01() {
    let (nft, _) = setup();
    assert(nft.token_uri(1).len() != 0, 'token_uri');
}

#[test]
#[ignore]
fn gas_token_02() {
    let (nft, _) = setup();
    assert(nft.token_uri(2).len() != 0, 'token_uri');
}

#[test]
#[ignore]
fn gas_token_03() {
    let (nft, _) = setup();
    assert(nft.token_uri(3).len() != 0, 'token_uri');
}

#[test]
#[ignore]
fn gas_token_04() {
    let (nft, _) = setup();
    assert(nft.token_uri(4).len() != 0, 'token_uri');
}

#[test]
#[ignore]
fn gas_token_05() {
    let (nft, _) = setup();
    assert(nft.token_uri(5).len() != 0, 'token_uri');
}

#[test]
#[ignore]
fn gas_token_06() {
    let (nft, _) = setup();
    assert(nft.token_uri(6).len() != 0, 'token_uri');
}

#[test]
#[ignore]
fn gas_token_07() {
    let (nft, _) = setup();
    assert(nft.token_uri(7).len() != 0, 'token_uri');
}

#[test]
#[ignore]
fn gas_token_08() {
    let (nft, _) = setup();
    assert(nft.token_uri(8).len() != 0, 'token_uri');
}

#[test]
#[ignore]
fn gas_token_09() {
    let (nft, _) = setup();
    assert(nft.token_uri(9).len() != 0, 'token_uri');
}

#[test]
#[ignore]
fn gas_token_10() {
    let (nft, _) = setup();
    assert(nft.token_uri(10).len() != 0, 'token_uri');
}

#[test]
#[ignore]
fn gas_token_11() {
    let (nft, _) = setup();
    assert(nft.token_uri(11).len() != 0, 'token_uri');
}

#[test]
#[ignore]
fn gas_token_12() {
    let (nft, _) = setup();
    assert(nft.token_uri(12).len() != 0, 'token_uri');
}

#[test]
#[ignore]
fn gas_token_13() {
    let (nft, _) = setup();
    assert(nft.token_uri(13).len() != 0, 'token_uri');
}

#[test]
#[ignore]
fn gas_token_14() {
    let (nft, _) = setup();
    assert(nft.token_uri(14).len() != 0, 'token_uri');
}

#[test]
#[ignore]
fn gas_token_15() {
    let (nft, _) = setup();
    assert(nft.token_uri(15).len() != 0, 'token_uri');
}

#[test]
#[ignore]
fn gas_token_16() {
    let (nft, _) = setup();
    assert(nft.token_uri(16).len() != 0, 'token_uri');
}

#[test]
#[ignore]
fn gas_token_17() {
    let (nft, _) = setup();
    assert(nft.token_uri(17).len() != 0, 'token_uri');
}

#[test]
#[ignore]
fn gas_token_18() {
    let (nft, _) = setup();
    assert(nft.token_uri(18).len() != 0, 'token_uri');
}

#[test]
#[ignore]
fn gas_token_19() {
    let (nft, _) = setup();
    assert(nft.token_uri(19).len() != 0, 'token_uri');
}

#[test]
#[ignore]
fn gas_token_20() {
    let (nft, _) = setup();
    assert(nft.token_uri(20).len() != 0, 'token_uri');
}
