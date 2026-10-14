/** Beta terms + privacy shown at onboarding (canonical prose also in docs/legal/). No school is assumed. */

import termsMd from "./legalDocs/terms.md?raw";
import privacyMd from "./legalDocs/privacy.md?raw";

const FULL_LEGAL = `${termsMd.trim()}\n\n---\n\n${privacyMd.trim()}\n`;

function preamble(schoolName?: string): string {
  const where = schoolName?.trim() ? ` at ${schoolName.trim()}` : "";
  return `Kairos private beta. You must be the account holder for the Canvas account you sign in with${where}. Your school's policies still apply.\n\n`;
}

/** Terms text for the school the student picked (or a generic preamble before they pick). */
export function schoolLegalText(schoolName?: string): string {
  return `${preamble(schoolName)}${FULL_LEGAL}`;
}
