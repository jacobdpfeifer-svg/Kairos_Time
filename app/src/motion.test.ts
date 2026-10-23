import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ATTACK_MS, RELEASE_MS, envelopeStep, tokenMs } from "./motion";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

describe("motion tokens", () => {
  it("keeps the landing page and the extension on the same file as the design system", () => {
    const source = readFileSync(resolve(root, "design-system/kairos/motion.css"), "utf8");
    expect(readFileSync(resolve(root, "landing/motion.css"), "utf8")).toBe(source);
    expect(readFileSync(resolve(root, "app/extension-chrome/ui/motion.css"), "utf8")).toBe(source);
  });

  // Identical copies are worth nothing if a surface cannot load its own. Each
  // @import is resolved against the importing stylesheet, not the package root.
  it("resolves every @import of the tokens to a file that exists", () => {
    const sheets = ["app/extension-chrome/panel.css", "app/extension-chrome/ui/dashboard.css", "app/src/notebook.css"];
    for (const sheet of sheets) {
      const text = readFileSync(resolve(root, sheet), "utf8");
      for (const [, href] of text.matchAll(/@import\s+url\(["']([^"']+)["']\)/g)) {
        expect(existsSync(resolve(root, dirname(sheet), href)), `${sheet} imports ${href}`).toBe(true);
      }
    }
  });

  // A content script loads dashboard.css through a <link>, so Chrome blocks any
  // sub-resource that is not web accessible: the tokens have to be listed too.
  it("exposes the tokens the injected dashboard imports", () => {
    const manifest = JSON.parse(readFileSync(resolve(root, "app/extension-chrome/manifest.json"), "utf8"));
    const resources = manifest.web_accessible_resources.flatMap((entry: { resources: string[] }) => entry.resources);
    expect(resources).toContain("ui/dashboard.css");
    expect(resources).toContain("ui/motion.css");
  });

  it("holds the landing page's link to the tokens", () => {
    for (const page of ["landing/index.html", "landing/go/index.html"]) {
      expect(readFileSync(resolve(root, page), "utf8")).toMatch(/motion\.css/);
    }
  });
});

describe("tokenMs", () => {
  // jsdom loads no stylesheets, so every token reads empty. Callers treat 0 as
  // "act now", which is why a test environment commits without waiting.
  it("reads 0 when the tokens are not loaded", () => {
    expect(tokenMs("--t-settle")).toBe(0);
  });

  it("reads the unit a duration token is written in", () => {
    document.documentElement.style.setProperty("--t-made-up", "240ms");
    expect(tokenMs("--t-made-up")).toBe(240);
    document.documentElement.style.setProperty("--t-made-up", "0.25s");
    expect(tokenMs("--t-made-up")).toBe(250);
    document.documentElement.style.removeProperty("--t-made-up");
  });
});

describe("envelopeStep", () => {
  it("attacks faster than it releases", () => {
    const up = envelopeStep(0, 1, ATTACK_MS);
    const down = envelopeStep(1, 0, ATTACK_MS);
    expect(up).toBeGreaterThan(0.6);
    expect(1 - down).toBeLessThan(up);
    const released = envelopeStep(1, 0, RELEASE_MS);
    expect(released).toBeLessThan(0.4);
  });

  it("holds still when no time has passed", () => {
    expect(envelopeStep(0.4, 1, 0)).toBe(0.4);
  });
});
