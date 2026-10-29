// @ts-nocheck
// The optional notes on the Beast page: where the footer draws them (notesFrame), how it mounts them
// (startNotes: present, absent, a failing module, the marker missing), and the notes fragment the
// page includes (fixtures/notes.html: a plain script exposing mount and cutout as OnchainMidiNotes).
// The page itself (canvas behind the art, playback without notes) is checked in browsers by
// scripts/page_check.mjs.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { describe, test } from "node:test";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { notesFrame, startNotes } from "../ui.js";
import * as notesSource from "../../../player/notes.js";
import { renderSvg } from "./reference.mjs";
import { riff } from "../../../scripts/data_cases.mjs";

/** Runs `f` with the browser globals the footer helpers and the notes module read, then restores them. */
function withBrowser(f, { reduced = false } = {}) {
  const names = ["DOMParser", "XMLSerializer", "requestAnimationFrame", "cancelAnimationFrame", "matchMedia", "devicePixelRatio", "addEventListener", "getComputedStyle"];
  const saved = Object.fromEntries(names.map((n) => [n, Object.getOwnPropertyDescriptor(globalThis, n)]));
  const frames = [];
  Object.assign(globalThis, {
    DOMParser, XMLSerializer,
    requestAnimationFrame: (fn) => frames.push(fn),
    cancelAnimationFrame: () => {},
    matchMedia: () => ({ matches: reduced }),
    devicePixelRatio: 1,
    addEventListener: () => {},
    getComputedStyle: () => ({ position: "fixed" }), // the page's #beast-art
  });
  try {
    return f(frames);
  } finally {
    for (const [n, d] of Object.entries(saved)) {
      if (d) Object.defineProperty(globalThis, n, d);
      else delete globalThis[n];
    }
  }
}

/** A detached canvas recording its 2D drawing, and the art element it goes before (filling a 500 x 700 viewport). */
function page() {
  const ops = [];
  const g = new Proxy({}, { get: (_, k) => (...args) => ops.push([k, ...args]), set: (_, k, v) => (ops.push(["=", k, v]), true) });
  const canvas = { style: {}, width: 0, height: 0, hidden: false, isConnected: false, removed: 0, getContext: () => g, remove() { this.removed++; this.isConnected = false; } };
  const img = { style: {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 500, height: 700 }), before(e) { e.isConnected = true; this.placed = e; } };
  return { canvas, img, ops };
}

const card = (body, attrs = "viewBox='0 0 250 350'") => `<svg xmlns='http://www.w3.org/2000/svg' ${attrs}>${body}</svg>`;
const FRAME = "<rect data-notes-bg='' x='15' y='58' width='220' height='144' rx='8' fill='#000'/>";
const MIDI = riff({ ppq: 96, us: 500000 }).toString("base64");

describe("notesFrame: the notes' box and units, from the art", () => {
  const frame = (svg) => withBrowser(() => notesFrame(svg));
  test("the root viewBox and the marked root child's x, y, width and height", () => {
    assert.deepEqual(frame(card("<rect width='250' height='350'/>" + FRAME + "<g/>")), { view: [0, 0, 250, 350], box: [15, 58, 220, 144] });
    // The next layout's frame, a viewBox with commas and an origin: whatever the art says.
    assert.deepEqual(frame(card("<rect data-notes-bg='' x='15' y='54' width='220' height='170'/>", "viewBox=' -10,-20 250,350 '")), { view: [-10, -20, 250, 350], box: [15, 54, 220, 170] });
    assert.deepEqual(frame(card("<rect data-notes-bg='' width='250' height='350'/>")), { view: [0, 0, 250, 350], box: [0, 0, 250, 350] }, "x and y default to 0");
    assert.deepEqual(frame(card(FRAME + "<rect data-notes-bg='' x='1' y='1' width='1' height='1'/>")).box, [15, 58, 220, 144], "the first marked child");
  });
  test("the reference card: its art frame (61, 65, 128 x 128)", () => {
    assert.deepEqual(frame(renderSvg("Warlock", 1)), { view: [0, 0, 250, 350], box: [61, 65, 128, 128] });
  });
  for (const [label, svg] of [
    ["no marker", card("<rect x='15' y='58' width='220' height='144'/>")],
    ["a marker nested below the root (as cutout, it does not count)", card("<g id='printCut'><g id='print'>" + FRAME + "</g></g>")],
    ["no viewBox", card(FRAME, "width='250' height='350'")],
    ["a viewBox of three numbers", card(FRAME, "viewBox='0 0 250'")],
    ["an empty viewBox", card(FRAME, "viewBox='0 0 0 0'")],
    ["no width", card("<rect data-notes-bg='' x='15' y='58' height='144'/>")],
    ["a zero height", card("<rect data-notes-bg='' x='15' y='58' width='220' height='0'/>")],
    ["a percentage", card("<rect data-notes-bg='' x='15' y='58' width='100%' height='144'/>")],
    ["units", card("<rect data-notes-bg='' x='15px' y='58' width='220' height='144'/>")],
    ["a document that is not SVG", "<html><body data-notes-bg=''/></html>"],
  ]) {
    test(`null: ${label}`, () => assert.equal(frame(svg), null));
  }
});

describe("startNotes: the footer's notes, or nothing", () => {
  /** A stand-in for the notes module, recording its calls. */
  function fake({ mountThrows = false, cutoutThrows = false, playThrows = false } = {}) {
    const calls = [];
    return {
      calls,
      cutout(svg) { calls.push(["cutout", svg]); if (cutoutThrows) throw Error("cutout"); return "<cut/>"; },
      mount(canvas, options) {
        calls.push(["mount", canvas, options]);
        if (mountThrows) { canvas.isConnected = true; throw Error("notes: not a MIDI file"); }
        return { play() { calls.push(["play"]); if (playThrows) throw Error("draw"); }, pause() { calls.push(["pause"]); }, stop() { calls.push(["stop"]); } };
      },
    };
  }
  const svg = card("<rect width='250' height='350' fill='#1e1e22'/>" + FRAME + "<g id='beast'/>");
  const options = (img) => ({ midi: MIDI, clock: () => 1.5, img: () => img });

  test("present: mounted on the canvas over the marked frame, in the art's units; the page shows the cut-out copy", () => {
    const { canvas, img } = page(), lib = fake();
    const notes = withBrowser(() => startNotes(lib, svg, canvas, options(img)));
    assert.equal(notes.svg, "<cut/>", "the page's copy: cutout(svg)");
    assert.deepEqual(lib.calls[0], ["cutout", svg]);
    const [, onCanvas, o] = lib.calls[1];
    assert.equal(onCanvas, canvas);
    assert.deepEqual([o.midi, o.view, o.box, o.clock(), o.img()], [MIDI, [0, 0, 250, 350], [15, 58, 220, 144], 1.5, img]);
    notes.play(); notes.pause(); notes.stop();
    assert.deepEqual(lib.calls.slice(2), [["play"], ["pause"], ["stop"]], "the transport syncSvgToMusic drives");
  });
  test("absent: no module, nothing happens", () => {
    const { canvas, img } = page();
    for (const lib of [undefined, null]) assert.equal(withBrowser(() => startNotes(lib, svg, canvas, options(img))), null);
    assert.equal(canvas.isConnected, false);
  });
  test("the marker missing (or nested, or without a size): no cutout, no mount, the art as it is", () => {
    for (const art of [card("<rect x='15' y='58' width='220' height='144'/>"), card("<g><g>" + FRAME + "</g></g>"), card(FRAME, "width='250' height='350'"), "<html/>"]) {
      const { canvas, img } = page(), lib = fake();
      assert.equal(withBrowser(() => startNotes(lib, art, canvas, options(img))), null);
      assert.deepEqual(lib.calls, []);
    }
  });
  test("a failing module: mount or cutout throwing leaves no canvas and no cut-out art", () => {
    for (const how of [{ mountThrows: true }, { cutoutThrows: true }]) {
      const { canvas, img } = page(), lib = fake(how);
      assert.equal(withBrowser(() => startNotes(lib, svg, canvas, options(img))), null);
      assert.equal(canvas.isConnected, false, "removed if mount had placed it");
    }
  });
  test("the transport fails silently: a notes error cannot reach the art's sync", () => {
    const { canvas, img } = page();
    const notes = withBrowser(() => startNotes(fake({ playThrows: true }), svg, canvas, options(img)));
    assert.doesNotThrow(() => notes.play());
  });
  test("with player/notes.js: the canvas goes just before the art over the frame's box, the art's background cut out", () => {
    const { canvas, img, ops } = page();
    const notes = withBrowser(() => startNotes(notesSource, svg, canvas, options(img)));
    assert.equal(img.placed, canvas, "just before the art");
    // 500 x 700 shows the 250 x 350 art at scale 2: the frame (15, 58) 220 x 144 is at (30, 116), 440 x 288.
    assert.deepEqual([canvas.style.position, canvas.style.left, canvas.style.top, canvas.style.width, canvas.style.height], ["fixed", "30px", "116px", "440px", "288px"]);
    assert.ok(ops.some((op) => op[0] === "fillRect"), "drawn standing still");
    const root = withBrowser(() => new DOMParser().parseFromString(notes.svg, "image/svg+xml").documentElement);
    assert.deepEqual(Array.from(root.childNodes).map((e) => e.localName + (e.getAttribute("id") ? "#" + e.getAttribute("id") : "")), ["mask#onchain-midi-notes", "g", "g#beast"]);
  });
  test("with player/notes.js and a MIDI it cannot read: nothing", () => {
    const { canvas, img } = page();
    assert.equal(withBrowser(() => startNotes(notesSource, svg, canvas, { ...options(img), midi: "AAAA" })), null);
    assert.equal(img.placed, undefined);
  });
});

describe("fixtures/notes.html: the notes fragment", () => {
  const raw = readFileSync(new URL("../fixtures/notes.html", import.meta.url), "utf8");
  test("one plain, 9-byte aligned script after its license comment", () => {
    assert.equal(Buffer.byteLength(raw) % 9, 0);
    const m = /^<!-- notes: onchain-midi-player player\/notes\.js, Copyright 2026 Provable Games, Apache-2\.0 --><script id="beast-notes">([\s\S]*)<\/script> *$/.exec(raw);
    assert.ok(m, "comment, then one script, then alignment spaces");
    assert.ok(!/<\/script|<script|<!--/i.test(m[1]), "safe inline source");
  });
  test("it exposes mount and cutout as OnchainMidiNotes, cutting out as player/notes.js does", () => {
    const source = /<script id="beast-notes">([\s\S]*)<\/script>/.exec(raw)[1];
    const window = {};
    runInContext(source, createContext({ window, DOMParser, XMLSerializer }));
    assert.deepEqual(Object.keys(window.OnchainMidiNotes), ["mount", "cutout"]);
    const art = renderSvg("Warlock", 1);
    assert.equal(window.OnchainMidiNotes.cutout(art), withBrowser(() => notesSource.cutout(art)));
    assert.notEqual(window.OnchainMidiNotes.cutout(art), art, "the reference card's frame is cut out");
  });
});
