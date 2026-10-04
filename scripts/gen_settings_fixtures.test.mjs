// @ts-check
// The committed parity fixtures must be exactly what the generator produces now.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { CAIRO_PATH, JSON_PATH, generate, serde } from "./gen_settings_fixtures.mjs";

test("tests/fixtures/settings.json and tests/settings_fixtures.cairo are up to date", () => {
  const { json, cairo } = generate();
  assert.equal(readFileSync(JSON_PATH, "utf8"), json, "run node scripts/gen_settings_fixtures.mjs");
  assert.equal(readFileSync(CAIRO_PATH, "utf8"), cairo, "run node scripts/gen_settings_fixtures.mjs");
});

test("generation is deterministic", () => {
  const a = generate();
  const b = generate();
  assert.equal(a.json, b.json);
  assert.equal(a.cairo, b.cairo);
});

test("serde takes wave tables of any length (no argument-limit spread)", () => {
  const samples = Array(1000000).fill(-1);
  const felts = serde({ quality: 1, reverb: 30, master_vol: 40, voices: 64, waves: [{ Samples: samples }], timbres: [] });
  assert.equal(felts.length, 5 + 2 + 1000000 + 1);
  assert.deepEqual(felts.slice(0, 8), ["1", "30", "40", "64", "1", "1", "1000000", "-1"]);
});
