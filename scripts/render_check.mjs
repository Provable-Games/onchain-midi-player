#!/usr/bin/env node
// @ts-check
// Optional headless check: renders the Beast reference timbres with the real TinySynth in a headless
// browser (Chromium, Firefox or WebKit), through the player's own decodeSettings + createSynth, into
// an OfflineAudioContext, and
// measures the audio. The engine is loaded from the combined MIDI gzip fragment and shared loader,
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
//              seeded noise, reverb 30) render to the same audio: bit for bit on Firefox, within 80
//              float32 ULPs (about 9.5e-6, -100 dB) of the render's peak on Chromium and WebKit
//              (see PCM_TOLERANCE)
//
// and the filters of issue #3 (the `filters` settings fixture, FILTER_SETTINGS), installed by the
// player, each measured against the same voice without its filter (filtered / unfiltered, harmonic
// by harmonic, is the filter's response; the master volume is low enough that the engine's
// compressor is linear, which the check confirms):
//
//   low-, high- and band-pass (1 kHz; Q 0.7071, 0.7071, 4) on a sawtooth at A2: the response at
//              every harmonic up to 12 kHz within 1 dB of the Web Audio biquad's (the RBJ formulas;
//              Q in dB = 20 log10(q) for low- and high-pass), where that is above -30 dB
//   key_track  a low-pass at 4x the note frequency at A2 and at A4: the same, at 440 and 1,760 Hz,
//              so harmonic 8 (twice the cutoff) is attenuated alike at both notes (within 0.5 dB)
//   clamp      a cutoff at the u32 maximum (429,496.7295 Hz), fixed or key-tracked, renders
//              sample for sample as 21,600 Hz (0.45 x 48 kHz), unlike 20,000 Hz, with no NaN
//   hi-hats    the high-passed metallic-noise hats (3 kHz): at least 24 dB less energy below
//              1 kHz than above 4 kHz (issue #3's criterion); the same hats unfiltered, for scale
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
import { fixedFragment } from "./segments.mjs";
import { encodeSettings } from "../player/encode.js";
import { triangle4 } from "./reference_waves.mjs";
import { FILTER_SETTINGS, REFERENCE_WAVES_SETTINGS } from "./settings_fixtures.mjs";

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
// Filters (issue #3): FILTER_SETTINGS at a master volume low enough for the engine's compressor to be
// linear (FILTER_VOL percent, and twice that to show it), and the same timbres without their filters.
const FILTER_VOL = 2;
/** @param {Partial<import("../player/settings.js").TinySynthSettings>} fields @param {(o: any, t: any) => any} [edit] */
const filterText = (fields = {}, edit = (o) => o) => encodeSettings({
  ...FILTER_SETTINGS, master_vol: FILTER_VOL, ...fields,
  timbres: FILTER_SETTINGS.timbres.map((t) => ({ ...t, operators: t.operators.map((o) => edit(o, t)) })),
});
const filteredText = filterText();
const unfilteredText = filterText({}, (o) => ({ ...o, filter: null }));
const louderText = filterText({ master_vol: 2 * FILTER_VOL }, (o) => ({ ...o, filter: null }));
const U32_MAX = 4294967295;
/** Program 0 (the 1 kHz low-pass) with another cutoff, stored, and key tracking. */
const cutoffText = (/** @type {number} */ cutoff, key_track = false) =>
  filterText({}, (o, t) => (t.slot === 0 && !t.drum ? { ...o, filter: { ...o.filter, cutoff, key_track } } : o));
// The player module, loaded as an inline module script that publishes its API for the test.
const playerModule = readFileSync(new URL("../player/settings.js", import.meta.url), "utf8") +
  "\nwindow.__player = { decodeSettings, createSynth };\n";
const SR = 48000;
// The two-load PCM tolerance. Firefox renders the same notes bit for bit. Chromium and WebKit sum
// the voices (and Chromium convolves the reverb) in float32, and the rounding differs between loads:
// over 30 runs each, the largest difference was 8 ULPs of the song's peak (9.5e-7; the song peaks at
// about 1.4, where a float32 ULP is 2^-23 = 1.19e-7) on Chromium and 3 ULPs on WebKit. 80 ULPs is
// 10x that, still about 1e-5 of full scale, far below what different noise or reverb buffers would
// change (those are also compared exactly, above), so it passes the rounding and fails a real change.
const PCM_TOLERANCE = (/** @type {string} */ engine) => (engine === "firefox" ? 0 : 80 * 2 ** -23);
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
  // The generated buffers: the seeded noise and reverb impulse (fork #7), and the custom waves. The
  // engine builds n1 lazily (read explicitly here, which builds it) and the impulse only with reverb.
  const data = (b) => [...Array(b.numberOfChannels)].flatMap((_, c) => Array.from(b.getChannelData(c)));
  const reverb = !!synth.useReverb;
  const noise = synth.noiseBuf;
  const buffers = { ...(reverb ? { conv: data(synth.convBuf) } : {}), n0: data(noise.n0), n1: data(noise.n1),
    ...Object.fromEntries(Object.entries(noise).filter(([k]) => k !== "n0" && k !== "n1").map(([k, b]) => [k, data(b)])) };
  return { pcm: Array.from((await synth.actx.startRendering()).getChannelData(0)), buffers, reverb, convNull: synth.convBuf === null };
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
/**
 * The Web Audio biquad's response in dB at `f` (the spec's RBJ formulas at 48 kHz) for a cutoff or
 * centre `f0` and the linear Q `q` the player passes: TinySynth gives low- and high-pass
 * Q = 20 log10(q) dB, whose alpha is sin(w0) / (2 x 10^(Q/20)) = sin(w0) / (2q), and band-pass Q = q.
 */
function biquadDb(/** @type {"LowPass" | "HighPass" | "BandPass"} */ kind, /** @type {number} */ f0, /** @type {number} */ q, /** @type {number} */ f) {
  const w0 = (2 * Math.PI * f0) / SR, c = Math.cos(w0), alpha = Math.sin(w0) / (2 * q);
  const b = kind === "LowPass" ? [(1 - c) / 2, 1 - c, (1 - c) / 2] : kind === "HighPass" ? [(1 + c) / 2, -(1 + c), (1 + c) / 2] : [alpha, 0, -alpha];
  const a = [1 + alpha, -2 * c, 1 - alpha];
  const w = (2 * Math.PI * f) / SR;
  const mag = (/** @type {number[]} */ k) => Math.hypot(k[0] + k[1] * Math.cos(w) + k[2] * Math.cos(2 * w), k[1] * Math.sin(w) + k[2] * Math.sin(2 * w));
  return 20 * Math.log10(mag(b) / mag(a));
}
/**
 * A filter's measured response at each harmonic of `f0` up to 12 kHz: filtered / unfiltered, in dB,
 * over 0.5 s from 0.3 s, with the biquad's expected response; `[harmonic, measured, expected]`.
 */
function response(/** @type {number[]} */ filtered, /** @type {number[]} */ unfiltered, /** @type {number} */ f0, /** @type {(f: number) => number} */ expected) {
  const out = [];
  for (let h = 1; h * f0 <= 12000; h++) {
    out.push([h, 20 * Math.log10(amplitude(filtered, h * f0, 0.3, SR / 2) / amplitude(unfiltered, h * f0, 0.3, SR / 2)), expected(h * f0)]);
  }
  return out;
}
/** The largest |measured - expected| where the expected response is above -30 dB. */
const worstError = (/** @type {number[][]} */ r) => Math.max(...r.filter(([, , e]) => e > -30).map(([, m, e]) => Math.abs(m - e)));
/** Energy below `lo` Hz over energy above `hi` Hz, in dB, over 2^14 samples from `a` s (a radix-2 FFT). */
function bandRatioDb(/** @type {number[]} */ x, /** @type {number} */ a, /** @type {number} */ lo, /** @type {number} */ hi) {
  const n = 1 << 14, re = new Float64Array(n), im = new Float64Array(n), from = Math.round(a * SR);
  for (let i = 0; i < n; i++) re[i] = x[from + i] ?? 0;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) [re[i], re[j], im[i], im[j]] = [re[j], re[i], im[j], im[i]];
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k), wi = Math.sin(ang * k), p = i + k, q = p + len / 2;
        const tr = re[q] * wr - im[q] * wi, ti = re[q] * wi + im[q] * wr;
        re[q] = re[p] - tr; im[q] = im[p] - ti; re[p] += tr; im[p] += ti;
      }
    }
  }
  let low = 0, high = 0;
  for (let k = 0; k <= n / 2; k++) {
    const f = (k * SR) / n, e = re[k] * re[k] + im[k] * im[k];
    if (f < lo) low += e;
    else if (f > hi) high += e;
  }
  return 10 * Math.log10(high / low);
}
/** The fraction of the samples between two times above the midpoint of their range: a pulse's width. */
function duty(/** @type {number[]} */ x, /** @type {number} */ a, /** @type {number} */ b) {
  const w = x.slice(Math.round(a * SR), Math.round(b * SR));
  const mid = (Math.max(...w) + Math.min(...w)) / 2;
  return w.filter((v) => v > mid).length / w.length;
}

const { browser, engine } = await launchBrowser();
const pcmTolerance = PCM_TOLERANCE(engine);
let failed = 0;
try {
  const page = await browser.newPage();
  const errors = /** @type {string[]} */ ([]);
  page.on("pageerror", (e) => errors.push(String(e)));
  // The engine's gzip tag and the shim, exactly as served by their provider fragments.
  const tag = fixedFragment("player");
  const html = `<!doctype html><title>render check</title>${fixedFragment("gunzip")}${tag}<script type="text/plain" id="onchain-midi-settings">1,1,30,40,64,0,0</script><script type="text/plain" id="onchain-midi-data">TVRoZAAAAAYAAAABAGBNVHJrAAAADACQPGRggDwAAP8vAA==</script>`;
  await page.setContent(html);
  await page.evaluate(async()=>{await window.OnchainLibraries.ready;await window.OnchainMidiPlayer.ready;});
  const loaded = await page.evaluate(() => ({
    tags: document.querySelectorAll('script[type="text/javascript+gzip"]').length,
    engine: document.getElementById("onchain-midi-player")?.textContent,
    defined: typeof (/** @type {any} */ (window).WebAudioTinySynth),
  }));
  const inflated = loaded.tags === 0 && loaded.engine?.slice(0, engineSource().length) === engineSource() && loaded.defined === "function";
  if (!inflated) failed++;
  console.log(`${inflated ? "PASS" : "FAIL"}  engine inflated from combined MIDI and shared loader segments (${loaded.engine?.length} bytes)`);
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
  /** @type {(text: string, notes: number[][], dur: number, on?: any) => Promise<{pcm: number[], buffers: Record<string, number[]>, reverb: boolean, convNull: boolean}>} */
  const render = (text, notes, dur, on = page) => on.evaluate(([t, n, d]) => /** @type {any} */ (window).__render(t, n, d), /** @type {const} */ ([text, notes, dur]));
  const dry = await render(dryText, [[0, 0, 69, 0.05, 0]], 1);
  const tri = dry.pcm;
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
  await again.setContent(html);
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

  // Filters (issue #3): each filtered voice against itself unfiltered.
  const pcm = async (/** @type {string} */ text, /** @type {number[]} */ n, dur = 1) => (await render(text, [n], dur)).pcm;
  /** @type {Record<string, [number[], number[]]>} */
  const pairs = {};
  for (const [name, program, note] of /** @type {Array<[string, number, number]>} */ ([["lp", 0, 45], ["hp", 1, 45], ["bp", 2, 45], ["kt45", 3, 45], ["kt69", 3, 69]])) {
    pairs[name] = [await pcm(filteredText, [0, program, note, 0.05, 0]), await pcm(unfilteredText, [0, program, note, 0.05, 0])];
  }
  const louder = await pcm(louderText, [0, 0, 45, 0.05, 0]);
  const linearDb = 20 * Math.log10(amplitude(louder, 110, 0.3, SR / 2) / amplitude(pairs.lp[1], 110, 0.3, SR / 2));
  const [lpOp, hpOp, bpOp, ktOp] = FILTER_SETTINGS.timbres.slice(0, 4).map((t) => /** @type {any} */ (t.operators[0].filter));
  const fx = (/** @type {number} */ v) => v / 10000;
  const curve = (/** @type {any} */ f, /** @type {number} */ f0) => (/** @type {number} */ hz) => biquadDb(f.kind, f.key_track ? fx(f.cutoff) * f0 : fx(f.cutoff), fx(f.q), hz);
  const lp = response(...pairs.lp, 110, curve(lpOp, 110));
  const hp = response(...pairs.hp, 110, curve(hpOp, 110));
  const bp = response(...pairs.bp, 110, curve(bpOp, 110));
  const kt45 = response(...pairs.kt45, 110, curve(ktOp, 110));
  const kt69 = response(...pairs.kt69, 440, curve(ktOp, 440));
  const at = (/** @type {number[][]} */ r, /** @type {number} */ h) => /** @type {number[]} */ (r.find(([k]) => k === h));
  // The 0.45 x SR clamp: the cutoff at the u32 maximum, fixed and key-tracked, as 21,600 Hz.
  const a4 = /** @type {number[]} */ ([0, 0, 69, 0.05, 0]);
  const clampMax = await pcm(cutoffText(U32_MAX), a4);
  const clampKey = await pcm(cutoffText(U32_MAX, true), a4);
  const clamp216 = await pcm(cutoffText(216000000), a4);
  const clamp200 = await pcm(cutoffText(200000000), a4);
  const nans = [clampMax, clampKey].reduce((a, x) => a + x.filter((v) => !Number.isFinite(v)).length, 0);
  // The hats, filtered and not: the hit from note-on.
  const hats = [];
  for (const note of [42, 46]) {
    hats.push([note, bandRatioDb(await pcm(filteredText, [9, 0, note, 0.05, 0], 0.5), 0.05, 1000, 4000),
      bandRatioDb(await pcm(unfilteredText, [9, 0, note, 0.05, 0], 0.5), 0.05, 1000, 4000)]);
  }
  const dbLine = (/** @type {string} */ name, /** @type {number[][]} */ r, /** @type {number} */ h, tol = 1) => /** @type {[string, number, (v: number) => boolean, string]} */ (
    [name, at(r, h)[1], (v) => Math.abs(v - at(r, h)[2]) <= tol, `${at(r, h)[2].toFixed(1)} +- ${tol}`]);

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
    ["reverb 0: no impulse (convBuf is null)", dry.reverb === false && dry.convNull ? 1 : 0, (v) => v === 1, "1"],
    ["reverb 30: the impulse is built", first.reverb && first.buffers.conv ? 1 : 0, (v) => v === 1, "1"],
    [`two loads: generated buffers that differ (of ${names.length}: ${names.join(", ")})`, buffersDiffer, (v) => v === 0, "0"],
    [`two loads: largest sample difference (${pcmDiffering} of ${first.pcm.length} differ)`, pcmDiff, (v) => v <= pcmTolerance, `<= ${pcmTolerance.toExponential(2)}`],
    ["two loads: the render is not silent (RMS)", songRms, (v) => v > 0.01, "> 0.01"],
    ["filters: compressor linear (2x master vol, dB)", linearDb, (v) => Math.abs(v - 20 * Math.log10(2)) <= 0.05, "6.02 +- 0.05"],
    ["low-pass 1 kHz: worst error, 110 Hz-12 kHz (dB)", worstError(lp), (v) => v <= 1, "<= 1"],
    dbLine("low-pass 1 kHz: at 3,960 Hz (dB)", lp, 36),
    ["high-pass 1 kHz: worst error, 110 Hz-12 kHz (dB)", worstError(hp), (v) => v <= 1, "<= 1"],
    dbLine("high-pass 1 kHz: at 220 Hz (dB)", hp, 2),
    ["band-pass 1 kHz Q 4: worst error (dB)", worstError(bp), (v) => v <= 1, "<= 1"],
    dbLine("band-pass 1 kHz Q 4: at 990 Hz (dB)", bp, 9),
    dbLine("band-pass 1 kHz Q 4: at 220 Hz (dB)", bp, 2),
    dbLine("band-pass 1 kHz Q 4: at 3,960 Hz (dB)", bp, 36),
    ["key-tracked low-pass x4 at A2: worst error (dB)", worstError(kt45), (v) => v <= 1, "<= 1"],
    ["key-tracked low-pass x4 at A4: worst error (dB)", worstError(kt69), (v) => v <= 1, "<= 1"],
    dbLine("key-tracked x4: harmonic 8 at A2 (dB)", kt45, 8),
    ["key-tracked x4: harmonic 8, A4 minus A2 (dB)", at(kt69, 8)[1] - at(kt45, 8)[1], (v) => Math.abs(v) <= 0.5, "0 +- 0.5"],
    ["clamp: u32 max cutoff = 21,600 Hz (samples that differ)", clampMax.filter((v, i) => !Object.is(v, clamp216[i])).length, (v) => v === 0, "0"],
    ["clamp: key-tracked u32 max = 21,600 Hz (differ)", clampKey.filter((v, i) => !Object.is(v, clamp216[i])).length, (v) => v === 0, "0"],
    ["clamp: 20,000 Hz differs (samples that differ)", clamp200.filter((v, i) => !Object.is(v, clamp216[i])).length, (v) => v > 0, "> 0"],
    ["clamp: non-finite samples", nans, (v) => v === 0, "0"],
    ["clamp: the render is not silent (RMS)", Math.sqrt(clampMax.reduce((a, v) => a + v * v, 0) / clampMax.length), (v) => v > 1e-4, "> 1e-4"],
    ...hats.flatMap(([note, got, control]) => /** @type {Array<[string, number, (v: number) => boolean, string]>} */ ([
      [`hat ${note}, 3 kHz high-pass: >4 kHz over <1 kHz (dB)`, got, (v) => v >= 24, ">= 24"],
      [`hat ${note} unfiltered (control, dB)`, control, (v) => v < got, `< ${got.toFixed(1)}`],
    ])),
  ];
  for (const [name, value, ok, want] of checks) {
    const pass = ok(value);
    if (!pass) failed++;
    const shown = value && Math.abs(value) < 1e-3 ? value.toExponential(2) : value.toFixed(4);
    console.log(`${pass ? "PASS" : "FAIL"}  ${name.padEnd(50)} ${shown.padStart(12)}   want ${want}`);
  }
  if (errors.length) {
    failed++;
    console.log("FAIL  page errors:", errors);
  }
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
