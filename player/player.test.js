// @ts-check
// Node tests for the page's player (player/player.js): the MIDI checks as a module, and the real
// page's scripts (the gunzip shim and the minified player in tests/fixtures/page.html, byte for
// byte) run in node:vm against a fake DOM: the shim inflates the real engine from the page's gzip
// payload, then the player runs with a recording fake engine or with that real engine. Includes the
// D9 failure paths of the gzip payload (corrupt, truncated, missing, no engine after inflation).
//
// Run: node --test "player/**/*.test.js" "scripts/**/*.test.mjs"   (or npm test)

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import vm from "node:vm";
import { gzipSync } from "node:zlib";
import { ENGINE_MISSING, PLAY_ICON, STOP_ICON, artUrl, checkMidi, decodeMidi } from "./player.js";
import { ENGINE_SHA256, engineSource } from "../scripts/engine.mjs";
import { runPage } from "../scripts/page_harness.mjs";
import { webAudioMock } from "../scripts/webaudio_mock.mjs";
import {
  ART_OPEN, GZIP_CLOSE, GZIP_OPEN, MIDI_OPEN, SETTINGS_OPEN, SHIM_PIN, pageHtml, pageScripts, sha256, withGzipPayload,
} from "../scripts/page.mjs";
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

describe("the page", () => {
  test("PAGE: ▶ starts disabled in the markup; the icon is ▶; the player is the built script", () => {
    const button = PAGE.match(/<button id="play"[^>]*>/);
    assert.ok(button && / disabled>$/.test(button[0]), "disabled attribute");
    assert.ok(PAGE.includes(`<path id="icon" d="${PLAY_ICON}"/>`));
    assert.ok(PAGE.endsWith(SETTINGS_OPEN + " ".repeat(fixtures.page.page_pad)));
    const { shim, player } = pageScripts(PAGE);
    for (const js of [shim, player]) {
      assert.ok(!/\b(?:eval|Function|fetch|XMLHttpRequest|localStorage|sessionStorage|indexedDB|cookie|import)\b/.test(js), "no eval, network, storage or modules");
    }
  });

  test("PAGE: the engine gzipped in <head>, then the shim, then (in <body>) the player; the hashes match", () => {
    const { engineGzip, engine, shim, player } = pageScripts(PAGE);
    assert.equal(engine, engineSource(), "the payload inflates to the pinned engine, byte for byte");
    assert.equal(sha256(engine), ENGINE_SHA256);
    assert.equal(sha256(engineGzip), fixtures.page.gzip_sha256);
    assert.equal(engineGzip.length, fixtures.page.gzip_len);
    assert.deepEqual([...engineGzip.subarray(0, 10)], [31, 139, 8, 0, 0, 0, 0, 0, 2, 3], "gzip header: no flags, no timestamp, level 9, Unix");
    assert.equal(sha256(shim), SHIM_PIN.sha256, "the pinned shim");
    assert.equal(sha256(shim), fixtures.page.shim_sha256);
    const at = (/** @type {string} */ s) => PAGE.indexOf(s);
    assert.ok(at(GZIP_OPEN) < at(`<script>${shim}</script>`) && at(`<script>${shim}</script>`) < at("</head><body>"), "gzip tag, then the shim, in <head>");
    assert.ok(at("</head><body>") < at(`<script>${player}</script>`), "the player in <body>, not compressed");
    // Base64 has no `<`, `"` or `&`: the payload cannot end its tag or its attribute.
    const payload = PAGE.slice(at(GZIP_OPEN) + GZIP_OPEN.length, at(GZIP_CLOSE));
    assert.match(payload, /^[A-Za-z0-9+/]+=*$/);
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
      // The shim inserts the inflated engine before the player registers its DOMContentLoaded
      // listener; then the art block is read and shown before the settings and MIDI blocks.
      const order = h.page.events.map((e) => (e[0] === "read" ? e[1] : e[0]));
      assert.deepEqual(order, ["script", "listen", "art", "src", "prepend", "settings", "midi"]);
      assert.equal(h.els.play.disabled, false);
      assert.equal(h.els.error.hidden, true);
      assert.deepEqual(h.calls, []);
      assert.deepEqual(h.consoleErrors, []);
      assert.deepEqual(h.uncaught, []);
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
    const before = h.calls.length;
    h.click(); // ■
    const stop = h.calls.slice(before);
    assert.deepEqual(stop[0], ["stopMIDI"]);
    for (let ch = 0; ch < 16; ch++) {
      // A fresh volume node into the channel's panner, the old one (and every voice on it) cut off,
      // and the pending modulation and pan changes dropped.
      assert.deepEqual(stop.slice(1 + 4 * ch, 5 + 4 * ch), [["connect", `chpan${ch}`], ["disconnect", "chvol", ch], ["cancel", "chmod", ch, 1.5], ["cancel", "chpan", ch, 1.5]]);
    }
    assert.equal(stop.length, 1 + 4 * 16);
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
    ["settings with a non-canonical token", edited(base, { settings: "1,01,30,40,64,0,0" }), "settings: malformed: token 1"],
    ["empty settings", edited(base, { settings: "  " }), "settings: malformed: token 0"],
    ["settings of another format version", edited(base, { settings: "2,1,30,40,64,0,0" }), "settings: malformed: token 1"],
    ["truncated settings", edited(base, { settings: "1,1,30,40,64,0" }), "settings: malformed: token 6"],
    ["settings with a trailing token", edited(base, { settings: "1,1,30,40,64,0,0,0" }), "settings: malformed: token 7"],
    ["settings with a count over its cap", edited(base, { settings: "1,1,30,40,64,0,33" }), "settings: TS: too many timbres"],
    ["settings with an unknown wave tag",
      edited(base, { settings: "1,1,30,40,64,0,1,0,0,1,0,7,5000,10000,0,0,100,100,0,500,10000,10000,0,0" }),
      "settings: malformed: token 12"],
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

  test("range checks are Cairo's: settings that only break a range rule (quality 2) are played", async () => {
    // The class never writes such SETTINGS (settings::validate reverts); the page only parses.
    const h = runPage(edited(base, { settings: "1,2,30,40,64,0,1,0,0,1,0,0,1000001,10000,0,0,100,100,0,500,10000,10000,0,0" }));
    h.ready();
    assert.equal(h.els.play.disabled, false);
    assert.deepEqual(h.consoleErrors, []);
    h.click();
    assert.deepEqual(h.calls[0], ["new", { quality: 2, useReverb: 1, voices: 64 }]);
  });

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

describe("the page's gunzip shim and the engine (D9: the art and the error still show)", () => {
  const base = CASES.beast_140bpm;
  const html = htmlOf(base);
  const artSrc = "data:image/svg+xml;base64," + Buffer.from(base.svg).toString("base64");
  /** The page with the payload's bytes edited. */
  const editBytes = (/** @type {(b: Buffer) => Buffer} */ f) => withGzipPayload(html, (p) => f(Buffer.from(p, "base64")).toString("base64"));
  /** The page with a gzip payload of `js` (made with Node's zlib: any valid gzip must inflate). */
  const withScript = (/** @type {string} */ js) => withGzipPayload(html, () => gzipSync(js).toString("base64"));

  test("the shim inflates the engine and runs it before the player script runs", () => {
    const h = runPage(html);
    // One inline script replaced the gzip tag: the engine, byte for byte.
    assert.equal(h.page.head.length, 1);
    const [inline] = h.page.head;
    assert.equal(inline.tag, "script");
    assert.deepEqual(inline.attributes, {}, "an inline script: no type, no src");
    assert.equal(inline._text, engineSource());
    assert.equal(h.engineLoaded, true);
    assert.deepEqual(h.page.events.slice(0, 2), [["script", engineSource().length], ["listen", "DOMContentLoaded"]]);
    assert.deepEqual(h.consoleErrors, []);
    assert.deepEqual(h.uncaught, []);
  });

  test("a corrupt gzip tag is logged and left in place; the next one still inflates", () => {
    const corrupt = GZIP_OPEN + Buffer.from("not gzip").toString("base64") + GZIP_CLOSE;
    const h = runPage(html.replace(GZIP_OPEN, corrupt + GZIP_OPEN));
    assert.equal(h.page.head.length, 2);
    assert.equal(h.page.head[0].attributes.type, "text/javascript+gzip", "the corrupt tag stays");
    assert.equal(h.page.head[1]._text, engineSource());
    assert.deepEqual(h.consoleErrors, ["gunzip: invalid gzip data"]);
    h.ready();
    assert.equal(h.els.play.disabled, false);
  });

  /** @type {Array<[string, string, string[], string[]]>} [label, html, console errors before the player's, uncaught] */
  const failures = [
    ["a corrupt payload (one byte changed mid-stream)", editBytes((b) => { const c = Buffer.from(b); c[c.length >> 1] ^= 0x55; return c; }), ["gunzip:"], []],
    ["a truncated payload", editBytes((b) => b.subarray(0, b.length >> 1)), ["gunzip:"], []],
    ["a payload with a wrong CRC-32", editBytes((b) => { const c = Buffer.from(b); c[c.length - 8] ^= 1; return c; }), ["gunzip: CRC-32 or length mismatch"], []],
    ["a payload that is not gzip", withGzipPayload(html, () => Buffer.from("plain text").toString("base64")), ["gunzip: invalid gzip data"], []],
    ["a payload that is not base64", withGzipPayload(html, () => "@@@@"), [""], []],
    ["no gzip tag", withGzipPayload(html, () => null), [], []],
    ["a payload that defines no engine", withScript("/* not TinySynth */"), [], []],
    ["a payload whose script throws", withScript("throw new Error('engine failed')"), [], ["engine failed"]],
  ];
  for (const [label, page, before, uncaught] of failures) {
    test(`D9, ${label}: art shown, ▶ disabled, "${ENGINE_MISSING}" shown and logged, no synth`, () => {
      const h = runPage(page);
      assert.equal(h.engineLoaded, false);
      assert.deepEqual(h.uncaught, uncaught);
      h.ready();
      assert.equal(h.art()?.src, artSrc, "art rendered");
      assert.equal(h.els.play.disabled, true);
      assert.equal(h.els.play.title, ENGINE_MISSING);
      assert.equal(h.els.error.textContent, ENGINE_MISSING);
      assert.equal(h.els.error.hidden, false);
      assert.equal(h.consoleErrors.length, before.length + 1);
      before.forEach((prefix, i) => assert.ok(h.consoleErrors[i].startsWith(prefix), `shim logged ${JSON.stringify(h.consoleErrors[i])}`));
      assert.equal(h.consoleErrors.at(-1), ENGINE_MISSING);
      h.click();
      assert.deepEqual(h.calls, [], "no synth constructed");
      assert.equal(h.timers.size, 0);
    });
  }
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

  test("a leading rest is kept when the only event is at End-of-Track's tick", async () => {
    // A drum hit at tick 96 (0.5 s), then End-of-Track at the same tick: a 0.5 s loop.
    const midi = smf({ ppq: 96, tracks: [[[96, 0x99, 36, 100], [0, 0xff, 0x2f, 0]]] });
    const h = runPage(edited(CASES.default_120bpm, { midi: midi.toString("base64") }), { engine: "real", outputLatency: 0 });
    h.ready();
    h.click();
    const tick0 = h.synths[0].getAudioContext().currentTime + 0.1;
    await h.flush();
    h.advance(1.8);
    /** @type {number[]} */
    const hits = h.synths[0].sent.filter((/** @type {any} */ [m]) => m[0] === 0x99).map((/** @type {any} */ x) => x[1] - tick0);
    assert.ok(hits.length >= 3);
    hits.slice(0, 3).forEach((t, i) => assert.ok(Math.abs(t - 0.5 * (i + 1)) < 1e-9, `hit ${i} at ${t} s, expected ${0.5 * (i + 1)} s`));
  });

  test("■ cuts off drum voices and notes scheduled ahead, and the controller changes TinySynth had scheduled", async () => {
    // PPQ 100 at 120 BPM: CC7 100, a note and a drum hit at tick 0; a drum hit and CC7 0 at tick
    // 50 (0.25 s); End-of-Track at 200.
    const midi = smf({ ppq: 100, tracks: [[[0, 0xb0, 7, 100], [0, 0x90, 60, 100], [0, 0x99, 36, 100], [50, 0x99, 38, 100], [0, 0xb0, 7, 0], [100, 0x80, 60, 0], [50, 0xff, 0x2f, 0]]] });
    const h = runPage(edited(CASES.beast_140bpm, { midi: midi.toString("base64") }), { engine: "real", outputLatency: 0 });
    h.ready();
    h.click();
    await h.flush();
    const synth = h.synths[0];
    const log = h.audio.log;
    h.advance(0.18); // the hit at 0.35 s (0.1 s offset) is scheduled 0.2 s ahead, the mute too
    const old = synth.chvol.map((/** @type {any} */ n) => n.name);
    const drumGains = log.filter((/** @type {any[]} */ c) => c[1] === "connect" && c[2] === old[9]).map((/** @type {any[]} */ c) => c[0]);
    assert.equal(drumGains.length, 4, "both drum hits (2 operators each) feed channel 10's volume node");
    const mute = log.find((/** @type {any[]} */ c) => c[0] === `${old[0]}.gain` && c[1] === "set" && c[2] === 0);
    assert.ok(mute && mute[3] > synth.getAudioContext().currentTime, "a future mute is pending");
    const from = log.length;
    h.click(); // ■
    const after = log.slice(from);
    for (let ch = 0; ch < 16; ch++) {
      assert.ok(after.some((/** @type {any[]} */ c) => c[0] === old[ch] && c[1] === "disconnect"), `channel ${ch}: old volume node cut off`);
      assert.notEqual(synth.chvol[ch].name, old[ch]);
      assert.ok(after.some((/** @type {any[]} */ c) => c[0] === synth.chvol[ch].name && c[1] === "connect" && c[2] === synth.chpan[ch].name), `channel ${ch}: new node to the panner`);
    }
    // The next ▶ plays through the new nodes.
    h.click();
    await h.flush();
    h.advance(0.2);
    assert.ok(log.slice(from).some((/** @type {any[]} */ c) => c[1] === "connect" && c[2] === synth.chvol[9].name), "new drum voices use the new node");
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

  test("a song with no events other than tempo: ▶ plays nothing and shows no error, the art restarts, ■ and ▶ still work", async () => {
    // checkMidi accepts it (a valid file with a loop of at least 50 ms). The engine (fork #9) leaves
    // such a song stopped: playMIDI returns without setting playTime, so there is no tick 0 to time
    // the art restart to, and the restart is not delayed (setTimeout takes the NaN delay as 0).
    const songs = {
      "End-of-Track only": smf({ ppq: 96, tracks: [[[192, 0xff, 0x2f, 0]]] }),
      "tempo only": smf({ ppq: 96, tracks: [[[0, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20], [192, 0xff, 0x2f, 0]]] }),
    };
    for (const [label, midi] of Object.entries(songs)) {
      const h = runPage(edited(CASES.default_120bpm, { midi: midi.toString("base64") }), { engine: "real", outputLatency: 0 });
      h.ready();
      for (const press of [1, 2]) {
        h.click(); // ▶
        await h.flush();
        const synth = h.synths[0];
        assert.equal(synth.playing, 0, `${label}, ▶ ${press}: the engine stays stopped`);
        assert.equal(h.els.icon.attributes.d, STOP_ICON, `${label}, ▶ ${press}: the toggle shows ■`);
        assert.equal(h.timers.size, 1, `${label}, ▶ ${press}: an art restart is scheduled`);
        h.runTimers();
        h.loadImages();
        assert.equal(h.art()?.src, artUrl(CASES.default_120bpm.svg, press), `${label}, ▶ ${press}: the art restarted`);
        h.advance(1);
        assert.deepEqual(synth.sent, [], `${label}, ▶ ${press}: nothing scheduled`);
        h.click(); // ■
        assert.equal(h.els.icon.attributes.d, PLAY_ICON);
      }
      assert.equal(h.els.error.hidden, true, `${label}: no error shown`);
      assert.deepEqual(h.consoleErrors, [], `${label}: nothing logged`);
      assert.deepEqual(h.uncaught, []);
    }
  });
});
