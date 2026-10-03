// Offline reference for the beast_consumer example. Node built-ins only.
//
// This module is a deliberately independent JavaScript re-implementation of everything the Cairo
// side produces:
//
//   - the mock PAGE (what the real phase-3 build pipeline will assemble around the TinySynth engine)
//   - MockOnchainTinySynth: SETTINGS serialization, D, midi_segment, animation_url_segment
//   - BeastLikeNft: token table, render_svg, JSON members, MIDI, SynthSettings
//
// gen_page.mjs turns PAGE into the generated Cairo constant. gen_fixtures.mjs builds every token's
// token_uri twice (naive one-pass nesting and the spliced layout), checks they are equal, and writes
// the golden file the Cairo tests compare against. If the Cairo and the JS ever drift, the golden
// test fails.

import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------------------------
// Bytes and base64
// ---------------------------------------------------------------------------------------------

/** ASCII/Latin-1 string or Buffer -> Buffer. Every text piece in this example is ASCII. */
export const bytes = (x) => (Buffer.isBuffer(x) ? x : Buffer.from(x, 'latin1'));
/** Standard RFC 4648 base64 with '=' padding, as an ASCII string. */
export const b64 = (x) => bytes(x).toString('base64');
export const spaces = (n) => ' '.repeat(n);
/** Number of spaces that brings `len + extra` up to a multiple of `k`. */
export const padLen = (len, k) => (k - (len % k)) % k;
export const sha256 = (x) => createHash('sha256').update(bytes(x)).digest('hex');

// ---------------------------------------------------------------------------------------------
// The mock PAGE (fixed for a class version)
// ---------------------------------------------------------------------------------------------

export const PAGE_VERSION = 'mock-page.1';

// Stands in for the ~37 KB minified TinySynth engine. Same global name and the few methods the
// player uses, but it makes no sound.
export const MOCK_ENGINE_JS =
  '/* MOCK ENGINE. The real class embeds the ~37 KB minified TinySynth engine (Provable-Games fork,' +
  ' pinned release, SHA-256 = script_sha256()) here. This stand-in keeps the same global and the few' +
  ' methods the player calls, and makes no sound. */' +
  'window.WebAudioTinySynth=function(o){this.opts=o||{};this.timbres=[];this.midi=null;' +
  'this.setTimbre=function(drum,slot,ops){this.timbres.push({drum:drum,slot:slot,ops:ops})};' +
  'this.loadMIDI=function(b){this.midi=b};this.playMIDI=function(){};this.stopMIDI=function(){}};';

// Runs on DOMContentLoaded: the settings, MIDI and art blocks come after this script in the
// document (the art block is unclosed and ends at EOF), so they exist only once parsing is done.
const PLAYER_JS = `(function(){"use strict";
var FX=10000,WAVES=["sine","square","sawtooth","triangle","n0","n1"];
function $(i){return document.getElementById(i)}
function nums(t){return t.split(",").map(Number)}
function parseSettings(text){
var parts=text.trim().split(";"),g=nums(parts[0]);
var s={quality:g[0],reverb:g[1],masterVol:g[2],voices:g[3],timbres:[]};
for(var i=1;i<parts.length;i++){var ops=parts[i].split(":"),h=nums(ops[0]),tm={drum:h[0]===1,slot:h[1],ops:[]};
for(var j=1;j<ops.length;j++){var v=nums(ops[j]);
tm.ops.push({g:v[0],w:WAVES[v[1]],v:v[2]/FX,t:v[3]/FX,f:v[4]/FX,a:v[5]/FX,h:v[6]/FX,d:v[7]/FX,s:v[8]/FX,r:v[9]/FX,p:v[10]/FX,q:v[11]/FX,k:v[12]/FX})}
s.timbres.push(tm)}
return s}
function b64ToBytes(t){var bin=atob(t.replace(/\\s+/g,"")),u=new Uint8Array(bin.length);for(var i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);return u}
function textToB64(t){var u=new TextEncoder().encode(t),bin="";for(var i=0;i<u.length;i++)bin+=String.fromCharCode(u[i]);return btoa(bin)}
function parseMidi(u){var p=0;
function u32(){var v=(u[p]<<24|u[p+1]<<16|u[p+2]<<8|u[p+3])>>>0;p+=4;return v}
function u16(){var v=u[p]<<8|u[p+1];p+=2;return v}
function tag(){var s=String.fromCharCode(u[p],u[p+1],u[p+2],u[p+3]);p+=4;return s}
function vlq(){var v=0,b;do{b=u[p++];v=v*128+(b&127)}while(b&128);return v}
if(tag()!=="MThd"||u32()!==6)throw new Error("not a Standard MIDI File");
var m={format:u16(),tracks:u16(),ppq:u16(),notes:0,drumHits:0,events:0,bpm:120,endTick:0};
if(m.ppq&32768)throw new Error("SMPTE time division is not supported");
for(var n=0;n<m.tracks;n++){if(tag()!=="MTrk")throw new Error("missing MTrk");
var end=u32();end+=p;var tick=0,run=0;
while(p<end){tick+=vlq();var st=u[p];if(st&128)p++;else st=run;m.events++;
if(st===255){var ty=u[p++],len=vlq();if(ty===81)m.bpm=60000000/(u[p]<<16|u[p+1]<<8|u[p+2]);if(ty===47)m.endTick=Math.max(m.endTick,tick);p+=len;run=0}
else if(st===240||st===247){p+=vlq();run=0}
else{run=st;var hi=st&240,d1=u[p++],d2=(hi===192||hi===208)?0:u[p++];
if(hi===144&&d2>0){if((st&15)===9)m.drumHits++;else m.notes++}}}
if(p!==end)throw new Error("bad MTrk length")}
m.bars=m.endTick/(m.ppq*4);return m}
var state={ready:false};window.__player=state;
document.addEventListener("DOMContentLoaded",function(){try{
var settings=parseSettings($("settings").textContent),midi=b64ToBytes($("midi").textContent),art=$("art").textContent;
var info=parseMidi(midi);
$("view").src="data:image/svg+xml;base64,"+textToB64(art);
$("settings-out").textContent="raw (mock format): "+$("settings").textContent.trim()+"\\n\\nparsed: "+JSON.stringify(settings,null,1);
$("midi-out").textContent=midi.length+" bytes: format "+info.format+", "+info.tracks+" track(s), PPQ "+info.ppq+", "+info.bpm+" BPM, "+info.notes+" melody notes, "+info.drumHits+" drum hits, End-of-Track at tick "+info.endTick+" ("+info.bars+" bar(s))";
state.settings=settings;state.midiBytes=midi.length;state.midi=info;state.artChars=art.length;state.ready=true;
$("play").onclick=function(){var synth=new window.WebAudioTinySynth({quality:settings.quality,useReverb:settings.reverb>0,voices:settings.voices});
settings.timbres.forEach(function(t){synth.setTimbre(t.drum?1:0,t.slot,t.ops)});synth.loadMIDI(midi);synth.playMIDI();
state.played=true;$("status").textContent="MOCK: no audio. The real player would now start TinySynth with "+synth.timbres.length+" custom timbre(s) and loop at tick "+info.endTick+"."};
$("status").textContent="Ready (mock player).";
}catch(e){state.error=String(e);$("status").textContent="Error: "+e;console.error(e)}});
})();`;

const PAGE_STYLE =
  'html,body{margin:0;background:#111;color:#ddd;font:14px/1.4 monospace}' +
  '#card{display:flex;flex-wrap:wrap;gap:16px;padding:16px}' +
  '#view{width:250px;height:350px;background:#000}' +
  '#info{flex:1;min-width:240px}h1{font-size:16px;margin:0 0 8px}h1 b{color:#f55}' +
  'h2{font-size:13px;margin:12px 0 4px;color:#999}pre{margin:0;white-space:pre-wrap;word-break:break-all;' +
  'background:#1b1b1f;padding:6px;max-height:220px;overflow:auto}button{font:inherit;padding:6px 12px}';

export const SETTINGS_OPEN = '<script type="text/plain" id="settings">';
export const MIDI_OPEN = '</script><script type="text/plain" id="midi">';
export const ART_OPEN = '</script><script type="text/plain" id="art">';
export const URL_KEY = '"animation_url":"data:text/html;base64,';
export const IMAGE_KEY = '"image":"data:image/svg+xml;base64,';

function countCI(haystack, needle) {
  return haystack.toLowerCase().split(needle.toLowerCase()).length - 1;
}

/** Unpadded page: head (mock engine), body, player, then the opening of the settings block. */
export function pageUnpadded() {
  for (const js of [MOCK_ENGINE_JS, PLAYER_JS]) {
    // Script data must not contain these, or the HTML parser leaves the script early or enters an
    // escaped state.
    for (const bad of ['</script', '<script', '<!--']) {
      if (countCI(js, bad)) throw new Error(`script contains ${bad}`);
    }
  }
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>TinySynth player (mock)</title>' +
    `<style>${PAGE_STYLE}</style>` +
    `<script>${MOCK_ENGINE_JS}</script>` +
    '</head><body><div id="card"><img id="view" alt="token art">' +
    '<div id="info"><h1>TinySynth player <b>MOCK</b></h1>' +
    '<button id="play">Play (mock: no audio)</button><p id="status">Loading...</p>' +
    '<h2>Settings</h2><pre id="settings-out"></pre><h2>MIDI</h2><pre id="midi-out"></pre>' +
    '</div></div>' +
    `<script>${PLAYER_JS}</script>` +
    SETTINGS_OPEN
  );
}

/** PAGE: padded with spaces to len % 9 == 0. The spaces fall inside the settings block. */
export function page() {
  const p = pageUnpadded();
  const out = p + spaces(padLen(p.length, 9));
  if (out.length % 9) throw new Error('PAGE not 9-aligned');
  // Exactly the two intended closers: the engine placeholder and the player.
  if (countCI(out, '</script') !== 2) throw new Error('unexpected </script in PAGE');
  if (!out.endsWith(SETTINGS_OPEN + spaces(padLen(p.length, 9)))) throw new Error('PAGE tail');
  return out;
}

/** animation_url_segment(): b64('"animation_url":"data:text/html;base64,' ++ b64(PAGE)). */
export function animationUrlSegment() {
  const inner = URL_KEY + b64(page());
  if (inner.length % 3) throw new Error('segment inner not 3-aligned');
  const seg = b64(inner);
  if (seg.includes('=')) throw new Error('segment padded');
  return seg;
}

// ---------------------------------------------------------------------------------------------
// MockOnchainTinySynth.midi_segment
// ---------------------------------------------------------------------------------------------

export const WAVE_CODE = { Sine: 0, Square: 1, Sawtooth: 2, Triangle: 3, WhiteNoise: 4, MetallicNoise: 5 };
const OP_FIELDS = [
  'route', 'wave', 'volume', 'ratio', 'offset_hz', 'attack', 'hold', 'decay', 'sustain', 'release',
  'pitch_ratio', 'pitch_time', 'key_scale',
];

/**
 * Mock SETTINGS format (placeholder; the real format is specified with issue #1):
 *
 *   quality,reverb,master_vol,voices{;drum,slot{:op}}
 *   op = route,wave,volume,ratio,offset_hz,attack,hold,decay,sustain,release,pitch_ratio,pitch_time,key_scale
 *
 * Decimal integers (fixed-point fields stay in 1/10000 units), `-` for negatives, `,` `;` `:` as
 * separators. `drum` is 0/1; `wave` is 0..5 (Sine..MetallicNoise).
 */
export function settingsAscii(s) {
  let out = [s.quality, s.reverb, s.master_vol, s.voices].join(',');
  for (const t of s.timbres) {
    out += `;${t.drum ? 1 : 0},${t.slot}`;
    for (const op of t.operators) {
      out += ':' + OP_FIELDS.map((f) => (f === 'wave' ? WAVE_CODE[op.wave] : op[f])).join(',');
    }
  }
  if (!/^[0-9,;:-]*$/.test(out)) throw new Error('SETTINGS charset');
  return out;
}

/** D = SETTINGS MIDI_OPEN b64(midi) <pad> ART_OPEN, with 0..8 pad spaces so len(D) % 9 == 0. */
export function dFragment(midi, settings) {
  const head = settingsAscii(settings) + MIDI_OPEN + b64(midi);
  const pad = padLen(head.length + ART_OPEN.length, 9);
  const d = head + spaces(pad) + ART_OPEN;
  if (d.length % 9) throw new Error('D not 9-aligned');
  return { d, pad };
}

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
  return { quality: 1, reverb: REVERB_BY_TIER[tier], master_vol: 40, voices: 64, timbres: TIMBRES };
}

/** Checks the MIDI fixture: chunk lengths, End-of-Track on a bar boundary, running status used. */
export function validateMidi(m) {
  const tag = (p) => m.toString('latin1', p, p + 4);
  if (tag(0) !== 'MThd' || m.readUInt32BE(4) !== 6) throw new Error('MThd');
  const ppq = m.readUInt16BE(12);
  if (tag(14) !== 'MTrk') throw new Error('MTrk');
  const end = 22 + m.readUInt32BE(18);
  if (end !== m.length) throw new Error(`MTrk length ${m.readUInt32BE(18)} != ${m.length - 22}`);
  let p = 22, tick = 0, run = 0, runningUsed = 0, offByVel0 = 0, eot = -1;
  const vlq = () => { let v = 0, b; do { b = m[p++]; v = v * 128 + (b & 127); } while (b & 128); return v; };
  while (p < end) {
    tick += vlq();
    let st = m[p];
    if (st & 0x80) p++; else { st = run; runningUsed++; }
    if (st === 0xff) { const ty = m[p++]; const len = vlq(); if (ty === 0x2f) eot = tick; p += len; run = 0; continue; }
    if (!st) throw new Error('running status without a status byte');
    run = st;
    const hi = st & 0xf0; const d1 = m[p++]; const d2 = hi === 0xc0 || hi === 0xd0 ? 0 : m[p++];
    if (hi === 0x90 && d2 === 0) offByVel0++;
    void d1;
  }
  if (p !== end || eot !== tick) throw new Error('End-of-Track must be the last event');
  if (eot % (ppq * 4)) throw new Error('End-of-Track not on a 4/4 bar boundary');
  if (!runningUsed || !offByVel0) throw new Error('fixture should exercise running status and vel-0 note-off');
  return { ppq, eotTick: eot, bars: eot / (ppq * 4), runningUsed, offByVel0 };
}

// ---------------------------------------------------------------------------------------------
// token_uri: spliced (what the contract does) and naive (one pass, standard nesting)
// ---------------------------------------------------------------------------------------------

export function tokenParts(tokenId) {
  const t = TOKENS[tokenId];
  if (!t) throw new Error(`unknown token ${tokenId}`);
  const svg = renderSvg(t.name, t.tier);
  if (svg.toLowerCase().includes('</script')) throw new Error('SVG contains </script');
  const svgB64 = b64(svg);
  const mem = members(tokenId, t.name, t.tier);
  const settings = settingsFor(t.tier);
  // Consumer pieces, padded with JSON whitespace to multiples of 3.
  const headPad = padLen(1 + mem.length + 1 + IMAGE_KEY.length, 3);
  const head = '{' + mem + ',' + spaces(headPad) + IMAGE_KEY;
  const sPad = padLen(svgB64.length + 1, 3);
  const s = svgB64 + '"' + spaces(sPad);
  const comma = ',  ';
  const { d, pad: dPad } = dFragment(MIDI, settings);
  return { ...t, tokenId, svg, svgB64, mem, settings, head, headPad, s, sPad, comma, d, dPad };
}

/** What the contract assembles, piece by piece. */
export function tokenUriSpliced(tokenId) {
  const p = tokenParts(tokenId);
  for (const piece of [p.head, p.s, p.comma]) if (piece.length % 3) throw new Error('unaligned piece');
  const sB64 = b64(p.s);
  return (
    'data:application/json;base64,' + b64(p.head) + sB64 + b64(p.comma) + animationUrlSegment() +
    midiSegment(MIDI, p.settings) + sB64 + b64('}')
  );
}

/** The decoded animation_url HTML: PAGE ++ D ++ SVG. */
export const animationHtml = (tokenId) => {
  const p = tokenParts(tokenId);
  return page() + p.d + p.svg;
};

/**
 * Naive reference: build the whole JSON as one string with standard nested data URIs, then
 * base64 it once. The whitespace between JSON tokens is the same insignificant whitespace the
 * spliced version uses for alignment (checked separately against compact JSON).
 */
export function tokenJsonNaive(tokenId) {
  const p = tokenParts(tokenId);
  return (
    '{' + p.mem + ',' + spaces(p.headPad) +
    '"image":"data:image/svg+xml;base64,' + p.svgB64 + '"' + spaces(p.sPad) + ',  ' +
    '"animation_url":"data:text/html;base64,' + b64(animationHtml(tokenId)) + '"' + spaces(p.sPad) +
    '}'
  );
}

export const tokenUriNaive = (tokenId) => 'data:application/json;base64,' + b64(tokenJsonNaive(tokenId));

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

// ---------------------------------------------------------------------------------------------
// Decoder: token_uri -> human-inspectable layers
// ---------------------------------------------------------------------------------------------

const JSON_PREFIX = 'data:application/json;base64,';
const SVG_PREFIX = 'data:image/svg+xml;base64,';
const HTML_PREFIX = 'data:text/html;base64,';

/** Strict base64 decode: rejects anything that does not round-trip (e.g. '=' mid-stream). */
export function strictB64Decode(s) {
  const buf = Buffer.from(s, 'base64');
  if (buf.toString('base64') !== s) throw new Error('not canonical standard base64');
  return buf;
}

/** Decodes a token_uri exactly as a marketplace would: JSON layer, then the two data URIs. */
export function decodeTokenUri(uri) {
  if (!uri.startsWith(JSON_PREFIX)) throw new Error('not a base64 JSON data URI');
  const jsonText = strictB64Decode(uri.slice(JSON_PREFIX.length)).toString('latin1');
  const json = JSON.parse(jsonText);
  if (!json.image.startsWith(SVG_PREFIX)) throw new Error('image is not a base64 SVG data URI');
  if (!json.animation_url.startsWith(HTML_PREFIX)) throw new Error('animation_url is not base64 HTML');
  const svg = strictB64Decode(json.image.slice(SVG_PREFIX.length)).toString('latin1');
  const html = strictB64Decode(json.animation_url.slice(HTML_PREFIX.length)).toString('latin1');
  return { jsonText, json, svg, html };
}
