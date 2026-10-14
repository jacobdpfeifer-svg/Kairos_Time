/**
 * Voice presence: the one place the voice model tells the UI what is
 * happening. Blot and the voice sheet only read from here.
 *
 * Voice-model integration (all calls are optional except `set({ state })`):
 *
 *   import { voicePresence, attachAnalyserLevel } from "../voice/presence";
 *   voicePresence.onStop(() => session.stop());           // Stop button
 *   voicePresence.set({ state: "listening", transcript: "" });
 *   const detach = attachAnalyserLevel(micAnalyser);       // level while listening
 *   voicePresence.set({ state: "thinking", status: "Checking your week" });
 *   voicePresence.set({ state: "speaking", reply, items }); // items → drops + handwriting
 *   detach(); attachAnalyserLevel(playbackAnalyser);        // level while speaking
 *   voicePresence.set({ state: "done" });  …  voicePresence.set({ state: "idle" });
 *
 * The level is kept out of React state on purpose: it changes every frame
 * and Blot reads it straight from its animation loop.
 */
import { useSyncExternalStore } from "react";
import { createLevelMeter, rmsOf, type VoiceState } from "../blot/core";

export type { VoiceState };

export interface VoiceItem {
  title: string;
  /** Canvas course id; its card colour is looked up when `color` is not given. */
  courseId?: string;
  color?: string;
  /** Short due text, already formatted ("Thu 11:59 pm"). */
  due?: string;
}

export interface VoicePresence {
  state: VoiceState;
  /** What the student said (live while listening). */
  transcript: string;
  /** Names the real work while thinking ("Checking your week"). */
  status: string;
  /** What Blot says back (captions while speaking). */
  reply: string;
  items: VoiceItem[];
  error: string;
}

const INITIAL: VoicePresence = { state: "idle", transcript: "", status: "", reply: "", items: [], error: "" };

type Listener = () => void;

function createPresenceStore() {
  let snapshot: VoicePresence = INITIAL;
  let level = 0;
  let stop: (() => void) | null = null;
  const listeners = new Set<Listener>();

  return {
    get(): VoicePresence {
      return snapshot;
    },
    set(patch: Partial<VoicePresence>): void {
      const next = { ...snapshot, ...patch };
      if (patch.state && patch.state !== snapshot.state) {
        // a new turn clears what belonged to the previous one
        if (patch.state === "listening") Object.assign(next, { transcript: patch.transcript ?? "", reply: "", items: [], error: "", status: "" });
        if (patch.state !== "error" && patch.error === undefined) next.error = "";
        if (patch.state === "idle" || patch.state === "listening") level = 0;
      }
      snapshot = next;
      listeners.forEach((l) => l());
    },
    reset(): void {
      snapshot = INITIAL;
      level = 0;
      listeners.forEach((l) => l());
    },
    subscribe(listener: Listener): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** Smoothed 0..1 loudness, read every animation frame. */
    get level(): number {
      return level;
    },
    setLevel(value: number): void {
      level = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
    },
    /** The voice model registers how to stop a session; the sheet's Stop button calls it. */
    onStop(handler: (() => void) | null): void {
      stop = handler;
    },
    get canStop(): boolean {
      return stop !== null;
    },
    stop(): void {
      stop?.();
      this.set({ state: "idle" });
    },
  };
}

export const voicePresence = createPresenceStore();

export function useVoicePresence(): VoicePresence {
  return useSyncExternalStore(voicePresence.subscribe, voicePresence.get, voicePresence.get);
}

/**
 * Drive the level from a Web Audio AnalyserNode (mic input or TTS playback).
 * Returns a detach function. Gated and smoothed (30 ms attack, 150 ms release).
 */
export function attachAnalyserLevel(analyser: AnalyserNode): () => void {
  const meter = createLevelMeter();
  const buf = new Float32Array(analyser.fftSize);
  let raf = 0;
  let last = performance.now();
  const tick = (now: number) => {
    analyser.getFloatTimeDomainData(buf);
    voicePresence.setLevel(meter.push(rmsOf(buf), (now - last) / 1000));
    last = now;
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => {
    cancelAnimationFrame(raf);
    voicePresence.setLevel(0);
  };
}

/** Fill in each item's colour from the student's Canvas course colours. */
export function withCourseColors(items: VoiceItem[], colors: Record<string, string>): VoiceItem[] {
  return items.map((it) => (it.color || !it.courseId || !colors[it.courseId] ? it : { ...it, color: colors[it.courseId] }));
}
