// Usage: node drive.mjs <scenario.mjs>  — scenario exports async (ctx) => {}
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
const require = createRequire(process.env.REPO + "/browser/package.json");
const { chromium } = require("playwright");
const H = path.dirname(new URL(import.meta.url).pathname);
const OUT = process.env.OUT;
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const vw = Number(process.env.VW || 1080), vh = Number(process.env.VH || 740);
const context = await browser.newContext({ viewport: { width: vw, height: vh }, reducedMotion: process.env.REDUCED ? "reduce" : "no-preference", colorScheme: process.env.SCHEME || "light" });
if (process.env.STATE) await context.addInitScript((s) => { for (const [k, v] of Object.entries(JSON.parse(s))) localStorage.setItem(k, v); }, process.env.STATE);
await context.addInitScript({ path: path.join(H, "shim.js") });
const page = await context.newPage();
const events = [];
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") events.push(`[console.${m.type()}] ${m.text()}`); });
page.on("pageerror", (e) => events.push(`[pageerror] ${e.message}`));
let n = 0;
const ctx = {
  page,
  async shot(name) {
    n += 1;
    const file = path.join(OUT, `${String(n).padStart(2, "0")}-${name}.png`);
    await page.screenshot({ path: file, fullPage: true });
    const text = (await page.locator("body").innerText()).replace(/\n{2,}/g, "\n").trim();
    const hscroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    console.log(`\n=== ${n} ${name}${hscroll ? "  [HORIZONTAL SCROLL]" : ""}\n${text.slice(0, 1500)}`);
  },
  async mode(q) { await fetch(`http://127.0.0.1:1431/mode?${q}`); },
  async hlog() { return (await fetch("http://127.0.0.1:1431/log")).json(); },
  wait: (ms) => page.waitForTimeout(ms),
};
try {
  await page.goto(process.env.URL || "http://127.0.0.1:1430/");
  const scenario = (await import(path.resolve(process.argv[2]))).default;
  await scenario(ctx);
} catch (e) {
  console.log(`\n!!! scenario error: ${e.message}`);
  await ctx.shot("error");
} finally {
  console.log("\n--- console/page errors ---\n" + (events.join("\n") || "(none)"));
  console.log("--- harness log ---\n" + JSON.stringify(await ctx.hlog()));
  await browser.close();
}
