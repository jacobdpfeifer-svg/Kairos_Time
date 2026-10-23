# Motion research → the Kairos motion system

**Date:** 2026-10-23. **Outcome:** [`design-system/kairos/MASTER.md`](../../design-system/kairos/MASTER.md) §09 (summary) and §15 (the system).

Prompted by a video essay on animation in consumer tech ("five rules": spatial consistency, copy nature, use speed, add personality, know when not to animate). This document verifies those claims against primary sources, goes past them where they stop, audits what Kairos actually ships today, and lands a specification.

Every finding is tagged: **[V]** read in the cited source, **[2°]** from a secondary summary of a primary source, **[D]** derived by us from the math or the product's own constraints, **[?]** could not be verified — do not cite downstream.

---

## 0 Thesis

> **Paper is a fast medium with a slow settle.**

The video's second rule — "copy nature" — and its third — "but nature is slow, so don't" — are in tension only because "nature" is left vague. Pick the right piece of nature and the tension disappears. A pen touching paper is the fastest event in the physical world of a notebook: the mark is simply *there*, with no travel and no ramp. What is slow is everything secondary — ink drying into the fibers, a page bending back down, a highlighter's edge bleeding a fraction of a millimetre.

So Kairos's motion is **instant placement, quiet settle**. The thing the student asked for appears with zero ceremony. Only the consequences of it arriving are allowed to take time, and only once.

This is also, conveniently, what the restraint research says to do anyway. It gives the Notebook system a physical justification for being fast, rather than making speed a concession wrung out of an aesthetic that secretly wants to be slow.

Two corollaries fall straight out:

- **No bounce, anywhere, ever.** Paper does not overshoot. Ink does not spring back. The "add personality with bounce" advice is correct and does not apply to this product. Kairos's warmth is carried by handwriting, illustration and copy — the things a notebook actually has — not by elastic motion. This resolves the personality question without a dial.
- **Ink's slow part is a *settle*, not a *bloom*.** A long ease-out with a very flat tail is faithful; a slow ease-in-out ramp is not. The curve already in the tree, `cubic-bezier(.22,1,.36,1)` — easeOutQuint **[V]** — is almost exactly the "mark lands, then settles" shape. It was the right instinct, applied to too many things (§9 below).

---

## 1 The video's claims, checked

| Claim | Verdict | Source |
|---|---|---|
| Disney's 12 principles (1981) still underwrite UI motion | **True**, with a caveat. Slow-in/slow-out → easing, anticipation, follow-through/overlap, timing, staging, arcs all transfer. Appeal, solid drawing and straight-ahead-vs-pose-to-pose do not; the last is an authoring method, not a property of motion **[D]**. Authors are Frank Thomas and Ollie Johnston. | [12 principles](https://en.wikipedia.org/wiki/Twelve_basic_principles_of_animation) **[2°]** |
| "In 1993 researchers turned slow-in/slow-out into a customizable curve" | **Overstated.** Chang & Ungar, *Animation: From Cartoons to the User Interface* (UIST '93), argues for the *principle* — pacing the middle of a transition faster than its endpoints — plus solidity, motion blur, arrival and anticipation. It ships no curve. The curve arrived separately: Apple's Nov 2007 CSS Transitions proposal introduced `transition-timing-function` as a cubic Bézier with author-set control points; `ease` = `cubic-bezier(.25,.1,.25,1)`. Robert Penner's easing equations predate it (Flash MX, Oct 2002). | [Chang & Ungar](https://courses.ischool.berkeley.edu/i247/s08/readings/Chang_AnimationInUI_UIST93.pdf), [www-style 2007](https://lists.w3.org/Archives/Public/www-style/2007Nov/0090.html), [webkit.org/blog/138](https://webkit.org/blog/138/css-animation/), [Penner ch.7](https://fox-gieg.com/patches/flash/advice/penner_chapter7_tweening.pdf) **[V]** |
| Apple asks developers to draw the first frame within 400ms so the launch animation has pixels to show | **True, near-verbatim.** WWDC19 session 423: "rendering our first frame within 400 milliseconds. That's so that we have pixels displayed to the user during the launch animation." ~100ms is system-side, leaving ~300ms for the app. It is a session goal, not a formal HIG rule. The launch screen's documented purpose is to "enhance the perception of your experience as quick to launch" — latency masking, stated as such. | [WWDC19/423](https://developer.apple.com/videos/play/wwdc2019/423/) **[V]** |
| Liquid Glass is "squash and stretch" | **Wrong words, right idea.** The WWDC25 transcript never says squash or stretch. It says *lensing* ("dynamically bends, shapes, and concentrates light in real time"), "an inherent gel-like flexibility", and that it "responds to interaction by instantly flexing and energizing with light". It materializes by modulating lensing rather than fading. Reduce Motion "disables any elastic properties." | [WWDC25/219](https://developer.apple.com/videos/play/wwdc2025/219/) **[V]** |
| Android deliberately delays your touch ~5ms and predicts up to 80ms ahead | **Half true, and the mechanism is different.** AOSP `InputConsumer.cpp`: `RESAMPLE_LATENCY = 5ms`, and the sample time is `frameTime − 5ms`. That is a *resampling offset* to align touch samples to vsync, not an added input delay — the comment reads "reduces the impact of mispredicted touch positions". Prediction is capped at `RESAMPLE_MAX_PREDICTION = 8ms`, further capped at 50% of the last sample delta. The 80ms figure is not in the resampler; `android.view.MotionPredictor` is a separate, opt-in, app-level Kalman predictor with no documented horizon in ms. | [InputConsumer.cpp](https://android.googlesource.com/platform/frameworks/native/+/android-16.0.0_r2/libs/input/InputConsumer.cpp), [MotionPredictor](https://developer.android.com/reference/android/view/MotionPredictor) **[V]** |
| Wise added an animation and more people trusted and recommended it | **The animation is real; the measurement is not published.** Wise's own post gives the goals (make speed visible, reinforce the mental model, add delight), says it was built in After Effects and shipped via Lottie, and reports only qualitative testing. No trust, NPS or recommendation numbers exist in any primary source. A separately searched claim that *adding* time raised trust at Wise found no support at all. | [wise.com blog](https://wise.com/gb/blog/serious-products-dont-have-to-be-serious) **[V]** |
| Robinhood's confetti ended in a $7.5M Massachusetts settlement | **Overstated.** The Jan 18 2024 order is a $7.5M fine covering confetti, digital scratch tickets, free-stock rewards and other game-like features; its remedies bind **Massachusetts accounts**, and Robinhood had already removed confetti in 2021. Robinhood states the order makes no finding of violation. (mass.gov returned 403; quotes are trade-press secondhand.) | [ThinkAdvisor](https://thinkadvisor.com/2024/01/18/robinhood-to-pay-7-5m-over-gamification-practices) **[2°]** |
| TikTok/Reels built their own scroll physics engine for speed | **Unsupported.** No TikTok, Meta or YouTube engineering source says this. The claim traces to one uncredited Substack post. What is real and generic: pager-style snap (one page per fling, unlike a free-flinging list) and velocity-aware prefetch. | [search gap] **[?]** |
| Pokémon Red/Blue still waits ~30 frames and shakes the screen with animations off | **Confirmed in the disassembly.** `engine/battle/animations.asm`: `bit BIT_BATTLE_ANIMATION` → `.animationsDisabled` → `ld c, 30` / `call DelayFrames` (30 frames ≈ 0.5s at 59.7Hz) in place of `PlayAnimation`. **Both** paths then fall through to `PlayApplyingAttackAnimation` — "shake the screen or flash the pic in and out (to show damage)". | [pret/pokered](https://raw.githubusercontent.com/pret/pokered/master/engine/battle/animations.asm) **[V]** |
| A tool fakes a high-velocity trackpad swipe to skip macOS space-switching | **True.** InstantSpaceSwitcher: "create a synthetic trackpad gesture with an artificially high velocity. This effectively skips the animation." The *why* is not documented; the usual inference (gesture velocity sets the transition's completion time) is unconfirmed. Note also that Reduce Motion only swaps the slide for a fade — it does not give an instant switch. | [jurplel/InstantSpaceSwitcher](https://github.com/jurplel/InstantSpaceSwitcher) **[V]** |

**The one claim that matters most is the one that holds up best.** Emil Kowalski, in his own words: keyboard-initiated actions "should never be animated" because animation makes them feel "slow, delayed, and disconnected"; Raycast is "used hundreds of times a day", so it has no open animation, and that is "the optimal experience"; UI animations should generally stay under 300ms, and a 180ms dropdown "feels more responsive than a 400ms one"; ease-out is the right default because it "starts fast and slows down at the end". His delight example "works only because users rarely interact with it" **[V]**, [emilkowal.ski/ui/you-dont-need-animations](https://emilkowal.ski/ui/you-dont-need-animations).

Two attributions in circulation are **not** in his own posts and should not be cited to him: "ease-in-out for things already on screen" and "never ease-in for enter/exit". They appear only in third-party agent-skill summaries **[?]**. Both rules are defensible on their own merits; they are not his.

One more correction worth keeping: **the "Linear deliberately animates less than it doesn't" claim is unverified.** No Linear statement of an animation policy was found. What Linear *has* published is a local-first sync engine holding a full replica in IndexedDB, so reads are local [linear.app/blog/scaling-the-linear-sync-engine] **[V]**. Linear's perceived speed is architectural: there is no loading state to animate away. That is a more useful lesson for Kairos than a curve would be — and Kairos already has it, because the brain is local.

---

## 2 Curves

`ease`/`ease-in`/`ease-out`/`ease-in-out` are `(.25,.1,.25,1)`, `(.42,0,1,1)`, `(0,0,.58,1)`, `(.42,0,.58,1)` **[V]** ([CSS Easing 1](https://www.w3.org/TR/css-easing-1/)). The useful reference sets:

| System | Standard | Decelerate (enter) | Accelerate (exit) | Source |
|---|---|---|---|---|
| Material 1 (2014) | `.4,0,.2,1` | `0,0,.2,1` | `.4,0,1,1` | [m1.material.io](https://m1.material.io/motion/duration-easing.html) **[V]** |
| Material 3 | `.2,0,0,1` | `0,0,0,1` | `.3,0,1,1` | [MDC-Android Motion.md](https://github.com/material-components/material-components-android/blob/master/docs/theming/Motion.md) **[V]** |
| M3 emphasized | two-segment path | `.05,.7,.1,1` | `.3,0,.8,.15` | same **[V]** |
| Carbon productive | `.2,0,.38,.9` | `0,0,.38,.9` | `.2,0,1,.9` | [carbondesignsystem.com](https://carbondesignsystem.com/elements/motion/overview/) **[V]** |
| Carbon expressive | `.4,.14,.3,1` | `0,0,.3,1` | `.4,.14,1,1` | same **[V]** |
| Tailwind v4 | `.4,0,.2,1` | `0,0,.2,1` | `.4,0,1,1` | [tailwindcss.com](https://tailwindcss.com/docs/transition-timing-function) **[V]** |

Carbon's **productive vs expressive** split is the single most directly transferable idea here: the same system ships two curve families, productive for task flow and expressive for "significant or editorial moments" **[V]**. That maps cleanly onto Kairos's app-vs-landing divide.

The sharp-out family, for naming **[2°]** (from Penner / easings.net, not re-fetched):

| Name | Bézier |
|---|---|
| easeOutCubic | `.33,1,.68,1` |
| easeOutQuart | `.25,1,.5,1` |
| **easeOutQuint** | **`.22,1,.36,1`** |
| easeOutExpo | `.16,1,.3,1` |
| easeOutBack | `.34,1.56,.64,1` (overshoots; `y > 1`) |

**`cubic-bezier(.22,1,.36,1)`, the current `--ease` in the tree, is easeOutQuint.** 80% of the distance is covered in roughly the first third of the duration, then it crawls. That is the ink-lands-and-settles curve, and it is why Kairos already feels more like paper than its component list would predict. It is also why it is wrong on a 110ms button press — at that length the tail is 70ms of imperceptible crawl that delays the `transitionend`, and the press reads as mushy rather than sharp.

Apple does not publish the Béziers behind `UIView.AnimationCurve`; the reported `easeInOut` ≈ `.42,0,.58,1` is unverified **[?]**. No Linear or Vercel curve values were found **[?]**.

---

## 3 Durations

| Source | Values |
|---|---|
| **Material 1, desktop** | **150–200ms** **[V]** |
| Material 1, mobile | baseline 300 / full-screen 375 / enter 225 / exit 195ms; over 400ms "may feel too slow"; tablet ~+30%, wearable ~−30% **[V]** |
| Material 1, by size | large 300–400ms vs small 150–200ms **[V]** |
| Material 3 tokens | short 50/100/150/200 · medium 250/300/350/400 · long 450/500/550/600 · extra-long 700–1000ms **[V]** |
| Carbon | fast-01 70 (buttons, toggles) · fast-02 110 (fades) · moderate-01 150 (small expansion) · moderate-02 240 (toasts, expansion) · slow-01 400 (large expansion) · slow-02 700ms (background dimming) **[V]** |
| NN/g | ~100ms simple feedback; 100–400ms typical; 200–300ms modal entrance; ≤400ms large movement; **>500ms feels cumbersome**; enter slightly longer than exit (e.g. 300 in / 200–250 out); frequent animations shorter **[V]** |
| NN/g response limits | 0.1s = instantaneous · 1s = flow of thought preserved · 10s = limit of attention (Miller 1968, Card 1991) **[V]** |
| Kowalski | generally **under 300ms**; 180 beats 400 **[V]** |
| Aerotwist | ~100ms window after input in which work goes unnoticed; 60fps = 16.7ms/frame **[V]** |
| Superhuman | every interaction under 100ms, target under 50ms — a *response* budget, not an animation length **[V]** ([blog](https://blog.superhuman.com/superhuman-is-built-for-speed/)) |

**Material's old distance-scaled duration formula could not be found [?]**; the only size-scaling guidance that survives is Material 1's two-tier 150–200 / 300–400 split and NN/g's qualitative "longer for large movements".

Two numbers everyone converges on: **~150–200ms for anything on a desktop-sized surface**, and **a hard ceiling around 300ms** for anything repeated. Kairos's current `--motion-sheet: 240ms` and `--motion-settle: 200ms` are already inside that. `--motion-reveal: 320ms` (the ⌘K palette) is not — and ⌘K is the single most keyboard-initiated surface in the product, so per the rule above it should animate not less but *not at all*.

---

## 4 Springs — and why Kairos does not get one

| System | Parameters | Notes |
|---|---|---|
| Material 3 spatial | stiffness/damping: fast 1400/0.9 · default **700/0.9** · slow 300/0.9 | damping < 1, so M3 spatial motion overshoots slightly **[V]** |
| Material 3 effects | fast 3800/1.0 · default 1600/1.0 · slow 800/1.0 | damping = 1, so color and opacity never overshoot **[V]** |
| M3 Expressive (2025) | default stiffness ~380, damping 0.73–0.8 (sources disagree) | verify against Android `MotionTokens` before quoting **[?]** |
| Compose | dampingRatio High/Medium/Low/No-Bouncy = 0.2/0.5/0.75/1.0; stiffness 10000/3000/1500(default)/400/200/50 | **[2°]** |
| SwiftUI | `Spring(duration:bounce:)`; bounce −1…1, 0 = critically damped, ~0.15 slightly, ~0.3 noticeably; Apple advises against > ~0.4 for UI. Presets `.smooth`/`.snappy`/`.bouncy`; exact internals unpublished | **[V]** ([WWDC23 notes](https://wwdcnotes.com/documentation/wwdc23-10158-animate-with-springs/)) |
| Framer Motion | stiffness, damping, mass, velocity, restSpeed 0.1, restDelta 0.01; or duration + bounce; physics overrides time | **[V]** ([motion.dev](https://motion.dev/docs/spring)) |

The maths, for the record **[D]**: `ω₀ = √(k/m)`, `ζ = c/(2√(km))`, Apple-style `response = 2π/ω₀`, overshoot `= exp(−πζ/√(1−ζ²))`, 2% settling time `≈ 4/(ζω₀)`.

| ζ | Overshoot | Reads as |
|---|---|---|
| ≥ 1.0 | 0% | nothing |
| 0.9 | 0.15% | imperceptible |
| 0.8 | 1.5% | barely there |
| 0.73 | 3.5% | one subtle overshoot |
| 0.6 | 9.5% | visible |
| 0.5 | 16.3% | bouncy |

**Conclusion: Kairos ships no springs.** The only property a spring buys that a Bézier cannot is velocity-preserving retargeting (§5), and Kairos has no continuous drag gesture that needs it. Every spring at a damping ratio paper could justify (ζ ≥ 0.9, overshoot ≤ 0.15%) is visually indistinguishable from easeOutQuint, at the cost of a runtime, a token vocabulary and a per-frame JS loop inside a WebView capped at 60Hz (§7). If a drag-to-defer gesture is ever built, revisit this with `ζ = 1.0` and no bounce — never as a style choice, only to carry gesture velocity.

A spring can be shipped in pure CSS via `linear()` with ~30–50 sampled points (Chrome 113, Safari 17.2, Firefox 112 **[?]** — versions unverified), but a `linear()` spring cannot carry velocity, so it buys the look and none of the benefit. The `spring()` CSS function has been open as [csswg-drafts#280](https://github.com/w3c/csswg-drafts/issues/280) since 2016 and is shipped nowhere.

---

## 5 Interruptibility

Kowalski's point in the interview is the one structural idea in the video that Kairos does not currently honour anywhere: "all of the things that animate on iOS, you can retarget as they are animating."

Why duration-based animation breaks on interruption **[D]**: a restarted tween begins from the current value with a *fresh* duration and *zero* velocity — the element stops dead, then re-accelerates — and if the remaining distance is now shorter, it still takes the full duration. A spring keeps position and velocity as state and only swaps its target. Apple states a retargeted spring "uses the velocity it had when it was retargeted" **[V]**; Compose keeps velocity continuous across a target change **[V]**; Framer Motion's `velocity` defaults to the value's current velocity **[V]**.

For Kairos the practical consequences are narrower than the general theory, and all three are achievable without a spring:

1. **A CSS transition is already interruptible** — it retargets from the current computed value. The failure mode is CSS *animations* (`@keyframes`), which restart. Kairos uses `@keyframes` for `nb-settle`, `nb-sheet-in`, `palette-reveal`, `rise-in` and four near-identical `*-settle` variants (§9). Every one of those is a one-shot entrance that cannot currently be interrupted or reversed.
2. **An exit must be able to cancel an enter.** A sheet dismissed 80ms into a 260ms rise should reverse from where it is, not jump to open and then close. For a symmetric tween, `animation.playbackRate = -1` on a WAAPI animation does this; `playbackRate` only scales time and preserves no velocity, which is fine because there is none to preserve.
3. **Never block input on an animation.** The row the student clicked must be actionable during its own settle. Nothing in Kairos should gate interaction on `transitionend`.

---

## 6 Spatial consistency, and where the video over-applies it

The video's first rule is its strongest and its most dangerous. "Apps live on the right" works because a phone home screen has exactly one hierarchy and one gesture vocabulary. A desktop app with a persistent sidebar does not.

Material's own pattern-selection rule: **shared axis** is for elements that are spatially or navigationally related — steps, forward-and-back, true hierarchy. **Fade-through** is for destinations with *no* strong relationship, such as bottom-nav tabs **[2°]** ([motion system](https://material.io/design/motion/the-motion-system.html)).

Today · Week · Courses · Study · Advisor are **peers**. They have no order. A directional slide between them would assert a left-to-right sequence the sidebar does not have, and would be wrong in both directions half the time — exactly the failure the video demonstrates on purpose at 0:54 and then fails to generalise. Worse, it would be the most frequently triggered animation in the product, on a surface reached by ⌘K, so it fails the frequency test too.

**The sidebar's moving selection *is* the spatial cue.** The content area does not need one. Restrained desktop apps are reported to swap sibling views essentially instantly **[?]** (unverified for Linear, Things, Mail, Xcode specifically).

Where Kairos *does* have real hierarchy — Courses → a course → an assignment; Week → the plan sheet; Study → a session — motion should carry it, because there the direction is true and the return gesture is unambiguous.

The overlay vocabulary follows the same logic. Motion's job is to teach *where a thing lives*, so each overlay type needs a distinct and honest origin **[D]**:

| Overlay | Origin | Why |
|---|---|---|
| ⌘K command bar | none — appears | It has no home. It is summoned, by keyboard, hundreds of times. Zero animation. |
| Ask sheet | bottom edge | It lives below the page and does not replace it; MASTER §10 requires it never hide the focus block. |
| Item sheet / dialog | centre, in place | A distinct object, not a place. |
| Popover / row menu | its trigger | `transform-origin` on the element that opened it. |
| Extension side panel | its own edge | It lives at the side of the Canvas page. |
| Undo toast | bottom-centre | Already specified; it is a status, not a place. |

Exits mirror entries and run shorter.

Obsidian is the cautionary case: users ask to disable sidebar animation outright, saying it is uncomfortable when the sidebar is opened **by hotkey**, and pass round a one-line CSS override **[2°]** ([forum](https://forum.obsidian.md/t/option-to-turning-off-the-sidebar-animation/44462)). Bear and Anytype users separately complain about panels that push or squish content. A panel toggle should overlay rather than reflow, and should be instant.

---

## 7 Platform reality: the 60Hz ceiling

This is the constraint that most changes what Kairos should attempt, and it is the research finding with the most direct engineering consequence.

- **A Tauri WKWebView on macOS is capped at 60fps.** Safari reaches 120Hz on ProMotion only when the internal flag "Prefer Page Rendering Updates Near 60fps" is off; that flag **does not apply to embedders**, so WKWebView stays at 60. [WebKit bug 294338](https://bugs.webkit.org/show_bug.cgi?id=294338) is an open, unassigned feature request to change this (last modified 2026-09-17) **[V]**. WebKit's stated position is that pages should expect rAF at 60Hz [bug 236780] **[V]**. An [Apple Forums thread](https://developer.apple.com/forums/thread/773222) reports the same for rAF, with a filed feedback and no answer **[V]**. Reported private-API workarounds in Capacitor/Tauri plugins are unconfirmed on macOS **[?]**.
- Therefore: **8.3ms budgets are fiction here; 16.7ms is the budget.** Never step motion by frame count — always by timestamp. Design nothing whose quality depends on 120Hz. A 200ms animation takes 200ms at either rate; 120Hz only adds frames **[D]**.
- **Compositor-accelerated in WebKit: `transform` and `opacity`.** `filter` and `backdrop-filter` can be accelerated but are expensive. `box-shadow`, `background-size`, `background-position`, `clip-path` and all layout properties repaint every frame. SVG `stroke-dashoffset` repaints the SVG each frame **[2°]**.
- **`will-change` is a compositing trigger in WebKit** when it names transform, opacity, filter or backdrop-filter ([r188530](https://trac.webkit.org/r188530)) **[V]**. Each one creates a real layer, so overuse causes layer explosion. Add it immediately before an animation and remove it after.
- **`backdrop-filter` forces extra rendering passes** and should be used only where needed, per WebKit's own introduction post **[V]** ([webkit.org/blog/3632](https://webkit.org/blog/3632/introducing-backdrop-filters/)); Chromium's intent-to-ship calls it computationally intensive **[V]**. There is also an open Safari 18.6 bug where `backdrop-filter` breaks when its value comes from a CSS variable ([bug 297620](https://bugs.webkit.org/show_bug.cgi?id=297620)) **[V]**. Kairos forbids glass anyway (MASTER §13) — and two `backdrop-filter` rules are nevertheless still in the tree (§9).
- **Text re-rasterises on layer promotion**, and can shift between grayscale and subpixel antialiasing or snap at the end of a transform **[2°]**. This matters for a type-led system: do not animate `transform` on a container of prose unless the layer is promoted for the whole interaction.
- **First-paint flash:** wry 0.54.2 added macOS `background_color` (disables `drawsBackground`, sets `underPageBackgroundColor` on macOS 12+, behind the `transparent` feature) **[V]**; [tauri#1564](https://github.com/tauri-apps/tauri/issues/1564) is the underlying request, where the suggested workaround is creating the window with `visible: false` and showing it after first render **[V]**. Also set the `<html>` background inline in `<head>` so the first frame paints the Notebook near-white before the stylesheet lands **[D]**.
- **rAF is not run in background tabs** in Chrome ([Chromium blog](https://blog.chromium.org/2011/03/getting-smoother-animated-web-content.html)) **[V]**, Safari throttles rAF in cross-origin iframes **[V]**, and continuous rAF polling costs battery ([WebKit bug 159597](https://bugs.webkit.org/show_bug.cgi?id=159597)) **[V]**. No sourced energy figures for macOS were found **[?]**.
- **Extension:** Shadow DOM scopes injected CSS so the host page cannot break it **[2°]**; add `contain: layout paint` on the injected root and animate only transform/opacity so the Canvas page is never forced into layout **[D]**. Never read host-element layout inside an animation loop. The MV3 service worker can terminate after ~30s idle **[2°]**, so animation state must live in the content script or side panel, never the worker. `prefers-reduced-motion` should work in content scripts, shadow roots and the side panel because it follows the OS setting — **unverified in the actual extension [?]**, worth a one-line check.
- **Measurement:** LoAF (Long Animation Frames) is Chrome/Edge 123+ and unsupported in Safari **[V]** — so it is available for the extension and not for the app. For the app, Web Inspector's Timelines and Layers tabs (debug builds have devtools), plus a `performance.now()` delta histogram in a rAF loop **[2°]**.

---

## 8 Not animating, honestly

### 8.1 The frequency test

The decision rule is **frequency**, not importance, and it is the one the video gets most right. Kowalski: judge an animation by how often the user sees it; a thing seen hundreds of times a day should have none; his own delight animation "works only because users rarely interact with it" **[V]**.

An animation teaches. A thing that has finished teaching is only a delay. Formally, for Kairos: **if a student will see it more than ~20 times in a term, it may not travel.**

### 8.2 Reduce, don't remove

`prefers-reduced-motion: reduce` means the user "prefers an interface that **removes or replaces** the types of motion-based animation" — replacement is sanctioned in the normative text **[V]** ([MQ5 §12.1](https://www.w3.org/TR/mediaqueries-5/)). WebKit's guidance is that removing an essential animation "may make the interface confusing or unusable", and that one should "display another visual indicator to convey the intended meaning" **[V]** ([Responsive Design for Motion](https://webkit.org/blog/7551/responsive-design-for-motion/)). Apple's own behaviour: "Screen transitions and effects use the dissolve effect instead of zoom or slide effects" **[V]** ([support.apple.com](https://support.apple.com/en-us/HT202655)). Val Head's survey of real implementations found large entrance movement replaced by opacity fades, confetti dropped, and small hover movement, opacity fades and colour transitions left alone **[V]** ([valhead.com](https://valhead.com/2020/05/09/reduced-motion-in-the-wild/)).

So the correct mapping is **travel → 0, opacity → kept**. Kairos currently does `animation: none` in about ten hand-written places (§9), which both removes rather than replaces and is unmaintainable.

Two implementation traps: `animation: none` and `transition: none` **stop `animationend`/`transitionend` from firing**, hanging any code waiting on them — a real reported bug **[2°]** — and `0` can suppress the event too, so the idiom is `0.01ms`, not `0` **[2°]**.

### 8.3 What the standards actually require

| SC | Level | Requirement |
|---|---|---|
| **2.2.2** Pause, Stop, Hide | A | Moving/blinking/scrolling info that starts automatically **and lasts > 5s**, shown with other content, needs a pause/stop/hide mechanism unless essential. Intent: people with attention deficits find moving content hard to ignore. **[V]** |
| **2.3.3** Animation from Interactions | AAA | Motion animation triggered by interaction can be disabled unless essential. Excludes changes of colour or opacity that do not change perceived size, shape or position — an erratum removed blur from that exclusion. Techniques C39, SCR40. **[V]** |
| **2.3.1** Three Flashes | A | Nothing flashes > 3×/second, or stays under the flash thresholds; area threshold 0.006 steradians (~341×256px, 87,296 CSS px on the reference display). Applies to decorative content too. **[V]** |

Kairos targets WCAG AA (MASTER §14), so 2.3.3 is above its bar — and the product should meet it anyway, because it already ships a `data-motion` switch. The relevant live violation is **2.2.2**: `handoff-scene 12s infinite` on the landing page is an auto-starting animation lasting well over 5s alongside other content, with no pause control (§9).

### 8.4 Vestibular triggers

WebKit names the specific triggers: **scaling/zooming** ("give the illusion that the viewer is moving forward or backward"), blur doing the same, parallax and multi-speed/multi-direction movement, spiralling or spinning, 2D planes moved in 3D space, and horizontal movement in the peripheral field **[V]**. The A11y Project adds autostarting animation, sliders and video **[V]**. Generally safe: opacity, colour, and small-distance movement.

Prevalence is widely misquoted. Real figures: ~35% of US adults 40+ have experienced *some* form of vestibular dysfunction (vestibular.org, via A11y Project) — that is all dysfunction, not web-animation sensitivity **[2°]**; motion sensitivity with motion-sickness bouts in ~two-thirds of migraine patients ([PMC5999734](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC5999734/)) **[2°]**; MdDS true prevalence unknown, ~1.3% of neurotology patients diagnosed per year, ~85% women ([PMC5950831](https://pmc.ncbi.nlm.nih.gov/articles/PMC5950831)) **[2°]**. **No quantified travel-distance or screen-area threshold for UI motion exists in any source found [?]** — the 25%-of-viewport guidance below is engineering judgement, not a clinical limit. The circulating "28% of iOS 7 users" figure is a poll, not a study **[?]**.

### 8.5 Distraction, learning, and the 11pm student

This is where we wanted evidence and largely did not get it. Stated plainly so it is not over-claimed later:

- **COGA** (W3C *Making Content Usable*) states "I need tasks to not have distractions", that users should be able to turn distractions off, and that "controls and content do not move unexpectedly". It names "people under a temporary stress" as a benefiting population **[V]** ([w3.org/TR/coga-usable](https://www.w3.org/TR/coga-usable/)).
- **Tversky, Morrison & Bétrancourt (2002)**, *Animation: can it facilitate?* — animations are often too complex or too fast to be perceived accurately; in fair comparisons against static sequences, animation mostly does not win. It does suggest animation may help with real-time reorientation in time and space, which is precisely what a UI transition is **[2°]** ([Stanford PDF](https://hci.stanford.edu/courses/cs448b/papers/Tversky_AnimationFacilitate_IJHCS02.pdf)).
- **Seductive details / coherence:** negative but contested and modest. Rey 2012 ~d = −0.30 recall / −0.48 transfer; Sundararajan & Adesope 2020 g = −0.33 over 42 studies; a newer 50-study meta-analysis finds only g = −0.16, arguing earlier ones mistreated non-independent effect sizes **[2°]**. Argue from direction and mechanism, not effect size.
- **ADHD:** one n=12 study found dynamic visual elements and sound effects add potential distraction **[2°]** ([FocusView](https://arxiv.org/html/2507.13309v1)).
- **There is no study linking animation to outcomes for stressed or anxious users [?].** The "decorative motion is worse at 11pm the night before an exam" intuition rests on COGA plus WCAG 2.2.2's rationale, and nothing stronger. It is still the right default for a study tool — but it is a design position, not a finding, and MASTER should not imply otherwise.

### 8.6 Honesty about waiting — the rule Kairos cannot bend

This is where the video's most seductive advice collides hardest with what Kairos is.

- **Harrison et al.** showed progress-bar *behaviour* changes perceived duration: pulsing faster reads as shorter, ribbing moving backwards against progress reads as faster (UIST 2007, pp. 115–118 — not CHI; and CHI 2010 "Faster Progress Bars", Best Paper Honourable Mention). Effect sizes could not be retrieved; the circulating "11%" is unverified **[2°]** ([chrisharrison.net](https://chrisharrison.net/index.php/Research/ProgressBars2)).
- **Buell & Norton, *The Labor Illusion*** (Management Science 57(9), 2011): across five experiments in travel search and online dating, people can prefer a slower site that shows work being done over an instant one with identical results; perceived effort produces reciprocity, which mediates the effect. The commonly cited "60% preferred waiting" could not be verified. A secondary summary reports the effect **amplifies existing opinion — helping for good matches and backfiring for poor ones** — and shrinking when the wait is long or the effort looks pointless **[2°]** ([abstract](https://ideas.repec.org/a/inm/ormnsc/v57y2011i9p1564-1579.html)).
- **Skeleton screens are not a free win.** Viget's 136-participant test found skeletons felt *longest*: 2.82s vs 2.41s for a spinner and 2.29s for a blank screen, attributing it to novelty drawing attention; they work best in familiar interfaces and for very short waits **[2°]** ([viget.com](https://www.viget.com/articles/a-bone-to-pick-with-skeleton-screens)). Another paper found the opposite on perceived speed. The evidence is mixed; circulating "30% faster" figures have no traceable source **[?]**.
- **Regulatory edge:** the FTC's 2022 staff report *Bringing Dark Patterns to Light* lists false urgency, including fake countdowns, as deceptive design **[2°]**.

**The product constraint settles it.** Kairos's entire proposition is grade truth: a consequence sentence that says "Skip it: 84% → 79% in Calc", computed and never invented, and omitted rather than guessed (MASTER §06). A product that is scrupulous about not inventing a percentage cannot invent a wait. The labor illusion is a real effect that Kairos is **not permitted to use**, and that prohibition should be written down rather than left to taste — because the research says it works, which is exactly why someone will propose it later.

Operationally **[D]**: show nothing under ~300ms; past that, a determinate indicator only when the work is genuinely countable, otherwise one plain honest line; never pad, never fake steps, never animate a step that did not happen. A sync that finished in 40ms is allowed to look instantaneous even if that makes the work look easy.

### 8.7 Streaming and agent motion

- **Smooth streaming** as shipped by LibreChat: newly streamed words fade in as a visual-only layer; it does **not** delay delivery, skips code, math and citations, replays nothing on reconnect, and is disabled under `prefers-reduced-motion` **[V]** ([librechat.ai](https://www.librechat.ai/docs/features/smooth_streaming)). The Upstash approach decouples network chunks from a visible buffer revealed at a steady pace via rAF, because raw chunks arrive in bursts **[2°]** ([upstash.com](https://upstash.com/blog/smooth-streaming)).
- **No study was found on whether per-token fade helps or hurts reading speed [?].** The defensible claim is only that *steady pacing beats bursty chunks*. So: smooth the pace, do not fade each token.
- **Shimmer** on a "Thinking" label is a widespread convention **[?]** and is dishonest when the result arrives in under ~300ms. Nothing, then a static label, then real step disclosure.
- **Confidence display:** Zhang, Liao & Bellamy (FAT* 2020) found confidence scores helped *calibrate* trust, but calibration alone did not improve joint decision performance, and local explanations were problematic **[V]** ([arXiv 2001.02114](https://arxiv.org/abs/2001.02114)). A 2025 study found users overestimate LLM accuracy when given default explanations **[2°]**. **No evidence that motion calibrates trust [?]** — so provenance (real Canvas data vs model inference) is carried by typography and labelling, never by motion. Motion is reserved for the state change, e.g. a sync that just landed.
- **Accept/decline:** no sourced prior art was obtained **[?]**. The existing MASTER rule — an accepted suggestion never moves afterward — is the right one on first principles: layout shift immediately after a commit destroys the spatial memory of the action the student just took, and makes them re-find their own work. Confirm in place; reorder only on the next navigation.

### 8.8 Voice presence

Siri dropped the orb in iOS 18.1+ for a screen-edge glow originating at the side button or the bottom **[2°]** ([slashgear](https://www.slashgear.com/1865686/iphone-glowing-around-edges-reason/)). Nothing was gathered on ChatGPT/Gemini/Alexa signal mappings or on the abstract-vs-anthropomorphic question **[?]**.

What is defensible for the ink ring **[D]**: map mic RMS to amplitude with an asymmetric envelope — **attack 30–60ms, release 150–250ms** — because a fast attack makes the ring feel responsive while a slow release stops it flickering on speech gaps. Use TTS output level when speaking, a slow distinct breathing state for thinking, and small phase drift so it is alive without being periodic. Avoid paired marks and avoid any symmetry that reads as a face.

---

## 9 What Kairos ships today

Audited 2026-10-23 against `app/src`, `app/extension-chrome`, `landing/`.

**Tokens** (`app/src/styles.css:100`): one curve, `--ease: cubic-bezier(.22,1,.36,1)` (easeOutQuint), applied to everything from a 110ms press to a 600ms draw-on; ten duration tokens (`--motion-press` 110, `-chrome` 140, `-settle` 200, `-sheet` 240, `-reveal` 320, `-draw` 600, `-commit` 110, `-pulse` 1800, `-showcase` 600).

| # | Finding | Where |
|---|---|---|
| M1 | **One curve for every job.** No exit curve, no ease-in-out for already-on-screen movement, no distance tiering. easeOutQuint's long flat tail is wrong on a 110ms press. | `app/src/styles.css:100` |
| M2 | **Tokens forked three ways.** The extension redefines `--motion-settle/-commit/-chrome` locally and then uses bare `ease-out`, not `--ease`; the panel redefines `--ease`; the landing page defines `--ease` only and hard-codes 110/400/600/700ms. Already diverging. | `extension-chrome/ui/dashboard.css:41`, `extension-chrome/panel.css:37`, `landing/styles.css:43` |
| M3 | **Reduced motion is hand-written ~10×**, each time duplicated for both `prefers-reduced-motion: reduce` and `:root[data-motion="reduced"]`, and it *removes* rather than *replaces*. Every new animation needs two more blocks and one will be forgotten. | `notebook.css:511,519,649,652,875,880,980,996,1223,1228,1950,1953,2625` |
| M4 | **An idle loop ships, against §09 and WCAG 2.2.2.** `animation: handoff-scene 12s var(--ease) infinite` — auto-starting, >5s, alongside other content, no pause control. | `notebook.css:905` |
| M5 | **Glass is still in the tree, against §13.** Two live `backdrop-filter: blur()` rules. | `spatial.css:557`, `styles.css:223` |
| M6 | **Legacy system still imported.** `spatial.css` (1,493 lines, the superseded Spatial Instrument) is imported after `notebook.css` and carries its own `--ease-out` usages, a duplicate `skeleton-pulse`, and `palette-reveal`. | `main.tsx:7` |
| M7 | **⌘K animates.** `palette-reveal` at `--motion-reveal` (320ms) — the most keyboard-initiated surface in the product, above the 300ms ceiling, on an action the student initiated and whose outcome they already know. | `spatial.css:564` |
| M8 | **Four near-duplicate settle keyframes** (`nb-settle`, `pn-settle`, `solare-settle`, `studio-settle`) plus `rise-in`, and 13 keyframes total. | across all CSS |
| M9 | **All entrances are `@keyframes`, so none can be interrupted or reversed.** An exit cannot cancel an enter. | `notebook.css:818,1166,1938` |
| M10 | **No motion at all on the product's real state changes** — suggestion accepted, row deferred, row moved between piles, capture parse appearing, grade or consequence changing, sync landing new data, exam-week mode collapsing, semester-line ticks. These are exactly the moments §09 says motion is *for*, and they are silent. | — |
| M11 | **No transition between top-level views**, which is correct (§6) but undocumented, so someone will add one. | — |
| M12 | **InkRing** caps DPR at 2 and checks both reduced-motion signals (good), but never pauses on `document.hidden`, never re-reads DPR on a display change, and draws every frame even when the level is flat. | `voice/InkRing.tsx:77,149` |

The honest summary: the *taste* is right and the *curve* is right, but there is one curve doing nine jobs, the reduced-motion story is manual, and motion is spent on decoration (a 12s landing loop, a ⌘K reveal) while the product's actual state changes — the things only Kairos knows — happen in silence. That inversion is the finding.

---

## 10 What is specified, and why

See MASTER §15. The reasoning behind each decision, in one line each:

- **Four curves, not one.** `--ease-mark` (easeOutQuint, kept — ink lands and settles), `--ease-press` (sharp, short, no tail), `--ease-move` (ease-in-out, for things already on screen), `--ease-lift` (accelerate, for exits). Kowalski's ease-out default, Carbon's productive family, Material's enter/exit split.
- **Five durations tiered by distance, not by component**, ceiling 300ms outside the once-only draw. Material 1 desktop 150–200ms, Kowalski's 300ms, NN/g's 500ms cliff.
- **`--travel-*` tokens separate from durations**, so reduced motion sets travel to 0 and keeps the cross-fade. MQ5's "removes or replaces", WebKit, Apple's dissolve, Val Head's survey.
- **`0.01ms`, never `0` or `none`**, so `transitionend` keeps firing.
- **No springs, no bounce, no overshoot.** Paper does not overshoot; every spring at ζ ≥ 0.9 is indistinguishable from easeOutQuint and costs a runtime in a 60Hz WebView.
- **Peer views do not travel; hierarchy does.** Material's shared-axis-vs-fade-through rule.
- **⌘K and every keyboard-initiated surface open with zero animation.** Kowalski, verbatim and primary.
- **The frequency test (>20×/term ⇒ no travel) is the written decision rule**, so "should this animate?" has an answer that is not taste.
- **`transform`/`opacity` only; 16.7ms budget; no frame counting.** The WKWebView 60Hz cap and WebKit's compositor list.
- **No padded waits, no fake progress, no labor illusion** — stated as a prohibition precisely because the research shows it works.
- **Motion is moved onto real state changes** and off decoration, which is what §09 always said and the code does not do.
- **Motion is not generative** (§15.6). The workspace compiler's closed patch-op set already *is* the motion vocabulary, one-to-one with §15.3 — but no duration, curve, travel or delay may enter the spec, because motion is accessibility- and performance-load-bearing and a model-chosen curve is invisible in the diff the student accepts. The live build keeps its 220ms pacing, exempt from the stagger cap, because it is paced by narration; it stays on the honest side of §15.4 only because the artifact is already complete, the reveal is skippable, and nothing claims work is in progress.

## 11 Open questions

Worth resolving before the spec hardens further; none blocks implementation.

1. Does `prefers-reduced-motion` actually reach the extension's content script and side panel? One-line check, currently assumed.
2. Is the 60Hz WKWebView cap real on this machine's Tauri build? **Resolved into a plan rather than left open** (MASTER §15.7): measure first with `app/src/dev/frameRate.ts`, which prints the rAF interval histogram; private-API workarounds and waiting for the upstream fix are rejected; native AppKit motion is the escape hatch if a drag gesture ever becomes core; Electron or a SwiftUI shell are known and rejected. The cap constrains nothing §15 specifies. The two real exposures are scroll smoothness on a 120Hz machine and any future direct-manipulation drag.
3. Material 3 Expressive's spring tokens disagree across sources; irrelevant while Kairos ships no springs, relevant if a drag gesture is ever built.
4. No quantified travel-distance or viewport-area threshold for vestibular safety exists. The 25% figure in §15 is engineering judgement and should be labelled as such wherever it is repeated.
5. Harrison's effect sizes, Viget's primary numbers and Buell & Norton's full text were not retrieved. They are cited here for direction only.
6. Whether the landing page should keep an expressive curve family at all (Carbon's split says yes; MASTER's "same tokens everywhere" says no). Currently resolved in favour of one family with a longer duration tier on landing only.
