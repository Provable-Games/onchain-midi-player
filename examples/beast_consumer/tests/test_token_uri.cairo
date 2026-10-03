//! End-to-end: the mock class is declared but never deployed, BeastLikeNft is deployed with its
//! class hash, and token_uri (built with library calls) is checked byte for byte against
//! (a) the independent JavaScript reference (golden.cairo) and (b) the in-Cairo naive reference.

use beast_consumer::beast_like_nft::{
    IBeastLikeNftDispatcher, IBeastLikeNftDispatcherTrait, beast_image, render_svg, token_data,
};
use onchain_tinysynth::interface::{
    IOnchainTinySynthDispatcherTrait, IOnchainTinySynthLibraryDispatcher,
};
use onchain_tinysynth::page_data;
use snforge_std::{ContractClassTrait, DeclareResultTrait, declare};
use starknet::ClassHash;
use crate::golden;
use crate::naive::naive_token_uri;

/// Declares the mock (no deploy) and deploys the NFT with its class hash.
fn setup() -> (IBeastLikeNftDispatcher, ClassHash) {
    let mock_class_hash = *declare("MockOnchainTinySynth").unwrap().contract_class().class_hash;
    let nft_class = declare("BeastLikeNft").unwrap().contract_class();
    let (address, _) = nft_class.deploy(@array![mock_class_hash.into()]).unwrap();
    (IBeastLikeNftDispatcher { contract_address: address }, mock_class_hash)
}

fn assert_same(actual: @ByteArray, expected: @ByteArray, what: ByteArray) {
    if actual != expected {
        println!(
            "{} mismatch: got {} bytes, expected {} bytes", what, actual.len(), expected.len(),
        );
        let n = core::cmp::min(actual.len(), expected.len());
        let mut i = 0;
        while i != n && actual[i] == expected[i] {
            i += 1;
        }
        println!("first difference at byte {}", i);
        panic!("{}", what);
    }
}

// One test per token, each with a single token_uri call, so `snforge test --gas-report` shows the
// cost of token_uri per token.

#[test]
fn token_uri_1_matches_js_golden() {
    let (nft, _) = setup();
    assert_same(@nft.token_uri(1), @golden::token_uri_1(), "token 1 != golden");
}

#[test]
fn token_uri_2_matches_js_golden() {
    let (nft, _) = setup();
    assert_same(@nft.token_uri(2), @golden::token_uri_2(), "token 2 != golden");
}

#[test]
fn token_uri_3_matches_js_golden() {
    let (nft, _) = setup();
    assert_same(@nft.token_uri(3), @golden::token_uri_3(), "token 3 != golden");
}

/// Splicing equals standard nesting: the contract's token_uri equals the naive one-pass encoding
/// of the plainly built JSON. One test per token (each has different pad lengths); a single test
/// over all three exceeds snforge's default step limit with the naive byte-wise encoder.
fn assert_equals_naive(token_id: u256) {
    let (nft, _) = setup();
    assert_same(@nft.token_uri(token_id), @naive_token_uri(token_id), "spliced != naive");
}

#[test]
fn token_uri_1_equals_naive_nesting() {
    assert_equals_naive(1);
}

#[test]
fn token_uri_2_equals_naive_nesting() {
    assert_equals_naive(2);
}

#[test]
fn token_uri_3_equals_naive_nesting() {
    assert_equals_naive(3);
}

#[test]
fn render_svg_matches_js_golden() {
    let goldens = array![golden::svg_1(), golden::svg_2(), golden::svg_3()];
    let mut i: usize = 0;
    for id in golden::TOKEN_IDS.span() {
        let (name, tier) = token_data(*id);
        assert_same(@render_svg(@name, tier, @beast_image()), goldens[i], "svg != golden");
        i += 1;
    }
}

/// The class hash is all the NFT stores; the mock exists only as a declared class, and the
/// library dispatcher reaches it without any deployed TinySynth contract.
#[test]
fn library_call_without_deployment() {
    let (nft, mock_class_hash) = setup();
    assert(nft.tinysynth_class_hash() == mock_class_hash, 'class hash not stored');

    let synth = IOnchainTinySynthLibraryDispatcher { class_hash: mock_class_hash };
    let segment = synth.animation_url_segment();
    assert(segment.len() == page_data::SEGMENT_LEN, 'segment length');
    assert(segment == page_data::animation_url_segment(), 'segment content');
    // The pre-encoded piece splices mid-stream: no '=' padding (which could only end it).
    assert(segment[segment.len() - 1] != '=', 'segment is padded');
    assert(synth.base64("}") == "fQ==", 'base64 padding');
    assert(synth.base64("Man") == "TWFu", 'base64');
    assert(synth.base64("") == "", 'base64 empty');
    assert(synth.script_sha256() == page_data::ENGINE_SHA256, 'script_sha256');
    assert(synth.version() == page_data::VERSION, 'version');
    assert(synth.license() == page_data::license(), 'license');
}

/// Prints the contract's token_uri for the sample token, to decode the actual Cairo output:
/// `snforge test print_sample_token_uri --include-ignored | grep '^data:application/json'`
/// `  > uri.txt && node scripts/decode.mjs uri.txt out/`
#[test]
#[ignore]
fn print_sample_token_uri() {
    let (nft, _) = setup();
    println!("{}", nft.token_uri(1));
}
