export function suggestTemplates(
  draft: { preference?: string; frictions?: string[] } | null | undefined,
): { id: string; label: string; score: number }[];
