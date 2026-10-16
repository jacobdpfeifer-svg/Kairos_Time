import { useEffect, useState } from "react";
import { advisorWrites, aiStudy, listProfiles, runtimeInfo, setProfile, study, type AiStatus } from "../study/api";
import type { RuntimeInfo, Status } from "../study/types";
import { THEMES, useTheme } from "../theme";
import { DEFAULT_APP_PREFS, readExtensionStatus, checkCanvasSession, exportCanvas, isTauri, openCanvasSso, saveLearningProfile, syncCanvas, type LearningProfileAnswers } from "../ipc";
import { savePrefs, usePrefs } from "../prefs";
import { MOD } from "../nav";
import { ConnectorsPanel } from "./ConnectorsPanel";
import { SourcesView } from "./SourcesView";
import { BriefSettings } from "../missionControl/BriefSettings";

/** Older deep links and saved groups from before the groups were folded together. */
const LEGACY_GROUPS: Record<string, string> = {
  profiles: "profile",
  preferences: "profile",
  usage: "privacy",
  diagnostics: "canvas",
};

export function SettingsView({ initialGroup }: { initialGroup?: string } = {}) {
  const { theme, setTheme, motion, setMotion } = useTheme();
  const [runtime, setRuntime] = useState<RuntimeInfo | null>(null);
  const [profiles, setProfiles] = useState<{ current: string; profiles: string[]; root: string } | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [canvas, setCanvas] = useState<string>("");
  const [exporting, setExporting] = useState(false);
  const [exportGrades, setExportGrades] = useState(false);
  const [exportResult, setExportResult] = useState<string>("");
  const [newProfile, setNewProfile] = useState("");
  const [note, setNote] = useState("");
  const [usageOptIn, setUsageOptIn] = useState(() => localStorage.getItem("pn_usage_counts") === "1");
  const [ai, setAi] = useState<AiStatus | null>(null);
  const [relayUrl, setRelayUrl] = useState("");
  const [invite, setInvite] = useState("");
  const [aiNote, setAiNote] = useState("");
  const [group, setGroup] = useState(() => LEGACY_GROUPS[initialGroup ?? ""] ?? initialGroup ?? "canvas");
  const refreshAi = () => void aiStudy.status().then(setAi).catch(() => setAi(null));

  useEffect(() => {
    refreshAi();
    void runtimeInfo().then(setRuntime).catch(() => setRuntime(null));
    void listProfiles().then(setProfiles).catch(() => setProfiles(null));
    void study.status().then(setStatus).catch(() => setStatus(null));
  }, []);

  useEffect(() => {
    localStorage.setItem("pn_usage_counts", usageOptIn ? "1" : "0");
  }, [usageOptIn]);

  const switchProfile = async (id: string) => {
    const res = await setProfile(id);
    if (res?.restart_required) setNote(`Profile set to “${id}”. Quit and reopen the app to use it.`);
  };

  const probeCanvas = async () => {
    setCanvas("Checking…");
    try {
      const ok = await checkCanvasSession();
      setCanvas(ok ? "Signed in to Canvas (session cookies found)." : "No Canvas session. Sign in to sync.");
    } catch (e) {
      setCanvas(`Could not check: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const runSync = async () => {
    setCanvas("Syncing…");
    const res = await syncCanvas();
    setCanvas(res.ok ? "Sync finished." : `Sync failed: ${res.error ?? "unknown"}`);
  };

  const runExport = async () => {
    setExporting(true);
    setExportResult("");
    try {
      const result = await exportCanvas(exportGrades);
      setExportResult(`ZIP ready: ${result.zip} (${result.grades_included ? "grades included" : "grades left out"})`);
    } catch (e) {
      setExportResult(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setExporting(false);
    }
  };

  const groups = [
    ["canvas", "Canvas"],
    ["briefs", "Briefs"],
    ["mac", "Menu bar and alerts"],
    ["ai", "AI help"],
    ["connectors", "Calendar"],
    ["appearance", "Appearance"],
    ["profile", "Profile"],
    ["privacy", "Privacy"],
  ] as const;

  return (
    <section className="settings settings-stage scene-paper" aria-labelledby="settings-heading">
      <h1 id="settings-heading">Settings</h1>
      <nav className="settings-index" aria-label="Settings sections">
        {groups.map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-current={group === id ? "true" : undefined}
            onClick={() => setGroup(id)}
          >
            {label}
          </button>
        ))}
      </nav>
      <div className="settings-subject">
      {group === "appearance" && (
      <>
      <h2>Appearance</h2>
      <fieldset className="theme-grid">
        <legend className="visually-hidden">Theme</legend>
        {THEMES.map((t) => (
          <label key={t.id} className={theme === t.id ? "on" : undefined} data-theme-preview={t.id} aria-label={t.label}>
            <input type="radio" name="theme" value={t.id} checked={theme === t.id} onChange={() => setTheme(t.id)} />
            <span className="swatch" aria-hidden="true" />
            <span>{t.label}</span>
          </label>
        ))}
      </fieldset>
      <label className="check">
        <input type="checkbox" checked={motion === "reduced"} onChange={(e) => setMotion(e.target.checked ? "reduced" : "auto")} />
        <span className="check-box" aria-hidden="true" />
        Reduce motion (also follows your system setting)
      </label>
      </>
      )}

      {group === "canvas" && (
      <>
      <h2>Canvas</h2>
      <p className="muted">Sign in happens in a separate browser window with your school's SSO. Cookies stay in this profile's folder; no password is stored.</p>
      <div className="row">
        <button type="button" onClick={() => void openCanvasSso()} disabled={!isTauri()}>
          Sign in to Canvas
        </button>
        <button type="button" onClick={() => void probeCanvas()} disabled={!isTauri()}>
          Check session
        </button>
        <button type="button" onClick={() => void runSync()} disabled={!isTauri()}>
          Sync now
        </button>
      </div>
      {canvas && <p role="status">{canvas}</p>}
      <ExtensionStatus />

      <details className="settings-advanced">
        <summary>Study material and practice questions</summary>
        <p className="muted">What Kairos reads from your courses for practice, exam dates it inferred, and question packets. Most students never need this.</p>
        <SourcesView embedded />
      </details>
      <section className="canvas-export" aria-labelledby="canvas-export-heading">
        <h3 id="canvas-export-heading">Export my Canvas data</h3>
        <p className="muted">
          Create a portable ZIP with agent-friendly Markdown and JSON. Module order, source IDs, Canvas links, timestamps, and data-quality labels are preserved.
          External/LTI/proctored items remain links for Canvas.
        </p>
        <label className="check-row">
          <input type="checkbox" checked={exportGrades} onChange={(e) => setExportGrades(e.target.checked)} />
          Include grades (optional)
        </label>
        <div className="row">
          <button type="button" className="primary" disabled={!isTauri() || exporting} onClick={() => void runExport()}>
            {exporting ? "Creating export…" : "Export my Canvas data"}
          </button>
          {!isTauri() && <span className="muted">Exports run in the desktop app.</span>}
        </div>
        {exportResult && <p className="notice" role="status">{exportResult}</p>}
        <p className="muted">Upload the Markdown files to NotebookLM or another agent. PDF is intentionally not the source format; the export is optimized for Markdown and JSON.</p>
      </section>
      </>
      )}

      {group === "profile" && (
      <>
      <h2>Profile</h2>
      <ProgramForm />
      <LearningForm />
      {profiles && (
        <details className="settings-advanced">
          <summary>Separate profiles</summary>
          <p className="muted">
            Data folder: <code>{profiles.root}</code>. Each profile keeps its own sources, history, and Canvas session.
          </p>
          <ul>
            {profiles.profiles.map((id) => (
              <li key={id}>
                {id}
                {id === profiles.current ? " (current)" : ""}
                {id !== profiles.current && (
                  <button type="button" className="link" onClick={() => void switchProfile(id)}>
                    Use this profile
                  </button>
                )}
              </li>
            ))}
          </ul>
          <div className="row">
            <label>
              <span className="visually-hidden">New profile name</span>
              <input type="text" value={newProfile} onChange={(e) => setNewProfile(e.target.value)} placeholder="new-profile" pattern="[A-Za-z0-9._-]{1,64}" />
            </label>
            <button type="button" disabled={!/^[A-Za-z0-9._-]{1,64}$/.test(newProfile)} onClick={() => void switchProfile(newProfile)}>
              Create and switch
            </button>
          </div>
          {note && <p role="status">{note}</p>}
        </details>
      )}
      </>
      )}

      {group === "mac" && <MacPanel />}

      {group === "briefs" && <BriefSettings tester={Boolean(ai?.connected)} />}

      {group === "privacy" && (
      <>
      <h2>Privacy</h2>
      <p>
        Your study history is stored locally. When you ask for AI help, selected material and your answer pass through our service to the model provider. Our service is designed not to retain that content; provider retention policies still apply. Optional usage counts are off until you enable them.
      </p>
      </>
      )}

      {group === "privacy" && (
      <>
      <h3>Usage counts (optional)</h3>
      <label className="check-row">
        <input type="checkbox" checked={usageOptIn} onChange={(e) => setUsageOptIn(e.target.checked)} />
        Share anonymous session started/finished counts. Off by default. Never answers, scores, sources, or progress.
      </label>
      <p className="muted">Nothing is sent in this beta build: no collector exists yet. The switch records only your preference.</p>
      </>
      )}

      {group === "connectors" && (
      <>
      <h2>Calendar and email</h2>
      <ConnectorsPanel />
      </>
      )}

      {group === "ai" && (
      <>
      <h2>AI help (beta, funded by the owner)</h2>
      {ai?.connected ? (
        <>
          <p>
            Connected{ai.reachable === false ? " — service unreachable right now" : ""}
            {ai.revoked ? " — access has been revoked" : ""}.
            {typeof ai.settled === "number" && typeof ai.allowance_cents === "number" ? ` Used ${((ai.settled + (ai.outstanding ?? 0)) / 100).toFixed(2)} of $${(ai.allowance_cents / 100).toFixed(2)} (includes held reservations).` : ""}
          </p>
          <button
            type="button"
            onClick={() => {
              void aiStudy.disconnect().then(refreshAi);
            }}
          >
            Disconnect
          </button>
        </>
      ) : (
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            setAiNote("");
            void aiStudy
              .connect(relayUrl, invite)
              .then(() => {
                setInvite("");
                refreshAi();
              })
              .catch((err) => setAiNote(err instanceof Error ? err.message : String(err)));
          }}
        >
          <label>
            <span className="visually-hidden">Relay URL</span>
            <input type="url" placeholder="https://relay.example" value={relayUrl} onChange={(e) => setRelayUrl(e.target.value)} required />
          </label>
          <label>
            <span className="visually-hidden">Invite code</span>
            <input type="text" placeholder="invite code" value={invite} onChange={(e) => setInvite(e.target.value)} required autoComplete="off" />
          </label>
          <button type="submit" className="primary">
            Connect
          </button>
        </form>
      )}
      {aiNote && (
        <p className="error" role="alert">
          {aiNote}
        </p>
      )}
      </>
      )}


      {group === "canvas" && (
      <>
      <h2>Diagnostics</h2>
      {runtime ? (
        <dl className="diag">
          <dt>Runtime</dt>
          <dd>{runtime.mode === "bundled" ? "bundled (installed app)" : runtime.mode === "broken" ? "incomplete install — the bundled runtime is missing" : "developer checkout"}</dd>
          <dt>Profile</dt>
          <dd>
            {runtime.profile_id}, <code>{runtime.user_root}</code>
          </dd>
          <dt>Python</dt>
          <dd>
            <code>{runtime.python}</code>
          </dd>
          <dt>Node</dt>
          <dd>{runtime.node ? <code>{runtime.node}</code> : "not found — Canvas sync unavailable"}</dd>
          {runtime.diagnostics.length > 0 && (
            <>
              <dt>Problems</dt>
              <dd>
                <ul>
                  {runtime.diagnostics.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              </dd>
            </>
          )}
        </dl>
      ) : (
        <p className="muted">Runtime details are available in the desktop app.</p>
      )}
      {status && (
        <dl className="diag">
          <dt>Study log</dt>
          <dd>
            {status.log.events} events{status.log.partial_tail ? " · a partial line will be repaired on next save" : ""}
          </dd>
          <dt>Clock</dt>
          <dd>
            {status.clock.status} — {status.clock.note}
          </dd>
        </dl>
      )}
      </>
      )}
      </div>
    </section>
  );
}

/** The Program lines Advisor reads, edited in place (study/audit_copy.py touches only these lines of USER.md). */
function ProgramForm() {
  const [form, setForm] = useState({ program: "", catalog_year: "", target_term: "" });
  const [note, setNote] = useState("");
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <form
      className="settings-form"
      onSubmit={(e) => {
        e.preventDefault();
        setNote("");
        const filled = Object.fromEntries(Object.entries(form).filter(([, v]) => v.trim()));
        if (!Object.keys(filled).length) return;
        void advisorWrites
          .profileFields(filled)
          .then(() => setNote("Saved. Advisor uses it right away."))
          .catch((err: unknown) => setNote(err instanceof Error ? err.message : "That didn't save."));
      }}
    >
      <h3>Your program</h3>
      <label>
        Program or major
        <input value={form.program} onChange={set("program")} placeholder="Aerospace Engineering Sciences" />
      </label>
      <label>
        Catalog year
        <input value={form.catalog_year} onChange={set("catalog_year")} placeholder="2025-2026" />
      </label>
      <label>
        When you plan to graduate
        <input value={form.target_term} onChange={set("target_term")} placeholder="Spring 2029" />
      </label>
      <div className="row">
        <button type="submit">Save</button>
        {note && <span role="status">{note}</span>}
      </div>
    </form>
  );
}

/** How Kairos starts a study session. Answers only change the first step, never what counts as learned. */
function LearningForm() {
  const [answers, setAnswers] = useState<LearningProfileAnswers>({ practiceFormat: "retrieval", autonomy: "choices", chunkSize: "short", checkDepth: "light" });
  const [note, setNote] = useState("");
  const pick = <K extends keyof LearningProfileAnswers>(k: K) => (e: { target: { value: string } }) =>
    setAnswers((a) => ({ ...a, [k]: e.target.value as LearningProfileAnswers[K] }));
  return (
    <form
      className="settings-form"
      onSubmit={(e) => {
        e.preventDefault();
        void saveLearningProfile(answers)
          .then(() => setNote("Saved."))
          .catch(() => setNote("That didn't save."));
      }}
    >
      <h3>How you like to study</h3>
      <label>
        Start with
        <select value={answers.practiceFormat} onChange={pick("practiceFormat")}>
          <option value="retrieval">Trying it from memory</option>
          <option value="worked_example">A worked example</option>
        </select>
      </label>
      <label>
        Kairos should
        <select value={answers.autonomy} onChange={pick("autonomy")}>
          <option value="choices">Give me a couple of options</option>
          <option value="directive">Just tell me what's next</option>
        </select>
      </label>
      <label>
        Sessions
        <select value={answers.chunkSize} onChange={pick("chunkSize")}>
          <option value="short">Short, five minutes or so</option>
          <option value="long">Longer, when I have time</option>
        </select>
      </label>
      <div className="row">
        <button type="submit">Save</button>
        {note && <span role="status">{note}</span>}
      </div>
    </form>
  );
}

const SHORTCUTS: [string, string][] = [
  ["", "Off"],
  ["Control+Alt+Space", "Control Option Space"],
  ["Control+Alt+K", "Control Option K"],
  ["CommandOrControl+Shift+Space", "Command Shift Space"],
];

/**
 * The four native opt-ins approved 2026-10-13, all off until the student turns
 * them on. Each control does exactly what it says, nothing more.
 */
function MacPanel() {
  const prefs = usePrefs() ?? DEFAULT_APP_PREFS;
  const [autostart, setAutostart] = useState<boolean | null>(null);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!isTauri()) return;
    void import("@tauri-apps/plugin-autostart")
      .then((m) => m.isEnabled())
      .then(setAutostart)
      .catch(() => setAutostart(null));
  }, []);

  const save = (patch: Partial<typeof prefs>) => {
    setNote("");
    return savePrefs({ ...prefs, ...patch }).catch((e: unknown) => {
      setNote(e instanceof Error ? e.message : String(e));
    });
  };

  return (
    <>
      <h2>Menu bar and alerts</h2>
      <p className="muted">All of these are off until you turn them on.</p>

      <label className="check-row">
        <input
          type="checkbox"
          checked={Boolean(autostart)}
          disabled={!isTauri() || autostart === null}
          onChange={async (e) => {
            const on = e.target.checked;
            try {
              const m = await import("@tauri-apps/plugin-autostart");
              if (on) await m.enable();
              else await m.disable();
              setAutostart(await m.isEnabled());
            } catch {
              setNote("macOS didn't let Kairos change its login item.");
            }
          }}
        />
        Open Kairos when you log in
      </label>

      <label className="check-row">
        <input type="checkbox" checked={prefs.keep_running} disabled={!isTauri()} onChange={(e) => void save({ keep_running: e.target.checked })} />
        Keep syncing in the menu bar when the window is closed
      </label>

      <label className="check-row">
        <input
          type="checkbox"
          checked={prefs.notifications}
          disabled={!isTauri()}
          onChange={async (e) => {
            const on = e.target.checked;
            if (on) {
              try {
                const m = await import("@tauri-apps/plugin-notification");
                const granted = (await m.isPermissionGranted()) || (await m.requestPermission()) === "granted";
                if (!granted) {
                  setNote("macOS has notifications off for Kairos. Turn them on in System Settings, Notifications.");
                  return;
                }
              } catch {
                setNote("Notifications aren't available in this build.");
                return;
              }
            }
            void save({ notifications: on });
          }}
        />
        Notifications
      </label>
      <p className="muted settings-help">
        Only three things: a due date moved, an exam or big assignment is within two days and not done, or Canvas sign-in needs renewing. Never at night or during class,
        at most three a day. Kairos has to be running to notice, so keep syncing in the menu bar too.
      </p>

      <label className="settings-select">
        Capture shortcut, from anywhere on your Mac
        <select
          value={prefs.capture_shortcut ?? ""}
          disabled={!isTauri()}
          onChange={(e) => void save({ capture_shortcut: e.target.value || null })}
        >
          {SHORTCUTS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <p className="muted settings-help">Opens Kairos with the capture line ready. Type "read ch 5 thu" and Kairos shows the date before it saves.</p>

      {note && (
        <p role="alert" className="ask-error">
          {note}
        </p>
      )}

      <h3>Keys inside Kairos</h3>
      <dl className="shortcut-list">
        <dt>{MOD}K</dt>
        <dd>Search, commands, and capture</dd>
        <dt>{MOD}J</dt>
        <dd>Ask Kairos</dd>
        <dt>{MOD}1 to {MOD}5</dt>
        <dd>Today, Week, Courses, Study, Advisor</dd>
        <dt>{MOD},</dt>
        <dd>Settings</dd>
        <dt>J and K</dt>
        <dd>Move between rows on Week</dd>
        <dt>D</dt>
        <dd>Defer the focused row to the next day</dd>
      </dl>
    </>
  );
}

/** Whether Kairos for Canvas (the Chrome extension) has reached this app. The app installs its side of the connection itself. */
function ExtensionStatus() {
  const [at, setAt] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    void readExtensionStatus()
      .then((s) => setAt(s.connected_at))
      .catch(() => setAt(null));
  }, []);
  if (at === undefined) return null;
  return (
    <p className="muted">
      {at
        ? `Kairos for Canvas, the Chrome extension, is connected. It first reached this app on ${new Date(at).toLocaleDateString(undefined, { month: "long", day: "numeric" })}.`
        : "Kairos for Canvas, the Chrome extension, hasn't connected yet. Once it's added to Chrome it finds this app on its own."}
    </p>
  );
}
