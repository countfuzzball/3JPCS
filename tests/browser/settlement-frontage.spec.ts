import { expect, test, type Download, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const npyPath = fileURLToPath(new URL("../fixtures/terrain/terrain-v1-c.npy", import.meta.url));
const descriptorPath = fileURLToPath(new URL("../fixtures/terrain/terrain-descriptor.json", import.meta.url));
const catalog = {
  name: "settlement-frontage-catalog.json",
  mimeType: "application/json",
  buffer: Buffer.from(JSON.stringify({
    format: "polygon-county-asset-catalog",
    schema_version: 3,
    category_defaults: {
      house: { proxy: { width_m: 1, depth_m: 1, wall_height_m: 3 } },
    },
    assets: {
      village_house: { category: "house", resource: "buildings/village-house.glb" },
    },
  })),
};

test("previews and bakes deterministic multi-road settlement frontage as one edit", async ({ page }) => {
  await page.addInitScript(() => { delete (window as Window & { showSaveFilePicker?: unknown }).showSaveFilePicker; });
  await createProject(page);
  const canvas = page.locator("canvas[aria-label='Top-down terrain viewport']");
  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();
  const center = { x: bounds!.x + bounds!.width / 2, y: bounds!.y + bounds!.height / 2 };

  await page.getByRole("button", { name: /Village/ }).click();
  for (const point of [
    { x: center.x - 300, y: center.y - 250 },
    { x: center.x + 300, y: center.y - 250 },
    { x: center.x + 300, y: center.y + 250 },
    { x: center.x - 300, y: center.y + 250 },
  ]) await page.mouse.click(point.x, point.y);
  await page.keyboard.press("Enter");
  await expect(page.locator("#inspector-title")).toHaveText("Village");

  await createRoad(page, { x: center.x - 260, y: center.y }, { x: center.x + 260, y: center.y });
  await createRoad(page, { x: center.x, y: center.y - 220 }, { x: center.x, y: center.y + 220 });
  await page.locator("#asset-catalog-file").setInputFiles(catalog);
  await page.getByLabel("Placement asset").selectOption("village_house");

  await page.mouse.click(center.x - 230, center.y - 180);
  await expect(page.locator("#inspector-title")).toHaveText("Village");
  await expect(page.locator("#settlement-frontage-roads input[type='checkbox']")).toHaveCount(2);
  await expect(page.locator("#settlement-frontage-roads input[type='checkbox']:checked")).toHaveCount(2);
  await expect(page.locator("#settlement-frontage-summary")).toContainText("2 of 2 intersecting roads selected");

  await page.getByLabel("Road-edge setback").fill("1");
  await page.getByLabel("House gap").fill("0.5");
  await page.getByLabel("End clearance").fill("0.5");
  await page.getByLabel("Plot slope limit").fill("89");
  await page.getByLabel("Junction clearance").fill("1");
  await page.getByLabel("Spacing jitter").fill("0.2");
  await page.getByLabel("Yaw jitter").fill("2");
  await page.getByLabel("Population seed").fill("17");
  await expect(page.getByRole("radio", { name: "Left" })).toBeChecked();

  const undoBeforePreview = await page.locator("#undo").getAttribute("title");
  await page.locator("#populate-settlement").click();
  await expect(page.locator("#settlement-frontage-summary")).toContainText("ready");
  await expect(page.locator("#settlement-frontage-summary")).toContainText("2 clipped road ranges");
  await expect(page.locator("#settlement-frontage-summary")).toContainText("1 junction");
  await expect(page.locator("#generate-settlement-frontage")).toBeEnabled();
  await expect(page.locator("#undo")).toHaveAttribute("title", undoBeforePreview ?? "");

  await page.getByLabel("Population seed").fill("18");
  await expect(page.locator("#settlement-frontage-summary")).toContainText("invalidated");
  await expect(page.locator("#generate-settlement-frontage")).toBeDisabled();
  await page.locator("#populate-settlement").click();
  await page.locator("#generate-settlement-frontage").click();

  await expect(page.locator("#status-message")).toContainText("settlement houses as one undoable edit");
  await expect(page.locator("#inspector-title")).toContainText("Village House");
  await expect(page.getByLabel("Frontage road")).not.toHaveValue("");
  await expect(page.getByLabel("Enabled", { exact: true })).not.toBeChecked();
  await expect(page.locator("#undo")).toHaveAttribute("title", /Undo Populate Village with \d+ houses/);

  const projectDownload = await downloadFrom(page, () => page.getByRole("button", { name: "Save", exact: true }).click());
  const projectPath = await projectDownload.path();
  expect(projectPath).not.toBeNull();
  const project = JSON.parse(await readFile(projectPath, "utf8")) as {
    readonly roads: readonly { readonly id: string }[];
    readonly prefab_instances: readonly {
      readonly frontage_road_id: string | null;
      readonly terrain_pad: { readonly enabled: boolean };
    }[];
  };
  expect(project.prefab_instances.length).toBeGreaterThan(1);
  expect(new Set(project.prefab_instances.map(({ frontage_road_id }) => frontage_road_id)).size).toBe(2);
  expect(project.prefab_instances.every(({ terrain_pad }) => !terrain_pad.enabled)).toBe(true);
  expect(project.prefab_instances.every(({ frontage_road_id }) => (
    project.roads.some(({ id }) => id === frontage_road_id)
  ))).toBe(true);

  await page.keyboard.press("Control+z");
  await expect(page.locator("#status-message")).toContainText("Undid Populate Village");
  await page.keyboard.press("Control+y");
  await expect(page.locator("#status-message")).toContainText("Redid Populate Village");

  page.once("dialog", (dialog) => { void dialog.accept(); });
  await page.getByRole("button", { name: "Open" }).click();
  await page.locator("#open-project-file").setInputFiles(projectPath);
  await page.locator("#open-terrain-npy").setInputFiles(npyPath);
  await page.locator("#open-terrain-descriptor").setInputFiles(descriptorPath);
  await page.locator("#open-catalog").setInputFiles(catalog);
  await page.getByRole("button", { name: "Validate & open" }).click();
  await expect(page.getByText("Settlement Frontage County").first()).toBeVisible();
  await expect(page.locator("#inspector")).toContainText(`${String(project.prefab_instances.length)} / 1`);
});

async function createRoad(
  page: Page,
  start: { readonly x: number; readonly y: number },
  end: { readonly x: number; readonly y: number },
): Promise<void> {
  await page.getByRole("button", { name: /^━ Road$/ }).click();
  await page.mouse.click(start.x, start.y);
  await page.mouse.click(end.x, end.y);
  await page.keyboard.press("Enter");
  await expect(page.locator("#inspector-title")).toContainText("Road");
  await page.getByLabel("Full width (m)").fill("1");
  await page.getByRole("button", { name: "Apply properties" }).click();
}

async function createProject(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Choose terrain sources" }).click();
  await page.getByLabel("Project name").fill("Settlement Frontage County");
  await page.locator("#terrain-npy").setInputFiles(npyPath);
  await page.locator("#terrain-descriptor").setInputFiles(descriptorPath);
  await page.getByRole("button", { name: "Validate & create project" }).click();
  await expect(page.getByText("Settlement Frontage County").first()).toBeVisible();
}

async function downloadFrom(page: Page, action: () => Promise<unknown>): Promise<Download> {
  const [download] = await Promise.all([page.waitForEvent("download"), action()]);
  return download;
}
