// @ts-check
import vm from "node:vm";
import { webAudioMock } from "../scripts/webaudio_mock.mjs";
import { engineSource } from "../scripts/engine.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { checkMidi, decodeMidi } from "./player.js";
import { riff, smf } from "../scripts/data_cases.mjs";
const fixtures = JSON.parse(readFileSync(new URL("../tests/fixtures/data.json", import.meta.url), "utf8"));
function throwsExactly(/** @type {() => unknown} */ fn, /** @type {string | RegExp} */ message) {
  assert.throws(fn, (e) => {
    assert.ok(e instanceof Error);
    if (typeof message === "string") assert.equal(e.message, message);
    else assert.match(e.message, message);
    return true;
  });
}

describe("decodeMidi and checkMidi", () => {
  for (const c of fixtures.valid) {
    test(`fixture ${c.name}: accepted, End-of-Track tick ${c.midi_max_tick}`, () => {
      const bytes = decodeMidi(c.midi_b64 + " ".repeat(c.d_pad));
      assert.deepEqual(Buffer.from(bytes), Buffer.from(c.midi_b64, "base64"));
      assert.deepEqual(checkMidi(bytes), { maxTick: c.midi_max_tick, seconds: c.midi_loop_seconds });
    });
  }

  test("trims only U+0020 around the base64; rejects anything that is not strict base64", () => {
    const b64 = riff({ ppq: 96, us: 500000 }).toString("base64");
    assert.ok(decodeMidi(`   ${b64}    `).length > 0);
    for (const bad of [`\n${b64}`, `${b64}\t`, b64.slice(1), b64 + "=", `${b64.slice(0, 8)} ${b64.slice(8)}`, "!!!!", b64.replace(/=+$/, "")]) {
      if (bad === b64) continue;
      throwsExactly(() => decodeMidi(bad), "midi: not base64");
    }
  });

  const ok = riff({ ppq: 96, us: 500000 });
  /** A one-track file around raw track bytes (End-of-Track included by the caller). */
  const track = (/** @type {number[]} */ body, ppq = 96) => Buffer.concat([ok.subarray(0, 12), Buffer.from([ppq >> 8, ppq & 255]), Buffer.from("MTrk"), Buffer.from([0, 0, body.length >> 8, body.length & 255]), Buffer.from(body)]);
  const EOT = [0x00, 0xff, 0x2f, 0x00];
  const note = [0x00, 0x90, 60, 100, 0x60, 0x80, 60, 0];
  /** @type {Array<[string, Buffer, string | RegExp]>} */
  const bad = [
    ["not MThd", Buffer.concat([Buffer.from("RIFF"), ok.subarray(4)]), "midi: not a Standard MIDI File (byte 4)"],
    ["header length 7", Buffer.concat([ok.subarray(0, 7), Buffer.from([7]), ok.subarray(8)]), /not a Standard MIDI File/],
    ["format 2", Buffer.concat([ok.subarray(0, 9), Buffer.from([2]), ok.subarray(10)]), "midi: format 2 is not supported (byte 14)"],
    ["format 0 with 2 tracks", Buffer.concat([ok.subarray(0, 11), Buffer.from([2]), ok.subarray(12)]), /bad track count/],
    ["no tracks", Buffer.concat([ok.subarray(0, 11), Buffer.from([0]), ok.subarray(12)]), /bad track count/],
    ["SMPTE division", Buffer.concat([ok.subarray(0, 12), Buffer.from([0xe7, 0x28]), ok.subarray(14)]), /SMPTE or zero time division/],
    ["zero division", track([...note, ...EOT], 0), /SMPTE or zero time division/],
    ["missing MTrk", Buffer.concat([ok.subarray(0, 14), Buffer.from("MTrx"), ok.subarray(18)]), /expected MTrk/],
    ["MTrk length past the end", Buffer.concat([ok.subarray(0, 20), Buffer.from([0xff, 0xff]), ok.subarray(22)]), /MTrk length past the end/],
    ["no End-of-Track", track(note), /truncated/],
    ["bytes after End-of-Track in the track", track([...note, ...EOT, 0x00]), /End-of-Track is not at the end of its track/],
    ["End-of-Track with data", track([...note, 0x00, 0xff, 0x2f, 0x01, 0x00]), /End-of-Track is not at the end/],
    ["trailing bytes after the last track", Buffer.concat([track([...note, ...EOT]), Buffer.from([0])]), /trailing bytes/],
    ["running status at the start of a track", track([0x00, 60, 100, ...EOT]), /running status without a channel status/],
    ["running status after a meta event", track([0x00, 0x90, 60, 100, 0x00, 0xff, 0x01, 0x01, 0x41, 0x10, 60, 0, ...EOT]), /running status without a channel status/],
    ["an F7 escape event", track([0x00, 0xf7, 0x03, 0x90, 0x3c, 0x64, ...note, ...EOT]), /F7\) events are not supported/],
    ["SysEx split over two events", track([0x00, 0xf0, 0x02, 0x7e, 0x7f, 0x00, 0xf7, 0x02, 0x09, 0xf7, ...note, ...EOT]), /SysEx not complete in one event/],
    ["an empty SysEx event", track([0x00, 0xf0, 0x00, ...note, ...EOT]), /SysEx not complete in one event/],
    ["running status after SysEx", track([0x00, 0x90, 60, 100, 0x00, 0xf0, 0x01, 0xf7, 0x10, 60, 0, ...EOT]), /running status without a channel status/],
    ["2-byte tempo", track([0x00, 0xff, 0x51, 0x02, 0x07, 0xa1, ...note, ...EOT]), /bad tempo/],
    ["tempo 0", track([0x00, 0xff, 0x51, 0x03, 0, 0, 0, ...note, ...EOT]), /bad tempo/],
    ["tempo length as a 2-byte VLQ (80 03)", track([0x00, 0xff, 0x51, 0x80, 0x03, 0x07, 0xa1, 0x20, ...note, ...EOT]), /bad tempo/],
    ["status byte F1", track([0x00, 0xf1, 0x00, ...EOT]), /unexpected status byte/],
    ["status byte FE", track([0x00, 0xfe, ...EOT]), /unexpected status byte/],
    ["data byte above 127", track([0x00, 0x90, 60, 0xc8, ...EOT]), /bad data byte/],
    ["5-byte delta time", track([0x81, 0x81, 0x81, 0x81, 0x01, 0x90, 60, 100, ...EOT]), /bad variable-length number/],
    ["a 4097-byte text event", track([0x00, 0xff, 0x01, 0xa0, 0x01, ...Array(4097).fill(0x41), ...note, ...EOT]), /text event longer than 4096 bytes/],
    ["a 4097-byte track name", track([0x00, 0xff, 0x03, 0xa0, 0x01, ...Array(4097).fill(0x41), ...note, ...EOT]), /text event longer than 4096 bytes/],
    ["meta length past the track", track([0x00, 0xff, 0x01, 0x7f, 0x41, ...EOT]), /truncated/],
    ["End-of-Track at tick 0", track([0x00, 0x90, 60, 100, ...EOT]), "midi: loop shorter than 50 ms (byte 30)"],
    ["a loop of 192 ticks at 1 us per quarter note", track([0x00, 0xff, 0x51, 0x03, 0, 0, 1, ...note, 0x81, 0x00, 0xff, 0x2f, 0x00]), /loop shorter than 50 ms/],
  ];
  for (const [label, bytes, message] of bad) {
    test(`rejects: ${label}`, () => throwsExactly(() => checkMidi(new Uint8Array(bytes)), message));
  }

  test("text events up to 4096 bytes are accepted, and other meta events of any length", () => {
    const text = (/** @type {number} */ type, /** @type {number} */ n) => [0x00, 0xff, type, 0x80 | (n >> 7), n & 127, ...Array(n).fill(0x41)];
    const body = [...text(0x01, 4096), ...text(0x7f, 5000), ...note, ...EOT];
    assert.equal(checkMidi(new Uint8Array(track(body))).maxTick, 96);
  });

  test("format 1: End-of-Track tick is the latest track's; tempo map from every track", () => {
    const f1 = smf({ format: 1, ppq: 100, tracks: [[[0, 0xff, 0x51, 0x03, 0x0f, 0x42, 0x40], [400, 0xff, 0x2f, 0x00]], [[0, 0x90, 60, 100], [300, 0x80, 60, 0], [500, 0xff, 0x2f, 0x00]]] });
    assert.deepEqual(checkMidi(new Uint8Array(f1)), { maxTick: 800, seconds: 8 });
  });

  test("whatever checkMidi accepts, the pinned engine's loadMIDI reads without throwing, to the same End-of-Track tick", () => {
    // The engine throws coded SMF_* errors on malformed files (fork #4, #6). checkMidi runs first and
    // is stricter, so a file the page accepts never reaches one of those throws. Checked on the
    // fixtures and accepted vectors, then on seeded random mutations of them.
    const { AudioContext } = webAudioMock();
    const sandbox = { AudioContext, performance: { now: () => 0 }, setInterval: () => 0, clearInterval() {}, console };
    vm.createContext(sandbox);
    vm.runInContext(engineSource(), sandbox);
    const synth = new (/** @type {any} */ (sandbox).WebAudioTinySynth)({ quality: 1, useReverb: 0 });
    const text = (/** @type {number} */ type, /** @type {number} */ n) => [0x00, 0xff, type, 0x80 | (n >> 7), n & 127, ...Array(n).fill(0x41)];
    const seeds = [
      ...fixtures.valid.map((/** @type {any} */ c) => Buffer.from(c.midi_b64, "base64")),
      riff({ ppq: 96, us: 500000, sysex: true }),
      riff({ ppq: 480, us: 600000, format1: true }),
      track([...text(0x01, 300), ...text(0x7f, 200), ...note, ...EOT]),
      smf({ format: 1, ppq: 100, tracks: [[[0, 0xff, 0x51, 0x03, 0x0f, 0x42, 0x40], [400, 0xff, 0x2f, 0x00]], [[0, 0x90, 60, 100], [300, 0x80, 60, 0], [500, 0xff, 0x2f, 0x00]]] }),
    ];
    /** loadMIDI's End-of-Track tick, or the message of the error it throws. */
    const load = (/** @type {Uint8Array} */ u) => {
      try {
        synth.loadMIDI(u);
        return synth.maxTick;
      } catch (e) {
        return String(/** @type {Error} */ (e).message);
      }
    };
    for (const u of seeds) assert.equal(load(new Uint8Array(u)), checkMidi(new Uint8Array(u)).maxTick);
    let seed = 1;
    const rand = (/** @type {number} */ n) => Math.floor(((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32) * n);
    let accepted = 0;
    for (let i = 0; i < 6000; i++) {
      const u = new Uint8Array(seeds[i % seeds.length]);
      for (let k = 1 + rand(3); k--;) {
        const at = rand(u.length);
        u[at] = [rand(256), u[at] ^ (1 << rand(8)), [0x00, 0x7f, 0x80, 0xff, 0x2f, 0x51, 0xf0, 0xf7][rand(8)]][rand(3)];
      }
      let maxTick;
      try {
        maxTick = checkMidi(u).maxTick;
      } catch {
        continue;
      }
      accepted++;
      assert.equal(load(u), maxTick, `mutation ${i}`);
    }
    assert.ok(accepted > 1000, `${accepted} accepted mutations`);
  });
});
