// @ts-check
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { expectedReleasePins, checkReleaseEvidenceForBuild, releaseGateRequired } from "./release.mjs";
import { canonicalJson, REQUIRED_BUILDS, REQUIRED_ENGINES, REQUIRED_SAMPLE_RATES, measureIsolatedSineProbe, validateNativeRows, validateProductionDocuments } from "./production.mjs";
import { ENGINE_PIN } from "../engine.mjs";
import { releaseVersionsForCheck } from "../build_page.mjs";
import { certifyProductionPairRuntimes } from "./runtime.mjs";

const cli = new URL("./cli.mjs", import.meta.url);
const manifestPath = new URL("./production-manifest.v1.json", import.meta.url);
const baseManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const hash = (letter) => letter.repeat(64);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function testBrowserToolchain(versions = { chromium: "test-chromium", firefox: "test-firefox", webkit: "test-webkit" }, browserOverrides = {}, toolchainOverrides = {}) {
  const toolchain = {
    schemaVersion: 1,
    playwrightCoreVersion: toolchainOverrides.playwrightCoreVersion || "1.63.0-test",
    browsersManifestSha256: toolchainOverrides.browsersManifestSha256 || hash("b"),
    browsers: {},
  };
  for (const engine of REQUIRED_ENGINES) {
    const browser = {
      revision: `test-${engine}-revision`, bundleId: `${engine}-test-revision`, browserVersion: versions[engine] || `test-${engine}`,
      ...browserOverrides[engine],
    };
    const identity = {
      schemaVersion: 1, engine, ...browser,
      playwrightCoreVersion: toolchain.playwrightCoreVersion,
      browsersManifestSha256: toolchain.browsersManifestSha256,
    };
    toolchain.browsers[engine] = { ...browser, identitySha256: sha256(Buffer.from(canonicalJson(identity))) };
  }
  toolchain.identitySha256 = sha256(Buffer.from(canonicalJson({
    schemaVersion: toolchain.schemaVersion,
    playwrightCoreVersion: toolchain.playwrightCoreVersion,
    browsersManifestSha256: toolchain.browsersManifestSha256,
    browsers: toolchain.browsers,
  })));
  return toolchain;
}

function testBrowserBundle(toolchain, engine) {
  const browser = toolchain.browsers[engine];
  return {
    schemaVersion: 1, engine, ...browser,
    playwrightCoreVersion: toolchain.playwrightCoreVersion,
    browsersManifestSha256: toolchain.browsersManifestSha256,
  };
}

function row(engine, build, sampleRate) {
  const browserToolchain = testBrowserToolchain();
  const browserBundle = testBrowserBundle(browserToolchain, engine);
  return {
    engine, build, sampleRate, engineVersion: browserBundle.browserVersion, quality: 1, browserBundle,
    firstAttempt: {
      attemptNumber: 1, complete: true, status: "pass", browserBundle: structuredClone(browserBundle),
      audio: { format: "float32-le-stereo", sha256: hash("a"), path: "missing.wav" },
      measurements: { channels: {
        left: { peak: 0.5, rms: 0.1, finite: true },
        right: { peak: 0.5, rms: 0.1, finite: true },
      }, notes: [] },
    },
  };
}

function matrix() {
  return REQUIRED_ENGINES.flatMap((engine) => REQUIRED_BUILDS.flatMap((build) => REQUIRED_SAMPLE_RATES.map((rate) => row(engine, build, rate))));
}

function runCli(...args) {
  const child = spawnSync(process.execPath, [cli.pathname, ...args], { cwd: process.cwd(), encoding: "utf8", timeout: 10000 });
  assert.equal(child.error, undefined, String(child.error));
  assert.equal(child.signal, null, child.stderr);
  return { status: child.status, output: JSON.parse(child.stdout), stderr: child.stderr };
}

function floatStereoWav(sampleRate, seconds, signal) {
  const frames = Math.round(sampleRate * seconds);
  const data = Buffer.alloc(frames * 8);
  for (let frame = 0; frame < frames; frame++) {
    const sample = signal(frame / sampleRate);
    data.writeFloatLE(sample, frame * 8);
    data.writeFloatLE(sample, frame * 8 + 4);
  }
  const wav = Buffer.alloc(44 + data.length);
  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVE", 8, "ascii");
  wav.write("fmt ", 12, "ascii");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(3, 20);
  wav.writeUInt16LE(2, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 8, 28);
  wav.writeUInt16LE(8, 32);
  wav.writeUInt16LE(32, 34);
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(data.length, 40);
  data.copy(wav, 44);
  return wav;
}

function nativeSineCase(shape = "sine") {
  const sampleRate = 44100;
  const origin = 0.1;
  const captureStart = 0;
  const noteTime = 0.05;
  const offTime = 0.5;
  const attackSeconds = 0.005;
  const releaseSeconds = 0.05;
  const absoluteOnset = origin - captureStart + noteTime;
  const absoluteOff = origin - captureStart + offTime;
  const windowStart = absoluteOnset + Math.max(attackSeconds + 0.02, 0.03);
  const windowEnd = Math.min(absoluteOnset + 0.15, absoluteOff - 0.02);
  const frequency = shape === "wrong-octave" ? 880 : shape === "wrong-pitch" ? 494 : 440;
  const signal = (time) => {
    if (time < absoluteOnset) return 0;
    let env = time < absoluteOnset + attackSeconds
      ? (time - absoluteOnset) / attackSeconds
      : time < absoluteOff ? 1 : Math.exp(-(time - absoluteOff) / releaseSeconds);
    const phase = ((time - absoluteOnset) * frequency) % 1;
    const wave = shape === "triangle" ? 1 - 4 * Math.abs(phase - 0.5) : Math.sin(phase * 2 * Math.PI);
    if (shape === "silence") return 0;
    return 0.1 * env * wave;
  };
  return { sampleRate, origin, captureStart, absoluteOnset, absoluteOff, noteTime, offTime, attackSeconds, releaseSeconds, windowStart, windowEnd, frequency, signal };
}

function validateNativeSine(shape = "sine", mutate = null, maxPitchCents = 25, maxTimingErrorSeconds = 0.01) {
  const root = mkdtempSync(join(tmpdir(), "a3-native-probe-"));
  try {
    const fixture = nativeSineCase(shape);
    let wav = floatStereoWav(fixture.sampleRate, 1, fixture.signal);
    if (mutate === "truncate") wav = wav.subarray(0, wav.length - 8);
    writeFileSync(join(root, "probe.wav"), wav);
    const digest = sha256(wav);
    let observed;
    try { observed = measureIsolatedSineProbe(wav, fixture.sampleRate, fixture.windowStart, fixture.windowEnd, fixture.absoluteOff); }
    catch { observed = null; }
    const frames = Math.floor((wav.length - 44) / 8);
    const durationSeconds = frames / fixture.sampleRate;
    const channels = observed?.channels || {
      left: { peak: 0, rms: 0, finite: true }, right: { peak: 0, rms: 0, finite: true },
    };
    const expectedNote = {
      id: "track0-event0", track: 0, eventIndex: 0, channel: 0, key: 69, program: 0, time: fixture.noteTime, offTime: fixture.offTime,
      expectedFundamentalHz: 440,
      expectedOperators: [{ intent: "pitched", source: "oscillator", wave: "Sine", attackSeconds: fixture.attackSeconds,
        holdSeconds: 0, decaySeconds: 0, sustainLevel: 1, level: 1, releaseSeconds: fixture.releaseSeconds }],
    };
    const runtime = {
      horizonSeconds: 0.5, startupAnchorSeconds: 0.1, schedulerIntervalSeconds: 0.06,
      releaseRatio: 0.5, originContract: "initialStartTime", selectedOrigin: fixture.origin,
      captureStartContextTime: fixture.captureStart, captureFrames: frames, captureDurationSeconds: durationSeconds,
    };
    const note = {
      id: expectedNote.id, status: "pass",
      identity: { track: 0, eventIndex: 0, channel: 0, key: 69, program: 0, onsetSeconds: fixture.noteTime + (mutate === "late-onset-record" ? 0.05 : 0) },
      envelope: {
        attackSeconds: observed?.envelope?.attackSeconds ?? 0.005,
        releaseSeconds: observed?.envelope?.releaseSeconds ?? 0.05,
        localRms: observed?.localRms ?? 0.05, confidence: 1,
      },
      pitch: {
        methodVersion: "sine-fit-v1", measuredHz: observed?.frequencyHz ?? 440,
        centsError: observed?.frequencyHz ? 1200 * Math.log2(observed.frequencyHz / 440) : 0,
        sinePurity: observed?.sinePurity ?? 1,
      },
      audio: {
        path: "probe.wav", sha256: digest, isolated: true, firstAttempt: true,
        expectedFrames: frames, durationSeconds,
        observedOnsetSeconds: observed?.onsetSeconds ?? fixture.absoluteOnset,
        analysisWindow: { startSeconds: fixture.windowStart, endSeconds: fixture.windowEnd },
        rms: observed?.fullRms ?? 0.05,
      },
    };
    const browserToolchain = testBrowserToolchain({ chromium: "probe-engine" });
    const browserBundle = testBrowserBundle(browserToolchain, "chromium");
    const rowValue = {
      engine: "chromium", build: "source", sampleRate: fixture.sampleRate, engineVersion: "probe-engine", browserBundle,
      quality: 1, reverb: 0, engineSha256: hash("e"),
      runtime,
      firstAttempt: {
        attemptNumber: 1, complete: true, status: "pass", browserBundle: structuredClone(browserBundle), runtime: { ...runtime },
        audio: { format: "float32-le-stereo", sha256: digest, path: "probe.wav", expectedFrames: frames, durationSeconds },
        measurements: { channels, notes: [note] },
      },
    };
    const result = validateNativeRows([rowValue], {
      quality: 1, engines: ["chromium"], builds: ["source"], sampleRates: [fixture.sampleRate],
      browserVersions: { chromium: "probe-engine" }, browserToolchain, maxPeak: 1, minRms: 0, minSinePurity: 0.995,
      maxPitchCents, maxTimingErrorSeconds, validateArtifacts: true, root,
      expectedNotes: [expectedNote], expectedIdentity: { reverb: 0 }, buildHashes: { source: hash("e") },
      runtimeObservation: {
        horizonSeconds: runtime.horizonSeconds, startupAnchorSeconds: runtime.startupAnchorSeconds,
        schedulerIntervalSeconds: runtime.schedulerIntervalSeconds, releaseRatio: runtime.releaseRatio,
        originContract: runtime.originContract,
      },
    });
    return { result, observed, wav };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("production certification is versioned, bound and fail-closed", () => {
  test("fixture CLI passes the supported control and gives an actual nonzero known-bad result", () => {
    const good = runCli("--scope", "fixture", "--case", "good");
    assert.equal(good.status, 0, good.stderr);
    assert.equal(good.output.scope, "fixture");
    assert.equal(good.output.firstAttempt, true);
    assert.equal(good.output.nativeAudio, false);

    const bad = runCli("--scope", "fixture", "--case", "bend-known-bad");
    assert.equal(bad.status, 1, bad.stderr);
    assert.equal(bad.output.status, "fail");
    assert.ok(bad.output.problems.some((problem) => problem.code === "operator-detune"));
  });

  test("empty checked-in production manifest returns exit 2 with zero pairs, never a vacuous pass", () => {
    const result = runCli("--scope", "production");
    assert.equal(result.status, 2, result.stderr);
    assert.equal(result.output.status, "incomplete");
    assert.equal(result.output.pairCount, 0);
    assert.ok(result.output.incomplete.some((item) => item.code === "production-pairs-missing"));
    assert.ok(result.output.incomplete.some((item) => item.code === "production-device-evidence-missing"));
  });

  test("0.x bypasses; stable and prerelease majors require evidence and fail closed on missing files", async () => {
    assert.equal(releaseGateRequired("0.9.9"), false);
    assert.equal(releaseGateRequired("1.0.0-rc.1"), true);
    assert.equal((await checkReleaseEvidenceForBuild({ version: "0.3.0" })).status, "bypass");
    const stable = await checkReleaseEvidenceForBuild({ version: "1.0.0" });
    assert.equal(stable.required, true);
    assert.equal(stable.status, "incomplete");
    assert.ok(stable.incomplete.some((item) => item.code === "production-pairs-missing"));
  });

  test("page and engine/player source pins are computed from the actual consumer files", () => {
    const pins = expectedReleasePins();
    for (const key of ["pageSha256", "engineMinSha256", "engineSourceSha256", "playerSha256", "settingsInstallerSha256"]) assert.match(pins[key], /^[0-9a-f]{64}$/);
    assert.equal(pins.engineSourceSha256, ENGINE_PIN.sourceSha256);
    assert.match(pins.engineCommit, /^[0-9a-f]{40}$/);
    assert.notEqual(pins.playerSha256, hash("0"));
  });

  test("source-build reports bind to the independently reviewed source pin", () => {
    const pins = expectedReleasePins();
    const selfAsserted = structuredClone(baseManifest);
    selfAsserted.runtime = {
      engineSourceSha256: hash("f"), engineCommit: pins.engineCommit,
      builds: { source: { sha256: hash("f") }, min: { sha256: pins.engineMinSha256 } },
    };
    const result = validateProductionDocuments({ manifestText: JSON.stringify(selfAsserted), resultsText: null, expected: pins });
    assert.ok(result.failures.some((item) => item.code === "production-source-engine-hash-stale"));
    assert.ok(result.failures.some((item) => item.code === "production-source-build-hash-stale"));

    const wrongRow = row("chromium", "source", 44100);
    wrongRow.engineSha256 = hash("f");
    const rowResult = validateNativeRows([wrongRow], {
      quality: 1, engines: ["chromium"], builds: ["source"], sampleRates: [44100],
      buildHashes: { source: pins.engineSourceSha256 },
    });
    assert.ok(rowResult.failures.some((item) => item.code === "native-row-engine-hash-mismatch"));
  });

  test("permissive or unversioned native tolerances cannot widen release acceptance", () => {
    const widened = structuredClone(baseManifest);
    widened.policy = {
      ...widened.policy, toleranceVersion: "invented-pass-policy", maxPeak: 2,
      minRms: 0, maxPitchCents: 1200, maxTimingErrorSeconds: 10, minSinePurity: 0.5,
    };
    const result = validateProductionDocuments({ manifestText: JSON.stringify(widened), resultsText: null, expected: expectedReleasePins() });
    assert.ok(result.failures.some((item) => item.code === "production-tolerance-version-unsupported"));
    assert.ok(result.failures.some((item) => item.code === "production-tolerance-policy-too-permissive"));
    assert.ok(result.failures.some((item) => item.code === "production-sine-purity-policy-below-supported-floor"));
  });

  test("manifest and pair-runtime inputs reject symlinks that escape the evidence root", async () => {
    const root = mkdtempSync(join(tmpdir(), "a3-input-root-"));
    const outsideRoot = mkdtempSync(join(tmpdir(), "a3-input-outside-"));
    try {
      const outsidePath = join(outsideRoot, "conversion.json");
      const linkPath = join(root, "linked-conversion.json");
      writeFileSync(outsidePath, "{}\n");
      symlinkSync(outsidePath, linkPath);
      const inputHash = sha256(Buffer.from("{}\n"));
      const manifest = {
        ...structuredClone(baseManifest),
        runtime: { setupConversion: { id: "wire-json-identity", version: "1", path: "linked-conversion.json", sha256: inputHash } },
        pairs: [{ id: "pair-a", inputs: { midiPath: "linked-conversion.json" } }],
      };
      const validated = validateProductionDocuments({ manifestText: JSON.stringify(manifest), resultsText: null, expected: expectedReleasePins(), root });
      assert.ok(validated.failures.some((item) => item.code === "production-input-path-escapes-root"));

      const runtime = await certifyProductionPairRuntimes(JSON.stringify(manifest), { root });
      assert.equal(runtime.get("pair-a")?.status, "incomplete");
      assert.match(runtime.get("pair-a")?.problems?.[0]?.message || "", /escapes the repository root/);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outsideRoot, { recursive: true, force: true });
    }
  });

  test("stale, fixture-only, null and duplicate result bindings cannot qualify production", () => {
    const pins = expectedReleasePins();
    const stale = structuredClone(baseManifest);
    stale.runtime = { pageSha256: hash("f"), engineMinSha256: pins.engineMinSha256, playerSha256: pins.playerSha256, settingsInstallerSha256: pins.settingsInstallerSha256 };
    stale.release = { version: pins.version, pageVersion: pins.pageVersion };
    const staleResult = validateProductionDocuments({ manifestText: JSON.stringify(stale), resultsText: null, expected: pins });
    assert.equal(staleResult.status, "fail");
    assert.ok(staleResult.failures.some((item) => item.code === "production-runtime-hash-stale"));

    const fixture = { ...structuredClone(baseManifest), scope: "fixture" };
    const fixtureResult = validateProductionDocuments({ manifestText: JSON.stringify(fixture), resultsText: null, expected: pins });
    assert.notEqual(fixtureResult.status, "pass");
    assert.ok(fixtureResult.failures.some((item) => item.code === "production-manifest-schema-mismatch"));

    const duplicated = { ...structuredClone(baseManifest), pairs: [{ id: "pair-a" }] };
    const reports = { schema: "onchain-midi-player.production-certification-results", schemaVersion: 1, scope: "production", manifestSha256: "0".repeat(64), pairs: [{ pairId: "pair-a" }, { pairId: "pair-a" }] };
    const duplicateResult = validateProductionDocuments({ manifestText: JSON.stringify(duplicated), resultsText: JSON.stringify(reports), expected: pins });
    assert.equal(duplicateResult.status, "fail");
    assert.ok(duplicateResult.failures.some((item) => item.code === "production-result-pair-duplicate"));
  });

  test("native matrix requires all 12 exact tuples and complete non-null first-attempt metrics", () => {
    const rows = matrix();
    const repeatedChromium = [...rows, structuredClone(rows[0])];
    const duplicate = validateNativeRows(repeatedChromium, { quality: 1 });
    assert.equal(duplicate.status, "fail");
    assert.ok(duplicate.failures.some((item) => item.code === "native-row-duplicate"));

    const missing = validateNativeRows(rows.slice(1), { quality: 1 });
    assert.equal(missing.status, "incomplete");
    assert.ok(missing.incomplete.some((item) => item.code === "native-row-missing"));

    const nullMetricRows = matrix();
    nullMetricRows[0].firstAttempt.measurements.channels.left.rms = null;
    const nullMetric = validateNativeRows(nullMetricRows, { quality: 1 });
    assert.equal(nullMetric.status, "incomplete");
    assert.ok(nullMetric.incomplete.some((item) => item.code === "native-channel-metric-null"));

    const failedFirstRows = matrix();
    failedFirstRows[0].firstAttempt.status = "fail";
    failedFirstRows[0].firstAttempt.failures = [{ code: "first-crack" }];
    failedFirstRows[0].diagnostics = [{ attemptNumber: 2, status: "pass" }];
    const firstFailure = validateNativeRows(failedFirstRows, { quality: 1 });
    assert.equal(firstFailure.status, "fail");
    assert.ok(firstFailure.failures.some((item) => item.code === "native-first-attempt-failed"));
  });

  test("native rows bind browser revision, toolchain digest and first-attempt bundle across same-version builds", () => {
    const browserToolchain = testBrowserToolchain();
    const good = row("chromium", "source", 44100);
    const options = {
      quality: 1, engines: ["chromium"], builds: ["source"], sampleRates: [44100],
      browserVersions: { chromium: browserToolchain.browsers.chromium.browserVersion }, browserToolchain,
    };
    const changedRevision = structuredClone(good);
    changedRevision.browserBundle.revision = "chromium-9999";
    const revisionResult = validateNativeRows([changedRevision], options);
    assert.ok(revisionResult.failures.some((item) => item.code === "native-row-browser-bundle-mismatch"));

    const sameVersionDifferentBundle = structuredClone(good);
    sameVersionDifferentBundle.browserBundle.bundleId = "chromium-headless-shell-test-revision";
    const bundleResult = validateNativeRows([sameVersionDifferentBundle], options);
    assert.ok(bundleResult.failures.some((item) => item.code === "native-row-browser-bundle-mismatch"));

    const wrongSchema = structuredClone(good);
    wrongSchema.browserBundle.schemaVersion = 2;
    const schemaResult = validateNativeRows([wrongSchema], options);
    assert.ok(schemaResult.failures.some((item) => item.code === "native-row-browser-bundle-mismatch"));

    const changedFirstAttempt = structuredClone(good);
    changedFirstAttempt.firstAttempt.browserBundle.browsersManifestSha256 = hash("c");
    const firstAttemptResult = validateNativeRows([changedFirstAttempt], options);
    assert.ok(firstAttemptResult.failures.some((item) => item.code === "native-first-attempt-browser-bundle-mismatch"));

    const firstAttemptWrongSchema = structuredClone(good);
    firstAttemptWrongSchema.firstAttempt.browserBundle.schemaVersion = 2;
    const firstAttemptSchemaResult = validateNativeRows([firstAttemptWrongSchema], options);
    assert.ok(firstAttemptSchemaResult.failures.some((item) => item.code === "native-first-attempt-browser-bundle-mismatch"));

    const badToolchain = structuredClone(baseManifest);
    const declaredToolchain = testBrowserToolchain();
    badToolchain.policy.browserVersions = Object.fromEntries(REQUIRED_ENGINES.map((engine) => [engine, declaredToolchain.browsers[engine].browserVersion]));
    badToolchain.policy.browserToolchain = { ...declaredToolchain, identitySha256: hash("c") };
    const toolchainResult = validateProductionDocuments({ manifestText: JSON.stringify(badToolchain), resultsText: null, expected: expectedReleasePins() });
    assert.ok(toolchainResult.failures.some((item) => item.code === "production-browser-toolchain-identity-mismatch"));
  });

  test("Chromium headless-shell install ID is distinct from the same-version full-browser install", () => {
    const browsersManifestSha256 = "545d52f8382c391e605562c330e9c1c534a16045898203037a49bb8bd769a946";
    const chromiumIdentitySha256 = "5812bd73b73d2367209eb81b14aaef7da8a489dde4ce38f55bf8dcc72f6bd796";
    const browserToolchain = testBrowserToolchain({ chromium: "153.0.8010.12" }, {
      chromium: { revision: "1243", bundleId: "chromium_headless_shell-1243" },
    }, { playwrightCoreVersion: "1.63.0", browsersManifestSha256 });
    const expectedBundle = testBrowserBundle(browserToolchain, "chromium");
    assert.equal(expectedBundle.identitySha256, chromiumIdentitySha256);
    const sourceRow = row("chromium", "source", 44100);
    sourceRow.engineVersion = expectedBundle.browserVersion;
    sourceRow.browserBundle = structuredClone(expectedBundle);
    sourceRow.firstAttempt.browserBundle = structuredClone(expectedBundle);
    const wrongInstall = structuredClone(sourceRow);
    wrongInstall.browserBundle.bundleId = "chromium-1243";
    const result = validateNativeRows([wrongInstall], {
      quality: 1, engines: ["chromium"], builds: ["source"], sampleRates: [44100],
      browserVersions: { chromium: "153.0.8010.12" }, browserToolchain,
    });
    assert.ok(result.failures.some((item) => item.code === "native-row-browser-bundle-mismatch"));
  });

  test("narrow raw-PCM sine domain has a real positive and rejects wave, pitch, silence and malformed mutations", () => {
    const good = validateNativeSine("sine");
    assert.equal(good.result.status, "pass", JSON.stringify(good.result));
    assert.ok(good.observed.sinePurity >= 0.999);

    const triangle = validateNativeSine("triangle");
    assert.equal(triangle.result.status, "fail", JSON.stringify(triangle.result));
    assert.ok(triangle.result.failures.some((item) => item.code === "native-note-wave-purity-failure"));

    const wrongPitch = validateNativeSine("wrong-pitch");
    assert.equal(wrongPitch.result.status, "fail", JSON.stringify(wrongPitch.result));
    assert.ok(wrongPitch.result.failures.some((item) => item.code === "native-note-pitch-out-of-tolerance-from-audio"));

    const widenedPitch = validateNativeSine("wrong-pitch", null, 1200);
    assert.equal(widenedPitch.result.status, "fail", JSON.stringify(widenedPitch.result));
    assert.ok(widenedPitch.result.failures.some((item) => item.code === "native-note-pitch-out-of-tolerance-from-audio"));

    const wrongOctave = validateNativeSine("wrong-octave");
    assert.equal(wrongOctave.result.status, "fail", JSON.stringify(wrongOctave.result));
    assert.ok(wrongOctave.result.failures.some((item) => item.code === "native-note-pitch-out-of-tolerance-from-audio"));

    const widenedTiming = validateNativeSine("sine", "late-onset-record", 25, 1);
    assert.equal(widenedTiming.result.status, "fail", JSON.stringify(widenedTiming.result));
    assert.ok(widenedTiming.result.failures.some((item) => item.code === "native-note-intent-identity-mismatch"));

    const silence = validateNativeSine("silence");
    assert.equal(silence.result.status, "fail", JSON.stringify(silence.result));
    assert.ok(silence.result.failures.some((item) => item.code === "native-note-probe-silent-or-nonfinite"));
    assert.ok(silence.result.failures.some((item) => item.code === "native-channel-silent"));

    const malformed = validateNativeSine("sine", "truncate");
    assert.notEqual(malformed.result.status, "pass");
    assert.ok(malformed.result.incomplete.some((item) => item.code === "native-note-probe-invalid"));
  });

  test("build_page --check checks the actual candidate plus any stricter preflight target", () => {
    const script = new URL("../build_page.mjs", import.meta.url);
    const child = spawnSync(process.execPath, [script.pathname, "--check", "--check-release-version", "1.0.0"], {
      cwd: process.cwd(), encoding: "utf8", timeout: 30000,
    });
    assert.equal(child.error, undefined, String(child.error));
    assert.equal(child.signal, null, child.stderr);
    assert.equal(child.status, 2, `${child.stdout}\n${child.stderr}`);
    assert.match(child.stderr, /release certification incomplete for 1\.0\.0:/);
    assert.match(child.stderr, /production-pairs-missing/);

    const invalid = spawnSync(process.execPath, [script.pathname, "--check-release-version", "1.0.0"], {
      cwd: process.cwd(), encoding: "utf8", timeout: 10000,
    });
    assert.equal(invalid.status, 2);
    assert.match(invalid.stderr, /requires --check/);

    assert.deepEqual(releaseVersionsForCheck("0.3.0"), ["0.3.0"]);
    assert.deepEqual(releaseVersionsForCheck("0.3.0", "1.0.0"), ["0.3.0", "1.0.0"]);
    assert.deepEqual(releaseVersionsForCheck("1.0.0"), ["1.0.0"]);
    assert.throws(() => releaseVersionsForCheck("1.0.0", "0.3.0"), /cannot weaken candidate version/);
    assert.deepEqual(releaseVersionsForCheck("1.0.0", "1.1.0"), ["1.0.0", "1.1.0"]);
  });
});
