// @ts-check
// The arithmetic of the long-session check (scripts/drift_check.mjs), apart from the browser so
// that Node tests (scripts/drift.test.mjs) cover it. Times are in seconds unless a name says ms.

/**
 * The median of a non-empty list.
 * @param {number[]} xs
 */
export function median(xs) {
  if (!xs.length) throw new Error("median of an empty list");
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * `x` reduced modulo `period` into (-period/2, period/2].
 * @param {number} x
 * @param {number} period
 */
export function wrap(x, period) {
  const r = ((x % period) + period) % period;
  return r > period / 2 ? r - period : r;
}

/**
 * The left edge of the probe's white bar in row `y` of a screenshot, or -1 if it is not there.
 * @param {{width: number, pixel: (x: number, y: number) => number[]}} png
 * @param {number} y
 */
export function barX(png, y) {
  for (let x = 0; x < png.width; x++) if (png.pixel(x, y)[0] > 200) return x;
  return -1;
}

/**
 * The art's offset from the sound at one instant, in ms (positive: the art is ahead). The probe's
 * bar at `x` of its `travel` pixels is that far through a sweep of `period` seconds that started
 * with the art's restart; the sound heard is at AudioContext time `heard`, and the first pass
 * started (tick 0) at `start`. The difference is taken modulo the period.
 * @param {number} x
 * @param {number} travel
 * @param {number} period
 * @param {number} heard
 * @param {number} start
 */
export function artOffsetMs(x, travel, period, heard, start) {
  return 1000 * wrap((x / travel) * period - (heard - start), period);
}

/**
 * The start of every pass: the scheduled times of the note-ons of `note` on channel 1 (velocity
 * above 0), keeping the first of each pass (one more than half a pass after the previous one).
 * @param {number[][]} sends [status, data 1, data 2, time, ...] per scheduled message
 * @param {number} note
 * @param {number} period one pass
 */
export function passStarts(sends, note, period) {
  const ons = sends.filter((s) => s[0] === 0x90 && s[1] === note && s[2] > 0).map((s) => s[3]);
  return ons.filter((t, i) => i === 0 || t - ons[i - 1] > period / 2);
}

/**
 * Pass starts against the grid `starts[0] + k x period`: how many, whether they are passes
 * 0, 1, 2, ... with none missing or repeated, and the largest distance from the grid.
 * @param {number[]} starts
 * @param {number} period
 */
export function passGrid(starts, period) {
  if (!starts.length) return { passes: 0, consecutive: false, maxError: Infinity };
  const ks = starts.map((t) => Math.round((t - starts[0]) / period));
  const maxError = starts.reduce((m, t, i) => Math.max(m, Math.abs(t - (starts[0] + ks[i] * period))), 0);
  return { passes: starts.length, consecutive: ks.every((k, i) => k === i), maxError };
}

/**
 * How far ahead of the audio clock each message was scheduled: the smallest lead, and how many
 * were scheduled behind it (late: they play late).
 * @param {number[][]} sends [status, data 1, data 2, time, AudioContext time when sent] per message
 */
export function leads(sends) {
  let min = Infinity;
  let late = 0;
  for (const s of sends) {
    const lead = s[3] - s[4];
    if (lead < min) min = lead;
    if (lead < 0) late++;
  }
  return { min, late };
}

/**
 * The least-squares line through points [x, y].
 * @param {number[][]} pts
 * @returns {{slope: number, intercept: number}}
 */
export function fitLine(pts) {
  if (!pts.length) throw new Error("fitLine needs a point or more");
  const mx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const my = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  let num = 0;
  let den = 0;
  for (const [x, y] of pts) {
    num += (x - mx) * (y - my);
    den += (x - mx) ** 2;
  }
  const slope = den ? num / den : 0;
  return { slope, intercept: my - slope * mx };
}

/**
 * The AudioContext time at page time `perfMs`, from the clock samples [performance.now() in ms,
 * currentTime] within `halfWindowMs` of it, by a local least-squares line. currentTime advances in
 * blocks (up to 10 ms or more, by engine), so one reading is that coarse; the line through a few
 * seconds of samples is not.
 * @param {number[][]} samples
 * @param {number} perfMs
 * @param {number} halfWindowMs
 */
export function clockAt(samples, perfMs, halfWindowMs) {
  const near = samples.filter(([p]) => Math.abs(p - perfMs) <= halfWindowMs);
  if (near.length < 2) throw new Error(`fewer than two clock samples within ${halfWindowMs} ms of ${perfMs.toFixed(0)} ms`);
  const { slope, intercept } = fitLine(near);
  return slope * perfMs + intercept;
}

/**
 * The trend of the art's offset from the sound: the least-squares line through the checkpoints
 * [seconds, offset in ms]. `driftMs` is its change from the first checkpoint to the last, and
 * `maxResidualMs` the largest distance of a checkpoint from it.
 * @param {number[][]} points
 */
export function trend(points) {
  const { slope, intercept } = fitLine(points);
  const span = points[points.length - 1][0] - points[0][0];
  const maxResidualMs = points.reduce((m, [t, o]) => Math.max(m, Math.abs(o - (slope * t + intercept))), 0);
  return { driftMs: slope * span, maxResidualMs };
}

/**
 * The audio clock against the page clock, from samples [performance.now() in ms, AudioContext
 * currentTime]: `driftMs` is the change in their offset (1000 x currentTime - performance.now())
 * from the first `windowMs` to the last (medians, which absorb the clock's quantization), and
 * `ppm` the least-squares slope of the offset (positive: the audio clock runs fast).
 * @param {number[][]} samples
 * @param {number} windowMs
 */
export function clockDrift(samples, windowMs) {
  if (samples.length < 2) throw new Error("clockDrift needs two samples or more");
  const pts = samples.map(([p, t]) => [p, 1000 * t - p]);
  const p0 = pts[0][0];
  const p1 = pts[pts.length - 1][0];
  const first = pts.filter(([p]) => p <= p0 + windowMs).map((q) => q[1]);
  const last = pts.filter(([p]) => p >= p1 - windowMs).map((q) => q[1]);
  return { driftMs: median(last) - median(first), ppm: fitLine(pts).slope * 1e6, seconds: (p1 - p0) / 1000 };
}

/**
 * The largest step in the audio clock against the page clock: over samples [performance.now() in
 * ms, currentTime], the largest change in the median offset (1000 x currentTime - performance.now())
 * from the `n` samples before a point to the `n` from it on. A stall of the audio clock (an
 * underrun: currentTime stops while the page clock runs) shows as a negative step.
 * @param {number[][]} samples
 * @param {number} n
 * @returns {{stepMs: number, atMs: number}} the step (0 if there are under 2n samples) and the
 *   page time where it happened
 */
export function largestStep(samples, n) {
  const off = samples.map(([p, t]) => 1000 * t - p);
  let best = { stepMs: 0, atMs: samples.length ? samples[0][0] : 0 };
  for (let i = n; i + n <= off.length; i++) {
    const step = median(off.slice(i, i + n)) - median(off.slice(i - n, i));
    if (Math.abs(step) > Math.abs(best.stepMs)) best = { stepMs: step, atMs: samples[i][0] };
  }
  return best;
}
