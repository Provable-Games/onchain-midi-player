// @ts-check
// Node tests for scripts/validate_token_uri.mjs (docs/verifying.md: "Validating a token_uri"): the
// example's golden token_uri passes, and each class of failure is reported by the check that owns it.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { ART_OPEN, HTML_PREFIX, JSON_PREFIX, SVG_PREFIX, b64, byteArrayFelts, withGzipPayload } from "./page.mjs";
import { RPC_CAP, base64Problem, fetchTokenUri, formatReport, keccak256, parseInput, parseXml, run, selector, validateTokenUri } from "./validate_token_uri.mjs";

const SCRIPT = fileURLToPath(new URL("./validate_token_uri.mjs", import.meta.url));
const GOLDEN = fileURLToPath(new URL("../examples/beast_consumer/fixtures/token_uri.txt", import.meta.url));
const golden = readFileSync(GOLDEN, "utf8").trim();
const goldenJson = () => JSON.parse(Buffer.from(golden.slice(JSON_PREFIX.length), "base64").toString("utf8"));
const goldenHtml = () => Buffer.from(goldenJson().animation_url.slice(HTML_PREFIX.length), "base64").toString("latin1");
const toUri = (/** @type {unknown} */ json) => JSON_PREFIX + b64(JSON.stringify(json));
const withHtml = (/** @type {string} */ html) => ({ ...goldenJson(), animation_url: HTML_PREFIX + Buffer.from(html, "latin1").toString("base64") });
const withImage = (/** @type {string} */ svg) => ({ ...goldenJson(), image: SVG_PREFIX + b64(svg) });

/** The ids of the checks at a level. */
const ids = (/** @type {ReturnType<typeof validateTokenUri>} */ r, /** @type {string} */ level) => r.checks.filter((c) => c.level === level).map((c) => c.id);
const check = (/** @type {{uri?: string}} */ input, opts = {}) => validateTokenUri(input, opts);

test("the example's golden token_uri passes: every layer and the engine record", () => {
  const r = check({ uri: golden });
  assert.deepEqual(ids(r, "fail"), []);
  // The example writes numeric traits as strings: a warning, not a failure.
  assert.deepEqual(ids(r, "warn"), ["json.attributes", "json.attributes"]);
  for (const id of ["token_uri.base64", "json.name", "image.self_contained", "player.engine_sha256", "player.gzip", "player.page_sha256_record", "player.settings", "player.midi", "player.art_block", "animation.self_contained", "size.rpc"]) {
    assert.ok(ids(r, "pass").includes(id), id);
  }
  const record = JSON.parse(readFileSync(new URL("./page_versions.json", import.meta.url), "utf8"))["0.3.0"];
  assert.equal(r.hashes.page_sha256, record.page_sha256);
  assert.equal(r.sizes.token_uri_bytes, golden.length);
  assert.ok(r.sizes.rpc_response_estimated < RPC_CAP);
  assert.match(formatReport(r.toJSON()), /PASS: \d+ passed, 2 warnings, 0 failed/);
});

test("raw call output gives the same report: a result array, a JSON-RPC response, sncast --json", () => {
  const felts = byteArrayFelts(golden);
  const same = JSON.stringify(check({ uri: golden }).toJSON().checks.map((c) => [c.level, c.id]));
  for (const text of [JSON.stringify(felts), JSON.stringify({ jsonrpc: "2.0", id: 1, result: felts }), JSON.stringify({ response: JSON.stringify(golden) })]) {
    const input = parseInput(Buffer.from(text));
    assert.equal(input.uri, golden);
    const checks = check(input).toJSON().checks.filter((c) => c.id !== "input.bytearray");
    assert.equal(JSON.stringify(checks.map((c) => [c.level, c.id])), same);
  }
  assert.throws(() => parseInput(Buffer.from(JSON.stringify(felts.slice(0, -1)))), /not one ByteArray/);
  assert.throws(() => parseInput(Buffer.from("hello")), /not a data URI/);
  assert.throws(() => parseInput(Buffer.from(JSON.stringify({ error: { code: 40, message: "Contract error" } }))), /call failed/);
});

test("the decoded token JSON is accepted without the token_uri layer", () => {
  const r = check({ json: JSON.stringify(goldenJson()) });
  assert.deepEqual(ids(r, "fail"), []);
  assert.ok(!r.checks.some((c) => c.id.startsWith("token_uri.")));
});

test("bad base64 is located by offset, at each layer", () => {
  assert.equal(base64Problem("QUJD"), null);
  assert.match(base64Problem("QU\nD") ?? "", /"\\n" at offset 2/);
  assert.match(base64Problem("QU=D") ?? "", /offset 2 is not at the end/);
  assert.match(base64Problem("QUJDR") ?? "", /not a multiple of 4/);
  assert.match(base64Problem("QUJ=") ?? "", /trailing bits/);
  const flip = (/** @type {string} */ s, /** @type {number} */ at) => s.slice(0, at) + "-" + s.slice(at + 1);
  let r = check({ uri: flip(golden, JSON_PREFIX.length + 100) });
  assert.ok(ids(r, "fail").includes("token_uri.base64"));
  assert.match(r.checks.find((c) => c.id === "token_uri.base64")?.message ?? "", /"-" at offset 100/);
  const json = goldenJson();
  r = check({ uri: toUri({ ...json, animation_url: flip(json.animation_url, HTML_PREFIX.length + 7) }) });
  assert.match(r.checks.find((c) => c.id === "animation.base64")?.message ?? "", /"-" at offset 7/);
  r = check({ uri: toUri({ ...json, image: flip(json.image, SVG_PREFIX.length + 3) }) });
  assert.ok(ids(r, "fail").includes("image.base64"));
});

test("the outer layers: prefix, ASCII, UTF-8, JSON, object", () => {
  assert.ok(ids(check({ uri: "data:text/plain;base64,AAAA" }), "fail").includes("token_uri.prefix"));
  assert.ok(ids(check({ uri: golden + "\n" }), "fail").includes("token_uri.ascii"));
  assert.ok(ids(check({ uri: JSON_PREFIX + Buffer.from([0x7b, 0xff, 0x7d]).toString("base64") }), "fail").includes("token_uri.utf8"));
  assert.match(check({ uri: JSON_PREFIX + b64('{"name":') }).checks.find((c) => c.id === "json.parse")?.message ?? "", /invalid JSON/);
  assert.ok(ids(check({ uri: toUri([1]) }), "fail").includes("json.object"));
});

test("fields: a missing image, a missing name, wrong types, unknown fields", () => {
  const { image: _image, ...noImage } = goldenJson();
  assert.ok(ids(check({ uri: toUri(noImage) }), "fail").includes("json.image"));
  const { name: _name, ...noName } = goldenJson();
  assert.ok(ids(check({ uri: toUri(noName) }), "fail").includes("json.name"));
  assert.ok(ids(check({ uri: toUri({ ...goldenJson(), name: 7 }) }), "fail").includes("json.name"));
  assert.ok(ids(check({ uri: toUri({ ...goldenJson(), description: [] }) }), "fail").includes("json.description"));
  const { description: _d, ...noDescription } = goldenJson();
  assert.deepEqual(ids(check({ uri: toUri(noDescription) }), "warn").filter((i) => i === "json.description"), ["json.description"]);
  const r = check({ uri: toUri({ ...goldenJson(), youtube_url: "https://youtu.be/x", extra: 1 }) });
  assert.deepEqual(ids(r, "fail"), []);
  assert.ok(ids(r, "warn").includes("json.youtube_url") && ids(r, "warn").includes("json.unknown_fields"));
  assert.ok(ids(check({ uri: toUri({ ...goldenJson(), external_url: "not a url" }) }), "fail").includes("json.external_url"));
  assert.deepEqual(ids(check({ uri: toUri({ ...goldenJson(), external_url: "https://example.com/1" }) }), "fail"), []);
});

test("background_color is six hex digits without a #", () => {
  for (const bad of ["#ff0000", "red", "ff00", "ff00000", 255, null]) {
    const r = check({ uri: toUri({ ...goldenJson(), background_color: bad }) });
    assert.deepEqual(ids(r, "fail"), ["json.background_color"], String(bad));
  }
  assert.match(check({ uri: toUri({ ...goldenJson(), background_color: "#ff0000" }) }).checks.find((c) => c.id === "json.background_color")?.message ?? "", /without the leading #/);
  for (const good of ["ff0000", "00AAbb"]) assert.deepEqual(ids(check({ uri: toUri({ ...goldenJson(), background_color: good }) }), "fail"), []);
});

test("attributes: shapes, display_type, max_value, quoted numbers", () => {
  const attrs = (/** @type {unknown} */ attributes) => check({ uri: toUri({ ...goldenJson(), attributes }) });
  const good = [
    { trait_type: "Base", value: "Starfish" },
    { display_type: "number", trait_type: "Generation", value: 2, max_value: 10 },
    { display_type: "date", trait_type: "Birthday", value: 1546360800 },
    { display_type: "boost_number", trait_type: "Stamina", value: 40 },
    { display_type: "boost_percentage", trait_type: "Speed", value: 10 },
    { value: "a generic string trait" },
  ];
  let r = attrs(good);
  assert.deepEqual([ids(r, "fail"), ids(r, "warn")], [[], []]);
  assert.ok(ids(r, "pass").includes("json.attributes"));
  assert.ok(ids(attrs({}), "fail").includes("json.attributes"));
  assert.ok(ids(attrs(["x"]), "fail").includes("json.attributes"));
  assert.ok(ids(attrs([{ trait_type: "A" }]), "fail").includes("json.attributes"));
  assert.ok(ids(attrs([{ trait_type: 3, value: "x" }]), "fail").includes("json.attributes"));
  assert.ok(ids(attrs([{ value: 3 }]), "fail").includes("json.attributes"));
  assert.ok(ids(attrs([{ display_type: "number", trait_type: "G", value: "2" }]), "fail").includes("json.attributes"));
  assert.ok(ids(attrs([{ display_type: "date", trait_type: "D", value: 1.5 }]), "fail").includes("json.attributes"));
  assert.ok(ids(attrs([{ display_type: "number", trait_type: "G", value: 2, max_value: "10" }]), "fail").includes("json.attributes"));
  for (const warn of [
    { display_type: "stars", trait_type: "G", value: 2 },
    { display_type: "date", trait_type: "D", value: 1546360800000 },
    { display_type: "number", trait_type: "G", value: 12, max_value: 10 },
    { trait_type: "G", value: "7" },
    { trait_type: "G", value: true },
    { trait_type: "G", value: "x", rarity: 1 },
  ]) {
    r = attrs([warn]);
    assert.deepEqual([ids(r, "fail"), ids(r, "warn")], [[], ["json.attributes"]], JSON.stringify(warn));
  }
});

test("the image SVG: well-formed, in the SVG namespace, no scripts, no external references", () => {
  const svg = (/** @type {string} */ body, root = "<svg xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink'>") => `${root}${body}</svg>`;
  const failing = (/** @type {string} */ s) => ids(check({ uri: toUri(withImage(s)) }), "fail");
  for (const [body, id] of [
    ["<image href='https://example.com/a.png'/>", "image.self_contained"],
    ["<image xlink:href='http://example.com/a.png'/>", "image.self_contained"],
    ["<rect fill='url(https://example.com/p)'/>", "image.self_contained"],
    ["<style>@import 'x.css'; rect{fill:url(\"//e.com/p\")}</style>", "image.self_contained"],
    ["<rect style='fill:url(http://e.com/p)'/>", "image.self_contained"],
    ["<script>alert(1)</script>", "image.no_script"],
    ["<rect onclick='x()'/>", "image.no_script"],
    ["<!-- </SCRIPT> --><rect/>", "image.no_script_end_tag"],
  ]) {
    assert.ok(failing(svg(body)).includes(id), body);
  }
  // Local references are fine: fragments, and data: URIs.
  const ok = svg("<defs><linearGradient id='g'/></defs><rect fill='url(#g)'/><use href='#g'/><image href='data:image/png;base64,AAAA'/>");
  assert.ok(!failing(ok).some((i) => i.startsWith("image.")), failing(ok).join());
  assert.ok(failing("<svg xmlns='http://www.w3.org/2000/svg'><g></svg>").includes("image.xml"));
  assert.ok(failing("<svg><rect/></svg>").includes("image.svg_root"));
  assert.ok(failing("<svg xmlns='http://www.w3.org/2000/svg'><image xlink:href='#a'/></svg>").includes("image.xml"));
  assert.match(check({ uri: toUri(withImage("<svg xmlns='x'>\n<rect></svg>")) }).checks.find((c) => c.id === "image.xml")?.message ?? "", /line 2/);
  assert.ok(ids(check({ uri: toUri({ ...goldenJson(), image: "https://example.com/1.png" }) }), "warn").includes("image.type"));
  assert.ok(ids(check({ uri: toUri({ ...goldenJson(), image: "nothing" }) }), "fail").includes("image.type"));
});

test("the XML parser accepts well-formed documents and rejects malformed ones", () => {
  assert.doesNotThrow(() => parseXml('<?xml version="1.0"?><!-- c --><a x="1" y=\'2&amp;\'><b/><![CDATA[<]]>t&#65;</a>'));
  for (const bad of ["", "<a>", "<a></b>", "<a/><b/>", "<a x=1/>", '<a x="1" x="2"/>', "<a>&nbsp;</a>", "<a>]]></a>", "<!DOCTYPE a><a/>", "<a/>text", "<a><!-- -- --></a>", '<a x="<"/>', "<a:b/>", "<?pi x?><a/>", "<a b='1'c='2'/>"]) {
    assert.throws(() => parseXml(bad), undefined, JSON.stringify(bad));
  }
});

test("the page: a wrong or unknown engine, a changed page, a wrong version, invalid MIDI, bad SETTINGS", () => {
  const fails = (/** @type {string} */ html, opts = {}) => ids(check({ uri: toUri(withHtml(html)) }, opts), "fail");
  const html = goldenHtml();
  // A different engine in a valid gzip payload: the engine hash and the page's hash and gzip record all differ.
  const other = withGzipPayload(html, () => gzipSync(Buffer.from("globalThis.other = 1;")).toString("base64"));
  assert.deepEqual(fails(other).filter((i) => i.startsWith("player.")), ["player.engine_sha256", "player.gzip", "player.page_sha256_record"]);
  // A corrupt payload and a missing engine tag.
  assert.ok(fails(withGzipPayload(html, (p) => p.slice(0, -8))).includes("player.page"));
  assert.ok(fails(withGzipPayload(html, () => null)).includes("player.page"));
  // --expect and --version.
  const real = check({ uri: golden }).hashes.engine_sha256;
  assert.deepEqual(ids(check({ uri: golden }, { expect: "0x" + real }), "fail"), []);
  assert.deepEqual(ids(check({ uri: golden }, { expect: "00".repeat(32) }), "fail"), ["player.engine_sha256"]);
  assert.deepEqual(ids(check({ uri: golden }, { version: "9.9.9" }), "fail"), ["player.engine_sha256"]);
  // Invalid MIDI: the magic bytes broken (the length is unchanged, so the page stays aligned).
  const midi = html.replace(/(id="midi">\s*)TVRoZA/, "$1AAAAAA");
  assert.notEqual(midi, html);
  assert.deepEqual(fails(midi), ["player.midi"]);
  assert.match(check({ uri: toUri(withHtml(midi)) }).checks.find((c) => c.id === "player.midi")?.message ?? "", /fails the page's check/);
  // SETTINGS that do not decode.
  const settings = html.replace(/(id="settings">\s*)1,/, "$12,");
  assert.notEqual(settings, html);
  assert.deepEqual(fails(settings), ["player.settings"]);
  // Not the player's page at all: an HTML page without the blocks, and a non-HTML animation_url.
  assert.ok(fails("<!doctype html><p>hi</p>").includes("player.blocks"));
  assert.ok(ids(check({ uri: toUri({ ...goldenJson(), animation_url: "data:video/mp4;base64,AAAA" }) }), "fail").includes("animation.prefix"));
  const { animation_url: _a, ...none } = goldenJson();
  assert.ok(ids(check({ uri: toUri(none) }), "fail").includes("animation.present"));
});

test("the page's network references: loads fail, URL text warns, comments and namespaces do not count", () => {
  const html = goldenHtml();
  const at = html.indexOf("<title>");
  const fails = (/** @type {string} */ inject) => ids(check({ uri: toUri(withHtml(html.slice(0, at) + inject + html.slice(at))) }), "fail");
  assert.ok(fails('<link rel="stylesheet" href="https://example.com/a.css">').includes("animation.self_contained"));
  assert.ok(fails('<script src="//example.com/x.js"></script>').includes("animation.self_contained"));
  assert.ok(fails("<style>p{background:url(https://example.com/a.png)}</style>").includes("animation.self_contained"));
  assert.ok(!fails("<!-- https://example.com/ -->").includes("animation.self_contained"));
  const r = check({ uri: toUri(withHtml(html.slice(0, at) + "<noscript>see https://example.com/</noscript>" + html.slice(at))) });
  assert.ok(ids(r, "warn").includes("animation.network_urls"));
});

test("the art block: a differing art, and the art of a non-SVG image", () => {
  const html = goldenHtml();
  const changed = html.slice(0, html.lastIndexOf("</svg>")) + "<!-- x --></svg>";
  assert.deepEqual(ids(check({ uri: toUri(withHtml(changed)) }), "fail"), ["player.art_block"]);
  // An external image: the art is checked as an SVG of its own.
  const external = { ...withHtml(html.slice(0, html.indexOf(ART_OPEN) + ART_OPEN.length) + "<svg xmlns='http://www.w3.org/2000/svg'><image href='https://example.com/a.png'/></svg>"), image: "https://example.com/1.png" };
  assert.ok(ids(check({ uri: toUri(external) }), "fail").includes("art.self_contained"));
});

test("sizes: the JSON-RPC response against the 10 MiB cap", () => {
  const big = check({ uri: JSON_PREFIX + "A".repeat(5_000_000) });
  assert.ok(ids(big, "fail").includes("size.rpc"));
  assert.ok(big.sizes.rpc_response_estimated > RPC_CAP);
  const near = check({ uri: JSON_PREFIX + "A".repeat(4_000_000) });
  assert.ok(ids(near, "warn").includes("size.rpc"));
  assert.ok(!ids(near, "fail").includes("size.rpc"));
  // A measured size replaces the estimate.
  assert.equal(check({ uri: golden }, { rpcResponseBytes: 1234 }).sizes.rpc_response_bytes, 1234);
});

test("keccak-256 and the selectors", () => {
  assert.equal(keccak256(Buffer.alloc(0)).toString("hex"), "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470");
  assert.equal(keccak256(Buffer.from("a".repeat(200))).length, 32);
  // The values of `sncast utils selector`.
  assert.equal(selector("token_uri"), "0x0226ad7e84c1fe08eb4c525ed93cccadf9517670341304571e66f7c4f95cbe54");
  assert.equal(selector("tokenURI"), "0x012a7823b0c6bee58f8c694888f32f862c6584caa8afa0242de046d298ba684d");
});

test("fetch: calls token_uri with the u256 split, falls back to tokenURI, and never reveals the RPC URL", async () => {
  const rpc = "https://rpc.example.com/v0_8/SECRET_KEY";
  const felts = byteArrayFelts(golden);
  /** @type {any[]} */
  const calls = [];
  const reply = (/** @type {any} */ body) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });
  const token = (1n << 130n) + 5n;
  const ok = await fetchTokenUri({ rpc, contract: "0x1", token: String(token), fetchImpl: /** @type {any} */ (async (/** @type {string} */ url, /** @type {any} */ init) => {
    const body = JSON.parse(init.body);
    calls.push([url, body.params.request]);
    return reply(calls.length === 1 ? { jsonrpc: "2.0", id: 1, error: { code: 21, message: "Invalid message selector" } } : { jsonrpc: "2.0", id: 1, result: felts });
  }) });
  assert.equal(ok.uri, golden);
  assert.equal(ok.felts, felts.length);
  assert.equal(calls[0][1].entry_point_selector, selector("token_uri"));
  assert.equal(calls[1][1].entry_point_selector, selector("tokenURI"));
  assert.deepEqual(calls[0][1].calldata, ["0x5", "0x4"]);
  const fails = async (/** @type {any} */ impl) => {
    /** @type {Error | undefined} */
    let error;
    try {
      await fetchTokenUri({ rpc, contract: "0x1", token: "1", fetchImpl: impl });
    } catch (e) {
      error = /** @type {Error} */ (e);
    }
    assert.ok(error);
    assert.doesNotMatch(error.message + String(error.cause ?? ""), /SECRET_KEY|rpc\.example\.com/);
    return error.message;
  };
  assert.match(await fails(async () => { throw Object.assign(new TypeError(`fetch failed ${rpc}`), { cause: { code: "ENOTFOUND" } }); }), /request failed \(ENOTFOUND\)/);
  assert.match(await fails(async () => ({ ok: false, status: 429, text: async () => "" })), /HTTP 429/);
  assert.match(await fails(async () => ({ ok: true, status: 200, text: async () => "<html>" })), /not JSON/);
  assert.match(await fails(async () => reply({ error: { code: 40, message: `Contract error at ${rpc}`, data: { revert_error: ["0x4f7574206f6620676173"] } } })), /revert reason: Out of gas/);
});

test("command line: exit codes, --json, stdin, usage errors", async () => {
  const cli = (/** @type {string[]} */ args, input = "") => spawnSync(process.execPath, [SCRIPT, ...args], { input, encoding: "utf8" });
  let r = cli([GOLDEN]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /PASS: \d+ passed, 2 warnings, 0 failed/);
  r = cli(["-", "--json"], golden);
  assert.equal(r.status, 0);
  const j = JSON.parse(r.stdout);
  assert.equal(j.ok, true);
  assert.equal(j.summary.fail, 0);
  assert.ok(j.hashes.page_sha256 && j.sizes.token_uri_bytes && j.sources["OpenSea media-and-traits"]);
  r = cli(["-"], golden.replace("data:application/json;base64,", "data:application/json;base64,!"));
  assert.equal(r.status, 1);
  assert.match(r.stdout, /FAIL token_uri\.base64 .*"!" at offset 0/);
  assert.equal(cli(["-", "--expect", "00".repeat(32)], golden).status, 1);
  assert.equal(cli([]).status, 2);
  assert.equal(cli(["--bogus"]).status, 2);
  assert.equal(cli(["/nonexistent"]).status, 2);
  assert.equal(cli(["-"], "hello").status, 2);
  assert.equal(cli(["--contract", "0x1", "--token", "1"]).status, 2);
  // Fetch mode reports an unreachable RPC without printing its URL.
  r = cli(["--rpc", "http://127.0.0.1:1/SECRET_KEY", "--contract", "0x1", "--token", "1"]);
  assert.equal(r.status, 2);
  assert.doesNotMatch(r.stdout + r.stderr, /SECRET_KEY|127\.0\.0\.1/);
  const out = [];
  assert.equal(await run([GOLDEN], (l) => out.push(l)), 0);
  assert.ok(out.length);
});
