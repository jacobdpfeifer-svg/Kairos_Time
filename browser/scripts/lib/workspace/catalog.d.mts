export const WORKFLOW_FRICTIONS: readonly string[];
export const WORKFLOW_PREFERENCES: readonly string[];
export const WORKSPACE_CAPABILITIES: readonly { id: string; supports?: readonly string[] }[];
export const WORKSPACE_TEMPLATES: readonly {
  id: string;
  label: string;
  preference: string;
  blocks: readonly string[];
}[];
