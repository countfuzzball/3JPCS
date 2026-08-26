import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";

const npyPath = fileURLToPath(new URL("../fixtures/terrain/terrain-v1-c.npy", import.meta.url));
const descriptorPath = fileURLToPath(new URL("../fixtures/terrain/terrain-descriptor.json", import.meta.url));

test("creates a terrain project and exposes navigation/status controls", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Begin with the world surface" })).toBeVisible();
  await page.getByRole("button", { name: "Choose terrain sources" }).click();
  await page.getByLabel("Project name").fill("Browser Golden County");
  await page.locator("#terrain-npy").setInputFiles(npyPath);
  await page.locator("#terrain-descriptor").setInputFiles(descriptorPath);
  await page.getByRole("button", { name: "Validate & create project" }).click();
  await expect(page.getByText("Browser Golden County").first()).toBeVisible();
  await expect(page.getByText("Triangle terrain")).toBeVisible();
  await expect(page.locator("canvas[aria-label='Top-down terrain viewport']")).toBeVisible();
  await expect(page.getByRole("button", { name: /Fit terrain/ })).toBeEnabled();
  await expect(page.getByText("UNSAVED")).toBeVisible();

  const canvas = page.locator("canvas[aria-label='Top-down terrain viewport']");
  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();
  const center = { x: bounds!.x + bounds!.width / 2, y: bounds!.y + bounds!.height / 2 };
  await page.mouse.move(center.x, center.y);
  const pointBeforeZoom = await page.locator("#status-coordinates").innerText();
  const fitReadout = await page.locator("#view-readout").textContent();
  expect(fitReadout).not.toBeNull();
  await page.mouse.wheel(0, -360);
  await expect(page.locator("#view-readout")).not.toHaveText(fitReadout!);
  await expect(page.locator("#status-coordinates")).toHaveText(pointBeforeZoom);

  await page.mouse.down({ button: "right" });
  await page.mouse.move(center.x + 90, center.y + 45, { steps: 4 });
  await page.mouse.up({ button: "right" });
  await page.mouse.move(center.x, center.y);
  await expect(page.locator("#status-coordinates")).not.toHaveText(pointBeforeZoom);

  await page.keyboard.press("f");
  await expect(page.locator("#view-readout")).toHaveText(fitReadout!);
  await page.getByRole("checkbox", { name: /Terrain colour/ }).uncheck();
  await expect(page.getByRole("checkbox", { name: /Terrain colour/ })).not.toBeChecked();
});
