/**
 * Open Canvas headed so the student can complete SSO + MFA.
 * Reuses {user_root}/auth/browser for later npm run sync.
 */
import { BASE, launchCanvasContext } from "./lib/canvas-session.mjs";

const { context } = await launchCanvasContext();
let exitCode = 0;
let watch;
// Attach before touching pages: closing the last stale page can end the
// context, and the student closing the window is how sign-in finishes.
context.on("close", () => {
  clearInterval(watch);
  process.exit(exitCode);
});
// A persistent profile can reopen a half-finished SAML tab. Keep its cookies,
// but never reuse an old POST/redirect page for a new login attempt. Open the
// fresh page first: closing the last page can take the whole browser down.
const stalePages = context.pages();
const page = await context.newPage();
for (const existing of stalePages) {
  await existing.close().catch(() => undefined);
}
await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60_000 });

// Only the school's identity provider shows these pages; Canvas course content
// can contain the same words and must never end a signed-in session.
const canvasHost = new URL(BASE).host;
const staleRequest = /stale request|used the back button|secure web site|bookmarked the web login form/i;
watch = setInterval(async () => {
  if (page.isClosed()) return;
  try {
    if (new URL(page.url()).host === canvasHost) return;
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
1. Complete your school's sign-in + MFA if prompted.
2. Confirm you see your dashboard.
3. Close the browser window when done (session kept in {user_root}/auth/browser/).
4. Then: npm run sync
`);
