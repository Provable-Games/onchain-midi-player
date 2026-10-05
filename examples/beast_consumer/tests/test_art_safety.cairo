//! The art rule (docs/token-uri-layout.md, "Art (SVG) requirements"): the SVG must never contain
//! `</script`, in any letter case. In the animation_url page the SVG is the raw text of the last
//! block, `<script type="text/plain" id="art">`, which the HTML parser ends at the first
//! `</script`. The class never sees the SVG, so the consumer checks its own renderer, here in its
//! tests rather than onchain. scripts/art_safety.test.mjs has the same check in JavaScript
//! (`assertArtSafe`) and shows the failure.

use beast_consumer::beast_like_nft::{beast_image, render_svg, token_data, token_svg};
use crate::golden;

/// Whether `svg` contains `</script` in any letter case (ASCII).
pub fn contains_script_end_tag(svg: @ByteArray) -> bool {
    let tag: ByteArray = "</script";
    let (n, m) = (svg.len(), tag.len());
    let mut i = 0;
    while i + m <= n {
        let mut j = 0;
        while j != m && ascii_lower(svg[i + j]) == tag[j] {
            j += 1;
        }
        if j == m {
            return true;
        }
        i += 1;
    }
    false
}

fn ascii_lower(b: u8) -> u8 {
    if b >= 'A' && b <= 'Z' {
        b + 32
    } else {
        b
    }
}

#[test]
fn rendered_svgs_never_contain_script_end_tag() {
    for id in golden::TOKEN_IDS.span() {
        let (name, tier) = token_data(*id);
        let svg = render_svg(@name, tier, @beast_image());
        assert(!contains_script_end_tag(@svg), 'svg contains </script');
    }
}

// Token 4's art is a real Beast SVG, as the Beasts renderer produced it.
#[test]
fn real_beast_svg_never_contains_script_end_tag() {
    let (name, tier) = token_data(4);
    assert(!contains_script_end_tag(@token_svg(4, @name, tier)), 'svg contains </script');
}

#[test]
fn script_end_tag_is_found_in_any_letter_case() {
    assert(contains_script_end_tag(@"<svg><script>x</script></svg>"), 'element');
    assert(contains_script_end_tag(@"<!-- </SCRIPT> -->"), 'upper case');
    assert(contains_script_end_tag(@"<desc><![CDATA[</ScRiPt"), 'mixed case, at the end');
    assert(contains_script_end_tag(@"</script"), 'whole input');
}

#[test]
fn text_that_only_resembles_it_is_allowed() {
    assert(!contains_script_end_tag(@""), 'empty');
    assert(!contains_script_end_tag(@"<svg><script"), 'start tag');
    assert(!contains_script_end_tag(@"</scrip"), 'prefix');
    assert(!contains_script_end_tag(@"<text>&lt;/script&gt;</text>"), 'escaped');
}
