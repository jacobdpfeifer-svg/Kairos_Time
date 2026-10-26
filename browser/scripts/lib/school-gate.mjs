/**
 * CampusGroups CLIs require the school to be cu-boulder before any browser or
 * account call. An explicit SCHOOL_SLUG decides by itself, so tests and
 * operators can refuse or allow without a profile. With no override, the
 * onboarding profile is resolved the same way Canvas sync resolves it:
 * a host slug such as canvas-colorado-edu becomes cu-boulder when the host
 * matches a curated school file. A missing profile is still a refusal.
 */
import { getSchoolConfig } from "./school-config.mjs";

export function campusGroupsAllowed(slug) {
  return String(slug || "").trim() === "cu-boulder";
}

export function currentCampusGroupsAllowed() {
  const explicit = (process.env.SCHOOL_SLUG || "").trim();
  if (explicit && explicit !== "waitlist") return campusGroupsAllowed(explicit);
  try {
    return campusGroupsAllowed(getSchoolConfig().slug);
  } catch {
    return false;
  }
}
