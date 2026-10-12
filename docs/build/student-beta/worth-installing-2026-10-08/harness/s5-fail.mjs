export default async ({ page, shot, wait, mode }) => {
  await wait(800);
  await page.click("text=My school isn't listed");
  await page.fill("#canvas-host", "canvas.example.edu");
  await page.check("input[type=checkbox]");
  await page.click("text=Continue");
  await wait(2000);
  await page.click("text=Sign in to Canvas");
  await wait(1500);
  await shot("sso-failed");
  await mode("sso=ok");
  await page.getByRole("button", { name: /Try again/ }).click();
  await wait(3000);
  await shot("after-retry-sync-failed");
  await wait(2000);
  await shot("landing-after-failed-sync");
};
