import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";

const npyPath = fileURLToPath(new URL("../fixtures/terrain/terrain-v1-c.npy", import.meta.url));
const descriptorPath = fileURLToPath(new URL("../fixtures/terrain/terrain-descriptor.json", import.meta.url));

test("surveys, accepts, undoes, and restores a baked settlement site", async ({ page }) => {
  await createProject(page);
  await expect(page.getByLabel("Preferred elevation")).toHaveValue("5");
  await page.getByRole("spinbutton", { name: "Candidates", exact: true }).fill("1");
  await page.getByLabel("Radius").fill("2");
  await page.getByLabel("Maximum slope").fill("89");
  await page.getByLabel("Minimum separation").fill("0");
  await page.getByLabel("World-edge clearance").fill("0");
  await page.getByLabel("Attempt budget").fill("20");

  await expect(page.locator("#undo")).toBeDisabled();
  await page.getByRole("button", { name: "Run survey" }).click();
  await expect(page.locator("#settlement-survey-summary")).toContainText("1 ranked candidate · 1 selected");
  await expect(page.locator("#settlement-survey-candidates input[type='checkbox']")).toBeChecked();
  await expect(page.locator("#undo")).toBeDisabled();
  await expect(page.locator("#status-message")).toContainText("preview only");

  await page.getByLabel("Integer seed").fill("2");
  await expect(page.locator("#settlement-survey-summary")).toContainText("run the survey again");
  await expect(page.locator("#settlement-survey-candidates input[type='checkbox']")).toHaveCount(0);
  await page.getByRole("button", { name: "Run survey" }).click();

  await page.getByRole("button", { name: "Accept selected" }).click();
  await expect(page.locator("#status-message")).toContainText("Accepted 1 surveyed settlement as one undoable edit");
  await expect(page.locator("#inspector-title")).toHaveText("Town");
  await expect(page.locator(".property-meta")).toContainText("32 vertices");
  await expect(page.locator("#undo")).toHaveAttribute("title", "Undo Accept 1 surveyed settlement");
  await expect(page.locator("#settlement-survey-candidates input[type='checkbox']")).toHaveCount(0);

  await page.keyboard.press("Control+z");
  await expect(page.locator("#status-message")).toContainText("Undid Accept 1 surveyed settlement");
  await expect(page.locator("#inspector-title")).toHaveText("Terrain reference");
  await expect(page.locator("#redo")).toHaveAttribute("title", "Redo Accept 1 surveyed settlement");

  await page.keyboard.press("Control+y");
  await expect(page.locator("#status-message")).toContainText("Redid Accept 1 surveyed settlement");
  await expect(page.locator("#undo")).toHaveAttribute("title", "Undo Accept 1 surveyed settlement");
});

async function createProject(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Choose terrain sources" }).click();
  await page.getByLabel("Project name").fill("Survey County");
  await page.locator("#terrain-npy").setInputFiles(npyPath);
  await page.locator("#terrain-descriptor").setInputFiles(descriptorPath);
  await page.getByRole("button", { name: "Validate & create project" }).click();
  await expect(page.getByText("Survey County").first()).toBeVisible();
}
