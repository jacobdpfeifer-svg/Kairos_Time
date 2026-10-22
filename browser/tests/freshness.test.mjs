import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { extractActions, htmlToText } from "../scripts/lib/freshness/actions.mjs";
import {
  classifyDelta,
  collapseByGroup,
  eventsFromPlanner,
  eventsFromStream,
  summarySignature,
} from "../scripts/lib/freshness/classify.mjs";
import { atomObject, parseAtom, parseIcs } from "../scripts/lib/freshness/feeds-parse.mjs";
import { announcementEvents, captureIsStale, feedHash, feedLinksFromHtml, feedList, pollFeeds, splitIcsSummary } from "../scripts/lib/canvas-feeds.mjs";
import { diffGenerations } from "../scripts/lib/canvas-changes.mjs";
import { computeSkipCosts } from "../scripts/lib/skip-cost.mjs";
import { buildDashboard, pickNextStep } from "../scripts/lib/freshness-dashboard.mjs";
import { afterCanonicalSync, runFreshnessTick, validDelta } from "../scripts/lib/freshness-run.mjs";
import { freshnessPaths, readEvents, writeFeedsSecret } from "../scripts/lib/freshness-store.mjs";

const NOW = Date.parse("2026-09-29T18:00:00Z");
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const isoAt = (ms) => new Date(ms).toISOString();

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pn-fresh-"));
}

describe("announcement actions", () => {
  it("turns Canvas HTML into text", () => {
    assert.equal(htmlToText("<p>Hi&nbsp;all,</p><p>Lab is <b>cancelled</b> &amp; moved.</p>"), "Hi all,\nLab is cancelled & moved.");
  });

  it("keeps changes, exams and dated deadlines; drops pleasantries and undated chores", () => {
    const text = htmlToText(`
      <p>Hi everyone, hope your week is going well!</p>
      <p>Thursday's lecture is cancelled because of the career fair.</p>
      <p>Homework 5 is due Friday at 11:59 pm.</p>
      <p>The midterm covers chapters 1 through 4.</p>
      <p>Remember to check the forum.</p>
      <p>Have a great weekend!</p>`);
    const actions = extractActions(text);
    assert.deepEqual(
      actions.map((a) => a.kind),
      ["change", "deadline", "exam"]
    );
    assert.match(actions[0].text, /cancelled/);
    assert.equal(actions[1].has_date, true);
  });

  it("caps the number of actions", () => {
    const text = Array.from({ length: 6 }, (_, i) => `Quiz ${i + 1} is on Monday.`).join(" ");
    assert.equal(extractActions(text, { limit: 2 }).length, 2);
  });

  it("persists the complete sanitized body separately from the UI preview", () => {
    const body = "Exam logistics: " + "bring your calculator and formula sheet. ".repeat(20);
    const [event] = announcementEvents(
      [{ id: "a1", object_id: "1", title: "Exam reminder", html: `<p>${body}</p>`, published: "2026-09-29T17:00:00Z" }],
      {},
      { course_id: "12", course_name: "MATH 1300" },
      { baselined: true, now: NOW, detectedAt: isoAt(NOW) },
    );
    assert.ok(event.detail.body.length > event.detail.preview.length);
    assert.match(event.detail.body, /bring your calculator/);
  });
});

describe("classifier", () => {
  const stream = [
    {
      type: "Announcement",
      id: 900,
      announcement_id: 55,
      title: "Exam moved",
      message: "<p>The midterm is moved to Tuesday Oct 7.</p>",
      course_id: 12,
      created_at: isoAt(NOW - 2 * HOUR),
      html_url: "https://canvas.example.edu/courses/12/discussion_topics/55",
    },
    {
      type: "Message",
      id: 901,
      notification_category: "Due Date",
      title: "Assignment Due Date Changed: HW 5, APPM 1235",
      message: "HW 5 is now due Oct 3",
      created_at: isoAt(NOW - HOUR),
      course_id: 12,
    },
    {
      type: "Message",
      id: 902,
      notification_category: "Due Date",
      title: "Assignment Created - Lab 3, APPM 1235",
      created_at: isoAt(NOW - HOUR),
    },
    {
      type: "Submission",
      id: 903,
      assignment_id: 77,
      workflow_state: "graded",
      score: 9,
      grade: "9",
      graded_at: isoAt(NOW - 3 * HOUR),
      assignment: { name: "Quiz 2", points_possible: 10 },
      course_id: 12,
    },
    {
      type: "Announcement",
      id: 904,
      announcement_id: 56,
      title: "Old news",
      message: "<p>Welcome to the course.</p>",
      created_at: isoAt(NOW - 30 * DAY),
    },
  ];

  it("maps stream items to events and ignores history on the first look", () => {
    const { events, state } = eventsFromStream(stream, {}, { now: NOW });
    assert.deepEqual(
      events.map((e) => [e.kind, e.key]),
      [
        ["announcement", "announcement:55"],
        ["due_changed", "message:901"],
        ["assignment_added", "message:902"],
        ["graded", `graded:77:${isoAt(NOW - 3 * HOUR)}`],
      ]
    );
    assert.equal(events[1].title, "HW 5");
    assert.equal(events[2].title, "Lab 3");
    assert.equal(events[0].actions[0].kind, "change");
    assert.ok(state.stream_baselined_at);
  });

  it("records a planner baseline, then reports added items and moved due dates", () => {
    const first = [
      { plannable_type: "assignment", plannable_id: 1, course_id: 12, plannable: { title: "HW 5", due_at: "2026-10-02T05:59:00Z" } },
    ];
    const a = eventsFromPlanner(first, {}, { now: NOW });
    assert.equal(a.events.length, 0);
    const second = [
      { plannable_type: "assignment", plannable_id: 1, course_id: 12, plannable: { title: "HW 5", due_at: "2026-10-04T05:59:00Z" } },
      { plannable_type: "quiz", plannable_id: 2, course_id: 12, plannable: { title: "Quiz 3", due_at: "2026-10-06T05:59:00Z" } },
      { plannable_type: "calendar_event", plannable_id: 3, course_id: 12, plannable: { title: "Office hours" } },
    ];
    const b = eventsFromPlanner(second, a.state, { now: NOW + HOUR });
    assert.deepEqual(b.events.map((e) => e.kind).sort(), ["assignment_added", "due_changed"]);
    const moved = b.events.find((e) => e.kind === "due_changed");
    assert.equal(moved.detail.from, "2026-10-02T05:59:00.000Z");
    assert.equal(moved.detail.to, "2026-10-04T05:59:00.000Z");
  });

  it("collapses duplicate notices of one change and keeps the richer detail", () => {
    const events = [
      { key: "message:1", kind: "due_changed", group: "due:hw 5", detected_at: isoAt(NOW), detail: { preview: "x" } },
      { key: "planner-due:1", kind: "due_changed", group: "due:hw 5", detected_at: isoAt(NOW - HOUR), detail: { from: "a", to: "b" } },
    ];
    const out = collapseByGroup(events);
    assert.equal(out.length, 1);
    assert.equal(out[0].detail.to, "b");
    assert.equal(out[0].detail.preview, "x");
  });

  it("classifies a whole delta and signs summaries stably", () => {
    const { events } = classifyDelta({ stream: stream.slice(0, 1), planner: [] }, {}, { now: NOW });
    assert.equal(events.length, 1);
    const sig = summarySignature([
      { type: "Submission", count: 2, unread_count: 1 },
      { type: "Announcement", count: 5, unread_count: 3 },
    ]);
    assert.equal(sig, "Announcement::5:3|Submission::2:1");
  });
});

const ATOM = (entries) => `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">${entries
  .map(
    (e) => `<entry><id>tag:canvas.instructure.com,2026-09-29:/${e.path}</id><title>${e.title}</title>
      <updated>${e.updated}</updated><published>${e.published || e.updated}</published>
      <link rel="alternate" href="https://canvas.example.edu/x/${e.path}"/>
      <content type="html">${e.content || ""}</content></entry>`
  )
  .join("")}</feed>`;

describe("feed parsing", () => {
  it("parses Canvas Atom entries and object ids", () => {
    const [entry] = parseAtom(
      ATOM([{ path: "discussion_topics/discussion_topic_55", title: "Exam &amp; review", updated: "2026-09-29T10:00:00-06:00", content: "&lt;p&gt;Bring a calculator Friday.&lt;/p&gt;" }])
    );
    assert.equal(entry.type, "discussion_topic");
    assert.equal(entry.object_id, "55");
    assert.equal(entry.title, "Exam & review");
    assert.equal(htmlToText(entry.html), "Bring a calculator Friday.");
    assert.deepEqual(atomObject("tag:x,2026:/wiki_pages/wiki_page_9"), { type: "wiki_page", id: "9" });
  });

  it("parses folded ICS events with UTC, date-only and TZID starts", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:event-assignment-101",
      "SUMMARY:HW 5 [APPM 1235-0",
      " 01]",
      "DTSTART:20261003T055900Z",
      "URL:https://canvas.example.edu/courses/12/assignments/101",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:event-calendar-event-7",
      "SUMMARY:Review session",
      "DTSTART;VALUE=DATE:20261004",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:event-assignment-override-3",
      "SUMMARY:Lab 2\\, part B",
      "DTSTART;TZID=America/Denver:20261005T235900",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const events = parseIcs(ics);
    assert.deepEqual(events.map((e) => e.kind), ["assignment", "calendar_event", "assignment_override"]);
    assert.equal(events[0].summary, "HW 5 [APPM 1235-001]");
    assert.equal(events[0].start, "2026-10-03T05:59:00.000Z");
    assert.equal(events[1].start, "2026-10-04");
    assert.equal(events[2].start, "2026-10-05T23:59:00 America/Denver");
    assert.equal(events[2].summary, "Lab 2, part B");
    assert.deepEqual(splitIcsSummary(events[0].summary), { title: "HW 5", course_name: "APPM 1235-001" });
  });

  it("finds enrollment feed links in course HTML", () => {
    const html = `<link rel="alternate" href="/feeds/announcements/enrollment_AbC-12.atom"><a href="/feeds/courses/enrollment_AbC-12.atom">`;
    assert.deepEqual(feedLinksFromHtml(html), {
      announcements: "/feeds/announcements/enrollment_AbC-12.atom",
      content: "/feeds/courses/enrollment_AbC-12.atom",
    });
  });
});

describe("feed watcher", () => {
  const feeds = {
    captured_at: isoAt(NOW - DAY),
    base: "https://canvas.example.edu/",
    ics: "https://canvas.example.edu/feeds/calendars/user_SECRET1.ics",
    courses: {
      12: {
        name: "APPM 1235",
        announcements: "https://canvas.example.edu/feeds/announcements/enrollment_SECRET2.atom",
        content: "https://canvas.example.edu/feeds/courses/enrollment_SECRET3.atom",
      },
    },
  };

  function server(bodies) {
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(url);
      const body = bodies[url];
      if (body == null) return { ok: false, status: 404, text: async () => "" };
      return { ok: true, status: 200, text: async () => body };
    };
    return { calls, fetchImpl };
  }

  it("polls only https feeds on the captured Canvas origin", () => {
    assert.equal(feedList({ ...feeds, base: "" }).length, 0);
    assert.equal(feedList({ ...feeds, base: "not a url" }).length, 0);
    const foreign = feedList({
      ...feeds,
      ics: "https://evil.example/secret.ics",
      courses: { 12: { ...feeds.courses[12], announcements: "https://other.example/a.atom", content: feeds.courses[12].content } },
    });
    assert.deepEqual(foreign.map((f) => f.cls), ["content"]);
  });

  it("treats a feed redirect as a failed poll and does not read the body", async () => {
    const fetchImpl = async (_url, init) => {
      assert.equal(init.redirect, "manual");
      return { ok: false, status: 302, text: async () => { throw new Error("redirect body was read"); } };
    };
    const { events, polled } = await pollFeeds({ feeds, now: NOW, fetchImpl, force: true });
    assert.equal(events.length, 0);
    assert.equal(polled.length, 3);
    assert.ok(polled.every((p) => p.ok === false && p.status === 302));
  });

  const recentAnn = { path: "discussion_topics/discussion_topic_55", title: "Exam moved", updated: isoAt(NOW - DAY), content: "&lt;p&gt;The midterm moved to Tuesday.&lt;/p&gt;" };
  const oldAnn = { path: "discussion_topics/discussion_topic_40", title: "Welcome", updated: isoAt(NOW - 20 * DAY) };
  const hw = { path: "assignments/assignment_101", title: "HW 5", updated: isoAt(NOW - 5 * DAY) };
  const page = { path: "wiki_pages/wiki_page_9", title: "Syllabus", updated: isoAt(NOW - 5 * DAY) };
  const ics1 = "BEGIN:VEVENT\r\nUID:event-assignment-101\r\nSUMMARY:HW 5 [APPM 1235]\r\nDTSTART:20261003T055900Z\r\nEND:VEVENT";

  it("baselines each feed, surfacing only last-week announcements on the first look", async () => {
    const { fetchImpl } = server({
      [feeds.courses[12].announcements]: ATOM([recentAnn, oldAnn]),
      [feeds.courses[12].content]: ATOM([hw, page]),
      [feeds.ics]: ics1,
    });
    const { events, state, polled } = await pollFeeds({ feeds, now: NOW, fetchImpl });
    assert.equal(polled.length, 3);
    assert.deepEqual(events.map((e) => e.key), ["announcement:55"]);
    assert.equal(events[0].course_name, "APPM 1235");
    assert.equal(events[0].actions[0].kind, "change");
    const stateText = JSON.stringify(state);
    assert.ok(!/SECRET/.test(stateText), "watcher state must not repeat feed tokens");
    assert.ok(state[feedHash(feeds.ics)]);
  });

  it("reports new items, page edits and moved due dates on later looks, and respects cadence", async () => {
    const first = server({
      [feeds.courses[12].announcements]: ATOM([recentAnn]),
      [feeds.courses[12].content]: ATOM([hw, page]),
      [feeds.ics]: ics1,
    });
    const a = await pollFeeds({ feeds, now: NOW, fetchImpl: first.fetchImpl });
    const later = server({
      [feeds.courses[12].announcements]: ATOM([recentAnn, { path: "discussion_topics/discussion_topic_57", title: "Lab cancelled", updated: isoAt(NOW + HOUR), content: "No lab Thursday." }]),
      [feeds.courses[12].content]: ATOM([
        { ...hw, updated: isoAt(NOW + HOUR) },
        { ...page, updated: isoAt(NOW + HOUR) },
        { path: "assignments/assignment_102", title: "HW 6", updated: isoAt(NOW + HOUR) },
      ]),
      [feeds.ics]: ics1.replace("20261003T055900Z", "20261004T055900Z"),
    });
    const tooSoon = await pollFeeds({ feeds, state: a.state, now: NOW + 5 * 60 * 1000, fetchImpl: later.fetchImpl });
    assert.equal(tooSoon.polled.length, 0);
    const b = await pollFeeds({ feeds, state: a.state, now: NOW + 2 * HOUR, fetchImpl: later.fetchImpl });
    const byKind = Object.fromEntries(b.events.map((e) => [e.kind + ":" + e.title, e]));
    assert.ok(byKind["announcement:Lab cancelled"]);
    assert.ok(byKind["assignment_added:HW 6"]);
    assert.ok(byKind["page_updated:Syllabus"]);
    assert.ok(!byKind["page_updated:HW 5"], "assignment <updated> churn is not an edit");
    const moved = byKind["due_changed:HW 5"];
    assert.equal(moved.detail.from, "2026-10-03T05:59:00.000Z");
    assert.equal(moved.detail.to, "2026-10-04T05:59:00.000Z");
    assert.equal(moved.course_name, "APPM 1235");
  });

  it("records feed errors without throwing and prunes feeds that disappeared", async () => {
    const { fetchImpl } = server({});
    const stale = { deadbeefdeadbeef: { seen: {} } };
    const { state, polled, events } = await pollFeeds({ feeds, state: stale, now: NOW, fetchImpl });
    assert.equal(events.length, 0);
    assert.ok(polled.every((p) => !p.ok && p.status === 404));
    assert.equal(state.deadbeefdeadbeef, undefined);
    assert.equal(state[feedHash(feeds.ics)].error.status, 404);
  });

  it("re-captures weekly or when a course is new", () => {
    assert.equal(captureIsStale(null, ["12"], { now: NOW }), true);
    assert.equal(captureIsStale(feeds, ["12"], { now: NOW }), false);
    assert.equal(captureIsStale(feeds, ["12", "13"], { now: NOW }), true);
    assert.equal(captureIsStale(feeds, ["12"], { now: NOW + 8 * DAY }), true);
  });
});

function gen({ assignments, courseId = 12, groups } = {}) {
  return {
    manifest: { finished_at: isoAt(NOW), sync_id: "sync-x" },
    courses: [
      {
        course: { id: courseId, name: "APPM 1235", course_code: "APPM 1235", enrollments: [] },
        assignments,
        "assignment-groups": groups || [
          { id: 1, name: "Homework", group_weight: 40, rules: {} },
          { id: 2, name: "Exams", group_weight: 60, rules: {} },
        ],
      },
    ],
  };
}

describe("snapshot diff", () => {
  const base = { id: 101, name: "HW 5", due_at: "2026-10-03T05:59:00Z", points_possible: 10, description: "<p>Do problems 1-5.</p>", published: true, assignment_group_id: 1 };

  it("detects moved due dates, point changes, edited instructions and new work", () => {
    const prev = gen({ assignments: [base, { ...base, id: 102, name: "Draft", published: false }] });
    const next = gen({
      assignments: [
        { ...base, due_at: "2026-10-04T05:59:00Z", points_possible: 15, description: "<p>Do problems 1-8.</p>", updated_at: "whatever" },
        { ...base, id: 102, name: "Draft", published: true },
        { ...base, id: 103, name: "HW 6" },
      ],
    });
    const events = diffGenerations(prev, next, { now: NOW });
    const kinds = events.map((e) => `${e.kind}:${e.title}`).sort();
    assert.deepEqual(kinds, [
      "assignment_added:Draft",
      "assignment_added:HW 6",
      "due_changed:HW 5",
      "instructions_edited:HW 5",
      "points_changed:HW 5",
    ]);
    assert.equal(events.find((e) => e.kind === "due_changed").detail.to, "2026-10-04T05:59:00.000Z");
  });

  it("ignores updated_at churn, first syncs and newly added courses", () => {
    const prev = gen({ assignments: [base] });
    assert.deepEqual(diffGenerations(prev, gen({ assignments: [{ ...base, updated_at: "2026-09-29T00:00:00Z" }] }), { now: NOW }), []);
    assert.deepEqual(diffGenerations(null, prev, { now: NOW }), []);
    assert.deepEqual(diffGenerations(prev, gen({ assignments: [base], courseId: 99 }), { now: NOW }), []);
  });
});

describe("skip cost", () => {
  it("shows the grade with a zero and with full marks on upcoming work only", () => {
    const g = gen({
      assignments: [
        { id: 1, name: "HW 1", points_possible: 10, assignment_group_id: 1, due_at: isoAt(NOW - 10 * DAY), submission: { score: 9, workflow_state: "graded", posted_at: isoAt(NOW - 9 * DAY), submitted_at: isoAt(NOW - 10 * DAY) } },
        { id: 2, name: "Midterm", points_possible: 100, assignment_group_id: 2, due_at: isoAt(NOW - 8 * DAY), submission: { score: 80, workflow_state: "graded", posted_at: isoAt(NOW - 7 * DAY), submitted_at: isoAt(NOW - 8 * DAY) } },
        { id: 3, name: "HW 2", points_possible: 10, assignment_group_id: 1, due_at: isoAt(NOW + 2 * DAY), submission: { workflow_state: "unsubmitted" } },
        { id: 4, name: "HW 3", points_possible: 10, assignment_group_id: 1, due_at: isoAt(NOW + 40 * DAY), submission: { workflow_state: "unsubmitted" } },
        { id: 5, name: "Done", points_possible: 10, assignment_group_id: 1, due_at: isoAt(NOW + DAY), submission: { workflow_state: "submitted", submitted_at: isoAt(NOW) } },
      ],
    });
    const costs = computeSkipCosts(g, { now: NOW });
    assert.deepEqual(Object.keys(costs), ["12:3"]);
    const c = costs["12:3"];
    assert.equal(c.current, 84);
    assert.equal(c.if_zero, 66);
    assert.equal(c.if_full, 86);
    assert.equal(c.swing, 20);
    assert.equal(c.share_of_final, 10);
    assert.equal(c.status, "ok");
  });

  it("reads like Canvas's current grade when only some weighted groups are graded", () => {
    const g = gen({
      assignments: [
        { id: 1, name: "HW 1", points_possible: 10, assignment_group_id: 1, due_at: isoAt(NOW - 10 * DAY), submission: { score: 9, workflow_state: "graded", posted_at: isoAt(NOW - 9 * DAY), submitted_at: isoAt(NOW - 10 * DAY) } },
        { id: 3, name: "HW 2", points_possible: 10, assignment_group_id: 1, due_at: isoAt(NOW + 2 * DAY), submission: { workflow_state: "unsubmitted" } },
        { id: 7, name: "Final", points_possible: 100, assignment_group_id: 2, due_at: isoAt(NOW + 60 * DAY), submission: { workflow_state: "unsubmitted" } },
      ],
    });
    const c = computeSkipCosts(g, { now: NOW })["12:3"];
    assert.equal(c.current, 90, "not 36 (= 90% x 40 of 100 final points)");
    assert.equal(c.if_zero, 45);
    assert.equal(c.if_full, 95);
    assert.equal(c.share_of_final, 20);
  });

  it("claims no grade share when it cannot calculate or the course is points-based", () => {
    const unweighted = gen({
      assignments: [{ id: 3, name: "HW 2", points_possible: 10, assignment_group_id: 1, due_at: isoAt(NOW + 2 * DAY), submission: { workflow_state: "unsubmitted" } }],
      groups: [{ id: 1, name: "All", group_weight: 0, rules: {} }],
    });
    assert.equal(computeSkipCosts(unweighted, { now: NOW })["12:3"].share_of_final, null);
    const orphan = gen({
      assignments: [{ id: 3, name: "HW 2", points_possible: 10, assignment_group_id: 99, due_at: isoAt(NOW + 2 * DAY), submission: { workflow_state: "unsubmitted" } }],
    });
    const c = computeSkipCosts(orphan, { now: NOW })["12:3"];
    assert.equal(c.status, "cannot_calculate");
    assert.equal(c.share_of_final, null);
  });
});

describe("dashboard", () => {
  const items = [
    { title: "HW 2", course_id: "12", canvas_id: "3", course_code: "APPM 1235", effective_due_at: isoAt(NOW + 2 * DAY), submission_state: "unsubmitted", actionable: true, points_possible: 10, object_type: "assignment", html_url: "u3" },
    { title: "HW 9", course_id: "12", canvas_id: "9", course_code: "APPM 1235", effective_due_at: isoAt(NOW + 5 * DAY), submission_state: "unsubmitted", actionable: true, points_possible: 10, object_type: "assignment" },
    { title: "Old", course_id: "12", canvas_id: "8", course_code: "APPM 1235", effective_due_at: isoAt(NOW - 2 * DAY), submission_state: "missing", actionable: true, points_possible: 10, object_type: "assignment" },
    { title: "Sent", course_id: "12", canvas_id: "7", effective_due_at: isoAt(NOW + DAY), submission_state: "submitted", actionable: true, object_type: "assignment" },
  ];

  it("picks the soonest open item, falling back to recent missing work", () => {
    assert.equal(pickNextStep(items, { now: NOW }).title, "HW 2");
    const fallback = pickNextStep(items.filter((i) => i.title !== "HW 2" && i.title !== "HW 9"), { now: NOW });
    assert.equal(fallback.title, "Old");
    assert.equal(fallback.why, "missing");
  });

  it("prefers a meaningful-point item over a sooner low-point item", () => {
    const ranked = [
      { title: "Tiny", course_id: "12", canvas_id: "1", course_code: "APPM 1235", effective_due_at: isoAt(NOW + DAY), submission_state: "unsubmitted", actionable: true, points_possible: 5, object_type: "assignment" },
      ...items,
    ];
    assert.equal(pickNextStep(ranked, { now: NOW }).title, "HW 2");
  });

  it("builds changes, a digest and logistics-only agent suggestions", () => {
    const events = [
      { key: "announcement:55", kind: "announcement", title: "Exam moved", course_id: "12", at: isoAt(NOW - DAY), detected_at: isoAt(NOW - DAY), actions: [{ kind: "change", text: "Midterm moved to Tuesday." }] },
      { key: "announcement:56", kind: "announcement", title: "FYI", course_id: "12", at: isoAt(NOW - DAY), detected_at: isoAt(NOW - DAY), actions: [] },
      { key: "snap-due:12:9", kind: "due_changed", title: "HW 9", course_id: "12", group: "due:hw 9", detected_at: isoAt(NOW - HOUR), detail: { from: isoAt(NOW + 6 * DAY), to: isoAt(NOW + 5 * DAY) } },
    ];
    const d = buildDashboard({ events, workSurface: { items }, skipCosts: { "12:3": { swing: 20 } }, now: NOW });
    assert.equal(d.next_step.title, "HW 2");
    assert.equal(d.next_step.skip_cost.swing, 20);
    assert.equal(d.changes[0].kind, "due_changed");
    assert.equal(d.changes[0].course, "APPM 1235");
    assert.equal(d.digest.announcements_7d, 2);
    assert.equal(d.digest.with_actions, 1);
    assert.ok(d.agent_can_do.length >= 1 && d.agent_can_do.length <= 3);
    assert.ok(d.agent_can_do.every((a) => a.kind === "calendar_block" && a.suggestion.start < a.suggestion.end));
    assert.match(d.agent_can_do[0].label, /HW 9/);
  });
});

describe("freshness tick", () => {
  it("classifies queued deltas once, rejects bad ones, and writes the dashboard", async () => {
    const root = tmpRoot();
    const p = freshnessPaths(root);
    fs.mkdirSync(p.deltas, { recursive: true });
    const delta = {
      v: 1,
      ts: isoAt(NOW),
      summary: [{ type: "Announcement", count: 1, unread_count: 1 }],
      stream: [{ type: "Announcement", id: 1, announcement_id: 55, title: "Quiz Friday", message: "Quiz 3 is on Friday.", created_at: isoAt(NOW - HOUR), course_id: 12 }],
      planner: [],
    };
    fs.writeFileSync(path.join(p.deltas, "0001.json"), JSON.stringify(delta));
    fs.writeFileSync(path.join(p.deltas, "0002.json"), JSON.stringify({ v: 2 }));
    const r = await runFreshnessTick({ userRoot: root, now: NOW, feeds: false });
    assert.equal(r.new_events, 1);
    assert.equal(r.deltas_processed, 1);
    assert.equal(r.deltas_rejected, 1);
    assert.deepEqual(fs.readdirSync(p.deltas), []);
    const dash = JSON.parse(fs.readFileSync(p.dashboard, "utf8"));
    assert.equal(dash.status.signed_in, true);
    assert.equal(dash.digest.with_actions, 1);

    fs.writeFileSync(path.join(p.deltas, "0003.json"), JSON.stringify(delta));
    const again = await runFreshnessTick({ userRoot: root, now: NOW + HOUR, feeds: false });
    assert.equal(again.new_events, 0, "same announcement is not news twice");
    assert.equal(readEvents(root).length, 1);

    fs.writeFileSync(path.join(p.deltas, "0004.json"), JSON.stringify({ v: 1, ts: isoAt(NOW + 2 * HOUR), signed_in: false }));
    await runFreshnessTick({ userRoot: root, now: NOW + 2 * HOUR, feeds: false });
    assert.equal(JSON.parse(fs.readFileSync(p.dashboard, "utf8")).status.signed_in, false);
  });

  it("validates delta shape", () => {
    assert.equal(validDelta({ v: 1, ts: isoAt(NOW) }), true);
    assert.equal(validDelta({ v: 1, ts: "nope" }), false);
    assert.equal(validDelta({ v: 1, ts: isoAt(NOW), stream: "x" }), false);
    assert.equal(validDelta({ v: 1, ts: isoAt(NOW), stream: new Array(201).fill({}) }), false);
  });

  it("stores feed URLs owner-only", () => {
    const root = tmpRoot();
    writeFeedsSecret(root, { captured_at: isoAt(NOW), courses: {} });
    const mode = fs.statSync(freshnessPaths(root).feedsSecret).mode & 0o777;
    assert.equal(mode, 0o600);
  });

  it("runs the post-sync hook without a session page", async () => {
    const root = tmpRoot();
    const prev = gen({ assignments: [{ id: 3, name: "HW 2", points_possible: 10, assignment_group_id: 1, due_at: isoAt(NOW + 3 * DAY), published: true }] });
    const next = gen({ assignments: [{ id: 3, name: "HW 2", points_possible: 10, assignment_group_id: 1, due_at: isoAt(NOW + 2 * DAY), published: true }] });
    const report = await afterCanonicalSync({ userRoot: root, previous: prev, generation: next, now: NOW });
    assert.deepEqual(report.errors, []);
    assert.equal(report.events, 1);
    assert.equal(report.skip_costs, 1);
    assert.equal(report.feeds_captured, false);
    assert.ok(fs.existsSync(freshnessPaths(root).dashboard));
  });
});
