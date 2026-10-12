import { useEffect, useState } from "react";
import { aiStudy, listProfiles, runtimeInfo, setProfile, study, type AiStatus } from "../study/api";
import type { RuntimeInfo, Status } from "../study/types";
import { THEMES, useTheme } from "../theme";
import { checkCanvasSession, exportCanvas, isTauri, openCanvasSso, setDockMode, syncCanvas } from "../ipc";
import { Onboarding } from "../components/Onboarding";
import { ConnectorsPanel } from "./ConnectorsPanel";
import { SourcesView } from "./SourcesView";

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
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [ai, setAi] = useState<AiStatus | null>(null);
  const [relayUrl, setRelayUrl] = useState("");
  const [invite, setInvite] = useState("");
  const [aiNote, setAiNote] = useState("");
  const [group, setGroup] = useState(initialGroup ?? "appearance");
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
    ["appearance", "Appearance"],
    ["canvas", "Canvas"],
    ["profiles", "Profiles"],
    ["preferences", "Preferences"],
    ["usage", "Usage"],
    ["connectors", "Calendar"],
    ["ai", "AI help"],
    ["privacy", "Privacy"],
    ["diagnostics", "Diagnostics"],
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
      <label className="check-row">
        <input
          type="checkbox"
          defaultChecked={false}
          onChange={(e) => {
            if (e.target.checked) void setDockMode("peek");
            else void setDockMode("workspace");
          }}
        />
        Compact dock mode (small always-on-top window; optional)
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

      <SourcesView embedded />
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

      {group === "profiles" && (
      <>
      <h2>Profiles</h2>
      {profiles ? (
        <>
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
                    use
                  </button>
                )}
              </li>
            ))}
          </ul>
          <div className="row">
            <label>
              <span className="visually-hidden">New profile id</span>
              <input type="text" value={newProfile} onChange={(e) => setNewProfile(e.target.value)} placeholder="new-profile-id" pattern="[A-Za-z0-9._-]{1,64}" />
            </label>
            <button type="button" disabled={!/^[A-Za-z0-9._-]{1,64}$/.test(newProfile)} onClick={() => void switchProfile(newProfile)}>
              Create and switch
            </button>
          </div>
          {note && <p role="status">{note}</p>}
        </>
      ) : (
        <p className="muted">Profiles are managed by the desktop app.</p>
      )}
      </>
      )}

      {group === "preferences" && (
      <>
      <h2>Optional preferences</h2>
      <p className="muted">Profile, program and study-style answers personalise planning copy. Nothing here is required to practice.</p>
      {prefsOpen ? (
        <div className="prefs-embed">
          <Onboarding onDone={() => setPrefsOpen(false)} />
          <button type="button" onClick={() => setPrefsOpen(false)}>
            Close preferences
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => setPrefsOpen(true)}>
          Open preferences
        </button>
      )}
      </>
      )}

      {group === "usage" && (
      <>
      <h2>Usage counts (optional)</h2>
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

      {group === "privacy" && (
      <>
      <h2>Privacy</h2>
      <p>
        Your study history is stored locally. When you ask for AI help, selected material and your answer pass through our service to the model provider. Our service is designed not to retain that content; provider retention policies still apply. Optional usage counts are off until you enable them.
      </p>
      </>
      )}

      {group === "diagnostics" && (
      <>
      <h2>Diagnostics</h2>
      {runtime ? (
        <dl className="diag">
          <dt>Runtime</dt>
          <dd>{runtime.mode === "bundled" ? "bundled (installed app)" : runtime.mode === "broken" ? "incomplete install — the bundled runtime is missing" : "developer checkout"}</dd>
          <dt>Profile</dt>
          <dd>
            {runtime.profile_id} · <code>{runtime.user_root}</code>
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
