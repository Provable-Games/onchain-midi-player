#!/usr/bin/env node
// Three offline full-size NFT startup/gesture-to-engine-play samples; optional HTML/URI baseline input.
import { readFileSync } from "node:fs";
import { openBrowser, dataUrl } from "./browser_harness.mjs";
import { pageFromInput } from "./verify_engine.mjs";
import { animationHtml } from "../examples/beast_consumer/scripts/reference.mjs";
const html = process.argv[2] ? pageFromInput(readFileSync(process.argv[2])) : animationHtml(4);
const run = await openBrowser(), measurements = [];
try {
  for (let n = 0; n < 3; n++) {
    const sample = await run.page();
    try {
      await sample.page.goto(dataUrl(html));
      await sample.page.waitForFunction(() => window.__check.uiReadyAt !== null);
      await sample.page.click("#play");
      await sample.page.waitForFunction(() => window.__check.engineStartedAt);
      measurements.push(await sample.page.evaluate(() => ({
        startup_ms: window.__check.uiReadyAt - window.__check.startedAt,
        first_play_ms: window.__check.engineStartedAt - window.__check.gestureAt,
      })));
      await sample.page.click("#play");
      if (sample.requests.length || (await sample.errors()).length) throw new Error("unexpected browser errors or network requests");
    } finally { await sample.context.close(); }
  }
  console.log(JSON.stringify({engine:run.engine,measurements},null,2));
} finally { await run.browser.close(); }
