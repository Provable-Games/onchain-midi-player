// @ts-check
// Node tests for the page's gunzip shim (player/gunzip.js): round trips against the pinned fflate and
// Node's zlib, deterministic output, every corruption and truncation of a payload, the optional gzip
// header fields, and gunzipScripts on a minimal fake document (including no tag at all). The
// minified shim as it runs in the page is tested end to end in player/player.test.js.

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, test } from "node:test";
import { crc32, gunzipSync as zlibGunzip, gzipSync as zlibGzip } from "node:zlib";
import { gzipSync } from "fflate";
import { gunzip, gunzipScripts } from "./gunzip.js";
import { gzipEngine, shimScript } from "../scripts/build_page.mjs";
import { engineSource } from "../scripts/engine.mjs";
import { SHIM_PIN, pageHtml, pageScripts, sha256 } from "../scripts/page.mjs";

const engine = Buffer.from(engineSource());
/** gunzip as a Buffer. */
const inflate = (/** @type {Uint8Array} */ gz) => Buffer.from(gunzip(gz));
/** Throws unless `fn` throws an Error whose message starts with "gunzip: ". */
const throwsGunzip = (/** @type {() => unknown} */ fn, /** @type {string} */ label) =>
  assert.throws(fn, (e) => e instanceof Error && e.message.startsWith("gunzip: "), label);

describe("gunzip: round trips", () => {
  const inputs = /** @type {Array<[string, Buffer]>} */ ([
    ["empty", Buffer.alloc(0)],
    ["one byte", Buffer.from("a")],
    ["the engine", engine],
    ["100 KB of random bytes (stored blocks)", randomBytes(100000)],
    ["300 KB of one byte (long matches, many blocks)", Buffer.alloc(300000, 0x41)],
    ["engine, random, engine", Buffer.concat([engine, randomBytes(70000), engine])],
  ]);
  for (const [label, data] of inputs) {
    test(`${label}: fflate levels 0-9 and zlib levels 1, 6, 9`, () => {
      for (let level = 0; level <= 9; level++) {
        const gz = gzipSync(data, { level: /** @type {0|1|2|3|4|5|6|7|8|9} */ (level), mtime: 0 });
        assert.ok(inflate(gz).equals(data), `fflate level ${level}`);
      }
      for (const level of [1, 6, 9]) assert.ok(inflate(zlibGzip(data, { level })).equals(data), `zlib level ${level}`);
    });
  }

  test("skips the optional header fields: FEXTRA, FNAME, FCOMMENT, FHCRC", () => {
    const data = Buffer.from("console.log('header fields');");
    const plain = zlibGzip(data);
    const extra = Buffer.from([4, 0, 0x41, 0x42, 0x43, 0x44]); // XLEN 4, then 4 bytes
    const name = Buffer.from("engine.js\0");
    const comment = Buffer.from("a comment\0");
    const header = Buffer.from(plain.subarray(0, 10));
    header[3] = 4 | 8 | 16 | 2;
    const fields = Buffer.concat([header, extra, name, comment]);
    const hcrc = Buffer.alloc(2);
    hcrc.writeUInt16LE(crc32(fields) & 0xffff);
    const gz = Buffer.concat([fields, hcrc, plain.subarray(10)]);
    assert.ok(inflate(gz).equals(data));
    assert.ok(zlibGunzip(gz).equals(data), "the crafted member is valid gzip");
    assert.ok(inflate(gzipSync(data, { filename: "engine.js" })).equals(data), "fflate's FNAME");
  });
});

describe("gunzip: deterministic output", () => {
  test("the build's payload is the same on every run, and is PAGE's", () => {
    const a = gzipEngine(engineSource());
    const b = gzipEngine(engineSource());
    assert.ok(a.equals(b));
    assert.ok(a.equals(pageScripts(pageHtml()).engineGzip));
  });

  test("the minified shim is the same on every build, and is the pinned one in PAGE", async () => {
    const a = await shimScript();
    const b = await shimScript();
    assert.equal(a, b);
    assert.equal(sha256(a), SHIM_PIN.sha256);
    assert.equal(a, pageScripts(pageHtml()).shim);
  });

  test("inflating twice gives the same bytes", () => {
    const gz = gzipSync(engine, { level: 9, mtime: 0 });
    assert.ok(inflate(gz).equals(inflate(gz)));
  });
});

describe("gunzip: corrupt and truncated payloads", () => {
  const data = Buffer.from(engineSource().slice(0, 4000));
  for (const level of /** @type {const} */ ([0, 9])) {
    const gz = gzipSync(data, { level, mtime: 0 });

    test(`level ${level}: no single-byte change ever gives other bytes; a changed trailer is always rejected`, () => {
      let harmless = 0;
      for (let i = 0; i < gz.length; i++) {
        for (const mask of [0x01, 0x80, 0xff]) {
          const bad = Buffer.from(gz);
          bad[i] ^= mask;
          if (i >= gz.length - 8) {
            throwsGunzip(() => inflate(bad), `trailer byte ${i} ^ ${mask}`);
            continue;
          }
          // Some bits are never read: the header's FTEXT and reserved flags, MTIME, XFL and OS
          // (unchecked, as in fflate), and deflate's padding bits. A change there is harmless.
          // Anything else is rejected (by inflation or the CRC-32), never inflated to other bytes.
          let out = null;
          try {
            out = inflate(bad);
          } catch (e) {
            assert.ok(e instanceof Error && e.message.startsWith("gunzip: "), `byte ${i} ^ ${mask}: ${e}`);
          }
          if (out) {
            assert.ok(out.equals(data), `byte ${i} ^ ${mask} inflated to other bytes`);
            harmless++;
          }
        }
      }
      assert.ok(harmless < 40, `${harmless} harmless changes`);
    });

    test(`level ${level}: every truncation is rejected`, () => {
      for (let n = 0; n < gz.length; n++) throwsGunzip(() => inflate(gz.subarray(0, n)), `first ${n} bytes`);
    });
  }

  test("exact messages: not gzip, a wrong CRC-32, a wrong length, a trailer size past deflate's maximum ratio", () => {
    const gz = gzipSync(data, { level: 9, mtime: 0 });
    assert.throws(() => inflate(Buffer.from("not gzip data")), { message: "gunzip: invalid gzip data" });
    const crc = Buffer.from(gz);
    crc[crc.length - 8] ^= 1;
    assert.throws(() => inflate(crc), { message: "gunzip: CRC-32 or length mismatch" });
    const len = Buffer.from(gz);
    len[len.length - 4] ^= 1;
    assert.throws(() => inflate(len), { message: "gunzip: CRC-32 or length mismatch" });
    const huge = Buffer.from(gz);
    huge.writeUInt32LE(0xffffffff, huge.length - 4);
    assert.throws(() => inflate(huge), { message: "gunzip: invalid gzip data" });
    // A reserved block type (BTYPE 3).
    const bt3 = Buffer.from(gz);
    bt3[10] |= 6;
    assert.throws(() => inflate(bt3), { message: "gunzip: invalid block type" });
  });
});

describe("gunzipScripts", () => {
  /**
   * Runs gunzipScripts against a minimal document holding `tags` (src attributes of gzip tags).
   * @param {string[]} srcs
   */
  function run(srcs) {
    /** @type {Array<{type: string, src: string, replacedBy?: {textContent: string}}>} */
    const tags = srcs.map((src) => ({ type: "text/javascript+gzip", src }));
    /** @type {string[]} */
    const logged = [];
    /** @type {string[]} */
    const selectors = [];
    const g = /** @type {any} */ (globalThis);
    const saved = { document: g.document, error: console.error };
    g.document = {
      querySelectorAll: (/** @type {string} */ s) => {
        selectors.push(s);
        return tags.map((t) => ({
          getAttribute: (/** @type {string} */ name) => (name === "src" ? t.src : null),
          replaceWith: (/** @type {{textContent: string}} */ el) => { t.replacedBy = el; },
        }));
      },
      createElement: (/** @type {string} */ tag) => {
        assert.equal(tag, "script");
        return { textContent: "" };
      },
    };
    console.error = (/** @type {any} */ e) => logged.push(String(e.message || e));
    try {
      gunzipScripts();
    } finally {
      g.document = saved.document;
      console.error = saved.error;
    }
    return { tags, logged, selectors };
  }
  const src = (/** @type {Uint8Array} */ gz) => "data:text/javascript;base64," + Buffer.from(gz).toString("base64");

  test("no gzip tag: nothing is inserted and nothing is logged", () => {
    const { tags, logged, selectors } = run([]);
    assert.deepEqual(tags, []);
    assert.deepEqual(logged, []);
    assert.deepEqual(selectors, ['script[type="text/javascript+gzip"]']);
  });

  test("each tag is replaced by a script holding its inflated source; a bad one is logged and kept", () => {
    const good = src(gzipSync(Buffer.from("var a = 1;"), { mtime: 0 }));
    const { tags, logged } = run([good, "data:text/javascript;base64,@@@", src(Buffer.from("not gzip")), src(zlibGzip("var b = 2;"))]);
    assert.equal(tags[0].replacedBy?.textContent, "var a = 1;");
    assert.equal(tags[1].replacedBy, undefined);
    assert.equal(tags[2].replacedBy, undefined);
    assert.equal(tags[3].replacedBy?.textContent, "var b = 2;");
    assert.equal(logged.length, 2);
    assert.equal(logged[1], "gunzip: invalid gzip data");
  });
});
