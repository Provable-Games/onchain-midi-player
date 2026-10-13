// Offline reference for the stress_nft example. Node built-ins only.
//
// A deliberately independent JavaScript re-implementation of what StressNft.token_uri returns for
// a given number of bars: the SVG, the JSON members, the generated score, the default
// TinySynthSettings and the spliced token_uri (the same layout and word alignment as the
// beast_consumer example), on top of the repository's JS reference of the class (scripts/segments.mjs).
// gen_fixtures.mjs writes the Cairo golden from it, and rpc_check.mjs compares live responses with it.

import { readFileSync } from 'node:fs';
import { dFragment, sha256 } from '../../../scripts/segments.mjs';
import { consumerPieces, spliceTokenUri } from '../../../scripts/composition.mjs';

export const TOKEN_COUNT = 20;

/** The calibrated number of bars per token: repetitions.json, index 0 is token 1. */
export const defaultRepetitions = () =>
  JSON.parse(readFileSync(new URL('../repetitions.json', import.meta.url), 'utf8')).repetitions;

/** `TinySynthSettings` of `default_settings()` in src/settings.cairo. */
export const SETTINGS = { quality: 1, reverb: 30, master_vol: 40, voices: 64, waves: [], timbres: [] };

export const DESCRIPTION =
  'A stress-test token for the onchain MIDI player. Its score repeats one bar until the token_uri call is as expensive as its number says.';

export const tokenName = (tokenId) => `Stress #${tokenId}`;

export const renderSvg = (tokenId, bars) =>
  "<svg xmlns='http://www.w3.org/2000/svg' width='250' height='350' viewBox='0 0 250 350'>" +
  "<rect width='250' height='350' rx='12' fill='#1e1e22'/>" +
  "<rect x='4.5' y='4.5' width='241' height='341' rx='9' fill='none' stroke='#b79a5e' stroke-width='4'/>" +
  "<text x='125' y='160' text-anchor='middle' fill='#fff' font-family='monospace' font-size='26' font-weight='bold'>" +
  `${tokenName(tokenId)}</text>` +
  "<text x='125' y='200' text-anchor='middle' fill='#c9c9d1' font-family='monospace' font-size='14'>" +
  `${bars} bars</text></svg>`;

export const members = (tokenId, bars) =>
  `"name":"${tokenName(tokenId)}","description":"${DESCRIPTION}",` +
  `"attributes":[{"trait_type":"Token ID","value":"${tokenId}"},` +
  `{"trait_type":"Bars","display_type":"number","value":${bars}}]`;

/**
 * Format 0, PPQ 48, 120 BPM, `bars` repetitions of one 4/4 bar (eight eighth notes, C5 E5 G5 C6 G5 E5
 * C5 G4, each a note-on and a note-off 24 ticks later), then End-of-Track on the last bar line.
 * 48 bytes plus 64 per bar. Mirrors `stress_midi` in src/stress_nft.cairo.
 */
export function stressMidi(bars) {
  const bar = [];
  for (const note of [0x48, 0x4c, 0x4f, 0x54, 0x4f, 0x4c, 0x48, 0x43]) {
    bar.push(0x00, 0x90, note, 0x60, 0x18, 0x90, note, 0x00);
  }
  const head = [
    0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20, // t=0 tempo 500000 us per quarter (120 BPM)
    0x00, 0xff, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08, // t=0 time signature 4/4
    0x00, 0xc0, 0x00, // t=0 ch1 program 0
    0x00, 0xb0, 0x07, 0x64, // t=0 ch1 CC7 volume 100
  ];
  const track = Buffer.concat([Buffer.from(head), Buffer.concat(Array(bars).fill(Buffer.from(bar))), Buffer.from([0x00, 0xff, 0x2f, 0x00])]);
  const hdr = Buffer.from([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0, 0x30, 0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, 0]);
  hdr.writeUInt32BE(track.length, 18);
  return Buffer.concat([hdr, track]);
}

/** The consumer word-aligns its two largest appends, as beast_consumer does. */
export const ALIGN = { align: true };

export function tokenParts(tokenId, bars) {
  const svg = renderSvg(tokenId, bars);
  const mem = members(tokenId, bars);
  const midi = stressMidi(bars);
  const { d } = dFragment(midi, SETTINGS);
  return { tokenId, bars, svg, mem, midi, d };
}

/** What `StressNft.token_uri(tokenId)` returns when the token has `bars` bars. */
export const tokenUri = (tokenId, bars) => spliceTokenUri(tokenParts(tokenId, bars), ALIGN);

export { consumerPieces, sha256 };

/**
 * The string held by the Serde felts of a returned ByteArray (hex strings or numbers). Strict, like
 * Cairo's own decoding: every full word is below 256^31, the pending length is 0 to 30 and the
 * pending word below 256^length, so a malformed array throws instead of decoding to something.
 */
export function decodeByteArray(felts) {
  const n = Number(BigInt(felts[0]));
  if (felts.length !== n + 3) throw new Error(`ByteArray: ${felts.length} felts for ${n} words`);
  const pendingLen = Number(BigInt(felts[n + 2]));
  if (!(pendingLen >= 0 && pendingLen <= 30)) throw new Error(`ByteArray: pending length ${pendingLen}`);
  const out = Buffer.alloc(n * 31 + pendingLen);
  const put = (felt, len, at) => {
    const v = BigInt(felt);
    if (v < 0n || v >= 1n << BigInt(8 * len)) throw new Error(`ByteArray: a word does not fit ${len} bytes`);
    out.write(v.toString(16).padStart(len * 2, '0'), at, 'hex');
  };
  for (let i = 0; i < n; i++) put(felts[1 + i], 31, i * 31);
  put(felts[n + 1], pendingLen, n * 31);
  return out.toString('latin1');
}

/**
 * The size in bytes of the JSON-RPC `starknet_call` response that carries `uri` as a ByteArray:
 * `{"jsonrpc":"2.0","id":1,"result":[...]}` with every felt a minimal hex string, as Pathfinder
 * and Juno write it. Providers add nothing to the body but may change the id.
 */
export function rpcResponseBytes(uri) {
  const b = Buffer.from(uri, 'latin1');
  const full = Math.floor(b.length / 31);
  const hex = (buf) => '0x' + (buf.length ? BigInt('0x' + buf.toString('hex')).toString(16) : '0');
  const felts = [`0x${full.toString(16)}`];
  for (let i = 0; i < full; i++) felts.push(hex(b.subarray(i * 31, i * 31 + 31)));
  felts.push(hex(b.subarray(full * 31)), `0x${(b.length - full * 31).toString(16)}`);
  return Buffer.byteLength(JSON.stringify({ jsonrpc: '2.0', id: 1, result: felts }));
}
