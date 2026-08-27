import { describe, expect, it } from "vitest";
import type { VegetationInstance } from "../../src/model/entities";
import { VegetationRenderDataManager } from "../../src/rendering/VegetationRenderDataManager";
import type { TerrainSurface } from "../../src/terrain/TerrainSurface";

describe("native vegetation render data manager", () => {
  it("keeps stable ID/slot maps, swap-removes, re-batches cross-chunk moves, and spatially picks", () => {
    const manager = new VegetationRenderDataManager(512);
    const terrain = flatTerrain(0);
    const first = vegetation(1, 100, 100);
    const second = vegetation(2, 101, 101);
    const third = vegetation(3, 900, 900);
    const initial = manager.sync([first, second, third], terrain, null, true);
    expect(initial).toMatchObject({ modelCount: 3, added: 3, fullRebuilds: 0 });
    expect(manager.batchCount).toBe(2);
    expect(manager.pick({ x: 100, z: 100 }, 2)).toBe(first.id);
    const hiddenFirst = { ...first, visible: false };
    manager.sync([hiddenFirst, second, third], terrain, null, true);
    expect(manager.pick({ x: 100, z: 100 }, 0.5)).toBeNull();
    manager.sync([first, second, third], terrain, null, true);

    const firstLocation = manager.locationFor(first.id)!;
    expect(manager.modelIdForBatchSlot(firstLocation.batchKey, firstLocation.slot)).toBe(first.id);
    const movedWithin = { ...first, x_m: 105 };
    const within = manager.sync([movedWithin, second, third], terrain, first.id, true);
    expect(within).toMatchObject({ updated: 1, rebatched: 0, slotWrites: 1, fullRebuilds: 0 });
    expect(manager.locationFor(first.id)?.batchKey).toBe(firstLocation.batchKey);

    const movedAcross = { ...movedWithin, x_m: 700 };
    const across = manager.sync([movedAcross, second, third], terrain, first.id, true);
    expect(across).toMatchObject({ updated: 0, rebatched: 1, fullRebuilds: 0 });
    expect(manager.locationFor(first.id)?.batchKey).not.toBe(firstLocation.batchKey);

    const secondLocation = manager.locationFor(second.id)!;
    const removed = manager.sync([movedAcross, third], terrain, first.id, true);
    expect(removed.removed).toBe(1);
    expect(manager.locationFor(second.id)).toBeUndefined();
    expect(manager.modelIdForBatchSlot(secondLocation.batchKey, 0)).toBeUndefined();
    expect(manager.pick({ x: 700, z: 100 }, 2)).toBe(first.id);
    manager.dispose();
  });

  it("addresses the complete 32,498 workload without one Object3D per record and refreshes every derived Y", () => {
    const entities = Array.from({ length: 32_498 }, (_, index) => vegetation(
      index + 1,
      (index * 37) % 10_000,
      (index * 83) % 10_000,
      index < 4_870 ? "forest_tree" : "shrub",
    ));
    const manager = new VegetationRenderDataManager();
    const initial = manager.sync(entities, flatTerrain(0), null, true);
    expect(initial.modelCount).toBe(32_498);
    expect(initial.added).toBe(32_498);
    expect(manager.group.children.length).toBeLessThan(1_000);
    expect(entities.every((entity) => manager.locationFor(entity.id) !== undefined)).toBe(true);

    const changedTerrain = flatTerrain(5);
    const refreshed = manager.sync(entities, changedTerrain, null, true);
    expect(refreshed.terrainYUpdates).toBe(32_498);
    const changed = { ...entities[12_345]!, scale: 1.25 };
    const replacement = [...entities];
    replacement[12_345] = changed;
    const single = manager.sync(replacement, changedTerrain, changed.id, true);
    expect(single).toMatchObject({ updated: 1, slotWrites: 1, terrainYUpdates: 0, fullRebuilds: 0 });
    manager.dispose();
  });
});

function vegetation(
  index: number,
  x: number,
  z: number,
  vegetationType: VegetationInstance["vegetation_type"] = "forest_tree",
): VegetationInstance {
  return {
    kind: "vegetation",
    id: `00000003-0000-4000-8000-${index.toString(16).padStart(12, "0")}`,
    name: `Vegetation ${String(index)}`,
    visible: true,
    locked: false,
    vegetation_type: vegetationType,
    asset_id: vegetationType === "shrub" ? "hazel" : "oak",
    x_m: x,
    z_m: z,
    rotation_deg: index % 360,
    scale: 1,
    source_region_id: null,
  };
}

function flatTerrain(height: number): TerrainSurface {
  return {
    worldWidthM: 10_000,
    worldDepthM: 10_000,
    spacingM: 10_000,
    cellCountX: 1,
    cellCountZ: 1,
    pointCountX: 2,
    pointCountZ: 2,
    minimumElevationM: height,
    seaLevelM: height,
    lowlandReferenceElevationM: height,
    maximumElevationM: height,
    heightAtGrid: () => height,
    heightAt: () => height,
    slopeAt: () => 0,
    copyHeights: () => new Float32Array([height, height, height, height]),
  };
}
