export default async ({ page, shot, wait }) => {
  await wait(1200);
  await page.getByRole("tab", { name: "Settings" }).click();
  await page.locator(".settings-index button", { hasText: /^Canvas$/ }).click();
  await wait(2500);
  await page.locator(".template-list li", { hasText: "MATH 1300" }).first().getByRole("button", { name: "Import" }).click();
  await wait(2000);
  console.log("notice:", await page.locator(".notice, [role=alert]").allInnerTexts());
  await page.getByRole("tab", { name: "Study" }).click();
  await wait(2500);
  await shot("study-offer");
  console.log("buttons:", await page.locator("main button").allInnerTexts());
  const start = page.getByRole("button", { name: /^(Start|Begin|Try it|Practice|Learn|Review)/ }).first();
  if (await start.count()) { await start.click(); await wait(2000); }
  await shot("attempt");
  const box = page.locator("main textarea, main input[type=text]").first();
  if (await box.count()) {
    await box.fill("6(2x+1)^2");
    await wait(1500);
    await page.reload();
    await wait(3000);
    await shot("after-reload");
    console.log("draft after reload:", await page.locator("main textarea, main input[type=text]").first().inputValue().catch(() => "(no field)"));
    const check = page.getByRole("button", { name: /Check my answer/ });
    if (await check.count()) { await check.click(); await wait(2500); await shot("feedback"); }
  }
};
