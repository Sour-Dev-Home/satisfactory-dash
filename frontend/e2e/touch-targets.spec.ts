import type { Locator } from "@playwright/test";
import { expect, test } from "./fixtures";

// #62: 44 px touch targets. In px on purpose: Tailwind's min-h-11 is 2.75rem, which is only
// 41.25 px at this app's 15 px root size, so a rem-based "44" passed review by eye.

async function expectAtLeast44(target: Locator, name: string) {
  const box = (await target.boundingBox())!;
  expect(box.height, `${name} height`).toBeGreaterThanOrEqual(44);
  expect(box.width, `${name} width`).toBeGreaterThanOrEqual(44);
}

test("the source link has a 44 px tap target and sits apart from the sign-in form", async ({ page, mockApi }) => {
  await mockApi("login");
  await page.goto("/app");
  await page.getByRole("heading", { name: "Sign in" }).waitFor();

  const footer = page.getByRole("contentinfo");
  await expectAtLeast44(footer.getByRole("link", { name: "Source code (AGPL-3.0)" }), "source link");
  const signIn = (await page.getByRole("button", { name: "Sign in" }).boundingBox())!;
  expect((await footer.boundingBox())!.y - (signIn.y + signIn.height)).toBeGreaterThanOrEqual(24);
  await expect(footer).toHaveCSS("border-top-style", "solid");
});

test("the shell's tabs, the Overview rows and the banner's dismiss button are 44 px targets", async ({
  page,
  mockApi,
}) => {
  await mockApi("default");
  await page.goto("/app");
  const nav = page.getByRole("navigation", { name: "Main" });
  for (const tab of ["Overview", "Power", "Factory", "Map", "Settings"]) {
    await expectAtLeast44(nav.getByRole("link", { name: tab }), `${tab} tab`);
  }
  const rows = page.getByRole("list", { name: "Sections" });
  await expectAtLeast44(rows.getByRole("link", { name: /Power/ }), "Power row");
  await expectAtLeast44(page.getByRole("button", { name: "Hide this warning until something changes" }), "dismiss");
});

test("the map's zoom buttons and layer toggle have 44 px tap targets", async ({ page, mockApi }) => {
  await mockApi("default");
  await page.goto("/app/map");
  // Leaflet's own buttons are 30 px; index.css enlarges them.
  await expectAtLeast44(page.getByRole("button", { name: "Zoom in" }), "zoom in");
  await expectAtLeast44(page.getByRole("button", { name: "Zoom out" }), "zoom out");
  await expectAtLeast44(page.locator("label").filter({ hasText: "Buildings" }), "layer toggle");
});
