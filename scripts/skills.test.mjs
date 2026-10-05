// @ts-check
// Drift guards for the agent skills in plugins/onchain-midi-player (README: "Agent skills"). The skills
// summarise the README and docs/ and link to them; these tests keep them from becoming a second copy
// that drifts:
//   - the plugin manifests and every SKILL.md frontmatter follow the formats (Claude Code plugin
//     marketplaces and the open Agent Skills specification, https://agentskills.io/specification);
//   - every anchor and repository path the skills link to or name exists, and every link in the
//     README, docs/ and the example's README resolves;
//   - the midi-guide reference lists every checkMidi message, and the sound-design operator table
//     matches the JS reference of settings::validate;
//   - every gas figure in the skills appears in the README or docs/;
//   - the skills hardcode nothing a re-pin changes: VERSION, the engine commit, page and segment
//     sizes, and long hex hashes (class hashes and SHA-256s belong in docs/versions.md);
//   - the skills' helper scripts work on real fixtures.

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { OPERATOR_FIELDS } from "../player/settings.js";
import { ENGINE_PIN, engineSource } from "./engine.mjs";
import { JSON_PREFIX, VERSION, b64, byteArrayFelts, dFragment, decodeTokenUri, decodeTokenUriLayers, pageHtml, segmentFor } from "./page.mjs";
import { MIDI, renderSvg } from "../examples/beast_consumer/scripts/reference.mjs";
import { buildPreview, settingsFromText } from "./preview.mjs";
import { DEFAULT_OPERATOR, DEFAULT_SETTINGS } from "./settings_fixtures.mjs";
import { artPeriods, cssDurations, gifDelays } from "../plugins/onchain-midi-player/skills/midi-guide/scripts/art_periods.mjs";
import { byteArrayFromFelts, tokenUriFromCall } from "../plugins/onchain-midi-player/skills/token-uri-inspector/scripts/bytearray.mjs";
import { checkArt, run as splitRun, splitPage } from "../plugins/onchain-midi-player/skills/token-uri-inspector/scripts/split_page.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PLUGIN = join(ROOT, "plugins/onchain-midi-player");
const SKILLS = join(PLUGIN, "skills");
const REPO_URL = "https://github.com/Provable-Games/onchain-midi-player";
const read = (/** @type {string} */ p) => readFileSync(join(ROOT, p), "utf8");
const DOCS = readdirSync(join(ROOT, "docs")).filter((n) => n.endsWith(".md")).map((n) => `docs/${n}`);

/**
 * Every file under a directory, recursively.
 * @param {string} dir
 * @returns {string[]}
 */
const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
const pluginFiles = walk(PLUGIN);
const markdown = pluginFiles.filter((p) => p.endsWith(".md"));
const skillNames = readdirSync(SKILLS).filter((n) => statSync(join(SKILLS, n)).isDirectory());

/**
 * A heading's anchor as GitHub renders it: lowercase, punctuation other than `-` and `_` dropped,
 * spaces as `-`, and `-1`, `-2`... for repeats.
 * @param {string} text
 */
export function anchorsOf(text) {
  const seen = new Map();
  const anchors = new Set();
  let fenced = false;
  for (const line of text.split("\n")) {
    if (line.startsWith("```")) fenced = !fenced;
    const m = !fenced && line.match(/^#{1,6} +(.*?) *#* *$/);
    if (!m) continue;
    const base = m[1].toLowerCase().replace(/[^\p{L}\p{N}\p{M} _-]/gu, "").replace(/ /g, "-");
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    anchors.add(n ? `${base}-${n}` : base);
  }
  return anchors;
}

/** The links of a Markdown text, outside code blocks. */
const links = (/** @type {string} */ text) => [...text.replace(/```[\s\S]*?```/g, "").matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]);

describe("plugin and marketplace manifests", () => {
  const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
  const marketplace = JSON.parse(read(".claude-plugin/marketplace.json"));

  test("marketplace.json: name, owner and one plugin entry per plugin directory", () => {
    assert.match(marketplace.name, NAME);
    assert.doesNotMatch(marketplace.name, /^(claude|anthropic)/, "reserved-looking marketplace name");
    assert.ok(marketplace.owner?.name, "owner.name");
    assert.ok(marketplace.description);
    assert.deepEqual(marketplace.plugins.map((/** @type {{name: string}} */ p) => p.name), ["onchain-midi-player"]);
    for (const entry of marketplace.plugins) {
      assert.match(entry.name, NAME);
      assert.match(entry.source, /^\.\/[\w./-]+$/, "a relative source from the marketplace root");
      assert.ok(!entry.source.includes(".."));
      const dir = join(ROOT, entry.source);
      const manifest = JSON.parse(readFileSync(join(dir, ".claude-plugin/plugin.json"), "utf8"));
      assert.equal(manifest.name, entry.name, "the entry name and the manifest name are the same");
      // No version anywhere: Claude Code then versions the plugin by commit, so updates track main.
      assert.equal(entry.version, undefined);
      assert.equal(manifest.version, undefined);
      assert.ok(manifest.description && manifest.author?.name);
    }
  });

  test("only plugin.json in .claude-plugin/; skills/ at the plugin root; no CLAUDE.md", () => {
    assert.deepEqual(readdirSync(join(PLUGIN, ".claude-plugin")), ["plugin.json"]);
    assert.ok(statSync(SKILLS).isDirectory());
    assert.ok(!pluginFiles.some((p) => p.endsWith("CLAUDE.md")));
  });
});

describe("SKILL.md frontmatter (Agent Skills specification)", () => {
  const ALLOWED = ["name", "description", "license", "compatibility", "metadata", "allowed-tools"];

  test("at most four skills, each a folder with a SKILL.md", () => {
    assert.ok(skillNames.length >= 1 && skillNames.length <= 4, skillNames.join());
    for (const name of skillNames) assert.ok(existsSync(join(SKILLS, name, "SKILL.md")), name);
  });

  for (const name of skillNames) {
    test(`${name}: valid frontmatter, under 500 lines`, () => {
      const text = readFileSync(join(SKILLS, name, "SKILL.md"), "utf8");
      assert.ok(text.startsWith("---\n"), "frontmatter opens on line 1");
      const end = text.indexOf("\n---\n", 4);
      assert.ok(end > 0, "frontmatter closes");
      /** @type {Record<string, string>} */
      const fields = {};
      for (const line of text.slice(4, end).split("\n")) {
        const m = line.match(/^([a-z][a-z-]*): (.+)$/);
        assert.ok(m, `one "key: value" per line: ${line}`);
        const [, key, value] = m;
        assert.ok(ALLOWED.includes(key), `field ${key} is not in the Agent Skills specification`);
        assert.ok(!(key in fields), `field ${key} twice`);
        // A YAML plain scalar: no ": " or " #" inside, no indicator first, no surrounding spaces.
        assert.ok(!/: | #/.test(value) && !/^[-?:,[\]{}#&*!|>'"%@`]/.test(value) && value === value.trim(), `${key} is a plain YAML scalar`);
        fields[key] = value;
      }
      assert.equal(fields.name, name, "name matches the folder");
      assert.match(fields.name, /^[a-z0-9]+(-[a-z0-9]+)*$/);
      assert.ok(fields.name.length <= 64);
      assert.ok(fields.description && fields.description.length <= 1024, `description: ${fields.description?.length} characters`);
      if (fields.compatibility) assert.ok(fields.compatibility.length <= 500);
      assert.ok(text.split("\n").length < 500, "SKILL.md under 500 lines");
    });
  }
});

describe("links and paths", () => {
  /** @type {Map<string, Set<string>>} */
  const anchorCache = new Map();
  const anchors = (/** @type {string} */ file) => {
    if (!anchorCache.has(file)) anchorCache.set(file, anchorsOf(readFileSync(file, "utf8")));
    return /** @type {Set<string>} */ (anchorCache.get(file));
  };

  test("every link in the skills resolves: relative files, repository files and their anchors", () => {
    let checked = 0;
    for (const file of markdown) {
      for (const link of links(readFileSync(file, "utf8"))) {
        const where = `${relative(ROOT, file)}: ${link}`;
        let target;
        let anchor;
        if (link.startsWith(REPO_URL + "/")) {
          const m = link.slice(REPO_URL.length).match(/^\/(?:blob|tree)\/main\/([^#]+)(?:#(.+))?$/);
          if (!m) {
            assert.match(link.slice(REPO_URL.length), /^\/(issues|pull)\/\d+$|^#agent-skills$/, `${where}: link to main, an issue or a PR`);
            continue;
          }
          [, target, anchor] = m;
          target = join(ROOT, target);
        } else if (/^[a-z]+:/.test(link)) {
          continue; // another site
        } else {
          const [path, hash] = link.split("#");
          target = path ? resolve(dirname(file), path) : file;
          anchor = hash;
        }
        assert.ok(existsSync(target), `${where}: ${relative(ROOT, target)} exists`);
        if (anchor) assert.ok(anchors(target).has(anchor), `${where}: #${anchor} exists in ${relative(ROOT, target)}`);
        checked++;
      }
    }
    assert.ok(checked > 50, `${checked} links`);
  });

  test("every link in the README, docs/ and the example's README resolves: files and anchors", () => {
    let checked = 0;
    for (const doc of ["README.md", ...DOCS, "examples/beast_consumer/README.md"]) {
      const file = join(ROOT, doc);
      for (const link of links(read(doc))) {
        if (/^[a-z]+:/.test(link)) continue; // another site
        const [path, anchor] = link.split("#");
        const target = path ? resolve(dirname(file), path) : file;
        assert.ok(existsSync(target), `${doc}: ${link}: ${relative(ROOT, target)} exists`);
        if (anchor && target.endsWith(".md")) assert.ok(anchors(target).has(anchor), `${doc}: ${link}: #${anchor} exists in ${relative(ROOT, target)}`);
        checked++;
      }
    }
    assert.ok(checked > 100, `${checked} links`);
    // The README links every doc.
    const fromReadme = new Set(links(read("README.md")).map((l) => l.split("#")[0]));
    for (const doc of DOCS) assert.ok(fromReadme.has(doc), `README.md links ${doc}`);
    // The layout headings are general, not named after one collection.
    assert.ok(anchors(join(ROOT, "docs/token-uri-layout.md")).has("consumer-token_uri-layout") && anchors(join(ROOT, "docs/gas.md")).has("a-full-size-token"));
  });

  test("README links into the plugin resolve", () => {
    const readme = read("README.md");
    const into = links(readme).filter((l) => l.startsWith("plugins/") || l.startsWith(".claude-plugin/"));
    assert.ok(into.length >= 5);
    for (const link of into) assert.ok(existsSync(join(ROOT, link.split("#")[0])), link);
    assert.ok(anchorsOf(readme).has("agent-skills") && anchorsOf(read("docs/versions.md")).has("deployments"));
  });

  test("every repository path the skills name in code exists (from the root, or from the skill folder)", () => {
    const PATH = /(?<![\w/.$-])((?:scripts|player|examples|tests|src|plugins|references|docs)\/[\w./-]*\w)/g;
    let checked = 0;
    for (const file of markdown) {
      const skillDir = join(SKILLS, relative(SKILLS, file).split("/")[0]);
      for (const [, path] of readFileSync(file, "utf8").matchAll(PATH)) {
        if (path.includes("*")) continue;
        // Checkouts from before the rename have the plugin at plugins/onchain-tinysynth/: check
        // the path that directory has now.
        const now = path.replace(/^plugins\/onchain-tinysynth(?=\/|$)/, "plugins/onchain-midi-player");
        assert.ok(existsSync(join(ROOT, now)) || existsSync(join(skillDir, now)), `${relative(ROOT, file)}: ${path}`);
        checked++;
      }
    }
    assert.ok(checked > 20, `${checked} paths`);
  });
});

describe("content kept in step with the code", () => {
  test("the midi-guide reference lists every checkMidi and decodeMidi message", () => {
    const src = read("player/player.js");
    // fail("...") in checkMidi: a whole message, or the literal start of a computed one.
    const thrown = new Set([...src.matchAll(/fail\("([^"]*)"/g)].map((m) => m[1]));
    for (const m of src.matchAll(/new Error\("midi: ([^"]*)"\)/g)) thrown.add(m[1]);
    assert.ok(thrown.size >= 19, `found ${thrown.size} messages`);
    const reference = read("plugins/onchain-midi-player/skills/midi-guide/references/checkmidi-rules.md");
    for (const text of thrown) assert.ok(reference.includes("`" + text) || reference.includes("`midi: " + text + "`"), `the reference lists "${text}"`);
  });

  test("the sound-design operator table matches the operator fields, their types and default_operator()", () => {
    const table = read("plugins/onchain-midi-player/skills/sound-design/references/operator-fields.md");
    const n = (/** @type {number} */ x) => x.toLocaleString("en-US");
    for (const [name, type, key] of OPERATOR_FIELDS) {
      const row = `| \`${name}\` | \`${key}\` | \`${type}\` | ${n(/** @type {any} */ (DEFAULT_OPERATOR)[name])} |`;
      assert.ok(table.includes(row), `row: ${row}`);
    }
    assert.ok(table.includes("| `route` | `g` | `u8` | 0 |"));
    // No validation ranges: they are the check table's to state (src/settings.cairo).
    assert.doesNotMatch(table, /\d to [\d,]+ \|/);
  });

  test("every gas figure in the skills appears in the README or docs/", () => {
    const docs = ["README.md", ...DOCS].map(read).join("\n");
    for (const file of markdown) {
      for (const [figure] of readFileSync(file, "utf8").matchAll(/(?<![\w.])\d+(?:\.\d+)?[MB](?!\w)/g)) {
        assert.ok(docs.includes(figure), `${relative(ROOT, file)}: ${figure} is not in the README or docs/`);
      }
    }
  });

  test("nothing a re-pin changes is hardcoded in the skills", () => {
    const page = JSON.parse(read("tests/fixtures/page.json")).page;
    const sizes = [page.page_len, page.segment_len, page.gzip_len, page.license_len, Buffer.byteLength(engineSource())];
    const forbidden = [VERSION, ENGINE_PIN.ref, ENGINE_PIN.commit, ...sizes.flatMap((x) => [String(x), x.toLocaleString("en-US")])];
    for (const file of pluginFiles) {
      const text = readFileSync(file, "utf8");
      for (const value of forbidden) {
        const at = text.search(new RegExp(`(?<![\\w,.])${value.replace(/[.+]/g, "\\$&")}(?![\\w,])`));
        assert.equal(at, -1, `${relative(ROOT, file)} hardcodes ${value}`);
      }
      const hash = text.match(/(?:0x)?[0-9a-fA-F]{60,}/);
      assert.equal(hash, null, `${relative(ROOT, file)} hardcodes a hash: ${hash?.[0]}`);
    }
  });
});

describe("settings limits are not hardcoded", () => {
  // The class checks what the engine and the format require and lets gas decide cost, so these limits
  // can change between versions: the skills name the constants in src/settings.cairo instead.
  test("every MAX_ constant the skills name exists in src/settings.cairo", () => {
    const cairo = read("src/settings.cairo");
    for (const file of markdown) {
      for (const [name] of readFileSync(file, "utf8").matchAll(/\bMAX_[A-Z_]+\b/g)) {
        assert.match(cairo, new RegExp(`^pub const ${name}: `, "m"), `${relative(ROOT, file)}: ${name} is not a constant in src/settings.cairo`);
      }
    }
  });

  test("no count or length limit appears as a number next to what it limits", () => {
    const cairo = read("src/settings.cairo");
    const value = (/** @type {string} */ name) => cairo.match(new RegExp(`^pub const ${name}: u32 = ([\\d_]+);`, "m"))?.[1].replace(/_/g, "");
    /** @type {Array<[string, RegExp]>} */
    const limits = [["MAX_TIMBRES", /timbre/i], ["MAX_OPERATORS", /operator/i], ["MAX_WAVES", /\bwaves?\b/i], ["MAX_HARMONICS", /harmonic/i], ["MAX_SAMPLES", /sample/i], ["MAX_SETTINGS_LEN", /SETTINGS|settings/]];
    for (const file of markdown) {
      for (const line of readFileSync(file, "utf8").split("\n")) {
        for (const [name, topic] of limits) {
          const n = value(name);
          if (!n || !topic.test(line)) continue;
          const number = new RegExp(`(?<![\\w.,])(${n}|${Number(n).toLocaleString("en-US")})(?![\\w,]|\\.\\d)`);
          assert.doesNotMatch(line, number, `${relative(ROOT, file)} states ${name} (${n}) as a number: ${line.slice(0, 120)}`);
        }
        assert.doesNotMatch(line, /(?<![\w.,])8,?192(?![\w,])/, `${relative(ROOT, file)} states the 8,192-byte SETTINGS cap`);
      }
    }
  });
});

describe("the skills' helper scripts", () => {
  const dir = mkdtempSync(join(tmpdir(), "skills-"));
  after(() => rmSync(dir, { recursive: true, force: true }));
  /** Writes a file and returns its path. */
  const file = (/** @type {string} */ where, /** @type {string} */ name, /** @type {string} */ data) => {
    writeFileSync(join(where, name), data);
    return join(where, name);
  };

  test("art_periods: the full-size Beast's GIF loop and SMIL durations", () => {
    const svg = read("tests/fixtures/beasts/warlock_shiny_animated.svg");
    assert.deepEqual(artPeriods(svg), ["GIF: 4 frames, delays 200, 200, 200, 200 ms, loop 800 ms", "SMIL dur 2.2s", "SMIL dur 6s", "SMIL dur 3s"]);
    assert.deepEqual(artPeriods("<svg><style>.a{animation: spin 1.5s linear infinite}</style></svg>"), ["CSS animation iteration 1.5s"]);
    // An alternate animation repeats every two iterations.
    assert.deepEqual(artPeriods("<style>.m{animation: move 1s linear alternate infinite, glow 800ms alternate-reverse infinite}</style>"),
      ["CSS animation iteration 1s, alternate: repeats every 2000 ms", "CSS animation iteration 800ms, alternate: repeats every 1600 ms"]);
    assert.deepEqual(artPeriods("<style>.m{animation-duration: 1s; animation-direction: alternate}</style>"),
      ["CSS animation iteration 1s", "CSS animation-direction alternate: an alternate animation repeats every 2 iterations"]);
    assert.deepEqual(artPeriods("<style>.m{animation: alternate-name 3s infinite}</style>"), ["CSS animation iteration 3s"], "an animation name is not a direction");
    // Every entry of a list, with commas inside timing functions, and the duration before a delay.
    const css = ".a{animation: fade 1s cubic-bezier(0.1, 0.7, 1, 0.1) 0.5s infinite, spin 2400ms steps(4, end) infinite}" +
      ".b{animation-duration: 1s, 3s; animation-name: x, y; animation-delay: 9s}.c{-webkit-animation:pulse .8s}";
    assert.deepEqual(cssDurations(css), ["1s", "2400ms", "1s", "3s", ".8s"]);
    assert.throws(() => gifDelays(Buffer.from("PNG")), /not a GIF/);
    // The Beast's GIF with its delays set to 0 and 10 ms: the encoded loop is flagged, not trusted.
    const gif = Buffer.from(/** @type {RegExpMatchArray} */ (svg.match(/data:image\/gif;base64,([A-Za-z0-9+/=]+)/))[1], "base64");
    const fast = Buffer.from(gif);
    let frame = 0;
    for (let p = fast.indexOf(Buffer.from([0x21, 0xf9, 0x04])); p >= 0; p = fast.indexOf(Buffer.from([0x21, 0xf9, 0x04]), p + 1)) {
      fast.writeUInt16LE(frame++ % 2, p + 4);
    }
    assert.deepEqual(gifDelays(fast), [0, 10, 0, 10]);
    const report = artPeriods(`<svg><image href='data:image/gif;base64,${fast.toString("base64")}'/></svg>`);
    assert.equal(report[0], "GIF: 4 frames, delays 0, 10, 0, 10 ms, encoded loop 20 ms");
    assert.match(report[1], /^ {2}warning: 4 frame delays under 20 ms; .*measure this GIF's period in a browser$/);
    // The same GIF without the second frame's control extension (8 bytes): still 4 frames, one with no delay.
    const gce = Buffer.from([0x21, 0xf9, 0x04]);
    const second = gif.indexOf(gce, gif.indexOf(gce) + 1);
    const missing = Buffer.concat([gif.subarray(0, second), gif.subarray(second + 8)]);
    assert.deepEqual(gifDelays(missing), [200, 0, 200, 200]);
    assert.match(artPeriods(`<svg><image href='data:image/gif;base64,${missing.toString("base64")}'/></svg>`)[1], /warning: 1 frame delay under 20 ms/);
  });

  test("bytearray: a raw starknet_call result and sncast --json output give the token_uri", () => {
    const uri = read("examples/beast_consumer/fixtures/token_uri.txt");
    const felts = byteArrayFelts(uri);
    assert.equal(byteArrayFromFelts(felts).toString("latin1"), uri);
    const raw = JSON.stringify({ jsonrpc: "2.0", id: 1, result: felts.map((f) => "0x" + BigInt(f).toString(16)) });
    assert.equal(tokenUriFromCall(raw).toString("latin1"), uri);
    assert.equal(tokenUriFromCall(JSON.stringify(JSON.parse(raw), null, 2)).toString("latin1"), uri, "pretty-printed");
    const sncast = JSON.stringify({ command: "call", response: JSON.stringify(uri), response_raw: [], type: "response" });
    assert.equal(tokenUriFromCall(`warning: something\n${sncast}\n`).toString("latin1"), uri);
    for (const len of [0, 1, 30, 31, 32, 62]) assert.equal(byteArrayFromFelts(byteArrayFelts("x".repeat(len))).toString(), "x".repeat(len));
  });

  test("bytearray: a provider's Out of gas revert is decoded, in both forms", () => {
    // As PublicNode returned it for the example's token 4 on Sepolia (issue #11).
    const revert = "0x4f7574206f6620676173, 0x454e545259504f494e545f4641494c4544";
    const raw = JSON.stringify({ code: 40, message: "Contract error", data: { revert_error: revert } });
    assert.throws(() => tokenUriFromCall(`{"jsonrpc":"2.0","id":1,"error":${raw}}`), /revert reason: Out of gas, ENTRYPOINT_FAILED/);
    const sncast = JSON.stringify({ command: "call", error: `An error occurred in the called contract = ContractErrorData { revert_error: Message("${revert}") }`, type: "error" });
    assert.throws(() => tokenUriFromCall(sncast), /revert reason: Out of gas, ENTRYPOINT_FAILED/);
    assert.throws(() => tokenUriFromCall(""), /empty input/);
  });

  test("split_page: the blocks of the example's page rebuild it byte for byte with preview", () => {
    const page = readFileSync(join(ROOT, "examples/beast_consumer/fixtures/animation.html"));
    const image = readFileSync(join(ROOT, "examples/beast_consumer/fixtures/image.svg"));
    const blocks = splitPage(page);
    assert.deepEqual(checkArt(blocks.art, image), { ok: true, lines: ["PASS the art contains no </script", "PASS the art block equals the image"] });
    const midi = join(dir, "midi.b64");
    writeFileSync(midi, blocks.midiB64 + "\n");
    const settings = settingsFromText("settings.txt", blocks.settings + "\n");
    assert.ok(buildPreview({ midiArg: midi, settings, svg: blocks.art }).html.equals(page));
    const unsafe = checkArt(Buffer.from("<svg><script></SCRIPT></svg>"), image);
    assert.equal(unsafe.ok, false);
    assert.match(unsafe.lines[0], /contains "<\/script" at byte 13/);
    assert.throws(() => splitPage(Buffer.from("<html></html>")), /not an onchain-midi-player page/);
  });

  test("an external-image token: the integrator-guide's second layout is valid, and the inspector handles it", () => {
    // The layout for an image that is not the art: members (with "image") and a comma, then the segment.
    const svg = renderSvg("Warlock", 1);
    const { d } = dFragment(MIDI, DEFAULT_SETTINGS);
    let head = '{"name":"x","image":"https://example.com/1.png",';
    head += " ".repeat((3 - (Buffer.byteLength(head) % 3)) % 3);
    let s = b64(svg) + '"';
    s += " ".repeat((3 - (s.length % 3)) % 3);
    const uri = JSON_PREFIX + b64(head) + segmentFor(pageHtml()) + b64(b64(d)) + b64(s) + "fQ==";
    const layers = decodeTokenUriLayers(uri);
    assert.deepEqual(Object.keys(layers.json), ["name", "image", "animation_url"]);
    assert.equal(layers.svgBytes, null);
    assert.equal(layers.htmlBytes.toString("latin1"), pageHtml() + d + svg);
    assert.throws(() => decodeTokenUri(uri), /image is not a base64 SVG data URI/);
    // decode.mjs writes no image.svg; split_page needs none; preview rebuilds the page from art.svg.
    const sub = mkdtempSync(join(dir, "external-"));
    writeFileSync(join(sub, "image.svg"), "<svg>an earlier token's image</svg>"); // must not survive
    const decode = spawnSync(process.execPath, [join(ROOT, "examples/beast_consumer/scripts/decode.mjs"), file(sub, "uri.txt", uri), sub], { encoding: "utf8" });
    assert.equal(decode.status, 0, decode.stderr);
    assert.match(decode.stdout, /image: "https:\/\/example\.com\/1\.png" \(not a base64 SVG data URI; not written\)/);
    assert.ok(!existsSync(join(sub, "image.svg")), "no image.svg, not even a stale one");
    assert.equal(splitRun([join(sub, "animation.html")], () => {}, () => {}), 0);
    const art = readFileSync(join(sub, "art.svg"));
    const settings = settingsFromText("settings.txt", readFileSync(join(sub, "settings.txt"), "utf8"));
    assert.ok(buildPreview({ midiArg: join(sub, "midi.b64"), settings, svg: art }).html.equals(readFileSync(join(sub, "animation.html"))));
  });

  test("split_page CLI: refuses to overwrite an input, and reports a differing image", () => {
    const page = readFileSync(join(ROOT, "examples/beast_consumer/fixtures/animation.html"));
    const sub = mkdtempSync(join(dir, "split-"));
    const pagePath = join(sub, "animation.html");
    const imagePath = join(sub, "art.svg"); // where the extracted art would be written by default
    writeFileSync(pagePath, page);
    writeFileSync(imagePath, "<svg>different</svg>");
    /** @type {string[]} */
    const out = [];
    /** @type {string[]} */
    const err = [];
    const quiet = { out: (/** @type {string} */ l) => out.push(l), err: (/** @type {string} */ l) => err.push(l) };
    assert.equal(splitRun([pagePath, imagePath], quiet.out, quiet.err), 2);
    assert.match(err[0], /would be overwritten by an output/);
    assert.equal(readFileSync(imagePath, "utf8"), "<svg>different</svg>", "the image is untouched");
    const outDir = mkdtempSync(join(sub, "out-"));
    assert.equal(splitRun([pagePath, imagePath, outDir], quiet.out, quiet.err), 1);
    assert.ok(out.some((l) => /^FAIL the art block \(\d+ bytes\) differs from the image \(20 bytes\)$/.test(l)), out.join("\n"));
    assert.ok(readFileSync(join(outDir, "art.svg")).equals(splitPage(page).art));
  });
});
