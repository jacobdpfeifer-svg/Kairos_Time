export const WORKFLOW_FRICTIONS: readonly string[];
export const WORKFLOW_PREFERENCES: readonly string[];

export function suggestTemplates(
  draft: { preference?: string; frictions?: string[] } | null | undefined,
): { id: string; label: string; score: number }[];

export function normalizeWorkflowDraft(
  input: unknown,
  options?: { now?: string; sessionId?: string },
): {
  version: number;
  status: string;
  created_at: string;
  session_id: string;
  ideal_workflow: string;
  frictions: string[];
  preference: string;
  constraints: string;
  requested_integrations: string[];
  alternatives: { title: string; reason: string }[];
  proposed_template: string;
  interrupt_for?: string[];
};
