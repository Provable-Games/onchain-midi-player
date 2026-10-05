//! Every entry point through `IOnchainTinySynthLibraryDispatcher`, with the class declared and
//! never deployed: the way a consumer reaches it. `midi_segment` against every golden fixture, and
//! its reverts with their exact panic data, are in the generated `page_fixtures.cairo`.

use onchain_midi_player::interface::IOnchainTinySynthDispatcherTrait;
use onchain_midi_player::page_data;
use crate::helpers::class;
use crate::page_fixtures::{
    ENGINE_SHA256, LICENSE_LEN, LICENSE_SHA256, SEGMENT_SHA256, case_beast_140bpm_midi,
    case_beast_140bpm_midi_segment, case_beast_140bpm_settings, sha256,
};

#[test]
fn animation_url_segment_is_the_generated_constant() {
    let segment = class().animation_url_segment();
    assert_eq!(segment.len(), page_data::SEGMENT_LEN);
    assert(sha256(@segment) == SEGMENT_SHA256, 'segment sha256');
    // It splices mid-stream, so it never ends with '=' padding.
    assert(segment[segment.len() - 1] != '=', 'segment is padded');
}

#[test]
fn midi_segment_matches_the_fixture() {
    let got = class().midi_segment(case_beast_140bpm_midi(), case_beast_140bpm_settings());
    assert(got == case_beast_140bpm_midi_segment(), 'midi_segment != fixture');
}

#[test]
fn base64_is_rfc4648() {
    let synth = class();
    assert_eq!(synth.base64("Man"), "TWFu");
    assert_eq!(synth.base64("Ma"), "TWE=");
    assert_eq!(synth.base64("M"), "TQ==");
    assert_eq!(synth.base64(""), "");
}

#[test]
fn constants() {
    let synth = class();
    assert(synth.script_sha256() == ENGINE_SHA256, 'script_sha256');
    assert(synth.script_sha256() == page_data::ENGINE_SHA256, 'script_sha256 (page_data)');
    assert(synth.version() == 'tinysynth-fc04dbe+page.10', 'version');
    assert(synth.version() == page_data::VERSION, 'version (page_data)');
    let license = synth.license();
    assert_eq!(license.len(), LICENSE_LEN);
    assert(sha256(@license) == LICENSE_SHA256, 'license sha256');
}
