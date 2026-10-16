/**
 * Accumulates a voice session into inbox/voice/sessions/{id}.md (gitignored —
 * raw speech is personal; only distilled notes get committed).
 *
 * Live transcription arrives as fragments per speaker, unordered relative to the
 * model turn, so each speaker gets a buffer and buffers flush in speaking order.
 */
import fs from "node:fs";
import path from "node:path";
import { formatDenver } from "./config.mjs";

const LABEL = { user: "Student", model: "Interviewer" };

export class TranscriptRecorder {
  /**
   * @param {{ id: string, mode: string, course?: string, model?: string, startedAt?: Date }} meta
   */
  constructor({ id, mode, course = "", model = "", startedAt = new Date() }) {
    this.id = id;
    this.mode = mode;
    this.course = course;
    this.model = model;
    this.startedAt = startedAt;
    /** @type {Array<{ kind: "turn", role: "user"|"model", text: string } | { kind: "event", text: string }>} */
    this.entries = [];
    this.buffers = { user: "", model: "" };
    this.captures = 0;
  }

  /** @param {"user"|"model"} role @param {string} text */
  addText(role, text) {
    if (text) this.buffers[role] += text;
  }

  flush(role) {
    const text = this.buffers[role].replace(/\s+/g, " ").trim();
    this.buffers[role] = "";
    if (text) this.entries.push({ kind: "turn", role, text });
  }

  /** End of an exchange: the student spoke first, then the interviewer answered. */
  flushAll() {
    this.flush("user");
    this.flush("model");
  }

  /** Non-speech line (tool call, interruption). The student's pending words land first. */
  addEvent(text, { capture = false } = {}) {
    this.flush("user");
    this.entries.push({ kind: "event", text });
    if (capture) this.captures += 1;
  }

  /** @param {{ endedAt?: Date, status?: string }} [opts] */
  toMarkdown({ endedAt, status = "raw" } = {}) {
    this.flushAll();
    const body = this.entries
      .map((e) => (e.kind === "turn" ? `**${LABEL[e.role]}:** ${e.text}` : `_${e.text}_`))
      .join("\n\n");
    return `---
id: ${this.id}
mode: ${this.mode}
course: ${this.course}
started: ${formatDenver(this.startedAt)}
ended: ${endedAt ? formatDenver(endedAt) : ""}
captures: ${this.captures}
status: ${status}
model: ${this.model}
---

# Voice session ${this.id}

Raw speech-to-text. Transcription errors are likely (names, course codes, numbers). Gitignored — distill with \`student-voice-intake\`, then set \`status: distilled\`.

${body || "_(no speech captured)_"}
`;
  }

  /** @param {string} dir @param {{ endedAt?: Date, status?: string }} [opts] @returns {string} path written */
  save(dir, opts) {
    // Raw speech is personal: owner-only directory and file.
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, `${this.id}.md`);
    const tmp = `${file}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, this.toMarkdown(opts), { mode: 0o600 });
    fs.renameSync(tmp, file);
    return file;
  }
}
