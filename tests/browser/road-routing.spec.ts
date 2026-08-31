import { expect, test, type Download, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const npyPath = fileURLToPath(new URL("../fixtures/terrain/terrain-v1-c.npy", import.meta.url));
const descriptorPath = fileURLToPath(new URL("../fixtures/terrain/terrain-descriptor.json", import.meta.url));

test("routes responsively, previews diagnostics, and bakes an ordinary persistent road", async ({ page }) => {
  await page.addInitScript(() => { delete (window as Window & { showSaveFilePicker?: unknown }).showSaveFilePicker; });
  await createProject(page);
  const canvas = page.locator("canvas[aria-label='Top-down terrain viewport']");
  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();
  const center = { x: bounds!.x + bounds!.width / 2, y: bounds!.y + bounds!.height / 2 };
  const existingStart = { x: center.x - 290, y: center.y + 175 };
  const existingEnd = { x: center.x - 110, y: center.y + 175 };
  const destination = { x: center.x + 275, y: center.y - 170 };

  await page.getByRole("button", { name: /^━ Road$/ }).click();
  await page.mouse.click(existingStart.x, existingStart.y);
  await page.mouse.click(existingEnd.x, existingEnd.y);
  await page.keyboard.press("Enter");
  await expect(page.locator("#inspector-title")).toHaveText("Road");

  await page.locator("#route-road-width").fill("5");
  await page.locator("#route-grid-step").fill("0.05");
  await page.locator("#route-maximum-grade").fill("100");
  await page.locator("#route-slope-weight").fill("8");
  await page.locator("#route-road-surface").selectOption("paved");
  const routeTool = page.getByRole("button", { name: /Route road/ });
  await routeTool.click();
  await expect(routeTool).toHaveAttribute("aria-pressed", "true");

  await page.mouse.click(existingEnd.x, existingEnd.y);
  await expect(page.locator("#route-summary")).toContainText("snapped to Road");
  await page.mouse.click(destination.x, destination.y);

  // This main-thread interaction happens while the representative 160k-node grid is owned by the worker.
  await page.getByRole("checkbox", { name: /Contours/ }).uncheck();
  await expect(page.getByRole("checkbox", { name: /Contours/ })).not.toBeChecked();
  await expect(page.locator("#route-summary")).toContainText("Route ready", { timeout: 30_000 });
  await expect(page.locator("#route-summary")).toContainText("nodes · cost");
  await expect(page.getByRole("button", { name: "Accept route" })).toBeEnabled();
  await expect(page.locator("#undo")).toHaveAttribute("title", "Undo Create Road");

  await page.locator("#route-road-class").selectOption("county_road");
  await expect(page.locator("#route-summary")).toContainText("Settings changed; start retained");
  await expect(page.getByRole("button", { name: "Accept route" })).toBeDisabled();
  await page.mouse.click(destination.x, destination.y);
  await expect(page.locator("#route-summary")).toContainText("Route ready", { timeout: 30_000 });
  await page.getByRole("button", { name: "Accept route" }).click();

  await expect(page.locator("#status-message")).toContainText("as one undoable edit");
  await expect(page.locator("#inspector-title")).toHaveText("Road 2");
  await expect(page.locator("select[name='road_class']")).toHaveValue("county_road");
  await expect(page.locator("select[name='surface']")).toHaveValue("paved");
  await expect(page.locator("input[name='width_m']")).toHaveValue("5");
  await expect(page.locator("#undo")).toHaveAttribute("title", "Undo Create routed Road 2");

  await page.keyboard.press("Control+z");
  await expect(page.locator("#status-message")).toContainText("Undid Create routed Road 2");
  await page.keyboard.press("Control+y");
  await expect(page.locator("#status-message")).toContainText("Redid Create routed Road 2");

  const runtimeDownload = await downloadFrom(page, () => page.getByRole("button", { name: "Runtime scenery v3" }).click());
  const runtime = JSON.parse(await readDownload(runtimeDownload)) as {
    readonly schema_version: number;
    readonly roads: readonly { readonly road_class: string; readonly surface: string; readonly points: readonly number[][] }[];
  };
  expect(runtime.schema_version).toBe(3);
  expect(runtime.roads).toHaveLength(2);
  expect(runtime.roads[1]).toMatchObject({ road_class: "county_road", surface: "paved" });
  expect(runtime.roads[1]?.points.length).toBeGreaterThanOrEqual(2);

  const projectDownload = await downloadFrom(page, () => page.getByRole("button", { name: "Save", exact: true }).click());
  const projectPath = await projectDownload.path();
  expect(projectPath).not.toBeNull();
  await page.getByRole("button", { name: "Open" }).click();
  await page.locator("#open-project-file").setInputFiles(projectPath);
  await page.locator("#open-terrain-npy").setInputFiles(npyPath);
  await page.locator("#open-terrain-descriptor").setInputFiles(descriptorPath);
  await page.getByRole("button", { name: "Validate & open" }).click();
  await expect(page.getByText("Routing County").first()).toBeVisible();
  await expect(page.locator("#inspector")).toContainText("2 / 0");
});

async function createProject(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Choose terrain sources" }).click();
  await page.getByLabel("Project name").fill("Routing County");
  await page.locator("#terrain-npy").setInputFiles(npyPath);
  await page.locator("#terrain-descriptor").setInputFiles(descriptorPath);
  await page.getByRole("button", { name: "Validate & create project" }).click();
  await expect(page.getByText("Routing County").first()).toBeVisible();
}

async function downloadFrom(page: Page, action: () => Promise<unknown>): Promise<Download> {
  const [download] = await Promise.all([page.waitForEvent("download"), action()]);
  return download;
}

async function readDownload(download: Download): Promise<string> {
  return readFile(await download.path(), "utf8");
}
