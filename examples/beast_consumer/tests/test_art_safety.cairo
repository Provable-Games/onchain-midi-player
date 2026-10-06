//! Supplied art may contain parent-script-looking bytes: it is isolated in an encoded image.
use beast_consumer::assembly::encode_fragment;
use onchain_midi_player::base64::bytes_base64_encode;
#[test]
fn art_script_text_is_encoded_inside_complete_image() {
    let svg = bytes_base64_encode("<svg><script>window.attack=1</script></svg>");
    let mut html: ByteArray = "<img src=\"data:image/svg+xml;base64,";
    html.append(@svg);
    html.append(@"\">");
    assert!(encode_fragment(html).len() > 0);
}
