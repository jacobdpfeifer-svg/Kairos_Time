export type ReviewedConnector = { id: string; label: string; slug?: string };

export const CONNECTOR_REGISTRY: readonly ReviewedConnector[];

/** True only for a hand-reviewed registry id or slug. Never starts a connection. */
export function isReviewedConnector(id: unknown): boolean;
