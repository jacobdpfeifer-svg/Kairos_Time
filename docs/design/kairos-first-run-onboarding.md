# Kairos first-run onboarding: Canvas handoff

Status: implemented. The standalone handoff mock remains available for review; production onboarding now uses the same story.

## Real path, tied to the code

1. The student searches for and chooses their school in Kairos. `searchSchools` finds the school; `chooseSchool` and `saveOnboarding` persist the selected Canvas profile. The school is discovered at onboarding; Kairos does not assume a campus.
2. After the school legal acceptance, `openCanvasSso` invokes the Tauri `open_canvas_sso` command. `run_open_canvas` runs the bundled `open-canvas` script. That script opens Google Chrome on the selected school’s Canvas host with Kairos’s browser profile. The Kairos window stays underneath.
3. The student acts in Chrome. They enter their own school credentials and complete the school’s MFA there. Kairos must never request, type, store, or display the password, MFA code, or a Canvas token.
4. The student closes the Chrome login window when they see their Canvas dashboard. Kairos calls `checkCanvasSession`. A valid session leaves the sign-in failure state and advances to sync.
5. `syncStudySourcesIpc` runs the bundled sync. Course names appear in the sync view and the resulting week/course catalog is written only below that install’s Application Support profile, resolved through `current_profile`.

The unlock moment is therefore: **school selected → Chrome sign-in completed by the student → back in Kairos → courses appear**.

## Pattern read

The relevant pattern from other products is the explicit handoff. Figma documents that its desktop app opens a browser for Google or SAML SSO and returns to the desktop app after authentication. Superhuman likewise describes redirecting to an external identity provider and returning to the product. Kairos should borrow that ownership clarity, not their visual language.

## Concepts

### 1. The handoff film — recommended

Sequence:

- Kairos: “Choose your school.” A school search row resolves to “Your school”; the beta terms remain a real acceptance gate.
- Kairos: “Chrome will open on top.” A simple Kairos window remains visible under a larger Chrome window. A handwritten note says “expected.”
- Chrome: “Your school sign-in.” No fake username/password form. Show only a neutral school-login panel with “You sign in here” and “Complete MFA here.”
- Kairos: “Back in Kairos.” The Chrome window moves away; real-looking course rows arrive under “Your classes are ready.”

Shown: window ownership, order, student action, return, and the course unlock. Read: one short sentence per scene plus a concrete button label. The animation itself carries the story.

Reduced motion: show the same four scenes as a still storyboard separated by hairlines and a static arrow. All labels remain present; no information depends on movement.

### 2. The four-step strip

Sequence: four horizontal rows: “Choose school” → “Sign in in Chrome” → “Complete MFA” → “See classes.” The active row expands to show one small illustration of the current owner.

Shown: the whole path at once. Read: terse verbs only. This is efficient and accessible, but it gives less emotional reassurance that Kairos stays open while Chrome is on top.

Reduced motion: identical static strip with the active row indicated by the single highlighter treatment.

### 3. The waiting room

Sequence: one focused Kairos screen: selected school at top, a large browser handoff illustration, then an explicit waiting state after the button is pressed. Once the session is found, the illustration changes to a course list.

Shown: strongest reassurance at the moment the external window opens. Read: slightly more helper copy, including “Close Chrome when you see your Canvas dashboard.”

Reduced motion: the handoff illustration is a static before/after composition; the waiting state is text plus a small “Still waiting for Chrome” status, never an animated spinner-only state.

## Recommendation

Use concept 1, the handoff film, as the onboarding’s explanatory layer before the existing school/canvas/sync mechanics. It is the fastest way to answer the student’s fear: “Did something unexpected just open?” It also makes the trust boundary visible without adding a paragraph or placing credentials inside Kairos.

The mock is [kairos-first-run-handoff.html](./kairos-first-run-handoff.html). It is hand-built HTML/CSS using the Notebook tokens because the requested story is a small state transition, not a marketing video: it stays deterministic, ships without a video dependency, has a true static reduced-motion equivalent, and can be audited against `FirstRun.tsx`.

### Production implementation

- Add a short explanatory handoff state before the first Canvas button, without changing `school → canvas → sync` or the IPC calls.
- Keep the school selection and `schoolLegalText` acceptance before `openCanvasSso`.
- Replace the current Canvas copy with the three ownership facts shown in the mock: Chrome opens on top; the student signs in and completes MFA there; Kairos never sees the password.
- Keep one primary action: “Open Chrome sign-in”. While `ssoBusy`, use “Chrome sign-in is open…”. Do not add a second action that could race the process.
- After `openCanvasSso` resolves, show “Back in Kairos” while `checkCanvasSession` runs. On success, let the existing sync state show course rows.
- Preserve `plainCanvasError`, `SIGN_IN_FAILED`, `SYNC_FAILED`, `runtimeInfo` blockers, and the retry paths. Translate Chrome-missing and broken-install states into the same plain-language blocker treatment shown in the mock.
- Keep all credential/MFA language as ownership guidance only. Do not add fields, screenshots, or simulated typing.

Implemented in `app/src/components/FirstRun.tsx`, `app/src/components/ConnectCanvasMark.tsx`, and `app/src/notebook.css`. The IPC, school discovery, legal acceptance, runtime blockers, session check, and sync mechanism are unchanged.

## Live gate on the notarized app

Run this against the notarized `Kairos.app`, not the checkout and not `cd browser && npm run sync`.

- [ ] Confirm the exact app bundle path is the notarized `Kairos.app` under test. For a standard install, record `/Applications/Kairos.app` and run `codesign --verify --deep --strict --verbose=2 /Applications/Kairos.app`.
- [ ] Confirm bundled resources exist before launch: `/Applications/Kairos.app/Contents/Resources/core/browser/scripts` and `/Applications/Kairos.app/Contents/Resources/runtime/node/bin/node`.
- [ ] Confirm the app is using bundled resources/runtime, not the repo fallback. Record the runtime diagnostics or Settings → Diagnostics result; the installed run should report bundled mode.
- [ ] Confirm Google Chrome is installed and is the browser that opens.
- [ ] Launch Kairos and search for `University of Colorado Boulder`.
- [ ] Choose the result; verify the school legal acceptance is required before Canvas can open.
- [ ] Start Canvas sign-in. Confirm a separate Google Chrome window opens on the selected school’s Canvas host while Kairos remains underneath.
- [ ] Stop for the human tester to complete the CU school login and MFA in Chrome. Do not type or capture credentials, codes, or tokens in Kairos.
- [ ] In Chrome, reach the Canvas dashboard, then close the Chrome login window as instructed.
- [ ] Return to Kairos. Confirm the sign-in failure state clears and sync begins.
- [ ] Let the bundled sync finish. A sync error or missing session is a failed gate; do not continue past it.
- [ ] Record whether course names appear in the Kairos UI.
- [ ] Resolve the active profile through `~/Library/Application Support/Kairos/current_profile`, then inspect `~/Library/Application Support/Kairos/<profile-id>/inbox/`. Record whether the expected week/course catalog artifacts exist there; do not inspect the developer checkout’s inbox.
- [ ] Record the final result: pass only if session found, sync completed, courses visible, and profile-local inbox artifacts exist.

Expected result: the student understands what Chrome is for before it opens, completes the sensitive step themselves, returns to Kairos, and sees classes as the clear unlock.
