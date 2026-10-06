// @ts-check
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { BEND_RANGE_MIDI, GOOD_MIDI, SHORT_LOOP_LONG_TAIL_MIDI, SIMPLE_SETTINGS } from "./fixtures.mjs";
import { certifyFixtureRuntime, certifyProductionPairRuntimes } from "./runtime.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function pairManifest(root, setupValue = SIMPLE_SETTINGS) {
  const midi = Buffer.from(GOOD_MIDI);
  const setup = Buffer.from(JSON.stringify(setupValue));
  const settings = Buffer.from(JSON.stringify(SIMPLE_SETTINGS));
  const conversion = Buffer.from("reviewed identity mapping: setup wire JSON equals installer settings JSON\n");
  writeFileSync(join(root, "song.mid"), midi);
  writeFileSync(join(root, "setup.json"), setup);
  writeFileSync(join(root, "settings.json"), settings);
  writeFileSync(join(root, "conversion-policy.txt"), conversion);
  return JSON.stringify({
    schema: "onchain-midi-player.production-certification-manifest", schemaVersion: 1, scope: "production",
    runtime: { setupConversion: { id: "wire-json-identity", version: "1", path: "conversion-policy.txt", sha256: sha256(conversion) } },
    pairs: [{
      id: "pair-test", eotHeldNotes: "reject", waveIntents: {},
      inputs: {
        midiPath: "song.mid", midiSha256: sha256(midi),
        setupPath: "setup.json", setupSha256: sha256(setup),
        settingsPath: "settings.json", settingsSha256: sha256(settings),
      },
    }],
  });
}

describe("real consumer-page fixture runtime evidence", () => {
  test("the first attempt follows the real install, event, source, Stop and replay paths", async () => {
    const report = await certifyFixtureRuntime(GOOD_MIDI, SIMPLE_SETTINGS);
    assert.equal(report.status, "pass", JSON.stringify(report.problems));
    assert.equal(report.scope, "fixture");
    assert.equal(report.nativeAudio, false);
    assert.equal(report.firstAttempt, true);
    assert.equal(report.runtime.horizonSeconds, 0.2);
    assert.equal(report.runtime.startupAnchorSeconds, 0.1);
    assert.equal(report.runtime.schedulerIntervalSeconds, 0.06);
    assert.equal(report.runtime.originContract, "legacy-startTime-before-first-engine-sync");
    assert.equal(report.installAndPlayback.passesObserved, 3);
    assert.equal(report.installAndPlayback.expectedMessagesAcrossPasses, 24);
    assert.equal(report.installAndPlayback.observedMessagesAcrossPasses, 24);
    assert.equal(report.installAndPlayback.expectedNotesAcrossPasses, 9);
    assert.equal(report.installAndPlayback.observedNotesAcrossPasses, 9);
    assert.equal(report.installAndPlayback.stopConfirmed, true);
    assert.equal(report.installAndPlayback.reloadReplayConfirmed, true);
    assert.ok(report.installAndPlayback.calls.includes("stopMIDI"));
  });

  test("a 50 ms loop uses the pre-scheduler tick-zero origin when the first engine tick queues later passes", async () => {
    const report = await certifyFixtureRuntime(SHORT_LOOP_LONG_TAIL_MIDI, { ...SIMPLE_SETTINGS, voices: 128 });
    assert.equal(report.status, "pass", JSON.stringify(report.problems));
    assert.equal(report.runtime.selectedOrigin, 0.1);
    assert.equal(report.runtime.startupAnchorSeconds, 0.1);
    assert.equal(report.runtime.firstEngineSync.statusBefore.startTime, 0.1);
    assert.ok(report.runtime.firstEngineSync.statusAfter.startTime > report.runtime.firstEngineSync.statusBefore.startTime);
    assert.equal(report.installAndPlayback.passesObserved, 3);
    assert.equal(report.installAndPlayback.observedMessagesAcrossPasses, 9);
    assert.equal(report.installAndPlayback.observedNotesAcrossPasses, 3);
  });

  test("the actual pinned engine fails a normative RPN0 bend fixture despite matching the legacy model", async () => {
    const report = await certifyFixtureRuntime(BEND_RANGE_MIDI, SIMPLE_SETTINGS);
    assert.equal(report.status, "fail");
    assert.ok(report.problems.some((problem) => problem.code === "operator-detune"));
    assert.equal(report.nativeAudio, false);
    assert.ok(report.incomplete.some((item) => item.code === "oracle-rpn-bend-range-unqualified"));
  });

  test("production pair runner installs exact page inputs, checks three passes, Stop/reload and setup identity", async () => {
    const root = mkdtempSync(join(tmpdir(), "a3-pair-runtime-"));
    try {
      const manifest = pairManifest(root);
      const results = await certifyProductionPairRuntimes(manifest, { root });
      const proof = results.get("pair-test");
      assert.equal(proof.status, "pass", JSON.stringify(proof.problems));
      assert.equal(proof.passesObserved, 3);
      assert.equal(proof.expectedMessages, proof.observedMessages);
      assert.equal(proof.expectedNotes, proof.observedNotes);
      assert.equal(proof.stopConfirmed, true);
      assert.equal(proof.reloadReplayConfirmed, true);
      assert.equal(proof.runtime.pageSha256.length, 64);

      const mutatedRoot = mkdtempSync(join(tmpdir(), "a3-pair-mutated-"));
      try {
        const changedSetup = { ...SIMPLE_SETTINGS, master_vol: 91 };
        const mutatedManifest = pairManifest(mutatedRoot, changedSetup);
        const rejected = await certifyProductionPairRuntimes(mutatedManifest, { root: mutatedRoot });
        assert.equal(rejected.get("pair-test").status, "fail");
        assert.ok(rejected.get("pair-test").problems.some((item) => item.code === "pair-setup-settings-semantic-mismatch"));
      } finally {
        rmSync(mutatedRoot, { recursive: true, force: true });
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
