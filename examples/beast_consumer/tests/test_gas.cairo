//! End-to-end like-for-like direct-splicing versus runtime full-page encoding.
use beast_consumer::beast_like_nft::IBeastLikeNftDispatcherTrait;
use crate::naive::naive_token_uri;
use crate::test_token_uri::setup;
#[test]
fn gas_t4_direct_splicing() {
    let (nft, _) = setup();
    assert!(nft.token_uri(4).len() > 0);
}
#[test]
fn gas_t4_runtime_full_page() {
    assert!(naive_token_uri(4).len() > 0);
}
#[test]
fn gas_t4_setup() {
    let (nft, class_hash) = setup();
    assert(nft.tinysynth_class_hash() == class_hash, 'class hash');
}
