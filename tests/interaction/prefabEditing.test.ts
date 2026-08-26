import { describe, expect, it } from "vitest";
import { AssetCatalog } from "../../src/model/assetCatalog";
import type { PrefabInstance } from "../../src/model/entities";
import {
  hitTestPrefab,
  movePrefab,
  prefabFootprint,
  prefabFrontMarker,
  prefabProxySize,
  rotateLocalPoint,
} from "../../src/interaction/prefabEditing";

const prefab: PrefabInstance = {
  kind: "prefab",
  id: "11111111-1111-4111-8111-111111111111",
  name: "House",
  visible: true,
  locked: false,
  category: "house",
  asset_id: "house",
  x_m: 20,
  z_m: 30,
  rotation_deg: 90,
  scale: 2,
  frontage_road_id: null,
  terrain_pad: { enabled: false, width_m: 12, depth_m: 12, blend_m: 8, target_mode: "base_terrain_at_origin" },
};

const catalog = AssetCatalog.fromDocument({
  format: "polygon-county-asset-catalog",
  schema_version: 3,
  category_defaults: { house: { proxy: { width_m: 4, depth_m: 8, wall_height_m: 5 } } },
  assets: { house: { category: "house", resource: "house.glb" } },
});

describe("prefab plan-view transforms", () => {
  it("uses clockwise-positive yaw with local -Z as prefab front", () => {
    expect(rotateLocalPoint(0, -4, 0)).toEqual([0, -4]);
    expect(rotateLocalPoint(0, -4, 90)[0]).toBeCloseTo(4);
    const [, front] = prefabFrontMarker(20, 30, 8, 90);
    expect(front[0]).toBeCloseTo(24);
    expect(front[1]).toBeCloseTo(30);
  });

  it("scales catalogue proxies while leaving authored pad dimensions independent", () => {
    expect(prefabProxySize(prefab, catalog)).toEqual({ widthM: 8, depthM: 16, wallHeightM: 10, resolved: true });
    expect(prefab.terrain_pad.width_m).toBe(12);
    expect(prefabFootprint(20, 30, 8, 16, 90)).toHaveLength(4);
  });

  it("picks visible prefab footprints in reverse authored order and obeys the layer", () => {
    const top = { ...prefab, id: "22222222-2222-4222-8222-222222222222", name: "Top" };
    expect(hitTestPrefab([prefab, top], { x: 20, z: 30 }, catalog, true)?.id).toBe(top.id);
    expect(hitTestPrefab([prefab], { x: 20, z: 30 }, catalog, false)).toBeNull();
    expect(hitTestPrefab([{ ...prefab, visible: false }], { x: 20, z: 30 }, catalog, true)).toBeNull();
  });

  it("clamps only the prefab origin and permits proxy footprints outside the world", () => {
    expect(movePrefab(prefab, { x: 100, z: -100 }, { widthM: 50, depthM: 50 })).toMatchObject({ x_m: 50, z_m: 0 });
  });
});
