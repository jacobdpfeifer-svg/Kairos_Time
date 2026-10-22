/**
 * Reviewed Bucket-A connectors. No I/O.
 *
 * connector-registry.mjs re-exports this and checks the contract.
 * The desktop app may import this file. It must not import school config or Node builtins.
 */
/** @type {readonly { id: string, school: string, slug: string, name: string, bucket: "A", pluginDir: string, shim?: string, surface: "web", writeCapable: boolean, confirmationGuard: string }[]} */
export const CONNECTOR_REGISTRY = Object.freeze([
  {
    id: "cu-boulder/campusgroups",
    school: "cu-boulder",
    slug: "campusgroups",
    name: "CampusGroups",
    bucket: "A",
    pluginDir: "plugins/cu-boulder-campusgroups",
    shim: "browser/scripts/lib/campusgroups-session.mjs",
    surface: "web",
    writeCapable: true,
    confirmationGuard: "required-on-mcp-write",
  },
]);

/** True only when `id` matches a registry id or slug, ignoring case. */
export function isReviewedConnector(id) {
  const needle = String(id ?? "")
    .trim()
    .toLowerCase();
  if (!needle) return false;
  return CONNECTOR_REGISTRY.some((entry) => entry.id.toLowerCase() === needle || entry.slug.toLowerCase() === needle);
}
