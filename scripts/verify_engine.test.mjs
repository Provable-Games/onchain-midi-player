// @ts-check
// Node tests for scripts/verify_engine.mjs, the collector's engine check (README: "Verifying the
// engine"): on every form of input it reproduces the hashes the class carries in src/page_data.cairo.

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { ENGINE_PIN } from "./engine.mjs";
import { pageHtml, withGzipPayload } from "./page.mjs";
import { normalizeSha256, pageFromInput, verifyEngine } from "./verify_engine.mjs";

const SCRIPT = fileURLToPath(new URL("./verify_engine.mjs", import.meta.url));
const path = (/** @type {string} */ p) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const read = (/** @type {string} */ p) => readFileSync(path(p));

/** The constants of src/page_data.cairo that the check reproduces. */
function pageData() {
  const src = read("src/page_data.cairo").toString("utf8");
  const constant = (/** @type {string} */ name) => {
    const m = src.match(new RegExp(`pub const ${name}: \\w+ = ([^;]+);`));
    if (!m) throw new Error(`no ${name} in src/page_data.cairo`);
    return m[1];
  };
  return {
    engine: { sha256: constant("ENGINE_SHA256").replace(/^0x/, ""), length: read(`tests/vendor/webaudio-tinysynth-${ENGINE_PIN.ref}.min.js`).length },
    gzip: { sha256: constant("GZIP_SHA256").replace(/^0x/, ""), length: Number(constant("GZIP_LEN")) },
    page: { sha256: JSON.parse(read("scripts/page_versions.json").toString("utf8"))[constant("VERSION").slice(1, -1)], length: Number(constant("PAGE_LEN")) },
  };
}

const EXAMPLE = "examples/beast_consumer/fixtures";
const inputs = [
  ["the class's fixed page (tests/fixtures/page.html)", "tests/fixtures/page.html"],
  ["a token_uri (the example's token 1)", `${EXAMPLE}/token_uri.txt`],
  ["the token JSON, decoded", `${EXAMPLE}/token.json`],
  ["the animation_url page, decoded", `${EXAMPLE}/animation.html`],
];

for (const [label, file] of inputs) {
  test(`reproduces page_data's hashes from ${label}`, () => {
    const expected = pageData();
    assert.equal(expected.engine.sha256, ENGINE_PIN.sha256);
    assert.deepEqual(verifyEngine(pageFromInput(read(file))), expected);
  });
}

test("reproduces them from the bare animation_url data URI", () => {
  const url = JSON.parse(read(`${EXAMPLE}/token.json`).toString("utf8")).animation_url;
  assert.deepEqual(verifyEngine(pageFromInput(Buffer.from(url + "\n"))), pageData());
});

test("the CLI prints the hashes and checks --expect", () => {
  const { engine, gzip, page } = pageData();
  const out = execFileSync(process.execPath, [SCRIPT, path(`${EXAMPLE}/token_uri.txt`), "--expect", `0x${engine.sha256.toUpperCase()}`], { encoding: "utf8" });
  assert.equal(out, [
    `gzip payload  sha256 ${gzip.sha256}  ${gzip.length} bytes`,
    `engine        sha256 ${engine.sha256}  ${engine.length} bytes`,
    `fixed page    sha256 ${page.sha256}  ${page.length} bytes`,
    "the engine's SHA-256 matches",
    "",
  ].join("\n"));
  const stdin = spawnSync(process.execPath, [SCRIPT, "-", "--expect", gzip.sha256], { input: read(`${EXAMPLE}/token_uri.txt`), encoding: "utf8" });
  assert.equal(stdin.status, 1, "a wrong --expect fails");
  assert.match(stdin.stderr, /^MISMATCH/);
  assert.equal(spawnSync(process.execPath, [SCRIPT], { encoding: "utf8" }).status, 2, "usage");
});

test("a corrupt, missing or doubled gzip payload fails", () => {
  const page = pageHtml();
  const flipped = withGzipPayload(page, (p) => {
    const b = Buffer.from(p, "base64");
    b[b.length >> 1] ^= 0x55;
    return b.toString("base64");
  });
  assert.throws(() => verifyEngine(flipped), { code: "Z_DATA_ERROR" });
  assert.throws(() => verifyEngine(withGzipPayload(page, (p) => p.slice(0, -8))), { code: "Z_BUF_ERROR" });
  assert.throws(() => verifyEngine(withGzipPayload(page, (p) => p.replace("A", "-"))), /not canonical standard base64/);
  assert.throws(() => verifyEngine(withGzipPayload(page, () => null)), /found 0/);
  const tag = page.slice(page.indexOf("<script type=\"text/javascript+gzip\""), page.indexOf("</script>") + 9);
  assert.throws(() => verifyEngine(tag + page), /found 2/);
});

test("normalizeSha256 accepts a u256 printed as hex", () => {
  assert.equal(normalizeSha256("0xABC"), "0".repeat(61) + "abc");
  assert.equal(normalizeSha256(ENGINE_PIN.sha256), ENGINE_PIN.sha256);
  assert.throws(() => normalizeSha256("12g"), /not a SHA-256/);
  assert.throws(() => normalizeSha256("1".repeat(65)), /not a SHA-256/);
});
