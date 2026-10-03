// The real page's player on the example's tokens, without a browser: the page's own player script
// runs in node:vm against a minimal fake DOM (the repository's scripts/page_harness.mjs). The art
// must render first and independently; ▶ installs the token's settings and loops at End-of-Track;
// a settings parse or MIDI error, or an engine that did not load (a corrupt gzip payload), must leave
// ▶ disabled, show the error and construct no synth (spec D9). Range checks are Cairo's job, not the
// page's.
// The full player tests are in the repository's player/player.test.js.
//
// Run from examples/beast_consumer:  node --test scripts/*.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ENGINE_MISSING } from '../../../player/player.js';
import { runPage } from '../../../scripts/page_harness.mjs';
import { ART_OPEN, MIDI, MIDI_OPEN, animationHtml, tokenParts, withGzipPayload } from './reference.mjs';

const artSrc = (svg) => 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');

for (const id of [1, 2, 3]) {
  test(`token ${id}: art shown, ▶ installs the token's settings and loops at End-of-Track`, async () => {
    const p = tokenParts(id);
    const h = runPage(animationHtml(id), { engine: 'real' });
    h.ready();
    assert.equal(h.art().src, artSrc(p.svg));
    assert.equal(h.els.play.disabled, false);
    h.click();
    await h.flush();
    const synth = h.synths[0];
    assert.deepEqual(h.calls[0], ['new', { quality: 1, useReverb: 1, voices: 64 }]);
    assert.equal(synth.reverbLev, p.settings.reverb / 100);
    assert.equal(synth.program[80].p[1].f, 6, 'chip lead on program 80 (6 Hz LFO)');
    assert.equal(synth.drummap[36 - 35].p[0].p, 0.25, 'custom kick on drum 36');
    assert.equal(synth.loop, 1);
    assert.equal(synth.loopEnd, 192, 'End-of-Track at tick 192');
    assert.deepEqual(h.consoleErrors, []);
  });
}

test('token 4 (a full-size Beast): its SVG shown, ▶ installs the reference sounds and loops at the score\'s End-of-Track', async () => {
  const p = tokenParts(4);
  const h = runPage(animationHtml(4), { engine: 'real' });
  h.ready();
  assert.equal(h.art().src, artSrc(p.svg));
  assert.equal(h.els.play.disabled, false);
  h.click();
  await h.flush();
  const synth = h.synths[0];
  assert.deepEqual(h.calls[0], ['new', { quality: 1, useReverb: 0, voices: 64 }], 'no reverb');
  assert.equal(synth.program[0].p[1].f, 6, 'reference lead on program 0 (6 Hz LFO)');
  assert.equal(synth.drummap[36 - 35].p[0].p, 0.2813, 'reference kick on drum 36 (pitch drop)');
  assert.equal(synth.drummap[38 - 35].p[1].p, 0.55, 'reference snare on drum 38 (square body)');
  assert.equal(synth.loop, 1);
  assert.equal(synth.loopEnd, 58560, 'End-of-Track of the heaviest score');
  assert.deepEqual(h.consoleErrors, []);
});

const svg = tokenParts(1).svg;
const withBlocks = ({ settings, midi }) => {
  let html = animationHtml(1);
  const s = html.lastIndexOf('id="settings">') + 'id="settings">'.length;
  const m = html.indexOf(MIDI_OPEN, s);
  const a = html.indexOf(ART_OPEN, m);
  if (midi !== undefined) html = html.slice(0, m + MIDI_OPEN.length) + midi + html.slice(a);
  if (settings !== undefined) html = html.slice(0, s) + settings + html.slice(m);
  return html;
};
const failures = [
  ['settings that fail parsing (non-canonical token)', { settings: '1,01,30,40,64,0,0' }, 'settings: malformed: token 1'],
  ['settings with a bad count', { settings: '   1,1,30,40,64,17' }, 'settings: TS: too many waves'],
  ['MIDI that is not base64', { midi: '!!!not base64!!!' }, 'midi: not base64'],
  ['MIDI truncated after its header', { midi: MIDI.subarray(0, 14).toString('base64') }, 'midi: truncated (byte 14)'],
];
for (const [label, blocks, message] of failures) {
  test(`${label}: art shown, ▶ disabled, error shown, no synth`, () => {
    const h = runPage(withBlocks(blocks));
    h.ready();
    assert.equal(h.art().src, artSrc(svg), 'art rendered');
    assert.equal(h.els.play.disabled, true);
    assert.equal(h.els.play.title, message);
    assert.equal(h.els.error.textContent, message);
    assert.equal(h.els.error.hidden, false);
    assert.deepEqual(h.consoleErrors, [message]);
    h.click();
    assert.deepEqual(h.calls, [], 'no synth constructed');
  });
}

test('a corrupt gzipped engine: art shown, ▶ disabled, the engine error shown, no synth', () => {
  const html = withGzipPayload(animationHtml(1), (p) => {
    const b = Buffer.from(p, 'base64');
    b[b.length >> 1] ^= 0x55;
    return b.toString('base64');
  });
  const h = runPage(html);
  h.ready();
  assert.equal(h.art().src, artSrc(svg), 'art rendered');
  assert.equal(h.els.play.disabled, true);
  assert.equal(h.els.error.textContent, ENGINE_MISSING);
  assert.equal(h.consoleErrors.length, 2);
  assert.match(h.consoleErrors[0], /^gunzip: /);
  assert.equal(h.consoleErrors[1], ENGINE_MISSING);
  h.click();
  assert.deepEqual(h.calls, [], 'no synth constructed');
});
