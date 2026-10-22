export type AmendmentKind = "home" | "narrow_interrupts" | "remove_unused" | "reorder";
export type AmendmentSurface = "today" | "week" | "courses" | "study" | "advisor";

export type AmendmentPatch = {
  op: string;
  home?: AmendmentSurface | null;
  interrupt_for?: string[];
  surface?: AmendmentSurface;
  block_id?: string;
  index?: number;
};

export type AmendmentProposal = {
  kind: AmendmentKind;
  fingerprint: string;
  surface: AmendmentSurface;
  rationale: string;
  patches: AmendmentPatch[];
};

export const AMENDMENT_KINDS: readonly AmendmentKind[];

export function byCapabilityWeight(a: string, b: string, catalog?: readonly { id: string; weight?: number }[]): number;

export function proposeAmendment(
  spec: unknown,
  usage: unknown,
  options?: {
    now?: Date | string;
    ledger?: unknown;
    catalog?: readonly { id: string; label?: string; weight?: number; requires?: readonly string[] }[];
  },
): AmendmentProposal | null;
