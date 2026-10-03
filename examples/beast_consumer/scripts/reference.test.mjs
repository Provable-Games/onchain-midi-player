// Node tests for the offline reference, decoder and the player's MIDI parser. Built-ins only.
//
// Run from examples/beast_consumer:  node --test scripts/*.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import {
  MIDI, PARSE_MIDI_JS, SETTINGS_OPEN, blen, bytes, decodeTokenUri, dFragment, midiWithSysex,
  naiveTokenUri, padLen, page, renderSvg, settingsFor, spaces, spliceTokenUri, tokenUriSpliced,
  validateMidi,
} from './reference.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

/** The player's parseMidi, exactly as embedded in the page, run in a fresh VM context. */
const parseMidi = vm.runInNewContext(`${PARSE_MIDI_JS};parseMidi`, {});

test('the page embeds exactly the tested parseMidi', () => {
  assert.ok(page().includes(PARSE_MIDI_JS));
});

for (const [label, midi] of [['fixture MIDI', MIDI], ['MIDI with SysEx (F0) and escape (F7) events', midiWithSysex()]]) {
  test(`validateMidi: ${label}`, () => {
    const info = validateMidi(midi);
    assert.equal(info.eotTick, 192);
    assert.equal(info.bars, 1);
    assert.equal(info.notes, 4);
    assert.equal(info.drumHits, 4);
  });

  test(`player parseMidi: ${label}`, () => {
    const m = parseMidi(new Uint8Array(midi));
    assert.equal(m.endTick, 192);
    assert.equal(m.bars, 1);
    assert.equal(m.notes, 4);
    assert.equal(m.drumHits, 4);
    assert.equal(m.ppq, 48);
    assert.equal(m.bpm, 120);
  });
}

test('the SysEx variant really contains 00 F0 01 F7 and an F7 escape', () => {
  const v = midiWithSysex();
  assert.ok(v.includes(Buffer.from([0x00, 0xf0, 0x01, 0xf7])));
  assert.ok(v.includes(Buffer.from([0x00, 0xf7, 0x02, 0x01, 0x02])));
  assert.equal(v.readUInt32BE(18), v.length - 22);
});

test('fixtures/token_uri.txt is the reference token_uri of token 1', () => {
  assert.equal(readFileSync(join(root, 'fixtures', 'token_uri.txt'), 'utf8'), tokenUriSpliced(1));
});

test('non-ASCII text round-trips through token_uri, decodeTokenUri and decode.mjs', () => {
  const name = 'Café ✓ 🎵';
  const description = 'Ünïcödé naïve ✓ 🎶';
  const mem = `"name":"${name}","description":"${description}","attributes":[]`;
  const svg = renderSvg(name, 1);
  const head = `<!doctype html><title>Café ✓ 🎵</title>${SETTINGS_OPEN}`;
  const pageHtml = head + spaces(padLen(blen(head), 9));
  const { d } = dFragment(MIDI, settingsFor(1));
  const parts = { mem, svg, pageHtml, d };

  const uri = spliceTokenUri(parts);
  assert.equal(uri, naiveTokenUri(parts));

  const dec = decodeTokenUri(uri);
  assert.equal(dec.json.name, name);
  assert.equal(dec.json.description, description);
  assert.ok(dec.svgBytes.equals(bytes(svg)));
  assert.ok(dec.htmlBytes.equals(bytes(pageHtml + d + svg)));
  assert.equal(dec.svg, svg);

  const dir = mkdtempSync(join(tmpdir(), 'beast-consumer-'));
  writeFileSync(join(dir, 'uri.txt'), uri);
  execFileSync(process.execPath, [join(here, 'decode.mjs'), join(dir, 'uri.txt'), join(dir, 'out')]);
  assert.ok(readFileSync(join(dir, 'out', 'image.svg')).equals(bytes(svg)));
  assert.ok(readFileSync(join(dir, 'out', 'animation.html')).equals(bytes(pageHtml + d + svg)));
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'out', 'token.json'), 'utf8')), dec.json);
});

test('invalid UTF-8 in the JSON layer throws', () => {
  // Otherwise well-formed token JSON whose name contains a lone 0xFF byte.
  const json = Buffer.concat([
    Buffer.from('{"name":"'), Buffer.from([0xff]),
    Buffer.from('","image":"data:image/svg+xml;base64,PHN2Zy8+","animation_url":"data:text/html;base64,PHAvPg=="}'),
  ]);
  assert.throws(
    () => decodeTokenUri('data:application/json;base64,' + json.toString('base64')),
    { code: 'ERR_ENCODING_INVALID_ENCODED_DATA' },
  );
});
