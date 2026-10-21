// Purpose: school and canvas onboarding
import { useEffect, useRef, useState } from "react";
import { schoolLegalText } from "../legal";
import { LegalText } from "./LegalText";
import { Wordmark } from "./Wordmark";
import {
  checkCanvasSession,
  chooseSchool,
  onStudySyncProgress,
  openCanvasSso,
  saveOnboarding,
  searchSchools,
  syncStudySourcesIpc,
  readSyncHealth,
  readSyncProgress,
  type SchoolMatch,
  type SchoolProfile,
  type SyncProgressCourse,
} from "../ipc";
import { runtimeInfo } from "../study/api";
import { ConnectCanvasMark, useReducedMotion } from "./ConnectCanvasMark";

/*
 * First run (MASTER §10, §12): one question per screen.
 *   school -> the student finds their school by name (public Instructure search)
 *             or pastes their Canvas address. Nothing is hard-coded.
 *   canvas -> SSO into that school's Canvas.
 *   sync   -> classes arrive, then Home.
 */
type Step = "school" | "canvas" | "sync";

function shortName(name: string): string {
  // Keep campus names ("University of Michigan - Ann Arbor"); drop only a trailing
  // alias that repeats the school in short form ("... - CU Boulder", "... - CarmenCanvas").
  const parts = name.split(/\s[-–]\s/);
  if (parts.length === 2 && (/canvas/i.test(parts[1]) || parts[1].split(/\s+/).some((w) => /^[A-Z]{2,4}$/.test(w)))) {
    return parts[0].trim();
  }
  return name.trim();
}

/**
 * Native failures arrive as process text ("open-canvas exited with exit status: 1").
 * Keep sentences written for students; replace process text with what to do next.
 */
export function plainCanvasError(raw: string, fallback: string): string {
  const msg = raw.trim();
  if (/login_expired|stale request|used the back button|secure web site/i.test(msg)) {
    return "The school sign-in page expired. Close that page, then restart sign-in in Kairos.";
  }
  if (/network|ENOTFOUND|ECONNREFUSED|getaddrinfo|timed? ?out/i.test(msg)) return "Couldn't reach Canvas. Check your connection and try again.";
  if (/chrome/i.test(msg) && /not found|install|executable/i.test(msg)) return "Kairos opens your school's sign-in in Google Chrome. Install Chrome, then try again.";
  if (/not logged in|session/i.test(msg) && /sign|log/i.test(msg) && !/exit/i.test(msg)) return msg;
  if (!msg || /exit status|exited with|failed to spawn|traceback|runtime not|\bat \S+:\d+/i.test(msg)) return fallback;
  return msg;
}

const SIGN_IN_FAILED = "The sign-in window closed before Canvas finished. Try again.";
const SYNC_FAILED = "Kairos couldn't read your classes from Canvas. Your sign-in may have expired, or Canvas didn't answer.";
const NO_COURSES = "Canvas answered, but this account has no current classes. Check that you signed in to the right school, then try again.";

export function FirstRun({
  onDone,
  progressCourses,
  startStep = "school",
}: {
  onDone: () => void;
  progressCourses?: SyncProgressCourse[];
  startStep?: Step;
}) {
  const [step, setStep] = useState<Step>(startStep);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SchoolMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const [schoolSearchError, setSchoolSearchError] = useState<string | null>(null);
  const [picked, setPicked] = useState<SchoolMatch | null>(null);
  const [manual, setManual] = useState(false);
  const [manualHost, setManualHost] = useState("");
  const [profile, setProfile] = useState<SchoolProfile | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [termsOpen, setTermsOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [session, setSession] = useState<"unknown" | "checking" | "returning" | "found" | "missing">("unknown");
  const [ssoBusy, setSsoBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [courses, setCourses] = useState<SyncProgressCourse[]>(progressCourses ?? []);
  const [syncing, setSyncing] = useState(false);
  const [syncFailed, setSyncFailed] = useState(false);
  const [syncAttempt, setSyncAttempt] = useState(0);
  const [blocker, setBlocker] = useState<string | null>(null);
  const termsButton = useRef<HTMLButtonElement | null>(null);
  const termsClose = useRef<HTMLButtonElement | null>(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const heading = useRef<HTMLHeadingElement | null>(null);
  const reduced = useReducedMotion();
  const schoolName = profile ? shortName(profile.display_name) : picked ? shortName(picked.name) : "";
  const legal = schoolLegalText(schoolName);
  const manualOk = /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(manualHost.trim().replace(/^https?:\/\//i, "").split("/")[0] || "");
  const canContinue = accepted && !saving && (manual ? manualOk : Boolean(picked));

  useEffect(() => {
    heading.current?.focus();
  }, [step]);

  // An installed copy without its runtime can't reach Canvas; say so before the student starts.
  useEffect(() => {
    let alive = true;
    runtimeInfo()
      .then((rt) => {
        if (!alive || !rt) return;
        const fatal = rt.mode === "broken" || !rt.node;
        const chrome = rt.diagnostics.find((d) => /chrome/i.test(d));
        if (fatal) setBlocker("This copy of Kairos is incomplete, so it can't connect to Canvas. Download Kairos again, or send the owner the details in Settings → Diagnostics.");
        else if (chrome) setBlocker("Kairos opens your school's sign-in in Google Chrome, and Chrome isn't installed. Install Chrome, then reopen Kairos.");
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!termsOpen) return;
    termsClose.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setTermsOpen(false);
        window.setTimeout(() => termsButton.current?.focus(), 0);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [termsOpen]);

  const closeTerms = () => {
    setTermsOpen(false);
    window.setTimeout(() => termsButton.current?.focus(), 0);
  };

  useEffect(() => {
    if (progressCourses) setCourses(progressCourses);
  }, [progressCourses]);

  // Debounced school search.
  useEffect(() => {
    if (step !== "school" || manual) return;
    const q = query.trim();
    if (q.length < 2 || (picked && q === picked.name)) {
      setResults([]);
      setSchoolSearchError(null);
      return;
    }
    let alive = true;
    setSearching(true);
    const t = window.setTimeout(() => {
      searchSchools(q)
        .then((rows) => {
          if (!alive) return;
          setResults(rows);
          setSchoolSearchError(null);
        })
        .catch((e) => {
          if (!alive) return;
          setResults([]);
          setSchoolSearchError("Kairos couldn't search the school catalog. Check your connection and try again.");
          console.error("school search failed", e);
        })
        .finally(() => alive && setSearching(false));
    }, 250);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [query, step, manual, picked]);

  useEffect(() => {
    if (step !== "canvas" || session !== "unknown") return;
    setSession("checking");
    checkCanvasSession()
      .then((ok) => setSession(ok ? "found" : "missing"))
      .catch(() => setSession("missing"));
  }, [step, session]);

  useEffect(() => {
    if (step !== "canvas" || session !== "found") return;
    const t = window.setTimeout(() => setStep("sync"), 700);
    return () => window.clearTimeout(t);
  }, [step, session]);

  // First sync (a full term-wide Canvas read when the profile has none yet). A
  // failure stays on this screen with a reason and a retry instead of landing
  // on an empty Home.
  useEffect(() => {
    if (step !== "sync") return;
    let cancelled = false;
    setSyncing(true);
    setSyncFailed(false);
    setError(null);
    void onStudySyncProgress((p) => {
      if (!cancelled && p.courses) setCourses(p.courses);
    });
    const fail = (raw: string) => {
      setError(plainCanvasError(raw, SYNC_FAILED));
      setSyncFailed(true);
    };
    syncStudySourcesIpc()
      .then((res) => {
        if (cancelled) return;
        if (!res.ok) {
          fail(res.error || "");
          return;
        }
        void Promise.all([readSyncHealth(), readSyncProgress()])
          .then(([health, progress]) => {
            if (cancelled) return;
            // fresh_partial still lands on Home, which names what's missing;
            // stale or empty projections mean this sync didn't really read Canvas.
            const fresh = health.state === "fresh_complete" || health.state === "fresh_partial";
            if (!fresh || !health.sync_id || !health.as_of || progress.phase !== "done") {
              fail("");
              return;
            }
            if (progress.courses.length === 0) {
              fail(NO_COURSES);
              return;
            }
            doneRef.current();
          })
          .catch((e) => {
            if (!cancelled) fail(e instanceof Error ? e.message : String(e));
          });
      })
      .catch((e) => {
        if (!cancelled) fail(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setSyncing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [step, syncAttempt]);

  const confirmSchool = async () => {
    setSaving(true);
    setError(null);
    try {
      const host = manual ? manualHost.trim().replace(/^https?:\/\//i, "").split("/")[0] : (picked as SchoolMatch).host;
      const chosen = await chooseSchool(
        manual ? { host, name: host } : { host, name: (picked as SchoolMatch).name, account_id: (picked as SchoolMatch).account_id },
        manual
      );
      setProfile(chosen);
      await saveOnboarding(chosen.slug);
      setStep("canvas");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const signIn = async () => {
    setSsoBusy(true);
    setError(null);
    try {
      await openCanvasSso();
      setSession("returning");
      let ok = false;
      for (let attempt = 0; attempt < 4 && !ok; attempt += 1) {
        ok = await checkCanvasSession();
        if (!ok && attempt < 3) await new Promise((resolve) => window.setTimeout(resolve, 750));
      }
      setSession(ok ? "found" : "missing");
      if (!ok) setError(SIGN_IN_FAILED);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(plainCanvasError(msg, SIGN_IN_FAILED));
      setSession("missing");
    } finally {
      setSsoBusy(false);
    }
  };

  const checkAgain = async () => {
    setError(null);
    setSession("checking");
    try {
      const ok = await checkCanvasSession();
      setSession(ok ? "found" : "missing");
      if (!ok) setError("Kairos still can't find a Canvas session. Finish the school sign-in, then try again.");
    } catch (e) {
      setSession("missing");
      setError(plainCanvasError(e instanceof Error ? e.message : String(e), SIGN_IN_FAILED));
    }
  };

  return (
    <div className="onboarding first-run nb-onboarding">
      <Wordmark className="nb-wordmark" />

      {step === "school" && (
        <section className="nb-step" aria-labelledby="school-title">
          <h1 id="school-title" ref={heading} tabIndex={-1}>
            Where do you go to school?
          </h1>

          {!manual && (
            <>
              <label htmlFor="school-search">School</label>
              <input
                id="school-search"
                type="search"
                autoComplete="off"
                placeholder="Start typing your school's name"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPicked(null);
                }}
              />
              {schoolSearchError && <p className="error" role="alert">{schoolSearchError}</p>}
              <p className="visually-hidden" role="status">
                {searching ? "Searching" : results.length ? `${results.length} schools found` : ""}
              </p>
              {results.length > 0 && !picked && (
                <ul className="nb-results" aria-label="Schools">
                  {results.map((r) => (
                    <li key={r.host}>
                      <button
                        type="button"
                        onClick={() => {
                          setPicked(r);
                          setQuery(r.name);
                          setResults([]);
                        }}
                      >
                        <strong>{r.name}</strong>
                        <span className="muted">{r.host}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {picked && (
                <p className="nb-picked">
                  <strong>{shortName(picked.name)}</strong>
                  <span className="muted">Canvas at {picked.host}</span>
                </p>
              )}
              <button type="button" className="link nb-alt" onClick={() => setManual(true)}>
                My school isn't listed
              </button>
            </>
          )}

          {manual && (
            <>
              <label htmlFor="canvas-host">Your Canvas address</label>
              <input
                id="canvas-host"
                type="url"
                inputMode="url"
                autoComplete="off"
                placeholder="canvas.yourschool.edu"
                value={manualHost}
                onChange={(e) => setManualHost(e.target.value)}
              />
              <p className="nb-help">It's the address in your browser when you're on Canvas.</p>
              <button type="button" className="link nb-alt" onClick={() => setManual(false)}>
                Search by name instead
              </button>
            </>
          )}

          <div className="nb-terms">
            <label className="nb-check">
              <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
              I agree to the beta terms
            </label>
            <button type="button" className="link" ref={termsButton} onClick={() => setTermsOpen(true)}>
              Read the terms
            </button>
          </div>

          {blocker && (
            <p className="error" role="alert">
              {blocker}
            </p>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button type="button" className="primary nb-continue" disabled={!canContinue} onClick={() => void confirmSchool()}>
            {saving ? "Saving…" : "Continue"}
          </button>
        </section>
      )}

      {step === "canvas" && (
        <section className="nb-step nb-center" aria-labelledby="canvas-title">
          <h1 id="canvas-title" ref={heading} tabIndex={-1}>
            {session === "found" ? "Canvas is connected" : session === "returning" ? "Back in Kairos" : "Your Canvas sign-in opens in Chrome"}
          </h1>
          <p className="nb-lede">
            {session === "found"
              ? "Kairos found your Canvas session. Your classes are next."
              : session === "returning"
                ? "Kairos is checking the Canvas session now."
              : schoolName
                ? `${schoolName} sign-in happens in Chrome. You type and complete MFA there.`
                : "School sign-in happens in Chrome. You type and complete MFA there."}
          </p>
          <div className="nb-mark">
            <ConnectCanvasMark reduced={reduced || session === "found"} />
          </div>
          {session !== "found" && session !== "returning" && <p className="nb-trust">Kairos stays underneath. It never sees your password or MFA code.</p>}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {session !== "found" && session !== "returning" && (
            <div className="row">
              <button type="button" className="primary" disabled={ssoBusy || session === "checking"} onClick={() => void signIn()}>
                {ssoBusy ? "Chrome sign-in is open…" : error ? "Restart sign-in" : "Open Chrome sign-in"}
              </button>
              {(session === "missing" || error) && (
                <button type="button" disabled={ssoBusy || session === "checking"} onClick={() => void checkAgain()}>
                  Check again
                </button>
              )}
            </div>
          )}
        </section>
      )}

      {step === "sync" && (
        <section className="nb-step" aria-labelledby="sync-title">
          <h1 id="sync-title" ref={heading} tabIndex={-1}>
            Getting your classes
          </h1>
          <ul className="nb-sync">
            {courses.map((c) => (
              <li key={c.id} style={{ ["--course" as string]: c.color || "var(--muted)" }}>
                <span className="course-dot" aria-hidden="true" />
                <strong>{c.label}</strong>
                <span className="muted">
                  {c.assignments ?? 0} assignments, {c.quizzes ?? 0} quizzes, {c.exam_count ?? 0} exams
                </span>
              </li>
            ))}
          </ul>
          {syncing && <p className="visually-hidden">Syncing classes</p>}
          {syncFailed && (
            <>
              <p className="error" role="alert">
                {error}
              </p>
              <div className="row">
                <button type="button" className="primary" onClick={() => setSyncAttempt((n) => n + 1)}>
                  Try again
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSyncFailed(false);
                    setError(null);
                    setSession("missing");
                    setStep("canvas");
                  }}
                >
                  Sign in again
                </button>
                <button type="button" className="link" onClick={() => doneRef.current()}>
                  Continue without classes
                </button>
              </div>
            </>
          )}
          {!syncFailed && <TrailDoodle />}
        </section>
      )}

      {termsOpen && (
        <div className="sheet-backdrop" role="presentation" onClick={closeTerms}>
          <div
            className="legal-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="terms-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="terms-title">Terms</h2>
            <LegalText text={legal} />
            <button type="button" className="primary" ref={termsClose} onClick={closeTerms}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Line doodle while classes load: a trail over two ridges (MASTER §07). Decorative. */
function TrailDoodle() {
  return (
    <svg className="nb-doodle" viewBox="0 0 320 120" aria-hidden="true">
      <path d="M6 108 L84 34 Q92 27 100 34 L150 82 L196 40 Q204 33 212 40 L314 108" />
      <path d="M70 48 L84 34 L98 47" className="snow" />
      <path d="M30 108 C 70 96 90 104 128 92 C 160 82 186 96 222 86 C 250 78 280 92 300 88" className="trail" />
      <circle cx="256" cy="22" r="11" className="sun" />
    </svg>
  );
}
