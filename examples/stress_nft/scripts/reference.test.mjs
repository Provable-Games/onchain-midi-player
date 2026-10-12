// Node tests for the stress_nft reference and the RPC harness.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkMidi } from '../../../player/player.js';
import { byteArrayFelts, decodeTokenUri } from '../../../scripts/segments.mjs';
import { TOKEN_COUNT, decodeByteArray, defaultRepetitions, rpcResponseBytes, stressMidi, tokenUri } from './reference.mjs';
import { isFelts, label, redactor, scalar, selector, withText } from './rpc_check.mjs';

test('the table has one growing, positive count per token', () => {
  const bars = defaultRepetitions();
  assert.equal(bars.length, TOKEN_COUNT);
  for (let i = 0; i < bars.length; i++) {
    assert.ok(Number.isInteger(bars[i]) && bars[i] >= 1);
    if (i) assert.ok(bars[i] > bars[i - 1], `token ${i + 1} is longer than token ${i}`);
  }
});

test('the score is 48 bytes plus 64 per bar and passes the page MIDI check, ending on a bar line', () => {
  for (const bars of [1, 6, 10023]) {
    const midi = stressMidi(bars);
    assert.equal(midi.length, 48 + 64 * bars);
    assert.equal(midi.readUInt32BE(18), midi.length - 22, 'MTrk length');
    assert.deepEqual([...midi.subarray(-4)], [0x00, 0xff, 0x2f, 0x00], 'End-of-Track');
    assert.equal(checkMidi(midi).maxTick, 192 * bars);
  }
});

test('token_uri decodes to OpenSea-style JSON with a complete NFT document and isolated art', () => {
  const dec = decodeTokenUri(tokenUri(7, 573));
  assert.equal(dec.json.name, 'Stress #7');
  assert.deepEqual(dec.json.attributes, [
    { trait_type: 'Token ID', value: '7' },
    { trait_type: 'Bars', display_type: 'number', value: 573 },
  ]);
  assert.ok(dec.svg.includes('573 bars') && !/<\/script/i.test(dec.svg));
  assert.match(dec.html, /<img id="beast-art"[^>]+src="data:image\/svg\+xml;base64,/);
  assert.ok(dec.html.indexOf('beast-bootstrap') > dec.html.indexOf('beast-art'));
  assert.ok(dec.html.trimEnd().endsWith('</body></html>'));
  assert.match(dec.html, /<script type="text\/plain" id="onchain-midi-settings">1,1,30,40,64,0,0<\/script>/);

});

test('a ByteArray decodes from its felts, and the response size is the size of the JSON', () => {
  const uri = tokenUri(1, 6);
  assert.equal(decodeByteArray(byteArrayFelts(uri)), uri);
  const felts = byteArrayFelts(uri).map((f) => '0x' + BigInt(f).toString(16));
  assert.equal(rpcResponseBytes(uri), JSON.stringify({ jsonrpc: '2.0', id: 1, result: felts }).length);
});

test('a malformed ByteArray is rejected, not decoded to something', () => {
  const ok = ['0x1', '0x' + 'ab'.repeat(31), '0x6869', '0x2'];
  assert.equal(decodeByteArray(ok).length, 33);
  const bad = (i, v) => ok.map((f, j) => (j === i ? v : f));
  assert.throws(() => decodeByteArray(bad(1, '0x' + 'ab'.repeat(31) + '1')), /does not fit/); // one hex digit too many
  assert.throws(() => decodeByteArray(bad(2, '0x686900')), /does not fit/); // pending word wider than its length
  assert.throws(() => decodeByteArray(bad(3, '0x1f')), /pending length/);
  assert.throws(() => decodeByteArray(['0x1', '0x1']), /felts for/);
});

test('the largest response stays under the 10 MiB response cap of jsonrpsee', () => {
  const bars = defaultRepetitions();
  for (const t of [TOKEN_COUNT - 1, TOKEN_COUNT]) assert.ok(rpcResponseBytes(tokenUri(t, bars[t - 1])) < 10 * 1024 * 1024);
});

test('entry point selectors are starknet_keccak', () => {
  assert.equal(selector('token_uri'), '0x226ad7e84c1fe08eb4c525ed93cccadf9517670341304571e66f7c4f95cbe54');
  assert.equal(selector('transfer'), '0x83afd3f4caedc6eebf44246fe54e38c95e3179a5ec9ea81740eca5b482d12e');
});

test('errors never carry a provider URL, host or key, however the key looks', () => {
  for (const key of ['0123456789abcdef', 'abcdefghijklmnopqrstuvwxyz', '1234567890123', 'Ab-Cd_Ef.Gh%2Fij']) {
    const url = `https://rpc.example.com/v2/${key}/starknet?token=${key}x`;
    const redact = redactor([url]);
    for (const msg of [`fetch to ${url} failed`, 'getaddrinfo ENOTFOUND rpc.example.com', `Invalid API key ${key}`, `bad path /v2/${key}`, `${'x'.repeat(190)} ${key}`]) {
      const out = redact(msg).slice(0, 200);
      assert.ok(!out.includes(key) && !out.includes('example'), out);
    }
    assert.ok(!redact(`${'x'.repeat(190)} ${key}`).includes(key.slice(0, 4)), 'a cut through a key leaves no prefix');
  }
  assert.equal(redactor([])('the method starknet_call does not exist, see https://other.example/x'), 'the method starknet_call does not exist, see <url>');
});

test('only an array of hex felts is a result', () => {
  assert.ok(isFelts(['0x0', '0xabc', '0X1F'.replace('X', 'x')]));
  assert.ok(!isFelts(['0x0', 'invalid API key SECRET']));
  assert.ok(!isFelts('0x0') && !isFelts([0]) && !isFelts(['0x']));
});

test('a scalar is exactly one felt of a successful call', () => {
  assert.equal(scalar({ ok: true, felts: ['0x7'] }), 7n);
  for (const r of [{ ok: true, felts: [] }, { ok: true, felts: ['0x1', '0x2'] }, { ok: false, error: 'x' }]) assert.equal(scalar(r), undefined);
});

test('an encoded query key is redacted as the provider echoes it', () => {
  const redact = redactor(['https://rpc.example.com/?key=Ab%2FCd']);
  for (const echo of ['Invalid API key Ab%2FCd', 'Invalid API key Ab/Cd']) assert.ok(!/Ab.{1,3}Cd/.test(redact(echo)), redact(echo));
});

test('revert reasons are shown as text', () => {
  assert.equal(withText('40: Contract error | 0x4f7574206f6620676173'), "40: Contract error | 0x4f7574206f6620676173 ('Out of gas')");
  assert.equal(withText('0x6f81222502a5421224731965cab4627d5ba66befa6e4818b1d07d60c872d11d'), '0x6f81222502a5421224731965cab4627d5ba66befa6e4818b1d07d60c872d11d');
});

test('labels name the failures the matrix is about', () => {
  assert.equal(label({ ok: true, identical: true }), 'ok');
  assert.equal(label({ ok: true, identical: false }), 'DIFF');
  assert.equal(label({ ok: false, error: "40: Contract error | 0x4f7574206f6620676173 ('Out of gas')" }), 'OOG');
  assert.equal(label({ ok: false, error: 'timeout after 180 s' }), 'TIMEOUT');
  assert.equal(label({ ok: false, error: 'HTTP 429: rate limit exceeded' }), 'HTTP 429');
  assert.equal(label({ ok: false, error: 'HTTP 413: payload too large' }), 'TOO BIG');
  assert.equal(label({ ok: false, error: '-32000: response size exceeded' }), 'TOO BIG');
});
