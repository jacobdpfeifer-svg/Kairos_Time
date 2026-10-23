# Kairos — Notebook design system

**Source of truth for visual craft** across the desktop app (`app/src`), the Chrome extension (`app/extension-chrome`), and the marketing site (`landing/`). Adopted 2026-10-07 (structure amended 2026-10-13 from [`docs/research/saas-themes-applied-to-kairos-2026-10-13.md`](../../docs/research/saas-themes-applied-to-kairos-2026-10-13.md)) from the three-direction exploration of 2026-10-07 (the owner picked `c-notebook.html`; the three prototypes were removed from the tree once the system was written down, and stay readable at `git show fe7026e:design-system/explorations/2026-10-07/c-notebook.html`). It replaces the Living Instrument / Spatial Instrument systems; where an older doc disagrees with this one, this one wins.

## 01 Direction

Kairos should feel like **a friend's really good notes**: a clean page, one highlighter, a few handwritten arrows pointing at what matters. Warm and friendly like Duolingo, calm and quiet like Things. Never sharp, technical, dark-dashboard, or "AI product".

Three ideas carry the whole system:

1. **The page.** Content sits on near-white paper with hairline rules. Hierarchy comes from type weight and size, not from boxes, shadows, or glass.
2. **The highlighter.** Exactly one brand color, `--hl` yellow. It marks the single most important thing on a screen: a phrase in a headline, today's focus block, the primary button's shadow. If two things are highlighted, neither is.
3. **The margin.** Handwritten blue notes (Caveat, `--pen`) explain the product the way a classmate would ("this one moved!", "taller = worth more"). They live in the margins, point with drawn arrows, and draw themselves in once.

Personality beyond that comes from **what students would rather be doing**: hand-drawn outdoor scenes and activities (climbing, skiing, surfing, a hike, a concert). There is **no mascot**. The only animated "presence" is the voice presence (§08), and it is abstract.

## 02 Principles

- **Show, don't tell.** Real course names, real dates, real grades on every surface, including marketing. No lorem ipsum, no feature lists where a screenshot would do.
- **One subject per screen.** Decide what the student should do next; make it the largest thing. Everything else is a quiet list.
- **Lists, not card grids.** Rows separated by 1px hairlines. A sheet (white, hairline border) only when content is a distinct object: a dialog, the focus block, a preview.
- **Course colors are data.** Each course has one color, used for its tag, its ticks on the semester line, and nothing decorative.
- **Plain words.** Sentence case everywhere. No uppercase eyebrow labels, no numbered `01 / 02` indexes, no middle-dot metadata chains. Write "Thu, Oct 9 at 11:59 PM", not "Oct 9 · 11:59 PM MDT (America/Denver)".
- **Honest states.** Empty, loading, and error states are designed and written as plainly as the happy path ("Couldn't reach your study notes. Try again.").

## 03 Color

```css
/* Notebook (light, default)  [data-theme="paper"] */
--bg:        #fbfbfa;   /* the desk */
--sheet:     #ffffff;   /* the page */
--sheet-2:   #f7f7f5;   /* sidebar, quiet wells */
--fg:        #1d1d1f;   /* ink */
--muted:     #66666b;   /* pencil */
--hairline:  #e9e9e7;
--hl:        #ffe14d;   /* highlighter: the one brand color */
--hl-soft:   #fff4b3;   /* focus block, selected row */
--hl-ink:    #4a3f00;   /* text on --hl-soft */
--pen:       #2f5bea;   /* margin handwriting + focus ring only */
--danger:    #c8432b;
--success:   #2f8f5b;

/* Night notebook  [data-theme="night"]: same roles on a dark page */
--bg: #161618; --sheet: #1e1e21; --sheet-2: #1a1a1d; --fg: #f1f1ed; --muted: #a2a29e;
--hairline: #2e2e32; --hl: #ffe14d; --hl-soft: #3a3412; --hl-ink: #ffe98a; --pen: #8fb0ff;

/* High contrast  [data-theme="contrast"]: #000/#fff, 2px rules, --hl stays, no shadows */
```

Rules:

- `--hl` never carries text directly on white UI except as a marker swipe *behind* ink. Text on `--hl-soft` uses `--hl-ink`.
- `--pen` is for handwriting and the focus ring. It is not a link or button color.
- Links are ink with a 1px underline; hover thickens the underline.
- Course palette (assigned by sync, `inbox/courses/colors.json`): `#4a8fe7 #3fb07c #ef6a4c #9a7ae0 #e5a422 #2fb3b8 #d4579a #7c8a99`. Tags render as `color-mix(in srgb, <course> 14%, white)` with text `color-mix(in srgb, <course> 70%, black)`.
- No gradients on UI, no glow, no glass, no pure `#000`/`#fff` text pairs outside high contrast.

## 04 Type

| Role | Face | Size / leading / weight |
|---|---|---|
| Display (scene title, hero) | Gabarito | 40–76px / 1.02 / 800, tracking −0.035em |
| Heading | Gabarito | 22–30px / 1.1 / 800, tracking −0.02em |
| UI | Gabarito | 15–16px / 1.35 / 500–600 |
| Prose (study) | Gabarito | 17–19px / 1.6 / 500, 45–70ch |
| Meta | Gabarito | 13–14px / 1.3 / 500, `--muted` |
| Numbers | Gabarito with `font-variant-numeric: tabular-nums` | — |
| Margin note | Caveat | 20–26px / 1.05 / 700, `--pen`, rotated −4° to 4° |

IBM Plex Mono survives only for genuinely technical text (diagnostics, file paths). Never as decoration.

Emphasis inside a headline is a **marker swipe** (`.mark`), never a color change, italic, or a second typeface.

## 05 Geometry and space

- Radii: page/sheet `14px`, control `10px`, row hover `7px`, tag `6px`, pill only for segmented controls. Nothing rounder.
- Rules: 1px `--hairline`; 1.5px for checkbox borders; 2px only in high contrast.
- Shadow: one soft page shadow for sheets that float (`0 1px 0 var(--hairline), 0 18px 40px rgba(29,29,31,.06)`). Nothing else gets a shadow except the primary button's hard highlighter offset.
- Spacing scale: 4, 8, 12, 16, 24, 32, 48, 72, 96. Lists use 11–14px row padding.
- Minimum hit target 44×44 (rows count).

## 06 Components

**Primary button.** Ink background, white text, 10px radius, `box-shadow: 3px 3px 0 var(--hl)`. Hover lifts 1px up-left and grows the shadow to 4px. Active presses in 3px and the shadow goes to 0. One per view.

**Secondary button.** Sheet background, 1px hairline border, ink text. Active: `translateY(1px)`.

**Quiet button / link.** Ink text, underline on hover. Used for Prev/Next, "Open in Canvas", etc.

**Row.** Checkbox or course swatch, title (600), optional meta line (`--muted`, 14px), right-aligned tag or relative day. Hairline between rows. Hover: `--sheet-2` background with 7px radius.

**Course tag.** 13px/600, 5px 8px padding, 6px radius, course tint (§03).

**Focus block.** `--hl-soft` sheet, 12px radius, heading + one sentence + primary button. At most one per screen.

**Segmented control.** Pill track `--sheet-2`, selected segment `--sheet` with hairline and ink text.

**Sidebar.** `--sheet-2` with a right hairline. Items are 15px/600 `--muted` with a simple glyph; the current item is ink on `#ececea` (night: `#26262a`). Courses listed below with their swatch.

**Forms.** Label above input (14px/600). Inputs: sheet, 1px hairline, 10px radius, 44px tall, focus ring `--pen`. Helper and error text below the field.

**Sheet / dialog.** Sheet with page shadow, 14px radius, no backdrop blur; backdrop is `rgba(22,22,24,.28)`.

**Semester line.** One lane per course: label, hairline baseline, ticks whose height = grade weight in the course color, a dashed ink "today" line. Hover bubble is a small sheet.

**Margin note.** `.note` in Caveat with an SVG arrow (stroke `--pen`, 2.4px, round caps). Max two per screen, never over prose, `aria-hidden` (the information must exist in text elsewhere).

**Command bar (⌘K).** A sheet dialog, 600px wide, top third of the window, page shadow, no blur. One input (18px/600) and hairline rows below grouped under plain sentence-case words: "Do", "Go to", "Add", "Ask". Each action row shows its key on the right in `--muted` 13px tabular type (for example `D`, `⌘K`). Empty query shows recent items. More than 30 results group by course. `?` in the input lists every shortcut. Enter runs the selected row; Escape closes and returns focus to where it was.

**Capture line.** A form input whose parse is shown before it saves: under the typed text, one `--muted` 14px line with what Kairos understood ("Thu, Oct 16 at 11:59 PM, Calc"). The input gets `--hl-soft` only while it is being edited. Nothing is written until Enter, and the saved row appears in place with an undo toast.

**Pile header.** A 15px/700 heading for a group of rows with its count in plain words ("Needs you, 2"). Three piles at most per screen. A row moves between piles from its menu; the first move offers "Always put this course here".

**Undo toast.** Bottom-center small sheet, one sentence and one quiet "Undo" button, 6 seconds, pauses on hover and focus, `role="status"`. Used after any local write the student made with one gesture (defer, accept, remove, capture).

**Consequence sentence.** One `--muted` sentence under a title that says what happens if the item is skipped or done ("Skip it: 84% → 79% in Calc."). Computed from grade truth; never invented. Omit it when the data is missing rather than guess.

**Notifications (macOS).** Title is the item ("Thermo midterm moved"); body is one sentence with the date in the §02 format and what to do ("Now Thu, Oct 16 at 9:00 AM. Open your plan."). No exclamation marks, no "don't forget", no "you haven't opened Kairos". Three triggers only (due date moved, high-stakes work within 48 hours not started, sync broken), at most three a day, held during class and from 11 PM to 8 AM.

## 07 Illustration

- Subject matter: outdoor activities and campus life students do once the week is handled. Small people, big landscape. Never a "student at laptop".
- Style: single-weight hand-drawn ink line (2–2.5px, round caps), with at most one fill of `--hl` or one course color. Base assets come from **Open Peeps / Open Doodles / Humaaans (CC0, Pablo Stanley)** recolored to ink; anything custom must match that line quality.
- Placement: landing sections, onboarding scenes, empty states ("Nothing due until Monday. Go outside."). Never on Study, never behind text.
- Photography/video (landing only): real footage from Pexels/Mixkit (free license) or real student clips. No AI-generated people, ever.

## 08 Voice presence

Voice must have a presence; it must not be a character.

- **Form:** the "ink ring": three or four soft overlapping loops (ink, `--pen`, `--hl`) inside a 72–120px circle, like ink diffusing in water. Abstract, no face.
- **States** (from `useVoicePresence()`): `idle` hidden · `listening` loops open and track mic level · `thinking` loops slowly orbit · `speaking` loops ripple outward with output level · `done` one settle-in, then the sheet closes.
- **Where:** the voice sheet (bottom-center sheet with live caption + Stop) and onboarding's voice step. It may appear as a 24px mark in the extension header while voice is live. Never resident on Today or Study.
- **How it starts:** not in the app yet. Voice runs as the developer intake page (`npm run voice`, `docs/VOICE.md`) because it needs a Gemini key the packaged app can't give students. When that is decided, holding the capture shortcut starts listening and releasing ends the turn. There is no always-on wake word.
- **Access:** decorative (`aria-hidden`); the sheet carries a text status ("Listening…", "Thinking…"), the live caption, and a Stop button. Reduced motion shows a still ring per state.
- No losable state, no moods, no guilt.

Implementation: `app/src/voice/InkRing.tsx` (canvas, dependency-free). The old Blot engine (`app/src/blot/core`) is retired from the UI.

## 09 Motion

**Paper is a fast medium with a slow settle.** A pen touching paper is the fastest event in a notebook: the mark is simply there. What takes time is only the aftermath — ink drying into the fibers, a page bending back down. So in Kairos the thing the student asked for appears with no ceremony, and only its consequences are allowed a moment.

Four verbs, and nothing else:

| Verb | Use | Spec |
|---|---|---|
| Settle | content arriving on a screen the student is already looking at | `--t-settle` `--ease-mark`, opacity + `--travel-settle` rise |
| Press | button or row press | `--t-tap` `--ease-press`; the primary button's shadow collapses |
| Draw | margin notes, marker swipe, semester line; **first reveal only, once** | `--t-draw` `--ease-mark`, stroke-dashoffset / background-size |
| Live | voice presence | continuous, and only while voice is actually live |

Never `transition: all`. No bounce, overshoot, spring, confetti, shimmer, parallax, or idle loop. Nothing animates that the student triggered from the keyboard.

The full system, the tokens, and the per-surface table of what animates and what does not: **§15**. What earns weight at all — friction, confirmation, the hold, and what the product refuses to do — is **§16**; what a student sees in week one versus week ten is **§17**. Research and sources: [`docs/research/motion-system-2026-10-23.md`](../../docs/research/motion-system-2026-10-23.md).

## 10 Screen recipes

- **Onboarding:** one question per screen, centered column 440px, big Gabarito question, one primary button. School is *found*, not picked from a hard-coded list (§12). A small outdoor doodle on the welcome and done screens.
- **Navigation:** sidebar items Today, Week, Courses, Study, Advisor, with Settings pinned at the bottom. ⌘K reaches every screen and action. Ask opens as a sheet over the current screen and never replaces the focus block.
- **Today:** date as display heading, "Good morning, <name>.", the focus block for the single most important item with its consequence sentence, one row saying what changed since the student last looked, then the rest of today's rows, then the semester line. No dashboard tiles.
- **Exam-week mode (Today):** when a weighted exam is three days out or less, the focus block becomes that exam's path ("Day 2 of 4. Next: practice the rate laws.") and the rest of today collapses to one row ("3 small things also due today"). One quiet link, "Show my whole day", restores the normal page. The highlighter stays on the focus block.
- **Week:** one capacity sentence at the top ("About 11 hours of work and 8 free. Move two things?"), the piles (Needs you, Changed, For your info), then the days as hairline sections. Each row has Defer. "Plan this week" is a quiet button that opens a three-step sheet (what changed, what is left from last week, proposed order) ending in one primary "Use this plan". Accepted plans never reorder themselves.
- **Calendar suggestions:** a sheet listing each proposed block with what it would change; nothing is written until the student says yes to that block.
- **Courses:** one row per course (tag, Canvas grade next to the grade with missing work as zero, next due). The course page is one column: grade truth, open work with consequence sentences, the Start here / Learn / Do / Check map, exam dates, files.
- **Study:** a path in plain rows (reviews due, then each exam's track, then practice). The session screen is a page sheet, 17–19px prose, one question at a time, progress as plain text ("3 of 6"). No illustration, no margin notes over prose.
- **Exam prep:** day-by-day rows, today's row highlighted with `--hl-soft`.
- **Capture shortcut:** the opt-in global shortcut brings the workspace forward with ⌘K open on the capture line and its parse preview. No separate floating window, no vibrancy.
- **Menu bar:** template icon. Menu items in plain words: "Next: <item title>", "Open Today", "Capture…", "Sync now", "Quit Kairos". No badge counts, no glass peek window.
- **Settings:** left list of groups (plain words, no numbers), right panel with forms.
- **Extension side panel:** the same row and focus-block grammar at 360px.

## 11 Landing page

Static, self-contained, no build step (deployed from `landing/` on Vercel). Same tokens. Order: hero (headline with one marker swipe + product page with margin notes) → the app in use → "what the grade really is" (grade math example) → how sign-in works → privacy in two plain columns → waitlist. Copy rules: no em-dashes, no buzzwords, ≤20-word subtext, one CTA label for one intent ("Get early access"). Social proof only from real people; no fabricated testimonials, avatars, or counts (FTC 2024 rule).

## 12 School personalization (visual rules)

The student's school is discovered (Instructure account search → their Canvas host → Canvas data). The UI may show the school's name and use the school's Canvas brand color **only** as a small swatch next to the school name in onboarding/settings. It never replaces `--hl` or recolors the app. Architecture: [`docs/architecture/school-personalization.md`](../../docs/architecture/school-personalization.md).

## 13 Anti-patterns (instant fail)

Uppercase eyebrow labels · numbered section indexes · em-dashes in UI copy · middle-dot metadata chains · mono type as costume · glass/blur · gradients, glows, neon · dark sidebar on a light page · 3-up equal card grids · nested cards · colored left-border cards · emoji as icons · a mascot or face · fake screenshots built from divs on marketing (use the real UI components) · fabricated testimonials · progress bars with tracks as decoration · "Get started / Learn more" CTAs · hard-coded school names in product UI.

Motion (same standing, see §15): bounce, overshoot or any spring with a damping ratio under 1 · an animation on a keyboard-initiated action · a directional slide between sidebar peers · an idle or infinite loop · a padded wait, fake progress, or a step shown that did not happen · shimmer on a "thinking" state · a draw-on that replays · animating anything but `transform` and `opacity` · `transition: all` · `animation: none` as the reduced-motion answer.

Weight and consequence (same standing, see §16): a sound on any action · screen shake, camera kick, particles or an impact flash · confetti or any celebration · a streak, day count, score, XP, level or any losable state · an auto-dismissing toast as the only way back · a confirmation shipped in place of a reversal that was possible · a typed confirmation below rung 3 · weight applied for being pressed rather than for a real outcome · any offer, nudge or upsell timed to the moment a student realises they are behind · a locked or levelled surface, or a count of features the student has not reached.

## 14 Acceptance test

A screen ships when: the next action is obvious in two seconds; every action reachable by mouse is reachable from ⌘K or a listed shortcut; it works with motion off; contrast passes WCAG AA in all three themes; there is at most one highlighted thing; every string reads like a person wrote it; and a screenshot looks like a page from Kairos, not a template.

Motion adds four: every animation on the screen is named in the §15 table, or it comes out; nothing the student triggered from the keyboard moves; with `data-motion="reduced"` every travel is zero and the screen is still legible and still tells the student what changed; and no wait on the screen is longer than the work behind it.

Weight adds four: every action on the screen has a rung in the §16.4 table, or it does not ship; nothing irreversible can be undone only by a toast; every acknowledgement says something the outcome decided, not something the press decided; and nothing on the screen is locked, levelled, or counted against the student.

## 15 Motion system

Added 2026-10-23 from [`docs/research/motion-system-2026-10-23.md`](../../docs/research/motion-system-2026-10-23.md), which carries the sources for every number below. §09 is the summary; this is the system. Where the two disagree, this one wins.

### 15.1 The decision rule

**The frequency test.** An animation teaches. Once it has finished teaching, it is only a delay.

> If a student will see it more than about twenty times in a term, it may not travel.

That covers opening ⌘K, switching views, hovering a row, opening a folder, pressing a button, toggling a panel. These get instant state change, and at most a tint or a shadow collapse. What is left — a thing that happens once, or a few times, or that the student did not cause — is where the whole motion budget goes.

Three more gates, all of which must pass:

1. **Did the student initiate it from the keyboard?** Then it does not animate at all. They pressed the key; they already know the outcome. ⌘K, every shortcut, every Enter.
2. **Is there real state to show?** Motion reports a change in the world: work moved, a grade shifted, a sync landed, a plan was accepted. It never decorates a layout.
3. **Is the direction true?** Motion that implies a position is a claim about where things live. If the claim is false in either direction, do not make it.

### 15.2 Tokens

One file, imported by the app, vendored to the extension, copied into the landing page. No surface redefines these.

```css
:root {
  /* Curves. Four jobs, four curves. */
  --ease-mark:  cubic-bezier(.22, 1, .36, 1);  /* easeOutQuint. A mark lands, then settles.
                                                  Enters, settles, draws. The house curve. */
  --ease-press: cubic-bezier(0, 0, .4, 1);     /* Sharp, no tail. Feedback under ~120ms. */
  --ease-move:  cubic-bezier(.4, 0, .2, 1);    /* Ease-in-out. Something already on screen
                                                  moving to a new place. */
  --ease-lift:  cubic-bezier(.3, 0, 1, 1);     /* Accelerate. Exits only. They leave; they
                                                  do not settle. */

  /* Durations, tiered by distance travelled, not by component. */
  --t-tap:     90ms;   /* press, commit, checkbox: 0-4px */
  --t-near:   140ms;   /* hover tint, tag, small reveal: up to 40px */
  --t-settle: 200ms;   /* row insert, content settling in: up to 120px */
  --t-sheet:  260ms;   /* full-surface: sheet rise, side panel */
  --t-draw:   600ms;   /* stroke draw-on. Once, ever. */

  /* Travel, separate from duration so reduced motion can zero it alone. */
  --travel-settle:  4px;
  --travel-row:     6px;
  --travel-sheet:  16px;
}
```

**300ms is the ceiling** for anything but `--t-draw`. Nothing in the product earns a longer number, and the landing page is the only surface allowed to sit at the top of the range.

**Reduced motion replaces, it does not remove.** `prefers-reduced-motion: reduce` means the user asked the system to remove *or replace* non-essential motion, and stripping an animation that was carrying meaning leaves the interface less usable, not more. So travel goes to zero and the cross-fade stays:

```css
@media (prefers-reduced-motion: reduce) { :root { /* as below */ } }
:root[data-motion="reduced"] {
  --t-settle: 120ms;  --t-sheet: 120ms;  --t-draw: .01ms;
  --travel-settle: 0px;  --travel-row: 0px;  --travel-sheet: 0px;
}
```

`--t-tap` and `--t-near` keep their durations: with travel at zero they are already only a tint and a shadow, which is motion nobody asked to lose.

Use `.01ms`, never `0` and never `animation: none` — both stop `transitionend` and `animationend` from firing and hang anything waiting on them. Any code that waits on either event also carries a timeout fallback.

`data-motion` is the student's own switch in Settings and it is independent of the OS setting: either one being set is enough. Both are read in CSS, and in JS through one helper, so a canvas or a JS-driven effect cannot miss it.

### 15.3 What animates, by surface

Everything on a Kairos screen appears in this table. If an animation is not listed here, it comes out.

**App chrome**

| Thing | Motion | Why |
|---|---|---|
| ⌘K command bar | **None.** It is there on the next frame. | Keyboard-initiated, hundreds of times a term. The student pressed the key. |
| Switching Today / Week / Courses / Study / Advisor | **None.** Content swaps. The sidebar's selection moves at `--t-near` `--ease-move`. | They are peers with no order. A slide would assert a left-to-right sequence that does not exist and would be wrong half the time. The sidebar selection is the spatial cue; the content area does not need one. |
| Course → a course → an assignment | Content settles: opacity + `--travel-settle` at `--t-settle` `--ease-mark`. No slide. | Real hierarchy, but the breadcrumb and the heading already carry the direction. |
| Sidebar item hover | Background at `--t-near` `--ease-press`. No movement. | Seen constantly. |
| Row hover | `--sheet-2` background, 7px radius, `--t-near`. No lift, no shadow. | Seen constantly. |
| Button and row press | `--t-tap` `--ease-press`. Primary: 3px in, shadow to 0. Secondary: `translateY(1px)`. | The one piece of motion that is pure feedback, and the one place a short curve beats the house curve. |
| Panel or sidebar toggle | Instant, and it overlays rather than reflows. | Frequently hotkeyed, and a panel that pushes content is the single most complained-about motion in comparable apps. |
| Settings, Sources, Connectors | Settle only. | |

**Overlays.** Each one enters from where it actually lives, so the student builds a correct map. Exits mirror entries at `--ease-lift` and one tier shorter.

| Overlay | Enter |
|---|---|
| ⌘K | None. |
| Ask sheet | Rises `--travel-sheet` from the bottom edge, `--t-sheet` `--ease-mark`, with the page visible behind it. It never covers the focus block. |
| Item sheet, dialog, confirm | Opacity in place at `--t-settle`. A distinct object, not a place. |
| Row menu, popover | `transform-origin` on its trigger, scale from .96, `--t-near`. It came from that row. |
| Extension side panel | Slides from its own edge, `--t-sheet`. |
| Undo toast | Up `--travel-row` from the bottom, `--t-settle`. 6s, pauses on hover and focus. |
| Backdrop | `rgba(22,22,24,.28)` fading at `--t-settle`. No blur, ever. |

**The product's real state changes.** This is what the budget is for, and most of it is currently silent.

| Moment | Motion |
|---|---|
| A suggestion is accepted | Confirmed **in place**: the checkbox marks at `--t-tap`, the label changes, the row keeps its exact position. Any reorder waits for the student's next navigation. |
| A suggestion is declined | The row collapses at `--t-settle` `--ease-lift`, with an undo window. Removal is expected; disappearance is honest. |
| A row is deferred, or moves between piles | It settles into its new pile at `--t-settle` `--ease-move` — the only place `--ease-move` is used in the app, because the row was already on screen. |
| The capture line's parse appears | The parse line fades in at `--t-near`. The saved row appears in place, no travel. |
| A sync lands new data | The "what changed since you last looked" row settles once at `--t-settle`. Nothing else on the page moves. |
| A grade or consequence sentence changes | The number cross-fades at `--t-near`. It never counts up. A grade is a fact, not an animation. |
| Exam-week mode collapses the day | The collapsed row settles at `--t-settle`; the restored page settles the same way. One change, one motion. |
| Semester line | Ticks draw once at `--t-draw` on first view of the screen, then never again. The hover bubble fades at `--t-near`. |
| Study session, question to question | Instant. The student is working; progress is the plain text "3 of 6". |
| Review marked right or wrong | `--t-tap` state change only. No celebration, no streak, nothing losable. |

**Voice presence.** The only continuous motion in the product, and only while voice is live (§08). Mic level drives ring amplitude through an asymmetric envelope: **attack 30–60ms, release 150–250ms**, so it answers immediately and does not flicker in the gaps between words. `speaking` tracks real output level, `thinking` is a slow distinct breathing state, `done` is one settle. It pauses on `document.hidden`, stops when the sheet closes, and renders one still pose per state under reduced motion. No paired marks, no symmetry that reads as a face.

**Landing page.** The one surface where an animation is still teaching, because almost everyone there is seeing Kairos for the first time. Hero marker swipe and margin-note arrows draw once at `--t-draw`, triggered on first view and never replayed. Everything else settles. **No loop, no autoplay longer than five seconds without a control, no parallax, no scroll-linked movement.**

### 15.4 Waiting, and telling the truth about it

Kairos computes a consequence sentence from grade truth and omits it rather than guess. A product that will not invent a percentage does not get to invent a wait.

- Under about 300ms, show nothing. A sync that finished in 40ms is allowed to look instant even if that makes the work look easy.
- Past that, a determinate indicator only when the work is genuinely countable ("4 of 9 courses"). Otherwise one plain sentence, and a plainly written timeout if it stops.
- **No padded waits, no minimum display times, no fake steps, no progress that moves when nothing is happening.** Showing effort does raise how much people value a result — which is exactly why this is written down as a prohibition rather than left to taste.
- Streaming text is pace-smoothed, not faded token by token: decouple the visible buffer from the network chunks so words arrive steadily. No per-token fade, no shimmer on a "thinking" label.
- Provenance is typography, never motion. "From your Canvas data, synced 20 minutes ago" and "Kairos worked this out" are told apart by labelling and a timestamp. There is no evidence motion calibrates trust, and a moving confidence cue would be a claim the product cannot support.

### 15.5 Engineering rules

- **Animate `transform` and `opacity`. Nothing else.** `box-shadow`, `background-size`, `background-position`, `clip-path`, `filter` and every layout property repaint each frame in WebKit. The two exceptions, both deliberate: the primary button's shadow collapse (one element, `--t-tap`) and a once-only `stroke-dashoffset` or `background-size` draw-on.
- **Budget 16.7ms per frame, and never count frames.** A Tauri WKWebView on macOS is capped at 60fps — Safari's 120Hz path does not apply to embedders, and the WebKit request to change that is open and unassigned. Step every JS-driven animation from timestamps. Design nothing whose quality needs 120Hz, and do not optimise for a rate this app does not get.
- **`will-change` is a compositing trigger**: each one makes a real layer. Add it immediately before an animation and remove it after. Never leave it in a static rule.
- **Do not animate `transform` on a container of prose** unless the layer stays promoted for the whole interaction; text re-rasterises and can snap at the end.
- **Entrances are transitions, not `@keyframes`**, wherever an exit might need to cancel them. A sheet dismissed 80ms into its rise reverses from where it is; it does not finish opening first.
- **Never gate interaction on `transitionend`.** The row the student clicked is clickable during its own settle.
- At most **8 animating elements** at once. A stagger must still finish inside the 300ms ceiling, and the settle itself is already 200ms, so the arithmetic allows **6 rows at ≤20ms apart, or 3 rows at 40ms** (280ms) — beyond that, settle the container instead. (Corrected 2026-10-23: the earlier "6 rows, 30–40ms apart, under 300ms" was impossible, since 5×30+200 = 350ms.) Keep animated area under about a quarter of the viewport (engineering judgement, not a clinical threshold; no quantified area limit for vestibular safety exists in the literature).
- Pause every continuous animation on `document.hidden`, and re-read `devicePixelRatio` when the window changes display.
- In the extension: Shadow DOM for isolation, `contain: layout paint` on the injected root, never read host-page layout inside an animation loop, and never hold animation state in the MV3 service worker — it can terminate after about thirty seconds idle.

### 15.6 The generative workspace

The workspace layer ([`docs/handoff/generative-workspace-architecture-2026-10-21.md`](../../docs/handoff/generative-workspace-architecture-2026-10-21.md)) compiles a student's interview into a spec, streams it into the screen block by block, and later proposes amendments. It is the one place in Kairos where motion is load-bearing product, so it gets its own rules.

**The patch ops are the motion vocabulary.** The compiler already emits a closed set of ops, and that set is one-to-one with the state changes in 15.3. No new vocabulary is needed, and none may be invented:

| Op | Motion | Why |
|---|---|---|
| `place` | Block settles: opacity + `--travel-settle` at `--t-settle` `--ease-mark` | A block is arriving. There is no true origin for a slot, so it rises in place with no direction. |
| `remove` | Collapses at `--t-settle` `--ease-lift` | Removal is expected and disappearance is honest. Undo window, per §06. |
| `reorder` | `--t-settle` `--ease-move` | The only correct use of `--ease-move` in the app: the block was already on screen and is moving to a new place. |
| `set_density` | **None.** Instant. | It changes row padding, which is layout and reflows prose. Animating it would re-rasterise every line of text on the screen. |
| `set_props` | None, unless the prop adds or removes a visible region, which settles. | |
| `rename`, `set_home`, `set_quiet`, `done` | **None.** | Nothing visible moves. `set_home` takes effect on the next launch, and the sidebar never moves (§15.3). |

**The live build is exempt from the stagger limit, and the exemption is the point.** 15.5 caps a stagger at six items 30–40ms apart. The live build is not a stagger: each frame is a block actually entering the spec, narrated by the compiler's own `rationale` sentence in the student's words. `REPLAY_MS` is paced by **narration and comprehension**, not by motion, which is why 220ms is right and 40ms would be wrong. Nobody may "optimise" it toward the stagger limit. It also passes the frequency test outright — a student sees it once — so this is precisely where the motion budget belongs.

**A reveal is not a padded wait, and here is the line.** The compiler is pure and returns in milliseconds; the spec is already complete and already on disk as `proposed.json` before the first block lands. So the live build shows time passing over work that has finished, which is one inch from the thing 15.4 forbids. It stays on the right side of the line because all three of these hold, and it stops being allowed the moment any one of them fails:

1. The artifact is **already complete** before the reveal starts. Nothing is being waited for and no latency is being masked.
2. A **visible control skips to the end** at any time. A padded wait never offers that; it is the whole difference between pacing and detaining.
3. **Nothing claims work is in progress.** No "thinking", no shimmer, no typing cursor over a code pane, no progress bar. The narration describes a block that exists, not effort being spent.

This is the same prohibition the architecture doc reaches independently in its §5 ("no fake generation"). They are one rule. Neither may be relaxed alone.

Note also that the value here is **not** the labor illusion — the architecture doc grounds ownership in the student's own completed act (an edit, or naming it), not in watching. So the reveal earns its time as comprehension, and the ownership comes from the edit afterward. If the reveal ever had to justify itself by making the work look hard, it would be cut.

**Motion is not generative. This is a bound, not a preference.**

The spec carries no motion field, there is no motion patch op, no capability prop may set a duration, a curve, a travel distance or a delay, and no interview answer may reach any of them. A student saying "make it feel snappier" produces nothing. `density` is in the spec and motion is not, and that asymmetry is deliberate:

- Motion is accessibility-load-bearing. A per-student curve or duration cannot be regression-tested against the reduced-motion contract in 15.2, and the one thing that must never vary per spec is the thing that keeps the app usable for someone with a vestibular disorder.
- Motion is performance-load-bearing. The budget in 15.5 is sized for a 60Hz WebView. A spec that could widen it could break frame rate on a student's machine, and the loader would have no way to tell.
- The same reasoning as the architecture's one hard rule: a model-chosen layout cannot stay inside MASTER, cannot be diffed for the accept step, and makes every future change a prompt-engineering problem. A model-chosen curve is worse, because it is invisible in a diff.

Reduced motion stays **outside** the spec for the same reason it stays outside `density`: it is a property of a person and a device, not of a workspace. It lives in `data-motion`, set by `app/src/theme.ts` and persisted in the `pn_motion` key of the WebView's own `localStorage` — **not** in `calibration/app-prefs.json`, which carries only `keep_running`, `notifications` and `capture_shortcut` (`app/src-tauri/src/prefs.rs:13-20`; corrected 2026-10-23). A spec is reverted, kept in history and replaced; an accessibility preference must survive all of that untouched.

**Amendments** follow 15.3's suggestion grammar exactly: the proposal settles in at `--t-settle`; a yes confirms in place and the row does not move; a no collapses it with an undo window; an accepted `set_home` changes nothing on screen now. At most one pending at a time, and the sidebar still never moves.

### 15.7 Frame rate

**A Tauri WKWebView on macOS is capped at 60fps.** Safari's 120Hz path depends on an internal flag that does not apply to embedders, and [WebKit bug 294338](https://bugs.webkit.org/show_bug.cgi?id=294338) — the request to change that — is open and unassigned. Meanwhile the Chrome extension, running the same tokens, **does** get 120Hz. The design system spans both, so it must look right at either rate.

**This is not a constraint on anything §15 specifies, and it is not a reason to change the design.** Walk the four verbs: a 200ms opacity-plus-4px settle, a 90ms tint, a once-only stroke draw-on and a 260ms sheet rise are all indistinguishable at 60 and 120Hz — frame cadence only becomes visible in continuous gesture-tracked motion and fast large-area movement, and Kairos has neither by design. The draw-on repaints per frame, so 60Hz is cheaper. The ink ring is slow organic diffusion with a 30–60ms attack, which is two to four frames at 60Hz and enough. Most students are on a 60Hz display anyway, so designing for 120 would be designing for the minority of the install base.

So the rule is the one already in 15.5, stated as a consequence rather than a complaint: **budget 16.7ms, step from timestamps, and never ship an animation whose quality depends on the frame rate.** The cap pushes the design exactly where restraint already wanted it.

Two places the cap could genuinely bite, neither of them current:

- **Scrolling** long lists on a 120Hz machine, beside native apps that are smooth. The answer is to make 60 *solid* rather than to chase 120: native overflow scrolling only, never a JS smooth-scroll or custom scroll physics (at 60Hz a JS scroll is strictly worse than the WebView's own), and keep frames cheap with virtualization or `content-visibility` on long lists.
- **A future direct-manipulation gesture** — drag-to-defer a row, drag a block in the studio. A finger- or trackpad-tracked drag is the one thing that reads as laggy at 60Hz. If one is ever core to the product, that is the trigger to revisit, and the answer is to move that surface off the WebView, not to try to speed the WebView up.

Alternatives considered and rejected, written down so they are not rediscovered:

| Option | Verdict |
|---|---|
| Measure before anything else | **Do this first.** The cap is reported, not verified on this machine's build. `app/src/dev/frameRate.ts` prints the histogram. Everything below is premature until it runs. |
| Private-API or plugin workarounds | **No.** Reported in Capacitor/Tauri plugin threads, unconfirmed on macOS, and a private API in a DMG that is signed and manually notarized is a release risk for a cosmetic gain. |
| Wait for the upstream fix | **Don't plan around it.** Open and unassigned since before 2026-09-17. |
| Native-side motion for what needs it | **The real escape hatch, unused so far.** Anything that must track a gesture at full rate belongs in AppKit, not CSS — the menu bar and notifications are already native. Costs Rust work; correct answer if a drag surface becomes core. |
| Electron, or a native SwiftUI shell | **Known and rejected**, not a surprise. Tauri on macOS is WKWebView only; there is no Chromium option in wry. Both alternatives are a rewrite of the shell. Revisit only if direct manipulation becomes the product, and never for 120Hz alone. |

### 15.8 Debts, and what the build paid

Found by the audit in the research doc, §9, which has the file and line for each. Numbering is kept so older notes still resolve.

1. ~~One curve, `--ease`, does nine jobs — including a 110ms press, where its long tail reads as mush.~~ **Paid 2026-10-23**: four curves, five duration tiers, one file (`design-system/kairos/motion.css`). No `--ease` remains in any stylesheet.
2. ~~The tokens are forked three ways: the extension redefines three of them and then uses bare `ease-out`; the landing page hard-codes its durations.~~ **Paid 2026-10-23**: one source file, byte-identical copies at `landing/motion.css` and `app/extension-chrome/ui/motion.css`, held by a drift test. No surface hard-codes a duration or a curve.
3. ~~Reduced motion is hand-written in about ten places, doubled for the media query and the attribute, and it removes instead of replacing.~~ **Paid 2026-10-23**: the token override is the only mechanism, plus `motionReduced()` for canvas and JS. No `animation: none` or `transition: none` remains anywhere in the app, extension or landing page.
4. ~~`handoff-scene 12s infinite` is an idle loop over five seconds with no pause control.~~ **Paid 2026-10-23**: `ConnectCanvasMark` is one still scene and the sequence lives in its accessible name. The four scenes' CSS went with it.
5. ~~Two live `backdrop-filter: blur()` rules, against §13.~~ **Paid 2026-10-23.**
6. `spatial.css` is still imported after `notebook.css`. Its motion and glass are gone as of 2026-10-23 and it is on the tokens, but it still owns live layout (command-bar chrome, tape head, first-run, the narrow nav). Deleting it is a layout migration, not a motion one.
7. ~~⌘K animates, at 320ms, above the ceiling and against 15.1.~~ **Paid 2026-10-23**: nothing declares an animation or a transition on `.cmd-bar` or `.cmd-backdrop`, so it is there on the next frame with no rule needed to suppress anything.
8. ~~Four near-duplicate settle keyframes, thirteen in total.~~ **Paid 2026-10-23**: zero `@keyframes` remain in `notebook.css`, `styles.css` or `spatial.css`.
9. ~~Every entrance is a `@keyframes`, so no exit can cancel one.~~ **Paid 2026-10-23**: entrances are transitions with `@starting-style`, and `useExit` (`app/src/motion.ts`) keeps a sheet mounted through its exit, with a timeout behind the `transitionend`.
10. Partly paid 2026-10-23. `useFlip`, `Crossfade` and `MotionDialog` now carry the reorder, the grade cross-fade and the sheets. Still silent: a suggestion accepted (it pops rather than confirming in place), a suggestion declined (no collapse, no undo), and a review marked — see §16.5.
11. ~~`studio-settle` hard-codes `200ms` and `4px` instead of `--t-settle` and `--travel-settle`.~~ **Paid 2026-10-23**: `.studio-block.is-new` reads `--t-settle`, `--travel-settle` and `--ease-mark`.
12. ~~The live build handles only `place` as a frame; `remove` and `reorder` are reachable from the student's own edits with no motion attached.~~ **Paid 2026-10-23**: `remove` lifts out and `reorder` uses the same FLIP as a deferred row.
13. ~~`REPLAY_MS = 220` carries no comment saying why it is 220 or that it is exempt from the stagger limit.~~ **Paid 2026-10-23.**

**Found by the audit of the build itself, 2026-10-23, and fixed in the same pass.** Recorded because each one is a way this system fails quietly — the motion simply does not happen, and nothing turns red.

- The extension never received the tokens at all. `panel.css` imported `motion.css` from its own directory rather than `ui/`, and `ui/motion.css` was missing from `web_accessible_resources`, so Chrome blocked the injected dashboard's import. Every `var(--t-*)` in both extension stylesheets was invalid at computed-value time. **An identical-copies test does not prove a surface can load its copy**, so the drift test now also resolves every `@import` and checks the manifest.
- A `@starting-style` entrance only applies the first time an element is styled. The semester draw-on set its class from an effect, one paint after the ticks existed, so it could never play. A class that triggers an entrance has to be on the element in the render that creates it.
- A lift-out needs its transition declared on the row, not only on the leaving class, or there is no from-value and the row vanishes instantly.
- Waiting on a measured `transitionDuration` read **before** the class is applied reads the base rule, not the exit, so the wait collapses to zero. JS that has to outlast a CSS exit reads the duration token instead (`tokenMs`), which also keeps the two numbers from drifting. Two hard-coded `220`s are gone with it.
- A pending-commit class is a view, never row state: `is-leaving` was never cleared, so a row brought back by undo stayed at `opacity: 0`. It is now pruned whenever the plan is re-read.
- `useExit` is per-mount, but one `Toast` node serves every toast in turn. Without `reopen` on a new id, a toast arriving during an exit left with the old one's transition, and the next close was swallowed.
- An envelope rebuilt per state is not an envelope. The ink ring's smoothing and wobble phase were reset on every `VoiceState` change, which snapped the ring and meant `done` never got the one settle §08 asks for. State is read through a ref; the loop is kicked, not rebuilt.
- A remount is how `@starting-style` gets replayed, and a sync is a background event, so the "changed in Canvas" settle is skipped while focus is inside that list rather than taking the keyboard off the page.
- `.tape-head` animated `left` for the whole study session at `1s linear`: a continuous animation of a layout property, over three times the ceiling, in the one product surface that is open for an hour. The head's position is a fact, so it steps.

## 16 Weight and consequence

Added 2026-10-23 from [`docs/research/game-design-as-product-design-2026-10-23.md`](../../docs/research/game-design-as-product-design-2026-10-23.md), which carries the source for every number below. §15 governs **how** things move; this section governs **what earns weight at all**, and the two are read together.

**Weight goes where the mark leaves the page.** Writing in a notebook is free, and so is crossing something out. Nothing on a page you own needs a confirmation, because nothing on it is hard to take back. What is hard to take back is the page leaving your hands. A notebook has no undo button because, until that moment, it does not need one.

**In a product with undo, weight means reversibility, not ceremony.** A fighting game freezes the screen on a heavy hit to tell a player *this one counted*, because that player has no undo. We have undo. A product that can give the mark back does not have to flinch to prove the mark mattered.

### 16.1 The decision rule

**The departure test.** Before adding any friction, any confirmation, any hold, ask one question:

> Can the student get this back by themselves, inside Kairos, five minutes from now?

- **Yes** → it earns no friction. No dialog, no hold, no "are you sure". Act, say what happened, offer the way back.
- **No** → it earns a rung from 16.2, sized by what else it touches.

Two things the test deliberately ignores. **How large the action feels** is not an input; a felt-big reversible action (accepting a whole week's plan) gets nothing, and a felt-small irreversible one (exporting grades to a file) gets a rung. And **whose fault a mistake would be** is not an input either; friction is not a judgement about the student.

Then one more gate on any *weight that is not friction* — a hold, a settle, an acknowledgement:

**It must be contingent on the outcome.** CHI 2024 (n=1,699) measured feedback that tracks how well you actually did as raising competence, effectance and curiosity, and feedback merely *amplified* as lowering all three, apparently by eroding the sense of agency. The hitlag formulas say the same thing in frames: an attack that deals no damage produces no freeze. So weight reports a real result or it does not exist. Nothing in Kairos gets weight for being pressed.

### 16.2 The rungs

Four, and no fifth. Nothing in Kairos may invent a rung above or between these.

| Rung | When | What it is |
|---|---|---|
| **0 — none** | Reversible inside Kairos | Act at once. A toast states what happened and carries Undo. `defer`, `done`, `estimate`, accepting a week's plan, every edit in the workspace studio. |
| **1 — a recovery window** | Reversible, but not from the row any more | A named, non-expiring place the thing can be got back from, stated in the copy at the time. Workspace history is the model. |
| **2 — a confirm sheet** | Not reversible, and bounded in blast radius | `ConfirmSheet`: what would change, in the student's words, one primary yes, one way out, and nothing happens before the yes. Calendar writes, Gmail sends, removing a file copy. |
| **3 — a typed confirmation** | Not reversible, and it takes the whole brain with it | The student types the exact name of what they are about to lose. Reserved for exactly two things today: switching or creating a profile, and anything that would delete a `{user_root}`. |

**Reversibility outranks confirmation.** WCAG 3.3.4 requires only *one* of Reversible / Checked / Confirmed, and Reversible is one of them. A working undo is a conformant answer and a better product than a dialog. Where both are cheap, ship both — GitHub asks three times *and* keeps the repo for 90 days — but never ship a dialog in place of a reversal that was possible.

**A reversal path may not be the only path, and may not expire silently.** An auto-dismissing toast is a convenience, never the sole way back. If the toast is the only reversal, the action needed rung 1 or 2 instead. One toast at a time, and a second toast may not replace a first whose Undo is still live.

**Typed confirmation stays at rung 3 and spreads no further.** Every shipped product uses it for irreversible blast radius, and no measured evidence was found that it prevents accidental deletion; the one source read on the question argues it makes people think about the typing instead of the decision. It is here on industry practice, not on evidence, and it is capped accordingly.

**Nothing in Kairos is irreversible toward another person**, because nothing in Kairos acts toward another person. Canvas submits, comments and discussion posts are preview-only with no execute path (CLAUDE.md), which is why rung 3 has only two entries and not twenty.

### 16.3 The hold

The one piece of game feel this product adopts, and the only new motion token.

```css
:root {
  --t-hold: 90ms;  /* The visual hold on a row the student just acted on.
                      Reuses --t-tap's value on purpose: the shipped hit-stop
                      range starts at ~83ms. Data commits first; only the
                      paint waits. One tier, and there is never a second. */
}
```

**How it works, and the mechanism is not optional.** The state change commits immediately. The row's FLIP transform carries `transition-delay: var(--t-hold)`, so for 90ms the row holds its old position, then moves. Input is never blocked, the data is never stale, and the row is clickable where it appears.

**Never implement a hold as a timer before a state write.** A `setTimeout` before the commit leaves the data stale for the duration, so a second action inside the window acts on an old snapshot; React 19 batches inside timeouts, StrictMode double-runs the effect that started it, and a `useTransition` would let the hold itself be deferred. The hold is CSS.

**One tier only.** Games escalate hit stop to 333–500ms at death because the player has no undo. We have undo, so the escalation has nothing to buy. There is no "big" hold, and `--t-hold` may not be scaled per action.

Under reduced motion `--t-hold` goes to `.01ms` with the other travel tokens. It is paint, so nothing waits on it.

### 16.4 By surface

| Surface | Rung 0 | Rung 1 | Rung 2 | Rung 3 | Hold |
|---|---|---|---|---|---|
| Week | defer, done, estimate, accept a plan, decline a suggestion | — | add a calendar block | — | on the acted row |
| Today | mark done from the focus block | — | — | — | on the acted row |
| Study | every review outcome, including Skip | — | — | — | **no** — the next-review sentence is the acknowledgement |
| Courses | — | — | — | — | no |
| Advisor | — | — | send an email, write a calendar event | — | no |
| Settings | theme, motion, prefs, opt-ins | — | disconnect a connector, export Canvas data | switch or create a profile | no |
| Workspace studio | every edit | revert to a history entry | accept a proposed amendment | — | on a reordered block |
| Onboarding | — | — | — | — | no |
| Extension | nothing writes | — | — | — | no |
| Landing | nothing writes | — | — | — | no |

Anything not in this table has no rung and no hold. If a new action does not fit a row here, it does not ship until this table says what it is.

### 16.5 The acknowledgements

What the product says when something real happens. Each is outcome-contingent, which is the whole requirement.

| Moment | Acknowledgement |
|---|---|
| A suggestion accepted | Confirmed **in place**, per §15.3: the control marks at `--t-tap`, the label changes, the row keeps its exact position. Any reorder waits for the next navigation. It may not pop out of the list. |
| A suggestion declined | Collapses at `--t-settle` `--ease-lift` **to the one line that still carries Undo**, never to zero height. The toast carries the same Undo, and the queue in §16.4 can hold a toast back, so the row is the one that is guaranteed. |
| A row deferred or done | The hold (16.3), then its settle into the new pile. The toast states the new day, not "saved". |
| A review marked | **No motion beyond `--t-tap`.** The acknowledgement is the next-review date, which already differs by outcome — the contingency is carried by typography, exactly where §15.4 puts provenance. This is the correct answer, not a gap. |
| An export finishes | The path it wrote, stated. A file that exists is its own acknowledgement. |
| A sync lands | One settle on the "what changed" row, per §15.3. |
| Nothing happened | Nothing is said. The product has no empty acknowledgement. |

### 16.6 Prohibitions

Things the research shows work, or that shipped products profit from, and that Kairos does not do. They are written down precisely because the evidence is on their side and someone will propose one later.

- **No sound.** Not on success, not on a review, not anywhere. No web API can read macOS's "Play user interface sound effects" setting or the system mute state, so the product cannot honour the platform switch — and an app that cannot honour the switch has no business making the noise. This is a capability limit, not taste; it reopens only if the shell gains a native audio path that reads the system setting.
- **No screen shake, no camera kick, no particles, no impact flash.** Whole-viewport motion with no published safe parameters, and amplification is the thing measured as *reducing* competence and agency. The extension's `contain: layout paint` would clip it regardless.
- **No celebration.** No confetti, no "nice work", no milestone animation. A milestone animation is the single mechanic with a published engagement lift (+1.7% day-7) and it is still refused, because that number is retention and this product is judged on learning.
- **No streaks, counts of days in a row, scores, XP, levels, hearts, or any losable state** (reaffirming CLAUDE.md). The reason, now written down so it survives the next citation: every published streak figure is a retention or engagement metric, and no measured effect of streaks on *learning outcomes* exists in either direction. The evidence offered for streaks is evidence for the wrong outcome. The brief-day counter in `habit.py` stays exposure-only, never announced, never decremented, never shown as a run at risk.
- **No monetization ladder, ever.** No icebreaker offer, no first-purchase identity conversion, no selling faster progress, no consumables, no unlimited spend ceiling, and above all **no offer timed to a moment of failure**. FTC §5 and ROSCA reach this conduct whether or not there is a server, and the audience includes people under 18. There is no pricing surface in the tree today, which is exactly when to write this down.
- **No pressure at the moment of failure.** The rule, in one line: **Kairos may use the moment a student realises they are behind to reduce the cost of the next action. It may never use it to raise the price of staying.** The constructive form: one concrete, time-sized next action, framed as "the plan changed" and not "you fell behind", with no count of what was lost, and declining is free and silent.
- **No notification outside §06's three triggers**, and `sync_broken` stays the quietest of the three because it serves the product rather than the student.
- **No multiplayer, no shared documents, no presence.** One student, one notebook, local. The collaborative-undo problem is real and we do not have it; nothing may create it by accident.

### 16.7 Engineering rules

- `--t-hold` lives in `design-system/kairos/motion.css` with the other tokens and is copied byte-for-byte to the extension and the landing page. `app/src/motion.test.ts` fails if the three files diverge, so there is no way to add a token to one surface and forget the others. No surface redefines them.
- **No duration, delay or travel distance may be hard-coded in JS.** Read the token, or derive from it. The existing `220`s are the reason for this line.
- **Never read `getComputedStyle` for a duration in the same handler that set the class.** React 19 has not committed the class yet and the read returns the old value. Use the token. The week hold is `transition-delay: var(--t-hold)` on the acted row's FLIP, and the data is committed first.
- Any code that waits on `transitionend` or `animationend` carries a timeout fallback (§15.2), and a hold never gates interaction (§15.5).
- A confirm sheet does its work behind one primary button and shows no progress; §15.4's waiting rules apply unchanged.
- A rung-3 typed confirmation compares against the exact stored name, trims nothing but surrounding whitespace, and the primary button stays disabled until it matches.
- The reduced-motion switch must reach every surface, including the extension stage and the landing page, through `data-motion` and not the OS query alone.

### 16.8 Debts in the tree as of 2026-10-23

From §9 of the research doc. Paid the same day, except the measurement that was never a student-facing change.

1. Paid. Export opens a confirm sheet before the ZIP is written, and the path is stated only after the file exists.
2. Paid. Switching or creating a profile asks the student to type the destination name. The primary stays disabled until it matches.
3. Paid. A capture marked done stays on the week under Done, with Not done on the row. The toast is no longer the only way back. Done work leaves the page once its week is over, so Done is this week's, not the term's.
4. Paid. A toast with Undo is not replaced. The next one waits, and a waiting Undo is not replaced either. Because one waiter is the cap, a third Undo-bearing toast is dropped — so every rung-0 and rung-2 action in §16.4 also keeps a way back **on the page**, and no toast is ever the only one. Nothing may join that table without one.
5. Paid. Adding a calendar block still confirms, and the toast can remove that event.
6. Paid. Defer and done commit immediately. A pointer action holds the acted row with `transition-delay: var(--t-hold)`.
7. Paid. An accepted suggestion stays in place and the button reads Added until the student leaves the week.
8. Paid. Not now collapses the row to a line that carries Undo, and the toast carries it too.
9. Paid. Keyboard `d` commits the defer and does not travel.
10. Paid for the OS query. The extension stage host, the side panel, and the landing pages set `data-motion` from `prefers-reduced-motion`. The app's own switch lives in the Tauri webview's `localStorage` and still has no channel to Chrome.
11. Paid. `ui/motion.css` is in the extension manifest's `web_accessible_resources`.
12. `app/src/dev/frameRate.ts` is imported nowhere, so §15.7's 60fps premise is still unmeasured.

## 17 Disclosure

Added 2026-10-23, same research doc. What a student sees in week one versus week ten.

**A notebook's later pages are not hidden. They are blank.** Nothing in Kairos is locked, levelled, earned or staged on a schedule. What a student has not written yet is simply not there yet, and the moment they write it, it is.

### 17.1 The decision rule

> A surface appears when the student's own data makes it mean something. Not before, and never on a timer.

- Exam-week mode on Today appears because a weighted exam is three days out (§10). That is the pattern, and it is already right.
- A course page's grade-truth block appears because there are graded items to be truthful about.
- Nothing appears because the student has opened the app five times, reached a level, or finished a tour.

**Never show a feature the student cannot use yet**, and never show a count of features they have not reached. An empty state that explains what will fill it is honest; a locked row is a claim about the student.

### 17.2 Levels

**Two, hard cap.** The surface, and one disclosure beneath it. Nothing nests to a third level, because past two levels usability drops and the student stops finding things.

| Level | What goes there | How it looks |
|---|---|---|
| The page | What the student needs this week | Plain rows (§02) |
| One disclosure | Advanced, diagnostic, or rarely-needed controls | A native `<details>` with a plain-words summary and, where it earns it, one muted line saying who needs it ("Most students never need this") |

Everything else lives in ⌘K, which is not a disclosure level — it is the flat index of the whole product and always has been. If something is hard to find, the answer is a better ⌘K entry, not a third level of nesting.

### 17.3 Teaching

The product teaches by what it will let the student do, not by telling them. Onboarding already does this and it stays as it is: one question per screen, the continue button disabled until the answer exists, no tour and no coach marks. The only published finding available says tutorial users rated the app *more complex* and were no more proficient than people who skipped it.

Three rules:

- **Speak only when the student is stuck or wrong**, and only about the thing in front of them.
- **An empty state says what will fill it.** "Nothing due until Monday. Go outside." is the tone; "no data" is not.
- **A failure path states what will be missing.** Onboarding's "Continue without classes" admits the student to a product built entirely from Canvas data, so it must say which screens will be empty and how to finish signing in later.

### 17.4 Debts

1. Paid. The `<details>` blocks share the `disclosure` class. None of them nests. Today's "See what changed" stays a button on the page, and onboarding has no disclosure.
2. Confirmed, and left as it is. ⌘K's six remembered ids are the only surface that opens with use, which is what 17.1 allows.
3. Paid. "Continue without classes" says that Today, Week, and Courses stay empty until Canvas is signed in, and that sign-in can be finished later in Settings.
