import assert from "node:assert/strict";
import {describe,test} from "node:test";
import {playAnchor,artUrl,silentWav} from "../ui.js";
describe("the play button's anchor on the art (playAnchor)", () => {
  const full = (/** @type {number} */ w, /** @type {number} */ h) => ({ left: 0, top: 0, width: w, height: h });
  const card = (/** @type {string} */ attrs) => `<svg xmlns='http://www.w3.org/2000/svg' ${attrs}><rect/></svg>`;
  const BEAST = "viewBox='0 0 250 350' data-play-anchor='235 202 32'";
  // The button's bottom-right corner is max(S / 8, 6) units, at the art's scale, inside the anchor (6 units for S = 32).
  test("a viewport the art fills exactly: the art's scale 1 makes 32 units 32 px, raised to the 44 px minimum", () => {
    assert.deepEqual(playAnchor(card(BEAST), full(250, 350), 250, 350), { left: 185, top: 152, size: 44 });
  });
  test("the diameter is S times the art's scale, between 44 and 128 px, and the offset follows it", () => {
    assert.deepEqual(playAnchor(card(BEAST), full(500, 700), 500, 700), { left: 394, top: 328, size: 64 }); // scale 2, inset 12
    assert.deepEqual(playAnchor(card(BEAST), full(750, 1050), 750, 1050), { left: 591, top: 492, size: 96 }); // scale 3, inset 18
    assert.deepEqual(playAnchor(card(BEAST), full(1000, 1400), 1000, 1400), { left: 788, top: 656, size: 128 }); // scale 4: exactly 128, inset 24
    assert.deepEqual(playAnchor(card(BEAST), full(1250, 1750), 1250, 1750), { left: 1017, top: 852, size: 128 }); // scale 5: 160 clamped to 128, inset 30
  });
  test("a landscape viewport letterboxes the art left and right (object-fit: contain)", () => {
    // 700 x 350: scale 1, the art is centred: offset (700 - 250) / 2 = 225.
    assert.deepEqual(playAnchor(card(BEAST), full(700, 350), 700, 350), { left: 410, top: 152, size: 44 });
  });
  test("a wide, short viewport shrinks the art, and the button stops at 44 px", () => {
    // 700 x 175: scale 0.5 (20 px of 40 units), the art is 125 wide, offset 287.5; the anchor is at (405, 101), the inset 3.
    assert.deepEqual(playAnchor(card(BEAST), full(700, 175), 700, 175), { left: 358, top: 54, size: 44 });
  });
  test("without S: 48 px, the corner 6 px inside", () => {
    assert.deepEqual(playAnchor(card("viewBox='0 0 250 350' data-play-anchor='235 202'"), full(250, 350), 250, 350), { left: 235 - 6 - 48, top: 202 - 6 - 48, size: 48 });
    assert.deepEqual(playAnchor(card("viewBox='0 0 250 350' data-play-anchor='235 202'"), full(500, 700), 500, 700), { left: 470 - 6 - 48, top: 404 - 6 - 48, size: 48 }, "not scaled");
  });
  test("no viewBox: width and height (with px), and a viewBox with an origin", () => {
    const want = { left: 185, top: 152, size: 44 };
    assert.deepEqual(playAnchor(card("width='250' height='350' data-play-anchor='235 202 32'"), full(250, 350), 250, 350), want);
    assert.deepEqual(playAnchor(card("width='250px' height='350px' data-play-anchor='235 202 32'"), full(250, 350), 250, 350), want);
    assert.deepEqual(playAnchor(card("viewBox='-10 -20 250 350' data-play-anchor='225 182 40'"), full(250, 350), 250, 350), want);
  });
  test("the button stays on screen: anchors at the art's corners, and a button larger than the viewport", () => {
    assert.deepEqual(playAnchor(card("viewBox='0 0 100 100' data-play-anchor='0 0 10'"), full(100, 100), 100, 100), { left: 0, top: 0, size: 44 });
    assert.deepEqual(playAnchor(card("viewBox='0 0 100 100' data-play-anchor='100 100 10'"), full(100, 100), 100, 100), { left: 50, top: 50, size: 44 });
    assert.deepEqual(playAnchor(card("viewBox='0 0 100 100' data-play-anchor='100 100 1000'"), full(100, 100), 100, 100), { left: 0, top: 0, size: 128 });
  });
  for (const [label, attrs] of /** @type {Array<[string, string]>} */ ([
    ["no attribute", "viewBox='0 0 250 350'"],
    ["one number", "viewBox='0 0 250 350' data-play-anchor='235'"],
    ["four numbers", "viewBox='0 0 250 350' data-play-anchor='235 202 32 1'"],
    ["a zero diameter", "viewBox='0 0 250 350' data-play-anchor='235 202 0'"],
    ["a negative diameter", "viewBox='0 0 250 350' data-play-anchor='235 202 -40'"],
    ["a diameter that is not a number", "viewBox='0 0 250 350' data-play-anchor='235 202 big'"],
    ["text", "viewBox='0 0 250 350' data-play-anchor='right bottom'"],
    ["units", "viewBox='0 0 250 350' data-play-anchor='235px 202px'"],
    ["out of range (past the art)", "viewBox='0 0 250 350' data-play-anchor='235 400 40'"],
    ["out of range (negative)", "viewBox='0 0 250 350' data-play-anchor='-1 194'"],
    ["not a number (NaN)", "viewBox='0 0 250 350' data-play-anchor='NaN 194'"],
    ["no size at all", "data-play-anchor='235 202'"],
    ["a percentage size", "width='100%' height='100%' data-play-anchor='1 1'"],
    ["a malformed viewBox", "viewBox='0 0 250' data-play-anchor='235 202'"],
    ["an empty viewBox", "viewBox='0 0 0 0' data-play-anchor='0 0'"],
  ])) {
    test(`falls back to the corner: ${label}`, () => {
      assert.equal(playAnchor(card(attrs), full(250, 350), 250, 350), null);
    });
  }
  test("the art's own box, not the viewport: a 75% display, centred or offset, lands on the frame's corner", () => {
    // A 250 x 350 viewport with the img at 75%, centred: box (31.25, 43.75) 187.5 x 262.5, scale 0.75 (24 px: 44, inset 4.5).
    assert.deepEqual(playAnchor(card(BEAST), { left: 31.25, top: 43.75, width: 187.5, height: 262.5 }, 250, 350), { left: 159, top: 147, size: 44 });
    // The same art in a wider box inside a bigger viewport: contain inside the box, centred in it.
    assert.deepEqual(playAnchor(card(BEAST), { left: 100, top: 20, width: 500, height: 350 }, 800, 600), { left: 410, top: 172, size: 44 });
    // A box that is half off screen is clamped to the viewport.
    assert.deepEqual(playAnchor(card(BEAST), { left: 200, top: 0, width: 250, height: 350 }, 250, 350), { left: 206, top: 152, size: 44 });
  });
  test("only the root tag counts, and an attribute whose name ends the same does not", () => {
    assert.equal(playAnchor("<svg viewBox='0 0 250 350'><g data-play-anchor='235 202 32'/></svg>", full(250, 350), 250, 350), null);
    assert.equal(playAnchor("<svg viewBox='0 0 250 350' x-data-play-anchor='235 202 32'/>", full(250, 350), 250, 350), null);
    assert.equal(playAnchor("not svg", full(250, 350), 250, 350), null);
    assert.equal(playAnchor(card(BEAST), full(0, 0), 0, 0), null);
  });

});
test("NFT-owned isolated art URLs preserve UTF8 bytes and restart timelines",()=>{
 const svg='<svg><title>音楽 🐉</title><desc>script-like &lt;/script&gt;</desc></svg>';
 assert.equal(artUrl(svg),'data:image/svg+xml;base64,'+Buffer.from(svg).toString('base64'));
 assert.equal(artUrl(svg,3),'data:image/svg+xml;r=3;base64,'+Buffer.from(svg).toString('base64'));
});
test("NFT media session owns a six-second silent PCM carrier",()=>{
 const b=Buffer.from(silentWav());assert.equal(b.toString('ascii',0,4),'RIFF');assert.equal(b.readUInt32LE(4),b.length-8);assert.equal(b.readUInt32LE(24),8000);assert.equal(b.readUInt32LE(40),48000);assert.ok(b.subarray(44).every(x=>x===128));
});
