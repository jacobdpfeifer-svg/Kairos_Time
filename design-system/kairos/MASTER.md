# Kairos — Notebook design system

**Source of truth for visual craft** across the desktop app (`app/src`), the Chrome extension (`app/extension-chrome`), and the marketing site (`landing/`). Adopted 2026-10-07 (structure amended 2026-10-13 from [`docs/research/saas-themes-applied-to-kairos-2026-10-13.md`](../../docs/research/saas-themes-applied-to-kairos-2026-10-13.md)) from the three-direction exploration in [`explorations/2026-10-07/`](../explorations/2026-10-07/) (the owner picked `c-notebook.html`). It replaces the Living Instrument / Spatial Instrument systems; where an older doc disagrees with this one, this one wins.

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

Motion only for real state changes:

| Verb | Use | Spec |
|---|---|---|
| Settle | view load | 200ms ease-out, opacity + 4px rise |
| Press | button/row press | 90–120ms; primary button shadow collapses |
| Draw | margin notes, marker swipe, first reveal only | 500–700ms stroke-dashoffset / background-size |
| Live | voice presence | continuous only while voice is active |

`--ease: cubic-bezier(.22,1,.36,1)`. Never `transition: all`. No bounce, confetti, shimmer, or idle loops. `prefers-reduced-motion` and `data-motion="reduced"` remove travel and drawing; state still changes instantly.

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

## 14 Acceptance test

A screen ships when: the next action is obvious in two seconds; every action reachable by mouse is reachable from ⌘K or a listed shortcut; it works with motion off; contrast passes WCAG AA in all three themes; there is at most one highlighted thing; every string reads like a person wrote it; and a screenshot looks like a page from Kairos, not a template.
