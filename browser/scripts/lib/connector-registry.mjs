/**
 * Reviewer: static Bucket-A registry. Missing tools are flagged, never fetched.
 *
 * Static, human-curated Bucket-A connector registry.
 *
 * Connectors are versioned under plugins/ and land only via reviewed PRs.
 * Agents must never fetch, write, or execute third-party code to fill a gap —
 * flag missing tools (see writeToolGapsFile) and stop.
 *
 * Contract: docs in plugins/README.md (modeled on cu-boulder-campusgroups).
 */
import { CONNECTOR_REGISTRY } from "./connector-registry-data.mjs";
import { getSchoolConfig } from "./school-config.mjs";

export { CONNECTOR_REGISTRY, isReviewedConnector } from "./connector-registry-data.mjs";

/**
 * @typedef {object} ConnectorEntry
 * @property {string} id            Registry id (`{school}/{slug}`)
 * @property {string} school        SCHOOL_SLUG this connector is valid for
 * @property {string} slug          Tool slug (matches inventory / gap flags)
 * @property {string} name          Display name
 * @property {"A"} bucket           Only Bucket A may appear here (Bucket B forbidden)
 * @property {string} pluginDir     Repo-relative plugin directory
 * @property {string} [shim]        Optional browser/scripts/lib/*.mjs re-export path
 * @property {"web"} surface        Transport. Only "web" (Playwright on the shared
 *   browser/.auth profile). Device-automation harnesses (cell-use, Appium/
 *   WebDriverAgent, mobile-mcp, agent-device, …) are not a registrable surface —
 *   see plugins/README.md rule 7 and docs/handoff/device-automation-scope-2026-09-29.md.
 * @property {boolean} writeCapable Whether any action mutates the student account
 * @property {string} confirmationGuard
 *   `required-on-mcp-write` — MCP writes must use ConfirmationGuard
 *   `n/a` — read-only connector (still no Bucket-B automation)
 */

/**
 * Refuse registry entries the contract does not allow. Runs at module load so a
 * bad entry fails every sync, not just the one that reaches it.
 * @param {readonly ConnectorEntry[]} registry
 */
export function assertRegistryShape(registry) {
  for (const c of registry) {
    if (c.bucket !== "A") {
      throw new Error(`connector ${c.id}: only Bucket A may be registered (got ${c.bucket})`);
    }
    if (c.surface !== "web") {
      throw new Error(
        `connector ${c.id}: surface "${c.surface}" is not allowed — only "web" (Playwright). ` +
          "Device-automation harnesses are out of scope (plugins/README.md rule 7)."
      );
    }
  }
}

assertRegistryShape(CONNECTOR_REGISTRY);

/** @param {string} [schoolSlug] */
export function listConnectorsForSchool(schoolSlug) {
  const slug = schoolSlug || getSchoolConfig().slug || "";
  return CONNECTOR_REGISTRY.filter((c) => c.school === slug && c.bucket === "A");
}

/** @param {string} toolSlug @param {string} [schoolSlug] */
export function findConnector(toolSlug, schoolSlug) {
  const needle = String(toolSlug || "")
    .toLowerCase()
    .trim();
  if (!needle) return null;
  return (
    listConnectorsForSchool(schoolSlug).find(
      (c) => c.slug === needle || c.name.toLowerCase() === needle
    ) || null
  );
}

/** @param {string} toolSlug @param {string} [schoolSlug] */
export function hasConnector(toolSlug, schoolSlug) {
  return !!findConnector(toolSlug, schoolSlug);
}
