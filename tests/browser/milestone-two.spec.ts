import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";

const npyPath = fileURLToPath(new URL("../fixtures/terrain/terrain-v1-c.npy", import.meta.url));
const descriptorPath = fileURLToPath(new URL("../fixtures/terrain/terrain-descriptor.json", import.meta.url));

test("authors and edits native geometry with locks, layers, and delta undo", async ({ page }) => {
  await createProject(page);
  const canvas = page.locator("canvas[aria-label='Top-down terrain viewport']");
  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();
  const center = { x: bounds!.x + bounds!.width / 2, y: bounds!.y + bounds!.height / 2 };
  const polygon = [
    { x: center.x - 110, y: center.y - 110 },
    { x: center.x + 110, y: center.y - 110 },
    { x: center.x + 110, y: center.y + 110 },
    { x: center.x - 110, y: center.y + 110 },
  ];

  await page.getByRole("button", { name: /Town/ }).click();
  await page.mouse.click(polygon[0]!.x, polygon[0]!.y);
  await page.keyboard.press("Escape");
  await expect(page.locator("#status-message")).toHaveText("Draft cancelled");

  const woodlandTool = page.getByRole("button", { name: /Woodland/ });
  await woodlandTool.click();
  await expect(woodlandTool).toHaveAttribute("aria-pressed", "true");
  for (const point of polygon) await page.mouse.click(point.x, point.y);
  await expect(page.locator("#status-message")).toContainText("4 draft points");
  await page.keyboard.press("Enter");
  await expect(page.locator("#inspector-title")).toHaveText("Woodland");
  await expect(page.getByText(/4 vertices/)).toBeVisible();

  await page.getByLabel("Name", { exact: true }).fill("North Wood");
  await page.getByLabel("Locked").check();
  await page.getByRole("button", { name: "Apply properties" }).click();
  await expect(page.locator("#inspector-title")).toHaveText("North Wood");
  await expect(page.getByRole("button", { name: "Delete object" })).toBeDisabled();
  await expect(page.locator("#undo")).toHaveAttribute("title", "Undo Edit properties");

  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x + 40, center.y + 25, { steps: 3 });
  await page.mouse.up();
  await expect(page.locator("#undo")).toHaveAttribute("title", "Undo Edit properties");

  await page.getByLabel("Locked").uncheck();
  await page.getByRole("button", { name: "Apply properties" }).click();
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x + 40, center.y + 25, { steps: 3 });
  await page.mouse.up();
  await expect(page.locator("#undo")).toHaveAttribute("title", "Undo Move object");

  const movedVertex = { x: polygon[0]!.x + 40, y: polygon[0]!.y + 25 };
  await page.mouse.click(movedVertex.x, movedVertex.y);
  await expect(page.getByText(/vertex 1 selected/)).toBeVisible();
  await page.mouse.move(movedVertex.x, movedVertex.y);
  await page.mouse.down();
  await page.mouse.move(movedVertex.x - 24, movedVertex.y + 12, { steps: 3 });
  await page.mouse.up();
  await expect(page.locator("#undo")).toHaveAttribute("title", "Undo Move vertex");
  await page.keyboard.press("Shift+Delete");
  await expect(page.getByText(/3 vertices/)).toBeVisible();

  const roadStart = { x: center.x - 160, y: center.y };
  const roadMiddle = { x: center.x - 80, y: center.y };
  const roadEnd = { x: center.x, y: center.y };
  await page.getByRole("button", { name: /^━ Road$/ }).click();
  await page.mouse.click(roadStart.x, roadStart.y);
  await page.mouse.click(roadEnd.x, roadEnd.y);
  await page.mouse.click(center.x + 120, center.y);
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Enter");
  await expect(page.locator("#inspector-title")).toHaveText("Road");
  await expect(page.getByText(/2 vertices/)).toBeVisible();

  await page.keyboard.down("Control");
  await page.mouse.click(roadMiddle.x, roadMiddle.y);
  await page.keyboard.up("Control");
  await expect(page.getByText(/3 vertices/)).toBeVisible();
  await page.getByRole("button", { name: "Delete vertex" }).click();
  await expect(page.getByText(/2 vertices/)).toBeVisible();
  await page.getByRole("button", { name: /Undo/ }).click();
  await expect(page.getByText(/3 vertices/)).toBeVisible();
  await page.getByRole("button", { name: /Redo/ }).click();
  await expect(page.getByText(/2 vertices/)).toBeVisible();

  await page.getByLabel("Name", { exact: true }).fill("County Link");
  await page.getByLabel("Surface").selectOption("paved");
  await page.getByLabel("Full width (m)").fill("4");
  await page.getByRole("button", { name: "Apply properties" }).click();
  await expect(page.locator("#inspector-title")).toHaveText("County Link");

  await page.getByLabel("Visible").uncheck();
  await page.getByRole("button", { name: "Apply properties" }).click();
  await page.mouse.click(roadMiddle.x, roadMiddle.y);
  await expect(page.locator("#inspector-title")).not.toHaveText("County Link");
  await page.keyboard.press("Control+z");
  await page.mouse.click(roadMiddle.x, roadMiddle.y);
  await expect(page.locator("#inspector-title")).toHaveText("County Link");

  await page.getByRole("checkbox", { name: /Native roads/ }).uncheck();
  await page.mouse.click(roadMiddle.x, roadMiddle.y);
  await expect(page.locator("#inspector-title")).not.toHaveText("County Link");
  await page.getByRole("checkbox", { name: /Native roads/ }).check();
  await page.mouse.click(roadMiddle.x, roadMiddle.y);
  await expect(page.locator("#inspector-title")).toHaveText("County Link");

  await page.getByRole("button", { name: /Hedgerow/ }).click();
  await page.mouse.click(center.x - 120, center.y + 130);
  await page.mouse.dblclick(center.x + 120, center.y + 130);
  await expect(page.locator("#inspector-title")).toHaveText("Hedgerow");
  await expect(page.getByText(/2 vertices/)).toBeVisible();
});

async function createProject(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Choose terrain sources" }).click();
  await page.getByLabel("Project name").fill("Milestone Two County");
  await page.locator("#terrain-npy").setInputFiles(npyPath);
  await page.locator("#terrain-descriptor").setInputFiles(descriptorPath);
  await page.getByRole("button", { name: "Validate & create project" }).click();
  await expect(page.getByText("Milestone Two County").first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Woodland/ })).toBeEnabled();
}
