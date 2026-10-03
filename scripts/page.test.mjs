// @ts-check
// Node tests for scripts/page.mjs: the VERSION record that keeps version() tied to the page, and the
// row of README.md's Versions table that publishes it.

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

test("README.md's Versions table has a row for VERSION with the build's hashes", () => {
  const { page } = JSON.parse(readFileSync(new URL("../tests/fixtures/page.json", import.meta.url), "utf8"));
  assert.equal(page.version, VERSION);
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  const start = readme.indexOf("\n## Versions\n");
  assert.ok(start >= 0, "README.md has a Versions section");
  const section = readme.slice(start, readme.indexOf("\n## ", start + 1));
  const rows = section.split("\n").filter((line) => line.startsWith(`| \`${VERSION}\` |`));
  assert.equal(rows.length, 1, `one row for ${VERSION}: update README.md's Versions table`);
  const cells = rows[0].split("|").slice(1, -1).map((cell) => cell.trim());
  assert.equal(cells.length, 7);
  assert.equal(cells[4], `\`${page.engine_sha256}\``, "script_sha256()");
  assert.equal(cells[5], `\`${page.gzip_sha256}\` / ${page.gzip_len.toLocaleString("en-US")} bytes`, "gzip payload");
  assert.ok(cells[6].startsWith(`[\`${page.engine_commit.slice(0, 7)}\`](https://github.com/Provable-Games/webaudio-tinysynth/commit/${page.engine_commit})`), "engine fork commit");
});
