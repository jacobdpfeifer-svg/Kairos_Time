import { useCallback, useEffect, useRef, useState } from "react";
import { StudyRequestError, connectors, type Connectors } from "../study/api";
import { fmtWhen } from "../study/format";
import { openExternalUrl } from "../ipc";

const STATE_LABEL: Record<string, string> = {
  disconnected: "Not connected",
  not_configured: "Not available in this build",
  pending_auth: "Waiting for sign-in",
  pending_verify: "Verifying",
  connected: "Connected",
  expired: "Sign-in expired",
  consent_required: "Needs your organization's consent",
};

/** Settings section: Google Calendar and Outlook email connect/disconnect with honest states. */
export function ConnectorsPanel() {
  const [state, setState] = useState<Connectors | null>(null);
  const [device, setDevice] = useState<{ user_code: string; verification_uri: string } | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pollTimer = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      setState((await connectors.status()).connectors);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
    return () => {
      if (pollTimer.current) window.clearTimeout(pollTimer.current);
    };
  }, [refresh]);

  const run = async (fn: () => Promise<unknown>, okNote = "") => {
    setBusy(true);
    setError("");
    setNote("");
    try {
      await fn();
      if (okNote) setNote(okNote);
    } catch (e) {
      setError(e instanceof StudyRequestError ? e.message : String(e));
    } finally {
      setBusy(false);
      await refresh();
    }
  };

  const pollOutlook = async () => {
    try {
      const res = await connectors.outlookPoll();
      if (res.pending) {
        pollTimer.current = window.setTimeout(() => void pollOutlook(), (res.interval ?? 5) * 1000);
        return;
      }
      setDevice(null);
      setNote(`Outlook connected as ${res.account ?? "your account"}; ${res.items?.length ?? 0} recent messages read.`);
    } catch (e) {
      setDevice(null);
      setError(e instanceof StudyRequestError ? e.message : String(e));
    }
    await refresh();
  };

  const beginOutlook = () =>
    run(async () => {
      const res = await connectors.outlookBegin();
      setDevice({ user_code: res.user_code, verification_uri: res.verification_uri });
      pollTimer.current = window.setTimeout(() => void pollOutlook(), 5000);
    });

  if (!state) return <p className="muted">Loading connector status…</p>;
  const g = state.gcal;
  const o = state.outlook;
  return (
    <div className="connectors">
      <div className="connector">
        <div className="connector-row">
          <div>
            <h3>Google Calendar</h3>
            <p>
              <strong>{STATE_LABEL[g.state] ?? g.state}</strong>
              {g.account ? ` · ${g.account}` : ""}
              {g.last_read ? ` · last read ${fmtWhen(g.last_read)} (${g.items} events)` : ""}
            </p>
          </div>
          <span className={`switch ${g.state === "connected" ? "is-on" : ""}`} role="status" aria-label={g.state === "connected" ? "Connected" : "Not connected"} />
        </div>
        {g.detail && <p className="muted">{g.detail}</p>}
        <div className="row">
          {g.state !== "connected" && g.state !== "not_configured" && (
            <button type="button" disabled={busy} onClick={() => void run(() => connectors.gcalConnect(), "Google Calendar connected.")}>
              Connect
            </button>
          )}
          {g.state === "connected" && (
            <>
              <button type="button" disabled={busy} onClick={() => void run(() => connectors.gcalRead(), "Calendar read.")}>
                Read now
              </button>
              <button type="button" className="ghost" disabled={busy} onClick={() => void run(() => connectors.gcalDisconnect(), "Google Calendar disconnected.")}>
                Disconnect
              </button>
            </>
          )}
        </div>
        <p className="muted">Reads upcoming events (title and time). Creating an event always shows a preview you confirm first.</p>
      </div>

      <div className="connector">
        <div className="connector-row">
          <div>
            <h3>Outlook email</h3>
            <p>
              <strong>{STATE_LABEL[o.state] ?? o.state}</strong>
              {o.account ? ` · ${o.account} (${o.account_type === "organization" ? "school account" : "personal account"})` : ""}
              {o.last_read ? ` · last read ${fmtWhen(o.last_read)} (${o.items} messages)` : ""}
            </p>
          </div>
          <span className={`switch ${o.state === "connected" ? "is-on" : ""}`} role="status" aria-label={o.state === "connected" ? "Connected" : "Not connected"} />
        </div>
        {o.detail && <p className="muted">{o.detail}</p>}
        {device && (
          <p className="notice" role="status">
            Open{" "}
            <button type="button" className="link" onClick={() => void openExternalUrl(device.verification_uri).catch(() => undefined)}>
              {device.verification_uri}
            </button>{" "}
            and enter the code <code>{device.user_code}</code>. Waiting for sign-in…
          </p>
        )}
        <div className="row">
          {o.state !== "connected" && o.state !== "not_configured" && !device && (
            <button type="button" disabled={busy} onClick={() => void beginOutlook()}>
              Connect
            </button>
          )}
          {o.state === "connected" && (
            <>
              <button type="button" disabled={busy} onClick={() => void run(() => connectors.outlookRead(), "Mail read.")}>
                Read now
              </button>
              <button type="button" className="ghost" disabled={busy} onClick={() => void run(() => connectors.outlookDisconnect(), "Outlook disconnected on this device.")}>
                Disconnect
              </button>
            </>
          )}
        </div>
        <p className="muted">Reads subjects, senders and dates of recent mail (read-only). School accounts may need your organization's consent; the result is reported, not assumed.</p>
      </div>
      {note && <p role="status">{note}</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
