// The real page's player on the example's tokens, without a browser: the page's own player script
// runs in node:vm against a minimal fake DOM (the repository's scripts/page_harness.mjs). The art
// must render first and independently; ▶ installs the token's settings and loops at End-of-Track;
// a settings or MIDI error must leave ▶ disabled, show the error and construct no synth (spec D9).
// The full player tests are in the repository's player/player.test.js.
//
// Run from examples/beast_consumer:  node --test scripts/*.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPage } from '../../../scripts/page_harness.mjs';
import { ART_OPEN, MIDI, MIDI_OPEN, animationHtml, tokenParts } from './reference.mjs';

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
  ['settings that fail validation (quality 2)', { settings: '   1,2,30,40,64,0,0' }, 'settings: TS: quality out of range'],
  ['settings that fail parsing (non-canonical token)', { settings: '1,01,30,40,64,0,0' }, 'settings: malformed: token 1'],
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
