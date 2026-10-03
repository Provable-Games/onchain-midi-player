// @ts-check
// Node tests for scripts/page.mjs: the VERSION record that keeps version() tied to the page.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { PAGE_VERSIONS_PATH, VERSION, checkPageVersion, pageHtml, sha256 } from "./page.mjs";

test("the committed PAGE is the one recorded for VERSION", () => {
  const versions = JSON.parse(readFileSync(PAGE_VERSIONS_PATH, "utf8"));
  assert.equal(versions[VERSION], sha256(pageHtml()));
  assert.equal(new Set(Object.values(versions)).size, Object.keys(versions).length, "one VERSION per PAGE");
});

test("checkPageVersion: a changed page under a recorded VERSION fails, even with --record", () => {
  const versions = { "v+page.1": "aa" };
  assert.equal(checkPageVersion(versions, "v+page.1", "aa"), versions);
  assert.throws(() => checkPageVersion(versions, "v+page.1", "bb"), /PAGE changed .* bump PAGE_VERSION/);
  assert.throws(() => checkPageVersion(versions, "v+page.1", "bb", { record: true }), /PAGE changed/);
});

test("checkPageVersion: a new VERSION needs --record, and may not rename a recorded page", () => {
  const versions = { "v+page.1": "aa" };
  assert.throws(() => checkPageVersion(versions, "v+page.2", "bb"), /not recorded/);
  assert.deepEqual(checkPageVersion(versions, "v+page.2", "bb", { record: true }), { "v+page.1": "aa", "v+page.2": "bb" });
  assert.throws(() => checkPageVersion(versions, "v+page.2", "aa", { record: true }), /already recorded as v\+page\.1/);
});
