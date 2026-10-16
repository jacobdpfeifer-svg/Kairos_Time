/**
 * The extension worker answers each surface only for what that surface needs:
 * a content script inside a Canvas page cannot read the student's selection,
 * queue an Ask, grant a school, or pull the beta readout (security pass 2026-10-14).
 */
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { before, describe, it } from "node:test";

const EXT_ID = "jkjkbgcbpakeenemjgkfohbcfbghmall";
const listeners = {};
const nativeCalls = [];
const store = {};
const event = (name) => ({ addListener: (fn) => (listeners[name] = fn) });

globalThis.chrome = {
  runtime: {
    id: EXT_ID,
    lastError: undefined,
    getURL: (p) => `chrome-extension://${EXT_ID}/${String(p).replace(/^\//, "")}`,
    getManifest: () => ({ version: "test" }),
    onMessage: event("message"),
    onInstalled: event("installed"),
    onStartup: event("startup"),
    sendNativeMessage: (_host, msg, cb) => {
      nativeCalls.push(msg.type);
      cb({ ok: true });
    },
  },
  storage: {
    local: {
      get: async (keys) => {
        const list = Array.isArray(keys) ? keys : [keys];
        return Object.fromEntries(list.filter((k) => k in store).map((k) => [k, store[k]]));
      },
      set: async (values) => Object.assign(store, values),
    },
  },
  alarms: { create() {}, get: async () => ({}), onAlarm: event("alarm") },
  action: { setBadgeText() {}, setBadgeBackgroundColor() {}, setBadgeTextColor() {}, setTitle() {} },
  permissions: { contains: async () => true, onRemoved: event("permRemoved") },
  scripting: { getRegisteredContentScripts: async () => [], registerContentScripts: async () => {}, unregisterContentScripts: async () => {} },
  tabs: { query: async () => [], sendMessage: async () => ({ text: "" }) },
  sidePanel: { setPanelBehavior: async () => {} },
};

before(async () => {
  await import(pathToFileURL(path.resolve("../app/extension-chrome/sw.js")).href);
});

/** Returns the reply, or "ignored" when the worker declines to answer. */
function send(msg, sender) {
  return new Promise((resolve) => {
    const handled = listeners.message(msg, sender, resolve);
    if (handled !== true) resolve("ignored");
  });
}

const PANEL = { id: EXT_ID, url: `chrome-extension://${EXT_ID}/panel.html` };
const CANVAS_TAB = { id: EXT_ID, url: "https://canvas.colorado.edu/courses/1", tab: { id: 7 }, frameId: 0 };
const OTHER_EXTENSION = { id: "abcdefghijklmnopabcdefghijklmnop", url: "chrome-extension://abcdefghijklmnopabcdefghijklmnop/x.html" };

describe("extension worker sender checks", () => {
  for (const type of ["queue_ask", "enable_school", "beta_readout", "get_school", "assignment_context", "panel_seen"]) {
    it(`a Canvas content script cannot send ${type}`, async () => {
      assert.equal(await send({ type, content: "x", base: "https://evil.example/" }, CANVAS_TAB), "ignored");
    });
  }

  it("another extension is ignored entirely", async () => {
    assert.equal(await send({ type: "get_view" }, OTHER_EXTENSION), "ignored");
  });

  it("malformed messages are ignored", async () => {
    assert.equal(await send(null, PANEL), "ignored");
    assert.equal(await send({ type: ["queue_ask"] }, PANEL), "ignored");
  });

  it("the side panel may read the beta readout", async () => {
    const reply = await send({ type: "beta_readout" }, PANEL);
    assert.equal(reply.ok, true);
  });

  it("a content script may still say hello and log funnel events", async () => {
    assert.equal((await send({ type: "hello" }, CANVAS_TAB)).ok, true);
    assert.equal((await send({ type: "funnel", event: "dashboard_view" }, CANVAS_TAB)).ok, true);
  });

  it("hello from a sub-frame does not set the school", async () => {
    const reply = await send({ type: "hello" }, { ...CANVAS_TAB, frameId: 3 });
    assert.equal(reply.ok, false);
  });

  it("no refused message ever reached the native host", () => {
    assert.ok(!nativeCalls.includes("queue_ask"));
  });
});
