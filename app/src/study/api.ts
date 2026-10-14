/**
 * Study IPC. In Tauri, `invoke("study", {request})`. Outside Tauri (Vite dev
 * server only) the same request goes to the loopback dev bridge started with
 * `python -m canvas_mcp.core.study serve` (DECISIONS D-07).
 */
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../ipc";
import type { AskEnvelope, AskRank, Assessed, Envelope, Offer, PacketSummary, Revealed, RuntimeInfo, Started, Status, Template } from "./types";

const BRIDGE = "http://127.0.0.1:1421/study";

export class StudyRequestError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/** Test seams: replace the transport without touching Tauri. */
export const transport = {
  async send(cmd: string, params: Record<string, unknown>): Promise<Envelope<Record<string, unknown>>> {
    const request = { cmd, params };
    if (isTauri()) {
      return invoke<Envelope<Record<string, unknown>>>("study", { request });
    }
    // Dev bridge token: set VITE_STUDY_BRIDGE_TOKEN or paste it once into
    // localStorage("pn_bridge_token") (printed by `study serve`).
    const token = (import.meta.env.VITE_STUDY_BRIDGE_TOKEN as string | undefined) ?? localStorage.getItem("pn_bridge_token") ?? "";
    const res = await fetch(BRIDGE, {
      method: "POST",
      headers: { "content-type": "application/json", "x-study-token": token },
      body: JSON.stringify(request),
    });
    return (await res.json()) as Envelope<Record<string, unknown>>;
  },
};

async function call<T>(cmd: string, params: Record<string, unknown> = {}): Promise<T> {
  let envelope: Envelope<Record<string, unknown>>;
  try {
    envelope = await transport.send(cmd, params);
  } catch (e) {
    throw new StudyRequestError("unreachable", e instanceof Error ? e.message : String(e));
  }
  if (!envelope.ok) {
    throw new StudyRequestError(envelope.error.code, envelope.error.message);
  }
  return envelope as unknown as T;
}

/** Student-entered planning facts for Advisor (study/audit_copy.py). Never a portal login. */
export const advisorWrites = {
  auditImport: (p: { taken_on?: string; catalog_year?: string; complete?: string; in_progress?: string; still_needed?: string; remaining_credits?: string }) =>
    call<{ saved: string; imported_on: string; counts: { complete: number; in_progress: number; still_needed: number } }>("audit-import", p),
  profileFields: (p: { program?: string; catalog_year?: string; target_term?: string }) => call<{ saved: Record<string, string> }>("profile-fields", p),
};

export const study = {
  status: () => call<Status>("status"),
  packets: () => call<{ packets: PacketSummary[] }>("packets"),
  templates: () => call<{ templates: Template[] }>("templates"),
  importTemplate: (packetId: string) => call<{ packet_id: string; items: number }>("import-template", { packet_id: packetId }),
  importPacket: (packet: unknown) => call<{ packet_id: string; items: number }>("import", { packet }),
  withdraw: (packetId: string, reason: string) => call<{ packet_id: string }>("withdraw", { packet_id: packetId, reason }),
  setExam: (exam: Record<string, unknown>) => call<{ exam: unknown }>("exam", { exam }),
  offer: (opts: { course?: string | null; minutes?: number; mode?: string | null; cram?: boolean; itemId?: string | null; newSession?: boolean } = {}) =>
    call<Offer>("offer", {
      course: opts.course ?? null,
      minutes: opts.minutes ?? 5,
      mode: opts.mode ?? null,
      cram: Boolean(opts.cram),
      item_id: opts.itemId ?? null,
      new_session: Boolean(opts.newSession),
    }),
  start: (itemId: string, mode: string, minutes: number) => call<Started>("start", { item_id: itemId, mode, minutes }),
  draft: (attemptId: string, text: string, expectedRevision?: number | null) =>
    call<{ revision: number; saved_at: string | null }>("draft", { attempt_id: attemptId, text, expected_revision: expectedRevision ?? null }),
  submit: (attemptId: string, text: string, fields: Record<string, string>, selfOutcome?: string | null) =>
    call<Assessed>("submit", { attempt_id: attemptId, text, fields, self_outcome: selfOutcome ?? null }),
  hint: (attemptId: string) => call<{ hint: string }>("hint", { attempt_id: attemptId }),
  reveal: (attemptId: string) => call<Revealed>("reveal", { attempt_id: attemptId }),
  skip: (attemptId: string) => call<{ state: unknown }>("skip", { attempt_id: attemptId }),
  reportHelp: (attemptId: string, note: string) => call<{ attempt: unknown }>("report-help", { attempt_id: attemptId, note }),
  disagree: (attemptId: string, note: string) => call<{ attempt: unknown }>("disagree", { attempt_id: attemptId, note }),
  plan: (itemId: string, at: string) => call<{ state: unknown }>("plan", { item_id: itemId, at }),
  source: (packetId: string, sourceId: string, attemptId?: string | null) =>
    call<{ source: { id: string; locator: string; text: string } }>("source", { packet_id: packetId, source_id: sourceId, attempt_id: attemptId ?? null }),
  history: (itemId: string) => call<{ attempts: unknown[] }>("history", { item_id: itemId }),
  session: (fresh: boolean) => call<{ session: unknown }>("session", { new: fresh }),
  askCreate: (params: Record<string, unknown>) => call<AskEnvelope>("ask-create", params),
  askGet: (inputId: string) => call<AskEnvelope>("ask-get", { input_id: inputId }),
  askCurrent: () => call<AskEnvelope>("ask-current"),
  askCorrect: (inputId: string, params: Record<string, unknown>) => call<AskEnvelope>("ask-correct", { input_id: inputId, ...params }),
  askMode: (inputId: string, sessionGoal: string) => call<AskEnvelope>("ask-mode", { input_id: inputId, session_goal: sessionGoal }),
  askRank: (openWork: Record<string, unknown>[], preferAsk = false) =>
    call<AskRank>("ask-rank", { open_work: openWork, prefer_ask: preferAsk }),
  askPending: () => call<AskEnvelope>("ask-pending"),
};

export type CanvasSources = {
  status: { state: "never" | "ok" | "stale" | "partial" | "failed" | "session_expired" | "unreadable"; line: string; last_sync: string | null; courses: unknown[]; errors?: string[] };
  courses: {
    course_id: string;
    label: string;
    fetched_at: string | null;
    sources: { id: string; kind: string; title: string; chars: number; truncated: boolean; updated_at: string | null }[];
    exams: { id: string; label: string; due_at: string | null; starts_at?: string | null; ends_at?: string | null; kind: string; inferred: boolean; source?: string; confidence?: string }[];
    errors: string[];
    imported_version: number | null;
    imported_source_ids: string[];
  }[];
};

export const canvasStudy = {
  sources: () => call<CanvasSources>("canvas-sources"),
  importCourse: (courseId: string, sourceIds: string[] | null) => call<{ packet_id: string; version: number; sources: number; items: number; kept_items: number }>("canvas-import", { course_id: courseId, source_ids: sourceIds }),
  createItem: (packetId: string, spec: Record<string, unknown>) => call<{ packet_id: string; version: number; item_id: string }>("create-item", { packet_id: packetId, spec }),
};

export type AiStatus = { connected: boolean; reachable?: boolean; error?: string; revoked?: boolean; allowance_cents?: number; settled?: number; outstanding?: number; by_status?: Record<string, number> };
export type AiFeedback = {
  status: "complete" | "abstained" | "pending_unknown" | "billing_unknown" | "result_unavailable" | "refused" | "truncated" | "malformed" | "failed";
  request_id: string;
  proposal: { outcome: string; feedback: string; support_rows: { locator: string; quote: string; status: string }[] } | null;
  support_rows: { locator: string; quote: string; status: string }[];
  model_id: string | null;
  copy: string;
};

export const aiStudy = {
  status: () => call<AiStatus>("ai-status"),
  connect: (url: string, inviteCode: string) => call<{ tester_id: string; url: string }>("ai-connect", { url, invite_code: inviteCode }),
  disconnect: () => call<{ connected: boolean }>("ai-disconnect"),
  feedback: (attemptId: string, regenerate = false) => call<AiFeedback>("ai-feedback", { attempt_id: attemptId, regenerate }),
};

export type ConnectorState = { state: string; detail?: string; account?: string | null; account_type?: string; last_read?: string | null; items?: number };
export type Connectors = { gcal: ConnectorState; outlook: ConnectorState };

export const connectors = {
  status: () => call<{ connectors: Connectors }>("connectors-status"),
  outlookBegin: () => call<{ user_code: string; verification_uri: string; message: string; expires_in: number }>("outlook-begin"),
  outlookPoll: () => call<{ pending?: boolean; interval?: number; state?: string; items?: unknown[]; account?: string }>("outlook-poll"),
  outlookRead: () => call<{ items: { id: string; subject: string; from: string; received: string | null; is_read: boolean; web_link: string | null }[] }>("outlook-read"),
  outlookDisconnect: () => call<{ connector: ConnectorState }>("outlook-disconnect"),
  gcalConnect: () => call<{ connector: ConnectorState }>("gcal-connect"),
  gcalRead: () => call<{ items: { id: string; summary: string; start: string | null; end: string | null }[] }>("gcal-read"),
  gcalDisconnect: () => call<{ connector: ConnectorState }>("gcal-disconnect"),
  gcalPreview: (summary: string, start: string, end: string, why: string) =>
    call<{ preview: { summary: string; start: string; end: string; why: string }; confirmation_token: string; executable: boolean; note: string }>("gcal-preview-event", { summary, start, end, why }),
  gcalConfirm: (summary: string, start: string, end: string, why: string, token: string) =>
    call<{ created: { id: string; summary: string }; mode: string }>("gcal-confirm-event", { summary, start, end, why, confirmation_token: token }),
  context: (terms: string[], days = 7) => call<{ events: { id: string; summary: string; start: string | null }[]; emails: { id: string; subject: string; from: string; received: string | null; web_link: string | null }[] }>("context", { terms, days }),
};

export type LibraryEntry = {
  id: string;
  name: string;
  ext: string;
  kind: "pdf" | "image" | "document" | "slides" | "spreadsheet" | "text" | "other";
  bytes: number;
  added_at: string;
  course_id: string | null;
  course_label: string | null;
  course_source: "matched" | "student" | "none";
  category: string;
  category_source: "matched" | "student";
  text_status: "full" | "partial" | "none";
  chars: number;
  summary: string;
};
export type Library = { entries: LibraryEntry[]; courses: { id: string; label: string }[]; categories: string[]; total_bytes: number };
export type LibraryIngest = { added: LibraryEntry[]; duplicates: LibraryEntry[]; errors: { name: string; message: string }[]; library: Library };

/** Matches MAX_FILE_BYTES in study/library.py and MAX_UPLOAD_BYTES in library.rs. */
export const LIBRARY_MAX_BYTES = 50 * 1024 * 1024;

async function readBytes(file: Blob): Promise<Uint8Array> {
  if (typeof file.arrayBuffer === "function") return await readBytes(file);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error("could not read the file"));
    reader.readAsArrayBuffer(file);
  });
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export const library = {
  list: () => call<{ library: Library }>("library-list"),
  update: (id: string, change: { course_id?: string | null; category?: string }) => call<{ entry: LibraryEntry }>("library-update", { id, ...change }),
  remove: (id: string) => call<{ removed: string }>("library-remove", { id }),
  /**
   * Desktop: each file's bytes go to `library_stage_file` (raw IPC body, not the
   * 256 KB JSON bridge), then one `library-ingest` sorts and indexes the batch.
   * Dev bridge: small files go inline as base64.
   */
  async add(files: File[]): Promise<LibraryIngest> {
    const errors: LibraryIngest["errors"] = [];
    if (isTauri()) {
      for (const file of files) {
        if (file.size > LIBRARY_MAX_BYTES) {
          errors.push({ name: file.name, message: "is larger than 50 MB" });
          continue;
        }
        try {
          const bytes = await readBytes(file);
          await invoke("library_stage_file", bytes, { headers: { "x-file-name": encodeURIComponent(file.name) } });
        } catch (e) {
          errors.push({ name: file.name, message: e instanceof Error ? e.message : String(e) });
        }
      }
      const result = await call<LibraryIngest>("library-ingest");
      return { ...result, errors: [...errors, ...result.errors] };
    }
    const added: LibraryEntry[] = [];
    const duplicates: LibraryEntry[] = [];
    let latest: Library | null = null;
    for (const file of files) {
      try {
        const data_base64 = toBase64(await readBytes(file));
        const res = await call<{ status: "added" | "duplicate"; entry: LibraryEntry; library: Library }>("library-add", { name: file.name, data_base64 });
        (res.status === "added" ? added : duplicates).push(res.entry);
        latest = res.library;
      } catch (e) {
        errors.push({ name: file.name, message: e instanceof Error ? e.message : String(e) });
      }
    }
    return { added, duplicates, errors, library: latest ?? (await call<{ library: Library }>("library-list")).library };
  },
};

export async function syncStudySources(): Promise<{ ok: boolean; error?: string | null }> {
  if (!isTauri()) return { ok: false, error: "Canvas sync needs the desktop app" };
  return invoke("sync_study_sources");
}

export async function runtimeInfo(): Promise<RuntimeInfo | null> {
  if (!isTauri()) return null;
  return invoke<RuntimeInfo>("runtime_info");
}

export async function listProfiles(): Promise<{ current: string; profiles: string[]; root: string } | null> {
  if (!isTauri()) return null;
  return invoke("list_profiles");
}

export async function setProfile(profileId: string): Promise<{ ok: boolean; restart_required: boolean } | null> {
  if (!isTauri()) return null;
  return invoke("set_profile", { profileId });
}
