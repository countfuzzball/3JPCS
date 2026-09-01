import { expect, test, type Download, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const npyPath = fileURLToPath(new URL("../fixtures/terrain/terrain-v1-c.npy", import.meta.url));
const descriptorPath = fileURLToPath(new URL("../fixtures/terrain/terrain-descriptor.json", import.meta.url));
const catalog = {
  name: "county-build-catalog.json",
  mimeType: "application/json",
  buffer: Buffer.from(JSON.stringify({
    format: "polygon-county-asset-catalog",
    schema_version: 3,
    category_defaults: {
      house: { proxy: { width_m: 0.45, depth_m: 0.45, wall_height_m: 2.5 } },
      barn: { proxy: { width_m: 0.6, depth_m: 0.5, wall_height_m: 3 } },
    },
    assets: {
      small_house: { category: "house", resource: "buildings/small-house.glb" },
      farm_barn: { category: "barn", resource: "buildings/farm-barn.glb" },
    },
  })),
};

test("generates, filters, atomically bakes, edits, persists, and exports a complete county", async ({ page }) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => { delete (window as Window & { showSaveFilePicker?: unknown }).showSaveFilePicker; });
  await createProject(page);
  const canvas = page.locator("canvas[aria-label='Top-down terrain viewport']");
  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();
  const center = { x: bounds!.x + bounds!.width / 2, y: bounds!.y + bounds!.height / 2 };

  await createPlace(page, "Town", [
    [center.x - 310, center.y - 270], [center.x - 40, center.y - 270],
    [center.x - 40, center.y - 30], [center.x - 310, center.y - 30],
  ]);
  await createPlace(page, "Village", [
    [center.x + 40, center.y + 30], [center.x + 310, center.y + 30],
    [center.x + 310, center.y + 270], [center.x + 40, center.y + 270],
  ]);
  await page.locator("#asset-catalog-file").setInputFiles(catalog);

  await page.locator("#county-source-mode").selectOption("existing_places");
  await page.locator("#county-settlement-count").fill("2");
  await page.locator("#county-main-place").selectOption({ label: "Town" });
  await page.getByText("Advanced county policy", { exact: true }).click();
  await page.locator("#county-backbone-orientation").selectOption("west_east");
  await page.locator("#county-grid-step").fill("1");
  await page.locator("#county-maximum-grade").fill("10");
  await page.locator("#county-local-edge-clearance").fill("0.1");
  await page.locator("#county-backbone-width").fill("0.5");
  await page.locator("#county-access-width").fill("0.5");
  await page.locator("#county-local-width").fill("0.4");
  await page.locator("#county-driveway-width").fill("0.35");
  await page.locator("#county-asset-house").selectOption("small_house");
  await page.locator("#county-asset-barn").selectOption("farm_barn");
  await page.locator("#county-setback").fill("0.8");
  await page.locator("#county-gap").fill("0.35");
  await page.locator("#county-end-clearance").fill("0.2");
  await page.locator("#county-maximum-plot-slope").fill("89");
  await page.locator("#county-junction-clearance").fill("0.2");
  await page.locator("#county-spacing-jitter").fill("0");
  await page.locator("#county-yaw-jitter").fill("0");

  const undoBeforePreview = await page.locator("#undo").getAttribute("title");
  await page.getByRole("button", { name: "Generate County Preview" }).click();
  await expect(page.locator("#county-build-summary")).toContainText("Complete preview", { timeout: 30_000 });
  await expect(page.locator("#county-build-summary")).toContainText("2 settlements");
  await expect(page.locator("#bake-county")).toBeEnabled();
  await expect(page.locator("#undo")).toHaveAttribute("title", undoBeforePreview ?? "");
  await expect(page.locator("#county-preview-place option")).toHaveCount(3);
  await page.getByText("Preview filters", { exact: true }).click();
  await page.locator("#county-preview-place").selectOption({ label: "Town" });
  await page.locator("input[data-county-preview-class='prefabs']").uncheck();
  await page.locator("input[data-county-preview-class='prefabs']").check();

  await page.locator("#bake-county").click();
  await expect(page.locator("#status-message")).toContainText("Baked county atomically");
  await expect(page.locator("#undo")).toHaveAttribute("title", /Undo Build county/);
  await expect(page.locator("#inspector-title")).toContainText(/House|Barn/);
  await page.getByLabel("Rotation (deg)").fill("15");
  await page.getByRole("button", { name: "Apply properties" }).click();

  await page.keyboard.press("Control+z");
  await expect(page.locator("#status-message")).toContainText("Undid Edit");
  await page.keyboard.press("Control+z");
  await expect(page.locator("#status-message")).toContainText("Undid Build county");
  await page.keyboard.press("Control+y");
  await expect(page.locator("#status-message")).toContainText("Redid Build county");

  const projectDownload = await downloadFrom(page, () => page.getByRole("button", { name: "Save", exact: true }).click());
  const projectPath = await projectDownload.path();
  expect(projectPath).not.toBeNull();
  const project = JSON.parse(await readFile(projectPath, "utf8")) as {
    readonly places: readonly unknown[];
    readonly roads: readonly { readonly id: string }[];
    readonly prefab_instances: readonly {
      readonly frontage_road_id: string | null;
      readonly terrain_pad: { readonly enabled: boolean };
    }[];
  };
  expect(project.places).toHaveLength(2);
  expect(project.roads.length).toBeGreaterThanOrEqual(3);
  expect(project.prefab_instances.length).toBeGreaterThan(0);
  expect(project.prefab_instances.every(({ terrain_pad }) => !terrain_pad.enabled)).toBe(true);
  expect(project.prefab_instances.every(({ frontage_road_id }) => project.roads.some(({ id }) => id === frontage_road_id))).toBe(true);

  const runtimeDownload = await downloadFrom(page, () => page.getByRole("button", { name: "Runtime scenery v3" }).click());
  expect(await runtimeDownload.path()).not.toBeNull();
  const bundleDownload = await downloadFrom(page, () => page.getByRole("button", { name: "Viewer bundle (.zip)" }).click());
  expect(await bundleDownload.path()).not.toBeNull();

  page.once("dialog", (dialog) => { void dialog.accept(); });
  await page.getByRole("button", { name: "Open" }).click();
  await page.locator("#open-project-file").setInputFiles(projectPath);
  await page.locator("#open-terrain-npy").setInputFiles(npyPath);
  await page.locator("#open-terrain-descriptor").setInputFiles(descriptorPath);
  await page.locator("#open-catalog").setInputFiles(catalog);
  await page.getByRole("button", { name: "Validate & open" }).click();
  await expect(page.getByText("SN Build County", { exact: true }).first()).toBeVisible();
  await expect(page.locator("#inspector")).toContainText(`${String(project.prefab_instances.length)} / 2`);
});

async function createPlace(
  page: Page,
  label: "Town" | "Village",
  points: readonly (readonly [number, number])[],
): Promise<void> {
  await page.getByRole("button", { name: new RegExp(`${label}$`) }).click();
  for (const [x, y] of points) await page.mouse.click(x, y);
  await page.keyboard.press("Enter");
  await expect(page.locator("#inspector-title")).toHaveText(label);
}

async function createProject(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Choose terrain sources" }).click();
  await page.getByLabel("Project name").fill("SN Build County");
  await page.locator("#terrain-npy").setInputFiles(npyPath);
  await page.locator("#terrain-descriptor").setInputFiles(descriptorPath);
  await page.getByRole("button", { name: "Validate & create project" }).click();
  await expect(page.getByText("SN Build County", { exact: true }).first()).toBeVisible();
}

async function downloadFrom(page: Page, action: () => Promise<unknown>): Promise<Download> {
  const [download] = await Promise.all([page.waitForEvent("download"), action()]);
  return download;
}
