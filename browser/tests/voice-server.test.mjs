import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { readVoiceConfig, voicePaths } from "../scripts/lib/voice/config.mjs";
import { createVoiceServer, isAllowedHost, isAllowedOrigin } from "../scripts/lib/voice/server.mjs";
import { createFakeLive, settle, waitFor } from "./helpers/fake-live.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATIC_DIR = path.join(__dirname, "..", "voice");

let dir;
let paths;
let fake;
let app;
let port;

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "voice-server-"));
  paths = voicePaths(path.join(dir, "inbox"));
  fs.mkdirSync(paths.coursesDir, { recursive: true });
  fs.writeFileSync(path.join(paths.coursesDir, "CSCI1200.md"), "# CSCI1200\n\n## Class notes\n\n- **2026-09-09** — lists\n");
  fs.writeFileSync(paths.userPath, "# USER.md\n\n## Career priorities (ranked)\n\n1. Tech entrepreneurship / startup\n");
  fake = createFakeLive();
  app = createVoiceServer({
    config: { ...readVoiceConfig({ GEMINI_API_KEY: "test" }), port: 0, model: "fake-model" },
    paths,
    connectLive: fake.connectLive,
    staticDir: STATIC_DIR,
    log: { log() {}, warn() {} },
  });
  ({ port } = await app.listen());
});

after(async () => {
  await app.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

function get(urlPath, headers = {}) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port, path: urlPath, headers: { Host: `localhost:${port}`, ...headers } }, (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
      })
      .on("error", reject);
  });
}

function connect({ port: p = port, origin = `http://localhost:${p}` } = {}) {
  const ws = new WebSocket(`ws://127.0.0.1:${p}/ws`, { headers: { Origin: origin, Host: `localhost:${p}` } });
  const inbox = [];
  ws.on("message", (data, isBinary) => inbox.push(isBinary ? { binary: Buffer.from(data) } : JSON.parse(data.toString())));
  const opened = new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
    ws.once("unexpected-response", (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
  });
  return { ws, inbox, opened };
}

describe("host / origin allowlist", () => {
  it("accepts only loopback names on the bound port", () => {
    assert.equal(isAllowedHost("localhost:8787", 8787), true);
    assert.equal(isAllowedHost("127.0.0.1:8787", 8787), true);
    assert.equal(isAllowedHost("evil.example:8787", 8787), false);
    assert.equal(isAllowedHost("localhost:9999", 8787), false);
    assert.equal(isAllowedOrigin("http://localhost:8787", 8787), true);
    assert.equal(isAllowedOrigin("http://tauri.localhost", 8787), true);
    assert.equal(isAllowedOrigin("tauri://localhost", 8787), true);
    assert.equal(isAllowedOrigin("http://localhost:1420", 8787), true);
    assert.equal(isAllowedOrigin("https://evil.example", 8787), false);
    assert.equal(isAllowedOrigin("http://tauri.localhost.evil.example", 8787), false);
    assert.equal(isAllowedOrigin(undefined, 8787), false);
  });
});

describe("HTTP", () => {
  it("serves the page and static assets with hardening headers", async () => {
    const page = await get("/");
    assert.equal(page.status, 200);
    assert.match(page.body, /Voice intake/);
    assert.match(page.headers["content-security-policy"], /script-src 'self'/);
    assert.equal(page.headers["x-content-type-options"], "nosniff");
    assert.equal((await get("/app.js")).status, 200);
    assert.equal((await get("/pcm-worklet.js")).status, 200);
  });

  it("does not serve arbitrary files", async () => {
    assert.equal((await get("/../../package.json")).status, 404);
    assert.equal((await get("/nope")).status, 404);
  });

  it("exposes course codes and model to the page", async () => {
    const res = await get("/api/context");
    assert.deepEqual(JSON.parse(res.body), { model: "fake-model", modes: ["goals", "checkin", "class", "onboarding"], courses: ["CSCI1200"], hasGoals: false });
  });

  it("rejects a foreign Host header (DNS rebinding)", async () => {
    assert.equal((await get("/api/context", { Host: "evil.example" })).status, 403);
  });
});

/** Separate server around its own fake Live, for connect-time failure modes. */
async function withApp(fakeOpts, fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "voice-server2-"));
  const p2 = voicePaths(path.join(tmp, "inbox"));
  fs.mkdirSync(p2.coursesDir, { recursive: true });
  const f2 = createFakeLive(fakeOpts);
  const a2 = createVoiceServer({
    config: { ...readVoiceConfig({ GEMINI_API_KEY: "test" }), port: 0, model: "fake-model" },
    paths: p2,
    connectLive: f2.connectLive,
    staticDir: STATIC_DIR,
    log: { log() {}, warn() {} },
  });
  const { port: port2 } = await a2.listen();
  try {
    await fn({ port: port2, fake: f2 });
  } finally {
    await a2.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

describe("WebSocket: connect-time failures", () => {
  it("reports a rejected API key promptly instead of hanging", async () => {
    await withApp({ hangAndClose: { code: 1007, reason: "API key not valid. Please pass a valid API key." } }, async ({ port: p }) => {
      const c = connect({ port: p });
      await c.opened;
      c.ws.send(JSON.stringify({ type: "start", mode: "goals" }));
      await waitFor(() => c.inbox.some((m) => m.type === "closed"));
      assert.match(c.inbox.find((m) => m.type === "error").message, /GEMINI_API_KEY/);
      c.ws.close();
      await new Promise((r) => c.ws.once("close", r));
    });
  });

  it("stop while the connection is still opening closes it once it lands", async () => {
    await withApp({ delayMs: 150 }, async ({ port: p, fake: f }) => {
      const c = connect({ port: p });
      await c.opened;
      c.ws.send(JSON.stringify({ type: "start", mode: "goals" }));
      c.ws.send(JSON.stringify({ type: "stop" }));
      await waitFor(() => c.inbox.some((m) => m.type === "closed"));
      await waitFor(() => f.connections.length === 1 && f.connections[0].closed);
      c.ws.close();
      await new Promise((r) => c.ws.once("close", r));
    });
  });

  it("closing the tab while connecting does not leak the connection either", async () => {
    await withApp({ delayMs: 150 }, async ({ port: p, fake: f }) => {
      const c = connect({ port: p });
      await c.opened;
      c.ws.send(JSON.stringify({ type: "start", mode: "goals" }));
      c.ws.close();
      await waitFor(() => f.connections.length === 1 && f.connections[0].closed);
    });
  });
});

describe("WebSocket", () => {
  it("rejects a foreign Origin (cross-site WebSocket)", async () => {
    const c = connect({ origin: "https://evil.example" });
    await assert.rejects(c.opened);
  });

  it("runs a full session: speak, capture a goal and a class note, hear audio, save transcript", async () => {
    const c = connect();
    await c.opened;
    c.ws.send(JSON.stringify({ type: "start", mode: "class", course: "CSCI1200" }));
    await waitFor(() => c.inbox.some((m) => m.type === "ready"));

    // What the model was configured with
    const conn = fake.connections.at(-1);
    assert.match(conn.config.systemInstruction, /Course reflection for CSCI1200/);
    assert.match(conn.config.systemInstruction, /Tech entrepreneurship/);
    assert.deepEqual(conn.config.tools[0].functionDeclarations.map((f) => f.name), ["save_goal", "append_class_note"]);
    assert.equal(conn.config.realtimeInputConfig.automaticActivityDetection.silenceDurationMs, 1500);
    assert.deepEqual(conn.config.inputAudioTranscription, {});
    assert.match(conn.sent[0].text, /CSCI1200 reflection/);

    // mic → model
    c.ws.send(Buffer.from([0, 1, 2, 3]));
    await waitFor(() => conn.sent.some((m) => m.audio));

    // model audio → client
    conn.emit({
      serverContent: {
        inputTranscription: { text: "loops finally clicked" },
        modelTurn: { parts: [{ inlineData: { data: Buffer.from([5, 6, 7, 8]).toString("base64") } }] },
      },
    });
    await waitFor(() => c.inbox.some((m) => m.binary));
    assert.deepEqual(c.inbox.find((m) => m.binary).binary, Buffer.from([5, 6, 7, 8]));

    // tool calls write to the (temp) inbox
    conn.emit({
      toolCall: {
        functionCalls: [
          { id: "1", name: "save_goal", args: { category: "career", statement: "I want to found a company" } },
          { id: "2", name: "append_class_note", args: { course_code: "CSCI1200", note: "for loops click now" } },
        ],
      },
    });
    await waitFor(() => c.inbox.filter((m) => m.type === "tool").length === 2);
    assert.match(fs.readFileSync(paths.goalsPath, "utf8"), /\[career\] I want to found a company/);
    assert.match(fs.readFileSync(path.join(paths.coursesDir, "CSCI1200.md"), "utf8"), /for loops click now/);
    assert.equal(conn.toolResponses[0].functionResponses.length, 2);

    // stop → closed with a transcript on disk
    c.ws.send(JSON.stringify({ type: "stop" }));
    await waitFor(() => c.inbox.some((m) => m.type === "closed"));
    const closed = c.inbox.find((m) => m.type === "closed");
    assert.equal(closed.captures, 2);
    assert.equal(closed.file.startsWith(paths.sessionsDir), true);
    assert.match(fs.readFileSync(closed.file, "utf8"), /\*\*Student:\*\* loops finally clicked/);
    assert.equal(conn.closed, true);
    c.ws.close();
    await new Promise((r) => c.ws.once("close", r));
  });

  it("allows only one session at a time", async () => {
    const first = connect();
    await first.opened;
    const second = connect();
    await second.opened;
    await waitFor(() => second.inbox.some((m) => m.type === "error"));
    assert.match(second.inbox.find((m) => m.type === "error").message, /already running/);
    first.ws.close();
    await new Promise((r) => first.ws.once("close", r));
    await settle();
  });

  it("stops the session and saves when the browser disconnects", async () => {
    const c = connect();
    await c.opened;
    c.ws.send(JSON.stringify({ type: "start", mode: "goals" }));
    await waitFor(() => c.inbox.some((m) => m.type === "ready"));
    const conn = fake.connections.at(-1);
    conn.emit({ serverContent: { inputTranscription: { text: "one more thought" } } });
    c.ws.close();
    await waitFor(() => conn.closed);
    const files = fs.readdirSync(paths.sessionsDir);
    assert.ok(files.some((f) => /one more thought/.test(fs.readFileSync(path.join(paths.sessionsDir, f), "utf8"))));
  });
});
