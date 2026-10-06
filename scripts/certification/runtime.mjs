// @ts-nocheck
// Executes the actual page/player and the pinned embedded engine under the deterministic WebAudio
// node recorder. This is software scheduling evidence only: it does not render samples and never
// claims browser or device audio qualification.

import { readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { ENGINE_PIN } from "../engine.mjs";
import { dFragment, PAGE_VERSION, pageHtml, sha256, VERSION } from "../page.mjs";
import { runPage } from "../page_harness.mjs";
import { canonicalJson, SUPPORTED_SETTINGS_CONVERSION } from "./production.mjs";
import { analyzeMidi } from "./oracle.mjs";

const CLOSE = (a, b, abs = 1e-7, rel = 1e-7) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= Math.max(abs, rel * Math.max(Math.abs(a), Math.abs(b)));

/** @param {Record<string, any>} event */
function expectedMessage(event) {
  if (["tempo", "meta", "eot"].includes(event.kind)) return null;
  return event.kind === "sysex" ? [event.status, ...event.data] : [event.status, ...event.data];
}

/**
 * Finds the first per-operator envelope gain reachable from a source in this send() call's graph.
 * This checks the engine's created nodes, not its private song or voice arrays.
 * @param {Record<string, any>} observation
 * @param {string} sourceName
 */
function connectedGain(observation, sourceName) {
  const edges = new Map();
  for (const row of observation.audioLog) {
    if (row[1] !== "connect" || typeof row[2] !== "string") continue;
    if (!edges.has(row[0])) edges.set(row[0], []);
    edges.get(row[0]).push(row[2]);
  }
  const seen = new Set([sourceName]);
  const queue = [sourceName];
  while (queue.length) {
    const current = queue.shift();
    for (const next of edges.get(current) || []) {
      if (next.startsWith("gain#")) return next;
      if (!seen.has(next) && !next.includes(".")) { seen.add(next); queue.push(next); }
    }
  }
  return null;
}

/** @param {Record<string, any>} observation @param {string} gainName */
function firstPositiveGain(observation, gainName) {
  return observation.audioLog.find((entry) => entry[0] === gainName + ".gain" &&
    ["set", "ramp", "target"].includes(entry[1]) && Number.isFinite(entry[2]) && entry[2] > 0);
}

/** @param {unknown} a @param {unknown} b */
function sameJson(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

/**
 * Play one supported fixture through the real consumer PAGE, then compare its first-pass event and
 * source observations against the independently decoded MIDI/settings oracle.
 * @param {Uint8Array} midi
 * @param {Record<string, any>} settings
 * @param {{waveIntents?: Record<string, string>, passes?: number, runtimePasses?: number, eotHeldNotes?: "reject" | "carry", page?: string}} [options]
 */
export async function certifyFixtureRuntime(midi, settings, options = {}) {
  const requestedRuntimePasses = options.runtimePasses ?? options.passes ?? 3;
  const validRuntimePasses = Number.isInteger(requestedRuntimePasses) && requestedRuntimePasses >= 3 && requestedRuntimePasses <= 16;
  const runtimePasses = validRuntimePasses ? requestedRuntimePasses : 3;
  const fixedPage = options.page ?? pageHtml();
  const html = fixedPage + dFragment(midi, settings).d + "<svg/>";
  const harness = runPage(html, { engine: "real", sampleRate: 44100 });
  const problems = [];
  const incomplete = [];
  harness.ready();
  await harness.flush();
  if (!harness.engineLoaded) problems.push({ code: "engine-not-loaded", message: "the fixed page did not inflate its pinned engine" });
  if (harness.els.play.disabled) problems.push({ code: "play-not-enabled", message: "the actual player did not enable Play after initialization" });
  const sentBeforePlay = harness.synths[0]?.sendObservations.length ?? 0;
  harness.click();
  await harness.flush();
  const synth = harness.synths[0];
  if (!synth) return { status: "fail", firstAttempt: true, problems: [...problems, { code: "synth-not-created", message: "Play did not construct the real engine" }], incomplete };

  const ctx = synth.getAudioContext();
  const status = synth.getPlayStatus();
  const originFieldPresent = Object.hasOwn(status, "initialStartTime");
  const playInvocation = synth.playInvocations.at(-1);
  const invocationContextTime = playInvocation?.before.contextTime;
  const immediateOrigin = status.initialStartTime !== undefined && status.initialStartTime !== null
    ? status.initialStartTime
    : playInvocation?.after.startTime ?? status.startTime;
  const engineTimerMs = harness.intervalDelays[0];
  const invocationAnchorSeconds = Number.isFinite(immediateOrigin) && Number.isFinite(invocationContextTime)
    ? immediateOrigin - invocationContextTime
    : null;
  const runtime = {
    consumerVersion: VERSION,
    pageVersion: PAGE_VERSION,
    pageSha256: sha256(fixedPage),
    engineCommit: ENGINE_PIN.commit,
    engineEmbeddedSha256: ENGINE_PIN.sha256,
    playerSourceSha256: sha256(readFileSync(new URL("../../player/player.js", import.meta.url))),
    settingsInstallerSha256: sha256(readFileSync(new URL("../../player/settings.js", import.meta.url))),
    sampleRate: ctx.sampleRate,
    horizonSeconds: synth.preroll,
    startupAnchorSeconds: invocationAnchorSeconds,
    schedulerIntervalSeconds: Number.isFinite(engineTimerMs) ? engineTimerMs / 1000 : null,
    releaseRatio: synth.releaseRatio,
    originContract: originFieldPresent ? "initialStartTime" : "legacy-startTime-before-first-engine-sync",
    selectedOrigin: immediateOrigin,
    invocationContextTime,
    playInvocation,
    statusAtFirstPlay: status,
  };
  if (!(Number.isFinite(runtime.horizonSeconds) && runtime.horizonSeconds >= 0)) incomplete.push({ code: "runtime-horizon-unmeasured" });
  if (!(Number.isFinite(runtime.schedulerIntervalSeconds) && runtime.schedulerIntervalSeconds > 0)) incomplete.push({ code: "scheduler-interval-unmeasured" });
  if (!(Number.isFinite(runtime.releaseRatio) && runtime.releaseRatio >= 0)) incomplete.push({ code: "release-ratio-unmeasured" });
  if (!(Number.isFinite(immediateOrigin))) problems.push({ code: "play-origin-missing", message: "the actual engine exposes no usable current or initial tick-zero origin" });
  if (!(Number.isFinite(invocationContextTime))) incomplete.push({ code: "play-invocation-clock-unmeasured" });
  if (ctx.sampleRate !== 44100) problems.push({ code: "sample-rate-mismatch", expected: 44100, actual: ctx.sampleRate });

  const oracle = analyzeMidi(midi, settings, {
    passes: runtimePasses,
    eotHeldNotes: options.eotHeldNotes ?? "reject",
    horizonSeconds: runtime.horizonSeconds,
    startupAnchorSeconds: invocationAnchorSeconds,
    schedulerIntervalSeconds: runtime.schedulerIntervalSeconds,
    sampleRate: ctx.sampleRate,
    releaseRatio: runtime.releaseRatio,
    waveIntents: options.waveIntents || {},
  });
  if (!validRuntimePasses) incomplete.push({ code: "runtime-pass-count-invalid", actual: requestedRuntimePasses });
  if (!(Number.isFinite(oracle.loopSeconds) && oracle.loopSeconds > 0)) incomplete.push({ code: "runtime-loop-duration-unmeasured", actual: oracle.loopSeconds });
  const expected = Array.from({ length: runtimePasses }, (_, pass) => oracle.mergedOrder
    .map((event) => ({ event, message: expectedMessage(event), pass, time: event.seconds + pass * oracle.loopSeconds }))
    .filter((item) => item.message !== null)).flat();
  const sendableSeconds = expected.map((item) => item.time);
  const lastExpectedSeconds = Math.max(0, ...sendableSeconds);
  const neededSeconds = Math.max(runtime.schedulerIntervalSeconds || 0, immediateOrigin + lastExpectedSeconds - runtime.horizonSeconds + (runtime.schedulerIntervalSeconds || 0));
  const doNotOverrun = Math.min(65, neededSeconds);
  if (neededSeconds > 65) {
    incomplete.push({ code: "runtime-fixture-duration-cap", maxSeconds: 65, loopSeconds: oracle.loopSeconds });
  } else {
    harness.run(doNotOverrun, 0.005);
  }

  const allActual = synth.sendObservations.slice(sentBeforePlay);
  const firstEngineSync = harness.intervalObservations.find((item) => item.delay === engineTimerMs) || null;
  const selectedOrigin = originFieldPresent && Number.isFinite(status.initialStartTime)
    ? status.initialStartTime
    : Number.isFinite(firstEngineSync?.statusBefore?.startTime) ? firstEngineSync.statusBefore.startTime : immediateOrigin;
  runtime.selectedOrigin = selectedOrigin;
  runtime.firstEngineSync = firstEngineSync;
  runtime.startupAnchorSeconds = Number.isFinite(invocationContextTime) && Number.isFinite(selectedOrigin)
    ? selectedOrigin - invocationContextTime
    : null;
  if (!(Number.isFinite(runtime.startupAnchorSeconds) && runtime.startupAnchorSeconds >= 0)) incomplete.push({ code: "startup-anchor-unmeasured", measured: runtime.startupAnchorSeconds });
  if (Number.isFinite(immediateOrigin) && Number.isFinite(firstEngineSync?.statusBefore?.startTime) && !CLOSE(immediateOrigin, firstEngineSync.statusBefore.startTime, 1e-7, 1e-7)) {
    problems.push({ code: "origin-before-first-engine-tick-changed", afterPlayCall: immediateOrigin, beforeEngineTick: firstEngineSync.statusBefore.startTime });
  }
  const origin = selectedOrigin;
  const actualEvents = allActual.slice(0, expected.length);
  if (actualEvents.length !== expected.length) {
    problems.push({ code: "midi-message-count-across-passes", passes: runtimePasses, expected: expected.length, actual: actualEvents.length, observedTotal: allActual.length });
  }
  const actualByEvent = new Map();
  for (let i = 0; i < Math.min(actualEvents.length, expected.length); i++) {
    const actual = actualEvents[i];
    const want = expected[i];
    actualByEvent.set(want.pass + ":" + want.event.track + ":" + want.event.eventIndex, actual);
    const wantedAt = origin + want.time;
    if (!sameJson(actual.message, want.message)) problems.push({ code: "midi-message-order-or-data", index: i, event: want.event, expected: want.message, actual: actual.message });
    if (!CLOSE(actual.time, wantedAt, 1e-6, 1e-7)) problems.push({ code: "midi-scheduled-time", index: i, event: want.event, expected: wantedAt, actual: actual.time });
  }

  const expectedNotes = oracle.notes.filter((note) => note.pass < runtimePasses);
  const actualNoteOns = actualEvents.filter((item) => (item.message[0] & 0xf0) === 0x90 && item.message[2] > 0);
  if (actualNoteOns.length !== expectedNotes.length) problems.push({ code: "note-source-count-across-passes", expected: expectedNotes.length, actual: actualNoteOns.length });
  for (let n = 0; n < Math.min(actualNoteOns.length, expectedNotes.length); n++) {
    const observation = actualNoteOns[n];
    const note = expectedNotes[n];
    const sources = observation.nodes.filter((node) => node.kind === "osc" || node.kind === "src");
    if (sources.length !== note.expectedOperators.length) {
      problems.push({ code: "operator-source-count", noteId: note.id, expected: note.expectedOperators.length, actual: sources.length });
      continue;
    }
    for (let opIndex = 0; opIndex < Math.min(sources.length, note.expectedOperators.length); opIndex++) {
      const source = sources[opIndex];
      const op = note.expectedOperators[opIndex];
      const expectedKind = op.source === "oscillator" ? "osc" : op.source === "sample" ? "src" : null;
      if (!expectedKind) {
        incomplete.push({ code: "runtime-source-kind-unsupported", noteId: note.id, operator: opIndex, source: op.source });
        continue;
      }
      if (source.kind !== expectedKind) problems.push({ code: "operator-source-kind", noteId: note.id, operator: opIndex, expected: expectedKind, actual: source.kind });
      const expectedStart = origin + note.time;
      const actualStart = observation.audioLog.find((row) => row[0] === source.name && row[1] === "start");
      if (!actualStart || !CLOSE(actualStart[2], expectedStart, 1e-6, 1e-7)) {
        problems.push({ code: "operator-source-start", noteId: note.id, operator: opIndex, expected: expectedStart, actual: actualStart?.[2] ?? null });
      }
      const actualFrequency = source.kind === "src" ? source.playbackRate : source.frequencyHz;
      const expectedFrequency = source.kind === "src" ? op.playbackRate : op.frequencyHz;
      if (!CLOSE(actualFrequency, expectedFrequency, 1e-6, 1e-6)) {
        problems.push({ code: source.kind === "src" ? "sample-playback-rate" : "oscillator-frequency", noteId: note.id, operator: opIndex, expected: expectedFrequency, actual: actualFrequency });
      }
      if (!CLOSE(source.detuneCents, op.detuneCents, 1e-5, 1e-7)) {
        problems.push({ code: "operator-detune", noteId: note.id, operator: opIndex, expectedNormativeCents: op.detuneCents, actual: source.detuneCents, legacyEngineCents: op.legacyEngineDetuneCents });
      }
      const rawTimbre = settings.timbres.find((timbre) => note.drum ? timbre.drum && timbre.slot === note.key : !timbre.drum && timbre.slot === note.program);
      const rawWave = rawTimbre?.operators?.[opIndex]?.wave;
      if (typeof rawWave === "string" && op.source === "oscillator") {
        const expectedType = { Sine: "sine", Square: "square", Sawtooth: "sawtooth", Triangle: "triangle" }[rawWave];
        if (expectedType && source.waveType !== expectedType) problems.push({ code: "oscillator-wave-identity", noteId: note.id, operator: opIndex, expected: expectedType, actual: source.waveType });
        else if (!expectedType) incomplete.push({ code: "runtime-wave-identity-unverified", noteId: note.id, operator: opIndex, wave: rawWave });
      } else if (rawWave && typeof rawWave === "object" && Number.isInteger(rawWave.Custom)) {
        const waveDef = settings.waves[rawWave.Custom];
        if (waveDef?.Samples) {
          const registration = synth.waveRegistrations.find((entry) => entry.method === "setSampleWave" && entry.name === "nS" + rawWave.Custom);
          const expectedBufferId = registration?.createdBufferIds?.[0];
          const expectedHomeHz = op.homeHz;
          if (!expectedBufferId || source.bufferId !== expectedBufferId) problems.push({ code: "sample-wave-buffer-identity", noteId: note.id, operator: opIndex, expectedBufferId: expectedBufferId ?? null, actualBufferId: source.bufferId });
          if (!CLOSE(source.bufferHomeHz, expectedHomeHz, 1e-6, 1e-6)) problems.push({ code: "sample-wave-home-rate", noteId: note.id, operator: opIndex, expected: expectedHomeHz, actual: source.bufferHomeHz });
        } else if (waveDef?.Harmonics) {
          const actualWave = source.periodicWave;
          const expectedImag = [0, ...waveDef.Harmonics];
          const expectedReal = expectedImag.map(() => 0);
          if (!actualWave || !sameJson(actualWave.real, expectedReal) || !sameJson(actualWave.imag, expectedImag)) {
            problems.push({ code: "harmonic-wave-identity", noteId: note.id, operator: opIndex, expectedReal, expectedImag, actual: actualWave ?? null });
          }
        } else incomplete.push({ code: "runtime-custom-wave-identity-unverified", noteId: note.id, operator: opIndex, wave: rawWave.Custom });
      } else if (op.source === "sample") {
        incomplete.push({ code: "runtime-builtin-noise-buffer-identity-unverified", noteId: note.id, operator: opIndex, wave: op.wave });
      }

      const gainName = connectedGain(observation, source.name);
      const attack = gainName ? firstPositiveGain(observation, gainName) : null;
      if (!attack || !CLOSE(attack[2], op.level, 1e-6, 1e-6)) {
        problems.push({ code: "operator-gain-target", noteId: note.id, operator: opIndex, expected: op.level, actual: attack?.[2] ?? null });
      }
      if (attack && !CLOSE(attack[3], expectedStart + op.attackSeconds, 1e-6, 1e-7)) {
        problems.push({ code: "operator-attack-time", noteId: note.id, operator: opIndex, expected: expectedStart + op.attackSeconds, actual: attack[3] });
      }
      if (op.holdSeconds !== 0 || op.decaySeconds !== 0 || op.sustainLevel !== op.level) {
        incomplete.push({ code: "runtime-complex-envelope-unverified", noteId: note.id, operator: opIndex, holdSeconds: op.holdSeconds, decaySeconds: op.decaySeconds, sustainLevel: op.sustainLevel });
      }
    const offKey = note.offEvent && note.pass + ":" + note.offEvent.track + ":" + note.offEvent.index;
      const offObservation = offKey ? actualByEvent.get(offKey) : null;
      if (note.offTime !== null && !note.drum) {
        const releaseEvent = offObservation?.audioLog.find((row) => row[0] === gainName + ".gain" && row[1] === "target" && row[2] === 0);
        const expectedOff = origin + note.offTime;
        if (!releaseEvent || !CLOSE(releaseEvent[3], expectedOff, 1e-6, 1e-7) || !CLOSE(releaseEvent[4], op.releaseSeconds, 1e-6, 1e-6)) {
          problems.push({ code: "operator-release-envelope", noteId: note.id, operator: opIndex, expectedAt: expectedOff, expectedTau: op.releaseSeconds, actual: releaseEvent ?? null });
        }
      } else if (note.drum) incomplete.push({ code: "runtime-percussion-envelope-unverified", noteId: note.id });
    }
  }

  const installCalls = harness.certificationCalls.map((call) => call[0]);
  const waveCalls = settings.waves.map((wave) => "Samples" in wave ? "setSampleWave" : "setHarmonicWave");
  const requiredInstallCalls = ["new", ...waveCalls, "setQuality", "setMasterVol", "setReverbLev", "setVoices", ...settings.timbres.map(() => "setTimbre")];
  if (!sameJson(installCalls.slice(0, requiredInstallCalls.length), requiredInstallCalls)) {
    problems.push({ code: "settings-install-order", expected: requiredInstallCalls, actual: installCalls.slice(0, requiredInstallCalls.length) });
  }
  const initialPlayback = installCalls.slice(requiredInstallCalls.length, requiredInstallCalls.length + 4);
  if (!sameJson(initialPlayback, ["loadMIDI", "setLoop", "setLoopEnd", "playMIDI"])) {
    problems.push({ code: "play-install-order", expected: ["loadMIDI", "setLoop", "setLoopEnd", "playMIDI"], actual: initialPlayback });
  }

  // Exercise the actual UI's Stop then Play-again path. The second play must reload the MIDI and
  // receive a fresh origin. This is part of the observed first attempt's lifecycle checks.
  const priorOrigin = selectedOrigin;
  harness.click();
  await harness.flush();
  const stopped = synth.getPlayStatus();
  if (stopped.play !== 0 || !harness.calls.some((call) => call[0] === "stopMIDI")) problems.push({ code: "stop-path", status: stopped });
  const callsBeforeReplay = harness.calls.length;
  harness.click();
  await harness.flush();
  const replayCalls = harness.calls.slice(callsBeforeReplay).map((call) => call[0]);
  const replayStatus = synth.getPlayStatus();
  if (!sameJson(replayCalls, ["loadMIDI", "setLoop", "setLoopEnd", "playMIDI"])) problems.push({ code: "reload-replay-order", expected: ["loadMIDI", "setLoop", "setLoopEnd", "playMIDI"], actual: replayCalls });
  const replayOrigin = replayStatus.initialStartTime !== undefined && replayStatus.initialStartTime !== null
    ? replayStatus.initialStartTime : replayStatus.startTime;
  if (!Number.isFinite(replayOrigin) || replayOrigin === priorOrigin) problems.push({ code: "replay-origin", prior: priorOrigin, replay: replayOrigin });

  if (harness.consoleErrors.length) problems.push({ code: "page-console-error", errors: harness.consoleErrors });
  if (harness.uncaught.length) problems.push({ code: "page-uncaught-error", errors: harness.uncaught });
  if (oracle.status === "fail") problems.push({ code: "oracle-known-failure", failures: oracle.failures });
  if (oracle.status === "incomplete") incomplete.push(...oracle.incomplete.map((item) => ({ code: "oracle-" + item.code, details: item })));
  return {
    schema: "onchain-midi-player.fixture-runtime-result",
    schemaVersion: 1,
    scope: "fixture",
    status: problems.length ? "fail" : incomplete.length ? "incomplete" : "pass",
    firstAttempt: true,
    nativeAudio: false,
    runtime,
    installAndPlayback: {
      calls: harness.certificationCalls.map((call) => call[0]),
      pageErrors: harness.consoleErrors,
      uncaught: harness.uncaught,
      passesObserved: runtimePasses,
      expectedMessagesAcrossPasses: expected.length,
      observedMessagesAcrossPasses: actualEvents.length,
      expectedNotesAcrossPasses: expectedNotes.length,
      observedNotesAcrossPasses: actualNoteOns.length,
      stopConfirmed: stopped.play === 0 && harness.calls.some((call) => call[0] === "stopMIDI"),
      reloadReplayConfirmed: sameJson(replayCalls, ["loadMIDI", "setLoop", "setLoopEnd", "playMIDI"]) && Number.isFinite(replayOrigin) && replayOrigin !== priorOrigin,
    },
    oracle: { status: oracle.status, demand: oracle.demand, failures: oracle.failures, incomplete: oracle.incomplete },
    problems,
    incomplete,
  };
}

function readPinnedPairFile(rootValue, pathValue) {
  if (typeof pathValue !== "string" || !pathValue || isAbsolute(pathValue)) throw new Error("pair evidence path must be a relative repository path");
  const root = realpathSync(resolve(rootValue));
  const path = realpathSync(resolve(root, pathValue));
  const fromRoot = relative(root, path);
  if (fromRoot === ".." || fromRoot.startsWith("../")) throw new Error("pair evidence path escapes the repository root");
  if (statSync(path).size > 64 * 1024 * 1024) throw new Error("pair evidence input exceeds the 64 MiB certification cap");
  return readFileSync(path);
}

/**
 * Run every manifest pair through the actual built page/player/settings installer. The returned
 * map is computed in-process from exact pinned bytes; it is never loaded from a result JSON file.
 * It checks three loop passes, the independent event/note oracle, Stop and replay behavior.
 */
export async function certifyProductionPairRuntimes(manifestText, { page = pageHtml(), root = process.cwd() } = {}) {
  const results = new Map();
  let manifest;
  try { manifest = JSON.parse(manifestText); }
  catch { return results; }
  if (manifest?.scope !== "production" || !Array.isArray(manifest.pairs)) return results;
  for (const pair of manifest.pairs) {
    if (typeof pair?.id !== "string" || !pair.id) continue;
    const inputs = pair.inputs;
    const runtimePins = manifest.runtime;
    if (!inputs || !runtimePins?.setupConversion) {
      results.set(pair.id, { status: "incomplete", firstAttempt: true, problems: [{ code: "pair-runtime-input-pins-missing" }] });
      continue;
    }
    try {
      const midi = readPinnedPairFile(root, inputs.midiPath);
      const setup = readPinnedPairFile(root, inputs.setupPath);
      const settingsBytes = readPinnedPairFile(root, inputs.settingsPath);
      const conversion = readPinnedPairFile(root, runtimePins.setupConversion.path);
      const inputHashes = {
        midiSha256: sha256(midi), setupSha256: sha256(setup), settingsSha256: sha256(settingsBytes), conversionSha256: sha256(conversion),
      };
      const expectedHashes = {
        midiSha256: inputs.midiSha256, setupSha256: inputs.setupSha256,
        settingsSha256: inputs.settingsSha256, conversionSha256: runtimePins.setupConversion.sha256,
      };
      const stale = Object.keys(expectedHashes).filter((key) => inputHashes[key] !== expectedHashes[key]);
      if (stale.length) {
        results.set(pair.id, { status: "fail", firstAttempt: true, inputHashes, expectedHashes, problems: [{ code: "pair-runtime-input-hash-stale", fields: stale }] });
        continue;
      }
      if (runtimePins.setupConversion.id !== SUPPORTED_SETTINGS_CONVERSION.id || runtimePins.setupConversion.version !== SUPPORTED_SETTINGS_CONVERSION.version) {
        results.set(pair.id, { status: "incomplete", firstAttempt: true, inputHashes, problems: [{ code: "pair-runtime-conversion-unsupported", expected: SUPPORTED_SETTINGS_CONVERSION, actual: { id: runtimePins.setupConversion.id, version: runtimePins.setupConversion.version } }] });
        continue;
      }
      let settings;
      let setupObject;
      try {
        settings = JSON.parse(settingsBytes.toString("utf8"));
        setupObject = JSON.parse(setup.toString("utf8"));
      }
      catch (error) {
        results.set(pair.id, { status: "fail", firstAttempt: true, inputHashes, problems: [{ code: "pair-runtime-settings-invalid", message: String(error?.message || error) }] });
        continue;
      }
      if (canonicalJson(setupObject) !== canonicalJson(settings)) {
        results.set(pair.id, { status: "fail", firstAttempt: true, inputHashes, problems: [{ code: "pair-setup-settings-semantic-mismatch", conversion: SUPPORTED_SETTINGS_CONVERSION.id }] });
        continue;
      }
      const run = await certifyFixtureRuntime(new Uint8Array(midi), settings, {
        page, runtimePasses: 3, passes: 3,
        eotHeldNotes: pair.eotHeldNotes ?? "reject", waveIntents: pair.waveIntents || {},
      });
      results.set(pair.id, {
        status: run.status,
        firstAttempt: true,
        inputHashes,
        expectedHashes,
        passesObserved: run.installAndPlayback.passesObserved,
        expectedMessages: run.installAndPlayback.expectedMessagesAcrossPasses,
        observedMessages: run.installAndPlayback.observedMessagesAcrossPasses,
        expectedNotes: run.installAndPlayback.expectedNotesAcrossPasses,
        observedNotes: run.installAndPlayback.observedNotesAcrossPasses,
        stopConfirmed: run.installAndPlayback.stopConfirmed,
        reloadReplayConfirmed: run.installAndPlayback.reloadReplayConfirmed,
        oracleStatus: run.oracle.status,
        runtime: run.runtime,
        problems: run.problems,
        incomplete: run.incomplete,
      });
    } catch (error) {
      results.set(pair.id, { status: "incomplete", firstAttempt: true, problems: [{ code: "pair-runtime-input-unavailable", message: String(error?.message || error) }] });
    }
  }
  return results;
}
