import { describe, expect, it, vi } from "vitest";
import { EditorStore } from "../../src/app/EditorStore";
import { AssetCatalog } from "../../src/model/assetCatalog";
import type { PlaceRegion, PrefabInstance } from "../../src/model/entities";
import { fixtureTerrain } from "../helpers/fixtures";

describe("project seed and dirty state", () => {
  it("keeps portable source hints separate from terrain data and starts dirty", async () => {
    const store = new EditorStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.createProject("Golden County", await fixtureTerrain(), {
      npy: "terrain-v1-c.npy",
      descriptor: "terrain-descriptor.json",
    });
    expect(store.state.dirty).toBe(true);
    expect(store.state.model?.sources.terrain_npy).toBe("terrain-v1-c.npy");
    expect(store.state.model?.terrainFingerprint.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(store.toDocument().schema_version).toBe(4);
    expect(store.toDocument().vegetation_instances).toEqual([]);
    expect(JSON.stringify(store.toDocument())).not.toContain("heights");
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("recomposes working terrain only for committed pad-affecting commands and supports undo/redo", async () => {
    const store = new EditorStore();
    store.createProject("Pads", await fixtureTerrain(), { npy: "terrain.npy", descriptor: "terrain.json" });
    const initial = store.state.workingTerrain;
    const place: PlaceRegion = {
      kind: "place",
      id: "11111111-1111-4111-8111-111111111111",
      name: "Village",
      visible: true,
      locked: false,
      place_type: "village",
      points: [[1, 1], [8, 1], [4, 8]],
    };
    store.addEntity(place, "Add place");
    expect(store.state.workingTerrain).toBe(initial);

    const prefab: PrefabInstance = {
      kind: "prefab",
      id: "22222222-2222-4222-8222-222222222222",
      name: "House",
      visible: true,
      locked: false,
      category: "house",
      asset_id: "house",
      x_m: 5,
      z_m: 5,
      rotation_deg: 0,
      scale: 1,
      frontage_road_id: null,
      terrain_pad: { enabled: true, width_m: 4, depth_m: 4, blend_m: 2, target_mode: "base_terrain_at_origin" },
    };
    store.addEntity(prefab, "Add prefab");
    const composed = store.state.workingTerrain;
    expect(composed).not.toBe(initial);
    expect(composed?.copyHeights()).not.toEqual(store.state.terrain?.copyHeights());

    const scaled = { ...prefab, scale: 3 };
    store.updateEntity(prefab, scaled, "Scale prefab");
    expect(store.state.workingTerrain).toBe(composed);
    const rotated = { ...scaled, rotation_deg: 35 };
    store.updateEntity(scaled, rotated, "Rotate prefab");
    const rotatedTerrain = store.state.workingTerrain;
    expect(rotatedTerrain).not.toBe(composed);
    expect(store.undo()).toBe("Rotate prefab");
    expect(store.state.workingTerrain?.copyHeights()).toEqual(composed?.copyHeights());
    expect(store.redo()).toBe("Rotate prefab");
    expect(store.state.workingTerrain?.copyHeights()).toEqual(rotatedTerrain?.copyHeights());
  });

  it("keeps the loaded catalogue immutable and records its portable source hint", async () => {
    const store = new EditorStore();
    store.createProject("Catalogue", await fixtureTerrain(), { npy: "terrain.npy", descriptor: "terrain.json" });
    const catalog = AssetCatalog.fromDocument({
      format: "polygon-county-asset-catalog",
      schema_version: 3,
      category_defaults: { house: { proxy: { width_m: 10, depth_m: 8, wall_height_m: 4 } } },
      assets: { house: { category: "house", resource: "house.glb" } },
    });
    store.setAssetCatalog(catalog, "catalog.json");
    expect(store.state.assetCatalog).toBe(catalog);
    expect(store.state.model?.sources.asset_catalog).toBe("catalog.json");
    expect(store.toDocument().sources.asset_catalog).toBe("catalog.json");
  });
});
