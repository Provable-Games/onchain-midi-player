// @ts-check
import { readFileSync,writeFileSync } from "node:fs";
import { formatCairo } from "./cairo_format.mjs";
import { isDeepStrictEqual } from "node:util";
import { checkMidi } from "../player/player.js";
import { SettingsError } from "../player/settings.js";
import { serde } from "./gen_settings_fixtures.mjs";
import { CASES,INVALID_CASES,INVALID_MIDI } from "./data_cases.mjs";
import { b64,byteArrayFelts,constFeltArray,cairoByteArrayConst, dFragment,midiSegment,settingsText,sha256,VERSION } from "./segments.mjs";
import { consumerPieces,naiveTokenUri } from "./composition.mjs";
import { classFixturesCairo } from "./gen_class_fixtures.mjs";
function deserializeFn(name,type,felts) { return `pub fn ${name}() -> ${type} {\n    let mut felts = ${name.toUpperCase()}.span();\n    Serde::deserialize(ref felts).unwrap()\n}\n${constFeltArray(name.toUpperCase(),felts)}\n`; }
const valid=CASES.map(c=> {
  let midi;
  for(let n=0;n<27;n++) { midi=c.midi(`fixture ${c.name}${".".repeat(n)}`); if(dFragment(midi,c.settings).pad===c.dPad) break; }
  const {d,pad}=dFragment(midi,c.settings), p=consumerPieces(c.members,c.svg,{d,fixture:true});
  if(p.uri!==naiveTokenUri({mem:c.members,svg:c.svg,d},{fixture:true})) throw new Error("splicing differs from nesting");
  const score=checkMidi(midi);
  return {name:c.name,settings:c.settings,settings_text:settingsText(c.settings),midi_b64:b64(midi),midi_max_tick:score.maxTick,midi_loop_seconds:score.seconds,
    svg:c.svg,members:c.members,d_pad:pad,d,midi_segment:midiSegment(midi,c.settings),animation_html:{len:Buffer.byteLength(p.html),sha256:sha256(p.html)},token_uri:{len:p.uri.length,sha256:sha256(p.uri)}};
});
if(new Set(valid.map(c=>c.d_pad)).size!==9) throw new Error("all 9 data padding residues must occur");
const invalid=INVALID_CASES.map(c=> { let error;try {midiSegment(INVALID_MIDI,c.settings);}catch(e){if(!(e instanceof SettingsError))throw e;error=[e.code,...e.indices];}if(!isDeepStrictEqual(error,c.error))throw new Error("revert drift");return {...c,midi_b64:b64(INVALID_MIDI)};});
let cairo=`//! Generated independent JS data and composition goldens.\nuse onchain_midi_player::types::TinySynthSettings;\nuse onchain_midi_player::interface::{ITinySynthDispatcherTrait, ITinySynthSafeDispatcherTrait};\nuse onchain_midi_player::{segment, settings};\nuse crate::helpers::{class, safe_class, composed_token_uri, sha256};\n`;
for(const c of valid){const n=`case_${c.name}`;
 cairo+=deserializeFn(`${n}_midi`,"ByteArray",byteArrayFelts(Buffer.from(c.midi_b64,"base64")))+deserializeFn(`${n}_settings`,"TinySynthSettings",serde(c.settings))+deserializeFn(`${n}_svg`,"ByteArray",byteArrayFelts(c.svg))+deserializeFn(`${n}_members`,"ByteArray",byteArrayFelts(c.members))+deserializeFn(`${n}_midi_segment`,"ByteArray",byteArrayFelts(c.midi_segment));
 cairo+=`#[test]\nfn ${n}_data_parity() {\n    let s = ${n}_settings();\n    assert_eq!(settings::validate_and_encode(@s), "${c.settings_text}");\n    assert_eq!(segment::midi_segment(${n}_midi(), @s), ${n}_midi_segment());\n    assert_eq!(class().midi_segment(${n}_midi(), ${n}_settings()), ${n}_midi_segment());\n}\n#[test]\nfn ${n}_independent_provider_composition() {\n    let uri = composed_token_uri(${n}_members(), ${n}_svg(), ${n}_midi(), ${n}_settings());\n    assert_eq!(uri.len(), ${c.token_uri.len});\n    assert_eq!(sha256(@uri), 0x${c.token_uri.sha256});\n}\n`;
}
for(const c of invalid){const n=`invalid_${c.name}`;cairo+=deserializeFn(`${n}_settings`,"TinySynthSettings",serde(c.settings));const [msg,...idx]=c.error;
 cairo+=`#[test]\n#[feature("safe_dispatcher")]\nfn ${n}_reverts() {\n    let result = safe_class().midi_segment("", ${n}_settings());\n    let expected = array!['${msg}', ${idx.map(String).concat("'ENTRYPOINT_FAILED'").join(", ")}];\n    assert_eq!(result.unwrap_err(), expected);\n}\n`;
}
// Independent Node base64 vectors over every length across three full 31-byte words and all data pads.
const dynamic=Array.from({length:101},(_,n)=>midiSegment(Buffer.alloc(n,0x90),CASES[0].settings));
cairo+=deserializeFn("data_length_vectors","Array<ByteArray>", ["101",...dynamic.flatMap(byteArrayFelts)]);
cairo+=`#[test]\nfn data_parity_all_lengths_and_word_residues() {\n    let expected = data_length_vectors();\n    let mut midi: ByteArray = "";\n    let mut n = 0;\n    while n != 101 {\n        assert_eq!(segment::midi_segment(midi.clone(), @case_${CASES[0].name}_settings()), expected[n].clone());\n        midi.append_byte(0x90); n += 1;\n    }\n}\n`;
const files=new Map([["tests/fixtures/data.json",JSON.stringify({version:VERSION,valid,invalid},null,1)+"\n"],["tests/data_fixtures.cairo",cairo],["tests/class_fixtures.cairo",classFixturesCairo()]]);
const check=process.argv.includes("--check");for(const [path,raw] of files){const value=path.endsWith(".cairo")?formatCairo(raw):raw;const u=new URL(`../${path}`,import.meta.url);if(check){if(readFileSync(u,"utf8")!==value){console.error(`stale ${path}`);process.exitCode=1;}}else writeFileSync(u,value);}
