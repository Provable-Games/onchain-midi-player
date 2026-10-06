#!/usr/bin/env node
// @ts-check
// Headless browser check of how a host page can embed the class's output (a token's animation_url)
// on Chromium, Firefox or WebKit: the page inside a sandboxed iframe of a host that has a strict
// Content-Security-Policy. scripts/page_check.mjs loads the page top-level from a data: URI, from
// file://, in <iframe sandbox="allow-scripts"> (src and srcdoc) and under a CSP of its own; this
// adds the host's side. The page is the min_fields golden case's: its token_uri is checked against
// the length and SHA-256 that snforge pins the class's output to (scripts/fixture_pages.mjs) and
// decoded as a marketplace decodes it.
//
// Where the page should run, it checks that the art is drawn (a pixel of the card in a screenshot,
// before ▶ and after), that ▶ is enabled, that a click starts audio (the AudioContext running,
// notes scheduled) and ❚❚ pauses it (suspends the AudioContext), that the silent media element of the media session plays with ▶
// and pauses with ❚❚ and a hidden page keeps playing, and that nothing is requested over the network,
// nothing is logged as an error and no CSP violation is reported. The hosts:
//
//   plain            no CSP: <iframe sandbox="allow-scripts"> with src="data:..." and with srcdoc
//   strict CSP       default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline';
//                    img-src data:; media-src blob:, plus frame-src data: for the data: frame (a
//                    srcdoc frame needs no frame-src), with both frames. That is all the page
//                    needs: a data: or srcdoc frame inherits the host's policy, which has to let
//                    the page's own inline script and style and its data: art through, and the
//                    silent blob: media element that gives the page media controls
//
// Where the host's CSP blocks blob: media (media-src 'none', or default-src 'none' with no
// media-src), the page still plays: the AudioContext runs, ▶ and ❚❚ work, nothing is thrown, and the
// fallback engages: a hidden page stops, as it has no media session to keep it playing. The browser
// reports the blocked media (a CSP violation for the blob: URL, and its own console message); that
// report is expected and is the only one accepted.
//
// Where the host withholds what the page needs, the page cannot run and the check records what the
// host shows instead; the art is drawn by the page's script, so none of these draw it. It checks
// that nothing is played, nothing is requested over the network, and the browser reports the
// violation where there is one:
//
//   no frame-src     the strict CSP without frame-src data: the host itself blocks the data: frame
//   no inline script the strict CSP without 'unsafe-inline' for scripts, inherited by the frame
//   no scripts       <iframe sandbox> without allow-scripts
//
// The output ends with one line per host and frame: whether the page plays or degrades, and how.
//
// Playwright is not a dependency of this repository; point the script at an existing install, and
// pick the engine (scripts/browsers.mjs; Firefox plays audio only with an output device, which a
// PulseAudio null sink provides on a machine without one: see docs/development.md, "Browser validation"):
//
//   PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core \
//   PLAYWRIGHT_BROWSER=chromium|firefox|webkit \
//   [CHROME=/path/to/chrome-headless-shell] [LD_LIBRARY_PATH=...] \
//   node scripts/hosting_check.mjs [screenshot_dir]
//
// Exits 0 when every check passes, 1 when one fails, 2 when PLAYWRIGHT_CORE is not set or
// PLAYWRIGHT_BROWSER names no supported engine.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { collectErrors, launchBrowser } from "./browsers.mjs";
import { fixtureCase, tokenPage } from "./fixture_pages.mjs";
import { decodePng } from "./png.mjs";

const shotDir = process.argv[2];

const c = fixtureCase("min_fields");
const { url: animationUrl, html } = tokenPage(c);
const HOST = "http://host.test/embed.html";
/** The card of the art: #1e1e22 on the page's black background (the art's first <rect>). */
const CARD = [0x1e, 0x1e, 0x22];
const FRAME = { width: 300, height: 400 };
/** What the page needs from a host's CSP, and no more. */
const NO_MEDIA = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:";
const STRICT = `${NO_MEDIA}; media-src blob:`;

/**
 * @typedef {{label: string, csp?: string, sandbox: string, frame: "src" | "srcdoc", plays: boolean, why?: string, blobBlocked?: boolean}} Setup
 * @type {Setup[]}
 */
const SETUPS = [
  { label: "no CSP, sandbox allow-scripts, src=data:", sandbox: "allow-scripts", frame: "src", plays: true },
  { label: "no CSP, sandbox allow-scripts, srcdoc", sandbox: "allow-scripts", frame: "srcdoc", plays: true },
  { label: "strict CSP, sandbox allow-scripts, src=data:", csp: `${STRICT}; frame-src data:`, sandbox: "allow-scripts", frame: "src", plays: true },
  { label: "strict CSP, sandbox allow-scripts, srcdoc", csp: STRICT, sandbox: "allow-scripts", frame: "srcdoc", plays: true },
  { label: "CSP with media-src 'none', sandbox allow-scripts, src=data:", csp: `${NO_MEDIA}; media-src 'none'; frame-src data:`, sandbox: "allow-scripts", frame: "src", plays: true, blobBlocked: true },
  { label: "CSP with default-src 'none' and no media-src, sandbox allow-scripts, src=data:", csp: `${NO_MEDIA}; frame-src data:`, sandbox: "allow-scripts", frame: "src", plays: true, blobBlocked: true },
  { label: "CSP with default-src 'none' and no media-src, sandbox allow-scripts, srcdoc", csp: NO_MEDIA, sandbox: "allow-scripts", frame: "srcdoc", plays: true, blobBlocked: true },
  { label: "strict CSP without frame-src data:, src=data:", csp: STRICT, sandbox: "allow-scripts", frame: "src", plays: false, why: "the host's CSP blocks the frame" },
  { label: "CSP without inline scripts, src=data:", csp: "default-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-src data:", sandbox: "allow-scripts", frame: "src", plays: false, why: "the frame inherits the host's CSP" },
  { label: "sandbox without allow-scripts, src=data:", sandbox: "", frame: "src", plays: false, why: "no scripts" },
];

let failures = 0;
/** @param {boolean} cond @param {string} msg */
function check(cond, msg) {
  console.log(`  ${cond ? "ok  " : "FAIL"} ${msg}`);
  if (!cond) failures++;
}
const info = (/** @type {string} */ msg) => console.log(`  info ${msg}`);

/**
 * Runs in every frame before the page's scripts: records CSP violations, and wraps the engine
 * constructor (which the engine assigns to window.WebAudioTinySynth) to record the synth and what
 * it schedules.
 */
function instrument() {
  /** @type {any} */
  const st = { constructed: 0, sends: 0, violations: [], synth: null, media: null };
  /** @type {any} */ (window).__check = st;
  const mediaPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    st.media = this;
    return mediaPlay.call(this);
  };
  /** @type {any} */
  let Real;
  function Wrapped(/** @type {any} */ opts) {
    st.constructed++;
    const synth = new Real(opts);
    st.synth = synth;
    const send = synth.send;
    synth.send = (/** @type {number[]} */ m, /** @type {number} */ t) => {
      if (t !== undefined) st.sends++;
      return send(m, t);
    };
    return synth;
  }
  Object.defineProperty(window, "WebAudioTinySynth", { configurable: true, get: () => Real && Wrapped, set: (v) => { Real = v; } });
  document.addEventListener("securitypolicyviolation", (e) => st.violations.push(e.violatedDirective + " " + e.blockedURI));
}

/** @param {any} frame */
const state = (frame) => frame.evaluate(() => {
  const st = /** @type {any} */ (window).__check;
  const b = /** @type {HTMLButtonElement} */ (document.getElementById("play"));
  const img = document.querySelector("img");
  const synth = st.synth;
  return {
    disabled: b.disabled, label: b.getAttribute("aria-label"), constructed: st.constructed, sends: st.sends, violations: st.violations,
    origin: window.origin, error: document.getElementById("error")?.hidden === false,
    img: img && { src: img.src.slice(0, 40), complete: img.complete, w: img.naturalWidth },
    synth: synth && { playing: synth.playing, state: synth.getAudioContext().state },
    mediaPaused: st.media ? st.media.paused : null,
  };
});

/**
 * The frame's state, or null where the engine cannot evaluate in it (a frame without scripts, or
 * one the host blocked: WebKit's evaluate never settles there, so give up after a second).
 */
const peek = (/** @type {any} */ frame) => Promise.race([state(frame).catch(() => null), new Promise((resolve) => setTimeout(resolve, 1000, null))]);

/** Whether the centre of the iframe is the art's card, from a screenshot of the host. @param {any} page */
async function artShown(page) {
  const box = await page.locator("iframe").boundingBox();
  const png = decodePng(await page.screenshot());
  const [r, g, b] = png.pixel(Math.round(box.x + box.width / 2), Math.round(box.y + box.height / 2));
  return { shown: [r, g, b].every((v, i) => Math.abs(v - CARD[i]) <= 3), rgb: [r, g, b] };
}

const { browser, engine } = await launchBrowser();
check(!!animationUrl, `the ${c.name} case's token_uri is the class's output (length and SHA-256), decoded as a marketplace decodes it`);
/** @type {string[]} */
const summary = [];

/** @param {Setup} s */
async function run(s) {
  console.log(`host ${s.csp ? `with CSP ${s.csp}` : "without a CSP"}; <iframe sandbox="${s.sandbox}" ${s.frame === "src" ? 'src="data:..."' : 'srcdoc="..."'}> (${c.name})`);
  const attr = html.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  const body = `<!doctype html><title>host</title><iframe sandbox="${s.sandbox}" width="${FRAME.width}" height="${FRAME.height}" ${s.frame === "src" ? `src="${animationUrl}"` : `srcdoc="${attr}"`}></iframe>`;
  const context = await browser.newContext({ viewport: { width: FRAME.width + 20, height: FRAME.height + 20 } });
  await context.addInitScript(instrument);
  /** @type {string[]} */
  const blocked = [];
  await context.route("**/*", (/** @type {any} */ route) => {
    const url = route.request().url();
    if (url.startsWith("data:") || url.startsWith("blob:")) return route.continue(); // not network: the page's own blob: media
    if (url === HOST) return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", headers: s.csp ? { "Content-Security-Policy": s.csp } : {}, body });
    blocked.push(url);
    return route.abort();
  });
  const page = await context.newPage();
  const logged = collectErrors(page);
  await page.goto(HOST);
  const hostViolations = () => page.evaluate(() => /** @type {any} */ (window).__check.violations);
  const shot = async (/** @type {string} */ name) => { if (shotDir) await page.screenshot({ path: join(shotDir, `hosting_${engine}_${SETUPS.indexOf(s)}_${name}.png`) }); };
  let outcome;

  if (s.plays) {
    const frame = await (await page.waitForSelector("iframe")).contentFrame();
    await frame.waitForFunction(() => {
      const b = /** @type {HTMLButtonElement | null} */ (document.getElementById("play"));
      const e = document.getElementById("error");
      return b && (!b.disabled || (e && !e.hidden));
    });
    await frame.waitForFunction(() => document.querySelector("img")?.complete);
    let st = await state(frame);
    check(st.img.w === 250 && !st.disabled && !st.error, `▶ enabled, art loaded (${st.img.w}px wide), no error shown`);
    let art = await artShown(page);
    check(art.shown, `art drawn: the card's pixel in a screenshot is rgb(${art.rgb.join(", ")})`);
    await shot("before");
    check(st.constructed === 0 && st.origin === "null", `no synth before ▶; the frame has an opaque origin (${st.origin})`);
    const t0 = Date.now();
    await frame.click("#play");
    await frame.waitForFunction(() => {
      const st = /** @type {any} */ (window).__check;
      return st.synth && st.synth.playing && st.sends > 0;
    }, null, { timeout: 10000 }).catch(() => {}); // the checks that follow report a start that never came
    info(`▶ to playback: ${Date.now() - t0} ms`);
    st = await state(frame);
    check(st.constructed === 1 && st.synth?.state === "running" && st.synth.playing === 1 && st.sends > 0 && st.label === "Pause",
      `click ▶: AudioContext ${st.synth?.state}, ${st.sends} MIDI messages scheduled, ▶ became ❚❚`);
    /** Waits for the AudioContext to reach `want` (suspend() and resume() settle asynchronously). */
    const contextState = (/** @type {string} */ want) => frame.waitForFunction((/** @type {string} */ want) => /** @type {any} */ (window).__check.synth?.getAudioContext().state === want, want, { timeout: 10000 }).catch(() => {});
    await frame.waitForTimeout(500);
    art = await artShown(page);
    check(art.shown, `art still drawn while playing (rgb(${art.rgb.join(", ")}))`);
    await shot("playing");
    // The silent element plays, unless the host's CSP blocks its blob: URL (its play() rejects).
    if (!s.blobBlocked) check(st.mediaPaused === false, "the silent media element is playing");
    // The page hides (a locked screen, another tab): it keeps playing with its media session, and
    // pauses without one. document.hidden is overridden, as headless pages are always visible.
    const hide = (/** @type {boolean} */ hidden) => frame.evaluate((/** @type {boolean} */ hidden) => {
      if (hidden) Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      else delete (/** @type {any} */ (document)).hidden;
      document.dispatchEvent(new Event("visibilitychange"));
    }, hidden);
    await hide(true);
    if (s.blobBlocked) await contextState("suspended");
    st = await state(frame);
    if (s.blobBlocked) check(st.synth?.state === "suspended" && st.label === "Play", "hidden, no media session: the page paused");
    else check(st.synth?.playing === 1 && st.synth?.state === "running" && st.label === "Pause", "hidden, with its media session: the page keeps playing");
    await hide(false);
    if (!s.blobBlocked) {
      await frame.click("#play");
      await contextState("suspended");
      st = await state(frame);
      check(st.synth?.state === "suspended" && st.label === "Play" && st.mediaPaused === true, "click ❚❚: paused, the silent media element paused");
    }
    // ▶ resumes after a pause by hiding, then ❚❚.
    if (s.blobBlocked) {
      const sends = st.sends;
      await frame.click("#play");
      await contextState("running");
      await frame.waitForFunction((/** @type {number} */ n) => /** @type {any} */ (window).__check.sends > n, sends + 1, { timeout: 10000 }).catch(() => {});
      st = await state(frame);
      check(st.synth?.state === "running" && st.label === "Pause" && st.sends > sends, `▶ resumes: playing again (AudioContext ${st.synth?.state}, ${st.label} shown, ${st.sends - sends} messages scheduled since)`);
      await frame.click("#play");
      await contextState("suspended");
      st = await state(frame);
      check(st.synth?.state === "suspended" && st.label === "Play", "click ❚❚: paused");
    }
    const violations = [...(await hostViolations()), ...st.violations];
    if (!s.blobBlocked) check(violations.length === 0, `no CSP violations${violations.length ? ": " + violations.join(" | ") : ""}`);
    else {
      // The one report accepted: the blocked blob: media (media-src, or default-src it falls back to).
      const other = violations.filter((v) => !/^(media-src|default-src)\S* blob/.test(v));
      check(other.length === 0, `the only CSP report is for the blocked blob: media (${[...new Set(violations)].join(" | ") || "none reported"})`);
    }
    outcome = s.blobBlocked
      ? "plays; the host's CSP blocks the blob: media element: no media session, and a hidden page pauses (reported: the blocked media)"
      : "plays: art drawn, ▶ starts audio (and the silent media element), ❚❚ pauses it, a hidden page keeps playing";
  } else {
    await page.waitForTimeout(1500); // the frame has loaded or been blocked by now
    const frame = page.frames().find((f) => f !== page.mainFrame());
    const st = frame ? await peek(frame) : null;
    const art = await artShown(page);
    await shot("degraded");
    check(!art.shown, `the art is not drawn: the frame's centre is rgb(${art.rgb.join(", ")})`);
    check(!st || (st.constructed === 0 && !st.synth), "nothing plays: no synth constructed");
    const violations = [...(await hostViolations()), ...(st?.violations || [])];
    if (s.csp) check(violations.length > 0, `the browser reports the violation: ${violations.join(" | ") || "none"}`);
    outcome = `degrades (${s.why}): ${st ? `▶ ${st.disabled ? "disabled" : "enabled"}` : "frame not scriptable"}, art not drawn${violations.length ? `, reported: ${[...new Set(violations)].join(" | ")}` : ""}`;
  }
  const errors = await logged();
  if (s.plays) {
    // Where blob: media is blocked, the browser itself logs the CSP violation: that message, and only
    // it, is accepted (nothing the page throws or logs).
    const expected = (/** @type {string} */ e) => s.blobBlocked && /blob:/.test(e) && /content security policy|violat|refused/i.test(e);
    const other = errors.filter((e) => !expected(e));
    if (errors.length > other.length) info(`console, the blocked media: ${errors.filter(expected).map((e) => e.slice(0, 140)).join(" | ")}`);
    check(other.length === 0, `no console errors${other.length ? ": " + other.join(" | ") : ""}`);
  }
  else info(`console: ${errors.length ? errors.map((e) => e.slice(0, 120)).join(" | ") : "no errors"}`);
  check(blocked.length === 0, `no network requests beyond the host page${blocked.length ? ": " + blocked.join(" ") : ""}`);
  summary.push(`${outcome} -- ${s.label}`);
  await context.close();
}

try {
  for (const s of SETUPS) await run(s);
} catch (e) {
  failures++;
  console.log(`  FAIL ${/** @type {Error} */ (e).stack || e}`);
} finally {
  await browser.close();
}
console.log(`${engine}:`);
for (const line of summary) console.log(`  ${line}`);
if (shotDir) writeFileSync(join(shotDir, "hosting_check_result.txt"), (failures ? `${failures} failure(s)\n` : "all passed\n") + summary.join("\n") + "\n");
console.log(failures ? `${failures} check(s) failed` : "all checks passed");
process.exit(failures ? 1 : 0);
