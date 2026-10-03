// @ts-check
// Node tests for scripts/browsers.mjs, which picks the engine for the headless checks
// (PLAYWRIGHT_BROWSER) and collects page errors the same way on every engine. No browser needed.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { ENGINES, collectErrors, engineFromEnv } from "./browsers.mjs";

const MODULE = fileURLToPath(new URL("./browsers.mjs", import.meta.url));

test("engineFromEnv: chromium by default, each supported engine by name", () => {
  assert.deepEqual(ENGINES, ["chromium", "firefox", "webkit"]);
  assert.equal(engineFromEnv({}), "chromium");
  assert.equal(engineFromEnv({ PLAYWRIGHT_BROWSER: "" }), "chromium");
  for (const e of ENGINES) assert.equal(engineFromEnv({ PLAYWRIGHT_BROWSER: e }), e);
});

test("engineFromEnv: anything else is an error naming the accepted values", () => {
  for (const bad of ["Chromium", "chrome", "safari", "/usr/bin/firefox", " webkit"]) {
    assert.throws(() => engineFromEnv({ PLAYWRIGHT_BROWSER: bad }),
      { message: `PLAYWRIGHT_BROWSER must be one of chromium, firefox, webkit (got ${JSON.stringify(bad)})` });
  }
});

test("launchBrowser exits 2 without PLAYWRIGHT_CORE, or with an unsupported PLAYWRIGHT_BROWSER", () => {
  const run = (/** @type {Record<string, string>} */ env) => spawnSync(process.execPath,
    ["--input-type=module", "-e", `import { launchBrowser } from ${JSON.stringify(MODULE)}; await launchBrowser();`],
    { env: { PATH: process.env.PATH || "", ...env }, encoding: "utf8" });
  let r = run({});
  assert.equal(r.status, 2);
  assert.match(r.stderr, /set PLAYWRIGHT_CORE to a playwright-core directory/);
  // Checked before Playwright is loaded: the directory need not exist.
  r = run({ PLAYWRIGHT_CORE: "/nonexistent/playwright-core", PLAYWRIGHT_BROWSER: "safari" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /PLAYWRIGHT_BROWSER must be one of chromium, firefox, webkit \(got "safari"\)/);
});

/** A stand-in for a Playwright page: records handlers; emit() calls them. */
function fakePage() {
  /** @type {Record<string, Array<(x: any) => void>>} */
  const handlers = {};
  return {
    on: (/** @type {string} */ event, /** @type {(x: any) => void} */ fn) => { (handlers[event] ||= []).push(fn); },
    emit: (/** @type {string} */ event, /** @type {any} */ x) => { for (const fn of handlers[event] || []) fn(x); },
  };
}

/**
 * A console message as Playwright reports it: `text` is the engine's own text; each argument is a
 * handle that evaluates a function on its value, in the page.
 * @param {string} type @param {string} text @param {unknown[]} values
 */
const message = (type, text, values) => ({
  type: () => type,
  text: () => text,
  args: () => values.map((v) => ({ evaluate: async (/** @type {(v: unknown) => unknown} */ fn) => fn(v) })),
});

test("collectErrors: errors in order, each argument described in the page, other levels ignored", async () => {
  const page = fakePage();
  const logged = collectErrors(page);
  // Firefox's text for an Error argument is just "Error".
  page.emit("console", message("error", "Error", [new Error("settings: malformed: token 6")]));
  page.emit("console", message("log", "not an error", ["not an error"]));
  page.emit("console", message("warning", "a warning", ["a warning"]));
  page.emit("console", message("error", "JSHandle@object extra", [new TypeError("t"), "extra"]));
  page.emit("pageerror", new Error("thrown"));
  // A message the browser logs itself has no arguments: its text stays.
  page.emit("console", message("error", "Refused to load the script 'data:...'", []));
  assert.deepEqual(await logged(), [
    "Error: settings: malformed: token 6",
    "TypeError: t extra",
    "Error: thrown",
    "Refused to load the script 'data:...'",
  ]);
});

test("collectErrors: a handle that can no longer be evaluated keeps the engine's text", async () => {
  const page = fakePage();
  const logged = collectErrors(page);
  page.emit("console", {
    type: () => "error",
    text: () => "Error: gunzip: invalid gzip data",
    args: () => [{ evaluate: async () => { throw new Error("Target page, context or browser has been closed"); } }],
  });
  assert.deepEqual(await logged(), ["Error: gunzip: invalid gzip data"]);
});
