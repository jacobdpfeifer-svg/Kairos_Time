export type CompiledSurface = "today" | "week" | "courses" | "study" | "advisor";

export type CompiledBlock = {
  capability: string;
  size: "full" | "half";
  props?: Record<string, unknown>;
  visible_when?: string;
};

export type CompiledSpec = {
  schema_version: number;
  status: string;
  spec_id?: string;
  created_at?: string;
  accepted_at?: string;
  accepted_by?: string;
  origin?: { kind: string; template_id?: string; draft_session_id?: string };
  density?: "comfortable" | "compact";
  home?: CompiledSurface;
  surfaces: Record<string, { slots?: string[] }>;
  blocks: Record<string, CompiledBlock>;
  quiet?: { interrupt_for?: string[] };
  requested_integrations?: { name?: string; state?: string; heard_at?: string }[];
  entitlement?: string;
};

export type CompiledPatch = {
  op: string;
  surface?: CompiledSurface;
  block_id?: string;
  index?: number;
  block?: CompiledBlock;
  narration?: string;
  density?: "comfortable" | "compact";
  home?: CompiledSurface | null;
  interrupt_for?: string[];
  name?: string;
  props?: Record<string, unknown>;
};

export function homeForPreference(preference: string | undefined): CompiledSurface;

export function byCapabilityWeight(
  a: string,
  b: string,
  catalog?: readonly { id: string; weight?: number }[],
): number;

export function compileWorkspace(
  draft: unknown,
  options: {
    catalog?: readonly object[];
    templates?: readonly object[];
    now: string | Date;
  },
): { spec: CompiledSpec; patches: CompiledPatch[]; rationale: Record<string, string> };
