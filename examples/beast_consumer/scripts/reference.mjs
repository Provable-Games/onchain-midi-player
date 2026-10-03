// Offline reference for the beast_consumer example. Node built-ins only.
//
// This module is a deliberately independent JavaScript re-implementation of everything the Cairo
// side of the example produces:
//
//   - MockOnchainTinySynth: animation_url_segment, D and midi_segment, from the repository's JS
//     reference (scripts/page.mjs): the real PAGE, built by scripts/build_page.mjs into
//     tests/fixtures/page.html, and SETTINGS from player/encode.js, which the root parity tests tie
//     to Cairo
//   - BeastLikeNft: token table, render_svg, JSON members, MIDI, SynthSettings, and the token_uri
//     it splices together (the Beasts layout, also from scripts/page.mjs)
//
// gen_fixtures.mjs builds every token's token_uri twice (naive one-pass nesting and the spliced
// layout), checks they are equal, and writes the golden file the Cairo tests compare against. If
// the Cairo and the JS ever drift, the golden test fails.

import {
  ART_OPEN, IMAGE_KEY, MIDI_OPEN, SETTINGS_OPEN, URL_KEY, b64, blen, bytes, consumerPieces, decodeTokenUri,
  dFragment, naiveTokenJson, naiveTokenUri, padLen, pageHtml, pageScripts, segmentFor, settingsText, sha256, spaces,
  spliceTokenUri, strictB64Decode, withGzipPayload,
} from '../../../scripts/page.mjs';

export {
  ART_OPEN, IMAGE_KEY, MIDI_OPEN, SETTINGS_OPEN, URL_KEY, b64, blen, bytes, consumerPieces, decodeTokenUri,
  dFragment, naiveTokenJson, naiveTokenUri, padLen, pageScripts, segmentFor, sha256, spaces, spliceTokenUri,
  strictB64Decode, withGzipPayload,
};

/** PAGE: the real page of this class version (tests/fixtures/page.html), 9-aligned. */
export const page = () => pageHtml();

/** animation_url_segment(): the segment for this class version's PAGE. */
export const animationUrlSegment = () => segmentFor(page());

/** SETTINGS, validated and encoded by the repository's JS reference. */
export const settingsAscii = settingsText;

/** midi_segment(midi, settings) = b64(b64(D)). */
export const midiSegment = (midi, settings) => b64(b64(dFragment(midi, settings).d));

// ---------------------------------------------------------------------------------------------
// BeastLikeNft data (mirrors src/beast_like_nft.cairo and src/sound.cairo)
// ---------------------------------------------------------------------------------------------

/** Token table. Names use the Beasts charset only: A-Z a-z 0-9 space ' - */
export const TOKENS = {
  1: { name: 'Warlock', tier: 1 },
  2: { name: "Night's Wyvern", tier: 2 },
  3: { name: 'Fen-Troll', tier: 3 },
};

export const DESCRIPTION =
  'A Beast-like example token. Its animation_url plays the onchain MIDI with the onchain TinySynth class (mocked here).';

export const PNG_DATA_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEElEQVR42mP4z8AARwzEcQCukw/xOF6MEQAAAABJRU5ErkJggg==';

export function renderSvg(name, tier) {
  return (
    "<svg xmlns='http://www.w3.org/2000/svg' width='250' height='350' viewBox='0 0 250 350'>" +
    "<animate attributeName='opacity' dur='2.2s' from='1' to='0.999' repeatCount='indefinite'/>" +
    '<style>.n{fill:#fff;font:bold 22px monospace}.t{fill:#c9c9d1;font:14px monospace}</style>' +
    "<rect width='250' height='350' rx='12' fill='#1e1e22'/>" +
    "<rect x='4.5' y='4.5' width='241' height='341' rx='9' fill='none' stroke='#b79a5e' stroke-width='4'>" +
    "<animate attributeName='stroke-opacity' values='1;0.4;1' dur='3s' repeatCount='indefinite'/></rect>" +
    `<text x='125' y='42' text-anchor='middle' class='n'>${name}</text>` +
    "<rect x='61' y='65' width='128' height='128' rx='8' fill='#000'/>" +
    "<foreignObject x='61' y='65' width='128' height='128'>" +
    `<xhtml:img xmlns:xhtml='http://www.w3.org/1999/xhtml' src='${PNG_DATA_URI}' ` +
    "style='width:100%;height:100%;image-rendering:pixelated'/></foreignObject>" +
    `<text x='125' y='230' text-anchor='middle' class='t'>TIER ${tier}</text>` +
    '</svg>'
  );
}

export function members(tokenId, name, tier) {
  return (
    `"name":"${name}","description":"${DESCRIPTION}",` +
    `"attributes":[{"trait_type":"Tier","value":"${tier}"},{"trait_type":"Token ID","value":"${tokenId}"}]`
  );
}

// Standard MIDI File, format 0, PPQ 48, one 4/4 bar at 120 BPM (192 ticks). Mirrors sound.cairo.
// prettier-ignore
export const MIDI = Buffer.from([
  0x4d, 0x54, 0x68, 0x64, 0x00, 0x00, 0x00, 0x06, // MThd, length 6
  0x00, 0x00, 0x00, 0x01, 0x00, 0x30,             // format 0, 1 track, PPQ 48
  0x4d, 0x54, 0x72, 0x6b, 0x00, 0x00, 0x00, 0x5a, // MTrk, length 90
  0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20,       // t=0   tempo 500000 us/quarter (120 BPM)
  0x00, 0xff, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08, // t=0   time signature 4/4
  0x00, 0xc0, 0x50,                               // t=0   ch1 program 80 (custom chip lead)
  0x00, 0xb0, 0x07, 0x64,                         // t=0   ch1 CC7 volume 100
  0x00, 0x0a, 0x40,                               // t=0   (running status) CC10 pan 64
  0x00, 0xb9, 0x07, 0x5a,                         // t=0   ch10 CC7 volume 90
  0x00, 0x90, 0x48, 0x60,                         // t=0   ch1 C5 on
  0x00, 0x99, 0x24, 0x64,                         // t=0   ch10 kick (36, custom drum) on
  0x0c, 0x24, 0x00,                               // t=12  (running) kick off (vel 0)
  0x1c, 0x90, 0x48, 0x00,                         // t=40  C5 off (vel 0)
  0x08, 0x4c, 0x60,                               // t=48  (running) E5 on
  0x00, 0x99, 0x26, 0x64,                         // t=48  snare (38) on
  0x0c, 0x26, 0x00,                               // t=60  (running) snare off
  0x1c, 0x90, 0x4c, 0x00,                         // t=88  E5 off
  0x08, 0x4f, 0x60,                               // t=96  (running) G5 on
  0x00, 0x99, 0x24, 0x64,                         // t=96  kick on
  0x0c, 0x24, 0x00,                               // t=108 (running) kick off
  0x1c, 0x90, 0x4f, 0x00,                         // t=136 G5 off
  0x08, 0x54, 0x60,                               // t=144 (running) C6 on
  0x00, 0x99, 0x26, 0x64,                         // t=144 snare on
  0x0c, 0x26, 0x00,                               // t=156 (running) snare off
  0x1c, 0x90, 0x54, 0x00,                         // t=184 C6 off
  0x08, 0xff, 0x2f, 0x00,                         // t=192 End-of-Track (bar boundary)
]);

const op = (o) => ({
  route: 0, wave: 'Sine', volume: 5000, ratio: 10000, offset_hz: 0, attack: 0, hold: 100, decay: 100,
  sustain: 0, release: 500, pitch_ratio: 10000, pitch_time: 10000, key_scale: 0, filter: null, ...o,
});

/** Constant timbres: a chip lead on program 80 and a custom kick on drum note 36. */
export const TIMBRES = [
  {
    drum: false,
    slot: 80,
    operators: [
      // Carrier: triangle, 3 ms attack, full sustain, 33 ms release.
      op({ wave: 'Triangle', volume: 5000, attack: 30, hold: 0, decay: 100, sustain: 10000, release: 330 }),
      // 6 Hz LFO into operator 1's frequency (route 1): ratio 0 fixes it at offset_hz; depth 0.0175
      // of the carrier frequency (about 30 cents); 0.2 s attack fades the vibrato in.
      op({ route: 1, wave: 'Sine', volume: 175, ratio: 0, offset_hz: 60000, attack: 2000, hold: 0, sustain: 10000, release: 330 }),
    ],
  },
  {
    drum: true,
    slot: 36,
    operators: [
      // Kick: fixed 120 Hz sine dropping to a quarter of that pitch with a 50 ms time constant.
      op({ wave: 'Sine', volume: 10000, ratio: 0, offset_hz: 1200000, hold: 200, decay: 1000, release: 1000, pitch_ratio: 2500, pitch_time: 500 }),
    ],
  },
];

/** Reverb is the only per-token setting, derived from the permanent tier trait. */
export const REVERB_BY_TIER = { 1: 100, 2: 30, 3: 5 };

export function settingsFor(tier) {
  return { quality: 1, reverb: REVERB_BY_TIER[tier], master_vol: 40, voices: 64, waves: [], timbres: TIMBRES };
}

/** Checks the MIDI fixture: chunk lengths, End-of-Track on a bar boundary, running status used. */
export function validateMidi(m) {
  const tag = (p) => m.toString('latin1', p, p + 4);
  if (tag(0) !== 'MThd' || m.readUInt32BE(4) !== 6) throw new Error('MThd');
  const ppq = m.readUInt16BE(12);
  if (tag(14) !== 'MTrk') throw new Error('MTrk');
  const end = 22 + m.readUInt32BE(18);
  if (end !== m.length) throw new Error(`MTrk length ${m.readUInt32BE(18)} != ${m.length - 22}`);
  let p = 22, tick = 0, run = 0, runningUsed = 0, offByVel0 = 0, eot = -1, notes = 0, drumHits = 0;
  const vlq = () => { let v = 0, b; do { b = m[p++]; v = v * 128 + (b & 127); } while (b & 128); return v; };
  while (p < end) {
    tick += vlq();
    let st = m[p];
    if (st & 0x80) p++; else { st = run; runningUsed++; }
    if (st === 0xff) { const ty = m[p++]; const len = vlq(); if (ty === 0x2f) eot = tick; p += len; run = 0; continue; }
    // SysEx (F0) and escape (F7) events: VLQ length, then that many bytes. They cancel running status.
    if (st === 0xf0 || st === 0xf7) { const len = vlq(); p += len; run = 0; continue; }
    if (!st) throw new Error('running status without a status byte');
    run = st;
    const hi = st & 0xf0; const d1 = m[p++]; const d2 = hi === 0xc0 || hi === 0xd0 ? 0 : m[p++];
    if (hi === 0x90 && d2 === 0) offByVel0++;
    if (hi === 0x90 && d2 > 0) { if ((st & 0x0f) === 9) drumHits++; else notes++; }
    void d1;
  }
  if (p !== end || eot !== tick) throw new Error('End-of-Track must be the last event');
  if (eot % (ppq * 4)) throw new Error('End-of-Track not on a 4/4 bar boundary');
  if (!runningUsed || !offByVel0) throw new Error('fixture should exercise running status and vel-0 note-off');
  return { ppq, eotTick: eot, bars: eot / (ppq * 4), runningUsed, offByVel0, notes, drumHits };
}

/**
 * Test variant of MIDI with two complete SysEx events (00 F0 01 F7, and GM System On:
 * 00 F0 05 7E 7F 09 01 F7) inserted after the tempo meta event, MTrk length adjusted. Same notes,
 * same End-of-Track tick. (The page rejects F7 escape and continuation events, which TinySynth
 * would misread.)
 */
export function midiWithSysex() {
  const insert = Buffer.from([0x00, 0xf0, 0x01, 0xf7, 0x00, 0xf0, 0x05, 0x7e, 0x7f, 0x09, 0x01, 0xf7]);
  const at = 22 + 7; // after the 7-byte tempo event
  const out = Buffer.concat([MIDI.subarray(0, at), insert, MIDI.subarray(at)]);
  out.writeUInt32BE(MIDI.readUInt32BE(18) + insert.length, 18);
  return out;
}

// ---------------------------------------------------------------------------------------------
// token_uri: spliced (what the contract does) and naive (one pass, standard nesting)
// ---------------------------------------------------------------------------------------------

export function tokenParts(tokenId) {
  const t = TOKENS[tokenId];
  if (!t) throw new Error(`unknown token ${tokenId}`);
  const svg = renderSvg(t.name, t.tier);
  if (svg.toLowerCase().includes('</script')) throw new Error('SVG contains </script');
  const mem = members(tokenId, t.name, t.tier);
  const settings = settingsFor(t.tier);
  const { d, pad: dPad } = dFragment(MIDI, settings);
  return { ...t, tokenId, svg, mem, settings, d, dPad, pageHtml: page(), ...consumerPieces(mem, svg) };
}

/** What the contract assembles, piece by piece. */
export const tokenUriSpliced = (tokenId) => spliceTokenUri(tokenParts(tokenId));

/** The decoded animation_url HTML: PAGE ++ D ++ SVG. */
export const animationHtml = (tokenId) => {
  const p = tokenParts(tokenId);
  return p.pageHtml + p.d + p.svg;
};

export const tokenJsonNaive = (tokenId) => naiveTokenJson(tokenParts(tokenId));
export const tokenUriNaive = (tokenId) => naiveTokenUri(tokenParts(tokenId));

/** The same token as compact JSON (no alignment whitespace), for a semantic comparison. */
export function tokenJsonCompact(tokenId) {
  const p = tokenParts(tokenId);
  return JSON.stringify({
    ...JSON.parse('{' + p.mem + '}'),
    image: 'data:image/svg+xml;base64,' + p.svgB64,
    animation_url: 'data:text/html;base64,' + b64(animationHtml(tokenId)),
  });
}

// ---------------------------------------------------------------------------------------------
// Cairo emitters (formatter-stable: one felt per line, 4/8-space indent, trailing commas)
// ---------------------------------------------------------------------------------------------

/** ByteArray Serde layout: [full_words_len, word_0..word_n (31 bytes each), pending_word, pending_len]. */
export function byteArrayFelts(x) {
  const b = bytes(x);
  const full = Math.floor(b.length / 31);
  const felts = [`${full}`];
  const hex = (buf) => (buf.length ? '0x' + buf.toString('hex') : '0');
  for (let i = 0; i < full; i++) felts.push(hex(b.subarray(i * 31, i * 31 + 31)));
  const rest = b.subarray(full * 31);
  felts.push(hex(rest), `${rest.length}`);
  return felts;
}

/**
 * A Cairo function returning `x` as a ByteArray, deserialized from its Serde felts. Only full
 * 31-byte words go in the array literal (one per line, too wide for `scarb fmt` to join); the
 * word count, pending word and pending length are separate statements, so the output is
 * formatter-stable.
 */
export function cairoByteArrayFn(name, x, doc) {
  const [full, ...rest] = byteArrayFelts(x);
  const words = rest.slice(0, -2);
  const [pendingWord, pendingLen] = rest.slice(-2);
  return [
    ...doc.map((l) => (l ? `/// ${l}` : '///')),
    `pub fn ${name}() -> ByteArray {`,
    `    let mut felts: Array<felt252> = array![${full}];`,
    ...(words.length
      ? ['    let words: Array<felt252> = array![', ...words.map((w) => `        ${w},`), '    ];',
        '    felts.append_span(words.span());']
      : []),
    `    felts.append(${pendingWord});`,
    `    felts.append(${pendingLen});`,
    '    let mut span = felts.span();',
    '    Serde::deserialize(ref span).unwrap()',
    '}',
  ].join('\n');
}
