#!/usr/bin/env node
// Reproduce payload and release-class sizes. Gas comes from the named snforge tests in docs/gas.md.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { VERSION } from "./segments.mjs";
import { build } from "./build_segments.mjs";
import { tokenUriSpliced } from "../examples/beast_consumer/scripts/reference.mjs";
function classSize(directory) {
  const base = resolve(directory,"target/release/onchain_midi_player_TinySynth");
  const sierra = readFileSync(base+".contract_class.json"), casm = readFileSync(base+".compiled_contract_class.json");
  const s = JSON.parse(sierra), c = JSON.parse(casm);
  return { sierra_file_bytes: sierra.length, sierra_compact_json_bytes: Buffer.byteLength(JSON.stringify(s)), sierra_felts: s.sierra_program.length,
    casm_file_bytes: casm.length, casm_compact_json_bytes: Buffer.byteLength(JSON.stringify(c)), casm_bytecode_felts: c.bytecode.length };
}
const fixed279 = await build(279), fixed9 = await build(9);
const result = { version: VERSION, input:{svg_bytes:22733,midi_bytes:3716,settings_bytes:334}, full_token_uri_chars:tokenUriSpliced(4).length,
  fixed279: fixed279.record.artifacts, fixed9:fixed9.record.artifacts, current_class:classSize(new URL("..",import.meta.url).pathname) };
if(process.argv[2])result.baseline_class=classSize(process.argv[2]);
console.log(JSON.stringify(result,null,2));
