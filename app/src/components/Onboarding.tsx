import { useEffect, useState } from "react";
import { GENERIC_LEGAL, schoolLegalText } from "../legal";
import { LegalText } from "./LegalText";
import {
  bootstrapCanvasSync,
  checkCanvasSession,
  openCanvasSso,
  readSchoolProfile,
  saveLearningProfile,
  saveOnboarding,
  saveUserProfile,
} from "../ipc";
import type { LearningProfileAnswers, OnboardingIdentity } from "../ipc";
import { AutonomyGame, type Autonomy } from "./learningProfile/AutonomyGame";
import {
  ChunkSizeGame,
  type ChunkSize,
} from "./learningProfile/ChunkSizeGame";
import {
  PracticeFormatGame,
  type CheckDepth,
  type PracticeFormat,
} from "./learningProfile/PracticeFormatGame";

const STEP_COUNT = 6;

export function Onboarding({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  // The school was found at first run (school/profile.json); this wizard only shows it.
  const [school, setSchool] = useState("");
  const [schoolName, setSchoolName] = useState("");
  const [legalAccepted, setLegalAccepted] = useState(false);
  const [cloudKey, setCloudKey] = useState("");
  const [sentryOptIn, setSentryOptIn] = useState(false);
  const [waitlistEmail, setWaitlistEmail] = useState("");
  const [ssoBusy, setSsoBusy] = useState(false);
  const [ssoError, setSsoError] = useState<string | null>(null);
  const [sessionCheck, setSessionCheck] = useState<
    "pending" | "checking" | "found" | "not-found"
  >("pending");
  const [finishError, setFinishError] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);

  // Profile step — feeds USER.md's Identity/Program/Interests/Academic
  // floors/Career priorities sections (see canvas_mcp.core.user_profile).
  const [studentName, setStudentName] = useState("");
  const [major, setMajor] = useState("");
  const [catalogYear, setCatalogYear] = useState("");
  const [targetGradTerm, setTargetGradTerm] = useState("");
  const [interest1, setInterest1] = useState("");
  const [interest2, setInterest2] = useState("");
  const [interest3, setInterest3] = useState("");
  const [careerPriority1, setCareerPriority1] = useState("");
  const [careerPriority2, setCareerPriority2] = useState("");
  const [careerPriority3, setCareerPriority3] = useState("");
  const [goodStandingGpa, setGoodStandingGpa] = useState("");
  const [otherNotes, setOtherNotes] = useState("");
  const [profileSaveError, setProfileSaveError] = useState<string | null>(
    null
  );
  const [profileSaveBusy, setProfileSaveBusy] = useState(false);

  // Learning profile games — functional levers, not VAK labels.
  const [practiceFormat, setPracticeFormat] = useState<PracticeFormat | null>(
    null
  );
  const [checkDepth, setCheckDepth] = useState<CheckDepth | null>(null);
  const [autonomy, setAutonomy] = useState<Autonomy | null>(null);
  const [chunkSize, setChunkSize] = useState<ChunkSize | null>(null);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [checkFirst, setCheckFirst] = useState(false);

  useEffect(() => {
    let alive = true;
    readSchoolProfile()
      .then((p) => {
        if (!alive || !p) return;
        setSchool(p.slug);
        setSchoolName(p.display_name);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const isWaitlist = school === "waitlist";
  const visibleStepCount = isWaitlist ? 2 : STEP_COUNT;

  // On reaching the Canvas step, silently check for an already-open
  // session (browser/.auth cookies) before asking the student to sign in.
  useEffect(() => {
    if (isWaitlist || step !== 2 || sessionCheck !== "pending") return;
    let cancelled = false;
    setSessionCheck("checking");
    checkCanvasSession()
      .then((loggedIn) => {
        if (cancelled) return;
        if (loggedIn) {
          setSessionCheck("found");
          bootstrapCanvasSync();
          setStep(3);
        } else {
          setSessionCheck("not-found");
        }
      })
      .catch((e) => {
        if (cancelled) return;
        console.error(e);
        setSessionCheck("not-found");
      });
    return () => {
      cancelled = true;
    };
  }, [step, sessionCheck, isWaitlist]);

  const legalText = schoolName ? schoolLegalText(schoolName) : GENERIC_LEGAL;
  const profileReady =
    practiceFormat !== null &&
    checkDepth !== null &&
    autonomy !== null &&
    chunkSize !== null;

  function finishWaitlist() {
    setFinishing(true);
    setFinishError(null);
    saveOnboarding("waitlist", "", {
      waitlistEmail: waitlistEmail.trim(),
      sentryOptIn,
    })
      .then(() => onDone())
      .catch((e) => {
        console.error(e);
        setFinishError(String(e));
      })
      .finally(() => setFinishing(false));
  }

  return (
    <div className="onboarding scene-paper">
      <p className="index-label" aria-label={`Step ${step + 1} of ${visibleStepCount}`}>
        {String(step + 1).padStart(2, "0")} / {String(visibleStepCount).padStart(2, "0")}
      </p>

      {step > 0 && (
        <button
          type="button"
          className="onboarding-back"
          onClick={() => {
            setStep((current) => Math.max(0, current - 1));
            setSsoError(null);
            setFinishError(null);
          }}
        >
          ← Back
        </button>
      )}

      <div className="onboarding-body">
        {step === 0 && (
          <>
            <p className="onboarding-step-label">School</p>
            {school ? (
              <p>
                Kairos is set up for <strong>{schoolName || school}</strong>. To switch schools, sign out of Canvas in
                Settings and run setup again.
              </p>
            ) : (
              <p>Finish first-run setup to choose your school.</p>
            )}
            <button type="button" className="primary" disabled={!school} onClick={() => setStep(1)}>
              Continue
            </button>
          </>
        )}
        {step === 1 && isWaitlist && (
          <>
            <p className="onboarding-step-label">Waitlist</p>
            <p>
              Leave your email and we'll write when there's a spot in the beta.
              There's no Canvas sign-in on this path.
            </p>
            <LegalText text={legalText} />
            <label>
              <input
                type="checkbox"
                checked={legalAccepted}
                onChange={(e) => setLegalAccepted(e.target.checked)}
              />{" "}
              I have read and accept these terms
            </label>
            <input
              type="email"
              value={waitlistEmail}
              onChange={(e) => setWaitlistEmail(e.target.value)}
              placeholder="you@school.edu"
              autoComplete="email"
              aria-label="Waitlist email"
            />
            <label className="telemetry">
              <input
                type="checkbox"
                checked={sentryOptIn}
                onChange={(e) => setSentryOptIn(e.target.checked)}
              />{" "}
              Opt in to crash telemetry (Sentry) for beta
            </label>
            <button
              type="button"
              className="primary"
              disabled={
                !legalAccepted || !waitlistEmail.trim() || finishing
              }
              onClick={finishWaitlist}
            >
              {finishing ? "Saving…" : "Join waitlist"}
            </button>
            {finishError && <p className="error">{finishError}</p>}
          </>
        )}
        {step === 1 && !isWaitlist && (
          <>
            <p className="onboarding-step-label">Policy</p>
            <p>School policy &amp; local-first notice</p>
            <LegalText text={legalText} />
            <label>
              <input
                type="checkbox"
                checked={legalAccepted}
                onChange={(e) => setLegalAccepted(e.target.checked)}
              />{" "}
              I have read and accept these terms
            </label>
            <button
              type="button"
              className="primary"
              disabled={!legalAccepted}
              onClick={() => setStep(2)}
            >
              Continue
            </button>
          </>
        )}
        {step === 2 && !isWaitlist && (
          <>
            <p className="onboarding-step-label">Canvas</p>
            {sessionCheck === "checking" || sessionCheck === "pending" ? (
              <p role="status">Checking for an open Canvas session…</p>
            ) : (
              <>
                <p>Sign into Canvas (SSO opens in the browser helper)</p>
                <button
                  type="button"
                  className="primary"
                  disabled={ssoBusy}
                  onClick={() => {
                    setSsoBusy(true);
                    setSsoError(null);
                    openCanvasSso()
                      .then(() => {
                        bootstrapCanvasSync();
                        setStep(3);
                      })
                      .catch((e) => {
                        console.error(e);
                        setSsoError(String(e));
                      })
                      .finally(() => setSsoBusy(false));
                  }}
                >
                  {ssoBusy ? "Opening Canvas…" : "Open Canvas & sign in"}
                </button>
                {ssoError && (
                  <p className="error">
                    {ssoError} — fix the session, then try again.
                  </p>
                )}
                {sessionCheck === "not-found" && !ssoError && (
                  <p className="onboarding-help">
                    No open session found yet. You can sign in above, then use
                    the same button again if the browser helper did not return.
                  </p>
                )}
              </>
            )}
          </>
        )}
        {step === 3 && !isWaitlist && (
          <>
            <p className="onboarding-step-label">Profile</p>
            <p>
              This fills in USER.md — the GPA and course-planning skills read
              it, so a few real answers here beat leaving it blank. Everything
              is optional and editable later.
            </p>
            <input
              value={studentName}
              onChange={(e) => setStudentName(e.target.value)}
              placeholder="Your name"
              aria-label="Name"
            />
            <input
              value={major}
              onChange={(e) => setMajor(e.target.value)}
              placeholder="Declared major(s)"
              aria-label="Declared major(s)"
            />
            <div className="onboarding-row">
              <input
                value={catalogYear}
                onChange={(e) => setCatalogYear(e.target.value)}
                placeholder="Catalog year (e.g. 2025)"
                aria-label="Catalog year"
              />
              <input
                value={targetGradTerm}
                onChange={(e) => setTargetGradTerm(e.target.value)}
                placeholder="Target grad term (e.g. Spring 2028)"
                aria-label="Target grad term"
              />
            </div>
            <p className="onboarding-help">Interests, ranked (optional)</p>
            <div className="onboarding-row">
              <input
                value={interest1}
                onChange={(e) => setInterest1(e.target.value)}
                placeholder="1. e.g. backend infra"
                aria-label="Interest 1"
              />
              <input
                value={interest2}
                onChange={(e) => setInterest2(e.target.value)}
                placeholder="2."
                aria-label="Interest 2"
              />
              <input
                value={interest3}
                onChange={(e) => setInterest3(e.target.value)}
                placeholder="3."
                aria-label="Interest 3"
              />
            </div>
            <p className="onboarding-help">Career priorities, ranked (optional)</p>
            <div className="onboarding-row">
              <input
                value={careerPriority1}
                onChange={(e) => setCareerPriority1(e.target.value)}
                placeholder="1. e.g. startup"
                aria-label="Career priority 1"
              />
              <input
                value={careerPriority2}
                onChange={(e) => setCareerPriority2(e.target.value)}
                placeholder="2. e.g. software"
                aria-label="Career priority 2"
              />
              <input
                value={careerPriority3}
                onChange={(e) => setCareerPriority3(e.target.value)}
                placeholder="3. e.g. ops"
                aria-label="Career priority 3"
              />
            </div>
            <input
              value={goodStandingGpa}
              onChange={(e) => setGoodStandingGpa(e.target.value)}
              placeholder="Good-standing target GPA (default 2.0)"
              aria-label="Good-standing target GPA"
            />
            <textarea
              placeholder="Transfer / AP / prior credit notes (optional)"
              rows={3}
              value={otherNotes}
              onChange={(e) => setOtherNotes(e.target.value)}
              aria-label="Transfer and prior credit notes"
            />
            <p className="onboarding-help">
              Values and throwaway courses stay in USER.md for later editing —
              this box only writes Transfer / credit notes. The same text is
              also kept as priorities.txt when you finish onboarding.
            </p>
            <button
              type="button"
              className="primary"
              disabled={profileSaveBusy}
              onClick={() => {
                const interests = [interest1, interest2, interest3].filter(
                  (v) => v.trim()
                );
                const careerPriorities = [
                  careerPriority1,
                  careerPriority2,
                  careerPriority3,
                ].filter((v) => v.trim());
                // Institution is resolved from schools/{slug}.yaml in
                // user_profile when left blank — keep the TS payload empty
                // so the Python writer owns the registry lookup.
                const identity: OnboardingIdentity = {
                  name: studentName,
                  institution: "",
                  schoolSlug: school,
                  major,
                  minor: "",
                  catalogYear,
                  targetGradTerm,
                  interests,
                  goodStandingGpa,
                  scholarshipMinGpa: "",
                  careerPriorities,
                  values: [],
                  transferNotes: otherNotes,
                };
                setProfileSaveBusy(true);
                setProfileSaveError(null);
                saveUserProfile(identity)
                  .then(() => setStep(4))
                  .catch((e) => {
                    console.error(e);
                    setProfileSaveError(String(e));
                  })
                  .finally(() => setProfileSaveBusy(false));
              }}
            >
              {profileSaveBusy ? "Saving…" : "Continue"}
            </button>
            {profileSaveError && <p className="error">{profileSaveError}</p>}
          </>
        )}
        {step === 4 && !isWaitlist && (
          <div className="learning-profile-onboarding">
            <p className="onboarding-step-label">How we work</p>
            <p>Three quick ones — how do you want me to work with you?</p>

            {practiceFormat === null || checkDepth === null ? (
              <PracticeFormatGame
                onComplete={({ practiceFormat: pf, checkDepth: cd }) => {
                  setPracticeFormat(pf);
                  setCheckDepth(cd);
                }}
              />
            ) : (
              <div className="lp-game">
                <p className="lp-game-title">Practice format</p>
                <p className="lp-done-note">
                  Saved as start with a worked example, then retrieve
                  {" · "}
                  check depth {checkDepth}. A fluent pass here does not set how
                  you learn.
                </p>
              </div>
            )}

            <AutonomyGame value={autonomy} onChange={setAutonomy} />
            <ChunkSizeGame value={chunkSize} onChange={setChunkSize} />

            <label className="check-intention-opt">
              <input
                type="checkbox"
                checked={checkFirst}
                onChange={(e) => setCheckFirst(e.target.checked)}
              />{" "}
              When I open the dock, I do the 5-minute check first.
            </label>

            <button
              type="button"
              className="primary"
              disabled={profileSaving || !profileReady}
              onClick={() => {
                if (!profileReady) return;
                const answers: LearningProfileAnswers = {
                  practiceFormat,
                  autonomy,
                  chunkSize,
                  checkDepth,
                  ifThen: checkFirst
                    ? "When I open the dock, I do the 5-minute check first."
                    : "",
                };
                setProfileSaving(true);
                setProfileError(null);
                saveLearningProfile(answers)
                  .then(() => setStep(5))
                  .catch((e) => {
                    console.error(e);
                    setProfileError(String(e));
                  })
                  .finally(() => setProfileSaving(false));
              }}
            >
              {profileSaving ? "Saving…" : "Continue"}
            </button>
            {profileError && <p className="error">{profileError}</p>}
            <button
              type="button"
              className="skip"
              onClick={() => setStep(5)}
            >
              Skip — I&apos;ll figure this out as I go
            </button>
          </div>
        )}
        {step === 5 && !isWaitlist && (
          <>
            <p className="onboarding-step-label">Finish</p>
            <p>
              Optional hosted API key for assistant calls. Skip to finish without
              a key. You can add one later.
            </p>
            <input
              value={cloudKey}
              onChange={(e) => setCloudKey(e.target.value)}
              placeholder="Cloud API key"
              autoComplete="off"
            />
            <label className="telemetry">
              <input
                type="checkbox"
                checked={sentryOptIn}
                onChange={(e) => setSentryOptIn(e.target.checked)}
              />{" "}
              Opt in to crash telemetry (Sentry) for beta
            </label>
            <button
              type="button"
              className="primary"
              disabled={finishing}
              onClick={() => {
                setFinishing(true);
                setFinishError(null);
                saveOnboarding(school, cloudKey.trim(), {
                  priorities: otherNotes,
                  sentryOptIn,
                })
                  .then(() => onDone())
                  .catch((e) => {
                    console.error(e);
                    setFinishError(String(e));
                  })
                  .finally(() => setFinishing(false));
              }}
            >
              {finishing
                ? "Saving…"
                : cloudKey.trim()
                  ? "Save key & finish"
                  : "Skip cloud key & finish"}
            </button>
            {finishError && <p className="error">{finishError}</p>}
          </>
        )}
      </div>
    </div>
  );
}
