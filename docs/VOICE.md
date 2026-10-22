# Voice intake — talk it through

**One sentence:** a local web page streams your mic to Gemini Live, an interviewer model draws out your goals and how school is going, and it writes short captures into `{user_root}/inbox/` while a local transcript is kept for review.

This is a **capture** channel, not a voice remote for the harness. The text agent (`USER.md` triage, skills) stays the brain; voice adds the context you'd never type. Architecture context: [`architecture.md`](architecture.md).

```text
browser page (mic, speaker)          localhost server (browser/)             Gemini Live API
  16 kHz PCM16 frames  ──WebSocket──▶  VoiceSession  ──────────────────────▶  speech-to-speech model
  24 kHz PCM16 audio   ◀─────────────                ◀── audio, transcripts, tool calls
                                        │ tools (2 only)
                                        ├─ save_goal          → {user_root}/inbox/goals.md  ## Raw captures
                                        ├─ append_class_note  → {user_root}/inbox/courses/CODE.md  ## Class notes
                                        └─ save_workflow_draft (onboarding only) → {user_root}/workspace/onboarding-draft.json
                                        └─ transcript         → {user_root}/inbox/voice/sessions/{id}.md (local)
student-voice-intake (later, text agent) → verifies captures, fills goals.md ## Distilled
```

## Quick start

1. Get a Gemini API key (<https://aistudio.google.com/apikey>) and put `GEMINI_API_KEY=...` in the repo-root `.env` (gitignored; see `env.template`). Requires Node ≥ 20.12.
2. `cd browser && npm install`
3. `npm run voice-models` — lists Live-capable models for your key. Set `GEMINI_LIVE_MODEL` in `.env` to the one you want. **The built-in default is only the id from the SDK docs and may be retired.**
4. `npm run voice`, open the printed `http://localhost:8787`, allow the mic, wear headphones, press **Start**.
5. Talk. **End session** saves the transcript. Later, ask the text agent to run `student-voice-intake`.

## Session types

| Type | For | Interviewer focuses on |
|------|-----|------------------------|
| Goals & priorities | open conversation | after-graduation picture, ideas you keep returning to, what you're optimizing for, constraints, mentors; *why* behind your career ranking |
| Weekly check-in | how the week is going | what's weighing on you, what you're avoiding; uses `week.md` as conversation prompts only |
| Class reflection | one course | what clicked / didn't, confidence; saves class notes + mastery gaps |

Each session's system prompt is built from `USER.md` (identity + ranked careers), `inbox/goals.md`, `inbox/week.md` (fenced as untrusted Canvas data) and the course list, so it builds on what's known instead of re-asking.

## Safety model

- **Local-only, narrow tools.** Goals/check-ins/classes get two local markdown append tools. The onboarding session additionally saves one validated `status: "draft"` workspace proposal. No mode has Canvas access, submits, file reads, connector authorization, or workspace-apply permission. Anything else you ask for is recorded as a `request` for the text agent, never executed — a misheard "yes" can't submit anything.
- **Key stays server-side.** The page never sees `GEMINI_API_KEY`.
- **Local only.** Server binds `127.0.0.1`; `Host` and `Origin` are checked so other websites in your browser can't open the mic bridge. One session at a time.
- **Raw speech stays local** (`{user_root}/inbox/voice/sessions/`, outside the repo). Audio is never written to disk; only text is.
- Tool writes go through temp-file + rename, and spoken text is whitespace-collapsed so it can't inject markdown structure.

## Privacy

Your audio is streamed to Google to be processed. Check Google's current terms for the API tier you use (free tiers have historically allowed use of data to improve products; paid tiers have not) before talking about anything sensitive.

## Tuning

| Env var | Default | Effect |
|---------|---------|--------|
| `GEMINI_API_KEY` | none | required for a live session; the typed interview does not use it |
| `GEMINI_LIVE_MODEL` | SDK-doc example | set `gemini-2.5-flash-native-audio-preview-12-2025` after `npm run voice-models` |
| `VOICE_SILENCE_MS` | `1500` | silence that ends your turn; raise if it cuts you off mid-thought |
| `VOICE_NAME` | model default | prebuilt voice name |
| `VOICE_PORT` | `8787` | local port |

End-of-speech sensitivity is set to low (Live's default cuts turns quickly, which is wrong for reflective talk). Long sessions use context-window compression and session resumption; on a server `goAway` the bridge reconnects with the saved handle.

## Swapping the model

`browser/scripts/lib/voice/live.mjs` is the only file that imports the Google SDK; everything else takes an injected `connectLive({ config, callbacks })`. To try OpenAI Realtime or an STT → Claude → TTS pipeline, implement that seam and the existing tool declarations; the server, prompt, tools, transcript, and skill don't change.

## Workspace-design onboarding

In the app, the workspace step offers **Talk it through** and **Type it instead**.
Both are optional. **Do this later** leaves Kairos on its current workspace.

**Type it instead** asks the same questions one screen at a time and builds the
draft locally. It does not start the voice server and does not need
`GEMINI_API_KEY`. A named tool is stored as a requested integration. The screen
says Kairos can't connect that.

**Talk it through** starts the loopback voice server in onboarding mode and
opens the existing voice sheet (the ink ring) in this window. It does not open
a browser tab. If the key, the microphone, or the voice server is missing, the
same typed questions are the next step.

The interviewer still has only `save_goal`, `append_class_note` (when course
files exist), and `save_workflow_draft`. A call to anything else is saved as a
`request` and refused. `save_workflow_draft` writes
`{user_root}/workspace/onboarding-draft.json` with `status: "draft"`. The app
compiles that file locally and plays the patch stream in Workspace Studio.
The sentences the sheet shows while blocks land are the compiler's `narration`
field. The model is told to read that array aloud and then stop. It does not
choose blocks.

The question list is unchanged. The pacing is: open on one recent incident,
stop once friction, orientation, interruptions, and inputs are known, probe a
vague answer once, quote a contradiction and keep the later concrete example
if they do not pick, and say "I can't connect that" for an unsupported tool.
Spoken words are data. A transcript included in the prompt sits inside
`<<<UNTRUSTED INTERVIEW TRANSCRIPT>>>`.

### Try it live

`npm test` in `browser/` covers this with a scripted session and no key. To
talk to the real model once that passes:

1. Put `GEMINI_API_KEY` in the repo-root `.env`.
2. Set `GEMINI_LIVE_MODEL=gemini-2.5-flash-native-audio-preview-12-2025`.
   The code default `gemini-live-2.5-flash-preview` is only the SDK example and
   may be retired. Confirm the id with `cd browser && npm run voice-models`.
3. Start Kairos, reach **How should Kairos start?**, and choose **Talk it through**.
   Or, for the developer page, `cd browser && npm run voice`, open the printed
   localhost URL, and choose **Design my workspace**.

Check that the model speaks first, `{user_root}/workspace/onboarding-draft.json`
has `"status": "draft"`, blocks land in the studio with the compiler's
sentences, and Stop never writes an accepted workspace.

Cost, from the [Gemini API pricing page](https://ai.google.dev/gemini-api/docs/pricing)
for `gemini-2.5-flash-native-audio-preview-12-2025`: paid audio is $3.00 per
1M input tokens and $12.00 per 1M output tokens, at 25 tokens per second.
A short interview of about six minutes, with the mic open the whole time
(silence is billed), is roughly 5 to 15 cents if only new audio is billed.
If the API re-bills accumulated session audio on every turn, the same
interview can reach a few tens of cents. The free tier is $0 and may use the
audio to improve Google's products. Text tokens are negligible beside the audio.
Any future model-graded check of these sessions uses Claude Sonnet 4.6, not a
local or Ollama model, and is not part of `npm test`.

## Status

- **Tested:** unit + integration tests (`cd browser && node --test tests/voice-*.test.mjs`) against a fake Live connection, including the full WebSocket path; the page was also driven end to end in headless Chromium with a fake microphone against the real server, with Gemini stubbed.
- **Reached the real Live endpoint, but never with a valid key.** The build session had no API key and couldn't read Google's docs, so wire behavior was taken from the `@google/genai` type definitions. A bogus-key run through the real SDK confirmed the transport works and that a rejected key surfaces as a clear error within a second (the SDK's `connect()` never settles in that case; the bridge handles it). Your config, model id, and tools were not validated by Google yet. First real run to check: the model speaks first, tool calls land in `goals.md`, transcript fragments join with correct spacing, and a 15+ minute session survives resume.
- **Desktop browser only.** Mic access needs `localhost` (a secure context), so the phone can't reach it; a phone path would need hosting, which is out of scope (`CLAUDE.md`).
- Cost is small at personal volumes (roughly single-digit to low tens of dollars a month for a few hours of talking, per third-party price lists as of 2026-09 — verify).
