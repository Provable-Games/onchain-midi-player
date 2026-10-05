// @ts-check
// Node tests for deployments/<network>.json: what is declared and deployed on each network. Every
// file has the same shape, its class's version is recorded in scripts/page_versions.json, and the
// example library-calls the class listed beside it.

import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { PAGE_VERSIONS_PATH } from "./page.mjs";

const DIR = new URL("../deployments/", import.meta.url);
const CHAIN_IDS = /** @type {Record<string, string>} */ ({ sepolia: "SN_SEPOLIA", mainnet: "SN_MAIN" });
/** A class hash, contract address or transaction hash: 0x and 64 lowercase hex digits. */
const FELT = /^0x[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;

const files = readdirSync(DIR).filter((name) => name.endsWith(".json"));
const versions = JSON.parse(readFileSync(PAGE_VERSIONS_PATH, "utf8"));

test("deployments/ has a file for Sepolia, and only known networks", () => {
  assert.ok(files.includes("sepolia.json"));
  for (const name of files) assert.ok(name.slice(0, -5) in CHAIN_IDS, `${name}: unknown network`);
});

for (const name of files) {
  test(`deployments/${name}: shape, hashes, the class's version and the example's class`, () => {
    const d = JSON.parse(readFileSync(new URL(name, DIR), "utf8"));
    assert.deepEqual(Object.keys(d), ["network", "chain_id", "class", "example"]);
    assert.equal(d.network, name.slice(0, -5));
    assert.equal(d.chain_id, CHAIN_IDS[d.network]);

    const c = d.class;
    assert.deepEqual(Object.keys(c), ["package", "contract", "version", "release_tag", "class_hash", "declare_tx", "built_from", "inspection_instance"]);
    assert.equal(c.package, "onchain_midi_player");
    assert.equal(c.contract, "OnchainTinySynth");
    assert.ok(versions[c.version], `${c.version} is recorded in scripts/page_versions.json`);
    // A release has the tag v<version>; null marks a test class, not for production.
    assert.ok(c.release_tag === null || c.release_tag === `v${c.version}`, `release_tag ${c.release_tag}`);
    assert.match(c.class_hash, FELT);
    assert.match(c.declare_tx, FELT);
    assert.match(c.built_from, COMMIT);
    assert.deepEqual(Object.keys(c.inspection_instance), ["address", "deploy_tx"]);
    assert.match(c.inspection_instance.address, FELT);
    assert.match(c.inspection_instance.deploy_tx, FELT);

    const e = d.example;
    assert.deepEqual(Object.keys(e), ["package", "contract", "class_hash", "declare_tx", "address", "deploy_tx", "player_class_hash", "built_from"]);
    assert.ok(existsSync(new URL(`../examples/${e.package}/Scarb.toml`, import.meta.url)), `examples/${e.package}`);
    for (const key of ["class_hash", "declare_tx", "address", "deploy_tx", "player_class_hash"]) assert.match(e[key], FELT, key);
    assert.match(e.built_from, COMMIT);
    assert.equal(e.player_class_hash, c.class_hash, "the example library-calls the class in the same file");
  });
}
