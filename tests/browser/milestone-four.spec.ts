import { expect, test, type Download } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { countyDocument, vegetationDocument } from "../helpers/referenceFixtures";

const npyPath = fileURLToPath(new URL("../fixtures/terrain/terrain-v1-c.npy", import.meta.url));
const descriptorPath = fileURLToPath(new URL("../fixtures/terrain/terrain-descriptor.json", import.meta.url));
const catalogPath = fileURLToPath(new URL("../../examples/asset_catalog.json", import.meta.url));

test("opens with relinks, imports references, converts county, saves, and exports", async ({ page }) => {
  await page.addInitScript(() => { delete (window as Window & { showSaveFilePicker?: unknown }).showSaveFilePicker; });
  await page.goto("/");
  await page.getByRole("button", { name: "Open" }).click();
  await page.locator("#open-project-file").setInputFiles(jsonUpload("county.scenery.json", legacyProject()));
  await page.locator("#open-terrain-npy").setInputFiles(npyPath);
  await page.locator("#open-terrain-descriptor").setInputFiles(descriptorPath);
  await page.getByRole("button", { name: "Validate & open" }).click();

  await expect(page.getByText("Milestone Four County").first()).toBeVisible();
  await expect(page.getByText("UNSAVED")).toBeVisible();
  await expect(page.locator("#project-warnings")).toContainText("Optional vegetation source");

  await page.locator("#vegetation-reference-file").setInputFiles(jsonUpload("vegetation.json", vegetationDocument()));
  await expect(page.locator("#vegetation-summary")).toContainText("1 non-editable records");
  await page.locator("#county-reference-file").setInputFiles(jsonUpload("county.json", countyDocument()));
  await expect(page.locator("#county-summary")).toContainText("1 settlements · 1 roads · 1 buildings");
  await page.locator("#asset-catalog-file").setInputFiles(catalogPath);
  await page.getByRole("checkbox", { name: /Imported vegetation/ }).uncheck();
  await expect(page.getByRole("checkbox", { name: /Imported vegetation/ })).not.toBeChecked();

  await page.getByRole("button", { name: "Convert county to native" }).click();
  await expect(page.locator("#undo")).toHaveAttribute("title", "Undo Convert county reference to native objects");
  await expect(page.locator("#inspector")).toContainText("1 / 0");
  await expect(page.locator("#project-warnings")).toContainText("Missing asset catalogue entries: house");

  const saved = await downloadFrom(page, () => page.getByRole("button", { name: "Save", exact: true }).click());
  expect(saved.suggestedFilename()).toBe("county.scenery.json");
  const savedDocument = JSON.parse(await readDownload(saved)) as Record<string, unknown>;
  expect(savedDocument.schema_version).toBe(4);
  expect(savedDocument).toHaveProperty("vegetation_instances");
  expect(JSON.stringify(savedDocument)).not.toContain("FileSystem");
  await expect(page.getByText("UNSAVED")).toBeHidden();

  const runtime = await downloadFrom(page, () => page.getByRole("button", { name: "Runtime scenery v2" }).click());
  const runtimeDocument = JSON.parse(await readDownload(runtime)) as Record<string, unknown>;
  expect(runtimeDocument.schema_version).toBe(2);
  expect(runtimeDocument).not.toHaveProperty("terrain_pad");
  expect(JSON.stringify(runtimeDocument)).not.toContain(".glb");

  const resampled = await downloadFrom(page, () => page.getByRole("button", { name: "Resampled vegetation v1" }).click());
  const vegetation = JSON.parse(await readDownload(resampled)) as { generated_object_count: number; objects: Record<string, unknown>[] };
  expect(vegetation.generated_object_count).toBe(1);
  expect(vegetation.objects[0]?.terrain_y_m).not.toBe(10);

  const terrainDownloads = downloadsFrom(page, 2);
  await page.getByRole("button", { name: "Final terrain PNG + JSON" }).click();
  const completedTerrainDownloads = await terrainDownloads;
  const png = completedTerrainDownloads[0]!;
  const metadata = completedTerrainDownloads[1]!;
  expect([png.suggestedFilename(), metadata.suggestedFilename()].sort()).toEqual([
    "Milestone-Four-County.final-heightmap.json",
    "Milestone-Four-County.final-heightmap.png",
  ]);
  const pngDownload = png.suggestedFilename().endsWith(".png") ? png : metadata;
  const pngBytes = await readFile(await pngDownload.path());
  expect([...pngBytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
});

function jsonUpload(name: string, value: unknown) {
  return { name, mimeType: "application/json", buffer: Buffer.from(JSON.stringify(value)) };
}

function legacyProject(): Record<string, unknown> {
  return {
    format: "polygon-county-scenery-project",
    schema_version: 3,
    name: "Milestone Four County",
    world: { width_m: 20, depth_m: 20, terrain_spacing_m: 10 },
    sources: {
      terrain_npy: "C:\\legacy\\terrain.npy",
      terrain_descriptor: "C:\\legacy\\terrain.json",
      vegetation: "C:\\legacy\\vegetation.json",
      county_features: "C:\\legacy\\county.json",
      asset_catalog: "C:\\legacy\\catalog.json",
    },
    terrain_fingerprint: {
      sha256: "c2013f1b8a7ea1a0bb6f325484795d231e98d9dd8505cb9b5fa94f056f4ef27f",
      world_width_m: 20, world_depth_m: 20, spacing_m: 10,
      cell_count_x: 2, cell_count_z: 2, point_count_x: 3, point_count_z: 3,
    },
    places: [], land_use_regions: [], roads: [], linear_features: [], prefab_instances: [],
  };
}

async function downloadFrom(page: import("@playwright/test").Page, action: () => Promise<unknown>): Promise<Download> {
  const [download] = await Promise.all([page.waitForEvent("download"), action()]);
  return download;
}

function downloadsFrom(page: import("@playwright/test").Page, count: number): Promise<Download[]> {
  return new Promise((resolve) => {
    const downloads: Download[] = [];
    const listener = (download: Download) => {
      downloads.push(download);
      if (downloads.length === count) {
        page.off("download", listener);
        resolve(downloads);
      }
    };
    page.on("download", listener);
  });
}

async function readDownload(download: Download): Promise<string> {
  return readFile(await download.path(), "utf8");
}
