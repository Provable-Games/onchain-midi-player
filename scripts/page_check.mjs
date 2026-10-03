#!/usr/bin/env node
// @ts-check
// Headless Chromium check of the real page (tests/fixtures/page.html) with the golden fixture
// inputs (tests/fixtures/page.json), loaded three ways:
//
//   data:      the decoded animation_url as a top-level data: URI, with the browser offline
//   iframe     inside <iframe sandbox="allow-scripts" src="data:..."> (opaque origin)
//   csp        served with a CSP that allows only inline scripts and styles and data: images
//
// For each it checks that the shim inflated the gzipped engine (the gzip tag replaced by an inline
// script whose text hashes to script_sha256(), run before the player registered its
// DOMContentLoaded listener), that ▶ is disabled until the page is ready, that the art is shown
// first, that ▶ starts TinySynth (AudioContext running, notes scheduled) and ■ stops it, that the
// page loops at End-of-Track (consecutive passes start maxTick x tick2Time apart), and that nothing
// is requested over the network (the gzip tag's data: URI included) and nothing is logged as an
// error. On the data: page it also checks that ▶ restarts the art: the probe art is a bar sweeping
// linearly over 8 s, and screenshots before and after ▶ show the bar where time-since-restart (not
// time-since-load) puts it, and it prints when the page became ready. Failure variants (unparsable
// settings, invalid MIDI; a corrupt, truncated or missing gzip payload, or one without the engine)
// must keep the art visible, keep ▶ disabled, show the exact error and construct no synth. Range
// checks are Cairo's: settings that only break a range rule must still play.
//
// Playwright is not a dependency of this repository; point the script at an existing install:
//
//   PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core \
//   CHROME=/path/to/chrome-headless-shell [LD_LIBRARY_PATH=...] \
//   node scripts/page_check.mjs [screenshot_dir]
//
// Exits 0 when every check passes, 1 when one fails, 2 when PLAYWRIGHT_CORE is not set.

import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { ENGINE_SHA256 } from "./engine.mjs";
import { ART_OPEN, MIDI_OPEN, pageHtml, sha256, withGzipPayload } from "./page.mjs";
import { decodePng } from "./png.mjs";
import { smf } from "./page_fixtures.mjs";
import { ENGINE_MISSING } from "../player/player.js";

const { PLAYWRIGHT_CORE, CHROME } = process.env;
if (!PLAYWRIGHT_CORE) {
  console.error("set PLAYWRIGHT_CORE to a playwright-core directory (and CHROME to a Chromium binary)");
  process.exit(2);
}
const { chromium } = createRequire(import.meta.url)(PLAYWRIGHT_CORE);
const shotDir = process.argv[2];

const fixtures = JSON.parse(readFileSync(new URL("../tests/fixtures/page.json", import.meta.url), "utf8"));
const PAGE = pageHtml();
/** @type {Record<string, any>} */
const CASES = Object.fromEntries(fixtures.valid.map((/** @type {any} */ c) => [c.name, c]));
const htmlOf = (/** @type {any} */ c, d = c.d) => PAGE + d + c.svg;
const dataUrl = (/** @type {string} */ html) => "data:text/html;base64," + Buffer.from(html, "utf8").toString("base64");
const artSrc = (/** @type {string} */ svg) => "data:image/svg+xml;base64," + Buffer.from(svg, "utf8").toString("base64");
const SWEEP_SECONDS = 8; // the probe art of beast_140bpm: x = 390 * t / 8 for t <= 8 s
const CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:";

let failures = 0;
/** @param {boolean} cond @param {string} msg */
function check(cond, msg) {
  console.log(`  ${cond ? "ok  " : "FAIL"} ${msg}`);
  if (!cond) failures++;
}

/**
 * Runs in every frame before the page's scripts: wraps the engine constructor (which the engine
 * assigns to window.WebAudioTinySynth) to record the synth, what it schedules and when playback
 * starts, records ▶'s state when DOMContentLoaded fires (before the player's own listener), CSP
 * violations, when each art <img> enters the document and when ▶ is first enabled, and the order
 * of three events: the engine defining WebAudioTinySynth ("engine"), a script registering a
 * DOMContentLoaded listener ("listener") and DOMContentLoaded itself ("dcl").
 */
function instrument() {
  /** @type {any} */
  const st = { constructed: 0, sends: [], plays: [], imgs: [], violations: [], readyDisabled: null, order: [], readyAt: null };
  /** @type {any} */ (window).__check = st;
  /** @type {any} */
  let Real;
  function Wrapped(/** @type {any} */ opts) {
    st.constructed++;
    const synth = new Real(opts);
    st.synth = synth;
    const ctx = synth.getAudioContext();
    const send = synth.send;
    synth.send = (/** @type {number[]} */ m, /** @type {number} */ t) => {
      if (t !== undefined) st.sends.push([m[0], m[1], m[2], t]);
      return send(m, t);
    };
    const play = synth.playMIDI;
    synth.playMIDI = () => {
      play();
      st.plays.push({ at: performance.now(), currentTime: ctx.currentTime, playTime: synth.playTime, delay: synth.playTime - ctx.currentTime + (ctx.outputLatency || 0), outputLatency: ctx.outputLatency });
    };
    return synth;
  }
  Object.defineProperty(window, "WebAudioTinySynth", { configurable: true, get: () => Real && Wrapped, set: (v) => { Real = v; st.order.push("engine"); } });
  document.addEventListener("DOMContentLoaded", () => {
    st.order.push("dcl");
    const b = /** @type {HTMLButtonElement | null} */ (document.getElementById("play"));
    st.readyDisabled = b ? b.disabled : "no button";
  });
  document.addEventListener("securitypolicyviolation", (e) => st.violations.push(e.violatedDirective + " " + e.blockedURI));
  // Registered after the instrument's own listener: the page's DOMContentLoaded registrations.
  const add = document.addEventListener;
  document.addEventListener = function (/** @type {string} */ type, /** @type {any[]} */ ...rest) {
    if (type === "DOMContentLoaded") st.order.push("listener");
    return add.call(this, type, ...rest);
  };
  new MutationObserver((records) => {
    for (const r of records) for (const n of r.addedNodes) if (n.nodeName === "IMG") st.imgs.push({ at: performance.now(), src: /** @type {HTMLImageElement} */ (n).src });
    const b = /** @type {HTMLButtonElement | null} */ (document.getElementById("play"));
    if (st.readyAt === null && b && !b.disabled) st.readyAt = performance.now();
  }).observe(document, { childList: true, subtree: true, attributes: true });
}

const browser = await chromium.launch({ executablePath: CHROME || undefined, env: process.env });

/**
 * A fresh context with the instrumentation, network blocking (data: only, plus `serve`d URLs) and
 * error collection.
 * @param {{offline?: boolean, serve?: Record<string, {body: string, headers?: Record<string, string>}>, viewport?: {width: number, height: number}}} [o]
 */
async function open({ offline = false, serve = {}, viewport = { width: 400, height: 100 } } = {}) {
  const context = await browser.newContext({ viewport, offline });
  await context.addInitScript(instrument);
  /** @type {string[]} */
  const blocked = [];
  /** @type {string[]} */
  const errors = [];
  await context.route("**/*", (/** @type {any} */ route) => {
    const url = route.request().url();
    if (url.startsWith("data:")) return route.continue();
    const doc = serve[url];
    if (doc) return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", headers: doc.headers || {}, body: doc.body });
    blocked.push(url);
    return route.abort();
  });
  // Every resource request the page's renderer makes, data: URLs included, from the DevTools
  // protocol: Playwright's own request events and route() skip data: URLs, so neither `blocked` nor
  // they could show that the gzip tag's data: URI is never fetched.
  /** @type {string[]} */
  const requests = [];
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  cdp.on("Network.requestWillBeSent", (/** @type {any} */ e) => requests.push(e.request.url));
  page.on("console", (/** @type {any} */ m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (/** @type {any} */ e) => errors.push(String(e)));
  return { context, page, blocked, errors, requests };
}

/**
 * Checks that the shim inflated the engine: no gzip tag left, the first <head> script is the
 * engine (its text hashed here, in Node), it ran before the player registered its DOMContentLoaded
 * listener, and the gzip tag's data: URI was never requested.
 * @param {any} frame
 * @param {string[]} requests
 */
async function checkInflated(frame, requests) {
  const r = await frame.evaluate(() => ({
    tags: document.querySelectorAll('script[type="text/javascript+gzip"]').length,
    first: document.head.querySelector("script"),
    text: document.head.querySelector("script")?.textContent || "",
    order: /** @type {any} */ (window).__check.order,
  }));
  check(r.tags === 0 && sha256(r.text) === ENGINE_SHA256,
    `the shim replaced the gzip tag with the inflated engine (${r.text.length} bytes, sha256 = script_sha256())`);
  const [engine, listener, dcl] = ["engine", "listener", "dcl"].map((e) => r.order.indexOf(e));
  check(engine >= 0 && engine < listener && listener < dcl, `the engine ran before the player registered its listener, before DOMContentLoaded (${r.order.join(", ")})`);
  // The frame's own document request shows its requests are observed.
  const url = frame.url();
  const fetched = requests.filter((u) => u.startsWith("data:text/javascript"));
  check(requests.includes(url) && fetched.length === 0,
    `the gzip tag's data: URI was never fetched (${requests.length} requests observed, the frame's document included)`);
}

/** @param {any} frame */
const state = (frame) => frame.evaluate(() => {
  const st = /** @type {any} */ (window).__check;
  const b = /** @type {HTMLButtonElement} */ (document.getElementById("play"));
  const img = document.querySelector("img");
  const err = /** @type {HTMLElement} */ (document.getElementById("error"));
  const synth = st.synth;
  return {
    readyDisabled: st.readyDisabled, constructed: st.constructed, disabled: b.disabled, label: b.getAttribute("aria-label"),
    icon: document.getElementById("icon")?.getAttribute("d"), title: b.title, error: err.hidden ? null : err.textContent,
    imgs: st.imgs, img: img && { src: img.src, complete: img.complete, w: img.naturalWidth, h: img.naturalHeight, count: document.querySelectorAll("img").length },
    plays: st.plays, sends: st.sends.length, violations: st.violations, origin: window.origin,
    synth: synth && { playing: synth.playing, loop: synth.loop, loopEnd: synth.loopEnd, maxTick: synth.maxTick, tick2Time: synth.tick2Time, state: synth.getAudioContext().state, time: synth.getAudioContext().currentTime },
  };
});

/** Waits until the player has finished starting up (▶ enabled, or an error shown). */
const ready = (/** @type {any} */ frame) => frame.waitForFunction(() => {
  const b = /** @type {HTMLButtonElement | null} */ (document.getElementById("play"));
  const e = document.getElementById("error");
  return b && (!b.disabled || (e && !e.hidden));
});

/**
 * Start times of every pass: the first lead note-on (channel 1, note 72) of each.
 * @param {any} frame
 * @param {number} loopSeconds
 */
async function passStarts(frame, loopSeconds) {
  const sends = await frame.evaluate(() => /** @type {any} */ (window).__check.sends);
  const firsts = sends.filter((/** @type {number[]} */ s) => s[0] === 0x90 && s[1] === 72 && s[2] > 0).map((/** @type {number[]} */ s) => s[3]);
  return firsts.filter((/** @type {number} */ t, /** @type {number} */ i) => i === 0 || t - firsts[i - 1] > loopSeconds / 2);
}

/**
 * Checks the End-of-Track loop: consecutive pass starts are maxTick x tick2Time apart.
 * @param {any} frame
 * @param {any} c fixture case
 */
async function checkLoop(frame, c) {
  await frame.waitForTimeout(Math.ceil((2 * c.midi_loop_seconds + 0.6) * 1000));
  const st = await state(frame);
  const starts = await passStarts(frame, c.midi_loop_seconds);
  const periods = starts.slice(1).map((t, i) => t - starts[i]);
  const expected = st.synth.maxTick * st.synth.tick2Time;
  check(st.synth.loop === 1 && st.synth.loopEnd === st.synth.maxTick && st.synth.maxTick === c.midi_max_tick,
    `setLoop(1), setLoopEnd(maxTick = ${st.synth.maxTick})`);
  check(periods.length >= 2 && periods.every((p) => Math.abs(p - expected) < 1e-6),
    `pass-to-pass ${periods.map((p) => p.toFixed(6)).join(", ")} s = maxTick x tick2Time = ${st.synth.maxTick} x ${st.synth.tick2Time.toFixed(9)} = ${expected.toFixed(6)} s (fixture: ${c.midi_loop_seconds.toFixed(6)} s)`);
}

/** The sweep bar's left edge in a screenshot of the page, or -1. */
async function barX(/** @type {any} */ page) {
  const png = decodePng(await page.screenshot());
  for (let x = 0; x < png.width; x++) if (png.pixel(x, 20)[0] > 200) return x;
  return -1;
}

// ---------------------------------------------------------------------------------------------

/** The data: page with the probe art: everything, including the art restart. */
async function checkDataPage() {
  const c = CASES.beast_140bpm;
  console.log(`data: URI, offline (${c.name}: art-restart probe, ${(c.midi_loop_seconds).toFixed(4)} s loop at ${(60 / (c.midi_loop_seconds / 4)).toFixed(4)} BPM)`);
  const { context, page, blocked, errors, requests } = await open({ offline: true });
  await page.goto(dataUrl(htmlOf(c)));
  await ready(page);
  await checkInflated(page, requests);
  const at = await page.evaluate(() => {
    const st = /** @type {any} */ (window).__check;
    return { readyAt: st.readyAt, dcl: performance.getEntriesByType("navigation")[0]?.toJSON().domContentLoadedEventStart };
  });
  console.log(`  info ready (▶ enabled) ${at.readyAt?.toFixed(1)} ms after navigation start; DOMContentLoaded at ${at.dcl?.toFixed(1)} ms`);
  let st = await state(page);
  check(st.readyDisabled === true && !st.disabled, "▶ disabled until DOMContentLoaded, then enabled");
  check(st.img?.src === artSrc(c.svg) && st.img.count === 1, "art shown as the canonical data:image/svg+xml;base64 URL");
  await page.waitForFunction(() => document.querySelector("img")?.complete);
  st = await state(page);
  check(st.img.w === 400 && st.img.h === 100, `art loaded (${st.img.w}x${st.img.h})`);
  check(st.constructed === 0, "no synth before ▶");

  // Before ▶: the bar follows time since the art was first shown.
  await page.waitForTimeout(3000);
  const t0 = await page.evaluate(() => performance.now());
  const before = await barX(page);
  const sinceLoad = (t0 - st.imgs[0].at) / 1000;
  check(Math.abs(before - (390 * sinceLoad) / SWEEP_SECONDS) < 20, `before ▶: bar at x = ${before}, ${sinceLoad.toFixed(2)} s after the art was shown (expected ~${Math.round((390 * sinceLoad) / SWEEP_SECONDS)})`);
  if (shotDir) await page.screenshot({ path: join(shotDir, "page_before_play.png") });

  await page.click("#play");
  await page.waitForFunction(() => /** @type {any} */ (window).__check.imgs.length >= 2, null, { timeout: 3000 }).catch(() => {});
  st = await state(page);
  check(st.constructed === 1 && st.synth.state === "running", `▶: synth constructed in the gesture, AudioContext ${st.synth.state}`);
  check(st.label === "Stop" && st.icon === "M6 6h12v12H6z", "▶ became ■");
  const play = st.plays[0];
  const restart = st.imgs[1];
  check(!!restart && restart.src === artSrc(c.svg).replace(";base64,", ";r=1;base64,") && st.img.count === 1,
    "art re-created with a distinct, equivalent URL (data:image/svg+xml;r=1;base64,...)");
  const lag = restart ? restart.at - play.at - play.delay * 1000 : NaN;
  check(lag > -5 && lag < 100, `art restarted ${restart ? (restart.at - play.at).toFixed(1) : "?"} ms after playMIDI; ` +
    `scheduling offset ${(1000 * (play.playTime - play.currentTime)).toFixed(1)} ms + outputLatency ${(1000 * (play.outputLatency || 0)).toFixed(1)} ms = ${(1000 * play.delay).toFixed(1)} ms (lag ${lag.toFixed(1)} ms)`);

  // After ▶: the bar follows time since the restart, not since the page loaded.
  await page.waitForTimeout(1200);
  const t1 = await page.evaluate(() => performance.now());
  const after = await barX(page);
  const sinceRestart = (t1 - restart.at) / 1000;
  const sinceLoad1 = (t1 - st.imgs[0].at) / 1000;
  check(Math.abs(after - (390 * sinceRestart) / SWEEP_SECONDS) < 20 && after < (390 * sinceLoad1) / SWEEP_SECONDS - 100,
    `after ▶: bar at x = ${after}, ${sinceRestart.toFixed(2)} s after the restart (expected ~${Math.round((390 * sinceRestart) / SWEEP_SECONDS)}; ~${Math.round((390 * sinceLoad1) / SWEEP_SECONDS)} had it not restarted)`);
  if (shotDir) await page.screenshot({ path: join(shotDir, "page_after_play.png") });
  st = await state(page);
  const time = st.synth.time;
  await page.waitForTimeout(200);
  check((await state(page)).synth.time > time, "AudioContext clock advancing");
  const starts = await passStarts(page, c.midi_loop_seconds);
  check(Math.abs(starts[0] - play.playTime) < 1e-9, `first note at playTime (${play.playTime.toFixed(4)} s)`);
  await checkLoop(page, c);

  await page.evaluate(() => { /** @type {any} */ (window).__vols = /** @type {any} */ (window).__check.synth.chvol.slice(); });
  await page.click("#play");
  st = await state(page);
  const sends = st.sends;
  await page.waitForTimeout(400);
  const stopped = await state(page);
  check(st.label === "Play" && stopped.synth.playing === 0 && stopped.sends === sends, "■ stops: nothing scheduled after it");
  check(await page.evaluate(() => {
    const w = /** @type {any} */ (window);
    return w.__check.synth.chvol.every((/** @type {any} */ n, /** @type {number} */ i) => n !== w.__vols[i]);
  }), "■ replaced every channel's volume node, cutting off drum voices and notes scheduled ahead");

  await page.click("#play");
  await page.waitForFunction(() => /** @type {any} */ (window).__check.imgs.length >= 3, null, { timeout: 3000 }).catch(() => {});
  st = await state(page);
  const again = st.plays[1];
  const restartStarts = (await passStarts(page, c.midi_loop_seconds)).filter((t) => t >= again.playTime - 1e-9);
  check(st.constructed === 1 && st.label === "Stop" && Math.abs(restartStarts[0] - again.playTime) < 1e-9,
    "▶ again: same synth, playback from tick 0 at playTime");
  check(st.imgs.length === 3 && st.imgs[2].src.includes(";r=2;base64,"), "▶ again: art restarted again (r=2)");
  check(errors.length === 0, `no console errors${errors.length ? ": " + errors.join(" | ") : ""}`);
  check(blocked.length === 0, `no network requests${blocked.length ? ": " + blocked.join(" ") : ""}`);
  await context.close();
}

/** The page inside a sandboxed iframe (opaque origin, scripts only). */
async function checkIframe() {
  const c = CASES.unicode_art;
  console.log(`<iframe sandbox="allow-scripts" src="data:..."> (${c.name})`);
  const host = "http://host.test/embed.html";
  const body = `<!doctype html><title>host</title><iframe sandbox="allow-scripts" width="400" height="200" src="${dataUrl(htmlOf(c))}"></iframe>`;
  const { context, page, blocked, errors, requests } = await open({ serve: { [host]: { body } }, viewport: { width: 420, height: 220 } });
  await page.goto(host);
  const frame = await (await page.waitForSelector("iframe")).contentFrame();
  await ready(frame);
  await checkInflated(frame, requests);
  await frame.waitForFunction(() => document.querySelector("img")?.complete);
  let st = await state(frame);
  check(st.origin === "null", "the frame has an opaque origin (sandboxed)");
  check(st.readyDisabled === true && !st.disabled, "▶ disabled until DOMContentLoaded, then enabled");
  check(st.img.src === artSrc(c.svg) && st.img.w > 0, `art shown (UTF-8 SVG re-encoded byte for byte, ${st.img.w}x${st.img.h})`);
  await frame.click("#play");
  await frame.waitForTimeout(300);
  st = await state(frame);
  check(st.constructed === 1 && st.synth.state === "running" && st.sends > 0, `▶: AudioContext ${st.synth.state}, ${st.sends} MIDI messages scheduled`);
  await checkLoop(frame, c);
  await frame.click("#play");
  st = await state(frame);
  check(st.synth.playing === 0 && st.label === "Play", "■ stops");
  check(errors.length === 0, `no console errors${errors.length ? ": " + errors.join(" | ") : ""}`);
  check(blocked.length === 0, `no network requests beyond the host page${blocked.length ? ": " + blocked.join(" ") : ""}`);
  await context.close();
}

/** The page served with a strict CSP (inline scripts and styles, data: images; nothing else). */
async function checkCsp() {
  const c = CASES.six_timbres_format1;
  console.log(`Content-Security-Policy: ${CSP}; sandbox allow-scripts (${c.name})`);
  const url = "http://player.test/token.html";
  const { context, page, blocked, errors, requests } = await open({ serve: { [url]: { body: htmlOf(c), headers: { "Content-Security-Policy": CSP + "; sandbox allow-scripts" } } } });
  await page.goto(url);
  await ready(page);
  await checkInflated(page, requests);
  await page.waitForFunction(() => document.querySelector("img")?.complete);
  let st = await state(page);
  check(st.origin === "null" && !st.disabled && st.img.w === 250, "art shown and ▶ enabled under the CSP");
  await page.click("#play");
  await page.waitForTimeout(300);
  st = await state(page);
  check(st.synth?.state === "running" && st.sends > 0, `▶ plays (${st.sends} MIDI messages scheduled)`);
  await checkLoop(page, c);
  check(st.violations.length === 0, `no CSP violations${st.violations.length ? ": " + st.violations.join(" | ") : ""}`);
  check(errors.length === 0, `no console errors${errors.length ? ": " + errors.join(" | ") : ""}`);
  check(blocked.length === 0, `no network requests beyond the page${blocked.length ? ": " + blocked.join(" ") : ""}`);
  await context.close();
}

/** Failure variants: the art stays visible, ▶ stays disabled, the exact error is shown (D9). */
async function checkFailures() {
  const c = CASES.default_120bpm;
  const withSettings = (/** @type {string} */ s) => s + c.d.slice(c.d.indexOf(MIDI_OPEN));
  const withMidi = (/** @type {string} */ b64) => c.d.slice(0, c.d.indexOf(MIDI_OPEN) + MIDI_OPEN.length) + b64 + ART_OPEN;
  const noEot = smf({ ppq: 96, tracks: [[[0, 0x90, 60, 100], [96, 0x80, 60, 0]]] }).toString("base64");
  /** @type {Array<[string, string, string]>} */
  const variants = [
    ["truncated settings", withSettings(" 1,1,30,40,64,0"), "settings: malformed: token 6"],
    ["settings with a count over its cap", withSettings("1,1,30,40,64,0,33"), "settings: TS: too many timbres"],
    ["MIDI that is not base64", withMidi("@@not base64@@"), "midi: not base64"],
    ["MIDI cut after 4 bytes", withMidi("TVRoZA=="), "midi: truncated (byte 4)"],
    ["MIDI without End-of-Track", withMidi(noEot), "midi: truncated (byte 30)"],
  ];
  for (const [label, d, message] of variants) {
    console.log(`failure variant: ${label} (data: URI, offline)`);
    const { context, page, blocked, errors } = await open({ offline: true, viewport: { width: 400, height: 400 } });
    await page.goto(dataUrl(htmlOf(c, d)));
    await ready(page);
    await page.waitForFunction(() => document.querySelector("img")?.complete);
    const st = await state(page);
    check(st.img.src === artSrc(c.svg) && st.img.w === 250 && st.img.h === 350, `art still shown (${st.img.w}x${st.img.h})`);
    check(st.disabled && st.title === message, "▶ disabled, with the error as its title");
    check(st.error === message && (await page.isVisible("#error")), `error shown: ${JSON.stringify(st.error)}`);
    await page.click("#play", { force: true });
    check((await state(page)).constructed === 0, "no synth constructed, even after clicking ▶");
    check(errors.length === 1 && errors[0].includes(message), `only the error itself logged (${errors.length})`);
    check(blocked.length === 0, "no network requests");
    if (shotDir) await page.screenshot({ path: join(shotDir, `page_failure_${variants.findIndex((v) => v[0] === label)}.png`) });
    await context.close();
  }
}

/**
 * The engine fails (D9): a corrupt, truncated or missing gzip payload, or one that inflates to a
 * script without the engine. The art stays visible, ▶ stays disabled, the error is shown, no synth
 * is constructed; the shim logs why, then the player its error.
 */
async function checkEngineFailures() {
  const c = CASES.default_120bpm;
  const html = htmlOf(c);
  const editBytes = (/** @type {(b: Buffer) => Buffer} */ f) => withGzipPayload(html, (p) => f(Buffer.from(p, "base64")).toString("base64"));
  /** @type {Array<[string, string, string[]]>} [label, html, what the console logs, in order] */
  const variants = [
    ["a corrupt gzip payload (one byte changed mid-stream)", editBytes((b) => { const x = Buffer.from(b); x[x.length >> 1] ^= 0x55; return x; }), ["gunzip:", ENGINE_MISSING]],
    ["a truncated gzip payload", editBytes((b) => b.subarray(0, b.length >> 1)), ["gunzip: invalid gzip data", ENGINE_MISSING]],
    ["no gzip tag", withGzipPayload(html, () => null), [ENGINE_MISSING]],
    ["a gzip payload that inflates to a script without the engine", withGzipPayload(html, () => gzipSync("/* not TinySynth */").toString("base64")), [ENGINE_MISSING]],
  ];
  for (const [label, page_, logged] of variants) {
    console.log(`engine failure: ${label} (data: URI, offline)`);
    const { context, page, blocked, errors, requests } = await open({ offline: true, viewport: { width: 400, height: 400 } });
    await page.goto(dataUrl(page_));
    await ready(page);
    await page.waitForFunction(() => document.querySelector("img")?.complete);
    const st = await state(page);
    check(st.img.src === artSrc(c.svg) && st.img.w === 250 && st.img.h === 350, `art still shown (${st.img.w}x${st.img.h})`);
    check(st.disabled && st.title === ENGINE_MISSING, "▶ disabled, with the error as its title");
    check(st.error === ENGINE_MISSING && (await page.isVisible("#error")), `error shown: ${JSON.stringify(st.error)}`);
    await page.click("#play", { force: true });
    check((await state(page)).constructed === 0, "no synth constructed, even after clicking ▶");
    check(errors.length === logged.length && logged.every((m, i) => errors[i].includes(m)),
      `logged: ${errors.map((e) => JSON.stringify(e.split("\n")[0])).join(", ")}`);
    check(blocked.length === 0 && requests.length > 0 && !requests.some((u) => u.startsWith("data:text/javascript")), "no network requests; the gzip tag's data: URI not fetched");
    await context.close();
  }
}

/** Range checks are Cairo's job: SETTINGS that parse but break a range rule (quality 2) still play. */
async function checkRangeOnly() {
  const c = CASES.default_120bpm;
  console.log("range-only violation (quality 2): not the page's to reject (data: URI, offline)");
  const { context, page, errors } = await open({ offline: true });
  await page.goto(dataUrl(htmlOf(c, " 1,2,30,40,64,0,0" + c.d.slice(c.d.indexOf(MIDI_OPEN)))));
  await ready(page);
  check(!(await state(page)).disabled && errors.length === 0, "▶ enabled, no error");
  await page.click("#play");
  await page.waitForTimeout(200);
  check((await state(page)).synth?.state === "running", "▶ plays");
  await context.close();
}

try {
  await checkDataPage();
  await checkIframe();
  await checkCsp();
  await checkFailures();
  await checkEngineFailures();
  await checkRangeOnly();
} catch (e) {
  failures++;
  console.log(`  FAIL ${/** @type {Error} */ (e).stack || e}`);
} finally {
  await browser.close();
}
if (shotDir) writeFileSync(join(shotDir, "page_check_result.txt"), failures ? `${failures} failure(s)\n` : "all passed\n");
console.log(failures ? `${failures} check(s) failed` : "all checks passed");
process.exit(failures ? 1 : 0);
