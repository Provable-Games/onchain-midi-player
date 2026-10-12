#!/usr/bin/env node
// @ts-check
// Long-session check (.github/workflows/drift.yml runs it for 10 minutes weekly and on demand):
// does the art stay in sync with the sound over a whole session (issue #11: drift over a
// 10-minute session, audio clock against image animation)? The player restarts
// the art on ▶ and again at every pass, each time timed to the pass's tick 0 as heard (TinySynth's
// startTime plus the output latency). Between restarts the art runs on the page's clock (the
// image's animation timeline), the sound on the AudioContext's, and TinySynth loops on its own
// schedule, so the two can drift apart by at most what one pass lets them. The probe sweeps once
// per pass, so the pass is a whole multiple of the art's period and the restarts must not show.
// On Chromium, Firefox or WebKit, this plays for --minutes and checks:
//
//   art against sound  At each checkpoint (every --every seconds), seven screenshots of a probe
//                      art: a bar that sweeps the frame once per pass of the song, repeating. The
//                      bar's position gives the art's phase; the AudioContext clock less
//                      outputLatency (what the player assumes is heard) gives the sound's. Their
//                      difference (the art's offset; the median of the seven) must not drift: the
//                      least-squares trend through the checkpoints may change by at most 20 ms over
//                      the session, half of EBU R37's 40 ms tolerance for sound ahead of picture,
//                      and no checkpoint may be more than 20 ms off that trend.
//   the loop schedule  Every pass starts on the grid t0 + k x the pass length that the MIDI's own
//                      tempo map gives (checkMidi: the fixture's midi_loop_seconds), to 1 µs, with
//                      no pass missing: the tempo stays right and the loop seamless all session.
//   the scheduler      No message is scheduled behind the audio clock (a late note).
//   the restarts       The art restarted at (at least 90% of) the passes heard after ▶. The player
//                      skips a pass whose start is already past when it sees it (a stalled page),
//                      so a few may be missing; the count is printed.
//   the clocks         Printed: the audio clock against the page clock (performance.now()), as the
//                      change in their offset over the session, as a rate in ppm and as its largest
//                      step (a stall of the audio clock, an underrun, is a negative one), and the
//                      art against the page clock. The art's offset from the sound is the sum of
//                      the two, so a failure shows which side moved.
//
// It also checks that the page still plays at the end, that ■ stops it, and that nothing is logged
// as an error or requested over the network.
//
// The page is the beast_140bpm page fixture: its token_uri is checked against the digest that the
// class's output is pinned to (scripts/fixture_pages.mjs) and decoded. Its art, the consumer's
// input and not the class's output, is then replaced by the probe; PAGE ++ D, all the class
// contributes, is unchanged. It is loaded as an offline data: URI.
//
// Usage (the engine as in scripts/browsers.mjs; Firefox plays audio only with an output device,
// which a PulseAudio null sink provides on a machine without one: see docs/development.md, "Browser validation"):
//
//   PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core PLAYWRIGHT_BROWSER=chromium|firefox|webkit \
//   node scripts/drift_check.mjs [--minutes 10] [--every 10] [out_dir]
//
// --minutes is the session after ▶ (default 10). Checkpoints are at 0, --every, 2 x --every, ...
// and always at the session's end, so there are at least two. --drift-info prints the art's drift
// from the sound instead of checking it: CI runs 1 minute that way, because in a minute one stall
// of a headless audio clock (about 30 ms) or Firefox's fast image clock can exceed the limit while
// the page does nothing wrong; the other checks still apply. With out_dir, it writes
// drift_check_result.json (every checkpoint and the summary) and screenshots of the first and last
// checkpoints there. Exits 0 when every check passes, 1 when one fails, 2 on bad arguments or when
// PLAYWRIGHT_CORE is not set or PLAYWRIGHT_BROWSER names no supported engine.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { collectErrors, launchBrowser } from "./browsers.mjs";
import { DRIFT_LIMITS, artOffsetMs, barMoved, barX, checkpointTimes, clockAt, clockDrift, largestStep, leads, median, passGrid, passStarts, trend, withinDriftLimits } from "./drift.mjs";
import { fixtureCase, tokenPage } from "./fixture_pages.mjs";
import { ART_OPEN, HTML_PREFIX, VERSION, b64 } from "./page.mjs";
import { decodePng } from "./png.mjs";

const USAGE = "usage: node scripts/drift_check.mjs [--minutes 10] [--every 10] [--drift-info] [out_dir]";
/** @type {{minutes: number, every: number, driftInfo: boolean, outDir: string | undefined}} */
let opts;
try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      minutes: { type: "string", default: "10" },
      every: { type: "string", default: "10" },
      "drift-info": { type: "boolean", default: false },
    },
  });
  opts = { minutes: Number(values.minutes), every: Number(values.every), driftInfo: !!values["drift-info"], outDir: positionals[0] };
  if (!(opts.minutes > 0) || !(opts.every > 0) || positionals.length > 1) throw new Error(USAGE);
} catch (e) {
  console.error(/** @type {Error} */ (e).message);
  process.exit(2);
}
const { minutes, every, driftInfo, outDir } = opts;

const MAX_GRID_ERROR = 1e-6; // pass starts against the tempo map's grid, in seconds
const SHOTS = 7; // screenshots per checkpoint
const CLOCK_WINDOW_MS = 3000; // clock samples within this of a screenshot time it (clockAt)
const W = 400, H = 100, TRAVEL = 390; // the probe: a 10-pixel bar from x = 0 to x = 390
const ROW = 20; // the strip the screenshots take, clear of the ▶/■ button in the bottom-right corner
const LEAD_NOTE = 72; // the riff's first note, at tick 0 of every pass

const c = fixtureCase("beast_140bpm");
const PASS = c.midi_loop_seconds; // from the MIDI's tempo map, not from the engine
const dur = PASS.toFixed(6);
if (Math.abs(Number(dur) - PASS) > 1e-12) throw new Error(`pass length ${PASS} s does not fit the probe's dur attribute`);
/** The probe art: a white bar sweeping x = 0..390 over one pass, repeating. */
const PROBE =
  `<svg xmlns='http://www.w3.org/2000/svg' width='${W}' height='${H}' viewBox='0 0 ${W} ${H}'>` +
  `<rect width='${W}' height='${H}' fill='#000'/>` +
  `<rect width='10' height='${H}' fill='#fff'><animate attributeName='x' from='0' to='${TRAVEL}' dur='${dur}s' repeatCount='indefinite'/></rect>` +
  "</svg>";
const { html } = tokenPage(c);
const artAt = html.lastIndexOf(ART_OPEN) + ART_OPEN.length;
if (artAt < ART_OPEN.length || html.slice(artAt) !== c.svg) throw new Error("art block not found");
const URL_ = HTML_PREFIX + b64(html.slice(0, artAt) + PROBE);

let failures = 0;
/** @param {boolean} cond @param {string} msg */
function check(cond, msg) {
  console.log(`  ${cond ? "ok  " : "FAIL"} ${msg}`);
  if (!cond) failures++;
}
const info = (/** @type {string} */ msg) => console.log(`  info ${msg}`);
const clock = (/** @type {number} */ s) => `${Math.floor(Math.round(s) / 60)}:${String(Math.round(s) % 60).padStart(2, "0")}`;
const ms = (/** @type {number} */ s) => (1000 * s).toFixed(1);

/**
 * Runs before the page's scripts: wraps the engine constructor to record the synth, every message
 * it schedules (with the AudioContext time when it was scheduled) and each playMIDI, then samples
 * the audio clock against the page clock every 250 ms; and records when each art <img> enters
 * the document.
 */
function instrument() {
  /** @type {any} */
  const st = { constructed: 0, synth: null, plays: [], sends: [], imgs: [], clock: [] };
  /** @type {any} */ (window).__drift = st;
  /** @type {any} */
  let Real;
  function Wrapped(/** @type {any} */ o) {
    st.constructed++;
    const synth = new Real(o);
    st.synth = synth;
    const ctx = synth.getAudioContext();
    const send = synth.send;
    synth.send = (/** @type {number[]} */ m, /** @type {number} */ t) => {
      if (t !== undefined) st.sends.push([m[0], m[1], m[2], t, ctx.currentTime]);
      return send(m, t);
    };
    const play = synth.playMIDI;
    synth.playMIDI = () => {
      play();
      st.plays.push({ at: performance.now(), startTime: synth.getPlayStatus().startTime, currentTime: ctx.currentTime });
      if (st.plays.length === 1) setInterval(() => st.clock.push([performance.now(), ctx.currentTime]), 250);
    };
    return synth;
  }
  Object.defineProperty(window, "WebAudioTinySynth", { configurable: true, get: () => Real && Wrapped, set: (v) => { Real = v; } });
  new MutationObserver((records) => {
    for (const r of records) for (const n of r.addedNodes) if (n.nodeName === "IMG") st.imgs.push({ at: performance.now(), src: /** @type {HTMLImageElement} */ (n).src });
  }).observe(document, { childList: true, subtree: true });
}

const { browser, engine } = await launchBrowser();
console.log(`${c.name} page (the class's output, art replaced by a probe sweeping once per ${PASS} s pass), offline data: URI; ${minutes} min, a checkpoint every ${every} s`);
// WebKit's offline emulation also fails the page's own blob: media, so there every other request is
// aborted and listed instead.
const context = await browser.newContext({ viewport: { width: W, height: H }, offline: engine !== "webkit" });
await context.addInitScript(instrument);
/** @type {string[]} */
const blocked = [];
await context.route("**/*", (/** @type {any} */ route) => {
  const url = route.request().url();
  if (url.startsWith("data:") || url.startsWith("blob:")) return route.continue(); // not network: the page's own blob: media
  blocked.push(url);
  return route.abort();
});
const page = await context.newPage();
const logged = collectErrors(page);
/** @type {any[]} */
const rows = [];
/** @type {Record<string, any>} */
const summary = {};

/**
 * One checkpoint: SHOTS screenshots of a strip across the bar, each timed at the midpoint of
 * performance.now() before and after it (taken as the time of the frame it shows), with
 * outputLatency read just before. The AudioContext time at that moment comes from the clock
 * samples around it (clockAt), read once the screenshots are done.
 * @param {number} k
 * @param {number} t seconds since the session started
 * @param {number} start the first pass's start, in AudioContext time
 * @param {boolean} last
 */
async function checkpoint(k, t, start, last) {
  /** @type {Array<{x: number, mid: number, span: number, outputLatency: number}>} */
  const shots = [];
  for (let i = 0; i < SHOTS; i++) {
    if (i) await page.waitForTimeout(150);
    const before = await page.evaluate(() => [performance.now(), /** @type {any} */ (window).__drift.synth.getAudioContext().outputLatency || 0]);
    const png = decodePng(await page.screenshot({ clip: { x: 0, y: ROW - 5, width: W, height: 10 } }));
    const after = await page.evaluate(() => performance.now());
    shots.push({ x: barX(png, 5), mid: (before[0] + after) / 2, span: after - before[0], outputLatency: before[1] });
  }
  // Clock samples up to a window past the last screenshot.
  await page.waitForTimeout(CLOCK_WINDOW_MS / 2);
  const samples = await page.evaluate((/** @type {number} */ from) => /** @type {any} */ (window).__drift.clock.filter((/** @type {number[]} */ c) => c[0] >= from), shots[0].mid - CLOCK_WINDOW_MS);
  const offsets = shots.map((s) => (s.x < 0 ? NaN : artOffsetMs(s.x, TRAVEL, PASS, clockAt(samples, s.mid, CLOCK_WINDOW_MS) - s.outputLatency, start)));
  const found = shots.every((s) => s.x >= 0);
  const row = {
    k, t: Math.round(t * 10) / 10, found,
    offsetMs: found ? median(offsets) : NaN,
    // The audio clock against the page clock around the screenshots, for the art against the page.
    clockMs: median(samples.map((/** @type {number[]} */ c) => 1000 * c[1] - c[0])),
    spreadMs: found ? Math.max(...offsets) - Math.min(...offsets) : NaN,
    shotMs: Math.max(...shots.map((s) => s.span)),
    outputLatencyMs: 1000 * shots[0].outputLatency,
    xs: shots.map((s) => s.x),
  };
  info(`${clock(t)}  art - sound ${found ? `${row.offsetMs >= 0 ? "+" : ""}${row.offsetMs.toFixed(1)} ms` : "bar not found"}` +
    ` (spread ${row.spreadMs.toFixed(1)} ms; screenshots <= ${row.shotMs.toFixed(0)} ms; outputLatency ${row.outputLatencyMs.toFixed(1)} ms)`);
  if (outDir && (k === 0 || last)) await page.screenshot({ path: join(outDir, `drift_${k === 0 ? "first" : "last"}.png`) });
  return row;
}

try {
  await page.goto(URL_);
  await page.waitForFunction(() => {
    const b = /** @type {HTMLButtonElement | null} */ (document.getElementById("play"));
    const e = document.getElementById("error");
    return b && (!b.disabled || (e && !e.hidden));
  });
  check(!(await page.$eval("#play", (/** @type {HTMLButtonElement} */ b) => b.disabled)), "▶ enabled");
  const t0 = Date.now();
  await page.click("#play");
  // Started, and the art restarted: the second <img> is swapped in once decoded.
  await page.waitForFunction(() => {
    const st = /** @type {any} */ (window).__drift;
    return st.plays.length >= 1 && st.imgs.length >= 2;
  }, null, { timeout: 15000 });
  const start = await page.evaluate(() => /** @type {any} */ (window).__drift.plays[0].startTime);
  info(`▶ to the art restart: ${Date.now() - t0} ms`);

  const session = Date.now();
  const times = checkpointTimes(minutes * 60, every);
  for (let k = 0; k < times.length; k++) {
    const wait = session + times[k] * 1000 - Date.now();
    if (wait > 0) await page.waitForTimeout(wait);
    rows.push(await checkpoint(k, (Date.now() - session) / 1000, start, k === times.length - 1));
  }

  const end = await page.evaluate(() => {
    const st = /** @type {any} */ (window).__drift;
    const ctx = st.synth.getAudioContext();
    return { sends: st.sends, clock: st.clock, plays: st.plays.length, imgs: st.imgs.length, constructed: st.constructed, playing: st.synth.playing, state: ctx.state, time: ctx.currentTime };
  });

  const found = rows.every((r) => r.found);
  // Found and moving: a frozen art would keep the bar in place, which only the drift (not checked
  // with --drift-info) would otherwise show.
  const stuck = rows.filter((r) => !barMoved(r.xs)).map((r) => clock(r.t));
  check(found && !stuck.length, `the art ran all session: the bar found, and moving, in the ${SHOTS} screenshots of each of the ${rows.length} checkpoints` +
    (stuck.length ? `; still at ${stuck.join(", ")}` : ""));
  const art = found ? trend(rows.map((r) => [r.t, r.offsetMs])) : { driftMs: NaN, maxResidualMs: NaN };
  Object.assign(summary, {
    firstOffsetMs: rows[0].offsetMs, lastOffsetMs: rows[rows.length - 1].offsetMs, artDriftMs: art.driftMs, maxResidualMs: art.maxResidualMs,
    maxSpreadMs: Math.max(...rows.map((r) => r.spreadMs)), maxShotMs: Math.max(...rows.map((r) => r.shotMs)),
    outputLatencyMs: [Math.min(...rows.map((r) => r.outputLatencyMs)), Math.max(...rows.map((r) => r.outputLatencyMs))],
  });
  const drift = `the art's offset from the sound drifted ${art.driftMs >= 0 ? "+" : ""}${art.driftMs.toFixed(1)} ms over ${clock(rows[rows.length - 1].t - rows[0].t)} ` +
    `(trend through ${rows.length} checkpoints, from ${rows[0].offsetMs.toFixed(1)} ms; at most ${DRIFT_LIMITS.driftMs}), ` +
    `no checkpoint more than ${art.maxResidualMs.toFixed(1)} ms off the trend (at most ${DRIFT_LIMITS.residualMs})`;
  if (driftInfo) info(`${drift}: ${withinDriftLimits(art) ? "within" : "beyond"} the limits, not checked (--drift-info)`);
  else check(withinDriftLimits(art), drift);

  const grid = passGrid(passStarts(end.sends, LEAD_NOTE, PASS), PASS);
  const heardPasses = Math.floor((end.time - start) / PASS) + 1;
  Object.assign(summary, { passes: grid.passes, maxGridErrorUs: grid.maxError * 1e6 });
  check(grid.consecutive && grid.passes >= heardPasses && grid.maxError <= MAX_GRID_ERROR,
    `${grid.passes} passes, none missing, each starting on startTime + k x ${PASS} s (the MIDI's tempo map): largest error ${(grid.maxError * 1e6).toFixed(3)} µs`);

  // imgs: the art shown on load, the restart on ▶, then one per pass (each swapped in once decoded).
  const passRestarts = end.imgs - 2;
  Object.assign(summary, { passRestarts, passesSincePlay: heardPasses - 1 });
  // At most one per pass heard; one more is tolerated, since a restart lands a few ms after its pass
  // starts and the audio clock read with the images can still be just short of that start.
  check(passRestarts >= 0.9 * (heardPasses - 1) && passRestarts <= heardPasses,
    `the art restarted at ${passRestarts} of the ${heardPasses - 1} passes heard after the first (at least 90%; a pass seen only after its start is skipped)`);

  const lead = leads(end.sends);
  Object.assign(summary, { messages: end.sends.length, minLeadMs: 1000 * lead.min, late: lead.late });
  check(lead.late === 0, `no message scheduled late: ${end.sends.length} messages, the closest ${ms(lead.min)} ms ahead of the audio clock`);

  const clocks = clockDrift(end.clock, Math.min(10000, (minutes * 60000) / 4));
  // Past the first 5 s, while the audio clock settles after resume().
  const step = largestStep(end.clock.filter((/** @type {number[]} */ c) => c[0] >= end.clock[0][0] + 5000), 8);
  const stepAt = (step.atMs - end.clock[0][0]) / 1000;
  Object.assign(summary, { clockDriftMs: clocks.driftMs, clockPpm: clocks.ppm, clockStepMs: step.stepMs, clockStepAt: stepAt });
  info(`audio clock - page clock: ${clocks.driftMs >= 0 ? "+" : ""}${clocks.driftMs.toFixed(1)} ms over ${clock(clocks.seconds)} (${clocks.ppm.toFixed(1)} ppm, ${end.clock.length} samples); ` +
    `largest step ${step.stepMs >= 0 ? "+" : ""}${step.stepMs.toFixed(1)} ms, ${clock(stepAt)} after ▶`);
  if (found) {
    // art - sound = (art - page clock) + (page clock - audio clock), against the first checkpoint.
    const page_ = trend(rows.map((r) => [r.t, r.offsetMs + (r.clockMs - rows[0].clockMs)]));
    Object.assign(summary, { artPageDriftMs: page_.driftMs });
    info(`the art against the page clock: ${page_.driftMs >= 0 ? "+" : ""}${page_.driftMs.toFixed(1)} ms over the session (trend); the rest of the art's drift from the sound is the audio clock's`);
  }

  check(end.constructed === 1 && end.plays === 1 && end.playing && end.state === "running", `still playing at the end (one synth, one ▶, AudioContext ${end.state})`);
  await page.click("#play");
  const sent = await page.evaluate(() => /** @type {any} */ (window).__drift.sends.length);
  await page.waitForTimeout(400);
  const stopped = await page.evaluate(() => ({ sends: /** @type {any} */ (window).__drift.sends.length, playing: /** @type {any} */ (window).__drift.synth.playing }));
  check(!stopped.playing && stopped.sends === sent, "■ stops: nothing scheduled after it");
  const errors = await logged();
  check(errors.length === 0, `no console errors${errors.length ? ": " + errors.join(" | ") : ""}`);
  check(blocked.length === 0, `no network requests${blocked.length ? ": " + blocked.join(" ") : ""}`);
} catch (e) {
  failures++;
  console.log(`  FAIL ${/** @type {Error} */ (e).stack || e}`);
} finally {
  if (outDir) {
    const result = { engine, browser: browser.version(), version: VERSION, case: c.name, passSeconds: PASS, minutes, every, failures, summary, checkpoints: rows };
    writeFileSync(join(outDir, "drift_check_result.json"), JSON.stringify(result, null, 1) + "\n");
  }
  await browser.close();
}
console.log(failures ? `${failures} check(s) failed` : "all checks passed");
process.exit(failures ? 1 : 0);
