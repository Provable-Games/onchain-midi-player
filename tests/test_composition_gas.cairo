//! End-to-end fixture composition and representation choices, measured using identical inputs.
use onchain_midi_player::base64::bytes_base64_encode;
use onchain_midi_player::interface::ITinySynthLibraryDispatcher;
use onchain_midi_player::segment::{d_fragment, midi_segment};
use snforge_std::{DeclareResultTrait, declare};
use crate::class_fixtures::beast_midi_heaviest;
use crate::data_fixtures::{
    case_beast_140bpm_members, case_beast_140bpm_midi, case_beast_140bpm_settings,
    case_beast_140bpm_svg,
};
use crate::fixture_provider::{IFixtureProviderDispatcherTrait, IFixtureProviderLibraryDispatcher};
use crate::helpers::{class, sha256};
use crate::raw_assets;

fn fixture() -> ByteArray {
    IFixtureProviderLibraryDispatcher {
        class_hash: declare("FixtureProvider").unwrap().contract_class().class_hash,
    }
        .library_segment()
}
fn raw_append(ref html: ByteArray, ref length: u32, raw: @ByteArray) {
    html.append(raw);
    length += raw.len() * 16 / 9;
}
fn raw_align(ref html: ByteArray, ref length: u32) {
    while length % 31 != 0 {
        html.append(@"         ");
        length += 16;
    }
}
fn full_page() -> ByteArray {
    let mut image_value = bytes_base64_encode(case_beast_140bpm_svg());
    image_value.append_byte('"');
    while image_value.len() % 3 != 0 {
        image_value.append_byte(' ');
    }
    let key: ByteArray = "\"image\":\"data:image/svg+xml;base64,";
    let mut open: ByteArray = "{";
    open.append(@case_beast_140bpm_members());
    open.append_byte(',');
    while (open.len() + key.len()) % 3 != 0 {
        open.append_byte(' ');
    }
    while (29 + (open.len() + key.len()) / 3 * 4) % 31 != 0 {
        open.append(@"   ");
    }
    open.append(@key);
    open.append(@image_value);
    open.append(@",  \"animation_url\":\"data:text/html;base64,");
    let mut length = 29 + open.len() / 3 * 4;
    let mut html: ByteArray = "";
    raw_append(ref html, ref length, @raw_assets::head());
    raw_align(ref html, ref length);
    raw_append(ref html, ref length, @raw_assets::gunzip());
    raw_align(ref html, ref length);
    raw_append(ref html, ref length, @raw_assets::engine());
    raw_align(ref html, ref length);
    raw_append(ref html, ref length, @raw_assets::fixture());
    raw_align(ref html, ref length);
    raw_append(ref html, ref length, @raw_assets::player());
    raw_append(ref html, ref length, @raw_assets::body());
    let mut art: ByteArray =
        "<img id=\"beast-art\" alt=\"\"                                    src=\"data:image/svg+xml;base64,";
    art.append(@image_value);
    art.append(@">");
    while art.len() % 9 != 0 {
        art.append_byte(' ');
    }
    raw_append(ref html, ref length, @art);
    raw_append(
        ref html, ref length, @d_fragment(case_beast_140bpm_midi(), @case_beast_140bpm_settings()),
    );
    raw_align(ref html, ref length);
    raw_append(ref html, ref length, @raw_assets::footer());
    open.append(@bytes_base64_encode(html));
    open.append(@"\"}");
    let mut uri: ByteArray = "data:application/json;base64,";
    uri.append(@bytes_base64_encode(open));
    uri
}
#[test]
fn gas_composition_279_midi_only() {
    let uri = crate::assembly::token_uri(
        class(),
        case_beast_140bpm_members(),
        case_beast_140bpm_svg(),
        case_beast_140bpm_midi(),
        case_beast_140bpm_settings(),
        "",
    );
    assert!(uri.len() > 0);
}
#[test]
fn gas_composition_279_fixture() {
    let uri = crate::assembly::token_uri(
        class(),
        case_beast_140bpm_members(),
        case_beast_140bpm_svg(),
        case_beast_140bpm_midi(),
        case_beast_140bpm_settings(),
        fixture(),
    );
    assert!(uri.len() > 0);
}
#[test]
fn gas_composition_9_midi_only() {
    let hash = declare("MinimumAlignedTinySynth").unwrap().contract_class().class_hash;
    let uri = crate::assembly::token_uri(
        ITinySynthLibraryDispatcher { class_hash: hash },
        case_beast_140bpm_members(),
        case_beast_140bpm_svg(),
        case_beast_140bpm_midi(),
        case_beast_140bpm_settings(),
        "",
    );
    assert!(uri.len() > 0);
}
#[test]
fn gas_composition_9_fixture() {
    let hash = declare("MinimumAlignedTinySynth").unwrap().contract_class().class_hash;
    let uri = crate::assembly::token_uri(
        ITinySynthLibraryDispatcher { class_hash: hash },
        case_beast_140bpm_members(),
        case_beast_140bpm_svg(),
        case_beast_140bpm_midi(),
        case_beast_140bpm_settings(),
        crate::minimum_alignment::minimum_fixture(),
    );
    assert!(uri.len() > 0);
}
#[test]
fn gas_composition_279_data_first() {
    let uri = crate::data_first_assembly::token_uri(
        class(),
        case_beast_140bpm_members(),
        case_beast_140bpm_svg(),
        case_beast_140bpm_midi(),
        case_beast_140bpm_settings(),
        fixture(),
    );
    assert!(uri.len() > 0);
}
#[test]
fn gas_composition_runtime_full_page() {
    assert!(full_page().len() > 0);
}
#[test]
fn runtime_encoder_and_direct_splicing_are_byte_identical() {
    let direct = crate::assembly::token_uri(
        class(),
        case_beast_140bpm_members(),
        case_beast_140bpm_svg(),
        case_beast_140bpm_midi(),
        case_beast_140bpm_settings(),
        fixture(),
    );
    assert_eq!(sha256(@full_page()), sha256(@direct));
}
#[test]
fn gas_dynamic_data_9() {
    assert!(
        midi_segment(beast_midi_heaviest(), @onchain_midi_player::settings::default_settings())
            .len() > 0,
    );
}
#[test]
fn gas_dynamic_data_279() {
    let mut d = d_fragment(
        beast_midi_heaviest(), @onchain_midi_player::settings::default_settings(),
    );
    while d.len() % 279 != 0 {
        d.append_byte(' ');
    }
    assert!(bytes_base64_encode(bytes_base64_encode(d)).len() > 0);
}

fn full_token(synth: ITinySynthLibraryDispatcher, extra: ByteArray, art_first: bool) -> ByteArray {
    if art_first {
        crate::assembly::token_uri(
            synth,
            raw_assets::warlock_members(),
            raw_assets::warlock_svg(),
            beast_midi_heaviest(),
            crate::settings_fixtures::valid_beast_reference(),
            extra,
        )
    } else {
        crate::data_first_assembly::token_uri(
            synth,
            raw_assets::warlock_members(),
            raw_assets::warlock_svg(),
            beast_midi_heaviest(),
            crate::settings_fixtures::valid_beast_reference(),
            extra,
        )
    }
}
#[test]
fn gas_full_base_279() {
    assert!(full_token(class(), "", true).len() > 0);
}
#[test]
fn gas_full_base_9() {
    let hash = declare("MinimumAlignedTinySynth").unwrap().contract_class().class_hash;
    assert!(full_token(ITinySynthLibraryDispatcher { class_hash: hash }, "", true).len() > 0);
}
#[test]
fn gas_full_fixture_art_first() {
    assert!(full_token(class(), fixture(), true).len() > 0);
}
#[test]
fn gas_full_fixture_data_first() {
    assert!(full_token(class(), fixture(), false).len() > 0);
}
