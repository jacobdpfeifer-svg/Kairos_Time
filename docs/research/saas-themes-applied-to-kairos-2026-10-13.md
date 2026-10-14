# Loved-SaaS themes, applied to Kairos

Companion to [`Loved SaaS UX themes.md`](./Loved%20SaaS%20UX%20themes.md). That report screened 344 paid products and opened 59 down to a gesture. This doc takes every row of it, condenses the patterns that make those products feel next-level, and maps each one onto a concrete Kairos surface. Owner decisions from 2026-10-13: restructure the product, **keep the Notebook look** ([MASTER.md](../../design-system/kairos/MASTER.md)), bring back a redesigned Week, and allow four opt-in native behaviors (notifications, a global hotkey, launch at login, `kairos://` links).

Method: five Haiku 4.5 passes read the source report in slices (market table rows 1–200 and 201–370, the 180-row addendum, the 59 deep reads, the 15 mechanics and their verdicts). Three code passes inventoried the app, the extension and native shell, and the local brain. The themes below are the deduplicated union. Where a pass proposed something that breaks a product rule (an energy meter, a daily crown, a shared draft), it went to the leave list.

## What the research says, in one paragraph

The research does not ask Kairos to look different. Its praised canon (Things, Todoist, iA Writer, Mercury, Linear, Superhuman, Watch Duty) is already what the Notebook system is modeled on. What the research asks for is **structure**: one next action with a reason, a week you can see whole and defer from, a keyboard path to everything, capture that shows its date before it saves, alerts that only arrive when something real changed, and a background that keeps working while the window is closed. Kairos had most of the machinery for this. A restructure in progress (October 2026) removed the surfaces that exposed it.

## Where Kairos stood on 13 October 2026

- Four tabs: Home, Advisor, Add files, Settings. Exam prep and practice opened as full-screen takeovers.
- Built but unreachable: the calendar view, spaced review (`ReviewSession`), the "what changed" ledger, Top 3, commitment, the only undo (`NarrateAfter`), the command palette. About fifteen IPC readers had no caller.
- Home showed three items and no way to see the rest. Opening Ask hid the next move, and the last answer reopened on every launch.
- Exam prep always said the exam's scope was unknown, because it was never given the course's modules or objectives.
- The voice sheet was mounted but nothing could start it. No notifications, no global shortcut, no deep links, autostart registered but never enabled.
- The Chrome extension only ran on `canvas.colorado.edu` and `*.instructure.com`, and nothing in the app installed its native host.

## Sixteen themes

| # | Theme | Who does it well | What it means for Kairos |
|---|---|---|---|
| 1 | One next action, quiet list | Things Today, Todoist, Mercury's balance, Watch Duty | Today opens on one focus block. Everything else is a hairline row. |
| 2 | Signal becomes advice | Harvee (recovery → "rest tonight"), Flighty; Oura's unactionable scores are the failure case | Every focus block and every changed row carries one consequence sentence from grade truth and cost-of-skipping. Never a bare number. |
| 3 | Hierarchy that tightens under stress | Watch Duty, Tide Guide | **Exam-week mode:** a weighted exam three days out or less replaces Today's focus block with that exam's path. One link restores the whole day. |
| 4 | Defer on purpose, honest capacity | Sunsama (D / Z), Structured Replan, To Do's empty My Day | Week sums estimated work against the hours the student actually has, says "This week is full" in a sentence, and offers Defer as a plain action. |
| 5 | Suggest, wait for yes, then stop | Morgen, Attio's approval-before-write, Shortwave's bulk confirm; Motion is the counter-example | Plan order and calendar blocks are proposals in a sheet that shows what would change. After yes, nothing moves on its own. |
| 6 | The shortcut sits beside the action | Linear, Superhuman, Raycast, Vercel, Stripe's `?` | ⌘K everywhere. Recent items when empty, the key shown next to each action, J/K on rows, `?` lists shortcuts. |
| 7 | A typed line shows its date before it saves | Todoist Quick Add, Fantastical, Apple Reminders | The capture line parses "read ch 5 thu" and shows "Thu, Oct 16" under the text before anything is written. |
| 8 | Capture from a small panel | Reminders in Control Center, Things Quick Entry, Wispr Flow's hold-to-talk | An opt-in global hotkey opens a small capture/ask window. Holding the key talks instead of types. |
| 9 | Piles a person can correct | HEY, Superhuman's split inbox, Apple Mail categories | Canvas arrivals land in three piles: needs you, changed, for your info. "Always put this course's announcements here" is asked once, never a trained classifier. |
| 10 | The next step is a place in a sequence | Duolingo's path, Headspace courses | Study is a path: reviews due, then each upcoming exam's track ("Day 2 of 4"), then open practice. Position is plain text. |
| 11 | A ritual you can skip without losing anything | Sunsama's planning flow, OmniFocus Review, Structured Replan | An optional "Plan this week": what changed, what is left from last week, the proposed order, accept. No count of weeks planned. |
| 12 | Rare, relevant alerts | Flighty | Native notifications for three things only: a due date moved, high-stakes work within 48 hours that has not been started, sync is broken. Quiet at night and during class. At most three a day. |
| 13 | Local-first speed and undo | Linear's local database, Obsidian's folder | Writes land in `{user_root}` first and the screen updates at once. Defer and accept show an undo toast. The window can close; sync keeps running. |
| 14 | Value before setup | Moonlitt, Attio's preloaded onboarding, Halide's hidden manual controls, Plain | First run is the three steps the landing page promises, then lands on a real next move. Profile questions are asked where they matter (Advisor asks for the program). Advanced sources are folded away. |
| 15 | Color means a state or a course | Stripe payment states, Mercury, Google Maps traffic | Already MASTER §03. Enforce it where it slipped: the extension badge and dashboard stage, and the tray peek window's glass. |
| 16 | The sentence you are in is the only one at full strength | iA Writer focus mode, Typora | Study keeps one question at reading size. Exam-week mode applies the same rule to the whole app. |

## Leave list

| Pattern | Why it stays out |
|---|---|
| A streak you can lose, energy meters, a daily crown (Duolingo, TickTick, Oura) | CLAUDE.md: no losable state on `learn_loop`/`habit`. MASTER §08: no guilt. |
| A feed that starts itself (Spotify Home, YouTube Shorts, Venmo) | The week is the job; nothing sits in front of it. |
| A calendar that keeps moving tasks (Motion, Reclaim) | The block that moves might be a class. Theme 5 is the replacement. |
| Shared drafts, presence, study-group threads (Front, Missive, Figma, Slack) | Canvas-focus pivot: Kairos never acts toward an instructor or classmate. |
| Many views of one database (Notion, monday, Trello boards) | One organizing system: course, then item. Views are filters of the same list. |
| Readiness scores (Oura) | A number the student cannot act on. Theme 2 says the action instead. |

## New structure

Sidebar: **Today, Week, Courses, Study, Advisor**, with Settings at the bottom. ⌘K from anywhere. Ask is a sheet that never covers the next move. Files can be dropped on any screen.

| Surface | What the student sees | Themes |
|---|---|---|
| Today | Date and greeting. One focus block: the next move, why it matters in one sentence, one button. "3 things changed since you last looked" as a single row. The rest of today as rows. The semester line. In exam week, the exam's path replaces the focus block. | 1, 2, 3, 16 |
| Week | One capacity sentence ("About 11 hours of work and 8 free. Move two things?"). The three piles. Days as hairline sections, each row with Defer. "Plan this week" when the student wants it. Calendar suggestions in a sheet that waits for yes. | 4, 5, 9, 11, 13 |
| Courses | One row per course: tag, Canvas grade next to the grade with missing work as zero, next due. A course page with grade truth, cost of skipping on each open item, the Start here / Learn / Do / Check map, exam dates, and the course's files. | 2, 15 |
| Study | The path: reviews due today, then exam tracks, then practice. The session screen stays one question at a time. | 10, 16 |
| Advisor | As built, plus an "Add your audit" button, inline profile fields, and a GPA what-if row. | 2, 14 |
| ⌘K | Do (actions with keys), Go (courses and items), Add (the capture line), Ask (anything else). | 6, 7 |
| Capture shortcut | The opt-in global shortcut brings Kairos forward with ⌘K on the capture line. Hold-to-talk waits on a decision about voice keys for students. | 7, 8 |
| Notifications | The three triggers above, each opening the right screen through `kairos://`. | 12 |
| Menu bar | "Next: …", Open Today, Capture, Sync now, Quit. No glass. | 1, 13, 15 |
| Chrome extension | One focus block, the piles, the capture line. "Open in Kairos". Runs on any school's Canvas domain after the student grants it. | 1, 7, 9 |
| First run | Find school, sign in (and add the extension while Chrome is open), classes arrive, Today. | 14 |

## Outside-the-box ideas worth building

- **Exam-week mode.** The app shrinks to the exam when it matters most, and says so in one line.
- **A consequence on every row.** "Skip it: 84% → 79%." Cost-of-skipping already exists in the extension; it moves into the app.
- **Ask once per course.** The first time a course's announcement lands in the wrong pile, the student moves it and picks "always". No model guesses.
- **Leftovers on Monday.** Unfinished work from last week shows up first in the weekly plan, without a count of what was missed.
- **Quiet during class.** Notifications read class times from the connected calendar and hold until class ends.
- **Hold to talk.** The global hotkey captures by voice when held, using the two existing local voice tools. Not built yet: voice needs a Gemini key the packaged app has no way to give students.

## Build order

0. This doc, MASTER.md recipes, CLAUDE.md and architecture notes.
1. Shell and Today: the new sidebar and routing, ⌘K, Ask as a sheet, sync actions in the banner, the item sheet's keyboard fixes, and the live-assessment block in Ask (AI-eval F4/F4c) before Ask becomes easier to reach.
2. Week: estimates, available hours, deferrals, accepted plan, piles, the weekly plan flow, undo.
3. Courses, the Study path, exam-week mode, exam scope from course modules, Advisor and Settings cleanup.
4. Capture line, global hotkey window, hold-to-talk voice.
5. Native: notifications, autostart, keep running after close, non-blocking sync, tray menu, deep links.
6. Extension (any school, piles, capture, deep links, MASTER fixes), first run, landing copy.

## Guardrails that do not change

No Canvas-visible writes. Calendar and email writes stay behind the confirmation guard. No losable state; notifications never guilt. Canvas text is untrusted. Feed URLs stay in `auth/feeds.json`. Voice keeps exactly two local tools. One highlighter per screen.
