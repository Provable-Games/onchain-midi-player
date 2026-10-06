// @ts-nocheck
// Versioned, fail-closed native-evidence ingestion. Checked-in manifests are reviewed pins, not an
// attestation boundary: branch protection/review is still required. Fixture data never qualifies a
// production pair.

import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, resolve, relative } from "node:path";
import { analyzeMidi } from "./oracle.mjs";

export const PRODUCTION_MANIFEST_SCHEMA = "onchain-midi-player.production-certification-manifest";
export const PRODUCTION_RESULTS_SCHEMA = "onchain-midi-player.production-certification-results";
export const REQUIRED_ENGINES = Object.freeze(["chromium", "firefox", "webkit"]);
export const REQUIRED_BUILDS = Object.freeze(["source", "min"]);
export const REQUIRED_SAMPLE_RATES = Object.freeze([44100, 48000]);
export const MIN_SUPPORTED_SINE_PURITY = 0.995;
export const MAX_SUPPORTED_AUDIO_PEAK = 1;
export const MAX_SUPPORTED_PITCH_CENTS = 25;
export const MAX_SUPPORTED_TIMING_ERROR_SECONDS = 0.02;
export const SUPPORTED_TOLERANCE_VERSION = "native-tolerances-v1";
export const SUPPORTED_SETTINGS_CONVERSION = Object.freeze({ id: "wire-json-identity", version: "1" });
const MAX_AUDIO_ARTIFACT_BYTES = 64 * 1024 * 1024;
const MAX_WAV_CHUNKS = 1024;

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const isSha = (value) => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
const finite = (value) => typeof value === "number" && Number.isFinite(value);

/** Canonical JSON used only for semantic settings identity; exact input bytes are pinned separately. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + canonicalJson(value[key])).join(",") + "}";
  }
  return JSON.stringify(value);
}

/**
 * Read IEEE float32 little-endian stereo PCM and recompute whole-file channel metrics.
 * @param {Buffer} bytes
 * @param {number} expectedSampleRate
 */
export function inspectFloatWav(bytes, expectedSampleRate) {
  if (bytes.length > MAX_AUDIO_ARTIFACT_BYTES) throw new Error("raw audio artifact exceeds the 64 MiB certification cap");
  if (bytes.length < 44 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("raw artifact is not a RIFF/WAVE file");
  }
  if (bytes.readUInt32LE(4) !== bytes.length - 8) throw new Error("RIFF size does not match the raw artifact length");
  let format = null;
  let channels = null;
  let sampleRate = null;
  let bitsPerSample = null;
  let dataStart = null;
  let dataLength = null;
  let offset = 12;
  let chunkCount = 0;
  while (offset + 8 <= bytes.length) {
    if (++chunkCount > MAX_WAV_CHUNKS) throw new Error("WAV exceeds the 1024 chunk cap");
    const id = bytes.toString("ascii", offset, offset + 4);
    const length = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (length > bytes.length - start) throw new Error("WAV chunk exceeds artifact length");
    if (id === "fmt ") {
      if (format !== null) throw new Error("WAV has duplicate fmt chunks");
      if (length < 16) throw new Error("WAV fmt chunk is truncated");
      format = bytes.readUInt16LE(start);
      channels = bytes.readUInt16LE(start + 2);
      sampleRate = bytes.readUInt32LE(start + 4);
      if (bytes.readUInt32LE(start + 8) !== sampleRate * channels * 4) throw new Error("WAV byte rate is inconsistent with float stereo format");
      if (bytes.readUInt16LE(start + 12) !== channels * 4) throw new Error("WAV block alignment is inconsistent with float stereo format");
      bitsPerSample = bytes.readUInt16LE(start + 14);
    } else if (id === "data") {
      if (dataStart !== null) throw new Error("WAV has duplicate data chunks");
      dataStart = start;
      dataLength = length;
    }
    offset = start + length + (length & 1);
    if (offset > bytes.length) throw new Error("WAV chunk padding exceeds artifact length");
  }
  if (offset !== bytes.length) throw new Error("WAV has truncated trailing chunk data");
  if (format !== 3 || channels !== 2 || bitsPerSample !== 32 || dataStart === null || dataLength === null || dataLength % 8) {
    throw new Error("WAV must contain float32-le stereo PCM");
  }
  if (dataLength === 0) throw new Error("WAV capture is empty");
  if (sampleRate !== expectedSampleRate) throw new Error(`WAV sample rate ${sampleRate} does not match row ${expectedSampleRate}`);
  const count = dataLength / 8;
  const sums = [0, 0];
  const peaks = [0, 0];
  let finiteSamples = true;
  for (let i = 0; i < count; i++) {
    for (let channel = 0; channel < 2; channel++) {
      const value = bytes.readFloatLE(dataStart + i * 8 + channel * 4);
      if (!Number.isFinite(value)) { finiteSamples = false; continue; }
      const abs = Math.abs(value);
      peaks[channel] = Math.max(peaks[channel], abs);
      sums[channel] += value * value;
    }
  }
  return {
    frames: count,
    durationSeconds: count / sampleRate,
    sampleRate,
    format: "float32-le-stereo",
    channels: {
      left: { peak: peaks[0], rms: count ? Math.sqrt(sums[0] / count) : 0, finite: finiteSamples },
      right: { peak: peaks[1], rms: count ? Math.sqrt(sums[1] / count) : 0, finite: finiteSamples },
    },
    _dataStart: dataStart,
    _dataLength: dataLength,
  };
}

/** Estimate the dominant sine frequency from a single-note float stereo probe. */
function estimateProbeHz(bytes, measured, windowStartSeconds, windowEndSeconds) {
  const start = measured._dataStart;
  const firstFrame = Math.max(0, Math.floor(windowStartSeconds * measured.sampleRate));
  const lastFrame = Math.min(measured._dataLength / 8, Math.ceil(windowEndSeconds * measured.sampleRate));
  if (!Number.isInteger(start) || lastFrame - firstFrame < measured.sampleRate * 0.03) return null;
  const leftRms = measured.channels.left.rms;
  const rightRms = measured.channels.right.rms;
  const side = leftRms >= rightRms ? 0 : 1;
  const stride = 8;
  const peak = Math.max(measured.channels.left.peak, measured.channels.right.peak);
  if (!(peak > 0)) return null;
  let previous = bytes.readFloatLE(start + firstFrame * 8 + side * 4);
  let priorCross = null;
  const intervals = [];
  for (let frame = firstFrame + 1; frame < lastFrame; frame++) {
    const current = bytes.readFloatLE(start + frame * stride + side * 4);
    if (previous <= 0 && current > 0) {
      const frac = -previous / (current - previous);
      const cross = frame - 1 + frac;
      if (priorCross !== null) intervals.push(cross - priorCross);
      priorCross = cross;
    }
    previous = current;
  }
  if (intervals.length < 3) return null;
  intervals.sort((a, b) => a - b);
  const middle = intervals[Math.floor(intervals.length / 2)];
  return middle > 0 ? measured.sampleRate / middle : null;
}

function sinePurity(bytes, measured, startSeconds, endSeconds) {
  const startFrame = Math.max(0, Math.floor(startSeconds * measured.sampleRate));
  const endFrame = Math.min(measured._dataLength / 8, Math.ceil(endSeconds * measured.sampleRate));
  const count = endFrame - startFrame;
  if (count < measured.sampleRate * 0.03) return null;
  const side = measured.channels.left.rms >= measured.channels.right.rms ? 0 : 1;
  let mean = 0;
  for (let frame = startFrame; frame < endFrame; frame++) mean += bytes.readFloatLE(measured._dataStart + frame * 8 + side * 4);
  mean /= count;
  let ss = 0;
  for (let frame = startFrame; frame < endFrame; frame++) {
    const x = bytes.readFloatLE(measured._dataStart + frame * 8 + side * 4) - mean;
    ss += x * x;
  }
  const frequency = estimateProbeHz(bytes, measured, startSeconds, endSeconds);
  if (!(frequency > 0) || !(ss > 0)) return null;
  let sin = 0, cos = 0, sin2 = 0, cos2 = 0, sinCos = 0;
  for (let frame = startFrame; frame < endFrame; frame++) {
    const t = frame / measured.sampleRate;
    const angle = 2 * Math.PI * frequency * t;
    const s = Math.sin(angle), c = Math.cos(angle);
    const x = bytes.readFloatLE(measured._dataStart + frame * 8 + side * 4) - mean;
    sin += x * s; cos += x * c; sin2 += s * s; cos2 += c * c; sinCos += s * c;
  }
  const det = sin2 * cos2 - sinCos * sinCos;
  if (!(det > 1e-12)) return null;
  const a = (sin * cos2 - cos * sinCos) / det;
  const b = (cos * sin2 - sin * sinCos) / det;
  let residual = 0;
  for (let frame = startFrame; frame < endFrame; frame++) {
    const t = frame / measured.sampleRate;
    const predicted = a * Math.sin(2 * Math.PI * frequency * t) + b * Math.cos(2 * Math.PI * frequency * t);
    const actual = bytes.readFloatLE(measured._dataStart + frame * 8 + side * 4) - mean;
    residual += (actual - predicted) ** 2;
  }
  return Math.max(0, Math.min(1, 1 - residual / ss));
}

function probeRms(bytes, measured, startSeconds, endSeconds) {
  const startFrame = Math.max(0, Math.floor(startSeconds * measured.sampleRate));
  const endFrame = Math.min(measured._dataLength / 8, Math.ceil(endSeconds * measured.sampleRate));
  if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) || endFrame <= startFrame) return null;
  let sum = 0;
  let count = 0;
  for (let frame = startFrame; frame < endFrame; frame++) {
    const left = bytes.readFloatLE(measured._dataStart + frame * 8);
    const right = bytes.readFloatLE(measured._dataStart + frame * 8 + 4);
    if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
    sum += left * left + right * right;
    count += 2;
  }
  return count ? Math.sqrt(sum / count) : null;
}

function probeOnsetSeconds(bytes, measured) {
  const peak = Math.max(measured.channels.left.peak, measured.channels.right.peak);
  if (!(peak > 0)) return null;
  const threshold = peak * 0.025;
  const frames = measured._dataLength / 8;
  for (let frame = 0; frame < frames; frame++) {
    const left = Math.abs(bytes.readFloatLE(measured._dataStart + frame * 8));
    const right = Math.abs(bytes.readFloatLE(measured._dataStart + frame * 8 + 4));
    if (left >= threshold || right >= threshold) return frame / measured.sampleRate;
  }
  return null;
}

function envelopeFeatures(bytes, measured, onsetSeconds, offSeconds) {
  const step = 0.005;
  const rmsAt = (center, width = step) => probeRms(bytes, measured, Math.max(0, center - width / 2), center + width / 2);
  const frames = measured._dataLength / 8;
  const duration = frames / measured.sampleRate;
  const localPeak = Math.max(0, ...Array.from({ length: Math.min(20, Math.ceil(Math.max(0, Math.min(0.1, duration - onsetSeconds)) / step)) }, (_, i) => rmsAt(onsetSeconds + i * step + step / 2) || 0));
  if (!localPeak) return null;
  let attack = null;
  for (let at = onsetSeconds; at < Math.min(duration, onsetSeconds + 0.1); at += step) {
    if ((rmsAt(at + step / 2) || 0) >= localPeak * 0.8) { attack = at - onsetSeconds; break; }
  }
  if (attack === null || !Number.isFinite(offSeconds)) return { attackSeconds: attack, releaseSeconds: null };
  const before = rmsAt(offSeconds - 0.01, 0.01);
  if (!(before > 0)) return { attackSeconds: attack, releaseSeconds: null };
  let release = null;
  for (let at = offSeconds + step; at < Math.min(duration, offSeconds + 2); at += step) {
    if ((rmsAt(at) || 0) <= before * Math.exp(-1)) { release = at - offSeconds; break; }
  }
  return { attackSeconds: attack, releaseSeconds: release };
}

/** Recomputed local features for a bounded, isolated one-operator sine probe. */
export function measureIsolatedSineProbe(bytes, sampleRate, windowStartSeconds, windowEndSeconds, offSeconds) {
  const measured = inspectFloatWav(bytes, sampleRate);
  const onsetSeconds = probeOnsetSeconds(bytes, measured);
  const frequencyHz = estimateProbeHz(bytes, measured, windowStartSeconds, windowEndSeconds);
  const purity = sinePurity(bytes, measured, windowStartSeconds, windowEndSeconds);
  const localRms = probeRms(bytes, measured, windowStartSeconds, windowEndSeconds);
  const envelope = envelopeFeatures(bytes, measured, onsetSeconds ?? 0, offSeconds);
  return {
    frames: measured.frames,
    durationSeconds: measured.durationSeconds,
    channels: measured.channels,
    onsetSeconds,
    frequencyHz,
    sinePurity: purity,
    localRms,
    fullRms: Math.sqrt((measured.channels.left.rms ** 2 + measured.channels.right.rms ** 2) / 2),
    envelope,
  };
}

/** @param {unknown} value */
const object = (value) => !!value && typeof value === "object" && !Array.isArray(value);

/** @param {any} toolchain @param {string} engine */
function expectedBrowserBundle(toolchain, engine) {
  const browser = toolchain?.browsers?.[engine];
  if (!object(toolchain) || toolchain.schemaVersion !== 1 || typeof toolchain.playwrightCoreVersion !== "string" || !toolchain.playwrightCoreVersion ||
      !isSha(toolchain.browsersManifestSha256) || !object(browser) ||
      !((typeof browser.revision === "string" && browser.revision) || (Number.isInteger(browser.revision) && browser.revision > 0)) ||
      typeof browser.bundleId !== "string" || !browser.bundleId || typeof browser.browserVersion !== "string" || !browser.browserVersion) return null;
  const identity = {
    schemaVersion: 1,
    engine,
    revision: browser.revision,
    bundleId: browser.bundleId,
    browserVersion: browser.browserVersion,
    playwrightCoreVersion: toolchain.playwrightCoreVersion,
    browsersManifestSha256: toolchain.browsersManifestSha256,
  };
  return { ...identity, identitySha256: sha256(Buffer.from(canonicalJson(identity))) };
}

/** @param {any} toolchain */
function expectedBrowserToolchainSha256(toolchain) {
  return sha256(Buffer.from(canonicalJson({
    schemaVersion: toolchain.schemaVersion,
    playwrightCoreVersion: toolchain.playwrightCoreVersion,
    browsersManifestSha256: toolchain.browsersManifestSha256,
    browsers: toolchain.browsers,
  })));
}

/** @param {any} actual @param {any} expected */
function compareBrowserBundle(actual, expected) {
  const fields = ["schemaVersion", "engine", "revision", "bundleId", "browserVersion", "playwrightCoreVersion", "browsersManifestSha256", "identitySha256"];
  return fields.filter((field) => actual?.[field] !== expected[field]);
}

function readBoundedArtifact(rootValue, rel) {
  if (isAbsolute(rel)) throw new Error("raw audio artifact path must be relative");
  const root = realpathSync(resolve(rootValue || process.cwd()));
  const path = realpathSync(resolve(root, rel));
  const fromRoot = relative(root, path);
  if (fromRoot === ".." || fromRoot.startsWith("../")) throw new Error("raw audio artifact resolves outside the repository root");
  const size = statSync(path).size;
  if (size > MAX_AUDIO_ARTIFACT_BYTES) throw new Error("raw audio artifact exceeds the 64 MiB certification cap");
  return readFileSync(path);
}

/**
 * Verify the exact engine/build/rate Cartesian set and each row's required first-attempt evidence.
 * Diagnostics are retained in result artifacts but can never replace the first attempt.
 * @param {any[]} rows
 * @param {{quality: number, engines?: string[], builds?: string[], sampleRates?: number[], browserVersions?: Record<string, string>, maxPeak?: number, minRms?: number, minSinePurity?: number, validateArtifacts?: boolean, root?: string, expectedNotes?: any[], expectedIdentity?: Record<string, any>, buildHashes?: Record<string, string>, runtimeObservation?: Record<string, any>, maxPitchCents?: number, maxTimingErrorSeconds?: number}} options
 */
export function validateNativeRows(rows, options) {
  const engines = options.engines || [...REQUIRED_ENGINES];
  const builds = options.builds || [...REQUIRED_BUILDS];
  const sampleRates = options.sampleRates || [...REQUIRED_SAMPLE_RATES];
  const expected = new Set(engines.flatMap((engine) => builds.flatMap((build) => sampleRates.map((rate) => `${engine}/${build}/${rate}`))));
  const seen = new Set();
  const failures = [];
  const incomplete = [];
  const pitchTolerance = finite(options.maxPitchCents) ? Math.min(MAX_SUPPORTED_PITCH_CENTS, options.maxPitchCents) : MAX_SUPPORTED_PITCH_CENTS;
  const timingTolerance = finite(options.maxTimingErrorSeconds) ? Math.min(MAX_SUPPORTED_TIMING_ERROR_SECONDS, options.maxTimingErrorSeconds) : MAX_SUPPORTED_TIMING_ERROR_SECONDS;
  if (!Array.isArray(rows)) return { status: "incomplete", expectedRows: expected.size, seenRows: 0, failures, incomplete: [{ code: "native-rows-missing" }] };
  for (const row of rows) {
    if (!object(row)) { incomplete.push({ code: "native-row-malformed" }); continue; }
    const key = `${row.engine}/${row.build}/${row.sampleRate}`;
    if (!expected.has(key)) { failures.push({ code: "native-row-unexpected", key }); continue; }
    if (seen.has(key)) { failures.push({ code: "native-row-duplicate", key }); continue; }
    seen.add(key);
    if (typeof row.engineVersion !== "string" || !row.engineVersion || !Number.isInteger(row.quality) || row.quality !== options.quality) {
      incomplete.push({ code: "native-row-runtime-identity-missing", key });
    } else if (options.browserVersions?.[row.engine] && row.engineVersion !== options.browserVersions[row.engine]) {
      failures.push({ code: "native-row-browser-version-mismatch", key, expected: options.browserVersions[row.engine], actual: row.engineVersion });
    } else if (!options.browserVersions?.[row.engine]) {
      incomplete.push({ code: "native-row-browser-version-unpinned", key });
    }
    const expectedBundle = expectedBrowserBundle(options.browserToolchain, row.engine);
    if (!expectedBundle) incomplete.push({ code: "native-row-browser-bundle-unpinned", key });
    else {
      const actualBundle = row.browserBundle;
      if (!object(actualBundle)) incomplete.push({ code: "native-row-browser-bundle-missing", key });
      else {
        const mismatches = compareBrowserBundle(actualBundle, expectedBundle);
        if (mismatches.length) failures.push({ code: "native-row-browser-bundle-mismatch", key, fields: mismatches, expected: expectedBundle, actual: actualBundle });
      }
      if (row.engineVersion !== expectedBundle.browserVersion) failures.push({ code: "native-row-browser-bundle-version-mismatch", key, expected: expectedBundle.browserVersion, actual: row.engineVersion ?? null });
    }
    for (const [field, expectedValue] of Object.entries(options.expectedIdentity || {})) {
      const actualValue = row[field];
      if (expectedValue === undefined || expectedValue === null || expectedValue === "") incomplete.push({ code: "native-expected-pin-missing", key, field });
      else if (actualValue === undefined || actualValue === null || actualValue === "") incomplete.push({ code: "native-row-pin-missing", key, field });
      else if (actualValue !== expectedValue) failures.push({ code: "native-row-pin-mismatch", key, field, expected: expectedValue, actual: actualValue });
    }
    const expectedEngineSha = options.buildHashes?.[row.build];
    if (!isSha(row.engineSha256)) incomplete.push({ code: "native-row-engine-hash-missing", key });
    else if (!isSha(expectedEngineSha)) incomplete.push({ code: "native-row-build-hash-unpinned", key, build: row.build });
    else if (row.engineSha256 !== expectedEngineSha) failures.push({ code: "native-row-engine-hash-mismatch", key, expected: expectedEngineSha, actual: row.engineSha256 });
    if (!object(row.runtime)) incomplete.push({ code: "native-row-measured-runtime-missing", key });
    else {
      for (const field of ["horizonSeconds", "startupAnchorSeconds", "schedulerIntervalSeconds", "releaseRatio", "originContract"]) {
        const actualValue = row.runtime[field];
        const expectedValue = options.runtimeObservation?.[field];
        if (actualValue === undefined || actualValue === null) incomplete.push({ code: "native-row-runtime-field-missing", key, field });
        else if (expectedValue === undefined || expectedValue === null) incomplete.push({ code: "native-runtime-policy-observation-missing", key, field });
        else if (actualValue !== expectedValue) failures.push({ code: "native-row-runtime-policy-mismatch", key, field, expected: expectedValue, actual: actualValue });
      }
      for (const field of ["selectedOrigin", "captureStartContextTime"]) if (!finite(row.runtime[field])) incomplete.push({ code: "native-row-audio-clock-unmeasured", key, field });
    }
    const first = row.firstAttempt;
    if (!object(first) || first.attemptNumber !== 1 || first.complete !== true || !["pass", "fail", "incomplete"].includes(first.status)) {
      incomplete.push({ code: "native-first-attempt-incomplete", key });
      continue;
    }
    if (first.status === "fail") failures.push({ code: "native-first-attempt-failed", key, details: first.failures ?? [] });
    else if (first.status === "incomplete") incomplete.push({ code: "native-first-attempt-status-incomplete", key, details: first.incomplete ?? [] });
    if (expectedBundle) {
      if (!object(first.browserBundle)) incomplete.push({ code: "native-first-attempt-browser-bundle-missing", key });
      else {
        const mismatches = compareBrowserBundle(first.browserBundle, expectedBundle);
        if (mismatches.length) failures.push({ code: "native-first-attempt-browser-bundle-mismatch", key, fields: mismatches, expected: expectedBundle, actual: first.browserBundle });
      }
    }
    if (!object(first.runtime)) incomplete.push({ code: "native-first-attempt-runtime-missing", key });
    else {
      for (const field of ["horizonSeconds", "startupAnchorSeconds", "schedulerIntervalSeconds", "releaseRatio", "originContract", "selectedOrigin", "captureStartContextTime"]) {
        if (first.runtime[field] === undefined || first.runtime[field] === null) incomplete.push({ code: "native-first-attempt-runtime-field-missing", key, field });
        else if (object(row.runtime) && first.runtime[field] !== row.runtime[field]) failures.push({ code: "native-first-attempt-runtime-mismatch", key, field, expected: row.runtime[field], actual: first.runtime[field] });
      }
    }
    const audio = first.audio;
    if (!object(audio) || audio.format !== "float32-le-stereo" || !isSha(audio.sha256) || typeof audio.path !== "string") {
      incomplete.push({ code: "native-audio-artifact-unbound", key });
      continue;
    }
    if (!Number.isInteger(audio.expectedFrames) || audio.expectedFrames <= 0 || !finite(audio.durationSeconds)) {
      incomplete.push({ code: "native-audio-capture-bounds-missing", key });
    }
    if (!object(first.measurements) || !object(first.measurements.channels) || !Array.isArray(first.measurements.notes)) {
      incomplete.push({ code: "native-measurements-missing", key });
      continue;
    }
    const expectedNotes = options.expectedNotes || [];
    if (!Array.isArray(options.expectedNotes) || !expectedNotes.length) incomplete.push({ code: "native-note-intent-expectations-missing", key });
    const expectedById = new Map(expectedNotes.map((note) => [note.id, note]));
    const measuredById = new Map();
    for (const note of first.measurements.notes) {
      if (!object(note) || typeof note.id !== "string") { incomplete.push({ code: "native-note-measurement-malformed", key }); continue; }
      if (measuredById.has(note.id)) failures.push({ code: "native-note-duplicate", key, noteId: note.id });
      else measuredById.set(note.id, note);
      if (!expectedById.has(note.id)) failures.push({ code: "native-note-unexpected", key, noteId: note.id });
    }
    for (const expectedNote of expectedNotes) {
      const note = measuredById.get(expectedNote.id);
      if (!note) { incomplete.push({ code: "native-note-measurement-missing", key, noteId: expectedNote.id }); continue; }
      if (note.status === "fail") failures.push({ code: "native-note-first-attempt-failed", key, noteId: note.id, details: note.failures ?? [] });
      else if (note.status !== "pass") incomplete.push({ code: "native-note-status-incomplete", key, noteId: note.id, status: note.status ?? null });
      const identity = note.identity;
      if (!object(identity) || identity.track !== expectedNote.track || identity.eventIndex !== expectedNote.eventIndex ||
          identity.channel !== expectedNote.channel || identity.key !== expectedNote.key || identity.program !== expectedNote.program ||
          !finite(identity.onsetSeconds) || Math.abs(identity.onsetSeconds - expectedNote.time) > timingTolerance) {
        failures.push({ code: "native-note-intent-identity-mismatch", key, noteId: note.id, expected: { track: expectedNote.track, eventIndex: expectedNote.eventIndex, channel: expectedNote.channel, key: expectedNote.key, program: expectedNote.program, onsetSeconds: expectedNote.time }, actual: identity ?? null });
      }
      const envelope = note.envelope;
      if (!object(envelope) || !finite(envelope.attackSeconds) || !finite(envelope.releaseSeconds) || !finite(envelope.localRms) ||
          !finite(envelope.confidence) || envelope.confidence < 0 || envelope.confidence > 1) {
        incomplete.push({ code: "native-note-envelope-metrics-incomplete", key, noteId: note.id });
      } else {
        const op = expectedNote.expectedOperators?.[0];
        if (!op) incomplete.push({ code: "native-note-operator-intent-missing", key, noteId: note.id });
        else if (Math.abs(envelope.attackSeconds - op.attackSeconds) > timingTolerance ||
            Math.abs(envelope.releaseSeconds - op.releaseSeconds) > timingTolerance) {
          failures.push({ code: "native-note-envelope-intent-mismatch", key, noteId: note.id, expected: { attackSeconds: op.attackSeconds, releaseSeconds: op.releaseSeconds }, actual: envelope });
        }
      }
      if (expectedNote.expectedOperators?.[0]?.intent === "pitched") {
        const pitch = note.pitch;
        if (!object(pitch) || !finite(expectedNote.expectedFundamentalHz) || !finite(pitch.measuredHz) || !finite(pitch.centsError) ||
            pitch.methodVersion !== "sine-fit-v1" || !finite(pitch.sinePurity)) {
          incomplete.push({ code: "native-note-pitch-measurement-incomplete", key, noteId: note.id });
        } else {
          const calculated = pitch.measuredHz > 0 ? 1200 * Math.log2(pitch.measuredHz / expectedNote.expectedFundamentalHz) : Infinity;
          if (Math.abs(calculated - pitch.centsError) > 0.1) failures.push({ code: "native-note-pitch-metric-inconsistent", key, noteId: note.id, claimedCents: pitch.centsError, calculatedCents: calculated });
          if (Math.abs(calculated) > pitchTolerance) failures.push({ code: "native-note-pitch-out-of-tolerance", key, noteId: note.id, calculatedCents: calculated, tolerance: pitchTolerance });
        }
      } else {
        // Noise/spectral texture attribution is intentionally left to #91's reviewed reducer;
        // present numeric rates or self-reported texture metrics cannot qualify it here.
        incomplete.push({ code: "native-note-texture-measurement-unsupported", key, noteId: note.id });
      }
      if (!object(note.audio) || typeof note.audio.path !== "string" || !isSha(note.audio.sha256) || note.audio.isolated !== true) {
        incomplete.push({ code: "native-note-raw-probe-missing", key, noteId: note.id });
      } else if (note.audio.firstAttempt !== true) {
        incomplete.push({ code: "native-note-probe-not-first-attempt", key, noteId: note.id });
      } else if (options.validateArtifacts) {
        try {
          const probeBytes = readBoundedArtifact(options.root || process.cwd(), note.audio.path);
          if (sha256(probeBytes) !== note.audio.sha256) throw new Error("note probe SHA-256 does not match");
          const measured = inspectFloatWav(probeBytes, row.sampleRate);
          if (!Number.isInteger(note.audio.expectedFrames) || note.audio.expectedFrames !== measured.frames || !finite(note.audio.durationSeconds) ||
              Math.abs(note.audio.durationSeconds - measured.durationSeconds) > 1 / row.sampleRate) {
            incomplete.push({ code: "native-note-probe-capture-bounds-missing-or-stale", key, noteId: note.id });
          }
          if (!measured.channels.left.finite || !measured.channels.right.finite || Math.max(measured.channels.left.rms, measured.channels.right.rms) <= 0) {
            failures.push({ code: "native-note-probe-silent-or-nonfinite", key, noteId: note.id });
          }
          const onset = probeOnsetSeconds(probeBytes, measured);
          const captureStart = row.runtime?.captureStartContextTime;
          const origin = row.runtime?.selectedOrigin;
          if (!finite(captureStart) || !finite(origin) || !finite(onset)) {
            incomplete.push({ code: "native-note-onset-recompute-unavailable", key, noteId: note.id });
          } else {
            const expectedOnset = origin - captureStart + expectedNote.time;
            if (Math.abs(onset - expectedOnset) > timingTolerance) {
              failures.push({ code: "native-note-onset-from-audio-mismatch", key, noteId: note.id, expected: expectedOnset, actual: onset });
            }
            if (finite(note.audio.observedOnsetSeconds) && Math.abs(note.audio.observedOnsetSeconds - onset) > 1 / row.sampleRate) {
              failures.push({ code: "native-note-onset-claim-mismatch", key, noteId: note.id, claimed: note.audio.observedOnsetSeconds, actual: onset });
            } else if (!finite(note.audio.observedOnsetSeconds)) incomplete.push({ code: "native-note-onset-claim-missing", key, noteId: note.id });
          }
          const op = expectedNote.expectedOperators?.[0];
          const onsetContext = row.runtime?.selectedOrigin - row.runtime?.captureStartContextTime + expectedNote.time;
          const offContext = Number.isFinite(expectedNote.offTime)
            ? row.runtime?.selectedOrigin - row.runtime?.captureStartContextTime + expectedNote.offTime
            : null;
          const startWindow = onsetContext + Math.max((op?.attackSeconds || 0) + 0.02, 0.03);
          const endWindow = Math.min(onsetContext + 0.15, (offContext ?? Infinity) - 0.02);
          const supportDomain = expectedNote.expectedOperators?.length === 1 && !expectedNote.drum && op?.source === "oscillator" && op?.wave === "Sine" &&
            op?.holdSeconds === 0 && op?.decaySeconds === 0 && Math.abs(op?.sustainLevel - op?.level) < 1e-8 && options.expectedIdentity?.reverb === 0;
          const analysisWindow = note.audio.analysisWindow;
          if (!supportDomain) incomplete.push({ code: "native-note-analysis-domain-unsupported", key, noteId: note.id });
          if (!object(analysisWindow) || !finite(analysisWindow.startSeconds) || !finite(analysisWindow.endSeconds) ||
              Math.abs(analysisWindow.startSeconds - startWindow) > 1 / row.sampleRate || Math.abs(analysisWindow.endSeconds - endWindow) > 1 / row.sampleRate ||
              endWindow - startWindow < 0.03) {
            incomplete.push({ code: "native-note-analysis-window-unbound", key, noteId: note.id, expected: { startSeconds: startWindow, endSeconds: endWindow }, actual: analysisWindow ?? null });
          }
          const actualHz = supportDomain ? estimateProbeHz(probeBytes, measured, startWindow, endWindow) : null;
          const actualPurity = supportDomain ? sinePurity(probeBytes, measured, startWindow, endWindow) : null;
          if (expectedNote.expectedOperators?.[0]?.intent === "pitched") {
            if (!finite(actualHz) || !finite(actualPurity) || !finite(note.pitch?.measuredHz)) incomplete.push({ code: "native-note-pitch-recompute-unavailable", key, noteId: note.id });
            else if (Math.abs(actualHz - note.pitch.measuredHz) > Math.max(0.1, actualHz * 0.001)) failures.push({ code: "native-note-pitch-claim-mismatch", key, noteId: note.id, claimed: note.pitch.measuredHz, actual: actualHz });
          const minimumPurity = Math.max(MIN_SUPPORTED_SINE_PURITY, options.minSinePurity ?? MIN_SUPPORTED_SINE_PURITY);
          if (finite(actualPurity) && actualPurity < minimumPurity) failures.push({ code: "native-note-wave-purity-failure", key, noteId: note.id, actual: actualPurity, minimum: minimumPurity });
            if (finite(actualPurity) && finite(note.pitch?.sinePurity) && Math.abs(actualPurity - note.pitch.sinePurity) > 0.01) failures.push({ code: "native-note-purity-claim-mismatch", key, noteId: note.id, claimed: note.pitch.sinePurity, actual: actualPurity });
            const expectedHz = expectedNote.expectedFundamentalHz;
            if (finite(actualHz) && finite(expectedHz) && Math.abs(1200 * Math.log2(actualHz / expectedHz)) > pitchTolerance) failures.push({ code: "native-note-pitch-out-of-tolerance-from-audio", key, noteId: note.id, expectedHz, actualHz, tolerance: pitchTolerance });
          }
          if (object(note.envelope)) {
            const rms = Math.sqrt((measured.channels.left.rms ** 2 + measured.channels.right.rms ** 2) / 2);
            if (!finite(note.audio.rms) || Math.abs(note.audio.rms - rms) > Math.max(1e-7, 1e-5 * rms)) failures.push({ code: "native-note-rms-claim-mismatch", key, noteId: note.id, claimed: note.audio.rms ?? null, actual: rms });
            const localRms = probeRms(probeBytes, measured, startWindow, endWindow);
            if (!finite(localRms) || !finite(note.envelope.localRms)) incomplete.push({ code: "native-note-local-rms-recompute-unavailable", key, noteId: note.id });
            else if (Math.abs(localRms - note.envelope.localRms) > Math.max(1e-7, 1e-5 * localRms)) failures.push({ code: "native-note-local-rms-claim-mismatch", key, noteId: note.id, claimed: note.envelope.localRms, actual: localRms });
            const off = Number.isFinite(expectedNote.offTime) ? origin - captureStart + expectedNote.offTime : null;
            const measuredEnvelope = envelopeFeatures(probeBytes, measured, onset ?? 0, off);
            if (!measuredEnvelope || !finite(measuredEnvelope.attackSeconds) || !finite(measuredEnvelope.releaseSeconds)) {
              incomplete.push({ code: "native-note-envelope-recompute-unavailable", key, noteId: note.id });
            } else {
              if (Math.abs(measuredEnvelope.attackSeconds - note.envelope.attackSeconds) > 0.005 || Math.abs(measuredEnvelope.releaseSeconds - note.envelope.releaseSeconds) > 0.005) {
                failures.push({ code: "native-note-envelope-claim-mismatch", key, noteId: note.id, claimed: note.envelope, actual: measuredEnvelope });
              }
              const operator = expectedNote.expectedOperators?.[0];
              if (expectedNote.expectedOperators?.length !== 1 || expectedNote.drum || !operator || operator.source !== "oscillator" || operator.wave !== "Sine" ||
                  operator.holdSeconds !== 0 || operator.decaySeconds !== 0 || Math.abs(operator.sustainLevel - operator.level) > 1e-8 || options.expectedIdentity?.reverb !== 0) {
                incomplete.push({ code: "native-note-envelope-domain-unsupported", key, noteId: note.id });
              }
            }
          }
        } catch (error) {
          incomplete.push({ code: "native-note-probe-invalid", key, noteId: note.id, message: String(error?.message || error) });
        }
      }
    }
    for (const side of ["left", "right"]) {
      const metric = first.measurements.channels[side];
      if (!object(metric) || !finite(metric.peak) || !finite(metric.rms) || typeof metric.finite !== "boolean") {
        incomplete.push({ code: "native-channel-metric-null", key, side });
      }
    }
    if (options.validateArtifacts) {
      try {
        const bytes = readBoundedArtifact(options.root || process.cwd(), audio.path);
        if (sha256(bytes) !== audio.sha256) throw new Error("raw WAV SHA-256 does not match the result row");
        const measured = inspectFloatWav(bytes, row.sampleRate);
        if (audio.expectedFrames !== measured.frames) failures.push({ code: "native-audio-frame-count-mismatch", key, expected: audio.expectedFrames, actual: measured.frames });
        if (!finite(audio.durationSeconds) || Math.abs(audio.durationSeconds - measured.durationSeconds) > 1 / row.sampleRate) failures.push({ code: "native-audio-duration-mismatch", key, expected: audio.durationSeconds ?? null, actual: measured.durationSeconds });
        if (object(row.runtime) && (row.runtime.captureFrames !== measured.frames || !finite(row.runtime.captureDurationSeconds) || Math.abs(row.runtime.captureDurationSeconds - measured.durationSeconds) > 1 / row.sampleRate)) {
          failures.push({ code: "native-row-capture-duration-mismatch", key, expectedFrames: row.runtime.captureFrames ?? null, actualFrames: measured.frames, expectedDuration: row.runtime.captureDurationSeconds ?? null, actualDuration: measured.durationSeconds });
        }
        for (const side of ["left", "right"]) {
          const claimed = first.measurements.channels[side];
          const actual = measured.channels[side];
          if (!claimed || !finite(claimed.peak) || !finite(claimed.rms) || typeof claimed.finite !== "boolean") continue;
          const close = (a, b) => Math.abs(a - b) <= Math.max(1e-7, 1e-5 * Math.max(Math.abs(a), Math.abs(b)));
          if (claimed.finite !== actual.finite || !close(claimed.peak, actual.peak) || !close(claimed.rms, actual.rms)) {
            failures.push({ code: "native-channel-metric-mismatch", key, side, claimed, actual });
          }
          const maxPeak = finite(options.maxPeak) ? Math.min(MAX_SUPPORTED_AUDIO_PEAK, options.maxPeak) : MAX_SUPPORTED_AUDIO_PEAK;
          if (!actual.finite || actual.peak > maxPeak) failures.push({ code: "native-channel-sample-failure", key, side, actual, maxPeak });
          if (!(actual.rms > 0) || (finite(options.minRms) && actual.rms < options.minRms)) failures.push({ code: "native-channel-silent", key, side, actual, minRms: options.minRms ?? 0 });
        }
      } catch (error) {
        incomplete.push({ code: "native-audio-artifact-invalid", key, message: String(error?.message || error) });
      }
    }
  }
  for (const key of expected) if (!seen.has(key)) incomplete.push({ code: "native-row-missing", key });
  return { status: failures.length ? "fail" : incomplete.length ? "incomplete" : "pass", expectedRows: expected.size, seenRows: seen.size, failures, incomplete };
}

/** @param {string} root @param {string} rel @param {string} expected @param {string} label @param {Array<any>} incomplete @param {Array<any>} failures */
function verifyInput(root, rel, expected, label, incomplete, failures) {
  if (typeof rel !== "string" || !rel || !isSha(expected)) { incomplete.push({ code: "production-input-pin-missing", label }); return null; }
  const path = resolve(root, rel);
  const fromRoot = relative(resolve(root), path);
  if (isAbsolute(rel) || fromRoot === ".." || fromRoot.startsWith("../")) { failures.push({ code: "production-input-path-escapes-root", label, path: rel }); return null; }
  try {
    const bytes = readBoundedArtifact(root, rel);
    const actual = sha256(bytes);
    if (actual !== expected) failures.push({ code: "production-input-hash-mismatch", label, expected, actual });
    return bytes;
  } catch (error) {
    if (String(error?.message || error).includes("outside the repository root")) {
      failures.push({ code: "production-input-path-escapes-root", label, path: rel });
      return null;
    }
    incomplete.push({ code: "production-input-missing", label, path: rel, message: String(error?.message || error) });
    return null;
  }
}

/**
 * Verify reviewed production manifest and results against independently computed build pins.
 * The report's own `status` fields are ignored; aggregate status is recomputed from first attempts.
 * @param {{manifestText?: string | null, resultsText?: string | null, expected: Record<string, any>, root?: string, pairRuntimeResults?: Map<string, any>}} input
 */
export function validateProductionDocuments({ manifestText, resultsText, expected, root = process.cwd(), pairRuntimeResults }) {
  const failures = [];
  const incomplete = [];
  let manifest;
  let results;
  if (typeof manifestText !== "string") return { status: "incomplete", failures, incomplete: [{ code: "production-manifest-missing" }] };
  if (typeof resultsText !== "string") incomplete.push({ code: "production-results-missing" });
  try { manifest = JSON.parse(manifestText); } catch (error) { failures.push({ code: "production-manifest-json-invalid", message: String(error?.message || error) }); }
  if (typeof resultsText === "string") {
    try { results = JSON.parse(resultsText); } catch (error) { failures.push({ code: "production-results-json-invalid", message: String(error?.message || error) }); }
  }
  if (!object(manifest)) return { status: "fail", failures: [...failures, { code: "production-manifest-shape-invalid" }], incomplete };
  if (manifest.schema !== PRODUCTION_MANIFEST_SCHEMA || manifest.schemaVersion !== 1 || manifest.scope !== "production") failures.push({ code: "production-manifest-schema-mismatch" });
  if (manifest.qualification !== "qualified") incomplete.push({ code: "production-qualification-not-approved", qualification: manifest.qualification ?? null });
  if (!object(manifest.release) || typeof manifest.release.version !== "string" || !Number.isInteger(manifest.release.pageVersion)) {
    incomplete.push({ code: "production-release-pin-missing" });
  } else if (manifest.release.version !== expected.version || manifest.release.pageVersion !== expected.pageVersion) {
    failures.push({ code: "production-release-pin-mismatch" });
  }
  const runtime = manifest.runtime;
    if (!object(runtime)) incomplete.push({ code: "production-runtime-pins-missing" });
  else {
    for (const key of ["pageSha256", "engineMinSha256", "playerSha256", "settingsInstallerSha256"]) {
      if (!isSha(runtime[key])) incomplete.push({ code: "production-runtime-hash-missing", key });
      else if (runtime[key] !== expected[key]) failures.push({ code: "production-runtime-hash-stale", key, expected: expected[key], actual: runtime[key] });
    }
    if (!isSha(runtime.engineSourceSha256)) incomplete.push({ code: "production-source-engine-hash-missing" });
    else if (!isSha(expected.engineSourceSha256)) incomplete.push({ code: "production-source-engine-hash-unpinned" });
    else if (runtime.engineSourceSha256 !== expected.engineSourceSha256) failures.push({ code: "production-source-engine-hash-stale", expected: expected.engineSourceSha256, actual: runtime.engineSourceSha256 });
    if (typeof runtime.engineCommit !== "string" || !runtime.engineCommit) incomplete.push({ code: "production-engine-commit-missing" });
    else if (expected.engineCommit && runtime.engineCommit !== expected.engineCommit) failures.push({ code: "production-engine-commit-stale", expected: expected.engineCommit, actual: runtime.engineCommit });
    for (const key of ["horizonSeconds", "startupAnchorSeconds", "schedulerIntervalSeconds", "releaseRatio"]) {
      if (!finite(runtime[key]) || runtime[key] < 0) incomplete.push({ code: "production-timing-policy-missing", key });
    }
    if (!["legacy-startTime-before-first-engine-sync", "initialStartTime"].includes(runtime.originContract)) incomplete.push({ code: "production-origin-contract-missing" });
    for (const key of ["quality", "masterVol", "reverb", "liveVoiceBudget", "offlineVoiceBudget"]) {
      if (!Number.isInteger(runtime[key]) || runtime[key] < 0) incomplete.push({ code: "production-audio-budget-missing", key });
    }
    if (!object(runtime.setupConversion) || typeof runtime.setupConversion.id !== "string" || typeof runtime.setupConversion.version !== "string" || !isSha(runtime.setupConversion.sha256)) {
      incomplete.push({ code: "production-settings-conversion-unpinned" });
    } else if (typeof runtime.setupConversion.path !== "string") {
      incomplete.push({ code: "production-settings-conversion-artifact-missing" });
    } else {
      verifyInput(root, runtime.setupConversion.path, runtime.setupConversion.sha256, "setup-conversion", incomplete, failures);
      if (runtime.setupConversion.id !== SUPPORTED_SETTINGS_CONVERSION.id || runtime.setupConversion.version !== SUPPORTED_SETTINGS_CONVERSION.version) {
        incomplete.push({ code: "production-settings-conversion-unsupported", expected: SUPPORTED_SETTINGS_CONVERSION, actual: { id: runtime.setupConversion.id, version: runtime.setupConversion.version } });
      }
    }
    if (!object(runtime.builds) || !object(runtime.builds.source) || !object(runtime.builds.min) || !isSha(runtime.builds.source.sha256) || !isSha(runtime.builds.min.sha256)) {
      incomplete.push({ code: "production-build-matrix-hashes-missing" });
    } else if (runtime.builds.min.sha256 !== expected.engineMinSha256) {
      failures.push({ code: "production-min-build-hash-stale", expected: expected.engineMinSha256, actual: runtime.builds.min.sha256 });
    } else if (!isSha(expected.engineSourceSha256)) {
      incomplete.push({ code: "production-source-build-hash-unpinned" });
    } else if (runtime.builds.source.sha256 !== expected.engineSourceSha256) {
      failures.push({ code: "production-source-build-hash-stale", expected: expected.engineSourceSha256, actual: runtime.builds.source.sha256 });
    }
    for (const build of ["source", "min"]) {
      const artifact = runtime.builds?.[build];
      if (!artifact || typeof artifact.path !== "string") incomplete.push({ code: "production-build-artifact-path-missing", build });
      else verifyInput(root, artifact.path, artifact.sha256, `engine-${build}`, incomplete, failures);
    }
    if (isSha(runtime.engineSourceSha256) && isSha(runtime.builds?.source?.sha256) && runtime.engineSourceSha256 !== runtime.builds.source.sha256) {
      failures.push({ code: "production-source-build-hash-mismatch", expected: runtime.engineSourceSha256, actual: runtime.builds.source.sha256 });
    }
    if (!object(runtime.timingPolicyApproval) || typeof runtime.timingPolicyApproval.reference !== "string" || !runtime.timingPolicyApproval.reference) {
      incomplete.push({ code: "production-timing-policy-approval-missing" });
    }
    if (runtime.offlineVoiceBudget < runtime.liveVoiceBudget) incomplete.push({ code: "production-offline-budget-below-live" });
    if (object(expected.runtimeObservation)) {
      for (const key of ["horizonSeconds", "startupAnchorSeconds", "schedulerIntervalSeconds", "releaseRatio", "originContract"]) {
        const actual = runtime[key];
        const observed = expected.runtimeObservation[key];
        if (actual === undefined || actual === null) incomplete.push({ code: "production-measured-runtime-pin-missing", key });
        else if (observed === undefined || observed === null) incomplete.push({ code: "production-runtime-observation-field-missing", key });
        else if (actual !== observed) failures.push({ code: "production-measured-runtime-pin-mismatch", key, expected: observed, actual });
      }
    } else incomplete.push({ code: "production-runtime-observation-missing" });
  }
  const policy = manifest.policy;
  if (!object(policy) || policy.metricVersion !== "native-metrics-v1" || typeof policy.toleranceVersion !== "string" || !policy.toleranceVersion ||
      !finite(policy.maxPeak) || !finite(policy.minRms) || policy.minRms < 0 || !finite(policy.maxPitchCents) || policy.maxPitchCents < 0 ||
      !finite(policy.maxTimingErrorSeconds) || policy.maxTimingErrorSeconds < 0 || !finite(policy.minSinePurity) || policy.minSinePurity < 0 || policy.minSinePurity > 1) incomplete.push({ code: "production-metric-tolerances-missing" });
  else {
    if (policy.toleranceVersion !== SUPPORTED_TOLERANCE_VERSION) failures.push({ code: "production-tolerance-version-unsupported", expected: SUPPORTED_TOLERANCE_VERSION, actual: policy.toleranceVersion });
    if (policy.maxPeak > MAX_SUPPORTED_AUDIO_PEAK || policy.maxPitchCents > MAX_SUPPORTED_PITCH_CENTS ||
        policy.maxTimingErrorSeconds > MAX_SUPPORTED_TIMING_ERROR_SECONDS) {
      failures.push({ code: "production-tolerance-policy-too-permissive", ceilings: { maxPeak: MAX_SUPPORTED_AUDIO_PEAK, maxPitchCents: MAX_SUPPORTED_PITCH_CENTS, maxTimingErrorSeconds: MAX_SUPPORTED_TIMING_ERROR_SECONDS }, actual: { maxPeak: policy.maxPeak, maxPitchCents: policy.maxPitchCents, maxTimingErrorSeconds: policy.maxTimingErrorSeconds } });
    }
    if (policy.minSinePurity < MIN_SUPPORTED_SINE_PURITY) failures.push({ code: "production-sine-purity-policy-below-supported-floor", minimum: MIN_SUPPORTED_SINE_PURITY, actual: policy.minSinePurity });
  }
  if (!object(policy?.browserVersions) || REQUIRED_ENGINES.some((engine) => typeof policy.browserVersions[engine] !== "string" || !policy.browserVersions[engine])) {
    incomplete.push({ code: "production-browser-versions-unpinned" });
  }
  const browserToolchain = policy?.browserToolchain;
  if (!object(browserToolchain) || browserToolchain.schemaVersion !== 1 || typeof browserToolchain.playwrightCoreVersion !== "string" ||
      !browserToolchain.playwrightCoreVersion || !isSha(browserToolchain.browsersManifestSha256) || !object(browserToolchain.browsers)) {
    incomplete.push({ code: "production-browser-toolchain-unpinned" });
  } else {
    if (!isSha(browserToolchain.identitySha256)) incomplete.push({ code: "production-browser-toolchain-identity-missing" });
    else if (browserToolchain.identitySha256 !== expectedBrowserToolchainSha256(browserToolchain)) {
      failures.push({ code: "production-browser-toolchain-identity-mismatch", expected: expectedBrowserToolchainSha256(browserToolchain), actual: browserToolchain.identitySha256 });
    }
    for (const engine of REQUIRED_ENGINES) {
      const browser = browserToolchain.browsers[engine];
      const expectedBundle = expectedBrowserBundle(browserToolchain, engine);
      if (!expectedBundle) incomplete.push({ code: "production-browser-bundle-unpinned", engine });
      else if (!isSha(browser.identitySha256)) incomplete.push({ code: "production-browser-bundle-identity-missing", engine });
      else if (browser.identitySha256 !== expectedBundle.identitySha256) {
        failures.push({ code: "production-browser-bundle-identity-hash-mismatch", engine, expected: expectedBundle.identitySha256, actual: browser.identitySha256 ?? null });
      }
      if (expectedBundle && policy.browserVersions?.[engine] !== browser.browserVersion) {
        failures.push({ code: "production-browser-version-alias-mismatch", engine, expected: browser.browserVersion, actual: policy.browserVersions?.[engine] ?? null });
      }
    }
  }
  if (!object(policy) || !Array.isArray(policy.engines) || !Array.isArray(policy.builds) || !Array.isArray(policy.sampleRates) ||
      !sameSet(policy.engines, REQUIRED_ENGINES) || !sameSet(policy.builds, REQUIRED_BUILDS) || !sameSet(policy.sampleRates, REQUIRED_SAMPLE_RATES)) {
    failures.push({ code: "production-required-matrix-mismatch" });
  }
  if (!Array.isArray(manifest.pairs) || !manifest.pairs.length) incomplete.push({ code: "production-pairs-missing" });
  const pairs = Array.isArray(manifest.pairs) ? manifest.pairs : [];
  const pairIds = new Set();
  const reportPairs = object(results) && Array.isArray(results.pairs) ? results.pairs : [];
  if (!object(results)) incomplete.push({ code: "production-results-shape-missing" });
  else {
    if (results.schema !== PRODUCTION_RESULTS_SCHEMA || results.schemaVersion !== 1 || results.scope !== "production") failures.push({ code: "production-results-schema-mismatch" });
    if (results.manifestSha256 !== sha256(Buffer.from(manifestText))) failures.push({ code: "production-results-manifest-hash-mismatch" });
  }
  const reportPairIds = new Set();
  for (const reportPair of reportPairs) {
    const reportId = reportPair?.pairId;
    if (typeof reportId !== "string" || !reportId) { incomplete.push({ code: "production-result-pair-malformed" }); continue; }
    if (reportPairIds.has(reportId)) failures.push({ code: "production-result-pair-duplicate", pairId: reportId });
    reportPairIds.add(reportId);
  }
  for (const pair of pairs) {
    if (!object(pair) || typeof pair.id !== "string" || !pair.id) { incomplete.push({ code: "production-pair-malformed" }); continue; }
    if (pairIds.has(pair.id)) { failures.push({ code: "production-pair-duplicate", pairId: pair.id }); continue; }
    pairIds.add(pair.id);
    if (pair.composerApproval?.status !== "approved" || typeof pair.composerApproval?.reference !== "string" || !pair.composerApproval.reference) incomplete.push({ code: "production-composer-approval-missing", pairId: pair.id });
    const inputs = pair.inputs;
    if (!object(inputs)) { incomplete.push({ code: "production-pair-inputs-missing", pairId: pair.id }); continue; }
    const midi = verifyInput(root, inputs.midiPath, inputs.midiSha256, pair.id + ":midi", incomplete, failures);
    const setup = verifyInput(root, inputs.setupPath, inputs.setupSha256, pair.id + ":setup", incomplete, failures);
    const settingsBytes = verifyInput(root, inputs.settingsPath, inputs.settingsSha256, pair.id + ":settings", incomplete, failures);
    if (inputs.conversionSha256 !== runtime?.setupConversion?.sha256 || !runtime?.setupConversion?.id || !runtime?.setupConversion?.version) incomplete.push({ code: "production-pair-conversion-mismatch", pairId: pair.id });
    let expectedNotes = [];
    if (settingsBytes && isSha(inputs.canonicalSettingsSha256)) {
      try {
        const settings = JSON.parse(settingsBytes.toString("utf8"));
        if (sha256(Buffer.from(canonicalJson(settings))) !== inputs.canonicalSettingsSha256) failures.push({ code: "production-settings-canonical-hash-mismatch", pairId: pair.id });
        if (runtime && ["quality", "masterVol", "reverb", "liveVoiceBudget"].some((key) => settings[key === "masterVol" ? "master_vol" : key === "liveVoiceBudget" ? "voices" : key] !== runtime[key])) {
          failures.push({ code: "production-audio-settings-mismatch", pairId: pair.id });
        }
        if (midi) {
          const oracle = analyzeMidi(new Uint8Array(midi), settings, {
            horizonSeconds: runtime?.horizonSeconds,
            startupAnchorSeconds: runtime?.startupAnchorSeconds,
            schedulerIntervalSeconds: runtime?.schedulerIntervalSeconds,
            sampleRate: REQUIRED_SAMPLE_RATES[0], releaseRatio: runtime?.releaseRatio,
            eotHeldNotes: pair.eotHeldNotes,
            waveIntents: pair.waveIntents,
          });
          if (oracle.status === "fail") failures.push({ code: "production-oracle-failure", pairId: pair.id, failures: oracle.failures });
          if (oracle.status === "incomplete") incomplete.push({ code: "production-oracle-incomplete", pairId: pair.id, incomplete: oracle.incomplete });
          expectedNotes = oracle.notes.filter((note) => note.pass === 0);
          if (!expectedNotes.length) incomplete.push({ code: "production-pair-has-no-certifiable-notes", pairId: pair.id });
        }
      } catch (error) {
        failures.push({ code: "production-settings-invalid", pairId: pair.id, message: String(error?.message || error) });
      }
    } else if (settingsBytes) incomplete.push({ code: "production-canonical-settings-hash-missing", pairId: pair.id });

    const pairResult = reportPairs.find((row) => row?.pairId === pair.id);
    if (!pairResult) { incomplete.push({ code: "production-pair-results-missing", pairId: pair.id }); continue; }
    if (pairResult.midiSha256 !== inputs.midiSha256 || pairResult.setupSha256 !== inputs.setupSha256 || pairResult.settingsSha256 !== inputs.settingsSha256 ||
        pairResult.conversionSha256 !== runtime?.setupConversion?.sha256) failures.push({ code: "production-result-input-mismatch", pairId: pair.id });
    const actualRuntime = pairRuntimeResults?.get(pair.id);
    if (!actualRuntime) {
      incomplete.push({ code: "production-pair-consumer-runtime-missing", pairId: pair.id });
    } else {
      if (actualRuntime.status === "fail") failures.push({ code: "production-pair-consumer-runtime-failed", pairId: pair.id, details: actualRuntime.problems ?? [] });
      else if (actualRuntime.status !== "pass") incomplete.push({ code: "production-pair-consumer-runtime-incomplete", pairId: pair.id, details: actualRuntime.incomplete ?? actualRuntime.problems ?? [] });
      if (actualRuntime.firstAttempt !== true || actualRuntime.passesObserved !== 3 || actualRuntime.oracleStatus !== "pass" ||
          actualRuntime.stopConfirmed !== true || actualRuntime.reloadReplayConfirmed !== true ||
          !finite(actualRuntime.expectedMessages) || actualRuntime.expectedMessages < 1 || actualRuntime.observedMessages !== actualRuntime.expectedMessages ||
          !finite(actualRuntime.expectedNotes) || actualRuntime.expectedNotes < 1 || actualRuntime.observedNotes !== actualRuntime.expectedNotes) {
        incomplete.push({ code: "production-pair-consumer-runtime-coverage-incomplete", pairId: pair.id });
      }
      for (const field of ["midiSha256", "setupSha256", "settingsSha256", "conversionSha256"]) {
        const declared = field === "conversionSha256" ? runtime?.setupConversion?.sha256 : inputs[field];
        if (!isSha(actualRuntime.inputHashes?.[field])) incomplete.push({ code: "production-pair-consumer-runtime-input-unmeasured", pairId: pair.id, field });
        else if (actualRuntime.inputHashes[field] !== declared) failures.push({ code: "production-pair-consumer-runtime-input-mismatch", pairId: pair.id, field, expected: declared, actual: actualRuntime.inputHashes[field] });
      }
      const measured = actualRuntime.runtime;
      if (!object(measured)) incomplete.push({ code: "production-pair-consumer-runtime-measurements-missing", pairId: pair.id });
      else {
        for (const [field, expectedValue] of Object.entries({
          consumerVersion: expected.version, pageVersion: expected.pageVersion, pageSha256: expected.pageSha256,
          engineCommit: expected.engineCommit, engineEmbeddedSha256: expected.engineMinSha256,
          playerSourceSha256: expected.playerSha256, settingsInstallerSha256: expected.settingsInstallerSha256,
        })) {
          if (expectedValue === undefined || expectedValue === null) incomplete.push({ code: "production-pair-consumer-runtime-expected-pin-missing", pairId: pair.id, field });
          else if (measured[field] !== expectedValue) failures.push({ code: "production-pair-consumer-runtime-pin-mismatch", pairId: pair.id, field, expected: expectedValue, actual: measured[field] ?? null });
        }
        for (const field of ["horizonSeconds", "startupAnchorSeconds", "schedulerIntervalSeconds", "releaseRatio", "originContract"]) {
          const policyValue = expected.runtimeObservation?.[field];
          if (measured[field] === undefined || measured[field] === null || policyValue === undefined || policyValue === null) incomplete.push({ code: "production-pair-consumer-runtime-policy-unmeasured", pairId: pair.id, field });
          else if (measured[field] !== policyValue) failures.push({ code: "production-pair-consumer-runtime-policy-mismatch", pairId: pair.id, field, expected: policyValue, actual: measured[field] });
        }
      }
    }
    const matrix = validateNativeRows(pairResult.rows, {
      quality: pair.runtimePolicy?.quality ?? runtime?.quality,
      engines: policy?.engines,
      builds: policy?.builds,
      sampleRates: policy?.sampleRates,
      maxPeak: policy?.maxPeak,
      minRms: policy?.minRms,
      validateArtifacts: true,
      root,
      expectedNotes,
      runtimeObservation: expected.runtimeObservation,
      maxPitchCents: policy?.maxPitchCents,
      minSinePurity: policy?.minSinePurity,
      maxTimingErrorSeconds: policy?.maxTimingErrorSeconds,
      browserVersions: policy?.browserVersions,
      browserToolchain: policy?.browserToolchain,
      expectedIdentity: {
        version: expected.version,
        pageVersion: expected.pageVersion,
        engineCommit: expected.engineCommit,
        pageSha256: runtime?.pageSha256,
        playerSha256: runtime?.playerSha256,
        settingsInstallerSha256: runtime?.settingsInstallerSha256,
        midiSha256: inputs.midiSha256,
        setupSha256: inputs.setupSha256,
        settingsSha256: inputs.settingsSha256,
        conversionSha256: runtime?.setupConversion?.sha256,
        quality: runtime?.quality,
        masterVol: runtime?.masterVol,
        reverb: runtime?.reverb,
        voiceBudget: runtime?.liveVoiceBudget,
        offlineVoiceBudget: runtime?.offlineVoiceBudget,
        seed: inputs.seed,
        bufferVersion: inputs.bufferVersion,
      },
      buildHashes: { source: expected.engineSourceSha256, min: expected.engineMinSha256 },
    });
    failures.push(...matrix.failures.map((row) => ({ ...row, pairId: pair.id })));
    incomplete.push(...matrix.incomplete.map((row) => ({ ...row, pairId: pair.id })));
    if (matrix.status === "incomplete" && !matrix.incomplete.length) incomplete.push({ code: "production-native-matrix-incomplete", pairId: pair.id });
  }
  for (const reportPair of reportPairs) if (!pairIds.has(reportPair?.pairId)) failures.push({ code: "production-result-pair-unexpected", pairId: reportPair?.pairId ?? null });
  const deviceEvidence = manifest.deviceEvidence;
  if (!object(deviceEvidence) || deviceEvidence.schema !== "onchain-midi-player.device-audio-evidence" || deviceEvidence.schemaVersion !== 1) {
    incomplete.push({ code: "production-device-evidence-missing" });
  } else if (!Array.isArray(deviceEvidence.cases) || !deviceEvidence.cases.length || deviceEvidence.status !== "qualified") {
    incomplete.push({ code: "production-device-evidence-missing", status: deviceEvidence.status ?? null });
  } else {
    const coveredPairs = new Set();
    const deviceCaseIds = new Set();
    for (const deviceCase of deviceEvidence.cases) {
      const key = `${deviceCase?.pairId}/${deviceCase?.device?.id}/${deviceCase?.sampleRate}`;
      if (typeof deviceCase?.id !== "string" || !deviceCase.id || deviceCaseIds.has(deviceCase.id)) {
        failures.push({ code: "production-device-case-id-invalid-or-duplicate", id: deviceCase?.id ?? null });
      } else deviceCaseIds.add(deviceCase.id);
      const pair = pairs.find((item) => item?.id === deviceCase?.pairId);
      if (!pair) { failures.push({ code: "production-device-case-pair-unexpected", key }); continue; }
      coveredPairs.add(pair.id);
      if (!object(deviceCase.device) || typeof deviceCase.device.id !== "string" || !deviceCase.device.id ||
          typeof deviceCase.device.model !== "string" || !deviceCase.device.model || typeof deviceCase.device.osVersion !== "string" || !deviceCase.device.osVersion ||
          typeof deviceCase.device.audioRoute !== "string" || !deviceCase.device.audioRoute) {
        incomplete.push({ code: "production-device-identity-missing", key });
      }
      if (!REQUIRED_SAMPLE_RATES.includes(deviceCase.sampleRate)) incomplete.push({ code: "production-device-sample-rate-unsupported", key, sampleRate: deviceCase.sampleRate ?? null });
      const first = deviceCase.firstAttempt;
      if (!object(first) || first.attemptNumber !== 1 || first.complete !== true || !["pass", "fail", "incomplete"].includes(first.status)) {
        incomplete.push({ code: "production-device-first-attempt-incomplete", key });
        continue;
      }
      if (first.status === "fail") failures.push({ code: "production-device-first-attempt-failed", key, details: first.failures ?? [] });
      else if (first.status === "incomplete") incomplete.push({ code: "production-device-first-attempt-status-incomplete", key, details: first.incomplete ?? [] });
      for (const [field, declared] of Object.entries({
        midiSha256: pair.inputs?.midiSha256, setupSha256: pair.inputs?.setupSha256,
        settingsSha256: pair.inputs?.settingsSha256, conversionSha256: runtime?.setupConversion?.sha256,
      })) {
        if (!isSha(first.inputHashes?.[field])) incomplete.push({ code: "production-device-input-hash-missing", key, field });
        else if (first.inputHashes[field] !== declared) failures.push({ code: "production-device-input-hash-mismatch", key, field, expected: declared, actual: first.inputHashes[field] });
      }
      const audio = first.audio;
      if (!object(audio) || audio.format !== "float32-le-stereo" || typeof audio.path !== "string" || !isSha(audio.sha256) ||
          !Number.isInteger(audio.expectedFrames) || audio.expectedFrames <= 0 || !finite(audio.durationSeconds) ||
          !object(first.measurements) || !object(first.measurements.channels)) {
        incomplete.push({ code: "production-device-audio-unbound", key });
        continue;
      }
      try {
        const bytes = readBoundedArtifact(root, audio.path);
        if (sha256(bytes) !== audio.sha256) throw new Error("device recording SHA-256 does not match");
        const measured = inspectFloatWav(bytes, deviceCase.sampleRate);
        if (audio.expectedFrames !== measured.frames || Math.abs(audio.durationSeconds - measured.durationSeconds) > 1 / measured.sampleRate) {
          failures.push({ code: "production-device-audio-bounds-mismatch", key, expectedFrames: audio.expectedFrames, actualFrames: measured.frames, expectedDuration: audio.durationSeconds, actualDuration: measured.durationSeconds });
        }
        for (const side of ["left", "right"]) {
          const claimed = first.measurements.channels[side];
          const actual = measured.channels[side];
          if (!object(claimed) || !finite(claimed.peak) || !finite(claimed.rms) || typeof claimed.finite !== "boolean") {
            incomplete.push({ code: "production-device-channel-metric-missing", key, side });
            continue;
          }
          const close = (a, b) => Math.abs(a - b) <= Math.max(1e-7, 1e-5 * Math.max(Math.abs(a), Math.abs(b)));
          if (claimed.finite !== actual.finite || !close(claimed.peak, actual.peak) || !close(claimed.rms, actual.rms)) {
            failures.push({ code: "production-device-channel-metric-mismatch", key, side, claimed, actual });
          }
          const maxPeak = finite(policy?.maxPeak) ? Math.min(MAX_SUPPORTED_AUDIO_PEAK, policy.maxPeak) : MAX_SUPPORTED_AUDIO_PEAK;
          if (!actual.finite || actual.peak > maxPeak || !(actual.rms > 0) || (finite(policy?.minRms) && actual.rms < policy.minRms)) {
            failures.push({ code: "production-device-channel-audio-failure", key, side, actual });
          }
        }
      } catch (error) {
        incomplete.push({ code: "production-device-audio-invalid", key, message: String(error?.message || error) });
      }
    }
    for (const pair of pairs) if (pair?.id && !coveredPairs.has(pair.id)) incomplete.push({ code: "production-device-pair-coverage-missing", pairId: pair.id });
  }
  const status = failures.length ? "fail" : incomplete.length ? "incomplete" : "pass";
  return {
    schema: "onchain-midi-player.production-certification-result",
    schemaVersion: 1,
    scope: "production",
    status,
    firstAttemptOnly: true,
    manifestSha256: sha256(Buffer.from(manifestText)),
    resultSha256: typeof resultsText === "string" ? sha256(Buffer.from(resultsText)) : null,
    pairCount: pairs.length,
    failures,
    incomplete,
  };
}

/** @param {unknown[]} a @param {unknown[]} b */
function sameSet(a, b) { return a.length === b.length && new Set(a).size === a.length && b.every((value) => a.includes(value)); }
