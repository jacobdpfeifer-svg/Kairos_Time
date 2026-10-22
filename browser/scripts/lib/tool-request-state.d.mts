export type RequestState = "requested" | "not_available";

export const ASSESSMENT_NAME_RE: RegExp;
export const CANVAS_VISIBLE_ACT_RE: RegExp;

export const ASKED_HEADING: string;
export const ASKED_INTRO: string;
export const GAP_NOTE: string;
export const GAP_COURSES: string;

export const REQUESTED_SENTENCE: string;
export const NOT_AVAILABLE_SENTENCE: string;
export const REVIEWED_SENTENCE: string;

export function integrationRequestState(name: unknown): RequestState;
export function requestSentence(name: unknown): string;
export function escGapCell(value: unknown): string;
export function clipRequestName(name: unknown): string;
export function dedupeRequestNames(names: readonly unknown[]): string[];
export function formatAskedSection(names: readonly string[]): string;
export function parseAskedForNames(markdown: string): string[];
export function reconcileToolGapsMarkdown(existing: string, names: readonly unknown[]): string;
