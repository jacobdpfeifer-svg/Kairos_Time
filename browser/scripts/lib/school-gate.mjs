/**
 * CampusGroups CLIs require SCHOOL_SLUG=cu-boulder before any browser or account call.
 * The explicit environment wins for CI and developer use; ordinary student
 * CLI use resolves the onboarding profile through the same school resolver as
 * Canvas sync. A missing profile is still a refusal.
 */
import { getSchoolSlug } from "./school-config.mjs";

export function campusGroupsAllowed(slug) {
  return String(slug || "").trim() === "cu-boulder";
}

export function currentCampusGroupsAllowed() {
  return campusGroupsAllowed(getSchoolSlug());
}
