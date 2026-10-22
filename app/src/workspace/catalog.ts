/**
 * Capability registry for the shell. Generated data lives in catalog.json,
 * projected from browser/scripts/lib/workspace/catalog.mjs.
 */
import catalogData from "./catalog.json";

export type PropSchema = Record<string, { type: "boolean" | "string" | "number"; default?: boolean | string | number }>;

export type WorkspaceCapability = {
  id: string;
  label: string;
  blurb: string;
  surfaces: readonly string[];
  component: string;
  sizes: readonly string[];
  props: PropSchema;
  supports: readonly string[];
  requires: readonly string[];
  max_instances: number;
  availability: "available" | "optional_connector";
  tier: "local" | "premium";
  weight: number;
};

export type WorkspaceTemplate = {
  id: string;
  label: string;
  preference: string;
  blocks: readonly string[];
};

export const WORKSPACE_CAPABILITIES = catalogData.capabilities as readonly WorkspaceCapability[];
export const WORKSPACE_TEMPLATES = catalogData.templates as readonly WorkspaceTemplate[];
