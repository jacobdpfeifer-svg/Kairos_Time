# Game design as product design — what Kairos takes, and what it refuses

Research behind **MASTER §16 (Weight and consequence)** and **§17 (Disclosure)**, adopted 2026-10-23.
Source material: a video essay arguing that "all products are secretly games", that game design and product design are one discipline built on six shared principles, and that products should borrow game feel, progressive disclosure, multiplayer design, and free-to-play monetization.

Six parallel agents verified the source's claims, the craft numbers, the standards text, shipped-product behaviour, this runtime, and the learning-science and legal literature. Tags below: `[V]` read in the cited source during the run · `[2°]` from a secondary summary of a primary source · `[D]` derived · `[?]` unverified, and left unverified on purpose.

---

## 1 The thesis

The source contradicts itself across its own running time, and the contradiction is the interesting part.

Its first chapter argues for **more** weight at consequential moments: a fighting game freezes on a heavy hit, a game slows down and shakes when you die, Vercel makes you type the project's name before it will delete it. Weight proportional to stakes.

Its last chapter argues for the exact opposite at the identical moment: *"don't sell while people are thinking — sell the exact second they lose."* The whole free-to-play ladder is built on **removing** the user's deliberation precisely when the stakes peak.

The word doing the damage is **consequential**, because the source never says consequential *for whom*. Hit stop and a typed project name are weight added for the player, at the player's risky moment. The kill-stop upsell is weight removed for the house, at the player's weakest moment. Identical timing instinct, opposite beneficiary — and the essay presents them as the same craft.

Kairos is a notebook (§01), so resolve it in paper:

> **Weight goes where the mark leaves the page.**

Writing in a notebook is free. So is crossing something out. Nothing on a page you own needs a confirmation, because nothing on it is hard to take back. What is hard to take back is the page **leaving your hands** — torn out, photocopied, handed to someone, thrown away. A notebook has no undo button because, until that moment, it does not need one.

And the corollary that settles the question the source is really asking:

> **In a product with undo, weight means reversibility, not ceremony.**

Hit stop is a game's way of telling a player *this one counted* — to a player who has no undo. We have undo. A product that can give the mark back does not have to flinch to prove the mark mattered.

What falls out of the one sentence, without aiming it there:

- **The confirmation ladder** is a function of whether the student can get the page back, not of how large the action feels. That condemns the current tree in one line: friction sits on removing a file copy and adding one calendar block, while exporting every grade to a ZIP and marking work done-forever are both a single click (§5, A1/A11).
- **The juice question** answers itself. The honest weight for a state change is a reversal path, not a freeze.
- **Monetization** is refused by the same sentence rather than by distaste: the entire ladder applies weight while the page is still in the student's hands, and nothing is departing at all.
- **Disclosure** stops being a tutorial schedule. A notebook's later pages are not hidden, they are **blank**. What the student has not written yet is not there yet (§17).

---

## 2 The source's claims, checked

31 claims were extracted and 25 were assigned to the claim-checking agent. Verdicts, with the correction where the source is wrong.

| # | Claim | Verdict | What is actually true |
|---|---|---|---|
| C5 | Vercel blocks every other action and needs the full project name typed to delete | **Overstated** | The docs say to confirm by "entering the project name and prompt" `[V]`. "Blocks every other action" is unsupported. Pause also needs the typed name; Resume has no confirmation at all `[V]` ([docs](https://vercel.com/docs/projects/managing-projects)) |
| C6 | Game design and product design are one discipline on six shared principles | **Not a claim** | The author's own framing. The "six" are the chapter headings of Swink's book (C13), not a derived set |
| C7 | PvZ level 1 teaches with zero on-screen instruction | **False** | 1-1 does carry on-screen prompts, and the Sunflower unlocks *after* the level `[2°]`. Fan's stated position is against "walls of tutorial text" `[V]` — minimal, not zero |
| C8 | Playtesters did not grasp planting sunflowers early | **True, partly** | Fan: players unfamiliar with RTS planted peashooters without enough sunflowers, and "the sun collection mechanic was hard to learn" `[V]` ([Gamezebo](https://www.gamezebo.com/news/interview-with-plants-vs-zombies-creator-george-fan/)). That a text explanation was tried and failed: `[?]` |
| C9 | Sunflower 100→50, starting sun set to 50, so sunflower is the only legal first move; dozens of hours of rebalancing | **Overstated** | The price change and "required a rebalancing of the entire game" are real and in Fan's own words `[V]`. The 50 starting sun, "only legal first move", "dozens of hours" and "quoted on camera": all `[?]`, and 1-1 ships offering only Peashooters `[2°]` |
| C10 | ChatGPT removed the account requirement, April 2024 | **True, qualified** | Announced 1 Apr 2024, gradual rollout, with limits and no saved chats `[2°]` |
| C13 | A game is input + response + context + metaphor + rules + polish, per Swink | **Overstated** | Those six are the book's **metric areas**; Swink's definition is "realtime control of virtual objects in a simulated space, with interactions emphasised by polish" `[V]`. The video merges the definition with the table of contents. Neither agent read the book: `[2°]` |
| C15 | Juice "makes your game better 100% of the time" | **Unsourceable** | No write-up of the Jonasson/Purho talk contains the line `[V]`. The Breakout walkthrough is real `[2°]`. See §4 for what the measured evidence actually says — it is not "100%" |
| C17 | Computer Space flopped on four buttons; Pong shipped one instruction | **Overstated** | Computer Space sold ~1,300–1,500 units and took over US$1M `[2°]` — not a flop. The four controls are real; Bushnell did call it too complicated for bar patrons `[2°]`. The Pong cabinet line itself: `[?]` |
| C18 | Bushnell's law | **Unsourceable as a quote** | Wording is "often attributed"; no primary speech or interview is cited anywhere checked `[2°]`. Use the idea, attribute it to nobody |
| C21 | 2b2t: no rules since 2010, most of the first million blocks destroyed | **Overstated** | Founded Dec 2010, never reset, "almost no rules" — but operators patch exploits and added content rules in Dec 2025 `[2°]`. "Most of the first million blocks" appears in no source `[V]` |
| C22 | Journey's devs expected players to boost each other over ledges; players pushed each other into hazards | **Overstated** | Chen describes wanting players to "push each other against the wind", and once collision existed players pushed each other into pits — "pretty demoralizing" `[V]` ([Shacknews](https://shacknews.com/article/75483/interview-jenova-chen-looks-back-at-journey)). No boosting. It describes a **cut prototype**; shipped Journey removed harm |
| C23 | Operational transformation is "the paper" on multiplayer undo | **Overstated** | Ellis & Gibbs 1989 is concurrency control `[2°]`; multi-user undo is a separate line (Prakash & Knister 1994) `[2°]`. It is a literature, not a paper |
| C25 | Bartle's four types each take a different monetization strategy | **False** | The 1996 paper is about MUD population balance and never discusses revenue or pricing `[V]` ([mud.co.uk](https://mud.co.uk/richard/hcds.htm)). The industry attached monetization later |
| C27 | "Sell the exact second they lose" | **Unsourceable** | No named source `[?]`. See §7 — the timing instinct is sound and the intent is not |
| C28 | Google Meet cuts the meeting and upsells minutes before | **True, qualified** | 60-minute cap for 3+ participants, notice at 55 minutes, host can upgrade `[2°]`; 1:1 runs to 24 hours. Policy date 2020, current status unconfirmed |
| C30 | Whales produce most revenue; SaaS whales are $100k+/yr enterprise deals | **Half true** | Mobile: 0.15% of players produced half of IAP revenue (Swrve, Jan 2014) `[2°]`. The SaaS enterprise figure has no source `[?]` |
| C1–C4, C11, C19, C20 | hit stop, Notion's toast, Kirby, "kill stop", Gmail's attachment warning, Civ's turn 1, Figma's squircle | **Unchecked** | Not verified this run. "Kill stop" is not a term of art in anything found `[?]`. Hit-stop *values* were verified separately (§4) |

**The pattern.** Where the source describes a mechanism, it is usually right. Every time it reaches for a number, an attribution or a superlative — "zero instruction", "100% of the time", "flopped", Bartle on monetization, Bushnell's own words — it is wrong or unsourceable. Nine of nineteen checked claims came back overstated and three false. The craft chapters survive; the authority does not.

---

## 3 Hit stop, measured

The source's opening image is the only one with hard numbers behind it, and they are much larger than the essay implies.

| Game | Rule | Frames → ms at 60fps |
|---|---|---|
| Smash 64 | `floor(floor(floor(d*3+5)*e)*c)`, no cap `[V]` | 15% damage = 10f = **167ms** `[D]` |
| Melee | `…(d*3+3)…`, cap 20f `[V]` | 15% = 8f = 133ms; 1% = 6f = 100ms; cap 333ms `[D]` |
| Brawl / Smash 4 | `…(d*0.3846154+5)*h*e…`, cap 30f `[V]` | 15% = 10f = 167ms; 1% = 5f = 83ms; cap 500ms `[D]` |
| Ultimate | `…(d*0.65+6)*h*e*s…`, flattened above 15f `[V]` | 15% = 15f = **250ms**; 0–1% = 6f = 100ms `[D]` |
| Guilty Gear Xrd | by attack level: Lv0 11f, Lv4 15f; counter-hit 11–27f `[2°]` | 183 / 250 / up to 450ms `[D]` |

Source for the Smash formulas: [ssbwiki Hitlag](https://www.ssbwiki.com/Hitlag). Both attacker and victim freeze, on the same base formula, and an attack dealing no damage produces no hitlag at all `[V]` — the freeze is **contingent on the outcome**, which turns out to be the finding that matters (§4).

Shipped range: roughly **83–167ms for a normal hit, 333–500ms at the caps** `[D]`.

Corrections worth keeping:
- "Hitstop is a fixed 3–5 frames" is **wrong** — it is 6–30 frames depending on damage and title `[V]`.
- Any "Vlambeer used 50ms" figure is **unsourceable**; the only wording found is "a frame or a couple of frames" `[2°]`.
- A "60–80ms" web-game-feel recommendation exists but was not read `[2°]` — not used here.

Screen shake, for completeness, since the source proposes it: engine recipes ship 100px max offset and 0.8 trauma/s decay (Godot) or 30px and 0.02/update (npm `screen-shake`) `[V]`/`[2°]`. These are **engine defaults, not published standards** `[D]`, the attribution to a named GDC talk could not be confirmed `[2°]`, and shake is whole-viewport vestibular motion. It is prohibited in §16.6 and the reasoning is in §6 below.

---

## 4 Does juice actually work? The one study that decides it

The source asserts juice "makes your game better 100% of the time". The best available evidence says something narrower and far more useful.

**Kao, Ballou, Gerling, Breitsohl & Deterding, CHI 2024, "How does juicy game feedback motivate? Testing curiosity, competence, and effectance"** — a pre-registered online experiment, **n = 1,699**, varying feedback **amplification**, **success dependence** and **variability**, measuring effectance, competence, curiosity, enjoyment and free-choice playtime `[2°]`:

- **Success dependence enhanced all motives.** Feedback that tracks *how well you actually did* increased effectance, competence and curiosity.
- **Amplification unexpectedly reduced them.** The authors' stated explanation is that the amplified condition "unintentionally impeded players' sense of agency".
- Curiosity was the strongest predictor of enjoyment and the only predictor of playtime.

Supporting and complicating:

| Finding | Tag |
|---|---|
| Kao 2020: medium and high juiciness beat both extreme juiciness and none, on experience, intrinsic motivation, play time and in-game performance | `[2°]` |
| Juul & Begy 2016, "Good Feedback for Bad Players?" — cited in the run as finding players rated juicy higher while performing worse. **Could not be verified**; only the citation was recoverable | `[?]` |
| Vibrotactile "juicy" embellishments improved player experience (Waterloo, CHI 2021, n=38) | `[2°]` |
| Any study of juice in a **non-game interface** | `[?]` none found |

**So the measured answer is not "more". It is "contingent".** The thing that raised competence and effectance was feedback proportional to the real outcome; the thing that lowered them was turning the volume up. That is the same shape as the hitlag formulas in §3 — no damage, no freeze — and it is the evidence base for §16's rule that weight must be *earned by state*, never applied as decoration.

It also means the owner's chosen position ("reopen juice for real state changes") and the evidence point the same way, with one caveat the evidence adds: the ceiling is low, and amplification past it costs agency.

---

## 5 What the standards actually require

Full normative text in agent 3's report; the load-bearing parts:

| SC | Level | What it requires |
|---|---|---|
| **3.3.4** Error Prevention (Legal, Financial, Data) | AA | For pages causing legal or financial commitments, or modifying/deleting user-controllable data, **at least one** of: *Reversible*, *Checked*, or *Confirmed* `[V]` |
| **3.3.6** Error Prevention (All) | AAA | Same three bullets, for any page requiring submission `[V]` |
| **2.2.1** Timing Adjustable | A | Every content-set time limit must be turn-off-able, adjustable over ≥10× the default, or extendable with ≥20s warning, unless real-time/essential/over-20-hours `[V]` |
| **2.3.3** Animation from Interactions | AAA | Interaction-triggered motion animation can be disabled unless essential. **Opacity, colour and blur are explicitly excluded** from "motion animation" `[V]` |

Three consequences for this product:

1. **"Reversible" alone satisfies 3.3.4.** Only one bullet is required `[V]`. Undo is a conformant answer; a confirmation dialog is not more conformant than a working undo. This is the standards text agreeing with the thesis.
2. **The 6-second undo toast conforms only via the "another way to find it" argument.** The Understanding page for 2.2.1 works through exactly this case — a toast that disappears after 5 seconds — and says it is acceptable *when users have another way to reach the same information*, and that otherwise "each message would need to meet this success criterion" `[V]`. In Kairos that argument holds for `defer` and fails for `done` (§6, A11).
3. **`prefers-reduced-motion: reduce` means "removes or replaces"** in the spec's own words `[V]`, which is what §15.2 already does. Confirmed, not changed.

And the number to stop repeating: **"35% of adults have vestibular dysfunction" is not a motion-sensitivity statistic.** It is Agrawal et al. 2009 on a postural-balance test (modified Romberg on foam, eyes closed) in US adults 40+ `[2°]`. It is not a diagnosis, not about animation, and WCAG cites no percentage at all `[V]`. No authoritative figure exists for the share of users harmed by UI animation `[?]` — which is why §15.5's area limit is labelled engineering judgement rather than a clinical threshold, and that label stands.

---

## 6 What shipped products do

The destructive-action ladder, reverse-engineered from documentation read this run (dates in agent 4's report):

| Rung | Trigger | Who ships it |
|---|---|---|
| Nothing | Reversible, low stakes | Vercel "Resume Project" `[V]` |
| Undo, then a long recovery window | Reversible by the user | Linear: ⌘Z, then 30-day "Recently deleted" `[V]`. Notion and Drive: 30-day trash `[V]` |
| One extra explicit click | Irreversible and bulk | Drive "Empty trash" → "Delete forever" `[V]` |
| Typed name | Irreversible, and a container for other people's work | Vercel project `[V]`, GitHub repo (three stages: intent → acknowledge effects → type the name) `[V]`, GitHub org `[V]` |
| Typed name + second factor | — | **Not found anywhere** `[?]` |

**The rule they are all following: consequence is judged by blast radius and irreversibility, not by how large the action feels** `[D]`. GitHub is the clearest case — it still offers 90-day restoration *and* three stages of friction, because the blast radius is other people's work.

Two things that complicate it honestly:
- Raskin's "Never Use a Warning When You Mean Undo" argues confirmations fail by habituation and that typed confirmation makes people focus on the typing rather than on the decision — and it is **anecdote, with no measurement** `[V]`. The habituation research that does exist (Bravo-Lillo SOUPS 2014; Anderson/Vance fMRI) is about *security warnings*, not delete confirmations, so it transfers by analogy only `[2°]`.
- **No measured evidence was found that type-the-name reduces accidental deletion** `[?]`. The industry is unanimous and the literature is silent. §16 therefore puts typed confirmation at exactly one rung and no lower.

Motion tokens, for comparison against our five: Linear ships 0.1s / 0.16s / 0.25s on `ease-out-quad` `(.25,.46,.45,.94)` as its dominant pairing; Vercel ships 0.15s default and a `--ds-motion-timing-swift` of `(.175,.885,.32,1.1)` — a **bezier overshoot, not a spring**, and commonly misdescribed as one `[V]`. Raycast ships a real spring as a pre-sampled `linear()` table peaking at 1.043 `[V]`. Material, Carbon and Fluent all publish durations up to 400–1000ms `[V]`, so **our 300ms ceiling is stricter than every published system** `[D]` — deliberately, and §15 keeps it.

The study-app row, which is what we are declining to copy: Duolingo's day-count streak and hearts (a lost heart is losable state) `[2°]`. Anki's own preferences carry no streak or score, and do carry "Reduce motion" and "Interrupt current audio when answering" `[V]`.

---

## 7 Motivation, law, and the moment of failure

The source's monetization chapter is the one place its advice is not merely overstated but harmful if adopted here, and the reasons are specific.

**Rewards and losable state.** Deci, Koestner & Ryan 1999 pooled 128 studies: contingent rewards reduce free-choice intrinsic motivation, engagement-contingent d = −0.40, completion-contingent d = −0.36, performance-contingent d = −0.28 `[2°]`. The generality is genuinely contested (Eisenberger/Cameron; Cerasoli 2014) `[2°]`. Kairos has no scores and no losable state, so there is no reward contingency to undermine — the existing rule is consistent with the evidence `[D]`, and this run found no reason to loosen it.

**Streaks, precisely.** Every published Duolingo number is a **retention** number, not a learning number `[V]`: a 7-day streak correlates with 3.6× course completion (survey data, explicitly correlational), a milestone animation lifted day-7 activity by +1.7% with no n given, Streak Freeze lifted DAU by +0.38%, a streak wager lifted day-7 retention by +14% `[2°]`. **No measured effect of streaks on learning outcomes was found in either direction** `[?]`, and no measured rate of streak-loss abandonment `[?]`. A product can win retention and lose learning; these figures cannot tell the two apart. The existing prohibition stands on exactly this: the evidence offered for streaks is evidence for the wrong outcome.

**What does sustain study behaviour**, where there are numbers: implementation intentions, d = 0.65 on goal attainment across 94 tests `[2°]`; retrieval practice, g ≈ 0.50 `[?]`; the spacing gap at roughly **20–40% of the retention interval for a one-week horizon, falling to 5–10% at a year** (Cepeda et al. 2008, >1,350 participants) `[2°]` — which is the literature `learn_loop.py` already cites. And the folklore to never repeat: "21 days" is not from Lally; the famous "66 days" is a median over 39 of 96 participants doing simple health behaviours, range 18–254 `[2°]`, and Lally's own lead author says the finding is that it varies widely `[2°]`.

**Law, by jurisdiction.** FTC §5 and ROSCA reach deceptive subscription enrolment and obstructed cancellation regardless of whether there is a server — the Amazon settlement was $2.5B on 25 Sep 2025 `[2°]`. The 2024 "click-to-cancel" amendments were **vacated** by the Eighth Circuit around July 2025 and are not in force `[2°]`; ROSCA still is. DSA Art. 25 (dark patterns) and Art. 28 (minors) bind providers of online platforms, which a locally-installed single-user tool probably is not `[D]` — Art. 3's definition was not read `[?]`. The Digital Fairness Act is a proposal, not law `[2°]`. FERPA binds schools, not a student syncing their own data `[2°]`. COPPA bites only if Kairos becomes an "operator" collecting from under-13s — relevant only because voice audio already leaves for the Gemini Live API `[D]`.

**And the hard question: the moment of failure.** The source's sharpest line is to sell the second the player loses. The literature says that at the moment a student realises they are behind, their causal attributions are forming and their decision-making is impaired; believing failure reflects fixed ability predicts withdrawal `[2°]` (the learned-helplessness link is mixed in replication `[2°]`, and Yeager 2019's mindset effect was ~0.10 grade points and conditional on school norms `[2°]`). No evidence was found that pressure at that moment helps a learner `[?]`.

So the timing instinct is right and the beneficiary is wrong — which is the thesis again, arriving from the other side. The defensible line, and it is now a rule in §16.6:

> **Kairos may use the moment of failure to reduce the cost of the next action. It may never use it to raise the price of staying.**

The constructive form: detect the real signal (a moved due date, a missed review, high-stakes work inside 48 hours), offer **one** concrete time-sized next action as an if-then plan (where implementation intentions apply), frame it as "the plan changed" rather than "you fell behind", show no count of what was lost, and make declining free and silent `[D]`.

**Notifications.** Kushlev & Dunn limited 124 people to three email checks a day for a week: daily stress fell, and most found three a day hard to keep to `[2°]`. The famous "23 minutes to refocus" includes handling the interruption and visiting ~2 other tasks, and its attribution is disputed between two papers `[2°]`. The current policy's cap of three, event-based triggers and quiet hours survive the evidence; the specific numbers 3 and 23:00–08:00 have no support beyond judgement `[?]`, and the source's "notifications may be more powerful than social media" is unsupported by anything found `[?]`. One change falls out: `sync_broken` serves the product rather than the learner, so it stays the quietest of the three.

---

## 8 This runtime

| Constraint | Evidence |
|---|---|
| App floor is **macOS 12.0** `[V]` (`app/src-tauri/tauri.conf.json:63`), so at the floor without Safari updates: no View Transitions (18.0), no scroll-driven animations (26.0), no `linear()` (17.2), no `@starting-style` (17.5) `[2°]` | `@starting-style` is already used in eight places in `app/src/notebook.css`; it degrades to the end state, which is acceptable `[D]` |
| No animation library, and none may be added. The tools are CSS transitions, WAAPI, rAF and Web Audio `[V]` | `app/package.json` |
| **A visual hold is a `transition-delay`, not a timer** `[D]`. Commit the data immediately and delay the FLIP transform; nothing to clean up under StrictMode, input never blocks, and transforms carry hit-testing with the paint | the mechanism §16.3 mandates |
| React 19 batches everywhere, including in timeouts and promises; StrictMode double-runs mount effects; `useTransition` would let a hold itself be deferred `[2°]` | why a hold must be CSS, not state |
| Sound is feasible in the app but not uniformly: Tauri's CSP has no `media-src` so it falls back to `default-src 'self'` — bundled files work, `data:`/`blob:` do not `[V]`/`[D]`; no audio asset exists today `[V]`; `AudioContext` is already used by voice `[V]`. In the extension the service worker has no DOM `[D]`, `offscreen` is not in the manifest `[V]`, and no audio file is web-accessible `[V]` | |
| **No web API can read macOS "Play user interface sound effects" or system mute** `[D]`. A product that cannot honour the platform's own sound switch has no business making sound. This is the whole reason §16.6 prohibits it | |
| Reduced motion is one switch with three forks: tokens in `design-system/kairos/motion.css:29-50`, hand-copied to `app/extension-chrome/ui/motion.css` and `landing/motion.css`; JS through `motionReduced()` / `useMotionReduced` (`app/src/motion.ts:12-45`); set at `app/src/theme.ts:27`, persisted in `localStorage` key `pn_motion` `[V]` | |
| `app/src/dev/frameRate.ts` samples rAF for 3000ms and reports p50/p95/p99 — and **is imported nowhere** `[V]`. The 60fps cap in §15.7 remains unmeasured on this build `[?]` | |

Four corrections this run found. The three that touch MASTER are applied; the fourth corrects a research agent:

1. **§15.6 is wrong about where the motion switch lives.** It says `data-motion` and `calibration/app-prefs.json`; `app/src-tauri/src/prefs.rs:13-20` carries only `keep_running`, `notifications` and `capture_shortcut`. The switch is browser `localStorage` only `[V]`.
2. **§15.5's stagger rule is arithmetically impossible.** "6 rows, 30–40ms apart, under 300ms total" computes to 5×30+200 = **350ms**, or 400ms at 40ms spacing `[D]`. Compliant: ≤20ms spacing for 6 rows, or 3 rows at 40ms (280ms).
3. **The triplicate is guarded, and the stack agent reported it was not.** `app/src/motion.test.ts:10-14` asserts that `landing/motion.css` and `app/extension-chrome/ui/motion.css` are byte-identical to `design-system/kairos/motion.css` `[V]`. Adding `--t-hold` broke it until all three were recopied, which is the test doing its job.
4. **§15.8 debts 8 and 9 are stale, and 10 is half stale.** The working tree has zero `@keyframes` in all three app stylesheets, and `app/src/motion.ts` now holds `useExit`, `useFlip` and the envelope, with `MotionDialog`/`Crossfade` in `app/src/components/MotionDialog.tsx` `[V]`. (The stack agent reported these as `app/src/motion.tsx`; that file does not exist — corrected here.)

---

## 9 Repo audit

Headline: **friction is pointed at the reversible actions and absent from the irreversible ones.** The same inversion the motion run found, in a different budget.

| # | Finding | Evidence |
|---|---|---|
| A1 | The ladder is upside down at the top. `ConfirmSheet` guards four things, the weightiest being one calendar block and one file copy. Meanwhile "Export my Canvas data" writes every course, assignment, timestamp and — opt-in — every grade to a ZIP on disk from one primary-button click, with no review step and no statement of where the file lands until after it exists | `app/src/views/SettingsView.tsx:172`, `:77-89`, `app/src/ipc.ts:107` |
| A2 | Switching or creating a profile swaps the entire data root with no confirm and no undo; the only feedback is a note asking the student to quit and reopen | `app/src/views/SettingsView.tsx:55-58`, `:200`, `:212` |
| A3 | Undo coverage is uneven inside one screen: `done`, `defer` and `accept` each pass an undo closure to the toast, but the calendar-block path — the only one writing outside Kairos — emits a toast with **no** undo, and `estimate` emits nothing | `app/src/views/WeekView.tsx:481`, `:177-201`, `:418-424`, `:440`, `:496` |
| A4 | The one hit-stop-shaped delay in the tree is **dead code**. `done()` and `deferRow()` call `setLeaving(...)` and then read `getComputedStyle(el).transitionDuration` in the same synchronous handler — React 19 has not committed `is-leaving` yet, `.rows > li` carries no base transition, so the read returns `0s`, `dur < 0.02` is true, and `window.setTimeout(go, 220)` is never reached. The 220 is also off-token (`--t-settle` is 200ms) and unexplained | `app/src/views/WeekView.tsx:191-199`, `:482-489`; `app/src/notebook.css:1603-1607`, `:1640` |
| A5 | Onboarding already satisfies the source's strongest claim — one question per screen, continue gated until the answer exists — so there is nothing to adopt. Where it breaks is the failure path: "Continue without classes" admits the student to a product whose every surface is built from Canvas data, with no statement of what will be empty | `app/src/components/FirstRun.tsx:472`, `:553` |
| A6 | The review loop is clean and is the model for the rest: four outcomes including "Skip for now", an explicit no-streak comment, and a next-review sentence as the only consequence. It is also the one real state change with no acknowledgement at all — and per §4 the fix is that the sentence is already outcome-contingent, so it needs typography, not motion | `app/src/components/ReviewSession.tsx:7`, `:10-15`, `:17-24` |
| A7 | Progressive disclosure exists but is not a system: seven ad-hoc sites, two class names, no rule for what belongs behind a disclosure, no surface table, and nothing recording NN/g's own caveat that past two levels usability drops `[V]` | `app/src/views/StudyView.tsx:323,568,602,799`; `SettingsView.tsx:156,189`; `TodayView.tsx:285`; `FirstRun.tsx:593` |
| A8 | Nothing in the product opens up with time or use. The only use-adaptive surface is ⌘K's six remembered ids in `localStorage` | `app/src/components/CommandBar.tsx:26`, `:30-46` |
| A9 | The notification policy is the only consequence-scaled rule in the tree written as code rather than as copy — three triggers, cap of three a day, quiet hours, once per key. Nothing else in the product reads a budget | `app/src/notify/policy.ts:17-20`, `:96-118` |
| A10 | Toasts have one slot and no queue: a second `setToast` replaces the first, destroying its pending undo silently and before its six seconds are up | `app/src/App.tsx:85`, `:500`; `app/src/components/Toast.tsx:14-24` |
| A11 | **The headline.** A captured item marked done is dropped from the week model forever (`if (c.done_at) continue`). The API supports `done … undo: true`, but the UI exposes it only through the 6-second toast, which A10 can destroy. The product's least reversible action has its weakest reversal path — and per §5 it conforms to 2.2.1 only via an argument that does not hold here | `app/src/week/plan.ts:170`; `app/src/week/api.ts:96`; `app/src/views/WeekView.tsx:481` |
| A12 | There is no pricing, trial, upgrade or paywall surface anywhere in the tree, so the source's entire monetization chapter has no attachment point. Confirmed boundary, not a gap | `grep -riE 'pricing\|trial\|upgrade\|paywall' landing/ app/src` → two unrelated hits |
| A13 | A keyboard `d` triggers `deferRow`, so a keyboard-initiated action animates, against §15.1 gate 1 | `app/src/views/WeekView.tsx:~473` `[V, stack agent]` |
| A14 | The extension's reduced-motion attribute is dead: nothing sets `data-motion` on the stage, so the student's own Settings switch never reaches the extension and only the OS query does. Same on the landing page | `app/extension-chrome/ui/dashboard.js` (no "motion" string), `landing/motion.css:41-42` `[V, stack agent]` |

**Is the budget pointed at the right things?** No, and in a specific way. Every mechanism the product has for weight — the confirm sheet, the undo closure, the 220ms hold — is attached to actions that are already reversible inside the notebook, while the three actions that genuinely leave the page (export, profile switch, done-forever) have no mechanism at all. The friction is real work, correctly built, and aimed at the wrong half of the product.

---

## 10 Why each rule is what it is

| Rule | Reason |
|---|---|
| The departure test as the decision rule (§16.1) | The audit's inversion (A1/A2/A11) has no single-defect fix; it needs a test that answers "does this earn friction?" without taste. Blast radius and irreversibility is the rule every shipped product is already following (§6) |
| Four rungs, typed confirmation at exactly one (§16.2) | §6's ladder, minus the rung nobody ships (typed + second factor). Typed confirmation sits at one rung only because there is **no measured evidence it works** `[?]` and the one source read argues against it `[V]` |
| Reversibility outranks confirmation (§16.2) | WCAG 3.3.4 needs only one of three bullets, and Reversible is one of them `[V]`. Linear and GitHub both ship recovery windows *and* friction; neither treats a dialog as a substitute for getting the thing back |
| A reversal path may not be the only path and may not expire silently (§16.2) | A11 + the Understanding note on 2.2.1's 5-second toast example `[V]`. This is the one place the product is plausibly non-conformant today |
| Weight is contingent on outcome, never amplified (§16.3) | Kao et al. 2024, n=1,699: success dependence raised all three motives, amplification lowered them `[2°]`. Also the shape of the hitlag formulas — no damage, no freeze `[V]` |
| The hold is 90ms, visual only, data commits first (§16.3) | 90ms is `--t-tap`, already in the tokens; the shipped hit-stop range starts at 83ms `[D]`. "Visual only" is the fix for A4's stale-state window, and a `transition-delay` is the mechanism the runtime actually wants `[D]` |
| One hold tier, no second (§16.3) | Games escalate hit stop to 333–500ms for death because a player has no undo (§3). We have undo; the escalation has nothing to buy |
| No sound (§16.6) | No web API can read macOS's own UI-sound switch or system mute `[D]`. Not a taste judgement — an app that cannot honour the platform switch should not make the noise |
| No screen shake, no particles (§16.6) | Whole-viewport vestibular motion with no published safe parameters `[?]`; the extension's `contain: layout paint` would clip it anyway `[D]`; and amplification is the thing CHI 2024 measured as *harmful* `[2°]` |
| No streaks, scores or losable state — reaffirmed, with the reason restated (§16.6) | Every published streak figure is a retention metric; no learning-outcome evidence exists in either direction `[?]`. The prohibition now records *why the evidence offered is the wrong evidence*, so it survives the next person who cites a +14% number |
| The monetization ladder is prohibited by name (§16.6) | A12 means there is no surface to protect today, which is exactly when to write it down. ROSCA and FTC §5 reach this conduct with or without a server `[2°]` |
| "Reduce the cost of the next action, never raise the price of staying" (§16.6) | §7. The source's timing instinct is correct and its beneficiary is not; this is the sentence that keeps the first half and refuses the second |
| Disclosure by the student's own data, not by a schedule (§17.1) | A8 (nothing opens with use) plus NN/g's own warning that past two levels usability drops `[V]`, and the absence of any measured study of staged feature reveal `[?]`. A blank page is honest; a locked page is a claim about the student |
| Two disclosure levels, hard cap (§17.2) | NN/g, the only sourced constraint available `[V]` |
| No tour, no coach marks (§17.3) | The one finding available says tutorial users rated the app *more complex* and were no more proficient `[2°]`; and A5 shows the product already teaches by constrained screens |
| Onboarding's failure path must say what will be empty (§17.3) | A5. It is the only place the existing onboarding breaks its own rule |

---

## 11 Open questions

Quarantined, not deleted. Each line says what would settle it.

1. **Is the 60fps WKWebView cap real on this build?** `app/src/dev/frameRate.ts` exists and is imported nowhere. Wire it behind a dev flag and read the p50. Everything in §15.7 downstream of the cap is reported, not measured `[?]`.
2. **Juul & Begy 2016** — "Good Feedback for Bad Players?" was cited in this run as finding that players rated juicy feedback higher while performing worse. Only the citation was recoverable. Settle it from the FDG/DiGRA 2016 proceedings; it is the one result that could complicate §16.3.
3. **Does the extension load `ui/motion.css` at all?** `dashboard.css:1` imports it, but the manifest's `web_accessible_resources` does not list it `[V]`. If Chrome blocks the nested import, every `var(--t-*)` on the stage is undefined and the extension silently has no motion. One load of the stage with devtools settles it.
4. **Does any WCAG auditor treat an action-carrying toast as a 2.2.1 time limit?** The Understanding text does not address toasts that carry an action `[?]`. Until then §16.2 assumes the stricter reading.
5. **Is there measured evidence that typed confirmation prevents accidental deletion?** None found `[?]`. Industry is unanimous, the literature is silent. If evidence appears that it only adds annoyance, §16.2's top rung should collapse into the recovery-window rung.
6. **What is Swink's actual text?** Both the six metric areas and the "feedback cycle under 100ms" threshold are `[2°]` from Wikipedia, a Gamedeveloper article and a course deck. Nobody read the book. Read it before any further citation.
7. **Smash Ultimate's hitlag formula** — ssbwiki's wording ties the flattened curve above 15f to spirits, ambiguously `[V]`. Immaterial to the spec; recorded so the §3 table is not over-trusted.
8. **Typical row counts** for Today and Week in real data are unknown `[?]`, and both render unbounded lists. It decides whether §15.5's stagger cap ever binds.
9. **DSA Art. 3's definition of "online platform"** was not read `[?]`. The conclusion that a local single-user tool is out of scope is `[D]`. Settle it before any hosted surface ships.
10. **Does the brief-day counter in `habit.py` survive its own rule?** It is exposure-only and never shames a gap, which is consistent with §16.6 as written `[D]` — but no one has tested how a student reads it after a two-week break. A worth-installing-pass question, not a research one.
