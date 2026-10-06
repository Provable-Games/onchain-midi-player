// Fail-closed stable-version hook used by build_page.mjs and deployments.test.mjs.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ENGINE_PIN } from "../engine.mjs";
import { PAGE_VERSION, PAGE_VERSIONS_PATH, VERSION, pageHtml, sha256 } from "../page.mjs";
import { GOOD_MIDI, SIMPLE_SETTINGS } from "./fixtures.mjs";
import { validateProductionDocuments } from "./production.mjs";
import { certifyFixtureRuntime, certifyProductionPairRuntimes } from "./runtime.mjs";

export const PRODUCTION_MANIFEST_PATH = new URL("./production-manifest.v1.json", import.meta.url);
export const PRODUCTION_RESULTS_PATH = new URL("./production-results.v1.json", import.meta.url);
export const RELEASE_CERTIFICATES_PATH = new URL("./release-certificates.v1.json", import.meta.url);

/** Stable/release-candidate class versions at 1.0.0 or later require production certification. */
/** @param {string} version */
export function releaseGateRequired(version) {
  const match = /^(\d+)\./.exec(version);
  return !!match && BigInt(match[1]) >= 1n;
}

/** @param {string} version @param {string} pageSha256 @param {string} manifestSha256 @param {string} resultsSha256 */
export function releaseCertificateDigest(version, pageSha256, manifestSha256, resultsSha256) {
  return sha256([version, pageSha256, manifestSha256, resultsSha256].join("\n"));
}

/**
 * Bind a deployed release tag to that version's immutable page record and production evidence
 * digests. Historical versions never inherit the current page's certificate.
 * @param {string} version
 * @param {string | null} tag
 * @param {Record<string, any>} pageVersions
 * @param {Record<string, any>} releaseCertificates
 */
export function releaseCertificateProblem(version, tag, pageVersions, releaseCertificates) {
  if (tag === null || !releaseGateRequired(version)) return null;
  const record = pageVersions[version];
  if (!record) return `${version}: page version record is missing`;
  const cert = releaseCertificates[version];
  if (!cert) return `${version}: production release certificate record is missing`;
  if (cert.version !== version || tag !== `v${version}`) return `${version}: release tag and certificate version do not match`;
  if (cert.pageSha256 !== record.page_sha256) return `${version}: certificate page hash differs from its versioned page artifact`;
  if (!/^[0-9a-f]{64}$/.test(cert.manifestSha256 || "") || !/^[0-9a-f]{64}$/.test(cert.resultsSha256 || "")) return `${version}: certificate evidence hashes are missing`;
  const expected = releaseCertificateDigest(version, cert.pageSha256, cert.manifestSha256, cert.resultsSha256);
  if (cert.certificateSha256 !== expected) return `${version}: certificate digest is stale`;
  return null;
}

/** Actual source/build identity for the candidate output, independent of the manifest values. */
export function expectedReleasePins({ version = VERSION, page = pageHtml() } = {}) {
  return {
    version,
    pageVersion: PAGE_VERSION,
    pageSha256: sha256(page),
    engineMinSha256: ENGINE_PIN.sha256,
    engineSourceSha256: ENGINE_PIN.sourceSha256,
    engineCommit: ENGINE_PIN.commit,
    playerSha256: sha256(readFileSync(new URL("../../player/player.js", import.meta.url))),
    settingsInstallerSha256: sha256(readFileSync(new URL("../../player/settings.js", import.meta.url))),
  };
}

/**
 * Release gate used by the page artifact validation command. Interim 0.x builds intentionally
 * bypass production evidence; every major >=1 version fails closed until reviewed production rows
 * and its version-specific digest record exist.
 * @param {{version?: string, page?: string, manifestPath?: URL, resultsPath?: URL, root?: string}} [options]
 */
export async function checkReleaseEvidenceForBuild({ version = VERSION, page = pageHtml(), manifestPath = PRODUCTION_MANIFEST_PATH, resultsPath = PRODUCTION_RESULTS_PATH, root = process.cwd() } = {}) {
  if (!releaseGateRequired(version)) return { required: false, status: "bypass", version, failures: [], incomplete: [] };
  const runtimeProbe = await certifyFixtureRuntime(GOOD_MIDI, SIMPLE_SETTINGS, { page });
  if (runtimeProbe.status !== "pass") return {
    required: true,
    status: runtimeProbe.status === "fail" ? "fail" : "incomplete",
    failures: runtimeProbe.problems || [],
    incomplete: runtimeProbe.incomplete || [],
    runtimeProbe: runtimeProbe.runtime || null,
  };
  let manifestText = null;
  let resultsText = null;
  try { manifestText = readFileSync(manifestPath, "utf8"); } catch {}
  try { resultsText = readFileSync(resultsPath, "utf8"); } catch {}
  const expected = { ...expectedReleasePins({ version, page }), runtimeObservation: runtimeProbe.runtime };
  const pairRuntimeResults = await certifyProductionPairRuntimes(manifestText || "", { page, root });
  const result = validateProductionDocuments({ manifestText, resultsText, expected, root, pairRuntimeResults });
  if (result.status !== "pass") return { required: true, ...result };

  let certificates;
  try { certificates = JSON.parse(readFileSync(RELEASE_CERTIFICATES_PATH, "utf8")); }
  catch (error) { return { required: true, status: "incomplete", failures: [], incomplete: [{ code: "release-certificate-index-missing", message: String(/** @type {Error} */ (error).message || error) }] }; }
  const cert = certificates[version];
  if (!cert) return { required: true, status: "incomplete", failures: [], incomplete: [{ code: "release-certificate-record-missing", version }] };
  const pageVersions = JSON.parse(readFileSync(PAGE_VERSIONS_PATH, "utf8"));
  const pageRecord = pageVersions[version];
  const manifestSha = result.manifestSha256;
  const resultsSha = result.resultSha256;
  if (!manifestSha || !resultsSha) return { required: true, status: "incomplete", failures: [], incomplete: [{ code: "release-certificate-evidence-hashes-missing", version }] };
  const expectedDigest = releaseCertificateDigest(version, expected.pageSha256, manifestSha, resultsSha);
  const stale = cert.version !== version || cert.pageSha256 !== expected.pageSha256 || cert.manifestSha256 !== manifestSha ||
    cert.resultsSha256 !== resultsSha || cert.certificateSha256 !== expectedDigest || pageRecord?.page_sha256 !== expected.pageSha256;
  if (stale) return { required: true, status: "fail", failures: [{ code: "release-certificate-pin-stale", version, expected: { pageSha256: expected.pageSha256, manifestSha256: manifestSha, resultsSha256: resultsSha, certificateSha256: expectedDigest }, actual: cert }], incomplete: [] };
  return { required: true, status: "pass", failures: [], incomplete: [], version, certificateSha256: cert.certificateSha256 };
}

/** Human-readable location for release error messages. */
export const releaseManifestLabel = fileURLToPath(PRODUCTION_MANIFEST_PATH);
