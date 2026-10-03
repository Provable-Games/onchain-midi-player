// @ts-check
// Node tests for the page's player (player/player.js): the MIDI checks as a module, and the real
// page's player script (the minified <script> in tests/fixtures/page.html, byte for byte) run in
// node:vm against a fake DOM, with a recording fake engine and with the real pinned engine.
//
// Run: node --test "player/**/*.test.js" "scripts/**/*.test.mjs"   (or npm test)

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { PLAY_ICON, STOP_ICON, artUrl, checkMidi, decodeMidi } from "./player.js";
import { runPage } from "../scripts/page_harness.mjs";
import { ART_OPEN, MIDI_OPEN, SETTINGS_OPEN, pageHtml, pageScripts } from "../scripts/page.mjs";
import { riff, smf } from "../scripts/page_fixtures.mjs";

const fixtures = JSON.parse(readFileSync(new URL("../tests/fixtures/page.json", import.meta.url), "utf8"));
const PAGE = pageHtml();
/** @type {Record<string, any>} */
const CASES = Object.fromEntries(fixtures.valid.map((/** @type {any} */ c) => [c.name, c]));

/** The decoded animation_url HTML of a fixture case: PAGE ++ D ++ SVG. */
const htmlOf = (/** @type {any} */ c) => PAGE + c.d + c.svg;

/**
 * A case's HTML with one block's contents replaced, as a copied or edited page could have them.
 * @param {any} c
 * @param {{settings?: string, midi?: string}} blocks
 */
function edited(c, { settings, midi }) {
  let d = c.d;
  if (settings !== undefined) d = settings + d.slice(d.indexOf(MIDI_OPEN));
  if (midi !== undefined) d = d.slice(0, d.indexOf(MIDI_OPEN) + MIDI_OPEN.length) + midi + ART_OPEN;
  return PAGE + d + c.svg;
}

/** Throws unless `fn` throws an Error whose message is exactly `message`. */
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
    ["running status after SysEx", track([0x00, 0x90, 60, 100, 0x00, 0xf0, 0x01, 0xf7, 0x10, 60, 0, ...EOT]), /running status without a channel status/],
    ["2-byte tempo", track([0x00, 0xff, 0x51, 0x02, 0x07, 0xa1, ...note, ...EOT]), /bad tempo/],
    ["tempo 0", track([0x00, 0xff, 0x51, 0x03, 0, 0, 0, ...note, ...EOT]), /bad tempo/],
    ["tempo length as a 2-byte VLQ (80 03)", track([0x00, 0xff, 0x51, 0x80, 0x03, 0x07, 0xa1, 0x20, ...note, ...EOT]), /bad tempo/],
    ["status byte F1", track([0x00, 0xf1, 0x00, ...EOT]), /unexpected status byte/],
    ["status byte FE", track([0x00, 0xfe, ...EOT]), /unexpected status byte/],
    ["data byte above 127", track([0x00, 0x90, 60, 0xc8, ...EOT]), /bad data byte/],
    ["5-byte delta time", track([0x81, 0x81, 0x81, 0x81, 0x01, 0x90, 60, 100, ...EOT]), /bad variable-length number/],
    ["meta length past the track", track([0x00, 0xff, 0x01, 0x7f, 0x41, ...EOT]), /truncated/],
    ["End-of-Track at tick 0", track([0x00, 0x90, 60, 100, ...EOT]), "midi: loop shorter than 50 ms (byte 30)"],
    ["a loop of 192 ticks at 1 us per quarter note", track([0x00, 0xff, 0x51, 0x03, 0, 0, 1, ...note, 0x81, 0x00, 0xff, 0x2f, 0x00]), /loop shorter than 50 ms/],
  ];
  for (const [label, bytes, message] of bad) {
    test(`rejects: ${label}`, () => throwsExactly(() => checkMidi(new Uint8Array(bytes)), message));
  }

  test("format 1: End-of-Track tick is the latest track's; tempo map from every track", () => {
    const f1 = smf({ format: 1, ppq: 100, tracks: [[[0, 0xff, 0x51, 0x03, 0x0f, 0x42, 0x40], [400, 0xff, 0x2f, 0x00]], [[0, 0x90, 60, 100], [300, 0x80, 60, 0], [500, 0xff, 0x2f, 0x00]]] });
    assert.deepEqual(checkMidi(new Uint8Array(f1)), { maxTick: 800, seconds: 8 });
  });
});

describe("the page", () => {
  test("PAGE: ▶ starts disabled in the markup; the icon is ▶; the player is the built script", () => {
    const button = PAGE.match(/<button id="play"[^>]*>/);
    assert.ok(button && / disabled>$/.test(button[0]), "disabled attribute");
    assert.ok(PAGE.includes(`<path id="icon" d="${PLAY_ICON}"/>`));
    assert.ok(PAGE.endsWith(SETTINGS_OPEN + " ".repeat(fixtures.page.page_pad)));
    const { player } = pageScripts(PAGE);
    assert.ok(!/\b(?:eval|Function|fetch|XMLHttpRequest|localStorage|sessionStorage|indexedDB|cookie|import)\b/.test(player), "no eval, network, storage or modules");
  });

  test("artUrl: the canonical data URL, and distinct but equivalent URLs for restarts", () => {
    const svg = CASES.unicode_art.svg;
    assert.equal(artUrl(svg), "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64"));
    assert.equal(artUrl(svg, 3), "data:image/svg+xml;r=3;base64," + Buffer.from(svg).toString("base64"));
  });
});

describe("the page's player script, fake engine", () => {
  for (const c of fixtures.valid) {
    test(`${c.name}: art first, then ▶ enabled; no synth before a click`, () => {
      const h = runPage(htmlOf(c));
      assert.equal(h.els.play.disabled, true, "disabled until DOMContentLoaded");
      assert.equal(h.art(), null);
      h.ready();
      const art = h.art();
      assert.ok(art);
      assert.equal(art.src, "data:image/svg+xml;base64," + Buffer.from(c.svg).toString("base64"));
      // The art block is read and shown before the settings and MIDI blocks are read.
      const order = h.page.events.map((e) => (e[0] === "read" ? e[1] : e[0]));
      assert.deepEqual(order, ["art", "src", "prepend", "settings", "midi"]);
      assert.equal(h.els.play.disabled, false);
      assert.equal(h.els.error.hidden, true);
      assert.deepEqual(h.calls, []);
      assert.deepEqual(h.consoleErrors, []);
    });
  }

  test("▶: synth with the settings, AudioContext resumed in the gesture, MIDI loaded, looped at End-of-Track, art restarted", async () => {
    const c = CASES.beast_140bpm;
    const h = runPage(htmlOf(c), { outputLatency: 0.025 });
    h.ready();
    h.click();
    // Synchronously inside the click: the synth is constructed and installed, and resume() is called.
    assert.deepEqual(h.calls[0], ["new", { quality: 1, useReverb: 0, voices: 64 }]);
    assert.deepEqual(h.calls.slice(1, 5).map((x) => x[0]), ["setQuality", "setMasterVol", "setReverbLev", "setVoices"]);
    assert.equal(h.calls.filter((x) => x[0] === "setTimbre").length, 3);
    assert.deepEqual(h.calls.at(-1), ["resume"]);
    assert.equal(h.els.icon.attributes.d, STOP_ICON);
    assert.equal(h.els.play.attributes["aria-label"], "Stop");
    await h.flush();
    const after = h.calls.slice(h.calls.findIndex((x) => x[0] === "resume") + 1);
    assert.deepEqual(after.map((x) => x[0]), ["loadMIDI", "setLoop", "setLoopEnd", "playMIDI"]);
    assert.deepEqual(Buffer.from(after[0][1]), Buffer.from(c.midi_b64, "base64"));
    assert.deepEqual(after[1], ["setLoop", 1]);
    assert.deepEqual(after[2], ["setLoopEnd", 4242], "setLoopEnd(synth.maxTick) after loadMIDI");
    // The art restarts after playTime - currentTime (0.1 s) plus the output latency.
    assert.equal(h.timers.size, 1);
    assert.ok(Math.abs([...h.timers.values()][0].delay - 125) < 1e-9);
    const before = h.art();
    h.runTimers();
    assert.equal(h.art(), before, "the old art stays until the new one has loaded");
    h.loadImages();
    const art = h.art();
    assert.notEqual(art, before);
    assert.equal(art?.src, "data:image/svg+xml;r=1;base64," + Buffer.from(c.svg).toString("base64"));
    assert.equal(h.page.body.filter((e) => e.tag === "img").length, 1);
    assert.deepEqual(h.consoleErrors, []);
  });

  test("toggle: ■ stops and cancels a pending art restart; ▶ again restarts from the top with the same synth", async () => {
    const h = runPage(htmlOf(CASES.default_120bpm));
    h.ready();
    h.click();
    await h.flush();
    assert.equal(h.timers.size, 1);
    h.click(); // ■
    assert.deepEqual(h.calls.at(-1), ["stopMIDI"]);
    assert.equal(h.timers.size, 0, "pending art restart cancelled");
    assert.equal(h.els.icon.attributes.d, PLAY_ICON);
    assert.equal(h.els.play.attributes["aria-label"], "Play");
    const n = h.calls.length;
    h.click(); // ▶
    await h.flush();
    assert.deepEqual(h.calls.slice(n).map((x) => x[0]), ["resume", "loadMIDI", "setLoop", "setLoopEnd", "playMIDI"]);
    assert.equal(h.calls.filter((x) => x[0] === "new").length, 1, "one synth for the page's lifetime");
    h.runTimers();
    h.loadImages();
    assert.match(h.art()?.src || "", /^data:image\/svg\+xml;r=1;base64,/);
    h.click(); // ■
    h.click(); // ▶
    await h.flush();
    h.runTimers();
    h.loadImages();
    assert.match(h.art()?.src || "", /^data:image\/svg\+xml;r=2;base64,/, "every restart gets a new URL");
  });

  test("■ while the restarted art is still decoding: the art is not swapped; a stale decode never wins", async () => {
    const c = CASES.default_120bpm;
    const h = runPage(htmlOf(c));
    h.ready();
    const first = h.art();
    h.click(); // ▶
    await h.flush();
    h.runTimers(); // the restart image is created and starts decoding
    h.click(); // ■ before it has decoded
    h.loadImages();
    assert.equal(h.art(), first, "stopped: the art is not reset");
    h.click(); // ▶ again
    await h.flush();
    h.runTimers();
    h.loadImages();
    assert.match(h.art()?.src || "", /;r=2;base64,/);
    assert.equal(h.page.body.filter((e) => e.tag === "img").length, 1);
  });

  test("▶ then ■ before the AudioContext has resumed: nothing starts", async () => {
    const h = runPage(htmlOf(CASES.default_120bpm));
    h.ready();
    h.click();
    h.click();
    await h.flush();
    assert.deepEqual(h.calls.filter((x) => ["loadMIDI", "playMIDI"].includes(x[0])), []);
    assert.equal(h.timers.size, 0);
  });

  const base = CASES.beast_140bpm;
  /** @type {Array<[string, string, string]>} [label, edited html, exact error] */
  const failures = [
    ["settings that fail validation (quality 2)", edited(base, { settings: " 1,2,30,40,64,0,0" }), "settings: TS: quality out of range"],
    ["settings with an operator error carry its indices",
      edited(base, { settings: "1,1,30,40,64,0,1,0,0,1,0,0,1000001,10000,0,0,100,100,0,500,10000,10000,0,0" }),
      "settings: TS: volume out of range (0, 0)"],
    ["settings that do not parse (non-canonical token)", edited(base, { settings: "1,01,30,40,64,0,0" }), "settings: malformed: token 1"],
    ["empty settings", edited(base, { settings: "  " }), "settings: malformed: token 0"],
    ["MIDI that is not base64", edited(base, { midi: "!!!not base64!!!" }), "midi: not base64"],
    ["MIDI cut after its header", edited(base, { midi: Buffer.from(base.midi_b64, "base64").subarray(0, 14).toString("base64") }), "midi: truncated (byte 14)"],
    ["MIDI ending at tick 0", edited(base, { midi: smf({ ppq: 96, tracks: [[[0, 0x90, 60, 100], [0, 0xff, 0x2f, 0]]] }).toString("base64") }), "midi: loop shorter than 50 ms (byte 30)"],
  ];
  for (const [label, html, message] of failures) {
    test(`D9, ${label}: art shown, ▶ disabled, exact error shown and logged, no synth`, () => {
      const h = runPage(html);
      h.ready();
      assert.equal(h.art()?.src, "data:image/svg+xml;base64," + Buffer.from(base.svg).toString("base64"), "art rendered");
      assert.equal(h.els.play.disabled, true);
      assert.equal(h.els.play.title, message);
      assert.equal(h.els.error.textContent, message);
      assert.equal(h.els.error.hidden, false);
      assert.deepEqual(h.consoleErrors, [message]);
      h.click();
      assert.deepEqual(h.calls, [], "no synth constructed");
      assert.equal(h.timers.size, 0);
    });
  }

  test("an unreadable art block is logged and does not block settings and MIDI", () => {
    const h = runPage(htmlOf(base));
    Object.defineProperty(h.els.art, "textContent", { get() { throw new Error("art unreadable"); } });
    h.ready();
    assert.equal(h.art(), null);
    assert.deepEqual(h.consoleErrors, ["art unreadable"]);
    assert.equal(h.els.play.disabled, false);
  });

  test("a synth that cannot be created fails closed on ▶", () => {
    const h = runPage(htmlOf(base), { constructError: "no WebAudio" });
    h.ready();
    h.click();
    assert.equal(h.synths.length, 0);
    assert.equal(h.els.play.disabled, true);
    assert.equal(h.els.play.title, "no WebAudio");
    assert.equal(h.els.error.textContent, "no WebAudio");
    assert.deepEqual(h.consoleErrors, ["no WebAudio"]);
    assert.equal(h.timers.size, 0);
  });

  test("an AudioContext that will not resume fails closed and shows ▶ again", async () => {
    const h = runPage(htmlOf(base), { resumeError: "resume refused" });
    h.ready();
    h.click();
    await h.flush();
    assert.deepEqual(h.calls.filter((x) => ["loadMIDI", "playMIDI"].includes(x[0])), []);
    assert.equal(h.els.play.disabled, true);
    assert.equal(h.els.error.textContent, "resume refused");
    assert.equal(h.els.icon.attributes.d, PLAY_ICON);
    assert.deepEqual(h.consoleErrors, ["resume refused"]);
  });
});

describe("the page's player script, real engine", () => {
  for (const name of ["beast_140bpm", "six_timbres_format1", "slot_edges"]) {
    test(`${name}: plays from tick 0, loops every maxTick x tick2Time, ■ stops`, async () => {
      const c = CASES[name];
      const h = runPage(htmlOf(c), { engine: "real", outputLatency: 0.02 });
      h.ready();
      h.click();
      await h.flush();
      const synth = h.synths[0];
      const ctx = synth.getAudioContext();
      assert.equal(synth.loop, 1);
      assert.equal(synth.maxTick, c.midi_max_tick);
      assert.equal(synth.loopEnd, c.midi_max_tick, "setLoopEnd(maxTick)");
      assert.deepEqual(h.calls.filter((x) => x[0] !== "new").map((x) => x[0]), ["loadMIDI", "setLoop", "setLoopEnd", "playMIDI"]);
      // Art restart delay: TinySynth's scheduling offset plus the output latency.
      const delay = [...h.timers.values()][0].delay;
      assert.ok(Math.abs(delay - (0.1 + 0.02) * 1000) < 1e-6, `art restart after ${delay} ms`);
      const start = ctx.currentTime + 0.1;
      h.advance(3 * c.midi_loop_seconds + 0.5);
      // The first note-on (lead, note 72, channel 1) of every pass.
      const firsts = synth.sent.filter((/** @type {any} */ [m]) => m[0] === 0x90 && m[1] === 72 && m[2] > 0).map((/** @type {any} */ x) => x[1]);
      const passStarts = firsts.filter((/** @type {number} */ t, /** @type {number} */ i) => i === 0 || t - firsts[i - 1] > c.midi_loop_seconds / 2);
      assert.ok(passStarts.length >= 3, `${passStarts.length} passes`);
      assert.ok(Math.abs(passStarts[0] - start) < 1e-9, "the first pass starts at playTime");
      for (let i = 1; i < passStarts.length; i++) {
        const period = passStarts[i] - passStarts[i - 1];
        assert.ok(Math.abs(period - c.midi_loop_seconds) < 1e-9, `pass ${i}: ${period} s, expected ${c.midi_loop_seconds} s`);
        assert.ok(Math.abs(period - synth.maxTick * synth.tick2Time) < 1e-9, "maxTick x tick2Time");
      }
      h.click(); // ■
      assert.equal(synth.playing, 0);
      const sent = synth.sent.length;
      h.advance(1);
      assert.equal(synth.sent.length, sent, "nothing scheduled after ■");
    });
  }

  test("a leading rest is kept: the first note sounds after it, the art restarts at tick 0", async () => {
    // PPQ 96, 120 BPM by default: a note at tick 96 (0.5 s) and End-of-Track at tick 192 (1 s).
    const midi = smf({ ppq: 96, tracks: [[[96, 0x90, 60, 100], [48, 0x80, 60, 0], [48, 0xff, 0x2f, 0]]] });
    const c = CASES.default_120bpm;
    const h = runPage(edited(c, { midi: midi.toString("base64") }), { engine: "real", outputLatency: 0 });
    h.ready();
    h.click();
    const ctx = h.synths[0].getAudioContext();
    const tick0 = ctx.currentTime + 0.1;
    await h.flush();
    assert.ok(Math.abs([...h.timers.values()][0].delay - 100) < 1e-6, "art restart at tick 0 (+100 ms)");
    h.advance(2.5);
    const ons = h.synths[0].sent.filter((/** @type {any} */ [m]) => m[0] === 0x90 && m[2] > 0).map((/** @type {any} */ x) => x[1]);
    assert.ok(ons.length >= 2);
    assert.ok(Math.abs(ons[0] - (tick0 + 0.5)) < 1e-9, `first note at ${ons[0] - tick0} s after tick 0`);
    assert.ok(Math.abs(ons[1] - (tick0 + 1.5)) < 1e-9, "the next pass keeps the rest too");
  });

  test("the custom timbres are installed in the real engine", async () => {
    const h = runPage(htmlOf(CASES.beast_140bpm), { engine: "real" });
    h.ready();
    h.click();
    const synth = h.synths[0];
    assert.equal(synth.program[0].p.length, 2);
    assert.equal(synth.program[0].p[1].f, 6, "lead LFO at 6 Hz");
    assert.equal(synth.drummap[36 - 35].p[0].p, 0.2813, "kick pitch drop");
    assert.equal(synth.useReverb, 0, "reverb 0: no convolver");
  });
});
