#!/usr/bin/env node
// Builds the reference token_uri for every example token, proves the spliced layout equals plain
// nested base64, and writes:
//
//   tests/golden.cairo           expected token_uri and SVG per sample token (the Cairo tests
//                                assert byte-for-byte equality with these), and the length and
//                                SHA-256 of token 4's token_uri (a real Beast, about 132 KB)
//   src/beast_data.cairo         token 4's art and music: the real Beast SVG and the largest real
//                                score, from the repository's tests/fixtures/beasts/
//   fixtures/token_uri.txt       sample token: the exact token_uri string
//   fixtures/token.json          sample token: decoded JSON, pretty-printed
//   fixtures/image.svg           sample token: `image` decoded
//   fixtures/animation.html      sample token: `animation_url` decoded (open it in a browser)
//
// The fixture files are produced by decoding the token_uri string itself (decodeTokenUri), the
// same way a marketplace would, not from the intermediate pieces.
//
// Usage: node scripts/gen_fixtures.mjs   (from examples/beast_consumer). Output is deterministic.

import { mkdirSync, writeFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ENGINE_SHA256, engineSource } from '../../../scripts/engine.mjs';
import { byteArrayFelts, constFeltArray } from '../../../scripts/page.mjs';
import { checkMidi } from '../../../player/player.js';
import {
  MIDI, TOKENS, animationHtml, blen, bytes, cairoByteArrayFn, decodeTokenUri, page, pageScripts, realBeast, sha256,
  tokenJsonCompact, tokenParts, tokenUriNaive, tokenUriSpliced, validateMidi,
} from './reference.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLE_TOKEN = 1;

function check(cond, msg) {
  if (!cond) throw new Error(`check failed: ${msg}`);
}

const midiInfo = validateMidi(MIDI);
console.log(`MIDI: ${MIDI.length} bytes, PPQ ${midiInfo.ppq}, End-of-Track at tick ${midiInfo.eotTick} (${midiInfo.bars} bar)`);
console.log('token  name              headPad  comma  sPad  dPad  token_uri chars');

const ids = Object.keys(TOKENS).map(Number);
const sampleIds = ids.filter((id) => !TOKENS[id].real);
const residues = { head: new Set(), s: new Set() };
const golden = [];
for (const id of ids) {
  const p = tokenParts(id);
  const spliced = tokenUriSpliced(id);
  const naive = tokenUriNaive(id);
  // 1. Splicing equals standard nesting, byte for byte.
  check(spliced === naive, `token ${id}: spliced != naive`);
  // 2. The decoded layers are exactly what the renderer and the page produce.
  const dec = decodeTokenUri(spliced);
  check(dec.svgBytes.equals(bytes(p.svg)), `token ${id}: image != render_svg`);
  check(dec.htmlBytes.equals(bytes(page() + p.d + p.svg)), `token ${id}: animation_url != PAGE ++ D ++ SVG`);
  check(dec.html === animationHtml(id), `token ${id}: animation html`);
  // 3. The alignment spaces are insignificant JSON whitespace.
  check(isDeepStrictEqual(dec.json, JSON.parse(tokenJsonCompact(id))), `token ${id}: JSON != compact JSON`);
  check(Object.keys(dec.json).join() === 'name,description,attributes,image,animation_url', 'key order');
  // 4. The consumer's word alignment: the first b64(S) and the segment start on a 31-byte word.
  const sAt = 'data:application/json;base64,'.length + (blen(p.head) / 3) * 4;
  const segmentAt = sAt + (blen(p.s) / 3) * 4 + (blen(p.comma) / 3) * 4;
  check(sAt % 31 === 0 && segmentAt % 31 === 0, `token ${id}: b64(S) and the segment word-aligned`);
  if (!p.real) {
    residues.head.add(blen('{' + p.mem + ',') % 3);
    residues.s.add((p.svgB64.length + 1) % 3);
  }
  console.log(`${String(id).padEnd(7)}${p.name.padEnd(18)}${String(p.headPad).padEnd(9)}${String(p.comma.length).padEnd(7)}${String(p.sPad).padEnd(6)}${String(p.dPad).padEnd(6)}${spliced.length}`);
  if (p.real) {
    // About 132 KB: pinned by length and SHA-256; the Cairo test hashes the contract's output.
    golden.push([
      `/// token_uri of token ${id} ("${p.name}", a real Beast: ${blen(p.svg)}-byte SVG, ${p.midi.length}-byte score, the`,
      `/// reference sounds) as (length, SHA-256). The JS reference checked it equals naive nesting.`,
      `pub fn token_uri_${id}_digest() -> (u32, u256) {`,
      `    (${spliced.length}, 0x${sha256(spliced)})`,
      '}',
    ].join('\n'));
    continue;
  }
  golden.push(
    cairoByteArrayFn(`token_uri_${id}`, spliced, [
      `Expected token_uri for token ${id} ("${p.name}"), ${spliced.length} chars.`,
      `sha256 = ${sha256(spliced)}`,
    ]),
    cairoByteArrayFn(`svg_${id}`, p.svg, [`Expected render_svg output for token ${id}, ${blen(p.svg)} bytes.`]),
  );
}
// The example tokens are chosen so every consumer pad length (0, 1, 2) occurs.
check(residues.head.size === 3 && residues.s.size === 3, 'tokens must cover all len % 3 residues');

const goldenSrc = `// Generated by scripts/gen_fixtures.mjs. DO NOT EDIT.
//
// Expected outputs computed by the independent JavaScript reference (scripts/reference.mjs), which
// checked for each token that the spliced token_uri equals the whole JSON base64-encoded once
// with standard nested data URIs.

/// The sample tokens, which hold complete goldens.
pub const TOKEN_IDS: [u256; ${sampleIds.length}] = [${sampleIds.join(', ')}];

${cairoByteArrayFn('page', page(), [
  `The raw PAGE (${blen(page())} bytes). The class only stores it pre-encoded; the naive`,
  'reference in tests/naive.cairo needs the plain bytes.',
])}

${golden.join('\n\n')}
`;
writeFileSync(join(root, 'tests', 'golden.cairo'), goldenSrc);

// Token 4's art and music, as const felt arrays deserialized into ByteArrays (the cheapest form of
// large constant data in a class).
const real = realBeast();
checkMidi(real.midi);
/** @param {string} fnName @param {string | Uint8Array} x @param {string[]} doc */
const constByteArray = (fnName, x, doc) => [
  ...doc.map((l) => `/// ${l}`),
  `pub fn ${fnName}() -> ByteArray {`,
  `    let mut felts = ${fnName.toUpperCase()}.span();`,
  '    Serde::deserialize(ref felts).unwrap()',
  '}',
  '',
  constFeltArray(fnName.toUpperCase(), byteArrayFelts(x)),
].join('\n');
const beastDataSrc = `// Generated by scripts/gen_fixtures.mjs. DO NOT EDIT.

//! Token 4's art and music: a real Beast, for the full-size token_uri. Copied byte for byte from
//! the repository's tests/fixtures/beasts/. Third-party data under its own terms, not Apache-2.0:
//! the SVG is Beasts artwork (c) 2025 Provable Games Inc., distributed by beasts-v3 under the
//! licenses copied to tests/fixtures/beasts/licenses/ (BUSL 1.1 for Beast Collectibles, and MIT);
//! the score's terms are open. Non-production test data only. See tests/fixtures/beasts/README.md.

${constByteArray('warlock_svg', real.svg, [
  `The Beasts renderer's SVG for a shiny, animated Warlock, ${blen(real.svg)} bytes`,
  `(beasts-v3 assets/examples/warlock_shiny_animated.svg, sha256 ${sha256(real.svg).slice(0, 16)}...).`,
  'It contains no `</script`, so it is safe as the page\'s final art block.',
])}

${constByteArray('heaviest_midi', real.midi, [
  `The largest real Beast score (\`heaviest\` in midi_fun_contract's fixtures), ${real.midi.length} bytes.`,
])}
`;
// scarb fmt rewraps lines longer than 100 characters: keep the output formatter-stable.
const longLine = beastDataSrc.split('\n').find((line) => line.length > 100);
if (longLine) throw new Error(`src/beast_data.cairo: line longer than 100 characters: ${longLine}`);
writeFileSync(join(root, 'src', 'beast_data.cairo'), beastDataSrc);

// Human-inspectable layers for the sample token, decoded from the token_uri string.
const uri = tokenUriSpliced(SAMPLE_TOKEN);
const dec = decodeTokenUri(uri);
// Verification story of the class: the page's text/javascript+gzip tag carries the gzip payload,
// which inflates to the pinned engine, byte for byte; its SHA-256 is what script_sha256() returns.
const { engine, engineGzip } = pageScripts(dec.html);
check(engine === engineSource() && sha256(engine) === ENGINE_SHA256, 'the page\'s gzip payload inflates to the pinned engine');
console.log(`gzip payload sha256 (GZIP_SHA256): ${sha256(engineGzip)}, ${engineGzip.length} bytes`);
console.log(`engine script sha256 (script_sha256): ${sha256(engine)}`);
const fx = join(root, 'fixtures');
mkdirSync(fx, { recursive: true });
writeFileSync(join(fx, 'token_uri.txt'), uri);
writeFileSync(join(fx, 'token.json'), JSON.stringify(dec.json, null, 2) + '\n');
writeFileSync(join(fx, 'image.svg'), dec.svgBytes);
writeFileSync(join(fx, 'animation.html'), dec.htmlBytes);
console.log(`wrote tests/golden.cairo, src/beast_data.cairo and fixtures/ (sample token ${SAMPLE_TOKEN}, token_uri sha256 ${sha256(uri)})`);
