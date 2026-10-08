// @ts-check
// The browser engine the headless checks run on (scripts/page_check.mjs, scripts/render_check.mjs
// and examples/beast_consumer/scripts/browser_check.mjs), chosen with PLAYWRIGHT_BROWSER:
//
//   PLAYWRIGHT_BROWSER=chromium|firefox|webkit   (default chromium)
//   PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core   (required)
//   CHROME=/path/to/chrome-headless-shell   (optional, Chromium only: instead of Playwright's own)
//
// Not BROWSER, which many shells set to a command for opening URLs.

import { createRequire } from "node:module";

/** The engines the checks support, as Playwright names them. */
export const ENGINES = /** @type {const} */ (["chromium", "firefox", "webkit"]);

/**
 * The engine named by PLAYWRIGHT_BROWSER (chromium when unset or empty).
 * @param {Record<string, string | undefined>} [env]
 * @returns {"chromium" | "firefox" | "webkit"}
 */
export function engineFromEnv(env = process.env) {
  const name = env.PLAYWRIGHT_BROWSER || "chromium";
  const engine = ENGINES.find((e) => e === name);
  if (!engine) throw new Error(`PLAYWRIGHT_BROWSER must be one of ${ENGINES.join(", ")} (got ${JSON.stringify(name)})`);
  return engine;
}

/**
 * Loads Playwright from PLAYWRIGHT_CORE and launches the engine named by PLAYWRIGHT_BROWSER. Exits
 * with status 2 when PLAYWRIGHT_CORE is not set or PLAYWRIGHT_BROWSER is not a supported engine.
 * @param {Record<string, unknown>} [options] extra launch options
 * @returns {Promise<{browser: any, engine: "chromium" | "firefox" | "webkit"}>}
 */
export async function launchBrowser(options = {}) {
  const { PLAYWRIGHT_CORE, CHROME } = process.env;
  if (!PLAYWRIGHT_CORE) {
    console.error(`set PLAYWRIGHT_CORE to a playwright-core directory (and PLAYWRIGHT_BROWSER to one of ${ENGINES.join(", ")})`);
    process.exit(2);
  }
  /** @type {"chromium" | "firefox" | "webkit"} */
  let engine;
  try {
    engine = engineFromEnv();
  } catch (e) {
    console.error(/** @type {Error} */ (e).message);
    process.exit(2);
  }
  const playwright = createRequire(import.meta.url)(PLAYWRIGHT_CORE);
  const executablePath = engine === "chromium" && CHROME ? CHROME : engine === "webkit" ? process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE : undefined;
  // Firefox fetches /favicon.ico for every http(s) top-level document, on its own (the tab icon, not
  // the page), which the checks' CSP and network blocking would report as the page's. The page never
  // asks for it, and a data: page never triggers it. Headless has no tab strip: turn tab icons off.
  const firefoxUserPrefs = engine === "firefox" ? { "browser.chrome.site_icons": false } : undefined;
  const browser = await playwright[engine].launch({ executablePath, firefoxUserPrefs, env: process.env, ...options });
  console.log(`${engine} ${browser.version()}`);
  return { browser, engine };
}

/**
 * Collects what a page (and its frames) logs as errors with console.error, and the errors it throws
 * uncaught, as text, in order. Playwright's text for an Error argument is "Error: <message>" plus a
 * stack on Chromium, "Error: <message>" on WebKit, but only "Error" on Firefox, so each argument is
 * also described in the page ("<name>: <message>" for an Error) and that text replaces the message.
 * @param {any} page
 * @returns {() => Promise<string[]>} resolves to the errors so far, once every description is in
 */
export function collectErrors(page) {
  /** @type {string[]} */
  const errors = [];
  /** @type {Promise<void>[]} */
  const pending = [];
  page.on("console", (/** @type {any} */ m) => {
    if (m.type() !== "error") return;
    const i = errors.push(m.text()) - 1;
    const describe = (/** @type {any} */ h) => h.evaluate((/** @type {unknown} */ v) => (v instanceof Error ? `${v.name}: ${v.message}` : String(v)));
    // A message the browser logs itself (a blocked load, say) has no arguments: its text stays.
    pending.push(Promise.all(m.args().map(describe)).then((parts) => {
      if (parts.length) errors[i] = parts.join(" ");
    }, () => {}));
  });
  page.on("pageerror", (/** @type {any} */ e) => errors.push(String(e)));
  return async () => {
    await Promise.all(pending);
    return errors.slice();
  };
}

/**
 * Every resource request the page's renderer makes, data: URLs included, where the engine can
 * show them: Chromium's DevTools protocol. Playwright's request events, route() and Resource
 * Timing skip data: URLs on every engine, and Firefox and WebKit have no such protocol in
 * Playwright, so there this returns null (page_check.mjs proves the gzip tag's data: URI is never
 * fetched on every engine with a CSP instead).
 * @param {any} context
 * @param {any} page
 * @returns {Promise<string[] | null>} a live list of request URLs, or null
 */
export async function dataRequestLog(context, page) {
  if (engineFromEnv() !== "chromium") return null;
  /** @type {string[]} */
  const requests = [];
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  cdp.on("Network.requestWillBeSent", (/** @type {any} */ e) => requests.push(e.request.url));
  return requests;
}
