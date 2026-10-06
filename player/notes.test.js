// @ts-check
// Node tests for the notes UI (player/notes.js): the MIDI-to-bars conversion (against the player's
// own checkMidi on every fixture), the box mapping, the drawing (playhead, hide clipping, idle and
// playing opacity, drums) on a recording 2D context, mount's defaults, layout and animation with
// stubbed browser globals, the art cutout (with @xmldom/xmldom's DOMParser), and the built script.
//
// Run: node --test "player/**/*.test.js" "scripts/**/*.test.mjs"   (or npm test)

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import vm from "node:vm";
import { DEFAULTS, cutout, drawNotes, midiNotes, mount, screenBox } from "./notes.js";
import { checkMidi } from "./player.js";
import { smf } from "../scripts/page_fixtures.mjs";
import { notesScript } from "../scripts/build_page.mjs";

const fixtures = JSON.parse(readFileSync(new URL("../tests/fixtures/page.json", import.meta.url), "utf8"));

/** A song: 96 ticks per beat, 120 BPM then 60 BPM from tick 192; two melodic channels and drums. */
const SONG = new Uint8Array(smf({
  format: 1, ppq: 96, tracks: [
    [[0, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20], [192, 0xff, 0x51, 0x03, 0x0f, 0x42, 0x40], [192, 0xff, 0x2f, 0x00]],
    [
      [0, 0xc0, 5], [0, 0x90, 60, 100], [0, 0x91, 67, 80], [0, 0x99, 36, 127], // C4 ch 0, G4 ch 1, kick
      [48, 0x89, 36, 0], [48, 0x80, 60, 0], // kick off at 0.25 s, C4 off at 0.5 s (a note off)
      [0, 0x90, 64, 90], [96, 64, 0], // E4 0.5 to 1 s (running status, velocity-0 note on: an off)
      [96, 0x90, 72, 70], [0, 0x90, 72, 60], // C5 at tick 288 (2 s), retriggered at once: the first ends there
      [0, 0xff, 0x2f, 0x00],
    ],
  ],
}));

/** A recording 2D context: fillRect calls with their style and alpha, and the clip path. */
function recorder() {
  /** @type {any[]} */
  const ops = [];
  const g = {
    globalAlpha: 1, fillStyle: "",
    clearRect: (/** @type {number[]} */ ...r) => ops.push(["clear", ...r]),
    fillRect: (/** @type {number[]} */ ...r) => ops.push(["fill", g.fillStyle, +g.globalAlpha.toFixed(4), ...r.map((v) => +v.toFixed(4))]),
    beginPath: () => ops.push(["path"]),
    rect: (/** @type {number[]} */ ...r) => ops.push(["rect", ...r]),
    clip: (/** @type {string} */ rule) => ops.push(["clip", rule]),
    save: () => ops.push(["save"]),
    restore: () => ops.push(["restore"]),
    setTransform: (/** @type {number[]} */ ...m) => ops.push(["transform", ...m]),
  };
  return { g: /** @type {any} */ (g), ops };
}
const fills = (/** @type {any[]} */ ops) => ops.filter((op) => op[0] === "fill");
/** The drum ticks' colour in the drawing tests (by default they take the palette's colour for channel 9). */
const DRUM = "#ddd";

describe("midiNotes: the MIDI as bars", () => {
  test("bars per channel and key, in seconds under the tempo map; pitch range without drums", () => {
    const r = midiNotes(SONG);
    assert.equal(r.seconds, 3); // 192 ticks at 120 BPM (1 s), 192 at 60 BPM (2 s)
    assert.equal(r.beat, 3 / 4);
    assert.deepEqual([r.lo, r.hi], [60, 72]);
    assert.deepEqual(r.notes.map((n) => [n.start, n.end, n.key, n.ch, n.vel]), [
      [0, 0.5, 60, 0, 100],
      [0, 3, 67, 1, 80], // never ended: lasts to the end of the pass
      [0, 0.25, 36, 9, 127],
      [0.5, 1, 64, 0, 90],
      [2, 2, 72, 0, 70],
      [2, 3, 72, 0, 60],
    ]);
  });
  test("every fixture: one pass is the player's (checkMidi), every note inside it", () => {
    for (const c of fixtures.valid) {
      const u = new Uint8Array(Buffer.from(c.midi_b64, "base64"));
      const r = midiNotes(u);
      assert.equal(r.seconds, checkMidi(u).seconds, c.name);
      assert.ok(r.notes.every((n) => n.start >= 0 && n.end >= n.start && n.end <= r.seconds), c.name);
    }
  });
  test("what it cannot read throws", () => {
    assert.throws(() => midiNotes(new Uint8Array([1, 2, 3])), /^Error: notes: /);
    assert.throws(() => midiNotes(new Uint8Array(SONG.subarray(0, 40))), /^Error: notes: /);
  });
});

describe("screenBox: art units to the screen", () => {
  const BOX = DEFAULTS.box;
  const VIEW = DEFAULTS.view;
  const full = (/** @type {number} */ w, /** @type {number} */ h) => ({ left: 0, top: 0, width: w, height: h });
  test("the art filling its <img>, scaled, and letterboxed either way (object-fit: contain)", () => {
    assert.deepEqual(screenBox(BOX, VIEW, full(250, 350)), { left: 15, top: 58, width: 220, height: 156, k: 1 });
    assert.deepEqual(screenBox(BOX, VIEW, full(500, 700)), { left: 30, top: 116, width: 440, height: 312, k: 2 });
    assert.deepEqual(screenBox(BOX, VIEW, full(700, 350)), { left: 240, top: 58, width: 220, height: 156, k: 1 });
    assert.deepEqual(screenBox(BOX, VIEW, full(250, 700)), { left: 15, top: 233, width: 220, height: 156, k: 1 });
  });
  test("the <img>'s own rectangle (60% of the page, offset), and a viewBox origin", () => {
    assert.deepEqual(screenBox(BOX, VIEW, { left: 100, top: 140, width: 300, height: 420 }), { left: 118, top: 209.6, width: 264, height: 187.2, k: 1.2 });
    assert.deepEqual(screenBox([5, 38, 220, 156], [-10, -20, 250, 350], full(250, 350)), { left: 15, top: 58, width: 220, height: 156, k: 1 });
  });
  test("no size: null", () => {
    assert.equal(screenBox(BOX, VIEW, full(0, 0)), null);
    assert.equal(screenBox(BOX, [0, 0, 0, 350], full(250, 350)), null);
  });
});

describe("drawNotes: one frame", () => {
  const roll = midiNotes(SONG);
  const o = { ...DEFAULTS, drumColor: DRUM };
  const [w, h] = [o.box[2], o.box[3]];
  const k = w / (o.beats * roll.beat); // units per second
  const now = o.playheadX * w;
  test("standing still at 0: the opening notes from the playhead on, muted, and a faint playhead line", () => {
    const { g, ops } = recorder();
    drawNotes(g, roll, o, 0, false);
    const f = fills(ops);
    const c4 = f.find((op) => op[1] === o.palette[0]);
    assert.equal(c4[3], +now.toFixed(4), "C4, at 0 s, starts at the playhead");
    assert.equal(c4[2], +(0.35 * (0.6 + (0.4 * 100) / 127)).toFixed(4), "idleAlpha times velocity");
    assert.deepEqual(f.at(-1), ["fill", "#fff", 0.15, +(now - 0.3).toFixed(4), 0, 0.6, h]);
    assert.ok(f.every((op) => op[1] === "#fff" || op[3] >= +now.toFixed(4)), "nothing before the first pass");
  });
  test("playing: a note reaches the playhead when it sounds, brighter; later notes to its right", () => {
    const { g, ops } = recorder();
    drawNotes(g, roll, o, 0.5, true); // E4 starts at 0.5 s; C4 has just ended
    const f = fills(ops);
    const e4 = f.find((op) => op[1] === o.palette[0] && op[3] === +now.toFixed(4));
    assert.ok(e4, "E4 at the playhead");
    assert.equal(e4[2], +(1 * (0.6 + (0.4 * 90) / 127)).toFixed(4), "sounding: twice playAlpha");
    const c5 = f.filter((op) => op[1] === o.palette[0] && op[3] > now + 1);
    assert.equal(c5[0][3], +(now + 1.5 * k).toFixed(4), "C5 at 2 s: 1.5 s to the right");
    assert.equal(c5[0][2], +(0.5 * (0.6 + (0.4 * 70) / 127)).toFixed(4), "playAlpha");
    assert.deepEqual(f.at(-1).slice(0, 3), ["fill", "#fff", 0.3]);
  });
  test("the loop: the next pass's notes follow, at one pass's distance", () => {
    const { g, ops } = recorder();
    drawNotes(g, roll, o, 2.9, true);
    const xs = fills(ops).filter((op) => op[1] === o.palette[1]).map((op) => op[3]);
    assert.deepEqual(xs.slice(0, 3), [now - 2.9 * k, now + 0.1 * k, now + 3.1 * k].map((x) => +x.toFixed(4)), "G4 of this pass (its start off the left edge: it lasts the pass), of the next, and the one after");
    assert.ok(xs.at(-1) < w && xs.at(-1) + 3 * k >= w, "passes up to the right edge");
  });
  test("hide: an even-odd clip of the box minus each rectangle, in box units", () => {
    const { g, ops } = recorder();
    drawNotes(g, roll, { ...o, hide: [[62, 66, 128, 128]] }, 1, true);
    assert.deepEqual(ops.slice(1, 6), [["save"], ["path"], ["rect", 0, 0, w, h], ["rect", 62 - 15, 66 - 58, 128, 128], ["clip", "evenodd"]]);
    assert.deepEqual(ops.at(-1), ["restore"]);
    const none = recorder();
    drawNotes(none.g, roll, o, 1, true);
    assert.ok(!none.ops.some((op) => op[0] === "clip"), "no hide: no clip");
  });
  test("playheadX null: no line, notes sound at the left edge; drums 0: no ticks and no band", () => {
    const { g, ops } = recorder();
    drawNotes(g, roll, { ...o, playheadX: null, drums: 0 }, 0, false);
    const f = fills(ops);
    assert.ok(!f.some((op) => op[1] === "#fff" || op[1] === DRUM), "no playhead line, no drum ticks");
    assert.equal(f.find((op) => op[1] === o.palette[0])[3], 0);
  });
  test("colours: the composer's palette per channel (modulo its length, drums included), drumColor overriding the drums", () => {
    const shiny = ["#73FF73", "#FFFF73", "#FFBE73", "#FF7373", "#C073DC", "#7373FF"];
    const { g, ops } = recorder();
    drawNotes(g, roll, { ...DEFAULTS, palette: shiny }, 0, false);
    assert.deepEqual([...new Set(fills(ops).map((op) => op[1]))], ["#73FF73", "#FFFF73", "#FF7373", "#fff"], "channel 0, 1 and 9 (9 % 6 = 3), then the playhead");
    const two = recorder();
    drawNotes(two.g, roll, { ...o, palette: ["#0000ff", "#7373ff"], drumColor: "#888" }, 0, false);
    assert.deepEqual([...new Set(fills(two.ops).map((op) => op[1]))], ["#0000ff", "#7373ff", "#888", "#fff"], "a tier colour and its pastel, alternating; grey drums");
  });
  test("drums: ticks in the band at the bottom, below the melodic rows", () => {
    const { g, ops } = recorder();
    drawNotes(g, roll, o, 0, false);
    const kick = fills(ops).find((op) => op[1] === DRUM);
    assert.equal(kick[4] + kick[6], h - 2, "standing on the bottom, 2 units up");
    assert.ok(kick[4] >= h - 2 - o.drums, "inside the band");
    const melodic = fills(ops).filter((op) => o.palette.includes(op[1]));
    assert.ok(melodic.every((op) => op[4] + op[6] <= h - o.drums - 2 + 1e-9), "melodic rows above it");
  });
});

describe("mount: defaults, layout and animation", () => {
  /** Stubs the browser globals mount reads; returns the frames requested and a restore function. */
  function browser({ reduced = false } = {}) {
    /** @type {Array<() => void>} */
    const frames = [];
    const saved = Object.fromEntries(["requestAnimationFrame", "cancelAnimationFrame", "matchMedia", "devicePixelRatio", "addEventListener"].map((n) => [n, Object.getOwnPropertyDescriptor(globalThis, n)]));
    Object.assign(globalThis, {
      requestAnimationFrame: (/** @type {() => void} */ f) => frames.push(f),
      cancelAnimationFrame: (/** @type {number} */ id) => { frames[id - 1] = () => {}; },
      matchMedia: () => ({ matches: reduced }),
      devicePixelRatio: 2,
      addEventListener: () => {},
    });
    const restore = () => {
      for (const [n, d] of Object.entries(saved)) {
        if (d) Object.defineProperty(globalThis, n, d);
        else delete (/** @type {any} */ (globalThis))[n];
      }
    };
    return { frames, restore };
  }
  function canvas() {
    const { g, ops } = recorder();
    /** @type {any[]} */
    const placed = [];
    const c = { style: {}, width: 0, height: 0, hidden: false, isConnected: false, getContext: () => g };
    const img = { getBoundingClientRect: () => ({ left: 100, top: 140, width: 300, height: 420 }), before: (/** @type {any} */ e) => { placed.push(e); e.isConnected = true; } };
    return { c: /** @type {any} */ (c), img: /** @type {any} */ (img), ops, placed };
  }
  const b64 = Buffer.from(SONG).toString("base64");

  test("the defaults are the Beasts card's, and options override them", () => {
    assert.deepEqual(DEFAULTS.box, [15, 58, 220, 156]);
    assert.deepEqual(DEFAULTS.view, [0, 0, 250, 350]);
    assert.deepEqual([DEFAULTS.playheadX, DEFAULTS.beats, DEFAULTS.idleAlpha, DEFAULTS.playAlpha, DEFAULTS.drums, DEFAULTS.background], [0.07, 24, 0.35, 0.5, 12, "#000"]);
    assert.deepEqual(DEFAULTS.hide, []);
    const { frames, restore } = browser();
    try {
      const { c } = canvas();
      const m = mount(c, { midi: SONG, hide: [[62, 66, 128, 128]], beats: 16 });
      assert.deepEqual(m.options.hide, [[62, 66, 128, 128]]);
      assert.equal(m.options.beats, 16);
      assert.deepEqual(m.options.box, DEFAULTS.box);
      assert.equal(frames.length, 0, "standing still: no animation frame");
    } finally {
      restore();
    }
  });
  test("with an <img>: the canvas goes behind it, over the box where it draws the art, at the pixel ratio", () => {
    const { frames, restore } = browser();
    try {
      const { c, img, ops, placed } = canvas();
      mount(c, { midi: " " + b64 + "  ", img: () => img });
      assert.deepEqual(placed, [c], "inserted just before the <img>");
      assert.deepEqual(c.style, { position: "fixed", background: "#000", left: "118px", top: "209.6px", width: "264px", height: "187.2px" });
      assert.deepEqual([c.width, c.height], [528, 374]);
      assert.deepEqual(ops.find((op) => op[0] === "transform"), ["transform", 528 / 220, 0, 0, 374 / 156, 0, 0]);
      assert.equal(frames.length, 0);
    } finally {
      restore();
    }
  });
  test("without one: the box is in CSS pixels", () => {
    const { restore } = browser();
    try {
      const { c } = canvas();
      mount(c, { midi: SONG, box: [10, 20, 300, 100], background: "" });
      assert.deepEqual(c.style, { position: "fixed", background: "", left: "10px", top: "20px", width: "300px", height: "100px" });
    } finally {
      restore();
    }
  });
  test("play scrolls with the clock every animation frame; stop stands still at the start", () => {
    const { frames, restore } = browser();
    try {
      const { c, ops } = canvas();
      let t = 0.5;
      const m = mount(c, { midi: SONG, clock: () => t });
      m.play();
      assert.equal(frames.length, 1);
      const line = () => fills(ops).findLast((op) => op[1] === "#fff")[2]; // the playhead's alpha in the latest frame
      assert.equal(line(), 0.3, "drawn playing");
      t = 0.75;
      const before = ops.length;
      frames[0]();
      assert.equal(frames.length, 2, "the next frame is requested");
      assert.ok(ops.length > before);
      m.stop();
      frames[1]();
      assert.equal(frames.length, 2, "stopped: no more frames");
      assert.equal(line(), 0.15, "back to standing still");
    } finally {
      restore();
    }
  });
  test("pause holds the frame and requests no animation frames; play resumes from the clock", () => {
    const { frames, restore } = browser();
    try {
      const { c, ops } = canvas();
      let t = 1;
      const m = mount(c, { midi: SONG, clock: () => t });
      const latest = () => fills(ops.slice(ops.findLastIndex((op) => op[0] === "clear")));
      m.play();
      const playing = latest();
      t = 1.5;
      m.pause();
      frames[0]();
      assert.equal(frames.length, 1, "paused: the pending frame was cancelled, none requested");
      assert.deepEqual(latest(), playing, "the same frame, at the clock's last reading");
      m.draw(); // a resize while paused redraws the held frame
      assert.deepEqual(latest(), playing);
      m.play();
      assert.equal(frames.length, 2, "resumed");
      assert.notDeepEqual(latest(), playing, "drawn at the clock's new reading");
    } finally {
      restore();
    }
  });
  test("prefers-reduced-motion: play keeps it standing still", () => {
    const { frames, restore } = browser({ reduced: true });
    try {
      const { c } = canvas();
      mount(c, { midi: SONG, clock: () => 1 }).play();
      assert.equal(frames.length, 0);
    } finally {
      restore();
    }
  });
});

describe("cutout: the page's copy of the art", () => {
  const card = (/** @type {string} */ body) => `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 250 350'>${body}</svg>`;
  test("the root's children up to the data-notes-bg one are masked by its shape; titles, animations and later ones stay", async () => {
    const { DOMParser, XMLSerializer } = await import("@xmldom/xmldom");
    Object.assign(globalThis, { DOMParser, XMLSerializer });
    try {
      const body = "<title>t</title><animate attributeName='opacity' dur='2s' values='1;.99'/><rect id='card' width='250' height='350' fill='#123'/>" +
        "<text>name</text><rect id='frame' data-notes-bg='' x='15' y='58' width='220' height='156' rx='8' fill='#000'/><g id='beast'/><rect id='rim'/>";
      const root = new DOMParser().parseFromString(cutout(card(body)), "image/svg+xml").documentElement;
      const kids = Array.from(/** @type {any} */ (root.childNodes)).map((/** @type {any} */ e) => e.localName + (e.getAttribute("id") ? "#" + e.getAttribute("id") : ""));
      assert.deepEqual(kids, ["title", "animate", "mask#onchain-midi-notes", "g", "g#beast", "rect#rim"]);
      const [mask, g] = /** @type {any[]} */ ([root.childNodes[2], root.childNodes[3]]);
      assert.equal(g.getAttribute("mask"), "url(#onchain-midi-notes)");
      assert.deepEqual(Array.from(/** @type {any} */ (g.childNodes)).map((/** @type {any} */ e) => e.getAttribute("id") || e.localName), ["card", "text", "frame"]);
      assert.equal(mask.childNodes[0].getAttribute("fill"), "#fff");
      const hole = mask.childNodes[1];
      assert.deepEqual(["x", "y", "width", "height", "rx", "fill", "id"].map((a) => hole.getAttribute(a)), ["15", "58", "220", "156", "8", "#000", null], "the frame's own shape, in black, without its id");
      assert.equal(cutout(card("<rect/>")), card("<rect/>"), "no data-notes-bg: unchanged");
      assert.equal(cutout(card("<g><rect data-notes-bg=''/></g>")), card("<g><rect data-notes-bg=''/></g>"), "only a child of the root counts");
    } finally {
      for (const k of ["DOMParser", "XMLSerializer"]) delete (/** @type {any} */ (globalThis))[k];
    }
  });
});

test("the built script (notesScript): printable ASCII, safe inside <script>, defines OnchainMidiNotes", async () => {
  const code = await notesScript();
  assert.ok(!/[^\x20-\x7e]/.test(code));
  assert.ok(!/<\/script|<script|<!--/i.test(code));
  /** @type {any} */
  const window = {};
  vm.runInNewContext(code, { window });
  assert.deepEqual(Object.keys(window.OnchainMidiNotes), ["mount", "cutout", "DEFAULTS"]);
  assert.equal(JSON.stringify(window.OnchainMidiNotes.DEFAULTS.box), "[15,58,220,156]");
});
