# Worth-installing audit of the audit — 2026-10-08

## Scope correction

This follow-up reviews the previous `WORTH-INSTALLING-2026-10-08.md` against the
current tree. It focuses on mechanical private-beta readiness: navigation,
button destinations, first-run/recovery flow, study entry, runtime boundaries,
and package/build integrity.

MCP connector integrations, Gmail/Google Calendar/Outlook OAuth, and other
unused connector surfaces are intentionally out of scope for this release
slice. They are not treated as blockers here, and no connector implementation
was changed.

## Previous findings re-checked

- First run and terms flow: covered by the existing `FirstRun.test.tsx` tests;
  terms focus, Escape, sign-in failure, and first-sync retry remain covered.
- Study recovery to Settings → Canvas: covered by `App.test.tsx` and still
  passes.
- Home refresh after sync: covered by `HomeView.sync.test.tsx` and remains in
  the suite.
- Draft persistence after submit: covered by `StudyView.test.tsx` and remains
  in the suite.
- Runtime/package shape: the prior DMG audit verified the bundled Python/Node
  runtimes, resource tree, mountability, and arm64 executable. The runtime
  staging fix is isolated in `scripts/stage-runtime.sh`.

## New structural defect found and fixed

The exam sheet stored `{ course, examId }` as Study preselection state. The
Study view consumed only the course, and the preselection remained alive after
the student navigated away from Study. Returning to Study could therefore
reopen a stale exam context from an earlier Home interaction.

Fix:

- Leaving the Study tab now clears the transient exam preselection.
- Added an App regression test covering Home → exam → Study → Home → Study.

Files:

- `app/src/App.tsx`
- `app/src/App.test.tsx`

Verification:

- `cd app && npm test -- --run src/App.test.tsx`: 4 tests passed.
- `cd app && npm run build`: passed.
- `git diff --check`: passed.

## Current mechanical verdict

The audit evidence supports a strong synthetic/private-beta mechanical path:
the main navigation and recovery routes are wired, the packaged runtime path
has been exercised, and the new stale-state boundary is covered.

The previously built DMG is now stale because this navigation fix landed after
that artifact was built. A final DMG must be rebuilt from the settled audit
tree before any clean-Mac or release decision.

The following remain separate release gates, not connector work:

- final rebuild from the settled tree;
- clean-Mac install and first-run walk;
- live Canvas SSO/sync on that installed build;
- Apple signing and notarization before normal distribution;
- an explicit product decision about what “quiz me” means when the AI relay is
  unavailable.
## Final DMG follow-up

The final rebuild found and fixed one release-only runtime issue: the packaged
Tauri app could accept an invalid resource directory and silently fall back to
the developer checkout. The runtime now requires a valid bundled `core`
directory and derives the app-bundle Resources path from the executable when
Tauri's resource path is unavailable. The native mirror also includes
`design-system/`, which is required by the packaged frontend build.

Installed-path verification on the rebuilt arm64 DMG confirmed:

- fresh onboarding reaches the real Canvas connection screen;
- the daemon reports `runtime Bundled`;
- the real SSO action starts the bundled Playwright-driven Chrome profile;
- the DMG checksum is
  `c1b32207eafbaf945e2898e7b58b7cd54392d46ba4a484eb135af24f019ad08b` and
  `hdiutil verify` is valid.

The SSO walk is intentionally paused at the university login/MFA handoff. No
credentials or MFA codes were entered by automation, so a successful live sync
still requires the owner to complete login in the opened browser and then
continue the post-login sync check. This was a fresh isolated profile on the
current Mac, not an external clean Mac. Signing, notarization, public hosting,
and a separate-device install remain required before calling the DMG a public
beta release.
