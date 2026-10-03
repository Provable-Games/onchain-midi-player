// @ts-check
// Node tests for scripts/fixture_pages.mjs: the browser checks load each page fixture's token_uri
// only when it matches the digests the class's output is pinned to. No browser needed.

import assert from "node:assert/strict";
import { test } from "node:test";
import { FIXTURES, fixtureCase, tokenPage } from "./fixture_pages.mjs";
import { HTML_PREFIX, b64, pageHtml } from "./page.mjs";

test("tokenPage: every valid case decodes to PAGE ++ D ++ SVG, as its animation_url", () => {
  const page = pageHtml();
  for (const c of FIXTURES.valid) {
    const { uri, url, html } = tokenPage(c, page);
    assert.equal(uri.length, c.token_uri.len);
    assert.equal(html, page + c.d + c.svg, c.name);
    assert.equal(url, HTML_PREFIX + b64(html), c.name);
  }
});

test("tokenPage: a token_uri that differs from the class's is refused", () => {
  const c = fixtureCase("default_120bpm");
  assert.throws(() => tokenPage({ ...c, d: c.d.replace("1,1,30", "1,1,31") }), /default_120bpm: token_uri .* is not the class's/);
  assert.throws(() => tokenPage({ ...c, members: c.members + " " }), /is not the class's/);
  // A PAGE one byte off (same length, so still 9-aligned).
  const page = pageHtml();
  const i = page.indexOf("aria-label");
  assert.ok(i > 0);
  assert.throws(() => tokenPage(c, page.slice(0, i) + "A" + page.slice(i + 1)), /is not the class's/);
});

test("fixtureCase: by name; an unknown name is an error", () => {
  assert.equal(fixtureCase("beast_140bpm").midi_max_tick, 384);
  assert.throws(() => fixtureCase("nope"), /no page fixture case nope/);
});
