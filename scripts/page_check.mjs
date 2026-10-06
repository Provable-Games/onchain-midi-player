#!/usr/bin/env node
// @ts-check
// Headless browser check of the class's output on Chromium, Firefox or WebKit. Every golden fixture
// case's token_uri (tests/fixtures/page.json) is first checked against the length and SHA-256 that
// snforge pins the class's output to, and decoded as a marketplace decodes it
// (scripts/fixture_pages.mjs). Their animation_url pages are then loaded these ways:
//
//   data:      as a top-level data: URI, with the browser offline (on WebKit, whose offline emulation
//              also blocks the page's own blob: media, with every other request blocked instead)
//   iframe     inside <iframe sandbox="allow-scripts" src="data:..."> (opaque origin)
//   csp        served with a CSP that allows only inline scripts and styles and data: images
//   file://    decoded to a file and opened from disk (every other request blocked and listed)
//   embeds     two other ways a host can frame it: <iframe sandbox="allow-scripts" srcdoc="...">,
//              and re-served from another origin in <iframe sandbox="allow-scripts allow-same-origin">
//   touch      ▶ and ■ by tapping, in a touch context
//
// For each it checks that the shim inflated the gzipped engine (the gzip tag replaced by an inline
// script whose text hashes to script_sha256(), run before the player registered its
// DOMContentLoaded listener), that ▶ is disabled until the page is ready, that the art is shown
// first, that ▶ starts TinySynth (AudioContext running, notes scheduled) and ■ stops it, that the
// page loops at End-of-Track (consecutive passes start maxTick x tick2Time apart, which is the pass
// length the MIDI's own tempo map gives: the tempo is right), and that nothing
// is requested over the network and nothing is logged as an error. That the gzip tag's data: URI is
// never fetched shows on Chromium through the DevTools protocol on every load; on every engine, the
// CSP load reports no violation although its CSP blocks data: scripts, and a control page shows the
// engine reports one for a plain <script src="data:...">. On the data: page it also checks that ▶
// restarts the art: the probe art is a bar sweeping linearly over 8 s, and screenshots before and
// after ▶ show the bar where time-since-restart (not time-since-load) puts it; that the art
// restarts again at every pass, each time at the pass's tick 0 as heard (its startTime plus the
// output latency), and never after ■; and it prints when the page became ready. It prints how long each ▶ took to start playback. Failure variants
// (unparsable settings, invalid MIDI; a corrupt, truncated or missing gzip payload, or one without
// the engine) must keep the art visible, keep ▶ disabled, show the exact error and construct no
// synth. So must the failures ▶ can meet: no Web Audio at all, or an AudioContext whose resume()
// rejects. Range checks are Cairo's: settings that only break a range rule must still play. The
// settings fixtures with fields at their type's extremes (and the deepest FM chain at them), the
// custom-wave fixtures (256 waves; the long-mode LFSR, 32,767 samples) and the filter fixtures
// (every kind with its cutoff and Q at 0.0001 and the u32 maximum, fixed and key-tracked) play the
// lowest and highest notes on every custom timbre with no error, then a plain note, which must
// sound: the engine skips a note whose computed values overflow float32 (fork T5.2), and the song
// must go on. Only playing shows that, and a wave the engine cannot register. The custom-wave and
// filter fixtures must sound every note.
//
// Playwright is not a dependency of this repository; point the script at an existing install, and
// pick the engine (scripts/browsers.mjs; Firefox plays audio only with an output device, which a
// PulseAudio null sink provides on a machine without one: see docs/development.md, "Browser validation"):
//
//   PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core \
//   PLAYWRIGHT_BROWSER=chromium|firefox|webkit \
//   [CHROME=/path/to/chrome-headless-shell] [LD_LIBRARY_PATH=...] \
//   node scripts/page_check.mjs [screenshot_dir]
//
// Exits 0 when every check passes, 1 when one fails, 2 when PLAYWRIGHT_CORE is not set or
// PLAYWRIGHT_BROWSER names no supported engine.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import { collectErrors, dataRequestLog, launchBrowser } from "./browsers.mjs";
import { ENGINE_SHA256 } from "./engine.mjs";
import { FIXTURES, tokenPage } from "./fixture_pages.mjs";
import { ART_OPEN, MIDI_OPEN, dFragment, pageHtml, sha256, withGzipPayload } from "./page.mjs";
import { decodePng, encodePng } from "./png.mjs";
import { smf } from "./page_fixtures.mjs";
import { longLfsr } from "./settings_fixtures.mjs";
import { ENGINE_MISSING } from "../player/player.js";

const shotDir = process.argv[2];

const PAGE = pageHtml();
/** @type {Record<string, any>} */
const CASES = Object.fromEntries(FIXTURES.valid.map((/** @type {any} */ c) => [c.name, c]));
/** Each case's token_uri, its animation_url and the HTML that decodes to; throws unless the class's. */
const TOKENS = Object.fromEntries(FIXTURES.valid.map((/** @type {any} */ c) => [c.name, tokenPage(c, PAGE)]));
/** A failure variant: the page with another D (not the class's output for any settings). */
const htmlOf = (/** @type {any} */ c, /** @type {string} */ d) => PAGE + d + c.svg;
const dataUrl = (/** @type {string} */ html) => "data:text/html;base64," + Buffer.from(html, "utf8").toString("base64");
const artSrc = (/** @type {string} */ svg) => "data:image/svg+xml;base64," + Buffer.from(svg, "utf8").toString("base64");
const SWEEP_SECONDS = 8; // the probe art of beast_140bpm: x = 390 * t / 8 for t <= 8 s
// The recommended host CSP: inline scripts and styles, data: images and blob: media (the silent
// element of the media session); the page plays without media-src, but without media controls
// (scripts/hosting_check.mjs).
const CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; media-src blob:";

let failures = 0;
/** @param {boolean} cond @param {string} msg */
function check(cond, msg) {
  console.log(`  ${cond ? "ok  " : "FAIL"} ${msg}`);
  if (!cond) failures++;
}
/** A check this engine cannot make, and why. @param {string} msg */
function skip(msg) {
  console.log(`  skip ${msg}`);
}
/** Where the DevTools protocol is missing (Firefox, WebKit): the per-load data: request check. */
const NO_CDP = "Chromium-only (DevTools protocol): no other engine shows data: requests; the CSP check proves it on every engine";

/**
 * Runs in every frame before the page's scripts: wraps the engine constructor (which the engine
 * assigns to window.WebAudioTinySynth) to record the synth, what it schedules and when playback
 * starts, records ▶'s state when DOMContentLoaded fires (before the player's own listener), CSP
 * violations, when each art <img> enters the document and when ▶ is first enabled, and the order
 * of three events: the engine defining WebAudioTinySynth ("engine"), a script registering a
 * DOMContentLoaded listener ("listener") and DOMContentLoaded itself ("dcl"). It also records the
 * media element the page plays (the silent one of the media session: its play() calls and the
 * element) and the media session's action handlers, so the checks can call them.
 */
function instrument() {
  /** @type {any} */
  const st = { constructed: 0, sends: [], notes: [], plays: [], imgs: [], violations: [], readyDisabled: null, order: [], readyAt: null };
  /** @type {any} */ (window).__check = st;
  st.media = { plays: 0, el: null };
  st.handlers = {};
  const mediaPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    st.media.plays++;
    st.media.el = this;
    return mediaPlay.call(this);
  };
  if (window.MediaSession) {
    const setActionHandler = MediaSession.prototype.setActionHandler;
    MediaSession.prototype.setActionHandler = function (/** @type {string} */ action, /** @type {any} */ handler) {
      st.handlers[action] = handler;
      return setActionHandler.call(this, action, handler);
    };
  }
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
    // Every note the engine voices or skips: [channel, note, sources made]. A note whose computed
    // values overflow float32 makes none (fork T5.2).
    let made = 0;
    for (const name of ["createOscillator", "createBufferSource"]) {
      const create = ctx[name].bind(ctx);
      ctx[name] = (/** @type {any[]} */ ...args) => (made++, create(...args));
    }
    const note = synth._note;
    synth._note = (/** @type {any[]} */ ...args) => {
      const before = made;
      try {
        return note(...args);
      } finally {
        st.notes.push([args[1], args[2], made - before]);
      }
    };
    const play = synth.playMIDI;
    synth.playMIDI = () => {
      play();
      const startTime = synth.getPlayStatus().startTime;
      st.plays.push({ at: performance.now(), currentTime: ctx.currentTime, startTime, delay: startTime - ctx.currentTime + (ctx.outputLatency || 0), outputLatency: ctx.outputLatency });
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

const { browser, engine } = await launchBrowser();
check(Object.keys(TOKENS).length === FIXTURES.valid.length,
  `the ${FIXTURES.valid.length} golden cases' token_uri are the class's output (length and SHA-256), decoded as a marketplace decodes them`);

/**
 * A fresh context with the instrumentation, network blocking (data: only, plus `serve`d URLs and
 * the `files` opened from disk) and error collection. `init` runs in every frame after the
 * instrumentation, before the page's scripts.
 * @param {{offline?: boolean, serve?: Record<string, {body: string, headers?: Record<string, string>}>, files?: string[], viewport?: {width: number, height: number}, hasTouch?: boolean, init?: () => void}} [o]
 */
async function open({ offline = false, serve = {}, files = [], viewport = { width: 400, height: 100 }, hasTouch = false, init } = {}) {
  // WebKit's offline emulation also fails the page's own blob: media (and logs an error for it), so
  // there the context stays online: every request that is not data:, blob: or served is aborted
  // and listed, so the page still shows that it needs no network.
  const context = await browser.newContext({ viewport, offline: offline && engine !== "webkit", hasTouch });
  await context.addInitScript(instrument);
  if (init) await context.addInitScript(init);
  /** @type {string[]} */
  const blocked = [];
  await context.route("**/*", (/** @type {any} */ route) => {
    const url = route.request().url();
    if (url.startsWith("data:") || url.startsWith("blob:") || files.includes(url)) return route.continue(); // blob:: the page's own silent media element
    const doc = serve[url];
    if (doc) return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", headers: doc.headers || {}, body: doc.body });
    blocked.push(url);
    return route.abort();
  });
  const page = await context.newPage();
  // Every resource request the page's renderer makes, data: URLs included (Chromium only, from the
  // DevTools protocol; null elsewhere): Playwright's own request events and route() skip data: URLs,
  // so neither `blocked` nor they could show that the gzip tag's data: URI is never fetched.
  const requests = await dataRequestLog(context, page);
  // What the page logs as errors or throws uncaught, as text (await it: it settles asynchronously).
  const logged = collectErrors(page);
  return { context, page, blocked, logged, requests };
}

/**
 * Checks that the shim inflated the engine: no gzip tag left, the first <head> script is the
 * engine (its text hashed here, in Node), it ran before the player registered its DOMContentLoaded
 * listener, and the gzip tag's data: URI was never requested.
 * @param {any} frame
 * @param {string[] | null} requests
 * @param {string} [observed] a URL whose request shows that requests are observed (default: the
 *   frame's own, which a srcdoc frame does not have)
 */
async function checkInflated(frame, requests, observed = frame.url()) {
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
  if (!requests) return skip(`the gzip tag's data: URI was never fetched: ${NO_CDP}`);
  // A document request (normally the frame's own) shows its requests are observed.
  const fetched = requests.filter((u) => u.startsWith("data:text/javascript"));
  check(requests.includes(observed) && fetched.length === 0,
    `the gzip tag's data: URI was never fetched (${requests.length} requests observed, ${observed === frame.url() ? "the frame's document" : observed} included)`);
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
    media: { plays: st.media.plays, paused: st.media.el ? st.media.el.paused : null, loop: st.media.el ? st.media.el.loop : null, duration: st.media.el ? st.media.el.duration : null, src: st.media.el ? st.media.el.src.slice(0, 5) : null },
    session: navigator.mediaSession ? {
      state: navigator.mediaSession.playbackState, handlers: Object.keys(st.handlers).sort(), title: navigator.mediaSession.metadata ? navigator.mediaSession.metadata.title : null,
      artwork: navigator.mediaSession.metadata ? Array.from(navigator.mediaSession.metadata.artwork, (/** @type {any} */ a) => a.sizes + " " + a.type) : null,
    } : null,
    synth: synth && { playing: synth.playing, startTime: synth.getPlayStatus().startTime, loop: synth.loop, loopEnd: synth.loopEnd, maxTick: synth.maxTick, tick2Time: synth.tick2Time, state: synth.getAudioContext().state, time: synth.getAudioContext().currentTime },
  };
});

/** Waits until the player has finished starting up (▶ enabled, or an error shown). */
const ready = (/** @type {any} */ frame) => frame.waitForFunction(() => {
  const b = /** @type {HTMLButtonElement | null} */ (document.getElementById("play"));
  const e = document.getElementById("error");
  return b && (!b.disabled || (e && !e.hidden));
});

/**
 * Clicks ▶ and waits until playback has started: the player's n-th playMIDI, which it calls once the
 * AudioContext's resume() has settled, and a MIDI message scheduled. How long resume() takes depends
 * on the engine and its audio output (Firefox settles it only once its output stream runs: up to
 * ~2 s on a null sink), so that time is printed, not assumed by a fixed sleep.
 * @param {any} frame
 * @param {number} [n]
 */
async function startPlayback(frame, n = 1) {
  const t0 = Date.now();
  await frame.click("#play");
  await frame.waitForFunction((/** @type {number} */ n) => {
    const st = /** @type {any} */ (window).__check;
    return st.plays.length >= n && st.sends.length > 0;
  }, n, { timeout: 10000 }).catch(() => {}); // the checks that follow report a start that never came
  console.log(`  info ▶ to playMIDI: ${Date.now() - t0} ms`);
}

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
    `pass-to-pass ${periods.map((p) => p.toFixed(6)).join(", ")} s = maxTick x tick2Time = ${st.synth.maxTick} x ${st.synth.tick2Time.toFixed(9)} = ${expected.toFixed(6)} s`);
  // The pass length from the MIDI's own tempo map (checkMidi), independent of the engine's tick2Time.
  check(periods.length >= 2 && periods.every((/** @type {number} */ p) => Math.abs(p - c.midi_loop_seconds) < 1e-6),
    `the tempo is right: each pass lasts ${c.midi_loop_seconds.toFixed(6)} s, the length the MIDI's tempo map gives`);
}

/** The sweep bar's left edge in a screenshot of the page, or -1. */
async function barX(/** @type {any} */ page) {
  const png = decodePng(await page.screenshot());
  for (let x = 0; x < png.width; x++) if (png.pixel(x, 20)[0] > 200) return x;
  return -1;
}

// ---------------------------------------------------------------------------------------------

/**
 * The media session's artwork is a static frame row made of the art's own bitmap: on the card's dark
 * colour, the bitmap's square frames side by side, centred, nearest-neighbour at a whole scale (a
 * Beasts-style card, a 250x350 SVG whose foreignObject holds a 32x32 PNG, or a sheet of 3 frames).
 * Android 13+ centre-crops the artwork to a wide panel, so the check is the composition: the
 * background fills the top and bottom rows, and every source pixel is a solid block in the row,
 * with no blended colour at any boundary.
 */
async function checkArtwork() {
  const c = CASES.default_120bpm;
  for (const frames of [1, 3]) {
    console.log(`media session artwork: ${frames} frame${frames > 1 ? "s" : ""} of 32x32 as a static row on the card colour (data: URI, offline)`);
    // Source pixels with a different colour from every neighbour (and from the background), so a blend shows anywhere.
    const colour = (/** @type {number} */ x, /** @type {number} */ y) => [(x * 37 + y * 11) % 200 + 40, (x * 5 + y * 61) % 200 + 40, (((x % 32) ^ y) * 29) % 200 + 40, 255];
    const png = encodePng(32 * frames, 32, colour).toString("base64");
    const svg = "<svg xmlns='http://www.w3.org/2000/svg' xmlns:xhtml='http://www.w3.org/1999/xhtml' width='250' height='350' viewBox='0 0 250 350'><title>Artwork check</title>" +
      `<foreignObject x='0' y='0' width='250' height='250'><xhtml:img src='data:image/png;base64,${png}' style='width:100%;height:100%;image-rendering:pixelated'/></foreignObject></svg>`;
    const { context, page, logged } = await open({ offline: true });
    await page.goto(dataUrl(PAGE + c.d + svg));
    await ready(page);
    await startPlayback(page);
    const done = await page.waitForFunction(() => {
      const m = navigator.mediaSession && navigator.mediaSession.metadata;
      return !navigator.mediaSession || (m && m.artwork.length === 2);
    }, null, { timeout: 5000 }).then(() => true, () => false);
    const meta = await page.evaluate(() => {
      const m = navigator.mediaSession && navigator.mediaSession.metadata;
      return m && { title: m.title, artwork: Array.from(m.artwork, (a) => ({ src: a.src, sizes: a.sizes, type: a.type })) };
    });
    if (!meta) skip("media session artwork: this engine has no navigator.mediaSession");
    else {
      check(done && meta.title === "Artwork check", `the title is the art's <title> (${meta.title}) and the artwork is set`);
      for (const n of [512, 256]) {
        const a = meta.artwork.find((x) => x.sizes === `${n}x${n}`);
        check(!!a && a.type === "image/png" && a.src.startsWith("data:image/png;base64,"), `artwork ${n}x${n} is a PNG data URL`);
        if (!a) continue;
        const img = decodePng(Buffer.from(a.src.slice("data:image/png;base64,".length), "base64"));
        // 5x for one frame (160 px of 512), fitted to the width for more, and a whole scale of at most half that at 256.
        const k = Math.max(1, Math.floor(Math.min((n * 160) / 512 / 32, n / (32 * frames))));
        const x0 = Math.floor((n - 32 * frames * k) / 2), y0 = Math.floor((n - 32 * k) / 2);
        const background = [0x1e, 0x1e, 0x22].join();
        let wrong = 0, blank = 0;
        for (let y = 0; y < n; y++) {
          for (let x = 0; x < n; x++) {
            const inRow = x >= x0 && x < x0 + 32 * frames * k && y >= y0 && y < y0 + 32 * k;
            const want = inRow ? colour(Math.floor((x - x0) / k), Math.floor((y - y0) / k)).slice(0, 3).join() : background;
            if (img.pixel(x, y).join() !== want) wrong++;
            if (!inRow && (y === 0 || y === n - 1) && img.pixel(x, y).join() !== background) blank++;
          }
        }
        check(img.width === n && img.height === n && blank === 0 && wrong === 0,
          `artwork ${n}x${n}: the card colour at the top and bottom edges, ${frames} frame${frames > 1 ? "s" : ""} in a ${32 * frames * k}x${32 * k} row at ${k}x, every source pixel a solid ${k}x${k} block (${wrong} of ${n * n} pixels differ from nearest-neighbour)`);
      }
    }
    const errors = await logged();
    check(errors.length === 0, `no console errors${errors.length ? ": " + errors.join(" | ") : ""}`);
    await context.close();
  }
}

/**
 * The ▶/■ button sits at the art's `data-play-anchor`: on a card whose art frame (a rounded black
 * rect) is (15, 58) to (235, 202) in a 250x350 viewBox, with the Beast's box (62, 66) to (190, 194)
 * inside it, anchored at "235 202 32" (the frame's bottom-right corner, a 32-unit button), the
 * button's bounding rect lies inside the frame, in its bottom-right quadrant, with a diameter of 32 x
 * the art's scale on screen (44 to 128 px) and its corner max(32 / 8, 6) units in from the anchor,
 * so it clears the frame's 8-unit rounded corner, with its centre to the right of the Beast box:
 * in a portrait viewport the art fills, in larger ones, after a resize, in a landscape one where the
 * art is scaled and centred (object-fit: contain), and with the image displayed at 75%. (The 44 px
 * minimum and the 6-unit inset need 50 units of room to the Beast at scale 1, and the frame leaves
 * 45, so the button may overlap the Beast box's right edge by a few px.) Clicking it still plays.
 * Without a diameter the button is 48 px; without the attribute, or with a malformed one, it stays at
 * the viewport's bottom-right corner.
 */
async function checkPlayAnchor() {
  const c = CASES.default_120bpm;
  const card = (/** @type {string} */ attrs) => `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 250 350' ${attrs}><rect width='250' height='350' fill='#1e1e22'/><rect x='15' y='58' width='220' height='144' rx='8' fill='#000'/><rect x='62' y='66' width='128' height='128' fill='#c60'/></svg>`;
  console.log("play button anchored at the art's data-play-anchor (data: URI, offline)");
  const { context, page, logged } = await open({ offline: true, viewport: { width: 250, height: 350 } });
  await page.goto(dataUrl(PAGE + c.d + card("data-play-anchor='235 202 32'")));
  await ready(page);
  // The button's rect and the art <img>'s own rect, as the page sees them.
  const rect = () => page.evaluate(() => {
    const r = /** @type {HTMLElement} */ (document.getElementById("play")).getBoundingClientRect();
    const i = /** @type {HTMLElement} */ (document.querySelector("img")).getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, img: { left: i.left, top: i.top, width: i.width, height: i.height } };
  });
  /**
   * The button lands in the bottom-right quadrant of the art frame, wherever the <img> draws the art
   * (object-fit: contain inside the img's own rect), with the diameter and inset the anchor gives,
   * clear of the frame's rounded corner. It moves after a resize or a resized image, so this waits
   * for it, up to 2 s.
   * @param {string} label
   */
  const inBox = async (label) => {
    /** @type {any} */ let r, x, y, size, k;
    const near = (/** @type {number} */ a, /** @type {number} */ b) => Math.abs(a - b) <= 1.5;
    const placed = () => near(r.right, x(235) - 6 * k) && near(r.bottom, y(202) - 6 * k) && near(r.right - r.left, size) && near(r.bottom - r.top, size);
    for (let n = 0; n < 40; n++) {
      r = await rect();
      k = Math.min(r.img.width / 250, r.img.height / 350);
      size = Math.min(128, Math.max(44, 32 * k));
      x = (/** @type {number} */ v) => r.img.left + (r.img.width - 250 * k) / 2 + v * k;
      y = (/** @type {number} */ v) => r.img.top + (r.img.height - 350 * k) / 2 + v * k;
      if (placed()) break;
      await page.waitForTimeout(50);
    }
    const cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
    const quadrant = cx >= (x(15) + x(235)) / 2 && cy >= (y(58) + y(202)) / 2;
    const inFrame = r.left >= x(15) && r.top >= y(58) && r.right <= x(235) + 0.5 && r.bottom <= y(202) + 0.5;
    // The circle's nearest point to the frame's corner is further than the corner the 8-unit radius cuts off.
    const cornerGap = Math.hypot(x(235) - cx, y(202) - cy) - size / 2;
    const outsideBeast = cx >= x(190);
    check(placed() && inFrame && quadrant && outsideBeast && cornerGap >= 0.414 * 8 * k,
      `${label}: the ${(r.right - r.left).toFixed(1)} px button (${r.left.toFixed(1)}, ${r.top.toFixed(1)}) to (${r.right.toFixed(1)}, ${r.bottom.toFixed(1)}) is in the bottom-right quadrant of the frame (${x(15).toFixed(1)}, ${y(58).toFixed(1)}) to (${x(235).toFixed(1)}, ${y(202).toFixed(1)}), its centre right of the Beast box (x >= ${x(190).toFixed(1)}), ${cornerGap.toFixed(1)} px from the corner (rounded corner cuts ${(0.414 * 8 * k).toFixed(1)}); expected ${size.toFixed(1)} px (32 x scale ${k.toFixed(2)}, 44 to 128), the corner ${(6 * k).toFixed(1)} px in`);
  };
  await inBox("portrait 250x350");
  await page.setViewportSize({ width: 500, height: 400 });
  await inBox("landscape 500x400 after a resize");
  await page.setViewportSize({ width: 250, height: 350 });
  await page.setViewportSize({ width: 750, height: 1050 });
  await inBox("portrait 750x1050 (a 96 px button)");
  await page.setViewportSize({ width: 1000, height: 1400 });
  await inBox("portrait 1000x1400 (a 128 px button)");
  await page.setViewportSize({ width: 1250, height: 1750 });
  await inBox("portrait 1250x1750 (160 px clamped to 128 px)");
  await page.setViewportSize({ width: 250, height: 350 });
  await inBox("portrait again");
  // A host or a shared copy that displays the image smaller (75%): the ResizeObserver follows it.
  await page.evaluate(() => { const i = /** @type {HTMLElement} */ (document.querySelector("img")); i.style.width = "75%"; i.style.height = "75%"; });
  await inBox("the img displayed at 75%");
  await page.evaluate(() => { const i = /** @type {HTMLElement} */ (document.querySelector("img")); i.style.width = ""; i.style.height = ""; });
  await inBox("the img back to 100%");
  await startPlayback(page);
  check((await state(page)).label === "Stop", "the anchored button plays (a click on it started playback)");
  await inBox("while playing, after the art restarted");
  const errors = await logged();
  check(errors.length === 0, `no console errors${errors.length ? ": " + errors.join(" | ") : ""}`);
  await context.close();

  // No diameter: 48 px, the corner 6 px inside the anchor.
  {
    const o = await open({ offline: true, viewport: { width: 250, height: 350 } });
    await o.page.goto(dataUrl(PAGE + c.d + card("data-play-anchor='235 202'")));
    await ready(o.page);
    const r = await o.page.evaluate(() => {
      const b = /** @type {HTMLElement} */ (document.getElementById("play")).getBoundingClientRect();
      return { right: b.right, bottom: b.bottom, w: b.width };
    });
    check(r.w === 48 && Math.abs(r.right - 229) <= 1.5 && Math.abs(r.bottom - 196) <= 1.5, `an anchor without a diameter: a ${r.w} px button, its corner (${r.right}, ${r.bottom}) 6 px inside (235, 202)`);
    await o.context.close();
  }
  // No attribute, and a malformed one: the corner.
  for (const attrs of ["", "data-play-anchor='235'", "data-play-anchor='235 202 0'"]) {
    const o = await open({ offline: true, viewport: { width: 250, height: 350 } });
    await o.page.goto(dataUrl(PAGE + c.d + card(attrs)));
    await ready(o.page);
    const r = await o.page.evaluate(() => {
      const b = /** @type {HTMLElement} */ (document.getElementById("play")).getBoundingClientRect();
      return { right: innerWidth - b.right, bottom: innerHeight - b.bottom, w: b.width };
    });
    check(r.right === 12 && r.bottom === 12 && r.w === 40, `${attrs ? "a malformed anchor" : "no anchor"}: the button stays 12 px from the bottom-right corner, 40 px`);
    await o.context.close();
  }
}

/**
 * Background audio (the silent <audio> element and the media session) after ▶ and after ■, in
 * whatever frame the page is in. The element must play (a looping 6 s blob: WAV) after ▶ and be
 * paused after ■; where the engine has navigator.mediaSession, the playback state follows, and the
 * play, pause and stop handlers (and no others) are registered.
 * @param {any} frame
 * @param {"playing" | "paused"} now
 */
async function checkBackground(frame, now) {
  // The duration is known once the browser has loaded the element's blob: URL, shortly after play().
  if (now === "playing") await frame.waitForFunction(() => Number.isFinite(/** @type {any} */ (window).__check.media.el.duration), null, { timeout: 5000 }).catch(() => {});
  const st = await state(frame);
  const el = st.media;
  check(el.plays >= 1 && el.src === "blob:" && el.loop === true && el.paused === (now === "paused"),
    `silent media element ${now === "playing" ? "playing" : "paused"} (${el.plays} play() calls, ${el.src} URL, loop ${el.loop}, duration ${el.duration} s)`);
  if (now === "playing") check(el.duration === 6, "the silent element is a 6 s WAV the browser decodes");
  if (!st.session) return skip("navigator.mediaSession: this engine has none");
  check(st.session.state === now, `mediaSession.playbackState is ${st.session.state}`);
  check(st.session.handlers.join() === "pause,play,stop", `mediaSession handlers: ${st.session.handlers.join(", ")}`);
}

/**
 * The media session's handlers and a pause from outside drive the page as ▶ and ■ do: while the page
 * plays, the captured pause handler stops it (the engine stopped, the element paused), the play
 * handler starts it again, and pausing the silent element (a notification, a headset, a call) stops
 * it like ■. Ends stopped.
 * @param {any} frame
 */
async function checkMediaControls(frame) {
  const before = await state(frame);
  if (!before.session) return skip("media session handlers: this engine has no navigator.mediaSession");
  const wait = (/** @type {number} */ n) => frame.waitForFunction((/** @type {number} */ n) => /** @type {any} */ (window).__check.plays.length >= n && /** @type {any} */ (window).__check.sends.length > 0, n, { timeout: 15000 });
  await frame.evaluate(() => /** @type {any} */ (window).__check.handlers.pause());
  let st = await state(frame);
  check(st.label === "Play" && st.synth.playing === 0 && st.media.paused === true && st.session.state === "paused", "the pause handler stops: ▶ shown, the engine stopped, the element paused");
  await frame.evaluate(() => /** @type {any} */ (window).__check.handlers.play());
  await wait(before.plays.length + 1);
  st = await state(frame);
  check(st.label === "Stop" && st.synth.playing === 1 && st.synth.state === "running" && st.media.paused === false && st.session.state === "playing" && st.plays.length === before.plays.length + 1,
    `the play handler starts: ■ shown, the engine playing (AudioContext ${st.synth.state}), the element playing`);
  await frame.evaluate(() => /** @type {any} */ (window).__check.media.el.pause());
  // The element's pause event is delivered asynchronously.
  await frame.waitForFunction(() => document.getElementById("play")?.getAttribute("aria-label") === "Play", null, { timeout: 5000 }).catch(() => {});
  st = await state(frame);
  check(st.label === "Play" && st.synth.playing === 0 && st.session.state === "paused", "pausing the silent element from outside stops the player, as ■ does");
  await frame.evaluate(() => /** @type {any} */ (window).__check.handlers.play());
  await wait(before.plays.length + 2);
  await frame.evaluate(() => /** @type {any} */ (window).__check.handlers.stop());
  st = await state(frame);
  check(st.label === "Play" && st.synth.playing === 0 && st.media.paused === true, "the stop handler stops");
}

/**
 * Background audio on the data: page: the silent element plays after ▶ and is paused after ■ (and
 * again after ▶), the media session's handlers drive ▶/■, and a pause from outside stops the player.
 * Online, with every request still blocked and listed.
 */
async function checkBackgroundAudio() {
  const c = CASES.default_120bpm;
  console.log(`background audio: silent media element and media session (${c.name}, data: URI)`);
  const { context, page, blocked, logged } = await open();
  await page.goto(TOKENS[c.name].url);
  await ready(page);
  check((await state(page)).media.plays === 0, "no media element before ▶");
  await startPlayback(page);
  await checkBackground(page, "playing");
  await page.click("#play");
  await checkBackground(page, "paused");
  await startPlayback(page, 2);
  await checkBackground(page, "playing");
  await checkMediaControls(page);
  const errors = await logged();
  check(errors.length === 0, `no console errors${errors.length ? ": " + errors.join(" | ") : ""}`);
  check(blocked.length === 0, `no network requests${blocked.length ? ": " + blocked.join(" ") : ""}`);
  await context.close();
}

/** The data: page with the probe art: everything, including the art restart. */
async function checkDataPage() {
  const c = CASES.beast_140bpm;
  console.log(`data: URI, offline (${c.name}: art-restart probe, ${(c.midi_loop_seconds).toFixed(4)} s loop at ${(60 / (c.midi_loop_seconds / 4)).toFixed(4)} BPM)`);
  const { context, page, blocked, logged, requests } = await open({ offline: true });
  await page.goto(TOKENS[c.name].url);
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

  await startPlayback(page);
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
    `startTime - currentTime ${(1000 * (play.startTime - play.currentTime)).toFixed(1)} ms + outputLatency ${(1000 * (play.outputLatency || 0)).toFixed(1)} ms = ${(1000 * play.delay).toFixed(1)} ms (lag ${lag.toFixed(1)} ms)`);

  // After ▶: the bar follows time since the latest restart (passes restart it too), not since the
  // page loaded.
  await page.waitForTimeout(1200);
  const t1 = await page.evaluate(() => performance.now());
  const after = await barX(page);
  const latest = (await state(page)).imgs.filter((/** @type {any} */ i) => i.at <= t1).at(-1);
  const sinceRestart = (t1 - latest.at) / 1000;
  const sinceLoad1 = (t1 - st.imgs[0].at) / 1000;
  check(Math.abs(after - (390 * sinceRestart) / SWEEP_SECONDS) < 20 && after < (390 * sinceLoad1) / SWEEP_SECONDS - 100,
    `after ▶: bar at x = ${after}, ${sinceRestart.toFixed(2)} s after the restart (expected ~${Math.round((390 * sinceRestart) / SWEEP_SECONDS)}; ~${Math.round((390 * sinceLoad1) / SWEEP_SECONDS)} had it not restarted)`);
  if (shotDir) await page.screenshot({ path: join(shotDir, "page_after_play.png") });
  st = await state(page);
  const time = st.synth.time;
  await page.waitForTimeout(200);
  check((await state(page)).synth.time > time, "AudioContext clock advancing");
  const starts = await passStarts(page, c.midi_loop_seconds);
  check(Math.abs(starts[0] - play.startTime) < 1e-9, `first note (tick 0) at startTime (${play.startTime.toFixed(4)} s)`);
  await checkLoop(page, c);

  // Every pass restarts the art at its tick 0 as heard, as ▶ does: the pass's start (its first lead
  // note, at tick 0) plus the output latency, mapped to page time from playMIDI's clock sample.
  st = await state(page);
  const heard = (await passStarts(page, c.midi_loop_seconds)).filter((t) => t + (play.outputLatency || 0) < st.synth.time - 0.1);
  const passLags = heard.slice(1).map((t, k) => {
    const img = st.imgs[k + 2];
    return img && img.src.includes(`;r=${k + 2};base64,`) ? img.at - (play.at + (t + (play.outputLatency || 0) - play.currentTime) * 1000) : NaN;
  });
  // Lags are measured against one AudioContext-to-page clock mapping sampled at ▶. In CI's headless
  // Chromium that mapping moves by several ms between runs (measured from -7.5 to +3.5 ms with the
  // same player), so the early bound allows -20 ms: still far tighter than any visible early restart.
  check(passLags.length >= 2 && passLags.every((l) => l > -20 && l < 100),
    `the art restarted at each of the ${passLags.length} passes heard since ▶, at the pass's tick 0 as heard (lags ${passLags.map((l) => l.toFixed(1)).join(", ")} ms)`);

  await page.click("#play");
  st = await state(page);
  const sends = st.sends;
  await page.waitForTimeout(Math.ceil((c.midi_loop_seconds + 0.3) * 1000));
  const stopped = await state(page);
  check(st.label === "Play" && stopped.synth.playing === 0 && stopped.synth.startTime === null && stopped.sends === sends, "■ stops: the engine stopped (startTime null), nothing scheduled after it");
  check(stopped.imgs.length === st.imgs.length, "■: no art restart after it, for a whole pass");

  const before2 = stopped.imgs.length;
  await startPlayback(page, 2);
  await page.waitForFunction((/** @type {number} */ n) => /** @type {any} */ (window).__check.imgs.length > n, before2, { timeout: 3000 }).catch(() => {});
  st = await state(page);
  const again = st.plays[1];
  const restartStarts = (await passStarts(page, c.midi_loop_seconds)).filter((t) => t >= again.startTime - 1e-9);
  check(st.constructed === 1 && st.label === "Stop" && Math.abs(restartStarts[0] - again.startTime) < 1e-9,
    "▶ again: same synth, playback from tick 0 at startTime");
  check(st.imgs.length > before2 && st.imgs[before2].src.includes(`;r=${before2};base64,`), `▶ again: art restarted again (r=${before2})`);
  const errors = await logged();
  check(errors.length === 0, `no console errors${errors.length ? ": " + errors.join(" | ") : ""}`);
  check(blocked.length === 0, `no network requests${blocked.length ? ": " + blocked.join(" ") : ""}`);
  await context.close();
}

/** The page inside a sandboxed iframe (opaque origin, scripts only). */
async function checkIframe() {
  const c = CASES.unicode_art;
  console.log(`<iframe sandbox="allow-scripts" src="data:..."> (${c.name})`);
  const host = "http://host.test/embed.html";
  const body = `<!doctype html><title>host</title><iframe sandbox="allow-scripts" width="400" height="200" src="${TOKENS[c.name].url}"></iframe>`;
  const { context, page, blocked, logged, requests } = await open({ serve: { [host]: { body } }, viewport: { width: 420, height: 220 } });
  await page.goto(host);
  const frame = await (await page.waitForSelector("iframe")).contentFrame();
  await ready(frame);
  await checkInflated(frame, requests);
  await frame.waitForFunction(() => document.querySelector("img")?.complete);
  let st = await state(frame);
  check(st.origin === "null", "the frame has an opaque origin (sandboxed)");
  check(st.readyDisabled === true && !st.disabled, "▶ disabled until DOMContentLoaded, then enabled");
  check(st.img.src === artSrc(c.svg) && st.img.w > 0, `art shown (UTF-8 SVG re-encoded byte for byte, ${st.img.w}x${st.img.h})`);
  await startPlayback(frame);
  st = await state(frame);
  check(st.constructed === 1 && st.synth.state === "running" && st.sends > 0, `▶: AudioContext ${st.synth.state}, ${st.sends} MIDI messages scheduled`);
  await checkLoop(frame, c);
  await frame.click("#play");
  st = await state(frame);
  check(st.synth.playing === 0 && st.label === "Play", "■ stops");
  const errors = await logged();
  check(errors.length === 0, `no console errors${errors.length ? ": " + errors.join(" | ") : ""}`);
  check(blocked.length === 0, `no network requests beyond the host page${blocked.length ? ": " + blocked.join(" ") : ""}`);
  await context.close();
}

/** The page served with a strict CSP (inline scripts and styles, data: images, blob: media; nothing else). */
async function checkCsp() {
  const c = CASES.six_timbres_format1;
  console.log(`Content-Security-Policy: ${CSP}; sandbox allow-scripts (${c.name})`);
  const url = "http://player.test/token.html";
  const { context, page, blocked, logged, requests } = await open({ serve: { [url]: { body: TOKENS[c.name].html, headers: { "Content-Security-Policy": CSP + "; sandbox allow-scripts" } } } });
  await page.goto(url);
  await ready(page);
  await checkInflated(page, requests);
  await page.waitForFunction(() => document.querySelector("img")?.complete);
  let st = await state(page);
  check(st.origin === "null" && !st.disabled && st.img.w === 250, "art shown and ▶ enabled under the CSP");
  await startPlayback(page);
  st = await state(page);
  check(st.synth?.state === "running" && st.sends > 0, `▶ plays (${st.sends} MIDI messages scheduled)`);
  await checkBackground(page, "playing");
  await checkLoop(page, c);
  st = await state(page);
  // The CSP allows no data: scripts, so fetching the gzip tag's data: URI would be a script-src
  // violation, which every engine reports (checkCspControl): this is that proof on every engine.
  check(st.violations.length === 0, `no CSP violations, so the gzip tag's data: URI was never fetched${st.violations.length ? ": " + st.violations.join(" | ") : ""}`);
  const errors = await logged();
  check(errors.length === 0, `no console errors${errors.length ? ": " + errors.join(" | ") : ""}`);
  check(blocked.length === 0, `no network requests beyond the page${blocked.length ? ": " + blocked.join(" ") : ""}`);
  await context.close();
}

/**
 * The control for checkCsp's proof: under the same CSP, a plain <script src="data:..."> (a type the
 * browser does fetch) must be blocked and reported as a script-src violation. That shows the engine
 * reports such a fetch, so the page's lack of violations shows the gzip tag's data: URI was never
 * fetched: the one proof of it on Firefox and WebKit, where no DevTools protocol shows data: requests.
 */
async function checkCspControl() {
  console.log("CSP control: a plain <script src=\"data:...\"> under the same CSP");
  const url = "http://player.test/control.html";
  const script = "data:text/javascript;base64," + Buffer.from("window.__fetched = 1").toString("base64");
  const body = `<!doctype html><title>control</title><script src="${script}"></script>`;
  const { context, page } = await open({ serve: { [url]: { body, headers: { "Content-Security-Policy": CSP + "; sandbox allow-scripts" } } } });
  await page.goto(url);
  await page.waitForFunction(() => /** @type {any} */ (window).__check.violations.length > 0, null, { timeout: 3000 }).catch(() => {});
  const r = await page.evaluate(() => ({ violations: /** @type {any} */ (window).__check.violations, fetched: /** @type {any} */ (window).__fetched }));
  check(r.fetched === undefined && r.violations.some((/** @type {string} */ v) => /^script-src(-elem)? data$/.test(v)),
    `the data: script was blocked and reported (${r.violations.join(" | ") || "no violation"})`);
  await context.close();
}

/**
 * The page decoded to a file and opened from disk (file://). Not with the browser offline: WebKit
 * fails a file:// navigation under Playwright's offline emulation. Every other request is blocked
 * and listed, so none means the page needs no network.
 */
async function checkFile() {
  const c = CASES.min_fields;
  console.log(`file:// (${c.name})`);
  const dir = mkdtempSync(join(tmpdir(), "tinysynth-page-"));
  try {
    const path = join(dir, "animation.html");
    writeFileSync(path, TOKENS[c.name].html, "utf8");
    const url = pathToFileURL(path).href;
    const { context, page, blocked, logged, requests } = await open({ files: [url] });
    await page.goto(url);
    await ready(page);
    await checkInflated(page, requests);
    await page.waitForFunction(() => document.querySelector("img")?.complete);
    let st = await state(page);
    check(st.readyDisabled === true && !st.disabled, "▶ disabled until DOMContentLoaded, then enabled");
    check(st.img.src === artSrc(c.svg) && st.img.w === 250 && st.constructed === 0, `art shown (${st.img.w}x${st.img.h}), no synth before ▶`);
    await startPlayback(page);
    st = await state(page);
    check(st.constructed === 1 && st.synth.state === "running" && st.sends > 0, `▶: AudioContext ${st.synth.state}, ${st.sends} MIDI messages scheduled`);
    await checkLoop(page, c);
    await page.click("#play");
    st = await state(page);
    check(st.synth.playing === 0 && st.label === "Play", "■ stops");
    const errors = await logged();
    check(errors.length === 0, `no console errors${errors.length ? ": " + errors.join(" | ") : ""}`);
    check(blocked.length === 0, `no network requests${blocked.length ? ": " + blocked.join(" ") : ""}`);
    await context.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Two other ways a host can frame animation_url: the decoded HTML in a sandboxed srcdoc frame
 * (escaped for the attribute), and re-served from another origin in a frame sandboxed with
 * allow-scripts allow-same-origin. Generic patterns; which marketplace uses which is surveyed by
 * hand (issue #11).
 */
async function checkEmbeds() {
  const c = CASES.slot_edges;
  const { html } = TOKENS[c.name];
  const host = "http://host.test/embed.html";
  const cdn = "http://cdn.test/token.html";
  const attr = html.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  /** @type {Array<[string, string, Record<string, {body: string}>, string]>} [label, frame, served, frame origin] */
  const embeds = [
    ['<iframe sandbox="allow-scripts" srcdoc="...">', `<iframe sandbox="allow-scripts" width="400" height="200" srcdoc="${attr}"></iframe>`, {}, "null"],
    ['<iframe sandbox="allow-scripts allow-same-origin" src="http://cdn.test/...">, re-served from another origin',
      `<iframe sandbox="allow-scripts allow-same-origin" width="400" height="200" src="${cdn}"></iframe>`, { [cdn]: { body: html } }, "http://cdn.test"],
  ];
  for (const [label, frameTag, served, origin] of embeds) {
    console.log(`${label} (${c.name})`);
    const body = `<!doctype html><title>host</title>${frameTag}`;
    const { context, page, blocked, logged, requests } = await open({ serve: { [host]: { body }, ...served }, viewport: { width: 420, height: 220 } });
    await page.goto(host);
    const frame = await (await page.waitForSelector("iframe")).contentFrame();
    await ready(frame);
    await checkInflated(frame, requests, frame.url() === "about:srcdoc" ? host : frame.url());
    await frame.waitForFunction(() => document.querySelector("img")?.complete);
    let st = await state(frame);
    check(st.origin === origin, `the frame's origin is ${st.origin}`);
    check(st.readyDisabled === true && !st.disabled && st.img.src === artSrc(c.svg) && st.img.w === 250, `art shown (${st.img.w}x${st.img.h}) and ▶ enabled`);
    await startPlayback(frame);
    st = await state(frame);
    check(st.constructed === 1 && st.synth.state === "running" && st.sends > 0, `▶: AudioContext ${st.synth.state}, ${st.sends} MIDI messages scheduled`);
    await frame.click("#play");
    st = await state(frame);
    check(st.synth.playing === 0 && st.label === "Play", "■ stops");
    const errors = await logged();
    check(errors.length === 0, `no console errors${errors.length ? ": " + errors.join(" | ") : ""}`);
    check(blocked.length === 0, `no network requests beyond the host page${blocked.length ? ": " + blocked.join(" ") : ""}`);
    await context.close();
  }
}

/** ▶ and ■ by touch, as on a phone: taps in a context with touch (hasTouch; isMobile is not on every engine). */
async function checkTouch() {
  const c = CASES.all_builtin_waves;
  console.log(`touch: tap ▶, then tap ■ (${c.name}, data: URI, offline)`);
  const { context, page, blocked, logged } = await open({ offline: true, hasTouch: true });
  await page.goto(TOKENS[c.name].url);
  await ready(page);
  check((await state(page)).constructed === 0, "no synth before the tap");
  const t0 = Date.now();
  await page.tap("#play");
  await page.waitForFunction(() => {
    const st = /** @type {any} */ (window).__check;
    return st.plays.length >= 1 && st.sends.length > 0 && st.imgs.length >= 2;
  }, null, { timeout: 10000 }).catch(() => {}); // the checks that follow report a start that never came
  console.log(`  info tap to the art restart: ${Date.now() - t0} ms`);
  let st = await state(page);
  check(st.constructed === 1 && st.synth?.state === "running" && st.sends > 0 && st.label === "Stop",
    `tap ▶: AudioContext ${st.synth?.state}, ${st.sends} MIDI messages scheduled, ▶ became ■`);
  check(st.imgs.length >= 2 && st.imgs[1].src.includes(";r=1;base64,"), "tap ▶: art restarted (r=1)");
  await page.tap("#play");
  st = await state(page);
  check(st.synth?.playing === 0 && st.label === "Play", "tap ■: stopped");
  const errors = await logged();
  check(errors.length === 0, `no console errors${errors.length ? ": " + errors.join(" | ") : ""}`);
  check(blocked.length === 0, "no network requests");
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
    ["settings with a count over its bound", withSettings("1,1,30,40,64,0,176"), "settings: TS: too many timbres"],
    ["MIDI that is not base64", withMidi("@@not base64@@"), "midi: not base64"],
    ["MIDI cut after 4 bytes", withMidi("TVRoZA=="), "midi: truncated (byte 4)"],
    ["MIDI without End-of-Track", withMidi(noEot), "midi: truncated (byte 30)"],
  ];
  for (const [label, d, message] of variants) {
    console.log(`failure variant: ${label} (data: URI, offline)`);
    const { context, page, blocked, logged } = await open({ offline: true, viewport: { width: 400, height: 400 } });
    await page.goto(dataUrl(htmlOf(c, d)));
    await ready(page);
    await page.waitForFunction(() => document.querySelector("img")?.complete);
    const st = await state(page);
    check(st.img.src === artSrc(c.svg) && st.img.w === 250 && st.img.h === 350, `art still shown (${st.img.w}x${st.img.h})`);
    check(st.disabled && st.title === message, "▶ disabled, with the error as its title");
    check(st.error === message && (await page.isVisible("#error")), `error shown: ${JSON.stringify(st.error)}`);
    await page.click("#play", { force: true });
    check((await state(page)).constructed === 0, "no synth constructed, even after clicking ▶");
    const errors = await logged();
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
  const html = TOKENS[c.name].html;
  const editBytes = (/** @type {(b: Buffer) => Buffer} */ f) => withGzipPayload(html, (p) => f(Buffer.from(p, "base64")).toString("base64"));
  /** @type {Array<[string, string, string[]]>} [label, html, what the console logs, in order] */
  const variants = [
    ["a corrupt gzip payload (one byte changed mid-stream)", editBytes((b) => { const x = Buffer.from(b); x[x.length >> 1] ^= 0x55; return x; }), ["gunzip:", ENGINE_MISSING]],
    ["a truncated gzip payload", editBytes((b) => b.subarray(0, b.length >> 1)), ["gunzip: invalid gzip data", ENGINE_MISSING]],
    ["no gzip tag", withGzipPayload(html, () => null), [ENGINE_MISSING]],
    ["a gzip payload that inflates to a script without the engine", withGzipPayload(html, () => gzipSync("/* not TinySynth */").toString("base64")), [ENGINE_MISSING]],
  ];
  for (const [label, page_, expected] of variants) {
    console.log(`engine failure: ${label} (data: URI, offline)`);
    const { context, page, blocked, logged, requests } = await open({ offline: true, viewport: { width: 400, height: 400 } });
    await page.goto(dataUrl(page_));
    await ready(page);
    await page.waitForFunction(() => document.querySelector("img")?.complete);
    const st = await state(page);
    check(st.img.src === artSrc(c.svg) && st.img.w === 250 && st.img.h === 350, `art still shown (${st.img.w}x${st.img.h})`);
    check(st.disabled && st.title === ENGINE_MISSING, "▶ disabled, with the error as its title");
    check(st.error === ENGINE_MISSING && (await page.isVisible("#error")), `error shown: ${JSON.stringify(st.error)}`);
    await page.click("#play", { force: true });
    check((await state(page)).constructed === 0, "no synth constructed, even after clicking ▶");
    const errors = await logged();
    check(errors.length === expected.length && expected.every((m, i) => errors[i].includes(m)),
      `logged: ${errors.map((e) => JSON.stringify(e.split("\n")[0])).join(", ")}`);
    check(blocked.length === 0, "no network requests");
    if (requests) check(requests.length > 0 && !requests.some((u) => u.startsWith("data:text/javascript")), "the gzip tag's data: URI not fetched");
    else skip(`the gzip tag's data: URI not fetched: ${NO_CDP}`);
    await context.close();
  }
}

/**
 * ▶ fails (D9): the browser has no Web Audio (no AudioContext, as with Firefox's
 * media.webaudio.enabled set to false), or the AudioContext's resume() rejects. The art stays
 * visible, ▶ becomes disabled with the error shown and logged, and nothing is scheduled.
 */
async function checkAudioFailures() {
  const c = CASES.default_120bpm;
  const REFUSED = "resume refused (page-check)";
  /** @type {Array<[string, () => void, string | null]>} [label, init script, the error shown (null: the engine's own words)] */
  const variants = [
    ["no Web Audio (AudioContext undefined)", () => {
      const w = /** @type {any} */ (window);
      delete w.AudioContext;
      delete w.webkitAudioContext;
    }, null],
    ["AudioContext.resume() rejects", () => {
      AudioContext.prototype.resume = () => Promise.reject(new Error("resume refused (page-check)"));
    }, REFUSED],
  ];
  for (const [label, init, message] of variants) {
    console.log(`▶ fails: ${label} (data: URI, offline)`);
    const { context, page, blocked, logged } = await open({ offline: true, viewport: { width: 400, height: 400 }, init });
    await page.goto(TOKENS[c.name].url);
    await ready(page);
    await page.waitForFunction(() => document.querySelector("img")?.complete);
    check(!(await state(page)).disabled, "▶ enabled: the page itself loaded");
    await page.click("#play");
    await page.waitForFunction(() => !(/** @type {HTMLElement} */ (document.getElementById("error")).hidden), null, { timeout: 10000 }).catch(() => {});
    const st = await state(page);
    check(st.img.src === artSrc(c.svg) && st.img.w === 250 && st.img.h === 350 && st.img.count === 1, `art still shown (${st.img.w}x${st.img.h})`);
    check(st.disabled && !!st.error && st.title === st.error && (message === null || st.error === message) && (await page.isVisible("#error")),
      `▶ disabled, error shown and as its title: ${JSON.stringify(st.error)}`);
    check(st.constructed === 1 && st.label === "Play" && st.plays.length === 0 && st.sends === 0, "▶ shows ▶ again, nothing scheduled");
    await page.click("#play", { force: true });
    check((await state(page)).constructed === 1, "clicking the disabled ▶ again does nothing");
    // When resume() rejects, the engine's own resume() calls (it makes them in send() while the
    // context is suspended) reject too, unhandled: the same error, logged again.
    const errors = await logged();
    check(errors.length >= 1 && !!st.error && errors.every((e) => e.includes(/** @type {string} */ (st.error))),
      `only that error logged (${errors.map((e) => JSON.stringify(e.split("\n")[0])).join(", ")})`);
    check(blocked.length === 0, "no network requests");
    await context.close();
  }
}

/** Range checks are Cairo's job: SETTINGS that parse but break a range rule (quality 2) still play. */
async function checkRangeOnly() {
  const c = CASES.default_120bpm;
  // A rule the engine does not enforce: program 0 twice (the second wins). Since fork T5 the engine
  // itself rejects most values the class rejects, such as quality 2 (its constructor throws, so the
  // page fails closed): those cannot show the page's part.
  console.log("range-only violation (a duplicate slot): not the page's to reject (data: URI, offline)");
  const op = (/** @type {number} */ volume) => `0,0,${volume},10000,0,0,100,100,0,500,10000,10000,0,0`;
  const settings = ` 1,1,30,40,64,0,2,0,0,1,${op(4000)},0,0,1,${op(5000)}`;
  const { context, page, logged } = await open({ offline: true });
  await page.goto(dataUrl(htmlOf(c, settings + c.d.slice(c.d.indexOf(MIDI_OPEN)))));
  await ready(page);
  check(!(await state(page)).disabled && (await logged()).length === 0, "▶ enabled, no error");
  await startPlayback(page);
  check((await state(page)).synth?.state === "running", "▶ plays");
  await context.close();
}

/**
 * The fixtures with fields at their extremes play without an error. Every custom timbre gets notes
 * 0 and 127 (a drum timbre, its own note), where key scaling and the frequency products are
 * largest, then a plain note follows on another channel. The engine skips a note whose computed
 * values overflow float32, before making any node (fork T5.2), so at type extremes notes can be
 * silent; nothing may error, and the plain note after them must sound: the song goes on. The
 * custom-wave and filter fixtures use values that play, so every one of their notes must sound. Only
 * playing the notes shows any of this: the page parses and enables ▶ either way.
 */
async function checkExtremes() {
  const settingsFixtures = JSON.parse(readFileSync(new URL("../tests/fixtures/settings.json", import.meta.url), "utf8"));
  /** The fixtures at type extremes, whose notes the engine may skip. */
  const mayskip = ["max_fields", "min_fields", "max_chain"];
  /** @type {Array<[string, any]>} */
  const cases = [...mayskip, "custom_waves", "reference_waves", "waves_256", "filters", "filter_extremes"]
    .map((name) => [name, settingsFixtures.valid.find((/** @type {any} */ f) => f.name === name).settings]);
  cases.push(["long_lfsr", longLfsr()]);
  for (const [name, settings] of cases) {
    const c = { settings, svg: CASES.max_fields.svg };
    /** @type {number[][]} */
    const ev = [[0, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20]];
    /** @type {Array<[number, number]>} the note-ons to expect: [status, note] */
    const notes = [];
    for (const t of c.settings.timbres) {
      if (t.drum) {
        ev.push([0, 0x99, t.slot, 127], [48, 0x89, t.slot, 0]);
        notes.push([0x99, t.slot]);
      } else {
        ev.push([0, 0xc0, t.slot], [0, 0x90, 0, 127], [0, 0x90, 127, 127], [48, 0x80, 0, 0], [0, 0x80, 127, 0]);
        notes.push([0x90, 0], [0x90, 127]);
      }
    }
    // Then a plain note on channel 2: a program with no custom timbre, its GM default, at note 60.
    const plain = /** @type {number} */ (Array.from({ length: 128 }, (_, i) => i).find((p) => !c.settings.timbres.some((/** @type {any} */ t) => !t.drum && t.slot === p)));
    ev.push([0, 0xc1, plain], [0, 0x91, 60, 100], [48, 0x81, 60, 0], [48, 0xff, 0x2f, 0x00]);
    const midi = smf({ ppq: 96, tracks: [ev] });
    console.log(`extreme values (${name}): notes 0 and 127 on every custom timbre, then a plain note (data: URI, offline)`);
    const { context, page, logged } = await open({ offline: true });
    await page.goto(dataUrl(PAGE + dFragment(midi, c.settings).d + c.svg));
    await ready(page);
    await startPlayback(page);
    await page.waitForTimeout(1250 + 250 * c.settings.timbres.length); // each timbre's notes last 0.25 s
    const st = await state(page);
    const { sends, voiced } = await page.evaluate(() => ({ sends: /** @type {any} */ (window).__check.sends, voiced: /** @type {any} */ (window).__check.notes }));
    const played = notes.every(([status, note]) => sends.some((/** @type {number[]} */ m) => m[0] === status && m[1] === note && m[2] > 0));
    check(st.synth?.state === "running" && played, `▶ sends every note (${notes.map(([s, n]) => (s === 0x99 ? "drum " : "") + n).join(", ")})`);
    /** @type {Array<[number, number, number]>} [channel, note, sources made] of each note the engine voiced or skipped */
    const extreme = voiced.filter((/** @type {number[]} */ v) => v[0] !== 1);
    const skipped = extreme.filter((/** @type {number[]} */ v) => v[2] === 0).length;
    if (mayskip.includes(name)) console.log(`    ${skipped} of ${extreme.length} notes skipped by the engine (computed values past float32)`);
    else check(extreme.length > 0 && skipped === 0, `every note sounds (${extreme.length - skipped} of ${extreme.length})`);
    check(voiced.some((/** @type {number[]} */ v) => v[0] === 1 && v[1] === 60 && v[2] > 0), `the plain note after them sounds (program ${plain}): the song goes on`);
    const errors = await logged();
    check(errors.length === 0, `no errors, including non-finite AudioParam values${errors.length ? `: ${errors.length}, ${[...new Set(errors)].join(" | ")}` : ""}`);
    await context.close();
  }
}

try {
  await checkDataPage();
  await checkArtwork();
  await checkPlayAnchor();
  await checkBackgroundAudio();
  await checkIframe();
  await checkCsp();
  await checkCspControl();
  await checkFile();
  await checkEmbeds();
  await checkTouch();
  await checkFailures();
  await checkEngineFailures();
  await checkAudioFailures();
  await checkRangeOnly();
  await checkExtremes();
} catch (e) {
  failures++;
  console.log(`  FAIL ${/** @type {Error} */ (e).stack || e}`);
} finally {
  await browser.close();
}
if (shotDir) writeFileSync(join(shotDir, "page_check_result.txt"), failures ? `${failures} failure(s)\n` : "all passed\n");
console.log(failures ? `${failures} check(s) failed` : "all checks passed");
process.exit(failures ? 1 : 0);
