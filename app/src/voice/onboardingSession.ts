/**
 * Onboarding voice inside the app. The sheet and ink ring stay on presence.ts.
 * Model transcripts may caption the interview. Once the draft is saved, the
 * studio owns the caption and model text is not applied.
 */
import { startVoiceServer } from "../ipc";
import { attachAnalyserLevel, voicePresence } from "./presence";

const OUTPUT_RATE = 24000;
const MIC_REASON = "Kairos can't use the microphone. You can type the same answers.";

export type VoiceNotice = { type: string; role?: string; text?: string; name?: string; result?: { ok?: boolean }; message?: string };

export function reduceVoiceMessage(narrating: boolean, msg: VoiceNotice): { narrating: boolean; effect: "draft" | "user" | "model" | "listen" | "error" | "none"; text: string } {
  if (msg.type === "tool" && msg.name === "save_workflow_draft" && msg.result?.ok) {
    return { narrating: true, effect: "draft", text: "" };
  }
  if (narrating) return { narrating: true, effect: "none", text: "" };
  if (msg.type === "transcript" && msg.role === "user") return { narrating, effect: "user", text: msg.text ?? "" };
  if (msg.type === "transcript" && msg.role === "model") return { narrating, effect: "model", text: msg.text ?? "" };
  if (msg.type === "turnComplete" || msg.type === "interrupted" || msg.type === "ready" || msg.type === "resumed") {
    return { narrating, effect: "listen", text: "" };
  }
  if (msg.type === "error") return { narrating, effect: "error", text: msg.message ?? "The voice session ended unexpectedly. Start it again to retry." };
  return { narrating, effect: "none", text: "" };
}

function applyNotice(narrating: boolean, msg: VoiceNotice, onDraft: () => void): boolean {
  const next = reduceVoiceMessage(narrating, msg);
  if (next.effect === "draft") onDraft();
  else if (next.effect === "user") {
    const prev = voicePresence.get();
    const transcript = prev.state === "listening" ? `${prev.transcript}${next.text}` : next.text;
    voicePresence.set({ state: "listening", transcript });
  } else if (next.effect === "model") {
    const prev = voicePresence.get();
    const reply = prev.state === "speaking" ? `${prev.reply}${next.text}` : next.text;
    voicePresence.set({ state: "speaking", reply });
  } else if (next.effect === "listen") {
    voicePresence.set({ state: "listening", transcript: "" });
  } else if (next.effect === "error") {
    voicePresence.set({ state: "error", error: next.text });
  }
  return next.narrating;
}

export async function startOnboardingVoice(onDraft: () => void): Promise<{ ok: true } | { ok: false; reason: string }> {
  const started = await startVoiceServer();
  if (!started.ok) return started;

  let ctx: AudioContext;
  let stream: MediaStream;
  try {
    ctx = new AudioContext();
    await ctx.resume();
    await ctx.audioWorklet.addModule("/pcm-capture-worklet.js");
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch {
    return { ok: false, reason: MIC_REASON };
  }

  const ws = new WebSocket(`ws://127.0.0.1:${started.port}/ws`);
  ws.binaryType = "arraybuffer";
  let narrating = false;
  let closed = false;
  let detachLevel: (() => void) | null = null;
  let nextPlay = 0;
  const playing = new Set<AudioBufferSourceNode>();

  const stop = () => {
    if (closed) return;
    closed = true;
    detachLevel?.();
    detachLevel = null;
    stream.getTracks().forEach((track) => track.stop());
    for (const src of playing) {
      try {
        src.stop();
      } catch {
        /* already ended */
      }
    }
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "stop" }));
    ws.close();
    void ctx.close().catch(() => undefined);
    voicePresence.onStop(null);
  };

  voicePresence.onStop(stop);
  voicePresence.set({ state: "thinking", status: "Starting the interview" });

  const micAnalyser = ctx.createAnalyser();
  micAnalyser.fftSize = 1024;
  const source = ctx.createMediaStreamSource(stream);
  source.connect(micAnalyser);
  const worklet = new AudioWorkletNode(ctx, "pcm-capture");
  worklet.port.onmessage = (event) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(event.data as ArrayBuffer);
  };
  const silent = ctx.createGain();
  silent.gain.value = 0;
  source.connect(worklet);
  worklet.connect(silent);
  silent.connect(ctx.destination);
  detachLevel = attachAnalyserLevel(micAnalyser);

  const playPcm = (buf: ArrayBuffer) => {
    const i16 = new Int16Array(buf, 0, buf.byteLength >> 1);
    const f32 = new Float32Array(i16.length);
    for (let i = 0; i < i16.length; i++) f32[i] = i16[i] / 32768;
    const audio = ctx.createBuffer(1, f32.length, OUTPUT_RATE);
    audio.copyToChannel(f32, 0);
    const src = ctx.createBufferSource();
    src.buffer = audio;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    src.connect(analyser);
    analyser.connect(ctx.destination);
    detachLevel?.();
    detachLevel = attachAnalyserLevel(analyser);
    const at = Math.max(ctx.currentTime + 0.02, nextPlay);
    src.start(at);
    nextPlay = at + audio.duration;
    playing.add(src);
    src.onended = () => {
      playing.delete(src);
      if (!playing.size && !closed) {
        detachLevel?.();
        detachLevel = attachAnalyserLevel(micAnalyser);
      }
    };
  };

  ws.onmessage = (event) => {
    if (event.data instanceof ArrayBuffer) {
      playPcm(event.data);
      return;
    }
    let msg: VoiceNotice;
    try {
      msg = JSON.parse(String(event.data)) as VoiceNotice;
    } catch {
      return;
    }
    narrating = applyNotice(narrating, msg, onDraft);
    if (msg.type === "closed") stop();
  };
  ws.onclose = () => stop();

  const opened = await new Promise<boolean>((resolve) => {
    ws.onerror = () => resolve(false);
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "start", mode: "onboarding" }));
      resolve(true);
    };
  });

  if (!opened || ws.readyState !== WebSocket.OPEN) {
    stop();
    return { ok: false, reason: "Voice didn't start. You can type the same answers." };
  }
  return { ok: true };
}
