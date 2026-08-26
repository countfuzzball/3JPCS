import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";

const npyPath = fileURLToPath(new URL("../fixtures/terrain/terrain-v1-c.npy", import.meta.url));
const descriptorPath = fileURLToPath(new URL("../fixtures/terrain/terrain-descriptor.json", import.meta.url));
const catalogPath = fileURLToPath(new URL("../../examples/asset_catalog.json", import.meta.url));

test("places, edits, pads, locks, layers, frontage, and undoes catalogue prefabs", async ({ page }) => {
  await createProject(page);
  const canvas = page.locator("canvas[aria-label='Top-down terrain viewport']");
  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();
  const center = { x: bounds!.x + bounds!.width / 2, y: bounds!.y + bounds!.height / 2 };
  const roadY = center.y - 220;

  await page.getByRole("button", { name: /^━ Road$/ }).click();
  await page.mouse.click(center.x - 170, roadY);
  await page.mouse.click(center.x + 170, roadY);
  await page.keyboard.press("Enter");
  await expect(page.locator("#inspector-title")).toHaveText("Road");

  await page.locator("#asset-catalog-file").setInputFiles(catalogPath);
  await expect(page.locator("#asset-summary")).toContainText("2 assets");
  await expect(page.getByLabel("Placement asset")).toBeEnabled();
  await page.getByLabel("Placement asset").selectOption("example_house");

  const placeTool = page.getByRole("button", { name: /Place prefab/ });
  await placeTool.click();
  await expect(placeTool).toHaveAttribute("aria-pressed", "true");
  await page.mouse.move(center.x, center.y);
  await page.keyboard.press("Escape");
  await expect(page.locator("#status-message")).toHaveText("Draft cancelled");
  await page.mouse.click(center.x, center.y);
  await expect(page.locator("#inspector-title")).toHaveText("Example House");
  await expect(page.getByLabel("Asset", { exact: true })).toHaveValue("example_house");
  await expect(page.getByLabel("Category")).toHaveValue("house");

  await page.getByLabel("Frontage road").selectOption({ index: 1 });
  await page.getByLabel("Enabled", { exact: true }).check();
  await page.getByLabel("Pad width (m)").fill("4");
  await page.getByLabel("Pad depth (m)").fill("4");
  await page.getByLabel("Blend distance (m)").fill("0");
  await page.getByRole("button", { name: "Apply properties" }).click();
  await expect(page.locator(".site-information")).toContainText("Elevation range");
  await expect(page.locator("#undo")).toHaveAttribute("title", "Undo Edit properties");

  await page.getByRole("button", { name: "Rotate +15°" }).click();
  await expect(page.getByLabel("Rotation (deg)")).toHaveValue("15");
  await page.keyboard.press("Control+z");
  await expect(page.getByLabel("Rotation (deg)")).toHaveValue("0");
  await page.keyboard.press("Control+y");
  await expect(page.getByLabel("Rotation (deg)")).toHaveValue("15");
  await page.getByLabel("Rotation (deg)").fill("375");
  await page.getByRole("button", { name: "Apply properties" }).click();
  await expect(page.getByLabel("Rotation (deg)")).toHaveValue("15");

  await page.getByLabel("Scale").fill("3");
  await page.getByRole("button", { name: "Apply properties" }).click();
  await expect(page.getByLabel("Pad width (m)")).toHaveValue("4");
  await expect(page.getByLabel("Pad depth (m)")).toHaveValue("4");
  await page.getByLabel("Scale").fill("0.5");
  await page.getByRole("button", { name: "Apply properties" }).click();

  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x + 45, center.y + 25, { steps: 3 });
  await page.mouse.up();
  await expect(page.locator("#undo")).toHaveAttribute("title", "Undo Move prefab");
  await page.keyboard.press("Control+z");

  await page.getByLabel("Locked").check();
  await page.getByRole("button", { name: "Apply properties" }).click();
  const lockedRotation = await page.getByLabel("Rotation (deg)").inputValue();
  await page.keyboard.press("e");
  await expect(page.getByLabel("Rotation (deg)")).toHaveValue(lockedRotation);
  await expect(page.getByRole("button", { name: "Reset to disabled placement default" })).toBeDisabled();
  await page.getByLabel("Locked").uncheck();
  await page.getByRole("button", { name: "Apply properties" }).click();

  await page.getByRole("checkbox", { name: /Prefabs/ }).uncheck();
  await expect(page.getByRole("checkbox", { name: /Prefabs/ })).not.toBeChecked();
  await canvas.click({ position: { x: bounds!.width / 2, y: bounds!.height / 2 } });
  await expect(page.locator("#inspector-title")).not.toHaveText("Example House");
  await page.getByRole("checkbox", { name: /Prefabs/ }).check();
  await canvas.click({ position: { x: bounds!.width / 2, y: bounds!.height / 2 } });
  await expect(page.locator("#inspector-title")).toHaveText("Example House");

  await page.getByRole("checkbox", { name: /Prefabs/ }).uncheck();
  await canvas.click({ position: { x: bounds!.width / 2, y: bounds!.height / 2 - 220 } });
  await expect(page.locator("#inspector-title")).toHaveText("Road");
  await page.keyboard.press("Delete");
  await page.getByRole("checkbox", { name: /Prefabs/ }).check();
  await canvas.click({ position: { x: bounds!.width / 2, y: bounds!.height / 2 } });
  await expect(page.locator("#inspector-title")).toHaveText("Example House");
  await expect(page.getByLabel("Frontage road")).toHaveValue("");

  await page.getByLabel("X (m)").fill("0");
  await page.getByLabel("Z (m)").fill("0");
  await page.getByRole("button", { name: "Apply properties" }).click();
  await expect(page.locator(".site-information")).toHaveClass(/is-warning/);
  await page.getByRole("button", { name: "Reset to disabled placement default" }).click();
  await expect(page.getByLabel("Enabled", { exact: true })).not.toBeChecked();
  await expect(page.getByLabel("Pad width (m)")).toHaveValue("12");
  await expect(page.getByLabel("Blend distance (m)")).toHaveValue("8");
});

async function createProject(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Choose terrain sources" }).click();
  await page.getByLabel("Project name").fill("Milestone Three County");
  await page.locator("#terrain-npy").setInputFiles(npyPath);
  await page.locator("#terrain-descriptor").setInputFiles(descriptorPath);
  await page.getByRole("button", { name: "Validate & create project" }).click();
  await expect(page.getByText("Milestone Three County").first()).toBeVisible();
  await expect(page.locator("#asset-catalog-file")).toBeEnabled();
}
