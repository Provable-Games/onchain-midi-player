// @ts-check
// Node tests for scripts/check_midi.mjs, the composer's MIDI check (README: "MIDI contract"): it
// passes valid files and the repository's fixtures, fails each class of invalid file with the page's
// own error, reads every form of input, and exits 0, 1 or 2. Also checks that the README's MIDI
// contract lists every error that checkMidi and decodeMidi can throw.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { checkScore, formatResult, scoresFromArg } from "./check_midi.mjs";
import { smf } from "./page_fixtures.mjs";

const SCRIPT = fileURLToPath(new URL("./check_midi.mjs", import.meta.url));
const path = (/** @type {string} */ p) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const read = (/** @type {string} */ p) => readFileSync(path(p));

const dir = mkdtempSync(join(tmpdir(), "check-midi-"));
after(() => rmSync(dir, { recursive: true, force: true }));
/** Writes a file into the test's temporary directory and returns its path. */
const file = (/** @type {string} */ name, /** @type {string | Uint8Array} */ data) => {
  const p = join(dir, name);
  writeFileSync(p, data);
  return p;
};
/** Runs the CLI. */
const cli = (/** @type {string[]} */ args, /** @type {string | undefined} */ input = undefined) =>
  spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8", input });

const EOT = [0xff, 0x2f, 0x00];
/**
 * Format 1, 96 ticks per quarter note, 120 BPM: a tempo track; channel 1 on program 33, two notes
 * (the second note-off by running status, as a note-on with velocity 0); channel 10, a kick and note
 * 90 (silent). End-of-Track at 384, 384 and 96: one pass is 384 ticks, 2 s.
 */
const SONG = smf({
  format: 1,
  ppq: 96,
  tracks: [
    [[0, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20], [384, ...EOT]],
    [[0, 0xc0, 33], [0, 0x90, 60, 100], [96, 0x80, 60, 0], [0, 0x90, 64, 100], [96, 64, 0], [192, ...EOT]],
    [[0, 0x99, 36, 100], [48, 0x99, 90, 100], [48, 0x89, 36, 0], [0, ...EOT]],
  ],
});
const SONG_B64 = SONG.toString("base64");
const SONG_REPORT = [
  "PASS song",
  "  89 bytes, format 1, 3 tracks, 96 ticks per quarter note",
  "  loop 2.000 s, maxTick 384 (the latest End-of-Track: the player loops there)",
  "  track 1: End-of-Track at tick 384, no channel events",
  "  track 2: End-of-Track at tick 384, 2 notes on channel 1",
  "  track 3: End-of-Track at tick 96, 2 notes on channel 10",
  "  channel 1: 2 notes, programs 33",
  "  channel 10 (drums): 2 notes, drum notes 36, 90 (silent, outside 35-81: 90)",
];

/** A format 0 file with one track around raw track bytes (End-of-Track included by the caller). */
const raw = (/** @type {number[]} */ body) =>
  Buffer.concat([Buffer.from("MThd"), Buffer.from([0, 0, 0, 6, 0, 0, 0, 1, 0, 96]), Buffer.from("MTrk"), Buffer.from([0, 0, body.length >> 8, body.length & 255]), Buffer.from(body)]);
const NOTE = [0x00, 0x90, 60, 100, 0x60, 0x80, 60, 0];
const END = [0x00, ...EOT];
const OK = raw([...NOTE, ...END]);
/** `buf` with `bytes` written at `at`. */
const patch = (/** @type {Buffer} */ buf, /** @type {number} */ at, /** @type {number[] | string} */ bytes) => {
  const out = Buffer.from(buf);
  Buffer.from(bytes).copy(out, at);
  return out;
};

describe("valid files", () => {
  test("a hand-built song passes, with its loop, maxTick, tracks and channels", () => {
    const r = checkScore({ label: "song", bytes: new Uint8Array(SONG) });
    assert.ok(r.ok);
    assert.equal(r.maxTick, 384);
    assert.equal(r.seconds, 2);
    assert.deepEqual(formatResult(r), SONG_REPORT);
  });

  test("a song without drums says channel 10 is not used", () => {
    const r = checkScore({ label: "ok", bytes: new Uint8Array(OK) });
    assert.deepEqual(formatResult(r).slice(-2), ["  channel 1: 1 note, no program change (program 0)", "  channel 10 (drums): not used"]);
  });

  test("every score of tests/fixtures/page.json passes, with the fixtures' maxTick and loop length", () => {
    const fixtures = JSON.parse(read("tests/fixtures/page.json").toString("utf8"));
    const scores = scoresFromArg(path("tests/fixtures/page.json"));
    assert.equal(scores.length, fixtures.valid.length + fixtures.invalid.length);
    fixtures.valid.forEach((/** @type {any} */ c, /** @type {number} */ i) => {
      const r = checkScore(scores[i]);
      assert.ok(r.ok, `${c.name}: ${!r.ok && r.error}`);
      assert.match(r.label, new RegExp(`: valid\\[${i}\\] ${c.name}$`));
      assert.deepEqual([r.maxTick, r.seconds], [c.midi_max_tick, c.midi_loop_seconds]);
    });
    for (const s of scores.slice(fixtures.valid.length)) assert.ok(checkScore(s).ok, s.label);
  });

  test("every form of input gives the same result", () => {
    /** @type {Array<[string, string]>} */
    const inputs = [
      [file("song.mid", SONG), "song.mid"],
      [file("song.data", SONG), "song.data"], // no known extension: starts with MThd
      [file("song.b64", SONG_B64 + "\n"), "song.b64"],
      [file("wrapped.txt", SONG_B64.replace(/.{76}/g, "$&\n") + "\n"), "wrapped.txt"], // as `base64` writes it
      [file("song.json", JSON.stringify([{ name: "genesis", midi_b64: SONG_B64 }])), "song.json: [0] genesis"], // the composer's midi.json shape
      [file("nested.json", JSON.stringify({ a: { b: [{ midi_b64: SONG_B64 }] } })), "nested.json: a.b[0]"],
      [SONG_B64, `base64 argument (${SONG_B64.length} characters)`],
    ];
    for (const [arg, label] of inputs) {
      const scores = scoresFromArg(arg);
      assert.equal(scores.length, 1, arg);
      const r = checkScore(scores[0]);
      assert.ok(r.label.endsWith(label), `${r.label} ends with ${label}`);
      assert.deepEqual(formatResult(r).slice(1), SONG_REPORT.slice(1), label);
    }
    for (const input of [SONG_B64, SONG_B64 + "\n", SONG_B64.replace(/.{76}/g, "$&\r\n")]) {
      const out = cli(["-"], input);
      assert.equal(out.status, 0);
      assert.equal(out.stdout, [SONG_REPORT[0].replace("song", "stdin"), ...SONG_REPORT.slice(1), ""].join("\n"));
    }
  });
});

describe("each failure class: FAIL with the page's error", () => {
  const vlqText = (/** @type {number} */ n) => [0x00, 0xff, 0x01, 0x80 | (n >> 7), n & 127, ...Array(n).fill(0x41)];
  /** @type {Array<[string, Buffer | string, string]>} the input (bytes, or base64 text), and the message */
  const cases = [
    ["RIFF instead of MThd", patch(OK, 0, "RIFF"), "not a Standard MIDI File"],
    ["format 2", smf({ format: 2, ppq: 96, tracks: [[[0, ...EOT]]] }), "format 2 is not supported"],
    ["format 0 with two tracks", smf({ ppq: 96, tracks: [[[96, ...EOT]], [[96, ...EOT]]] }), "bad track count"],
    ["SMPTE timing", smf({ ppq: 0xe728, tracks: [[[96, ...EOT]]] }), "SMPTE or zero time division is not supported"],
    ["a chunk that is not MTrk", patch(OK, 14, "MTrx"), "expected MTrk"],
    ["an MTrk length past the end of the file", patch(OK, 18, [0, 0, 1, 0]), "MTrk length past the end of the file"],
    ["no End-of-Track", raw(NOTE), "truncated"],
    ["a 5-byte delta time", raw([0x81, 0x81, 0x81, 0x81, 0x01, 0x90, 60, 100, ...END]), "bad variable-length number"],
    ["a byte after End-of-Track", raw([...NOTE, ...END, 0x00]), "End-of-Track is not at the end of its track"],
    ["a byte after the last track", Buffer.concat([OK, Buffer.from([0])]), "trailing bytes after the last track"],
    ["running status at the start of a track", raw([0x00, 60, 100, 0x60, 60, 0, ...END]), "running status without a channel status"],
    ["a data byte above 127", raw([0x00, 0x90, 60, 0xc8, ...END]), "bad data byte"],
    ["a 2-byte tempo", raw([0x00, 0xff, 0x51, 0x02, 0x07, 0xa1, ...NOTE, ...END]), "bad tempo"],
    ["a 4,097-byte text event", raw([...vlqText(4097), ...NOTE, ...END]), "text event longer than 4096 bytes"],
    ["SysEx split over two events", raw([0x00, 0xf0, 0x02, 0x7e, 0x7f, 0x00, 0xf7, 0x02, 0x09, 0xf7, ...NOTE, ...END]), "SysEx not complete in one event"],
    ["an F7 escape event", raw([0x00, 0xf7, 0x01, 0xfa, ...NOTE, ...END]), "SysEx continuation or escape (F7) events are not supported"],
    ["status byte F1", raw([0x00, 0xf1, 0x00, ...NOTE, ...END]), "unexpected status byte"],
    ["End-of-Track at tick 0", raw([0x00, 0x90, 60, 100, ...END]), "loop shorter than 50 ms"],
    ["base64 that is not strict", SONG_B64.slice(0, -1), "not base64"],
  ];

  for (const [label, input, message] of cases) {
    test(label, () => {
      const r = checkScore(typeof input === "string" ? { label, b64: input } : { label, bytes: new Uint8Array(input) });
      assert.ok(!r.ok);
      if (message === "not base64") {
        assert.equal(r.error, "midi: not base64");
        assert.deepEqual(formatResult(r), [`FAIL ${label}`, "  midi: not base64", "  size unknown (not base64)"]);
      } else {
        assert.match(r.error, new RegExp(`^midi: ${message.replace(/[()]/g, "\\$&")} \\(byte \\d+\\)$`));
        assert.deepEqual(formatResult(r), [`FAIL ${label}`, `  ${r.error}`, `  ${input.length} bytes`]);
      }
    });
  }

  test("a score given as base64 fails with the same error, and its decoded size", () => {
    const bad = raw([0x00, 60, 100, 0x60, 60, 0, ...END]);
    const r = checkScore({ label: "b64", b64: bad.toString("base64") });
    assert.deepEqual(formatResult(r), ["FAIL b64", "  midi: running status without a channel status (byte 24)", "  32 bytes"]);
  });

  test("the cases cover every error checkMidi and decodeMidi throw, and the README's MIDI contract lists each", () => {
    const src = read("player/player.js").toString("utf8");
    // fail("...") in checkMidi: a whole message, or the literal start of a computed one.
    const thrown = new Set([...src.matchAll(/fail\("([^"]*)"/g)].map((m) => m[1]));
    for (const m of src.matchAll(/new Error\("midi: ([^"]*)"\)/g)) thrown.add(m[1]);
    assert.ok(thrown.size >= 19, `found ${thrown.size} messages`);
    const readme = read("README.md").toString("utf8");
    const start = readme.indexOf("\n## MIDI contract\n");
    assert.ok(start >= 0, "README has a MIDI contract section");
    const contract = readme.slice(start, readme.indexOf("\n## ", start + 1));
    for (const text of thrown) {
      assert.ok(cases.some(([, , message]) => message.startsWith(text)), `a failure case throws "${text}"`);
      assert.ok(contract.includes("`" + text) || contract.includes("`midi: " + text + "`"), `the MIDI contract lists "${text}"`);
    }
    for (const [, , message] of cases) assert.ok([...thrown].some((text) => message.startsWith(text)), `"${message}" is thrown by the player`);
  });
});

describe("exit status", () => {
  const song = file("exit-song.mid", SONG);
  const bad = file("exit-bad.mid", raw(NOTE));

  test("0 when every score passes", () => {
    const one = cli([song]);
    assert.equal(one.status, 0);
    assert.equal(one.stdout.split("\n")[0], `PASS ${song}`);
    const fixtures = JSON.parse(read("tests/fixtures/page.json").toString("utf8"));
    const n = 1 + fixtures.valid.length + fixtures.invalid.length;
    const many = cli([song, path("tests/fixtures/page.json")]);
    assert.equal(many.status, 0);
    assert.ok(many.stdout.endsWith(`\n${n} scores: ${n} passed, 0 failed\n`), many.stdout.slice(-40));
    assert.equal(cli(["--help"]).status, 0);
  });

  test("1 when any score fails", () => {
    const out = cli([song, bad]);
    assert.equal(out.status, 1);
    assert.match(out.stdout, new RegExp(`\\nFAIL ${bad.replace(/[.\\]/g, "\\$&")}\\n  midi: truncated \\(byte 30\\)\\n  30 bytes\\n`));
    assert.match(out.stdout, /\n2 scores: 1 passed, 1 failed\n$/);
    // A base64 argument: "TVRoZA==" is just "MThd".
    assert.equal(cli(["TVRoZA=="]).status, 1);
    assert.equal(cli([file("broken.json", JSON.stringify({ name: "x", midi_b64: "TVRoZA" }))]).status, 1);
  });

  test("2 on a usage error or an input that cannot be read", () => {
    const usage = cli([]);
    assert.equal(usage.status, 2);
    assert.match(usage.stderr, /^usage: /);
    const missing = join(dir, "missing.mid");
    assert.match(cli([missing]).stderr, new RegExp(`^ERROR ${missing.replace(/[.\\]/g, "\\$&")}: no such file`));
    const notJson = file("not.json", "{ midi_b64: ");
    const noMidi = file("empty.json", JSON.stringify({ scores: [{ name: "x" }] }));
    const subdir = join(dir, "sub");
    mkdirSync(subdir);
    for (const arg of [missing, notJson, noMidi, subdir, "song"]) {
      const out = cli([arg]);
      assert.equal(out.status, 2, arg);
      assert.match(out.stderr, /^ERROR /, arg);
    }
  });

  test("2 wins over 1, and the other inputs are still checked", () => {
    const out = cli([join(dir, "missing.mid"), bad, song]);
    assert.equal(out.status, 2);
    assert.match(out.stdout, /^FAIL /m);
    assert.match(out.stdout, /^PASS /m);
  });
});
