#!/usr/bin/env node
// @ts-check
// Optional headless check: renders the Beast reference timbres with the real TinySynth in a headless
// browser (Chromium, Firefox or WebKit), through the player's own decodeSettings + createSynth, into
// an OfflineAudioContext, and
// measures the audio. The engine is loaded as PAGE carries it: PAGE's gzip tag and gunzip shim,
// which inflate the vendored fork build (scripts/engine.mjs) in the browser; the check first confirms
// that the shim replaced the tag with the engine, byte for byte. Then:
//
//   lead (A4)  mean pitch within 3 cents of 440 Hz; vibrato depth 30 +- 3 cents at 6 +- 0.3 Hz
//   kick       zero-crossing rate above 80 Hz at 20-40 ms and within 40-60 Hz at 100-160 ms;
//              silent after 200 ms
//   snare      noise burst: zero-crossing rate above 2 kHz in the first 20 ms; RMS falls at least
//              3x by 100-150 ms; silent after 200 ms
//
// and the custom waves of issue #2 (the reference waves, scripts/reference_waves.mjs, in the
// `reference_waves` settings fixture), registered by the player:
//
//   stepped triangle (A4, 64 steps, 4-bit)   mean pitch within 1 cent of 440 Hz; its stepped
//              character: harmonics 31 and 33 (the 4-bit steps) within 6 dB of the table's own
//              spectrum, where TinySynth's built-in, smooth triangle (the control) is 15 dB or more
//              below that
//   pulses (A4)   12.5%, 25% and 50%: the fraction of each cycle above the midpoint within 0.01
//   determinism   across two page loads: the buffers the engine generates (the seeded noise and
//              reverb impulse of fork #7, and the custom waves' tables) are identical, sample for
//              sample, and the same notes (custom voices, the custom chip kit, built-in drums on the
//              seeded noise, reverb 30) render to the same audio within 1e-6 (-120 dB). Not bit for
//              bit: when overlapping voices end, Chromium can mix the rest in another order, which
//              moves a sample by a float32 rounding step (about 6e-8).
//
// The engine's noise and reverb are seeded (fork #7), so they are the same on every load at a given
// sample rate; across browser engines the PCM differs, so the measurements use tolerances.
// Playwright is not a dependency of this repository; point the script at an existing install, and
// pick the engine (scripts/browsers.mjs):
//
//   PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core \
//   PLAYWRIGHT_BROWSER=chromium|firefox|webkit \
//   [CHROME=/path/to/chrome-headless-shell] [LD_LIBRARY_PATH=...] \
//   node scripts/render_check.mjs
//
// Exits 0 when every check passes, 1 when one fails, 2 when PLAYWRIGHT_CORE is not set or
// PLAYWRIGHT_BROWSER names no supported engine.

import { readFileSync } from "node:fs";
import { launchBrowser } from "./browsers.mjs";
import { engineSource } from "./engine.mjs";
import { GZIP_CLOSE, GZIP_OPEN, pageHtml, pageScripts } from "./page.mjs";
import { encodeSettings } from "../player/encode.js";
import { triangle4 } from "./reference_waves.mjs";
import { REFERENCE_WAVES_SETTINGS } from "./settings_fixtures.mjs";

const fixtures = JSON.parse(readFileSync(new URL("../tests/fixtures/settings.json", import.meta.url), "utf8"));
const textOf = (/** @type {string} */ name) => fixtures.valid.find((/** @type {any} */ f) => f.name === name).settings_text;
const beastText = textOf("beast_reference");
const wavesText = textOf("reference_waves");
// The measurements are made without reverb.
const dryText = encodeSettings({ ...REFERENCE_WAVES_SETTINGS, reverb: 0 });
// The control for the stepped triangle: the same voice on TinySynth's built-in (smooth) triangle.
const controlText = encodeSettings({
  ...REFERENCE_WAVES_SETTINGS,
  reverb: 0,
  timbres: [{ ...REFERENCE_WAVES_SETTINGS.timbres[0], operators: [{ ...REFERENCE_WAVES_SETTINGS.timbres[0].operators[0], wave: "Triangle" }] }],
});
// The player module, loaded as an inline module script that publishes its API for the test.
const playerModule = readFileSync(new URL("../player/settings.js", import.meta.url), "utf8") +
  "\nwindow.__player = { decodeSettings, createSynth };\n";
const SR = 48000;
/**
 * Renders notes through the player (decodeSettings and createSynth, so the custom waves are
 * registered as on the page) into an OfflineAudioContext at 48 kHz. `notes`: [channel, program,
 * note, on, off] (off 0: no note-off), times in seconds. Runs in the page.
 */
const RENDER = `window.__render = async (text, notes, dur) => {
  const Offline = window.OfflineAudioContext;
  window.AudioContext = function () { return Object.assign(new Offline(1, ${SR} * dur, ${SR}), { resume: () => Promise.resolve() }); };
  const synth = window.__player.createSynth(window.WebAudioTinySynth, window.__player.decodeSettings("   " + text));
  for (const [ch, program, note, on, off] of notes) {
    if (ch !== 9) synth.setProgram(ch, program);
    synth.noteOn(ch, note, 127, on);
    if (off) synth.noteOff(ch, note, off);
  }
  // The generated buffers: the seeded noise and reverb impulse (fork #7), and the custom waves.
  const data = (b) => [...Array(b.numberOfChannels)].flatMap((_, c) => Array.from(b.getChannelData(c)));
  const buffers = { conv: data(synth.convBuf), ...Object.fromEntries(Object.entries(synth.noiseBuf).map(([k, b]) => [k, data(b)])) };
  return { pcm: Array.from((await synth.actx.startRendering()).getChannelData(0)), buffers };
};`;

/** Mean pitch in cents from A4, from interpolated rising zero crossings between two times (s). */
function centsFromA4(/** @type {number[]} */ x, /** @type {number} */ a, /** @type {number} */ b) {
  const cross = [];
  for (let i = Math.round(a * SR) + 1; i < b * SR; i++) if (x[i - 1] <= 0 && x[i] > 0) cross.push(i - 1 + -x[i - 1] / (x[i] - x[i - 1]));
  return 1200 * Math.log2(SR / ((cross[cross.length - 1] - cross[0]) / (cross.length - 1)) / 440);
}
/** Amplitude of the frequency `f` over `n` samples from time `a`, Hann-windowed (a Goertzel sum). */
function amplitude(/** @type {number[]} */ x, /** @type {number} */ f, /** @type {number} */ a, /** @type {number} */ n) {
  let re = 0, im = 0;
  for (let i = 0; i < n; i++) {
    const v = x[Math.round(a * SR) + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n));
    re += v * Math.cos((2 * Math.PI * f * i) / SR);
    im -= v * Math.sin((2 * Math.PI * f * i) / SR);
  }
  return Math.hypot(re, im);
}
/** Harmonic `h` relative to the fundamental of an A4 note, in dB, over 0.5 s (220 cycles) from `a`. */
const harmonicDb = (/** @type {number[]} */ x, /** @type {number} */ h, /** @type {number} */ a) =>
  20 * Math.log10(amplitude(x, 440 * h, a, SR / 2) / amplitude(x, 440, a, SR / 2));
/** The same for the table itself, played sample-and-hold: its DFT, times the hold's sinc. */
function tableHarmonicDb(/** @type {number[]} */ t, /** @type {number} */ h) {
  const c = (/** @type {number} */ n) => {
    let re = 0, im = 0;
    t.forEach((v, i) => { re += v * Math.cos((2 * Math.PI * n * i) / t.length); im -= v * Math.sin((2 * Math.PI * n * i) / t.length); });
    const k = (Math.PI * n) / t.length;
    return Math.hypot(re, im) * Math.abs(Math.sin(k) / k);
  };
  return 20 * Math.log10(c(h) / c(1));
}
/** The fraction of the samples between two times above the midpoint of their range: a pulse's width. */
function duty(/** @type {number[]} */ x, /** @type {number} */ a, /** @type {number} */ b) {
  const w = x.slice(Math.round(a * SR), Math.round(b * SR));
  const mid = (Math.max(...w) + Math.min(...w)) / 2;
  return w.filter((v) => v > mid).length / w.length;
}

const { browser } = await launchBrowser();
let failed = 0;
try {
  const page = await browser.newPage();
  const errors = /** @type {string[]} */ ([]);
  page.on("pageerror", (e) => errors.push(String(e)));
  // The engine's gzip tag and the shim, exactly as in PAGE.
  const PAGE = pageHtml();
  const tag = PAGE.slice(PAGE.indexOf(GZIP_OPEN), PAGE.indexOf(GZIP_CLOSE) + GZIP_CLOSE.length);
  await page.setContent(`<!doctype html><title>render check</title>${tag}<script>${pageScripts(PAGE).shim}</script>`);
  const loaded = await page.evaluate(() => ({
    tags: document.querySelectorAll('script[type="text/javascript+gzip"]').length,
    engine: document.head.querySelector("script")?.textContent,
    defined: typeof (/** @type {any} */ (window).WebAudioTinySynth),
  }));
  const inflated = loaded.tags === 0 && loaded.engine === engineSource() && loaded.defined === "function";
  if (!inflated) failed++;
  console.log(`${inflated ? "PASS" : "FAIL"}  engine inflated from PAGE's gzip payload by PAGE's shim (${loaded.engine?.length} bytes)`);
  await page.addScriptTag({ type: "module", content: playerModule });
  await page.waitForFunction(() => "__player" in window);

  const m = await page.evaluate(async (text) => {
    const SR = 48000;
    const { decodeSettings, createSynth } = /** @type {any} */ (window).__player;
    const settings = decodeSettings("   " + text); // with alignment padding, as in the page
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

  // Custom waves (issue #2): the reference waves, registered by the player.
  await page.addScriptTag({ content: RENDER });
  /** @type {(text: string, notes: number[][], dur: number, on?: any) => Promise<{pcm: number[], buffers: Record<string, number[]>}>} */
  const render = (text, notes, dur, on = page) => on.evaluate(([t, n, d]) => /** @type {any} */ (window).__render(t, n, d), /** @type {const} */ ([text, notes, dur]));
  const tri = (await render(dryText, [[0, 0, 69, 0.05, 0]], 1)).pcm;
  const smooth = (await render(controlText, [[0, 0, 69, 0.05, 0]], 1)).pcm;
  const pulses = [];
  for (const program of [1, 2, 3]) pulses.push((await render(dryText, [[0, program, 69, 0.05, 0]], 1)).pcm);
  const table = triangle4();
  const stepped = [31, 33].map((h) => [h, harmonicDb(tri, h, 0.45), tableHarmonicDb(table, h), harmonicDb(smooth, h, 0.45)]);
  // Determinism: the custom voices, the custom chip kit, and built-in drums (seeded noise), with
  // reverb 30 (the seeded impulse), rendered in this page and again in a second page load.
  /** @type {number[][]} */
  const song = [[0, 0, 69, 0.05, 0.6], [1, 4, 45, 0.1, 0.7], [2, 1, 76, 0.15, 0.5], [9, 0, 36, 0.2, 0], [9, 0, 38, 0.35, 0],
    [9, 0, 42, 0.5, 0], [9, 0, 40, 0.6, 0], [9, 0, 46, 0.7, 0], [9, 0, 49, 0.8, 0], [9, 0, 39, 0.9, 0]];
  const first = await render(wavesText, song, 1.5);
  const again = await browser.newPage();
  again.on("pageerror", (/** @type {unknown} */ e) => errors.push(String(e)));
  await again.setContent(`<!doctype html><title>render check</title>${tag}<script>${pageScripts(PAGE).shim}</script>`);
  await again.addScriptTag({ type: "module", content: playerModule });
  await again.waitForFunction(() => "__player" in window);
  await again.addScriptTag({ content: RENDER });
  const second = await render(wavesText, song, 1.5, again);
  /** @param {number[]} a @param {number[]} b */
  const sameSamples = (a, b) => a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const names = Object.keys(first.buffers);
  const buffersDiffer = names.filter((k) => !sameSamples(first.buffers[k], second.buffers[k])).length +
    Math.abs(names.length - Object.keys(second.buffers).length);
  const pcmDiff = first.pcm.length === second.pcm.length ? Math.max(...first.pcm.map((v, i) => Math.abs(v - second.pcm[i]))) : Infinity;
  const pcmDiffering = first.pcm.filter((v, i) => !Object.is(v, second.pcm[i])).length;
  const songRms = Math.sqrt(first.pcm.reduce((a, v) => a + v * v, 0) / first.pcm.length);

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
    ["stepped triangle pitch (cents from A4)", centsFromA4(tri, 0.3, 0.95), (v) => Math.abs(v) <= 1, "|x| <= 1"],
    ...stepped.flatMap(([h, got, want, control]) => /** @type {Array<[string, number, (v: number) => boolean, string]>} */ ([
      [`stepped triangle harmonic ${h} (dB)`, got, (v) => Math.abs(v - want) <= 6, `${want.toFixed(1)} +- 6`],
      [`smooth triangle harmonic ${h} (dB, control)`, control, (v) => v <= got - 15, `<= ${(got - 15).toFixed(1)}`],
    ])),
    ...[0.125, 0.25, 0.5].map((want, i) => /** @type {[string, number, (v: number) => boolean, string]} */ (
      [`${want * 100}% pulse width`, duty(pulses[i], 0.3, 0.95), (v) => Math.abs(v - want) <= 0.01, `${want} +- 0.01`])),
    [`two loads: generated buffers that differ (of ${names.length}: ${names.join(", ")})`, buffersDiffer, (v) => v === 0, "0"],
    [`two loads: largest sample difference (${pcmDiffering} of ${first.pcm.length} differ)`, pcmDiff, (v) => v <= 1e-6, "<= 1e-6"],
    ["two loads: the render is not silent (RMS)", songRms, (v) => v > 0.01, "> 0.01"],
  ];
  for (const [name, value, ok, want] of checks) {
    const pass = ok(value);
    if (!pass) failed++;
    const shown = value && Math.abs(value) < 1e-3 ? value.toExponential(2) : value.toFixed(4);
    console.log(`${pass ? "PASS" : "FAIL"}  ${name.padEnd(38)} ${shown.padStart(12)}   want ${want}`);
  }
  if (errors.length) {
    failed++;
    console.log("FAIL  page errors:", errors);
  }
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
