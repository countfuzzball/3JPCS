import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";

const npyPath = fileURLToPath(new URL("../fixtures/terrain/terrain-v1-c.npy", import.meta.url));
const descriptorPath = fileURLToPath(new URL("../fixtures/terrain/terrain-descriptor.json", import.meta.url));

test("previews and bakes a house frontage as one undoable prefab operation", async ({ page }) => {
  await createProject(page);
  const canvas = page.locator("canvas[aria-label='Top-down terrain viewport']");
  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();
  const center = { x: bounds!.x + bounds!.width / 2, y: bounds!.y + bounds!.height / 2 };
  const roadY = center.y + 190;
  const roadStart = { x: center.x - 280, y: roadY };
  const roadEnd = { x: center.x + 280, y: roadY };

  await page.getByRole("button", { name: /^━ Road$/ }).click();
  await page.mouse.click(roadStart.x, roadStart.y);
  await page.mouse.click(roadEnd.x, roadEnd.y);
  await page.keyboard.press("Enter");
  await expect(page.locator("#inspector-title")).toHaveText("Road");

  await page.locator("#asset-catalog-file").setInputFiles({
    name: "frontage-catalog.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({
      format: "polygon-county-asset-catalog",
      schema_version: 3,
      category_defaults: {
        house: { proxy: { width_m: 2, depth_m: 2, wall_height_m: 3 } },
        shed: { proxy: { width_m: 2, depth_m: 2, wall_height_m: 2 } },
      },
      assets: {
        test_house: { category: "house", resource: "buildings/test-house.glb" },
        test_shed: { category: "shed", resource: "buildings/test-shed.glb" },
      },
    })),
  });
  await page.getByLabel("Placement asset").selectOption("test_shed");
  await expect(page.getByRole("button", { name: /Frontage assist/ })).toBeDisabled();
  await page.getByLabel("Placement asset").selectOption("test_house");

  const frontageTool = page.getByRole("button", { name: /Frontage assist/ });
  await expect(frontageTool).toBeEnabled();
  await frontageTool.click();
  await expect(frontageTool).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("radio", { name: "Left" })).toBeChecked();
  await expect(page.getByLabel("Road-edge setback")).toHaveValue("6");
  await expect(page.getByLabel("House gap")).toHaveValue("4");
  await expect(page.getByLabel("End clearance")).toHaveValue("5");

  await page.mouse.click(roadStart.x, roadStart.y);
  await expect(page.locator("#frontage-summary")).toContainText("click the end point on the same road");
  await page.mouse.click(roadEnd.x, roadEnd.y);
  await expect(page.locator("#frontage-summary")).toContainText("1 ready");
  await expect(page.getByRole("button", { name: "Generate houses" })).toBeEnabled();
  await page.getByRole("radio", { name: "Both" }).check();
  await expect(page.locator("#frontage-summary")).toContainText("1 skipped (1 out-of-world)");
  await page.getByRole("radio", { name: "Left" }).check();
  await expect(page.locator("#frontage-summary")).toContainText("1 ready");
  await page.getByRole("button", { name: "Generate houses" }).click();

  await expect(page.locator("#status-message")).toContainText("Generated 1 frontage house as one undoable edit");
  await expect(page.locator("#inspector-title")).toHaveText("Test House");
  await expect(page.getByLabel("Frontage road")).not.toHaveValue("");
  await expect(page.getByLabel("Enabled", { exact: true })).not.toBeChecked();
  await expect(page.locator("#undo")).toHaveAttribute("title", "Undo Generate 1 frontage houses");

  const generatedX = await page.getByLabel("X (m)").inputValue();
  const generatedZ = await page.getByLabel("Z (m)").inputValue();
  await page.keyboard.press("Control+z");
  await expect(page.locator("#redo")).toHaveAttribute("title", "Redo Generate 1 frontage houses");
  await expect(page.locator("#inspector-title")).toHaveText("Terrain reference");
  await page.keyboard.press("Control+y");

  await frontageTool.click();
  await expect(frontageTool).toHaveAttribute("aria-pressed", "false");
  await page.mouse.click(center.x, center.y - 200);
  await expect(page.locator("#inspector-title")).toHaveText("Test House");
  await expect(page.getByLabel("X (m)")).toHaveValue(generatedX);
  await expect(page.getByLabel("Z (m)")).toHaveValue(generatedZ);
});

async function createProject(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Choose terrain sources" }).click();
  await page.getByLabel("Project name").fill("Frontage County");
  await page.locator("#terrain-npy").setInputFiles(npyPath);
  await page.locator("#terrain-descriptor").setInputFiles(descriptorPath);
  await page.getByRole("button", { name: "Validate & create project" }).click();
  await expect(page.getByText("Frontage County").first()).toBeVisible();
}
