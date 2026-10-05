// @ts-check
// Node tests for scripts/page.mjs: the VERSION record (scripts/page_versions.json) that keeps
// version() tied to the page, and the notices in license().

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  PAGE_VERSION, PAGE_VERSIONS_PATH, VERSION, checkPageVersion, compareSemVer, encoderLicense, isSemVer, licenseText,
  pageHtml, sha256, shimLicense, versionRecord, versionRecordProblems,
} from "./page.mjs";
import { ENGINE_PIN } from "./engine.mjs";

/** @param {string} page_sha256 @param {number} [page] */
const rec = (page_sha256, page = 1) => ({
  page_sha256, engine_ref: "abc1234", engine_commit: "abc1234".padEnd(40, "0"), page,
  script_sha256: "c".repeat(64), gzip_sha256: "d".repeat(64), gzip_len: 100,
});

test("VERSION is SemVer and fits a short string", () => {
  assert.ok(isSemVer(VERSION), VERSION);
  for (const v of ["0.1.0", "1.0.0", "10.20.30", "1.0.0-rc.1", "1.0.0-alpha-2.x"]) assert.ok(isSemVer(v), v);
  for (const v of ["1.0.0-0", "1.0.0-rc.0", "1.0.0-0a", "1.0.0-00a", "1.0.0-x.7.z.92"]) assert.ok(isSemVer(v), v);
  for (const v of ["1.0", "01.0.0", "1.0.0+build", "v1.0.0", "1.0.0-", "1.0.0-a..b", "0.2.0-01", "0.2.0-rc.01", `1.0.0-${"a".repeat(26)}`]) {
    assert.ok(!isSemVer(v), v);
  }
});

test("compareSemVer orders by SemVer precedence", () => {
  const ordered = ["0.1.0", "0.2.0", "0.10.0", "1.0.0-alpha", "1.0.0-alpha.1", "1.0.0-alpha.beta", "1.0.0-beta.2", "1.0.0-beta.11", "1.0.0-rc.1", "1.0.0", "1.0.1"];
  for (let i = 1; i < ordered.length; i++) assert.ok(compareSemVer(ordered[i - 1], ordered[i]) < 0, `${ordered[i - 1]} < ${ordered[i]}`);
  assert.equal(compareSemVer("1.2.3", "1.2.3"), 0);
  // Exact beyond 2^53, where Number would round both to the same value.
  assert.ok(compareSemVer("0.2.0-9007199254740992", "0.2.0-9007199254740993") < 0);
  assert.ok(compareSemVer("9007199254740993.0.0", "9007199254740992.0.0") > 0);
  assert.ok(compareSemVer("0.9007199254740992.0", "0.9007199254740993.0") < 0);
});

test("the committed build is the one recorded for VERSION, and every record is well formed", () => {
  const versions = JSON.parse(readFileSync(PAGE_VERSIONS_PATH, "utf8"));
  const { page } = JSON.parse(readFileSync(new URL("../tests/fixtures/page.json", import.meta.url), "utf8"));
  assert.equal(page.version, VERSION);
  assert.deepEqual(versions[VERSION], versionRecord(sha256(pageHtml()), page.gzip_sha256, page.gzip_len));
  assert.deepEqual(versions[VERSION], {
    page_sha256: sha256(pageHtml()), engine_ref: ENGINE_PIN.ref, engine_commit: ENGINE_PIN.commit, page: PAGE_VERSION,
    script_sha256: page.engine_sha256, gzip_sha256: page.gzip_sha256, gzip_len: page.gzip_len,
  });
  assert.equal(page.engine_sha256, ENGINE_PIN.sha256);
  for (const [key, r] of Object.entries(versions)) assert.deepEqual(versionRecordProblems(key, r), [], key);
});

test("versionRecordProblems: short commits and tags as the engine ref, SemVer keys and hashes", () => {
  const commit = "abc1234".padEnd(40, "0");
  const record = (/** @type {string} */ engine_ref, engine_commit = commit) => ({ ...rec("a".repeat(64), 3), engine_ref, engine_commit });
  assert.deepEqual(versionRecordProblems("1.0.0", record("abc1234")), []);
  // A tagged release pin (vendor_engine.mjs keeps the tag as the ref): the commit need not start with it.
  assert.deepEqual(versionRecordProblems("1.0.0", record("v2.1.0")), []);
  assert.deepEqual(versionRecordProblems("1.0.0", record("def5678")), ["engine_ref"]);
  assert.deepEqual(versionRecordProblems("1.0.0", record("abc1234", "abc1234")), ["engine_commit"]);
  assert.deepEqual(versionRecordProblems("tinysynth-abc1234+page.3", record("abc1234")), ["key"]);
  assert.deepEqual(versionRecordProblems("1.0.0", { ...record("abc1234"), script_sha256: "C".repeat(64), gzip_len: 0 }), ["script_sha256", "gzip_len"]);
  const { gzip_len, ...missing } = record("abc1234");
  assert.deepEqual(versionRecordProblems("1.0.0", /** @type {any} */ (missing)), ["fields", "gzip_len"]);
});

test("checkPageVersion: a changed page or engine under a recorded VERSION fails, even with --record", () => {
  const versions = { "0.1.0": rec("aa") };
  assert.equal(checkPageVersion(versions, "0.1.0", rec("aa")), versions);
  assert.throws(() => checkPageVersion(versions, "0.1.0", rec("bb")), /PAGE or the engine changed .* bump VERSION/);
  assert.throws(() => checkPageVersion(versions, "0.1.0", rec("aa", 2), { record: true }), /PAGE or the engine changed/);
});

test("checkPageVersion: a new VERSION needs --record, must be SemVer and must come after every recorded version", () => {
  const versions = { "0.0.1": rec("aa"), "0.1.0": rec("aa") };
  assert.throws(() => checkPageVersion(versions, "0.2.0", rec("bb")), /not recorded/);
  assert.deepEqual(checkPageVersion(versions, "0.2.0", rec("bb"), { record: true }), { ...versions, "0.2.0": rec("bb") });
  // A class can change while its page does not, so a new version may name a recorded page.
  assert.deepEqual(checkPageVersion(versions, "0.2.0", rec("aa"), { record: true }), { ...versions, "0.2.0": rec("aa") });
  assert.throws(() => checkPageVersion(versions, "0.0.9", rec("bb"), { record: true }), /must come after the recorded 0\.1\.0/);
  assert.throws(() => checkPageVersion(versions, "0.1.0-rc.1", rec("bb"), { record: true }), /must come after/);
  assert.throws(() => checkPageVersion(versions, "tinysynth-def5678+page.2", rec("bb"), { record: true }), /not SemVer/);
  // Every field is compared: a new gzip payload under a recorded VERSION fails too.
  assert.throws(() => checkPageVersion(versions, "0.1.0", { ...rec("aa"), gzip_len: 101 }), /PAGE or the engine changed/);
});

test("license(): NOTICE first, then fflate's and game-components' MIT licenses", () => {
  const text = licenseText();
  const notice = readFileSync(new URL("../NOTICE", import.meta.url), "utf8").trimEnd();
  assert.ok(text.startsWith(`${notice}\n`), "license() starts with NOTICE");
  const shim = text.indexOf(shimLicense().trimEnd());
  const encoder = text.indexOf(encoderLicense().trimEnd());
  assert.ok(shim > 0 && encoder > shim, "fflate's license, then game-components'");
  // The encoder's notice is there because Scarb.toml compiles game_components_encoding into the class.
  const manifest = readFileSync(new URL("../Scarb.toml", import.meta.url), "utf8");
  assert.match(manifest, /^game_components_encoding = \{ git = "https:\/\/github\.com\/Provable-Games\/game-components", /m);
  assert.match(notice, /game_components_encoding/);
  assert.match(encoderLicense(), /^MIT License\n\nCopyright \(c\) 2026 Provable Games\n/);
});
