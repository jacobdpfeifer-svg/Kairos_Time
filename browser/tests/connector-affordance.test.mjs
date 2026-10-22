/**
 * Nothing outside CONNECTOR_REGISTRY may look connected or offer Connect / OAuth.
 * First-party account reads (Google Calendar, Outlook, AI help) and the
 * "open the Kairos app" line are a frozen allowlist. They are not student-named tools.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { CONNECTOR_REGISTRY, isReviewedConnector } from "../scripts/lib/connector-registry.mjs";
import { WORKSPACE_CAPABILITIES, assertOptionalConnectorsReviewed } from "../scripts/lib/workspace/catalog.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const roots = [path.join(repo, "app/src"), path.join(repo, "app/extension-chrome")];

/** Exact first-party lines. A new Connect button in ConnectorsPanel is not on this list. */
const CONNECTOR_PANEL_LINES = new Set([
  'connected: "Connected",',
  '<span className={`switch ${g.state === "connected" ? "is-on" : ""}`} role="status" aria-label={g.state === "connected" ? "Connected" : "Not connected"} />',
  '<span className={`switch ${o.state === "connected" ? "is-on" : ""}`} role="status" aria-label={o.state === "connected" ? "Connected" : "Not connected"} />',
]);

function allowed(rel, line, connectButtonsSeen) {
  const trimmed = line.trim();
  if (rel === "app/src/views/ConnectorsPanel.tsx") {
    if (CONNECTOR_PANEL_LINES.has(trimmed)) return true;
    // The two existing account rows. A third button that only says Connect still fails.
    if (trimmed === "Connect" && connectButtonsSeen < 2) return true;
    return false;
  }
  if (rel === "app/src/views/SettingsView.tsx" && (/^\s*Connect\s*$/.test(line) || /^\s*Connected\{/.test(line))) return true;
  if (rel === "app/src/ask/AskPanel.tsx" && line.includes("Connect AI help")) return true;
  if (rel === "app/extension-chrome/panel.js" && line.includes("Connect the Kairos app")) return true;
  if (rel === "app/src/missionControl/OperationsIsland.tsx" && line.includes("Google Calendar")) return true;
  if (rel === "app/src/missionControl/fixtures.ts" && line.includes("Google Calendar")) return true;
  if (rel === "app/src/missionControl/AssignmentBrief.tsx" && line.includes("Connected account")) return true;
  return false;
}

function hitsOnLine(line) {
  /** @type {string[]} */
  const hits = [];
  // Capital Connect / Connected is the affordance. Lowercase "connect" is ordinary prose.
  if (/^\s*Connect(?:ed)?\b/.test(line) && !/^\s*(import|\/\/)/.test(line)) hits.push(line.trim());
  const stringRe = /(["'`])(?:\\.|(?!\1).)*?\1/g;
  for (const match of line.matchAll(stringRe)) {
    if (/\bConnect(?:ed)?\b/.test(match[0]) || /oauth/i.test(match[0])) hits.push(match[0]);
  }
  return hits;
}

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
      continue;
    }
    if (/\.test\.(tsx?|jsx?|mjs)$/.test(entry.name)) continue;
    if (!/\.(tsx?|jsx?|mjs|html)$/.test(entry.name)) continue;
    out.push(full);
  }
}

describe("connector affordances", () => {
  it("allows optional_connector only for a reviewed registry id", () => {
    assert.doesNotThrow(() => assertOptionalConnectorsReviewed(WORKSPACE_CAPABILITIES));
    for (const cap of WORKSPACE_CAPABILITIES) {
      if (cap.availability === "optional_connector") {
        assert.equal(isReviewedConnector(cap.id) || isReviewedConnector(cap.connector), true, cap.id);
      }
    }
    assert.equal(isReviewedConnector("campusgroups"), true);
    assert.equal(isReviewedConnector("cu-boulder/campusgroups"), true);
    assert.equal(isReviewedConnector("notion"), false);
    assert.equal(isReviewedConnector("CampusGroups"), true);
    assert.throws(
      () => assertOptionalConnectorsReviewed([{ id: "notion", availability: "optional_connector" }]),
      /not in CONNECTOR_REGISTRY/,
    );
    assert.equal(CONNECTOR_REGISTRY.some((entry) => entry.slug === "notion"), false);
  });

  it("finds no Connect, Connected, or OAuth affordance outside the allowlist", () => {
    /** @type {string[]} */
    const files = [];
    for (const root of roots) walk(root, files);
    /** @type {string[]} */
    const offenders = [];
    let connectButtonsSeen = 0;
    for (const file of files) {
      const rel = path.relative(repo, file);
      const lines = fs.readFileSync(file, "utf8").split("\n");
      lines.forEach((line, index) => {
        if (hitsOnLine(line).length === 0) return;
        const seen = connectButtonsSeen;
        if (rel === "app/src/views/ConnectorsPanel.tsx" && line.trim() === "Connect") connectButtonsSeen += 1;
        if (allowed(rel, line, seen)) return;
        offenders.push(`${rel}:${index + 1}: ${line.trim()}`);
      });
    }
    assert.deepEqual(offenders, []);
  });
});
