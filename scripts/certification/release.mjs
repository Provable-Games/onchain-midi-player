// @ts-nocheck
// Stable-version evidence hook for independent library artifacts and the composed reference NFT.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ENGINE_PIN, ENGINE_BUILD } from "../engine.mjs";
import { VERSION, SEGMENT_FORMAT, MANIFEST_PATH, isSemVer, sha256 } from "../segments.mjs";
import { consumerPage, libraryRecord, libraryHash } from "./composition.mjs";
import { GOOD_MIDI, SIMPLE_SETTINGS } from "./fixtures.mjs";
import { validateProductionDocuments } from "./production.mjs";
import { certifyFixtureRuntime, certifyProductionPairRuntimes } from "./runtime.mjs";
export const PRODUCTION_MANIFEST_PATH = new URL("./production-manifest.v1.json", import.meta.url);
export const PRODUCTION_RESULTS_PATH = new URL("./production-results.v1.json", import.meta.url);
export const RELEASE_CERTIFICATES_PATH = new URL("./release-certificates.v1.json", import.meta.url);
export function releaseGateRequired(version) {
  const match = /^(\d+)\./.exec(version); return !!match && BigInt(match[1]) >= 1n;
}
export function releaseVersionsForCheck(actualVersion, requestedVersion = null) {
  if (!isSemVer(actualVersion)) throw Error(`actual candidate version ${actualVersion} is not SemVer`);
  if (requestedVersion === null) return [actualVersion];
  if (!isSemVer(requestedVersion)) throw Error(`requested release version ${requestedVersion} is not SemVer`);
  if (BigInt(requestedVersion.split(".")[0]) < BigInt(actualVersion.split(".")[0])) throw Error(`requested release version ${requestedVersion} cannot weaken candidate version ${actualVersion}`);
  return actualVersion === requestedVersion ? [actualVersion] : [actualVersion, requestedVersion];
}
export function releaseCertificateDigest(version, librarySha256, manifestSha256, resultsSha256) {
  return sha256([version, librarySha256, manifestSha256, resultsSha256].join("\n"));
}
export function releaseCertificateProblem(version, tag, versions, certificates) {
  if (tag === null || !releaseGateRequired(version)) return null;
  const record = versions[version]; if (!record) return `${version}: library version record is missing`;
  const cert = certificates[version]; if (!cert) return `${version}: production release certificate record is missing`;
  if (cert.version !== version || tag !== `v${version}`) return `${version}: release tag and certificate version do not match`;
  if (cert.librarySha256 !== libraryHash(record)) return `${version}: certificate library hash differs from its versioned library artifacts`;
  if (!/^[0-9a-f]{64}$/.test(cert.manifestSha256 || "") || !/^[0-9a-f]{64}$/.test(cert.resultsSha256 || "")) return `${version}: certificate evidence hashes are missing`;
  if (cert.certificateSha256 !== releaseCertificateDigest(version, cert.librarySha256, cert.manifestSha256, cert.resultsSha256)) return `${version}: certificate digest is stale`;
  return null;
}
export function expectedReleasePins({ version = VERSION } = {}) {
  return {
    version, segmentFormat: SEGMENT_FORMAT, librarySha256: libraryHash(libraryRecord()),
    referencePageSha256: sha256(consumerPage()), engineMinSha256: ENGINE_PIN.sha256,
    engineSourceSha256: ENGINE_BUILD.sourceSha256, engineCommit: ENGINE_PIN.commit,
    playerSha256: sha256(readFileSync(new URL("../../player/player.js", import.meta.url))),
    settingsInstallerSha256: sha256(readFileSync(new URL("../../player/settings.js", import.meta.url))),
  };
}
// 0.x tooling remains usable while production evidence is incomplete. Every major >=1 must pass.
export async function checkReleaseEvidenceForBuild({ version = VERSION, manifestPath = PRODUCTION_MANIFEST_PATH, resultsPath = PRODUCTION_RESULTS_PATH, root = process.cwd() } = {}) {
  if (!releaseGateRequired(version)) return { required: false, status: "bypass", version, failures: [], incomplete: [] };
  const runtimeProbe = await certifyFixtureRuntime(GOOD_MIDI, SIMPLE_SETTINGS);
  if (runtimeProbe.status !== "pass") return { required: true, status: runtimeProbe.status === "fail" ? "fail" : "incomplete", failures: runtimeProbe.problems || [], incomplete: runtimeProbe.incomplete || [], runtimeProbe: runtimeProbe.runtime || null };
  let manifestText = null, resultsText = null;
  try { manifestText = readFileSync(manifestPath, "utf8"); } catch {}
  try { resultsText = readFileSync(resultsPath, "utf8"); } catch {}
  const expected = { ...expectedReleasePins({ version }), runtimeObservation: runtimeProbe.runtime };
  const pairRuntimeResults = await certifyProductionPairRuntimes(manifestText || "", { root });
  const result = validateProductionDocuments({ manifestText, resultsText, expected, root, pairRuntimeResults });
  if (result.status !== "pass") return { required: true, ...result };
  let certificates;
  try { certificates = JSON.parse(readFileSync(RELEASE_CERTIFICATES_PATH, "utf8")); }
  catch (error) { return { required: true, status: "incomplete", failures: [], incomplete: [{ code: "release-certificate-index-missing", message: String(error.message || error) }] }; }
  const cert = certificates[version];
  if (!cert) return { required: true, status: "incomplete", failures: [], incomplete: [{ code: "release-certificate-record-missing", version }] };
  const versions = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  const certificateSha256 = releaseCertificateDigest(version, expected.librarySha256, result.manifestSha256, result.resultSha256);
  if (releaseCertificateProblem(version, `v${version}`, versions, certificates) || cert.librarySha256 !== expected.librarySha256 ||
      cert.manifestSha256 !== result.manifestSha256 || cert.resultsSha256 !== result.resultSha256 || cert.certificateSha256 !== certificateSha256) {
    return { required: true, status: "fail", failures: [{ code: "release-certificate-pin-stale", version }], incomplete: [] };
  }
  return { required: true, status: "pass", failures: [], incomplete: [], version, certificateSha256 };
}
export const releaseManifestLabel = fileURLToPath(PRODUCTION_MANIFEST_PATH);
