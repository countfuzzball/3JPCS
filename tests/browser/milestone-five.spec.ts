import { expect, test } from "@playwright/test";

test("full native vegetation benchmark remains editable through chunked GPU batches", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/?benchmark=1");
  await page.waitForFunction(() => window.__POLYGON_BENCHMARK__?.ready === true, null, { timeout: 120_000 });
  await expect(page.locator("#status-message")).toContainText("32,498 editable vegetation records");
  await expect(page.locator("#export-runtime")).toHaveText("Runtime scenery v3");
  await expect(page.locator("#layer-native-vegetation")).toBeChecked();

  const report = await page.evaluate(async () => window.__POLYGON_BENCHMARK__?.run({ quick: true })) as unknown as BenchmarkReport | undefined;
  expect(report?.counts).toEqual({ roads: 309, prefabs: 279, trees: 4_870, shrubs: 27_628, vegetation: 32_498 });
  expect(report?.denseSelection.id).toBeTruthy();
  expect(report?.sparseSelection.id).toBeTruthy();
  expect(report?.withinChunkMove.snapshot.nativeVegetation.updated).toBe(1);
  expect(report?.withinChunkMove.snapshot.nativeVegetation.fullRebuilds).toBe(0);
  expect(report?.acrossChunkMove.snapshot.nativeVegetation.rebatched).toBe(1);
  expect(report?.terrainPadRefresh.snapshot.nativeVegetation.terrainYUpdates).toBe(32_498);
  expect(report?.initialSnapshot.sceneObjectCount).toBeLessThan(5_000);
});

interface BenchmarkReport {
  readonly counts: { readonly roads: number; readonly prefabs: number; readonly trees: number; readonly shrubs: number; readonly vegetation: number };
  readonly denseSelection: { readonly id: string | null };
  readonly sparseSelection: { readonly id: string | null };
  readonly withinChunkMove: { readonly snapshot: { readonly nativeVegetation: { readonly updated: number; readonly fullRebuilds: number } } };
  readonly acrossChunkMove: { readonly snapshot: { readonly nativeVegetation: { readonly rebatched: number } } };
  readonly terrainPadRefresh: { readonly snapshot: { readonly nativeVegetation: { readonly terrainYUpdates: number } } };
  readonly initialSnapshot: { readonly sceneObjectCount: number };
}
