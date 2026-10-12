export default async ({ page, shot, wait }) => {
  await wait(1500);
  await shot("home-narrow");
  const order = [];
  for (let i = 0; i < 14; i++) { await page.keyboard.press("Tab"); order.push(await page.evaluate(() => { const a = document.activeElement; const r = a.getBoundingClientRect(); const cs = getComputedStyle(a); return `${a.tagName}:${(a.textContent||a.getAttribute("aria-label")||"").trim().slice(0,24)}|ring=${cs.outlineStyle!=="none"||cs.boxShadow!=="none"}`; })); }
  console.log("tab order:", order.join("  >  "));
  await page.getByRole("tab", { name: "Study" }).click(); await wait(1500); await shot("study-narrow");
  await page.getByRole("tab", { name: "Settings" }).click(); await wait(800);
  await page.locator(".settings-index button", { hasText: /^Canvas$/ }).click(); await wait(1000); await shot("settings-canvas-narrow");
};
