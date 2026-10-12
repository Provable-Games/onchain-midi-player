// @ts-check
// Node tests for scripts/validate_token_uri.mjs (docs/verifying.md: "Validating a token_uri"): the
// example's golden token_uri passes, and each class of failure is reported by the check that owns it.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { ART_OPEN, HTML_PREFIX, MIDI_OPEN, JSON_PREFIX, SVG_PREFIX, VERSION, b64, byteArrayFelts, withGzipPayload } from "./page.mjs";
import { RPC_CAP, base64Problem, formatReport, parseInput, parseXml, run, validateTokenUri } from "./validate_token_uri.mjs";

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
  const record = JSON.parse(readFileSync(new URL("./page_versions.json", import.meta.url), "utf8"))[VERSION];
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
  // sncast output with a warning line before the JSON (`> call.json 2>&1`).
  const noisy = parseInput(Buffer.from(`[WARNING] RPC version differs\n${JSON.stringify({ response: JSON.stringify(golden) })}\n`));
  assert.equal(noisy.uri, golden);
  assert.throws(() => parseInput(Buffer.from(JSON.stringify(felts.slice(0, -1)))), /not one ByteArray/);
  assert.throws(() => parseInput(Buffer.from("hello")), /no starknet_call result/);
  assert.throws(() => parseInput(Buffer.from(JSON.stringify({ error: { code: 40, message: "Contract error" } }))), /call failed/);
});

test("decoded token JSON with extra fields named like call output is still token JSON", () => {
  const withExtra = { ...goldenJson(), result: "ok", response: "x", error: 1 };
  const [asJson, asUri] = [check(parseInput(Buffer.from(JSON.stringify(withExtra)))), check({ uri: toUri(withExtra) })];
  assert.deepEqual(ids(asJson, "fail"), []);
  assert.deepEqual(ids(asJson, "warn"), ids(asUri, "warn"));
});

test("invalid UTF-8 fails the same through raw JSON and the data URI", () => {
  const bytes = Buffer.from(JSON.stringify(goldenJson()));
  const at = bytes.indexOf("Warlock");
  bytes[at] = 0xff;
  assert.throws(() => parseInput(bytes), /not valid UTF-8/);
  const viaUri = check({ uri: JSON_PREFIX + bytes.toString("base64") });
  assert.ok(ids(viaUri, "fail").includes("token_uri.utf8"));
});

test("malformed token JSON is a json.parse failure (exit 1), not an unreadable input", async () => {
  for (const text of ['{"name":"x",}', '{"name":"x"', '{"name":"a\u0001b"}']) {
    const input = parseInput(Buffer.from(text));
    assert.deepEqual(input, { json: text });
    assert.ok(ids(check(input), "fail").includes("json.parse"), text);
  }
  const dir = mkdtempSync(join(tmpdir(), "validate-"));
  writeFileSync(join(dir, "bad.json"), '{"name":"x",}');
  const out = [];
  assert.equal(await run([join(dir, "bad.json")], (l) => out.push(l)), 1);
  assert.match(out.join("\n"), /FAIL json\.parse +invalid JSON/);
  rmSync(dir, { recursive: true });
});

test("the sncast response keeps its characters: a non-ASCII one fails the ASCII check", () => {
  const input = parseInput(Buffer.from(JSON.stringify({ response: JSON.stringify("\u0164" + golden.slice(1)) })));
  assert.ok(ids(check(input), "fail").includes("token_uri.ascii"));
  assert.deepEqual(ids(check(parseInput(Buffer.from(JSON.stringify({ response: JSON.stringify(golden) })))), "fail"), []);
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
  // Prefixed <style> elements are style elements, in text and in CDATA.
  const prefixed = "<svg xmlns='http://www.w3.org/2000/svg' xmlns:s='http://www.w3.org/2000/svg'>";
  assert.ok(failing(`${prefixed}<s:style>@import "https://example.com/a.css";</s:style></svg>`).includes("image.self_contained"));
  assert.ok(failing(`${prefixed}<s:style><![CDATA[rect{fill:url(https://example.com/p)}]]></s:style></svg>`).includes("image.self_contained"));
  // Literal characters must be XML characters everywhere, and a style's text is its chunks together.
  for (const bad of ["<text><![CDATA[a\u0001b]]></text>", "<!-- \u0001 --><g/>", "<text>a\u0002</text>", "<text>\uFFFE</text>"]) assert.ok(failing(svg(bad)).includes("image.xml"), JSON.stringify(bad));
  assert.ok(failing(svg("<style>rect{fill:u<![CDATA[rl]]>(https://example.com/p)}</style>")).includes("image.self_contained"));
  assert.ok(failing(svg("<style>@im<!-- x -->port 'https://example.com/a.css';</style>")).includes("image.self_contained"));
  assert.ok(failing(svg("<style>rect{fill:ur<![CDATA[l(]]>https://example.com/p)}</style>")).includes("image.self_contained"));
  // XML declarations follow their grammar.
  const body = "<svg xmlns='http://www.w3.org/2000/svg'/>";
  for (const bad of ["<?xml bogus?>", "<?xml version='1.0' bogus='1'?>", "<?xml encoding='utf-8'?>", "<?xml version=\"2.0\"?>", "<?xml version='1.0' standalone='maybe'?>"]) {
    assert.ok(failing(bad + body).includes("image.xml"), bad);
    // The same malformed SVG as the image and as the art block, which therefore agree.
    const html = goldenHtml();
    const art = bad + body;
    const same = { ...withHtml(html.slice(0, html.indexOf(ART_OPEN) + ART_OPEN.length) + art), image: SVG_PREFIX + b64(art) };
    assert.ok(ids(check({ uri: toUri(same) }), "fail").includes("image.xml"), bad);
    assert.equal(check({ uri: toUri(same) }).toJSON().ok, false, bad);
  }
  for (const good of ['<?xml version="1.0"?>', "<?xml version='1.1' encoding='UTF-8' standalone='yes'?>"]) assert.deepEqual(failing(good + body).filter((i) => i.startsWith("image.")), [], good);
  // A DOCTYPE, as SVG tools write it, is well-formed; an internal subset (entities) is refused by rule.
  const doctype = '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">';
  assert.deepEqual(failing(`<?xml version="1.0"?>${doctype}<svg xmlns='http://www.w3.org/2000/svg'><rect/></svg>`).filter((i) => i.startsWith("image.")), []);
  assert.deepEqual(failing(`<!DOCTYPE svg [<!ENTITY e "x">]><svg xmlns='http://www.w3.org/2000/svg'>&e;</svg>`).filter((i) => i.startsWith("image.")), ["image.xml"]);
  assert.ok(failing(`<!DOCTYPE svg [<!ENTITY e "x">]><svg xmlns='http://www.w3.org/2000/svg'/>`).includes("image.no_entities"));
  for (const bad of ["<!DOCTYPE>", "<!DOCTYPE svg SYSTEM>", "<!DOCTYPE svg PUBLIC 'a'>", "<!DOCTYPE 1svg>", "<!DOCTYPE svg bogus>"]) {
    assert.ok(failing(`${bad}<svg xmlns='http://www.w3.org/2000/svg'/>`).includes("image.xml"), bad);
  }
  assert.deepEqual(failing(`<!DOCTYPE svg SYSTEM "x.dtd"><svg xmlns='http://www.w3.org/2000/svg'/>`).filter((i) => i.startsWith("image.")), []);
  // CSS escapes are decoded before the reference checks.
  for (const css of ["rect{fill:u\\72l(https://example.com/p)}", "@\\69mport 'https://example.com/a.css';", "rect{fill:\\75rl( 'https://e.com/p' )}"]) {
    assert.ok(failing(svg(`<style>${css}</style>`)).includes("image.self_contained"), css);
  }
  assert.deepEqual(failing(svg("<defs><linearGradient id='g'/></defs><style>rect{fill:u\\72l(#g);b:\\75rl(data:image/png;base64,AAAA)}</style>")).filter((i) => i.startsWith("image.")), []);
  assert.ok(failing("<svg><rect/></svg>").includes("image.svg_root"));
  // CSS comments are inert, and split a token; an active rule next to one still fails.
  assert.deepEqual(failing(svg("<style>/* @import 'https://example.com/old.css'; url(https://e.com/x) */ rect{fill:red}</style>")).filter((i) => i.startsWith("image.")), []);
  assert.ok(failing(svg("<style>/* x */ @import 'https://example.com/a.css';</style>")).includes("image.self_contained"));
  assert.ok(failing(svg("<style>@import'https://example.com/a.css';</style>")).includes("image.self_contained"));
  // A self-contained import (a data: URI) is allowed, quoted or in url().
  assert.deepEqual(failing(svg("<style>@import 'data:text/css,rect{fill:red}'; @import url(data:text/css,a{}) ;</style>")).filter((i) => i.startsWith("image.")), []);
  assert.deepEqual(failing(svg("<style>@import 'data:text/css,rect{fill:red;stroke:blue}'; @import url(\"data:text/css,a{b:c; d:e}\");</style>")).filter((i) => i.startsWith("image.")), []);
  assert.ok(failing(svg("<style>@import url('https://example.com/a b.css');</style>")).includes("image.self_contained"));
  // Foreign HTML's resource attributes (srcset, poster, src) and encoding declarations that do not match the UTF-8 bytes.
  assert.ok(failing(svg("<foreignObject><img xmlns='http://www.w3.org/1999/xhtml' srcset='https://example.com/a.png 1x'/></foreignObject>")).includes("image.self_contained"));
  assert.ok(failing(svg("<foreignObject><video xmlns='http://www.w3.org/1999/xhtml' poster='//example.com/p.png' src='https://example.com/v.mp4'/></foreignObject>")).includes("image.self_contained"));
  assert.deepEqual(failing(svg("<foreignObject><img xmlns='http://www.w3.org/1999/xhtml' srcset='data:image/png;base64,AAAA 1x, #a 2x'/></foreignObject>")).filter((i) => i.startsWith("image.")), []);
  assert.ok(failing(`<?xml version="1.0" encoding="UTF-16"?>${svg("<rect/>")}`).includes("image.xml"));
  assert.deepEqual(failing(`<?xml version="1.0" encoding="utf-8"?>${svg("<rect/>")}`).filter((i) => i.startsWith("image.")), []);
  // Character references: only XML characters; and references are expanded before the checks, as a browser reads them.
  for (const bad of ["&#0;", "&#xD800;", "&#x110000;", "&#8;", "&#xFFFE;"]) assert.ok(failing(svg(`<text>${bad}</text>`)).includes("image.xml"), bad);
  assert.deepEqual(failing(svg("<text>&#65;&#x1F600;&amp;</text>")).filter((i) => i.startsWith("image.")), []);
  // Text in CDATA and comments is literal: references and declarations there are not markup.
  assert.deepEqual(failing(svg("<text><![CDATA[&#0; &bogus;]]></text><!-- <!ENTITY e 'x'> &#0; -->")).filter((i) => i.startsWith("image.")), []);
  assert.deepEqual(failing(svg("<defs><linearGradient id='g'/></defs><rect fill='url(&#35;g)'/>")).filter((i) => i.startsWith("image.")), []);
  assert.ok(failing(svg("<rect style='fill:u&#114;l(https://example.com/p)'/>")).includes("image.self_contained"));
  assert.ok(failing(svg("<rect fill='url(&#104;ttps://example.com/p)'/>")).includes("image.self_contained"));
  assert.ok(failing(svg("<style>rect{fill:u&#114;l(https://e.com/p)}</style>")).includes("image.self_contained"));
  assert.ok(failing("<svg xmlns='http://www.w3.org/2000/svg'><image xlink:href='#a'/></svg>").includes("image.xml"));
  assert.match(check({ uri: toUri(withImage("<svg xmlns='x'>\n<rect></svg>")) }).checks.find((c) => c.id === "image.xml")?.message ?? "", /line 2/);
  assert.ok(ids(check({ uri: toUri({ ...goldenJson(), image: "https://example.com/1.png" }) }), "warn").includes("image.type"));
  assert.ok(ids(check({ uri: toUri({ ...goldenJson(), image: "nothing" }) }), "fail").includes("image.type"));
  // Other image data URIs are valid for OpenSea: warn that the image checks are skipped, keep the art checks.
  for (const image of ["data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'/>", "data:image/svg+xml,%3Csvg%20xmlns%3D%27http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%27%2F%3E", "data:image/svg+xml;charset=utf-8;base64,AAAA", "data:image/avif;base64,AAAA"]) {
    const r = check({ uri: toUri({ ...goldenJson(), image }) });
    assert.ok(ids(r, "warn").includes("image.type") && !ids(r, "fail").includes("image.type"), image);
  }
});

test("the XML parser accepts well-formed documents and rejects malformed ones", () => {
  assert.doesNotThrow(() => parseXml('<?xml version="1.0"?><!DOCTYPE a><!-- c --><a x="1" y=\'2&amp;\'><b/><![CDATA[<]]>t&#65;</a>'));
  assert.throws(() => parseXml("<a>\n<b></a>"), /mismatch/);
  for (const bad of ["", "<a>", "<a></b>", "<a/><b/>", "<a x=1/>", '<a x="1" x="2"/>', "<a>&nbsp;</a>", "<a/><!DOCTYPE a>", "<!DOCTYPE a><!DOCTYPE a><a/>", "<!ELEMENT a>", "<a/>text", "<a><!-- -- --></a>", '<a x="<"/>', "<a:b/>", "<?pi x?><a/>", "<a b='1'c='2'/>"]) {
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
  // --expect replaces the engine comparison only: a changed player script or shim, with the genuine
  // engine, still fails the PAGE record. Without a record, --expect warns that PAGE was not compared.
  const tampered = html.replace("<title>TinySynth player</title>", "<title>TinySynth player!</title>");
  assert.notEqual(tampered, html);
  assert.deepEqual(fails(tampered, { expect: real }), ["player.page_sha256_record"]);
  const noRecord = check({ uri: golden }, { expect: real, version: "9.9.9" });
  assert.deepEqual([ids(noRecord, "fail"), ids(noRecord, "warn").filter((i) => i.startsWith("player."))], [[], ["player.page_sha256_record"]]);
  // Invalid MIDI: the magic bytes broken (the length is unchanged, so the page stays aligned).
  const midi = html.replace(/(id="midi">\s*)TVRoZA/, "$1AAAAAA");
  assert.notEqual(midi, html);
  assert.deepEqual(fails(midi), ["player.midi"]);
  assert.match(check({ uri: toUri(withHtml(midi)) }).checks.find((c) => c.id === "player.midi")?.message ?? "", /fails the page's check/);
  // A tab at the end of the settings or the MIDI block: the page's decoders strip only spaces, so it
  // disables playback, and the trimmed blocks of splitPage must not hide it.
  assert.deepEqual(fails(html.replace(MIDI_OPEN, "\t" + MIDI_OPEN)), ["player.settings"]);
  assert.deepEqual(fails(html.replace(ART_OPEN, "\t" + ART_OPEN)), ["player.midi"]);
  assert.deepEqual(fails(html.replace(MIDI_OPEN, "\n" + MIDI_OPEN)), ["player.settings"]);
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
  // The decoded token JSON gets the same verdict as its token_uri.
  const huge = { ...goldenJson(), description: "x".repeat(3_000_000) };
  const [asUri, asJson] = [check({ uri: toUri(huge) }), check({ json: JSON.stringify(huge) })];
  assert.ok(ids(asUri, "warn").includes("size.rpc"));
  assert.deepEqual([ids(asJson, "warn"), asJson.sizes.rpc_response_estimated], [ids(asUri, "warn"), asUri.sizes.rpc_response_estimated]);
  const over = { ...goldenJson(), description: "x".repeat(4_000_000) };
  assert.ok(ids(check({ json: JSON.stringify(over) }), "fail").includes("size.rpc"));
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
  assert.equal(cli(["-", "--expect", "zz"], golden).status, 2);
  // A URL typed by mistake as a value is not repeated in the error.
  for (const args of [["-", "--version", "http://127.0.0.1:1/SECRET_KEY"], ["-", "--version", "__proto__"], ["-", "--version", "01.2.3"], ["-", "--expect", "http://127.0.0.1:1/SECRET_KEY"], ["--rpc", "http://127.0.0.1:1/SECRET_KEY", "--contract", "0x1", "--token", "http://127.0.0.1:1/SECRET_KEY"]]) {
    r = cli(args, golden);
    assert.equal(r.status, 2, args.join(" "));
    assert.doesNotMatch(r.stdout + r.stderr, /SECRET_KEY|127\.0\.0\.1/, args.join(" "));
  }
  // A saved error response (a file or stdin) is printed as a fetched one is: no payload, in any encoding.
  const secret = Buffer.from("https://rpc.test/KEY");
  for (const error of [{ code: 40, message: "see https://rpc.test/KEY", data: { revert_error: ["0x" + secret.toString("hex")] } }, { code: 40, message: "x", data: { revert_error: ["0x" + secret.subarray(0, 9).toString("hex"), "0x" + secret.subarray(9).toString("hex")] } }]) {
    const saved = JSON.stringify({ jsonrpc: "2.0", id: 1, error });
    for (const args of [["-"], ["-", "--json"]]) {
      r = cli(args, `[WARNING] noise\n${saved}`);
      assert.equal(r.status, 2);
      assert.doesNotMatch(r.stdout + r.stderr, /rpc\.test|KEY|68747470|7270632e74657374/);
      assert.match(r.stderr, /starknet_call failed: Contract error \(code 40\)/);
    }
  }
  assert.match(cli(["-"], JSON.stringify({ command: "call", error: "boom https://rpc.test/KEY" })).stderr, /starknet_call failed: error \(code unknown\)/);
  assert.equal(cli([]).status, 2);
  assert.equal(cli(["--bogus"]).status, 2);
  // The CLI never echoes a URL typed by mistake as the input path.
  r = cli(["http://127.0.0.1:1/SECRET_KEY"]);
  assert.equal(r.status, 2);
  assert.doesNotMatch(r.stdout + r.stderr, /SECRET_KEY|127\.0\.0\.1/);
  // The removed fetch flags are unknown options.
  assert.equal(cli(["--rpc", "x", "--contract", "0x1", "--token", "1"]).status, 2);
  assert.equal(cli(["/nonexistent"]).status, 2);
  assert.equal(cli(["-"], "hello").status, 2);
  const out = [];
  assert.equal(await run([GOLDEN], (l) => out.push(l)), 0);
  assert.ok(out.length);
});
