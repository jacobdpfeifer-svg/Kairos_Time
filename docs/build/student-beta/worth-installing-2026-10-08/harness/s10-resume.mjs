export default async ({ page, shot, wait }) => {
  await wait(1200);
  await page.getByRole("tab", { name: "Study" }).click();
  await wait(2500);
  await page.getByRole("button", { name: "Answer now" }).click();
  await wait(2000);
  const fields = page.locator("main textarea, main input[type=text]");
  console.log("restored drafts:", await fields.evaluateAll((els) => els.map((e) => `${e.getAttribute("aria-label") || e.id}=${e.value}`)));
  await fields.nth(0).fill("2");
  await fields.nth(1).fill("14(2x+1)^6");
  await page.getByRole("button", { name: /Check my answer/ }).click();
  await wait(3000);
  await shot("feedback");
};
