// @ts-check
// Node tests for scripts/preview.mjs, the offline preview of a token's page (README: "Agent skills").
// The identity tests tie its output to the Cairo contract's: for the example's token 1 it must equal
// examples/beast_consumer/fixtures/animation.html (decoded from the golden token_uri that the
// contract matches byte for byte), and for token 4, a full-size Beast, the token_uri built around it
// must have the digest the contract's token_uri is tested against.

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { verifyEngine } from "./verify_engine.mjs";
import { IMAGE_KEY, JSON_PREFIX, URL_KEY, b64, pageHtml, sha256, spaces } from "./page.mjs";
import { PLACEHOLDER_SVG, buildPreview, panicData, settingsFromText, settingsShape } from "./preview.mjs";
import { DEFAULT_SETTINGS } from "./settings_fixtures.mjs";
import { MIDI, renderSvg, settingsFor, tokenParts } from "../examples/beast_consumer/scripts/reference.mjs";

const SCRIPT = fileURLToPath(new URL("./preview.mjs", import.meta.url));
const CHECK_MIDI = fileURLToPath(new URL("./check_midi.mjs", import.meta.url));
const read = (/** @type {string} */ p) => readFileSync(new URL(`../${p}`, import.meta.url));

const dir = mkdtempSync(join(tmpdir(), "preview-"));
after(() => rmSync(dir, { recursive: true, force: true }));
/** Writes a file into the test's temporary directory and returns its path. */
const file = (/** @type {string} */ name, /** @type {string | Uint8Array} */ data) => {
  const p = join(dir, name);
  writeFileSync(p, data);
  return p;
};
/** Runs the CLI. */
const cli = (/** @type {string[]} */ args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });

const settingsFixtures = JSON.parse(read("tests/fixtures/settings.json").toString("utf8"));

describe("identity with the contract's output", () => {
  test("token 1: the page equals the example's animation.html, decoded from the contract's token_uri", () => {
    const out = join(dir, "token1.html");
    const r = cli([file("t1.mid", MIDI), "--settings", file("t1.json", JSON.stringify(settingsFor(1))), "--svg", file("t1.svg", renderSvg("Warlock", 1)), "--out", out]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(readFileSync(out).equals(read("examples/beast_consumer/fixtures/animation.html")), "preview != fixtures/animation.html");
  });

  test("token 1 from base64 MIDI and a fixture-entry settings file gives the same bytes", () => {
    const out = join(dir, "token1-b64.html");
    const entry = { name: "token 1", settings: settingsFor(1) };
    const r = cli([MIDI.toString("base64"), "--settings", file("t1-entry.json", JSON.stringify(entry)), "--svg", file("t1b.svg", renderSvg("Warlock", 1)), "--out", out]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(readFileSync(out).equals(read("examples/beast_consumer/fixtures/animation.html")));
  });

  test("token 4, a full-size Beast: the token_uri around the page has the contract's tested digest", () => {
    const p = tokenParts(4);
    const out = join(dir, "token4.html");
    const r = cli([file("t4.mid", p.midi), "--settings", file("t4.json", JSON.stringify(p.settings)), "--svg", file("t4.svg", p.svg), "--out", out]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const html = readFileSync(out);
    // The whole JSON, encoded once, with the same insignificant spaces as the consumer's layout.
    const json = "{" + p.mem + "," + spaces(p.headPad) + IMAGE_KEY + p.svgB64 + '"' + spaces(p.sPad) + p.comma +
      URL_KEY + b64(html) + '"' + spaces(p.sPad) + "}";
    const uri = JSON_PREFIX + b64(json);
    const golden = read("examples/beast_consumer/tests/golden.cairo").toString("utf8");
    const m = golden.match(/pub fn token_uri_4_digest\(\) -> \(u32, u256\) \{\s*\((\d+), 0x([0-9a-f]{64})\)/);
    assert.ok(m, "golden.cairo has token_uri_4_digest");
    assert.equal(uri.length, Number(m[1]));
    assert.equal(sha256(uri), m[2]);
  });
});

describe("defaults", () => {
  test("no --settings and no --svg: the default settings and the placeholder art", () => {
    const out = join(dir, "default.html");
    const r = cli([file("d.mid", MIDI), "--out", out]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const html = readFileSync(out).toString("latin1");
    const page = pageHtml();
    const defaults = settingsFixtures.valid.find((/** @type {{name: string}} */ v) => v.name === "default");
    assert.ok(html.startsWith(page + defaults.settings_text + "</script>"), "PAGE, then the default SETTINGS");
    assert.ok(html.endsWith('<script type="text/plain" id="art">' + PLACEHOLDER_SVG));
    assert.deepEqual(DEFAULT_SETTINGS, defaults.settings);
    assert.equal(verifyEngine(html).page.length, page.length);
    assert.match(r.stdout, /^ {2}page tinysynth-\S+: it must equal the class's version\(\)$/m);
  });
});

describe("checks", () => {
  test("a MIDI file the page rejects: exit 1, reported exactly as check_midi.mjs reports it", () => {
    const bad = file("bad.mid", MIDI.subarray(0, MIDI.length - 1));
    const r = cli([bad, "--out", join(dir, "never.html")]);
    assert.equal(r.status, 1);
    const check = spawnSync(process.execPath, [CHECK_MIDI, bad], { encoding: "utf8" });
    assert.equal(check.status, 1);
    assert.equal(r.stdout, check.stdout);
  });

  test("every invalid and reserved settings fixture fails with the class's revert", () => {
    const cases = [...settingsFixtures.invalid, ...settingsFixtures.reserved];
    assert.ok(cases.length > 50);
    for (const { name, settings, error } of cases) {
      assert.throws(
        () => buildPreview({ midiArg: file("s.mid", MIDI), settings: settingsShape(settings) }),
        (/** @type {any} */ e) => {
          assert.equal(e.status, 1, name);
          assert.equal(e.lines.at(-1), `  midi_segment would revert with ('${error[0]}'${error.slice(1).map((/** @type {number} */ i) => `, ${i}`).join("")})`, name);
          return true;
        },
      );
    }
    assert.equal(panicData(Object.assign(new Error(), { code: "TS: volume out of range", indices: [3, 1] }) /** @type {any} */), "('TS: volume out of range', 3, 1)");
  });

  test("a settings file with a misspelt or missing field: exit 1, naming it", () => {
    const typo = cli([file("ty.mid", MIDI), "--settings", file("typo.json", JSON.stringify({ ...DEFAULT_SETTINGS, reverbb: 1 }))]);
    assert.equal(typo.status, 1);
    assert.match(typo.stdout, /settings has unknown field reverbb/);
    const { voices, ...rest } = DEFAULT_SETTINGS;
    void voices;
    const missing = cli([file("mi.mid", MIDI), "--settings", file("missing.json", JSON.stringify(rest))]);
    assert.equal(missing.status, 1);
    assert.match(missing.stdout, /settings is missing voices/);
    const op = { ...settingsFixtures.valid.find((/** @type {{name: string}} */ v) => v.name === "beast_reference").settings };
    op.timbres = [{ ...op.timbres[0], operators: [{ ...op.timbres[0].operators[0], volume: "3000" }] }];
    const type = cli([file("ty2.mid", MIDI), "--settings", file("type.json", JSON.stringify(op))]);
    assert.equal(type.status, 1);
    assert.match(type.stdout, /timbres\[0\]\.operators\[0\]\.volume must be a u32/);
  });

  test("SETTINGS text, as a page carries it, is parsed strictly", () => {
    const defaults = settingsFixtures.valid.find((/** @type {{name: string}} */ v) => v.name === "default");
    assert.deepEqual(settingsFromText("settings.txt", ` ${defaults.settings_text}\n`), DEFAULT_SETTINGS);
    for (const bad of ["1,1,30,40,64,0", "1,1,30,40,64,0,0,0", "1,01,30,40,64,0,0"]) {
      assert.throws(() => settingsFromText("settings.txt", bad), (/** @type {any} */ e) => e.status === 1 && /^FAIL settings\.txt$/.test(e.lines[0]), bad);
    }
  });

  test("an SVG with </script in any letter case: exit 1, and nothing is written", () => {
    const out = join(dir, "unsafe.html");
    const r = cli([file("u.mid", MIDI), "--svg", file("u.svg", "<svg><script>1</ScRiPt></svg>"), "--out", out]);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /art: the SVG contains "<\/ScRiPt" at byte 14/);
    assert.throws(() => readFileSync(out), /ENOENT/);
  });

  test("usage errors and unreadable inputs: exit 2", () => {
    assert.equal(cli([]).status, 2);
    assert.equal(cli([file("a.mid", MIDI), file("b.mid", MIDI)]).status, 2);
    assert.equal(cli([file("c.mid", MIDI), "--bogus"]).status, 2);
    assert.equal(cli([file("e.mid", MIDI), "--settings"]).status, 2);
    assert.equal(cli([file("f.mid", MIDI), "--settings", join(dir, "absent.json")]).status, 2);
    assert.equal(cli([file("g.mid", MIDI), "--settings", file("broken.json", "{")]).status, 2);
    assert.equal(cli([join(dir, "absent.mid")]).status, 2);
    const many = cli(["tests/fixtures/midi/scores.json"]);
    assert.equal(many.status, 2);
    assert.match(many.stderr, /5 scores; give exactly one/);
    assert.equal(cli(["--help"]).status, 0);
  });
});

test("--serve serves the page it wrote, and nothing else", async () => {
  const out = join(dir, "served.html");
  const child = spawn(process.execPath, [SCRIPT, file("sv.mid", MIDI), "--out", out, "--serve", "0"]);
  try {
    const url = await new Promise((ok, fail) => {
      let text = "";
      child.stdout.on("data", (chunk) => {
        text += chunk;
        const m = text.match(/serving (http:\/\/127\.0\.0\.1:\d+\/)/);
        if (m) ok(m[1]);
      });
      child.on("exit", (code) => fail(new Error(`exited with ${code}: ${text}`)));
    });
    const page = await fetch(url);
    assert.equal(page.status, 200);
    assert.equal(page.headers.get("content-type"), "text/html; charset=utf-8");
    assert.ok(Buffer.from(await page.arrayBuffer()).equals(readFileSync(out)));
    assert.ok(Buffer.from(await (await fetch(url + "served.html")).arrayBuffer()).equals(readFileSync(out)));
    assert.equal((await fetch(url + "other.html")).status, 404);
  } finally {
    child.kill();
  }
});
