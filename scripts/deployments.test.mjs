// @ts-check
// Node tests for deployments/<network>.json: what is declared and deployed on each network. Every
// file has the same shape, its class's version is recorded in scripts/page_versions.json, its
// release_tag is null (a test class) or v<version>, and the example, when there is one, library-calls
// the class listed beside it. Mainnet holds releases only.

import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { PAGE_VERSIONS_PATH, isSemVer } from "./page.mjs";
import { RELEASE_CERTIFICATES_PATH, releaseCertificateDigest, releaseCertificateProblem } from "./certification/release.mjs";

const DIR = new URL("../deployments/", import.meta.url);
const CHAIN_IDS = /** @type {Record<string, string>} */ ({ sepolia: "SN_SEPOLIA", mainnet: "SN_MAIN" });
/** A class hash, contract address or transaction hash: 0x and 64 lowercase hex digits. */
const FELT = /^0x[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;

/**
 * What is wrong with a class's `release_tag`, or null. A release has the tag `v<version>`, with a
 * SemVer version; null marks a test class, which mainnet never holds.
 * @param {string} network
 * @param {string} version
 * @param {string | null} tag
 */
function releaseTagProblem(network, version, tag) {
  if (!isSemVer(version)) return `version ${version} is not SemVer`;
  if (tag === null) return network === "mainnet" ? "mainnet needs a release: release_tag is null" : null;
  if (typeof tag !== "string" || !tag.startsWith("v") || !isSemVer(tag.slice(1))) return `release_tag ${tag} is not v<SemVer>`;
  return tag === `v${version}` ? null : `release_tag ${tag} is not v${version}`;
}

const files = readdirSync(DIR).filter((name) => name.endsWith(".json"));
const versions = JSON.parse(readFileSync(PAGE_VERSIONS_PATH, "utf8"));
const releaseCertificates = JSON.parse(readFileSync(RELEASE_CERTIFICATES_PATH, "utf8"));

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
    assert.equal(c.contract, "TinySynth", "contract name");
    assert.ok(versions[c.version], `${c.version} is recorded in scripts/page_versions.json`);
    assert.equal(releaseTagProblem(d.network, c.version, c.release_tag), null);
    assert.equal(releaseCertificateProblem(c.version, c.release_tag, versions, releaseCertificates), null);
    assert.match(c.class_hash, FELT);
    assert.match(c.declare_tx, FELT);
    assert.match(c.built_from, COMMIT);
    assert.deepEqual(Object.keys(c.inspection_instance), ["address", "deploy_tx"]);
    assert.match(c.inspection_instance.address, FELT);
    assert.match(c.inspection_instance.deploy_tx, FELT);

    const e = d.example;
    if (e === null) return; // the example is optional
    assert.deepEqual(Object.keys(e), ["package", "contract", "class_hash", "declare_tx", "address", "deploy_tx", "player_class_hash", "built_from"]);
    assert.ok(existsSync(new URL(`../examples/${e.package}/Scarb.toml`, import.meta.url)), `examples/${e.package}`);
    for (const key of ["class_hash", "declare_tx", "address", "deploy_tx", "player_class_hash"]) assert.match(e[key], FELT, key);
    assert.match(e.built_from, COMMIT);
    assert.equal(e.player_class_hash, c.class_hash, "the example library-calls the class in the same file");
  });
}

test("release_tag: null for a test class off mainnet, otherwise v<version> with a SemVer version", () => {
  assert.equal(releaseTagProblem("sepolia", "0.3.0", null), null);
  assert.equal(releaseTagProblem("sepolia", "1.0.0", "v1.0.0"), null);
  assert.equal(releaseTagProblem("mainnet", "1.0.0", "v1.0.0"), null);
  assert.equal(releaseTagProblem("mainnet", "1.2.3-rc.1", "v1.2.3-rc.1"), null);
  assert.match(releaseTagProblem("mainnet", "1.0.0", null) ?? "", /mainnet needs a release/);
  assert.match(releaseTagProblem("sepolia", "1.0.0", "v1.0.1") ?? "", /not v1\.0\.0/);
  assert.match(releaseTagProblem("sepolia", "1.0.0", "1.0.0") ?? "", /not v<SemVer>/);
  assert.match(releaseTagProblem("sepolia", "1.0", "v1.0") ?? "", /not SemVer/);
  assert.match(releaseTagProblem("sepolia", "1.0.0", "v01.0.0") ?? "", /not v<SemVer>/);
});

test("stable deployment records require the certificate for that exact versioned page", () => {
  const firstHash = "a".repeat(64);
  const laterHash = "b".repeat(64);
  const manifestSha256 = "c".repeat(64);
  const resultsSha256 = "d".repeat(64);
  const versions = {
    "1.0.0": { page_sha256: firstHash },
    "1.1.0": { page_sha256: laterHash },
  };
  const certificates = {
    "1.0.0": {
      version: "1.0.0", pageSha256: firstHash, manifestSha256, resultsSha256,
      certificateSha256: releaseCertificateDigest("1.0.0", firstHash, manifestSha256, resultsSha256),
    },
  };
  assert.equal(releaseCertificateProblem("1.0.0", "v1.0.0", versions, certificates), null);
  assert.match(releaseCertificateProblem("1.1.0", "v1.1.0", versions, certificates) ?? "", /certificate record is missing/);
  assert.match(releaseCertificateProblem("1.0.0", "v1.0.0", { ...versions, "1.0.0": { page_sha256: laterHash } }, certificates) ?? "", /page hash differs/);
  assert.match(releaseCertificateProblem("1.0.0", "v1.1.0", versions, certificates) ?? "", /tag and certificate version/);
  // A later page does not rewrite the older release's page or certificate binding.
  assert.equal(releaseCertificateProblem("1.0.0", "v1.0.0", versions, certificates), null);
});
