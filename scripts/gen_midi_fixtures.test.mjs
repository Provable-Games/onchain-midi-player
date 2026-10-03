// @ts-check
// The synthetic MIDI scores: the committed file is what the generator produces, every score has
// its production size and structure, and the page's player accepts it.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { checkMidi } from "../player/player.js";
import { LOOP_SECONDS, PPQ, SCORES, SCORES_PATH, generate } from "./gen_midi_fixtures.mjs";

/** The production scores' sizes, in the order of tests/test_class_gas.cairo's `midi(1..5)`. */
const SIZES = [816, 1541, 2266, 2991, 3716];

test("tests/fixtures/midi/scores.json is up to date", () => {
  assert.equal(readFileSync(SCORES_PATH, "utf8"), generate().json, "run node scripts/gen_midi_fixtures.mjs");
});

test("generation is deterministic", () => {
  assert.equal(generate().json, generate().json);
});

/**
 * Parses a Standard MIDI File strictly, independently of the generator: every event must carry its
 * status byte, and only tempo, End-of-Track, note-on and note-off events may occur.
 * @param {Buffer} b
 */
function parse(b) {
  let p = 0;
  const u32 = () => (p += 4, b.readUInt32BE(p - 4));
  const u16 = () => (p += 2, b.readUInt16BE(p - 2));
  const vlq = () => {
    let v = 0;
    for (;;) {
      const c = b[p++];
      v = v * 128 + (c & 127);
      if (c < 128) return v;
    }
  };
  assert.equal(b.toString("latin1", p, (p += 4)), "MThd");
  assert.equal(u32(), 6);
  const header = { format: u16(), tracks: u16(), division: u16() };
  const tracks = [];
  for (let t = 0; t < header.tracks; t++) {
    assert.equal(b.toString("latin1", p, (p += 4)), "MTrk");
    const end = u32() + p;
    const track = { tempos: /** @type {number[]} */ ([]), notes: /** @type {Array<{tick: number, len: number, ch: number, vel: number}>} */ ([]), eot: -1 };
    let tick = 0;
    /** @type {Map<number, {tick: number, ch: number, vel: number}>} */
    const on = new Map();
    while (track.eot < 0) {
      tick += vlq();
      const st = b[p++];
      assert.ok(st >= 0x80, `track ${t}: running status at byte ${p - 1}`);
      if (st === 0xff) {
        const type = b[p++];
        const len = vlq();
        if (type === 0x51) {
          assert.equal(len, 3);
          track.tempos.push(b.readUIntBE(p, 3));
        } else {
          assert.equal(type, 0x2f, `track ${t}: unexpected meta event ${type}`);
          assert.equal(len, 0);
          track.eot = tick;
        }
        p += len;
      } else if ((st & 0xf0) === 0x90) {
        const [pitch, vel] = [b[p++], b[p++]];
        assert.ok(vel > 0, `track ${t}: note-on with velocity 0`);
        assert.ok(!on.has(pitch), `track ${t}: pitch ${pitch} already sounding`);
        on.set(pitch, { tick, ch: st & 15, vel });
      } else {
        assert.equal(st & 0xf0, 0x80, `track ${t}: unexpected status ${st}`);
        const [pitch, vel] = [b[p++], b[p++]];
        assert.equal(vel, 0x40, `track ${t}: note-off velocity`);
        const n = on.get(pitch);
        assert.ok(n && n.ch === (st & 15), `track ${t}: note-off without its note-on`);
        on.delete(pitch);
        track.notes.push({ tick: n.tick, len: tick - n.tick, ch: n.ch, vel: n.vel });
      }
    }
    assert.equal(p, end, `track ${t}: End-of-Track is not at the end of the chunk`);
    assert.equal(on.size, 0, `track ${t}: notes still sounding at End-of-Track`);
    tracks.push(track);
  }
  assert.equal(p, b.length, "bytes after the last track");
  return { header, tracks };
}

const { scores } = JSON.parse(readFileSync(SCORES_PATH, "utf8"));

test("one score per production size, with the tempo of the score it replaces", () => {
  assert.deepEqual(scores.map((/** @type {any} */ s) => s.bytes), SIZES);
  assert.deepEqual(scores.map((/** @type {any} */ s) => s.name), SCORES.map((s) => s.name));
  assert.deepEqual(scores.map((/** @type {any} */ s) => s.tempo_us), [455000, 500000, 500000, 500000, 455000]);
});

for (const s of scores) {
  test(`${s.name}: production structure, exact size, and the page plays it`, () => {
    const midi = Buffer.from(s.midi_b64, "base64");
    assert.equal(midi.length, s.bytes);
    assert.equal(createHash("sha256").update(midi).digest("hex"), s.sha256);

    const { header, tracks } = parse(midi);
    assert.deepEqual(header, { format: 1, tracks: 6, division: PPQ });
    // Track 0: the tempo and End-of-Track only, at tick 0.
    assert.deepEqual(tracks[0], { tempos: [s.tempo_us], notes: [], eot: 0 });
    let notes = 0;
    for (let v = 1; v <= 5; v++) {
      const t = tracks[v];
      assert.deepEqual(t.tempos, []);
      assert.ok(t.notes.length > 0, `voice ${v}: no notes`);
      for (const n of t.notes) {
        assert.equal(n.ch, v - 1, `voice ${v} on channel ${n.ch}`);
        assert.ok(n.tick % PPQ === 0 && n.len % PPQ === 0 && n.len > 0, `voice ${v}: note off the quarter-note grid`);
        assert.ok(n.vel >= 90 && n.vel <= 127, `voice ${v}: velocity ${n.vel}`);
      }
      const last = t.notes[t.notes.length - 1];
      assert.equal(t.eot, last.tick + last.len, `voice ${v}: End-of-Track right after the last note`);
      notes += t.notes.length;
    }
    assert.equal(notes, s.notes);

    const { maxTick, seconds } = checkMidi(midi);
    assert.equal(maxTick, Math.max(...tracks.map((t) => t.eot)));
    assert.ok(seconds >= LOOP_SECONDS.min && seconds <= LOOP_SECONDS.max, `loop of ${seconds} s`);
    assert.equal(s.duration_seconds, Math.round(seconds * 1000) / 1000);
  });
}
