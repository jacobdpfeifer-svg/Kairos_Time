/**
 * Open Canvas headed so the student can complete SSO + MFA.
 * Reuses {user_root}/auth/browser for later npm run sync.
 */
import { BASE, launchCanvasContext } from "./lib/canvas-session.mjs";

const { context } = await launchCanvasContext();
// A persistent profile can reopen a half-finished SAML tab. Keep its cookies,
// but never reuse an old POST/redirect page for a new login attempt.
for (const existing of context.pages()) {
  await existing.close().catch(() => undefined);
}
const page = await context.newPage();
await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60_000 });

let exitCode = 0;
const staleRequest = /stale request|used the back button|secure web site|bookmarked the web login form/i;
const watch = setInterval(async () => {
  if (page.isClosed()) return;
  try {
    const title = await page.title();
    const body = await page.locator("body").innerText({ timeout: 1_000 });
    if (staleRequest.test(`${title}\n${body}`)) {
      exitCode = 2;
      console.error("login_expired: the school sign-in page expired; restart sign-in from Kairos");
      clearInterval(watch);
      await context.close();
    }
  } catch {
    // The student may be moving through a redirect; the next poll observes it.
  }
}, 1_000);

console.log(`
Opened Canvas in a headed browser.
1. Complete IdentiKey + MFA if prompted.
2. Confirm you see your dashboard.
3. Close the browser window when done (session kept in {user_root}/auth/browser/).
4. Then: npm run sync
`);

context.on("close", () => {
  clearInterval(watch);
  process.exit(exitCode);
});
