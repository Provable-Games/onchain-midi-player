// @ts-nocheck
// The isolated image's GIF timed to the music (art_sync.js: beatSeconds, frameUs, retimeGif,
// gifStarts, and restartImgOnPass's `beat`). Delay vectors are those of the renderer-side
// prototype (Beasts branch feat/tempo-timed-gifs, gif_tempo_tests.cairo), whose single loop this
// keeps; pixels are compared with the tests' own decoder (gif_decode.mjs).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { beatSeconds, frameUs, retimeGif, gifFrames, gifStarts, restartImgOnPass, RETIME_COPIES, RETIME_TARGET_US } from "../art_sync.js";
import { checkMidi } from "../../../player/player.js";
import { riff } from "../../../scripts/data_cases.mjs";
import { decodeGif } from "./gif_decode.mjs";

// 1x1 frames, alternating red and blue, each with its own Graphic Control Extension (transparency
// on, `disposal`), looping forever unless `loop` is false. Each frame's transparent index (2 + i,
// a colour no pixel uses) tells the frames apart.
const gce = (cs, disposal = 2, i = 0) => [33, 249, 4, (disposal << 2) | 1, cs & 255, cs >> 8, 2 + i, 0];
const image = (i, rect = [0, 0, 1, 1]) => [44, ...rect.flatMap((v) => [v & 255, v >> 8]), 0, 2, 2, i % 2 ? 76 : 68, 1, 0];
const gifOf = (delays, { disposal = 2, loop = true, size = 1 } = {}) => Uint8Array.from([71, 73, 70, 56, 57, 97, size & 255, size >> 8, size & 255, size >> 8, 128, 0, 0, 204, 0, 0, 0, 0, 204,
  ...(loop ? [33, 255, 11, ...Buffer.from("NETSCAPE2.0"), 3, 1, 0, 0, 0] : []), ...delays.flatMap((d, i) => [...gce(d, disposal, i), ...image(i, [0, 0, size, size])]), 59]);
const cs = (b) => gifFrames(b).frames.map((f) => f.delay / 10);
const WARLOCK = (() => {
  const svg = readFileSync(new URL("../../../tests/fixtures/beasts/warlock_shiny_animated.svg", import.meta.url), "utf8");
  return new Uint8Array(Buffer.from(/data:image\/gif;base64,([A-Za-z0-9+/]+=*)/.exec(svg)[1], "base64"));
})();
const beat = (tempoUs) => tempoUs / 1e6;

test("beatSeconds: the pass times ticks per beat over the pass's ticks, each MIDI's tempo", () => {
  for (const [ppq, us] of [[96, 500000], [480, 455000], [96, 375000], [384, 300000], [960, 666667], [24, 1000000]]) {
    const midi = new Uint8Array(riff({ ppq, us, bars: 2 })), { maxTick, seconds } = checkMidi(midi);
    const got = beatSeconds({ passSeconds: seconds, maxTick }, midi);
    assert.ok(Math.abs(got - us / 1e6) < 1e-12, `${ppq} ppq at ${us} µs: ${got}`);
    assert.equal(frameUs(Math.round(got * 1e6)), frameUs(us), "the frame step of the MIDI's own tempo");
  }
  // A tempo change: the average beat over the pass.
  const midi = new Uint8Array(riff({ ppq: 96, us: 500000, bars: 1 }));
  assert.equal(beatSeconds({ passSeconds: 3, maxTick: 96 * 4 }, midi), 0.75);
});
test("beatSeconds: null without a status, a pass or ticks, a MThd header, or with SMPTE time or a result that is not a positive number", () => {
  const midi = new Uint8Array(riff({ ppq: 96, us: 500000 })), s = { passSeconds: 2, maxTick: 384 };
  assert.equal(beatSeconds(s, midi), 0.5);
  const header = (at, ...v) => { const m = Uint8Array.from(midi); m.set(v, at); return m; };
  for (const [label, status, bytes] of [
    ["null status", null, midi], ["undefined status", undefined, midi], ["no pass", { ...s, passSeconds: null }, midi],
    ["a zero pass", { ...s, passSeconds: 0 }, midi], ["maxTick 0", { ...s, maxTick: 0 }, midi], ["no maxTick", { ...s, maxTick: null }, midi],
    ["no MIDI", s, null], ["a short header", s, midi.subarray(0, 13)], ["RIFF, not MThd", s, header(0, 82, 73, 70, 70)],
    ["SMPTE: -25 fps, 40 ticks per frame", s, header(12, 0xe7, 0x28)], ["zero ticks per beat", s, header(12, 0, 0)],
    ["an infinite pass", { ...s, passSeconds: Infinity }, midi], ["NaN ticks", { ...s, maxTick: NaN }, midi], ["a negative pass", { ...s, passSeconds: -2 }, midi],
  ]) assert.equal(beatSeconds(status, bytes), null, label);
});

test("frameUs: the eighth note, or the beat itself when the eighth is under 0.2 s (above 150 BPM), as the Sound Check", () => {
  assert.equal(frameUs(500000), 250000); // 120 BPM
  assert.equal(frameUs(455000), 227500); // 131.87 BPM
  assert.equal(frameUs(400000), 200000); // exactly 150 BPM: still the eighth
  assert.equal(frameUs(399999), 399999); // just above: the quarter
  assert.equal(frameUs(300000), 300000); // 200 BPM
  assert.equal(frameUs(666667), 333334); // the eighth rounds half up
  assert.equal(frameUs(1), 1);
  assert.equal(frameUs(16777215), 8388608);
  // beast-sound-check tools/art.mjs, verbatim (it also takes the frame count, unused).
  const soundCheck = (n, tempoUs) => (tempoUs / 2 < 200000 ? tempoUs : Math.round(tempoUs / 2));
  for (let us = 150000; us <= 1500000; us += 997) assert.equal(frameUs(us), soundCheck(4, us), `${us} µs`);
});

test("retimeGif: even frames take one step each, the rounding carried over cumulative time (one loop, no pass)", () => {
  const even = [20, 20, 20, 20];
  assert.deepEqual(cs(retimeGif(gifOf(even), beat(500000))), [25, 25, 25, 25]);
  assert.deepEqual(cs(retimeGif(gifOf(even), beat(455000))), [23, 23, 22, 23]); // 131.87 BPM: 227.5 ms steps
  assert.deepEqual(cs(retimeGif(gifOf(even), beat(375000))), [38, 37, 38, 37]);
  assert.deepEqual(cs(retimeGif(gifOf(even), beat(300000))), [30, 30, 30, 30]);
  assert.deepEqual(cs(retimeGif(gifOf([25, 25, 25]), beat(666667))), [33, 34, 33]);
});
test("retimeGif: uneven frames keep long holds in whole steps", () => {
  assert.deepEqual(cs(retimeGif(gifOf([20, 40, 20, 20, 20]), beat(500000))), [25, 50, 25, 25, 25]); // Nephilim: 1, 2, 1, 1, 1 steps
  assert.deepEqual(cs(retimeGif(gifOf([20, 10, 10, 10, 20, 20]), beat(500000))), [25, 25, 25, 25, 25, 25]); // Cyclops
  assert.deepEqual(cs(retimeGif(gifOf([10, 20, 20, 20]), beat(500000))), [25, 25, 25, 25]); // Giant
  assert.deepEqual(cs(retimeGif(gifOf([10, 60, 10]), beat(500000))), [25, 50, 25]);
  assert.deepEqual(cs(retimeGif(gifOf([10, 10, 10, 90]), beat(500000))), [25, 25, 25, 75]);
  assert.deepEqual(cs(retimeGif(gifOf([0, 0]), beat(500000))), [25, 25], "0 cs, shown as 100 ms: one step each");
});
test("retimeGif: delays are never under 2 cs, nor over the field's 65,535", () => {
  assert.deepEqual(cs(retimeGif(gifOf([20, 20]), beat(1))), [2, 2]);
  assert.deepEqual(cs(retimeGif(gifOf([20, 20, 20]), beat(15000))), [2, 2, 2]);
  assert.deepEqual(cs(retimeGif(gifOf([20, 20]), beat(16777215))), [839, 839]);
  assert.deepEqual(cs(retimeGif(gifOf([65535, 655]), 1e4)), [65535, 65535], "a 5000 s step, clamped");
});
test("retimeGif: within one loop every frame change is within half a centisecond of the step grid (50 to 240 BPM)", () => {
  const patterns = [[20, 40, 20, 20, 20], [20, 10, 10, 10, 20, 20], [10, 20, 20, 20], ...[2, 3, 4, 5, 6, 7, 8].map((n) => Array(n).fill(20))];
  for (let us = 250000; us <= 1200000; us += 23813) for (const pattern of patterns) {
    const out = retimeGif(gifOf(pattern), beat(us)), n = pattern.length, total = pattern.reduce((a, b) => a + b);
    const steps = pattern.map((d) => Math.max(1, Math.round((n * d) / total))), step = frameUs(us);
    let t = 0, s = 0;
    cs(out).forEach((d, i) => { assert.ok(d >= 2); t += d * 1e4; s += steps[i]; assert.ok(Math.abs(t - s * step) <= 5000, `${us} µs, ${pattern}: frame ${i}`); });
  }
});

/** The worst distance (µs) of a retimed GIF's frame changes from the beat grid over a pass, playing it on from `at`. */
function drift(out, pattern, beatS, pass) {
  const n = pattern.length, total = pattern.reduce((a, b) => a + b), steps = pattern.map((d) => Math.max(1, Math.round((n * d) / total)));
  const step = frameUs(Math.round(beatS * 1e6)), frames = gifFrames(out).frames;
  let t = 0, s = 0, worst = 0;
  for (let i = 0; t < pass * 1e6; i++) {
    t += frames[i % frames.length].delay * 1000; s += steps[i % n];
    if (t <= pass * 1e6) worst = Math.max(worst, Math.abs(t - s * step));
  }
  return worst;
}
test("retimeGif: repeating the frames keeps every frame change within 10 ms of the beat over a whole pass (50-240 BPM, 64-128 beats)", () => {
  const patterns = [[20, 20], [20, 20, 20], [20, 20, 20, 20], [20, 20, 20, 20, 20], [20, 20, 20, 20, 20, 20], [20, 40, 20, 20, 20], [20, 10, 10, 10, 20, 20], [10, 20, 20, 20], [25, 25, 25]];
  let worst = 0, most = 0, cases = 0;
  for (let bpm = 50; bpm <= 240; bpm += 0.73) for (const pattern of patterns) for (const beats of [64, 96, 128]) {
    const b = 60 / bpm, out = retimeGif(gifOf(pattern), b, beats * b), copies = gifFrames(out).frames.length / pattern.length;
    assert.ok(Number.isInteger(copies) && copies <= RETIME_COPIES);
    const d = drift(out, pattern, b, beats * b);
    assert.ok(d <= 10000, `${bpm.toFixed(2)} BPM, ${pattern}, ${beats} beats: ${(d / 1000).toFixed(2)} ms`);
    worst = Math.max(worst, d); most = Math.max(most, copies); cases++;
  }
  // The one loop alone would drift: 4 frames at 129.32 BPM over 128 beats.
  const b = 60 / 129.32, one = retimeGif(gifOf([20, 20, 20, 20]), b);
  assert.ok(drift(one, [20, 20, 20, 20], b, 128 * b) > 10000, "a single loop drifts past 10 ms");
  console.log(`# ${cases} tempo/frames/pass cases: worst frame change ${(worst / 1000).toFixed(2)} ms from the beat, at most ${most} copies (target ${RETIME_TARGET_US / 1000} ms)`);
});
test("retimeGif: a loop the centiseconds hold exactly is not repeated", () => {
  const b = beat(455000); // 4 steps of 227.5 ms: 91 cs
  assert.deepEqual(cs(retimeGif(gifOf([20, 20, 20, 20]), b, 128 * b)), [23, 23, 22, 23]);
  assert.deepEqual(cs(retimeGif(gifOf([20, 20, 20]), b, 128 * b)), [23, 23, 22, 23, 23, 23, 22, 23, 23, 23, 22, 23], "3 steps: 4 copies, 273 cs");
});

const pixels = (b) => decodeGif(b).frames.map((f) => Buffer.from(f.rgba).toString("hex"));
/** For each frame of `out`, the frame of `b` it copies (by its bytes after the delay). */
const sources = (b, out) => {
  const key = (x, f) => Buffer.from(x.subarray(f.start + 6, f.end)).toString("hex") + (x[f.start + 3] & 1);
  const own = gifFrames(b).frames.map((f) => key(b, f));
  return gifFrames(out).frames.map((f) => own.indexOf(key(out, f)));
};
/** The bytes of each frame with its delay zeroed and its disposal bits cleared. */
const stripped = (x) => gifFrames(x).frames.map((f) => { const c = Buffer.from(x.subarray(f.start, f.end)); c[3] &= 1; c[4] = c[5] = 0; return c.toString("hex"); });
test("retimeGif: only the delays change, and repetition: the frames' bytes and pixels are the original's", () => {
  for (const [label, b] of [["even, disposal 2", gifOf([20, 20, 20, 20])], ["uneven", gifOf([20, 40, 20, 20, 20])], ["Warlock (shiny)", WARLOCK]]) {
    const bt = 60 / 129.32, out = retimeGif(b, bt, 128 * bt), src = sources(b, out), before = pixels(b), after = pixels(out);
    assert.ok(out.length > b.length && src.every((i, k) => i == k % gifFrames(b).frames.length), `${label}: repeated in order`);
    assert.deepEqual(Buffer.from(out.subarray(0, gifFrames(out).frames[0].start)), Buffer.from(b.subarray(0, gifFrames(b).frames[0].start)), `${label}: head, colours and loop extension`);
    assert.deepEqual(stripped(out), src.map((i) => stripped(b)[i]), `${label}: frame bytes`);
    assert.deepEqual(after, src.map((i) => before[i]), `${label}: every frame's pixels`);
    assert.equal(out.at(-1), 59);
  }
  // One loop: byte for byte apart from the delays.
  const one = retimeGif(gifOf([20, 20, 20, 20]), beat(455000));
  assert.deepEqual(Buffer.from(one), Buffer.from(gifOf([23, 23, 22, 23])));
});
test("retimeGif: a last frame that leaves pixels the first would show through restores its area at a seam (disposal 2): browsers clear at each loop", () => {
  const out = retimeGif(WARLOCK, 60 / 129.32, 128 * 60 / 129.32), g = gifFrames(out);
  assert.deepEqual(gifFrames(WARLOCK).frames.map((f) => f.disposal), [2, 2, 2, 1]);
  assert.ok(g.frames.length > 4 && g.frames.every((f, i) => f.disposal == 2), "every copy's last frame now 2");
  // Negative control: the repeated GIF with the original disposal shows the last frame through the next copy's first.
  const unpatched = Uint8Array.from(out);
  g.frames.forEach((f, i) => { if (i % 4 == 3) unpatched[f.start + 3] = (unpatched[f.start + 3] & ~28) | 4; });
  const before = pixels(WARLOCK);
  assert.notDeepEqual(pixels(unpatched).slice(4, 8), before, "without it, frame 0 of the second copy differs");
  assert.deepEqual(pixels(out).slice(4, 8), before);
  // Not needed: a GIF whose loop ends clear keeps every disposal.
  assert.ok(gifFrames(retimeGif(gifOf([20, 20, 20]), 60 / 129.32, 60)).frames.every((f) => f.disposal == 2));
});

test("retimeGif with `at`: the loop starts on the frame the beat grid shows then, shortened to fit, and the rest of it ends the loop", () => {
  const b = beat(455000), pass = 128 * b, even = gifOf([20, 20, 20, 20]); // steps of 22.75 cs, loop 91 cs
  // 0.3 s into the pass: frame 1 (22.75-45.5 cs), 15.5 cs of it left.
  const out = retimeGif(even, b, pass, 0.3);
  assert.deepEqual(sources(even, out), [1, 2, 3, 0, 1]);
  assert.deepEqual(cs(out), [16, 22, 23, 23, 7], "ends 15.5, 38.25, 61, 83.75 and 91 cs from the start, to the nearest");
  assert.equal(cs(out).reduce((a, c) => a + c), 91, "the loop's length");
  // Later passes of the loop: the position wraps; a whole pass later, the same.
  assert.deepEqual(cs(retimeGif(even, b, pass, 0.3 + 0.91 * 7)), cs(out));
  // At the pass's start, or exactly on a frame change: no rotation needed or the frame whole.
  assert.deepEqual(cs(retimeGif(even, b, pass, 0)), [23, 23, 22, 23]);
  assert.deepEqual(sources(even, retimeGif(even, b, pass, 0.455)), [2, 3, 0, 1]);
  // Under 1 cs of a frame left: the next frame starts that much early.
  const late = retimeGif(even, b, pass, 0.2224);
  assert.deepEqual(sources(even, late), [1, 2, 3, 0], "frame 0 had 0.51 cs left: dropped; its rest is the whole frame");
  assert.deepEqual(cs(late), [23, 23, 23, 22], "ends 23.26, 46.01, 68.76 and 91 cs");
  // The rest of the first frame under 1 cs: the frame before it lasts to the loop's end; under 2 cs: 2 cs.
  const tail = retimeGif(even, b, pass, 0.2325);
  assert.deepEqual(sources(even, tail), [1, 2, 3, 0], "frame 1 shortened to 22 cs; its 0.5 cs rest merged into frame 0");
  assert.deepEqual(cs(tail), [22, 23, 23, 23]);
  const two = retimeGif(even, b, pass, 0.2425);
  assert.deepEqual(sources(even, two), [1, 2, 3, 0, 1], "1.5 cs of frame 1 before: 2 cs of it end the loop");
  assert.deepEqual(cs(two), [21, 23, 23, 22, 2], "ends 21.25, 44, 66.75, 89 (89.5, 2 cs early) and 91");
  // Every frame of the rotated loop still lands within 10 ms of the grid over the rest of the pass.
  for (let at = 0; at < 3; at += 0.0371) {
    const r = retimeGif(even, b, pass, at), frames = gifFrames(r).frames, src = sources(even, r), q = (at * 1e6) % (4 * 227500), first = Math.floor(q / 227500);
    let t = 0, worst = 0;
    for (let i = 0; t < pass * 1e6 - at * 1e6; i++) {
      // Each frame change against the nearest change of the grid, whole steps from the pass's start
      // (the loop's end inside the first frame changes nothing).
      t += frames[i % frames.length].delay * 1000;
      if (src[i % src.length] != src[(i + 1) % src.length]) worst = Math.max(worst, Math.abs(t - (Math.round((t + q) / 227500) * 227500 - q)));
    }
    assert.ok(worst <= 10000, `at ${at.toFixed(4)} s (frame ${first}): ${(worst / 1000).toFixed(2)} ms`);
  }
});
test("retimeGif with `at`: rotation keeps every frame's pixels (Warlock, shiny, every start)", () => {
  const before = pixels(WARLOCK), b = 60 / 131.87;
  const firsts = new Set();
  for (let at = 0.05; at < 2; at += 0.1137) {
    const out = retimeGif(WARLOCK, b, 64 * b, at), src = sources(WARLOCK, out);
    firsts.add(src[0]);
    assert.deepEqual(pixels(out), src.map((i) => before[i]), `at ${at}: frames ${src}`);
  }
  assert.deepEqual([...firsts].sort(), [0, 1, 2, 3], "starting on each frame");
});
test("retimeGif with `at`: a frame drawn over the frames before it is not a start: the loop starts from frame 0 instead", () => {
  // On 2x2: frame 0 covers the screen and stays (disposal 1); frame 1 draws a corner over it and
  // clears that corner (2); frame 2 covers the screen and clears it (2), so the loop ends clear.
  const b = Uint8Array.from([71, 73, 70, 56, 57, 97, 2, 0, 2, 0, 128, 0, 0, 204, 0, 0, 0, 0, 204, 33, 255, 11, ...Buffer.from("NETSCAPE2.0"), 3, 1, 0, 0, 0,
    ...gce(20, 1, 0), ...image(0, [0, 0, 2, 2]), ...gce(20, 2, 1), ...image(1, [0, 0, 1, 1]), ...gce(20, 2, 2), ...image(2, [0, 0, 2, 2]), 59]);
  assert.deepEqual(gifStarts(gifFrames(b)), [true, false, false, true]);
  const t = beat(500000), pass = 64 * t; // 250 ms steps, a 75 cs loop
  for (const at of [0.3, 0.6]) {
    const out = retimeGif(b, t, pass, at);
    assert.deepEqual(sources(b, out), [0, 1, 2], `${at} s: frame ${Math.floor(at / 0.25)}, not a start: from frame 0`);
    assert.deepEqual(cs(out), [25, 25, 25]);
  }
  const start = retimeGif(b, t, pass, 0.1); // frame 0, a start: 15 cs of it, then its first 10 cs ending the loop
  assert.deepEqual(sources(b, start), [0, 1, 2, 0]); assert.deepEqual(cs(start), [15, 25, 25, 10]);
  assert.deepEqual(pixels(start), sources(b, start).map((i) => pixels(b)[i]));
  // Opaque frames covering the screen draw regardless of what is under them: a start.
  const opaque = Uint8Array.from(b); gifFrames(opaque).frames.forEach((f) => (opaque[f.start + 3] &= ~1));
  assert.deepEqual(gifStarts(gifFrames(opaque)), [true, false, true, true], "frame 1 is still a corner over frame 0");
  // A last frame that leaves pixels where the canvas was not clear cannot be made to end clear: one loop, from frame 0.
  const stuck = Uint8Array.from(b); stuck[gifFrames(stuck).frames[2].start + 3] = (1 << 2) | 1; stuck.set([1, 0, 1, 0], gifFrames(stuck).frames[2].start + 8 + 5);
  assert.deepEqual(gifStarts(gifFrames(stuck)), [true, false, false, false]);
  assert.deepEqual(sources(stuck, retimeGif(stuck, 60 / 129.32, 128 * 60 / 129.32, 0.1)), [0, 1, 2]);
});
test("retimeGif: a GIF played a set number of times keeps its loop: neither repeated nor rotated", () => {
  const b = gifOf([20, 20, 20]); b[35] = 2; // the loop extension's count: 3 plays
  const t = 60 / 129.32, out = retimeGif(b, t, 128 * t, 0.3);
  assert.deepEqual(sources(b, out), [0, 1, 2]);
  assert.equal(gifFrames(out).plays, 3);
  const once = gifOf([20, 20, 20], { loop: false });
  assert.deepEqual(sources(once, retimeGif(once, t, 128 * t, 0.3)), [0, 1, 2]);
});
test("retimeGif: the repetition stops at RETIME_PIXELS of frames: a large GIF is one loop", () => {
  const big = gifOf([20, 20, 20, 20], { size: 600 }), t = 60 / 129.32;
  assert.equal(gifFrames(retimeGif(big, t, 128 * t)).frames.length, 4);
});
test("retimeGif: null for what it cannot read or time", () => {
  const b = gifOf([20, 20]), t = beat(500000);
  const noGce = Uint8Array.from([...b.subarray(0, 38), ...image(0), ...b.subarray(38)]);
  assert.ok(gifFrames(noGce), "a frame without its own GCE");
  for (const [label, bytes, bt] of [
    ["not a GIF", Uint8Array.from([1, 2, 3]), t], ["truncated", b.subarray(0, b.length - 1), t], ["empty", new Uint8Array(), t],
    ["one frame", gifOf([20]), t], ["a frame without its own GCE", noGce, t],
    ["no beat", b, 0], ["NaN beat", b, NaN], ["negative beat", b, -0.5], ["null beat", b, null],
  ]) assert.equal(retimeGif(bytes, bt, 10), null, label);
  for (let cut = 13; cut < b.length; cut += 3) assert.equal(retimeGif(b.subarray(0, cut), t), null, `truncated at ${cut}`);
});

// restartImgOnPass with `beat`: each restart shows the art with its GIF retimed.
const ART = (gif) => "data:image/svg+xml;base64," + Buffer.from(`<svg xmlns='http://www.w3.org/2000/svg'><image href='data:image/gif;base64,${Buffer.from(gif).toString("base64")}'/></svg>`).toString("base64");
const tick = () => new Promise((r) => setImmediate(r));
function harness(src, { beat: bt = () => 0.455, still } = {}) {
  const status = { runId: 1, state: "playing", audioState: "running", passSeconds: 58.24, positionSeconds: 0, audioTime: 1 }, passes = new Set(), states = new Set(), page = [], created = [], visibility = new Set();
  const player = { getPlayStatus: () => ({ ...status }), onPassStart(fn) { passes.add(fn); return () => passes.delete(fn); }, onStateChange(fn) { states.add(fn); return () => states.delete(fn); } };
  const doc = { hidden: false, createElement() { const el = image_(); created.push(el); return el; }, addEventListener(type, fn) { visibility.add(fn); }, removeEventListener(type, fn) { visibility.delete(fn); } };
  function image_(attributes = []) { return { attributes, ownerDocument: doc, src: "", setAttribute() {}, replaceWith(o) { page[0] = o; }, load() { this.onload?.(); }, fail() { this.onerror?.(); } }; }
  const first = Object.assign(image_(), { src }); page.push(first);
  const stills = [];
  const dispose = restartImgOnPass(first, player, { beat: bt, still: still ?? ((svg, ms) => (stills.push({ svg, ms }), Promise.resolve(svg.replace("</svg>", "<g/></svg>")))) });
  return { status, page, created, stills, dispose, doc, visibility, pass() { for (const fn of [...passes]) fn({ runId: status.runId }); } };
}
const gifIn = (src) => { const i = src.indexOf(","), svg = Buffer.from(src.slice(i + 1), "base64").toString("latin1"); const m = /data:image\/gif;base64,([A-Za-z0-9+/]+=*)/.exec(svg); return m && new Uint8Array(Buffer.from(m[1], "base64")); };
test("restartImgOnPass with a beat: each pass restart shows the art with its GIF retimed from frame 0, the rest of the art unchanged", () => {
  const even = gifOf([20, 20, 20, 20]), h = harness(ART(even));
  h.pass(); const [a] = h.created;
  assert.match(a.src, /^data:image\/svg\+xml;r=1;base64,/);
  assert.deepEqual(cs(gifIn(a.src)), [23, 23, 22, 23]);
  const text = (src) => Buffer.from(src.slice(src.indexOf(",") + 1), "base64").toString("latin1").replace(/data:image\/gif;base64,[A-Za-z0-9+/=]+/, "GIF");
  assert.equal(text(a.src), text(ART(even)), "the art around the GIF, byte for byte");
  // No beat, art without a GIF, or a GIF it cannot time: the plain restart, as before.
  for (const [src, bt] of [[ART(even), () => null], [ART(gifOf([20])), undefined], ["data:image/svg+xml;base64," + Buffer.from("<svg/>").toString("base64"), undefined]]) {
    const p = harness(src, { beat: bt }); p.pass(); assert.equal(p.created[0].src, src.replace(";base64,", ";r=1;base64,"));
  }
  // A beat that throws leaves the plain restart too.
  const t = harness(ART(even), { beat: () => { throw Error("no"); } }); t.pass(); assert.equal(t.created[0].src, ART(even).replace(";base64,", ";r=1;base64,"));
});
test("restartImgOnPass with a beat: pause stills the retimed GIF shown; play restarts it from where the music is", async () => {
  const even = gifOf([20, 20, 20, 20]), h = harness(ART(even));
  h.pass(); h.created[0].load();
  h.status.audioTime = 1.3; h.dispose.pause(); await tick();
  assert.equal(h.stills.length, 1); assert.deepEqual(cs(new Uint8Array(Buffer.from(/base64,([A-Za-z0-9+/=]+)'/.exec(h.stills[0].svg)[1], "base64"))), [23, 23, 22, 23], "the still is of the GIF shown");
  assert.ok(Math.abs(h.stills[0].ms - 300) < 1e-6);
  h.created[1].load();
  // Resume 0.3 s into the pass (+ the display lead): frame 1, shortened.
  h.status.positionSeconds = 0.3 - 0.017; h.dispose.play();
  const restart = h.created[2], gif = gifIn(restart.src);
  assert.deepEqual(sources(even, gif), [1, 2, 3, 0, 1]); assert.deepEqual(cs(gif), [16, 22, 23, 23, 7]);
  restart.load(); assert.equal(h.page[0], restart);
  // The next pause stills that GIF: its own first frame is frame 1.
  h.status.audioTime = 1.4; h.dispose.pause(); await tick();
  assert.ok(h.stills[1].svg.includes(Buffer.from(gif).toString("base64")));
  // Stop restarts a shown still from frame 0.
  h.created[3].load(); h.dispose.stop(); assert.deepEqual(sources(even, gifIn(h.created[4].src)), [0, 1, 2, 3]);
});
test("restartImgOnPass with a beat: a retimed image that played on through a pause whose still never showed restarts where the music is on play", async () => {
  const even = gifOf([20, 20, 20, 20]), h = harness(ART(even));
  h.pass(); h.created[0].load(); h.dispose.pause(); await tick();
  h.status.positionSeconds = 0.3 - 0.017; h.dispose.play();
  assert.equal(h.created.length, 3, "the still dropped, a restart"); assert.deepEqual(sources(even, gifIn(h.created[2].src))[0], 1);
  // Without a retimed image shown, a still never shown leaves the art running, as before.
  const plain = harness(ART(even), { beat: () => null }); plain.pass(); plain.created[0].load(); plain.dispose.pause(); await tick(); plain.dispose.play();
  assert.equal(plain.created.length, 2);
});
test("restartImgOnPass with a beat: a page made visible while the music plays restarts the retimed art where the music is", () => {
  const even = gifOf([20, 20, 20, 20]), h = harness(ART(even));
  assert.equal(h.visibility.size, 1);
  for (const fn of h.visibility) fn(); assert.equal(h.created.length, 0, "nothing retimed shown yet");
  h.pass(); h.created[0].load();
  h.doc.hidden = true; for (const fn of h.visibility) fn(); assert.equal(h.created.length, 1, "hidden: nothing");
  h.doc.hidden = false; h.status.positionSeconds = 0.3 - 0.017; for (const fn of h.visibility) fn();
  assert.equal(h.created.length, 2); assert.deepEqual(sources(even, gifIn(h.created[1].src))[0], 1);
  // Not while paused or frozen.
  h.created[1].load(); h.status.audioState = "suspended"; for (const fn of h.visibility) fn(); assert.equal(h.created.length, 2);
  h.status.audioState = "running"; h.dispose.pause(); for (const fn of h.visibility) fn(); assert.equal(h.created.length, 2, "frozen");
  h.dispose(); assert.equal(h.visibility.size, 0, "dispose removes the listener");
});
test("restartImgOnPass with a beat: a retimed copy that fails to decode gives way to the plain copy, once", async () => {
  const even = gifOf([20, 20, 20, 20]), h = harness(ART(even));
  h.pass(); const [retimed] = h.created; assert.ok(gifIn(retimed.src) && cs(gifIn(retimed.src))[0] === 23);
  retimed.fail(); assert.equal(h.created.length, 2, "the plain copy"); const plain = h.created[1];
  assert.equal(plain.src, ART(even).replace(";base64,", ";r=2;base64,"));
  plain.fail(); assert.equal(h.created.length, 2, "no further fallback"); h.pass(); h.created[2].load(); assert.equal(h.page[0], h.created[2], "later passes retime again");
  // Resumed from a still: the retimed restart fails, and the plain copy replaces the still.
  h.dispose.pause(); await tick(); h.created[3].load(); assert.ok(h.page[0] === h.created[3]);
  h.status.positionSeconds = 0.3; h.dispose.play(); h.created[4].fail();
  assert.equal(h.created.length, 6); h.created[5].load(); assert.equal(h.page[0], h.created[5], "the still gives way");
  // A failure after a newer image is shown, or after a stop or replay, changes nothing.
  h.pass(); h.pass(); h.created[7].load(); h.created[6].fail(); assert.equal(h.created.length, 8, "an older restart failing");
  h.pass(); h.status.runId = 2; h.created[8].fail(); assert.equal(h.created.length, 9, "another run");
});
test("restartImgOnPass with a beat: an older retimed copy failing while a newer one decodes gives no fallback (PR #93 review)", () => {
  const even = gifOf([20, 20, 20, 20]), h = harness(ART(even));
  h.pass(); h.pass(); const [a, b] = h.created;
  a.fail(); assert.equal(h.created.length, 2, "no plain copy over the newer restart");
  b.load(); assert.equal(h.page[0], b, "the newer retimed copy is shown");
  assert.deepEqual(cs(gifIn(h.page[0].src)), [23, 23, 22, 23]);
  // The latest failing still falls back.
  h.pass(); h.created[2].fail(); assert.equal(h.created.length, 4); h.created[3].load(); assert.equal(h.page[0], h.created[3]);
  assert.equal(h.created[3].src, ART(even).replace(";base64,", ";r=4;base64,"));
});
test("restartImgOnPass with a beat: percent-encoded art (the notes' cut-out copy) is retimed, and stilled from the retimed text", async () => {
  const even = gifOf([20, 20, 20, 20]), svg = `<svg xmlns='http://www.w3.org/2000/svg'><text>caf\u00e9 a,b</text><image href='data:image/gif;base64,${Buffer.from(even).toString("base64")}'/></svg>`;
  const src = "data:image/svg+xml," + encodeURIComponent(svg), h = harness(src);
  h.pass(); const [a] = h.created;
  assert.match(a.src, /^data:image\/svg\+xml;r=1;base64,/);
  assert.deepEqual(cs(gifIn(a.src)), [23, 23, 22, 23]);
  const text = Buffer.from(a.src.slice(a.src.indexOf(",") + 1), "base64");
  assert.deepEqual(text.toString("utf8").replace(/data:image\/gif;base64,[A-Za-z0-9+/=]+/, ""), svg.replace(/data:image\/gif;base64,[A-Za-z0-9+/=]+/, ""), "the rest of the art, its UTF-8 bytes kept");
  a.load(); h.dispose.pause(); await tick();
  assert.equal(h.stills[0].svg, text.toString("latin1"), "the still is made from the retimed art, one character per byte");
  // Without a beat, the plain percent-encoded copy, as before.
  const p = harness(src, { beat: () => null }); p.pass(); assert.equal(p.created[0].src, src.replace("data:image/svg+xml,", "data:image/svg+xml;r=1,"));
});
test("restartImgOnPass: a null beat decodes nothing at a restart", () => {
  const even = gifOf([20, 20, 20, 20]), h = harness(ART(even), { beat: () => null }), atob0 = globalThis.atob;
  let calls = 0; globalThis.atob = (x) => (calls++, atob0(x));
  try { h.pass(); } finally { globalThis.atob = atob0; }
  assert.equal(calls, 0);
});

// Seeded fuzz: random small GIFs (1-4 px a side, 2-5 frames; partial rectangles, disposals 0-3,
// transparency, interlace, local colour tables) retimed with repetition and rotation: every output
// frame shows its source frame's pixels (as the original's loop shows them), and stillSvg's way of
// drawing (from the last start, gifStarts) gives every frame's pixels, of the original and the retimed GIF.
test("retimeGif and gifStarts: seeded fuzz against the decoder", () => {
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff, ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  // Uncompressed LZW: a clear code before the table would grow.
  const lzw = (indices) => {
    const bits = [], put = (c) => { for (let i = 0; i < 3; i++) bits.push((c >> i) & 1); };
    put(4); indices.forEach((v, i) => { put(v); if (i % 2 == 1) put(4); }); put(5);
    const bytes = []; for (let i = 0; i < bits.length; i += 8) { let b = 0; for (let j = 0; j < 8 && i + j < bits.length; j++) b |= bits[i + j] << j; bytes.push(b); }
    const out = []; for (let i = 0; i < bytes.length; i += 255) { const c = bytes.slice(i, i + 255); out.push(c.length, ...c); } return [...out, 0];
  };
  const make = (W, H, frames) => Uint8Array.from([71, 73, 70, 56, 57, 97, W, 0, H, 0, 0xf1, 0, 0, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255,
    33, 255, 11, ...Buffer.from("NETSCAPE2.0"), 3, 1, 0, 0, 0,
    ...frames.flatMap((f) => [33, 249, 4, (f.disposal << 2) | (f.transparent ? 1 : 0), f.cs, 0, f.index, 0,
      44, f.x, 0, f.y, 0, f.w, 0, f.h, 0, (f.interlace ? 64 : 0) | (f.local ? 0x81 : 0), ...(f.local ? [9, 9, 9, 200, 100, 0, 0, 200, 100, 50, 50, 50] : []), 2, ...lzw(f.px)]), 59]);
  const hex = (a) => Buffer.from(a).toString("hex");
  /** Every frame drawn as stillSvg draws it: from the last start, each frame decoded on its own. */
  const stills = (b) => {
    const g = gifFrames(b), W = g.width, H = g.height, st = gifStarts(g);
    return g.frames.map((_, k) => {
      let canvas = new Uint8Array(W * H * 4), saved = null;
      for (let i = st.lastIndexOf(true, k), from = i; i <= k; i++) {
        const before = i > from ? g.frames[i - 1] : null, f = g.frames[i];
        if (before?.disposal == 2) for (let y = before.rect[1]; y < Math.min(H, before.rect[1] + before.rect[3]); y++) canvas.fill(0, (y * W + before.rect[0]) * 4, (y * W + Math.min(W, before.rect[0] + before.rect[2])) * 4);
        else if (before?.disposal == 3 && saved) canvas = saved.slice();
        if (f.disposal == 3) saved = canvas.slice();
        const one = decodeGif(Uint8Array.from([...g.head, ...b.subarray(f.start, f.end), 59])).frames[0].rgba;
        for (let p = 0; p < W * H; p++) if (one[p * 4 + 3]) canvas.set(one.subarray(p * 4, p * 4 + 4), p * 4);
      }
      return hex(canvas);
    });
  };
  let retimed = 0, rotated = 0, repeated = 0;
  for (let it = 0; it < 600; it++) {
    const W = ri(1, 4), H = ri(1, 4), frames = Array.from({ length: ri(2, 5) }, (_, i) => {
      const full = rnd() < 0.4, x = full ? 0 : ri(0, W - 1), y = full ? 0 : ri(0, H - 1), w = full ? W : ri(1, W - x), h = full ? H : ri(1, H - y);
      return { x, y, w, h, disposal: ri(0, 3), transparent: rnd() < 0.5, index: ri(0, 3), cs: ri(2, 40), interlace: rnd() < 0.3, local: rnd() < 0.3, px: Array.from({ length: w * h }, () => ri(0, 3)), i };
    });
    const gif = make(W, H, frames), beatS = 0.3 + rnd() * 0.7, pass = 30 + rnd() * 60, at = rnd() < 0.5 ? null : rnd() * pass;
    const out = retimeGif(gif, beatS, pass, at);
    assert.ok(out, `iteration ${it}: retimed`);
    retimed++;
    const g = gifFrames(gif), o = gifFrames(out), key = (x, f) => hex(x.subarray(f.start + 6, f.end)) + (x[f.start + 3] & 1), own = g.frames.map((f) => key(gif, f));
    // The frames, in the order they come: a rotation of the original's, repeated.
    let src = null;
    for (let s0 = 0; s0 < g.frames.length && !src; s0++) { const c = o.frames.map((_, j) => (s0 + j) % g.frames.length); if (c.every((i, j) => key(out, o.frames[j]) === own[i])) src = c; }
    assert.ok(src, `iteration ${it}: the original's frames in order`);
    if (src[0]) rotated++;
    if (o.frames.length > g.frames.length + 1) repeated++;
    const before = decodeGif(gif).frames.map((f) => hex(f.rgba));
    assert.deepEqual(decodeGif(out).frames.map((f) => hex(f.rgba)), src.map((i) => before[i]), `iteration ${it}: pixels`);
    if (it % 3 == 0) for (const b of [gif, out]) assert.deepEqual(stills(b), decodeGif(b).frames.map((f) => hex(f.rgba)), `iteration ${it}: stills`);
  }
  assert.ok(rotated > 50 && repeated > 300, `rotated ${rotated}, repeated ${repeated} of ${retimed}`);
});
