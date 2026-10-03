// @ts-check
// Node tests for scripts/drift.mjs, the arithmetic of the long-session check
// (scripts/drift_check.mjs). No browser needed.

import assert from "node:assert/strict";
import { test } from "node:test";
import { artOffsetMs, barX, clockAt, clockDrift, fitLine, largestStep, leads, median, passGrid, passStarts, trend, wrap } from "./drift.mjs";

const close = (/** @type {number} */ a, /** @type {number} */ b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

test("median: odd and even lengths, unsorted input left alone; empty is an error", () => {
  const xs = [5, 1, 3];
  assert.equal(median(xs), 3);
  assert.deepEqual(xs, [5, 1, 3]);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([-7]), -7);
  assert.throws(() => median([]), /empty/);
});

test("wrap: into (-period/2, period/2]", () => {
  close(wrap(0.3, 2), 0.3);
  close(wrap(1.7, 2), -0.3);
  close(wrap(-1.7, 2), 0.3);
  close(wrap(1, 2), 1);
  close(wrap(-1, 2), 1);
  close(wrap(6.25, 2), 0.25);
});

test("barX: the first bright pixel in the row, or -1", () => {
  const png = (/** @type {number} */ at) => ({ width: 400, pixel: (/** @type {number} */ x) => (x >= at && x < at + 10 ? [255, 255, 255] : [0, 0, 0]) });
  assert.equal(barX(png(0), 5), 0);
  assert.equal(barX(png(123), 5), 123);
  assert.equal(barX(png(500), 5), -1);
});

test("artOffsetMs: art phase minus sound phase, modulo the period", () => {
  const L = 1.714284;
  // In sync: the bar a quarter of the way through, a quarter of a pass after tick 0 (any pass).
  close(artOffsetMs(97.5, 390, L, 10 + L / 4, 10), 0, 1e-9);
  close(artOffsetMs(97.5, 390, L, 10 + 37 * L + L / 4, 10), 0, 1e-6);
  // The art 20 ms ahead, and 20 ms behind, across the bar's jump back to x = 0.
  close(artOffsetMs(390 * (0.02 / L), 390, L, 10 + 5 * L, 10), 20, 1e-6);
  close(artOffsetMs(390, 390, L, 10 + 5 * L + 0.02, 10), -20, 1e-6);
});

test("passStarts and passGrid: one start per pass, on the grid, none missing", () => {
  const L = 1.714284;
  /** @type {number[][]} */
  const sends = [];
  for (let k = 0; k < 350; k++) {
    const t = 0.5 + k * L;
    sends.push([0x90, 72, 96, t, t - 0.15], [0x99, 36, 100, t, t - 0.15], [0x90, 72, 0, t + L / 8, t - 0.1], [0x90, 76, 96, t + L / 4, t]);
  }
  const starts = passStarts(sends, 72, L);
  assert.equal(starts.length, 350);
  const grid = passGrid(starts, L);
  assert.equal(grid.passes, 350);
  assert.ok(grid.consecutive);
  assert.ok(grid.maxError < 1e-9);
  // A pass scheduled 2 ms late, and a missing pass.
  const late = starts.map((t, i) => (i === 200 ? t + 0.002 : t));
  close(passGrid(late, L).maxError, 0.002, 1e-9);
  const gap = starts.filter((_, i) => i !== 100);
  assert.equal(passGrid(gap, L).consecutive, false);
  // A slightly wrong tempo accumulates: 1 ppm over 349 passes is 0.6 ms at the end.
  const slow = starts.map((t, i) => t + i * L * 1e-6);
  close(passGrid(slow, L).maxError, 349 * L * 1e-6, 1e-9);
  assert.deepEqual(passGrid([], L), { passes: 0, consecutive: false, maxError: Infinity });
});

test("leads: the smallest lead and the late messages", () => {
  const ok = leads([[0x90, 60, 1, 1.2, 1.0], [0x80, 60, 0, 1.3, 1.25]]);
  assert.equal(ok.late, 0);
  close(ok.min, 0.05);
  const r = leads([[0x90, 60, 1, 1.2, 1.0], [0x90, 62, 1, 1.0, 1.01], [0x90, 64, 1, 1.0, 1.02]]);
  assert.equal(r.late, 2);
  close(r.min, -0.02);
});

test("clockDrift: offset change between the end windows, and the rate in ppm", () => {
  // 600 s, sampled every 250 ms, with the audio clock 50 ppm fast and quantized to 10 ms.
  /** @type {number[][]} */
  const samples = [];
  for (let p = 1000; p <= 601000; p += 250) samples.push([p, Math.floor((p * (1 + 50e-6) + 123) / 10) / 100]);
  const r = clockDrift(samples, 10000);
  close(r.seconds, 600);
  close(r.ppm, 50, 2);
  close(r.driftMs, 590 * 50e-3, 2); // window centres 590 s apart
  // Equal clocks: no drift, 0 ppm.
  const flat = clockDrift([[0, 1], [500, 1.5], [1000, 2]], 100);
  close(flat.driftMs, 0);
  close(flat.ppm, 0);
  assert.throws(() => clockDrift([[0, 0]], 10), /two samples/);
});

test("fitLine: slope and intercept; a single x gives slope 0", () => {
  const { slope, intercept } = fitLine([[0, 1], [1, 3], [2, 5]]);
  close(slope, 2);
  close(intercept, 1);
  assert.deepEqual(fitLine([[4, 2], [4, 6]]), { slope: 0, intercept: 4 });
  assert.throws(() => fitLine([]), /a point or more/);
});

test("clockAt: the local line through quantized samples is finer than one reading", () => {
  // currentTime advancing in 10 ms blocks, sampled about every 250 ms (at every phase of a block).
  /** @type {number[][]} */
  const samples = [];
  for (let p = 3; p < 20000; p += 251.3) samples.push([p, Math.floor(p / 10) / 100]);
  // Within 1 ms of the block-start clock's mean, which is half a block (5 ms) behind: a constant
  // that cancels in a drift.
  for (const at of [5000, 12345.6, 19900]) close(clockAt(samples, at, 3000), at / 1000 - 0.005, 0.001);
  assert.throws(() => clockAt(samples, 60000, 3000), /fewer than two clock samples/);
});

test("trend: drift over the checkpoints and the largest residual", () => {
  // 30 ms over 600 s, with one checkpoint 12 ms off the line.
  const pts = Array.from({ length: 61 }, (_, k) => [10 * k, 5 + 0.05 * k * 10 + (k === 30 ? 12 : 0)]);
  const r = trend(pts);
  close(r.driftMs, 30, 0.5);
  close(r.maxResidualMs, 12, 0.5);
  const flat = trend([[0, -9], [10, -9], [20, -9]]);
  close(flat.driftMs, 0);
  close(flat.maxResidualMs, 0);
});

test("largestStep: a 30 ms stall of the audio clock, among 10 ms quantization", () => {
  /** @type {number[][]} */
  const samples = [];
  for (let p = 0; p < 60000; p += 251.3) samples.push([p, Math.floor((p < 30000 ? p : p - 30) / 10) / 100]);
  const r = largestStep(samples, 8);
  close(r.stepMs, -30, 6);
  close(r.atMs, 30000, 1000);
  // Steady clocks: no step beyond the quantization.
  const steady = largestStep(samples.filter(([p]) => p < 29000), 8);
  assert.ok(Math.abs(steady.stepMs) < 6, String(steady.stepMs));
  assert.deepEqual(largestStep(samples.slice(0, 10), 8), { stepMs: 0, atMs: 0 });
});
