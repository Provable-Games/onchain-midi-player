#!/usr/bin/env node
// @ts-check
// Optional headless check: renders the Beast reference timbres with the real TinySynth (the
// vendored fork build, scripts/engine.mjs) in headless Chromium, through the player's own
// parseSettings + createSynth, into an OfflineAudioContext, and measures the audio:
//
//   lead (A4)  mean pitch within 3 cents of 440 Hz; vibrato depth 30 +- 3 cents at 6 +- 0.3 Hz
//   kick       zero-crossing rate above 80 Hz at 20-40 ms and within 40-60 Hz at 100-160 ms;
//              silent after 200 ms
//   snare      noise burst: zero-crossing rate above 2 kHz in the first 20 ms; RMS falls at least
//              3x by 100-150 ms; silent after 200 ms
//
// The noise buffers are random until fork #7, so the checks use tolerances. Playwright is not a
// dependency of this repository; point the script at an existing install:
//
//   PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core \
//   CHROME=/path/to/chrome-headless-shell [LD_LIBRARY_PATH=...] \
//   node scripts/render_check.mjs
//
// Exits 0 when every check passes, 1 when one fails, 2 when PLAYWRIGHT_CORE is not set.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { engineSource } from "./engine.mjs";

const { PLAYWRIGHT_CORE, CHROME } = process.env;
if (!PLAYWRIGHT_CORE) {
  console.error("set PLAYWRIGHT_CORE to a playwright-core directory (and CHROME to a Chromium binary)");
  process.exit(2);
}
const { chromium } = createRequire(import.meta.url)(PLAYWRIGHT_CORE);

const fixtures = JSON.parse(readFileSync(new URL("../tests/fixtures/settings.json", import.meta.url), "utf8"));
const beastText = fixtures.valid.find((/** @type {any} */ f) => f.name === "beast_reference").settings_text;
// The player module, loaded as an inline module script that publishes its API for the test.
const playerModule = readFileSync(new URL("../player/settings.js", import.meta.url), "utf8") +
  "\nwindow.__player = { parseSettings, createSynth };\n";

const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});
let failed = 0;
try {
  const page = await browser.newPage();
  const errors = /** @type {string[]} */ ([]);
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.setContent("<!doctype html><title>render check</title>");
  await page.addScriptTag({ content: engineSource() });
  await page.addScriptTag({ type: "module", content: playerModule });
  await page.waitForFunction(() => "__player" in window);

  const m = await page.evaluate(async (text) => {
    const SR = 48000;
    const { parseSettings, createSynth } = /** @type {any} */ (window).__player;
    const settings = parseSettings("   " + text); // with alignment padding, as in the page
    /** Renders one note into an OfflineAudioContext that TinySynth takes as its AudioContext. */
    async function render(/** @type {number} */ ch, /** @type {number} */ note, /** @type {number} */ dur) {
      const Offline = window.OfflineAudioContext;
      // TinySynth calls resume() on a suspended context when it sends MIDI; an offline context
      // cannot be resumed before rendering starts, so that call becomes a no-op here.
      /** @type {any} */ (window).AudioContext = function () {
        return Object.assign(new Offline(1, SR * dur, SR), { resume: () => Promise.resolve() });
      };
      const synth = createSynth(/** @type {any} */ (window).WebAudioTinySynth, settings);
      synth.noteOn(ch, note, 127, 0.05);
      if (ch !== 9) synth.noteOff(ch, note, dur - 0.3);
      return (await synth.actx.startRendering()).getChannelData(0);
    }
    const at = (/** @type {number} */ t) => Math.round((0.05 + t) * SR);
    /** Rising zero crossings per second between two times after note-on. */
    function zcRate(/** @type {Float32Array} */ x, /** @type {number} */ a, /** @type {number} */ b) {
      let n = 0;
      for (let i = at(a) + 1; i < at(b); i++) if (x[i - 1] <= 0 && x[i] > 0) n++;
      return n / (b - a);
    }
    function rms(/** @type {Float32Array} */ x, /** @type {number} */ a, /** @type {number} */ b) {
      let s = 0;
      for (let i = at(a); i < at(b); i++) s += x[i] * x[i];
      return Math.sqrt(s / (at(b) - at(a)));
    }

    // Lead: per-cycle pitch from interpolated rising zero crossings.
    const lead = await render(0, 69, 1.5);
    const cross = [];
    for (let i = 1; i < lead.length; i++) if (lead[i - 1] <= 0 && lead[i] > 0) cross.push(i - 1 + -lead[i - 1] / (lead[i] - lead[i - 1]));
    const cycles = [];
    for (let i = 1; i < cross.length; i++) cycles.push({ t: cross[i] / SR - 0.05, cents: 1200 * Math.log2(SR / (cross[i] - cross[i - 1]) / 440) });
    const late = cycles.filter((c) => c.t > 0.45 && c.t < 1.15);
    const mean = late.reduce((a, c) => a + c.cents, 0) / late.length;
    const ups = [];
    for (let i = 1; i < late.length; i++) if (late[i - 1].cents < mean && late[i].cents >= mean) ups.push(late[i].t);
    const kick = await render(9, 36, 0.4);
    const snare = await render(9, 38, 0.4);
    return {
      leadMeanCents: mean,
      leadDepthCents: (Math.max(...late.map((c) => c.cents)) - Math.min(...late.map((c) => c.cents))) / 2,
      leadVibratoHz: (ups.length - 1) / (ups[ups.length - 1] - ups[0]),
      kickHzEarly: zcRate(kick, 0.02, 0.04),
      kickHzLate: zcRate(kick, 0.1, 0.16),
      kickRmsAfter200ms: rms(kick, 0.2, 0.3),
      snareZcRateFirst20ms: zcRate(snare, 0, 0.02),
      snareRmsDrop: rms(snare, 0, 0.02) / rms(snare, 0.1, 0.15),
      snareRmsAfter200ms: rms(snare, 0.2, 0.3),
    };
  }, beastText);

  /** @type {Array<[string, number, (v: number) => boolean, string]>} */
  const checks = [
    ["lead mean pitch (cents from A4)", m.leadMeanCents, (v) => Math.abs(v) <= 3, "|x| <= 3"],
    ["lead vibrato depth (cents)", m.leadDepthCents, (v) => Math.abs(v - 30) <= 3, "30 +- 3"],
    ["lead vibrato rate (Hz)", m.leadVibratoHz, (v) => Math.abs(v - 6) <= 0.3, "6 +- 0.3"],
    ["kick pitch at 20-40 ms (Hz)", m.kickHzEarly, (v) => v > 80, "> 80"],
    ["kick pitch at 100-160 ms (Hz)", m.kickHzLate, (v) => v >= 40 && v <= 60, "40..60"],
    ["kick RMS after 200 ms", m.kickRmsAfter200ms, (v) => v < 1e-4, "< 1e-4"],
    ["snare zero crossings/s, first 20 ms", m.snareZcRateFirst20ms, (v) => v > 2000, "> 2000"],
    ["snare RMS drop by 100-150 ms (x)", m.snareRmsDrop, (v) => v >= 3, ">= 3"],
    ["snare RMS after 200 ms", m.snareRmsAfter200ms, (v) => v < 1e-4, "< 1e-4"],
  ];
  for (const [name, value, ok, want] of checks) {
    const pass = ok(value);
    if (!pass) failed++;
    console.log(`${pass ? "PASS" : "FAIL"}  ${name.padEnd(38)} ${value.toFixed(4).padStart(12)}   want ${want}`);
  }
  if (errors.length) {
    failed++;
    console.log("FAIL  page errors:", errors);
  }
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
