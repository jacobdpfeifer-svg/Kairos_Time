// Voice intake page. Mic → 16 kHz PCM16 frames → WebSocket → server → Gemini Live.
// Model audio comes back as 24 kHz PCM16 and is scheduled gaplessly.
const OUTPUT_RATE = 24000;

const $ = (id) => document.getElementById(id);
const els = {
  status: $("status"),
  mode: $("mode"),
  course: $("course"),
  start: $("start"),
  mute: $("mute"),
  notice: $("notice"),
  transcript: $("transcript"),
  captured: $("captured"),
  typed: $("typed"),
  typedText: $("typedText"),
  summary: $("summary"),
};

let ws = null;
let ctx = null;
let micStream = null;
let micNode = null;
let muted = false;
let live = false;
let nextPlayTime = 0;
const playing = new Set();
let lastRole = null;
let bubble = null;
let stopTimer = null;

function setStatus(text, state = "idle") {
  els.status.textContent = text;
  els.status.dataset.state = state;
}

function notice(text) {
  els.notice.textContent = text || "";
}

function addTurn(role, text) {
  if (els.transcript.querySelector(".empty")) els.transcript.textContent = "";
  if (role !== lastRole || !bubble) {
    bubble = document.createElement("div");
    bubble.className = `turn ${role}`;
    els.transcript.appendChild(bubble);
    lastRole = role;
  }
  bubble.textContent += text;
  els.transcript.scrollTop = els.transcript.scrollHeight;
}

function addCaptured({ name, args, result }) {
  if (els.captured.querySelector(".empty")) els.captured.textContent = "";
  const li = document.createElement("li");
  const kind = document.createElement("span");
  kind.className = "kind";
  const text = document.createElement("span");
  if (!result?.ok) {
    li.className = "fail";
    kind.textContent = "Not saved";
    text.textContent = result?.error || "unknown error";
  } else if (name === "save_goal") {
    kind.textContent = `Goal · ${result.category}`;
    text.textContent = result.statement;
  } else {
    kind.textContent = `Class note · ${result.course_code}`;
    text.textContent = result.note;
  }
  li.append(kind, text);
  els.captured.appendChild(li);
}

function stopPlayback() {
  for (const src of playing) {
    try {
      src.stop();
    } catch {
      /* already ended */
    }
  }
  playing.clear();
  nextPlayTime = 0;
}

function playPcm(buf) {
  if (!ctx) return;
  const i16 = new Int16Array(buf, 0, buf.byteLength >> 1);
  const f32 = new Float32Array(i16.length);
  for (let i = 0; i < i16.length; i++) f32[i] = i16[i] / 32768;
  const audio = ctx.createBuffer(1, f32.length, OUTPUT_RATE);
  audio.copyToChannel(f32, 0);
  const src = ctx.createBufferSource();
  src.buffer = audio;
  src.connect(ctx.destination);
  const at = Math.max(ctx.currentTime + 0.02, nextPlayTime);
  src.start(at);
  nextPlayTime = at + audio.duration;
  playing.add(src);
  src.onended = () => {
    playing.delete(src);
    if (live && !playing.size) setStatus("Listening", "live");
  };
  setStatus("Speaking", "live");
}

async function attachMic() {
  const source = ctx.createMediaStreamSource(micStream);
  micNode = new AudioWorkletNode(ctx, "pcm-capture");
  micNode.port.onmessage = (e) => {
    if (!muted && ws && ws.readyState === WebSocket.OPEN) ws.send(e.data);
  };
  // Worklets only run when pulled; route through a silent gain to the destination.
  const silent = ctx.createGain();
  silent.gain.value = 0;
  source.connect(micNode);
  micNode.connect(silent);
  silent.connect(ctx.destination);
}

function onServerMessage(event) {
  if (event.data instanceof ArrayBuffer) {
    playPcm(event.data);
    return;
  }
  const msg = JSON.parse(event.data);
  switch (msg.type) {
    case "ready":
      live = true;
      setStatus("Listening", "live");
      els.mute.hidden = false;
      els.typed.hidden = false;
      attachMic().catch((err) => notice(`Mic error: ${err.message}`));
      break;
    case "transcript":
      addTurn(msg.role, msg.text);
      break;
    case "interrupted":
      stopPlayback();
      lastRole = null;
      setStatus("Listening", "live");
      break;
    case "turnComplete":
      lastRole = null;
      break;
    case "tool":
      addCaptured(msg);
      break;
    case "goAway":
    case "reconnecting":
      setStatus("Reconnecting…", "live");
      break;
    case "resumed":
      setStatus("Listening", "live");
      break;
    case "error":
      notice(msg.message);
      setStatus("Error", "error");
      break;
    case "closed":
      showSummary(msg);
      ws.close();
      break;
    default:
      break;
  }
}

function showSummary({ captures, file }) {
  const n = captures || 0;
  const saved = `Saved ${n} item${n === 1 ? "" : "s"} to your inbox.`;
  els.summary.textContent = file ? `${saved} Transcript: ${file}` : saved;
}

function cleanup() {
  clearTimeout(stopTimer);
  live = false;
  stopPlayback();
  micNode?.disconnect();
  micNode = null;
  micStream?.getTracks().forEach((t) => t.stop());
  micStream = null;
  ctx?.close().catch(() => {});
  ctx = null;
  ws = null;
  muted = false;
  els.mute.textContent = "Mute mic";
  els.mute.hidden = true;
  els.typed.hidden = true;
  els.start.textContent = "Start";
  els.start.disabled = false;
  els.mode.disabled = false;
  els.course.disabled = false;
  if (els.status.dataset.state !== "error") setStatus("Idle");
}

async function start() {
  notice("");
  els.summary.textContent = "";
  els.transcript.innerHTML = '<span class="empty">Connecting…</span>';
  els.captured.innerHTML = '<li class="empty">Nothing saved yet.</li>';
  lastRole = null;
  bubble = null;
  els.start.disabled = true;
  els.mode.disabled = true;
  els.course.disabled = true;
  setStatus("Connecting…");

  try {
    ctx = new AudioContext();
    await ctx.resume();
    await ctx.audioWorklet.addModule("/pcm-worklet.js");
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch (err) {
    notice(`Could not open the microphone: ${err.message}`);
    setStatus("Error", "error");
    cleanup();
    return;
  }

  // Keep the transport aligned with the page origin so a future HTTPS host
  // cannot silently downgrade the microphone session to cleartext WebSocket.
  const wsProtocol = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${wsProtocol}://${location.host}/ws`);
  ws.binaryType = "arraybuffer";
  ws.onopen = () => {
    ws.send(JSON.stringify({ type: "start", mode: els.mode.value, course: els.course.value }));
    els.start.textContent = "End session";
    els.start.disabled = false;
  };
  ws.onmessage = onServerMessage;
  ws.onerror = () => notice("Lost connection to the local voice server.");
  ws.onclose = cleanup;
}

function stop() {
  els.start.disabled = true;
  setStatus("Saving…");
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "stop" }));
    stopTimer = setTimeout(() => ws && ws.close(), 4000);
  } else {
    cleanup();
  }
}

els.start.addEventListener("click", () => (ws ? stop() : start()));

els.mute.addEventListener("click", () => {
  muted = !muted;
  els.mute.textContent = muted ? "Unmute mic" : "Mute mic";
  setStatus(muted ? "Muted" : "Listening", "live");
});

els.mode.addEventListener("change", () => {
  els.course.hidden = els.mode.value !== "class";
});

els.typed.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = els.typedText.value.trim();
  if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: "text", text }));
  lastRole = null; // typed text is its own bubble, never appended to spoken transcript
  addTurn("user", text);
  lastRole = null;
  els.typedText.value = "";
});

fetch("/api/context")
  .then((r) => r.json())
  .then((ctxInfo) => {
    for (const code of ctxInfo.courses) {
      const opt = document.createElement("option");
      opt.value = code;
      opt.textContent = code;
      els.course.appendChild(opt);
    }
  })
  .catch(() => notice("Could not reach the local voice server."));
