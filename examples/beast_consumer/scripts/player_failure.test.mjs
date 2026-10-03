// Failure paths of the mock page's player, without a browser: the page's own player script runs in
// node:vm against a minimal fake DOM. The art must render first and independently; a settings or
// MIDI error must leave Play disabled, show the error and construct no synth (spec D9).
//
// Run from examples/beast_consumer:  node --test "scripts/**/*.test.mjs"

import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { MIDI, PLAYER_JS, page } from './reference.mjs';

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="250" height="350"><rect width="9" height="9"/></svg>';

/** Runs PLAYER_JS on a fake document holding the given blocks; returns what the page shows. */
function runPlayer({ settings = '   1,1,100,40,64,0,0', midi = MIDI.toString('base64'), art = SVG } = {}) {
  const el = (text = '') => ({ textContent: text, src: '', disabled: false, onclick: null });
  const elements = {
    settings: el(settings), midi: el(midi), view: el(), play: el(), status: el(),
    // art: null makes reading the art block throw.
    art: art === null ? { get textContent() { throw new Error('art unreadable'); } } : el(art),
    'settings-out': el(), 'midi-out': el(),
  };
  let onReady = null;
  const constructed = [];
  const consoleErrors = [];
  const sandbox = {
    document: {
      getElementById: (id) => elements[id],
      addEventListener: (type, fn) => { if (type === 'DOMContentLoaded') onReady = fn; },
    },
    WebAudioTinySynth: function (opts) {
      constructed.push(opts);
      Object.assign(this, { opts, calls: [], timbres: [] });
      this.setQuality = this.setMasterVol = this.setReverbLev = this.setVoices = () => {};
      this.setTimbre = (d, s, ops) => this.timbres.push({ d, s, ops });
      this.loadMIDI = this.playMIDI = () => {};
    },
    atob, btoa, TextEncoder,
    console: { error: (e) => consoleErrors.push(String(e && e.message || e)) },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(PLAYER_JS, sandbox);
  assert.ok(onReady, 'player waits for DOMContentLoaded');
  onReady();
  return { elements, state: sandbox.__player, constructed, consoleErrors };
}

const artSrc = 'data:image/svg+xml;base64,' + Buffer.from(SVG).toString('base64');

test('the page embeds exactly the tested player script', () => {
  assert.ok(page().includes(PLAYER_JS));
  assert.ok(page().includes('<button id="play" disabled>'), 'Play starts disabled in the HTML');
});

test('valid blocks: art shown, Play enabled and working', () => {
  const { elements, state, constructed } = runPlayer();
  assert.equal(elements.view.src, artSrc);
  assert.equal(elements.play.disabled, false);
  assert.equal(state.ready, true);
  assert.equal(state.error, undefined);
  assert.equal(constructed.length, 0, 'no synth before Play');
  elements.play.onclick();
  assert.equal(JSON.stringify(constructed), '[{"quality":1,"useReverb":1,"voices":64}]');
  assert.equal(state.played, true);
});

const failures = [
  ['settings that fail validation (quality 2)', { settings: '1,2,30,40,64,0,0' }, 'settings: TS: quality out of range', 'TS: quality out of range'],
  ['settings with an operator error carry its indices', {
    settings: '1,1,30,40,64,0,1,0,0,1,0,0,1000001,10000,0,0,100,100,0,500,10000,10000,0,0',
  }, 'settings: TS: volume out of range (0, 0)', 'TS: volume out of range'],
  ['settings that fail parsing (non-canonical token)', { settings: '1,01,30,40,64,0,0' }, 'settings: malformed: token 1', 'malformed'],
  ['MIDI that is not base64', { midi: '!!!not base64!!!' }, null, undefined],
  ['MIDI truncated after its header', { midi: MIDI.subarray(0, 14).toString('base64') }, 'missing MTrk', undefined],
];
for (const [label, blocks, message, code] of failures) {
  test(`${label}: art shown, Play disabled, error shown, no synth`, () => {
    const { elements, state, constructed, consoleErrors } = runPlayer(blocks);
    assert.equal(elements.view.src, artSrc, 'art rendered');
    assert.equal(elements.play.disabled, true, 'Play disabled');
    assert.equal(elements.play.onclick, null, 'no Play handler');
    assert.equal(state.ready, false);
    assert.ok(state.error, 'state.error set');
    if (message) assert.equal(state.error, message);
    assert.equal(elements.status.textContent, 'Error: ' + state.error);
    assert.equal(state.errorCode, code);
    assert.equal(constructed.length, 0, 'no synth constructed');
    assert.equal(JSON.stringify(consoleErrors), JSON.stringify([state.error]));
  });
}

test('an art failure is recorded and does not block settings and MIDI', () => {
  const { elements, state, consoleErrors } = runPlayer({ art: null });
  assert.equal(elements.view.src, '');
  assert.equal(state.artError, 'art unreadable');
  assert.equal(state.ready, true);
  assert.equal(state.error, undefined);
  assert.equal(elements.play.disabled, false);
  assert.equal(JSON.stringify(consoleErrors), '["art unreadable"]');
});
