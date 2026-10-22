/**
 * Local-only web server for the voice page: static files + one WebSocket that
 * bridges the mic to a VoiceSession. The Gemini key stays here, never in the page.
 *
 * Bound to loopback, and Host/Origin are checked so a random website in the student's
 * browser can't open the mic bridge (DNS rebinding / cross-site WebSocket).
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { WebSocketServer } from "ws";
import { denverDay, makeSessionId } from "./config.mjs";
import { buildLiveConfig } from "./live.mjs";
import { buildSystemInstruction, kickoffText, MODES } from "./prompt.mjs";
import { VoiceSession, describeError } from "./session.mjs";
import { buildToolDeclarations, createToolHandlers, listCourseCodes } from "./tools.mjs";
import { TranscriptRecorder } from "./transcript.mjs";

const STATIC = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/pcm-worklet.js": ["pcm-worklet.js", "text/javascript; charset=utf-8"],
};

/** @param {string | undefined} host @param {number} port */
export function isAllowedHost(host, port) {
  return host === `localhost:${port}` || host === `127.0.0.1:${port}`;
}

/** App webviews that may open the loopback bridge. Not a wildcard. */
const APP_ORIGINS = new Set([
  "http://tauri.localhost",
  "https://tauri.localhost",
  "tauri://localhost",
  "http://localhost:1420",
  "http://127.0.0.1:1420",
]);

/** @param {string | undefined} origin @param {number} port */
export function isAllowedOrigin(origin, port) {
  if (!origin) return false;
  if (origin === `http://localhost:${port}` || origin === `http://127.0.0.1:${port}`) return true;
  return APP_ORIGINS.has(origin.replace(/\/$/, ""));
}

function readOr(file, fallback = "") {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return fallback;
  }
}

/**
 * @param {{
 *   config: ReturnType<import("./config.mjs").readVoiceConfig>,
 *   paths: ReturnType<import("./config.mjs").voicePaths>,
 *   connectLive: (p: { config: object, callbacks: object }) => Promise<any>,
 *   staticDir: string,
 *   log?: Pick<Console, "log" | "warn">,
 * }} opts
 */
export function createVoiceServer({ config, paths, connectLive, staticDir, log = console }) {
  let port = config.port;
  let busy = false;
  /** @type {VoiceSession | null} */
  let current = null;

  const server = http.createServer((req, res) => {
    if (!isAllowedHost(req.headers.host, port)) {
      res.writeHead(403).end("forbidden host");
      return;
    }
    const url = new URL(req.url || "/", `http://localhost:${port}`);
    const headers = {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Permissions-Policy": "microphone=(self)",
      "Content-Security-Policy": `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://localhost:${port} ws://127.0.0.1:${port}; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    };

    if (req.method === "GET" && url.pathname === "/api/context") {
      res.writeHead(200, { ...headers, "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          model: config.model,
          modes: MODES,
          courses: listCourseCodes(paths.coursesDir),
          hasGoals: fs.existsSync(paths.goalsPath),
        }),
      );
      return;
    }

    const entry = req.method === "GET" ? STATIC[url.pathname] : undefined;
    if (!entry) {
      res.writeHead(404, headers).end("not found");
      return;
    }
    try {
      const body = fs.readFileSync(path.join(staticDir, entry[0]));
      res.writeHead(200, { ...headers, "Content-Type": entry[1] }).end(body);
    } catch {
      res.writeHead(500, headers).end("static file missing");
    }
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 1 << 20 });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url || "/", `http://localhost:${port}`);
    if (
      url.pathname !== "/ws" ||
      !isAllowedHost(req.headers.host, port) ||
      !isAllowedOrigin(req.headers.origin, port)
    ) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws));
  });

  wss.on("connection", (ws) => {
    const sendJson = (msg) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
    };
    if (busy) {
      sendJson({ type: "error", message: "Another voice session is already running." });
      ws.close();
      return;
    }
    busy = true;
    /** @type {VoiceSession | null} */
    let session = null;

    ws.on("message", async (data, isBinary) => {
      if (isBinary) {
        session?.sendAudio(Buffer.from(/** @type {Buffer} */ (data)));
        return;
      }
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (msg.type === "text") session?.sendText(msg.text);
      else if (msg.type === "stop") await session?.stop("stopped by user");
      else if (msg.type === "start" && !session) {
        // Registered before connecting: "stop" or a closed tab must reach a session that is still opening.
        const started = buildSession(msg, sendJson, ws);
        session = started;
        current = started;
        try {
          await started.start();
        } catch (err) {
          sendJson({ type: "error", message: describeError(err) });
          await started.stop("start failed");
        }
      }
    });

    ws.on("close", async () => {
      await session?.stop("client disconnected");
      if (current === session) current = null;
      busy = false;
    });
  });

  function buildSession(msg, sendJson, ws) {
    const mode = MODES.includes(msg.mode) ? msg.mode : "goals";
    const courseCodes = listCourseCodes(paths.coursesDir);
    const course = mode === "class" && courseCodes.includes(msg.course) ? msg.course : "";
    const id = makeSessionId();
    const onboarding = mode === "onboarding";
    const tools = createToolHandlers({ paths, sessionId: id, courseCodes, onboarding });
    const systemInstruction = buildSystemInstruction({
      mode,
      course,
      userMd: readOr(paths.userPath),
      goalsMd: readOr(paths.goalsPath),
      weekMd: readOr(paths.weekPath),
      courseCodes,
      today: denverDay(),
    });
    const declarations = buildToolDeclarations(courseCodes, { onboarding });
    return new VoiceSession({
      connectLive,
      buildConfig: ({ handle }) =>
        buildLiveConfig({
          systemInstruction,
          tools: declarations,
          voiceName: config.voiceName,
          silenceMs: config.silenceMs,
          handle,
        }),
      tools,
      recorder: new TranscriptRecorder({ id, mode, course, model: config.model }),
      sessionsDir: paths.sessionsDir,
      kickoff: kickoffText(mode, course),
      emit: sendJson,
      emitAudio: (pcm) => {
        if (ws.readyState === ws.OPEN) ws.send(pcm, { binary: true });
      },
      log,
    });
  }

  return {
    server,
    /** @returns {Promise<{ port: number, url: string }>} */
    listen() {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(config.port, config.host, () => {
          port = /** @type {import("node:net").AddressInfo} */ (server.address()).port;
          resolve({ port, url: `http://localhost:${port}` });
        });
      });
    },
    async close() {
      await current?.stop("server shutting down");
      for (const client of wss.clients) client.close();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
