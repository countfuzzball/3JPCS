import { describe, expect, it } from "vitest";
import { AssetCatalog } from "../../src/model/assetCatalog";
import type { PrefabInstance } from "../../src/model/entities";
import { PrefabRenderAdapter } from "../../src/rendering/PrefabRenderAdapter";
import type { FrontagePlan } from "../../src/interaction/frontageAssist";

const catalog = AssetCatalog.fromDocument({
  format: "polygon-county-asset-catalog",
  schema_version: 3,
  category_defaults: { house: { proxy: { width_m: 10, depth_m: 8, wall_height_m: 4 } } },
  assets: { house: { category: "house", resource: "house.glb" } },
});

const prefab: PrefabInstance = {
  kind: "prefab",
  id: "11111111-1111-4111-8111-111111111111",
  name: "House",
  visible: true,
  locked: false,
  category: "house",
  asset_id: "house",
  x_m: 10,
  z_m: 12,
  rotation_deg: 45,
  scale: 1,
  frontage_road_id: null,
  terrain_pad: { enabled: true, width_m: 12, depth_m: 10, blend_m: 5, target_mode: "base_terrain_at_origin" },
};

describe("prefab render projection", () => {
  it("retains unchanged proxies and replaces only changed model records", () => {
    const adapter = new PrefabRenderAdapter();
    adapter.sync([prefab], catalog, null, { prefabs: true, terrainPads: true }, null, 101);
    const first = adapter.group.getObjectByName(`prefab:${prefab.id}`);
    adapter.sync([prefab], catalog, null, { prefabs: true, terrainPads: true }, null, 101);
    expect(adapter.group.getObjectByName(`prefab:${prefab.id}`)).toBe(first);
    adapter.sync([{ ...prefab, scale: 2 }], catalog, null, { prefabs: true, terrainPads: true }, null, 101);
    expect(adapter.group.getObjectByName(`prefab:${prefab.id}`)).not.toBe(first);
    adapter.dispose();
  });

  it("keeps layer and per-object visibility projection-only while selected pads remain inspectable", () => {
    const adapter = new PrefabRenderAdapter();
    adapter.sync([prefab], catalog, null, { prefabs: false, terrainPads: false }, null, 101);
    const root = adapter.group.getObjectByName(`prefab:${prefab.id}`);
    expect(root?.getObjectByName("prefab-footprint")?.visible).toBe(false);
    expect(root?.getObjectByName("terrain-pad-overlay")?.visible).toBe(false);
    adapter.sync([prefab], catalog, prefab.id, { prefabs: false, terrainPads: false }, null, 101);
    expect(adapter.group.getObjectByName(`prefab:${prefab.id}`)?.getObjectByName("terrain-pad-overlay")?.visible).toBe(true);
    expect(prefab).not.toHaveProperty("object3D");
    adapter.dispose();
  });

  it("renders a transient catalogue ghost without creating an authored record", () => {
    const adapter = new PrefabRenderAdapter();
    const asset = catalog.definition("house");
    expect(asset).toBeDefined();
    adapter.sync([], catalog, null, { prefabs: true, terrainPads: true }, { xM: 5, zM: 6, asset: asset! }, 101);
    expect(adapter.group.getObjectByName("prefab-placement-ghost")?.children.length).toBeGreaterThan(0);
    adapter.dispose();
  });

  it("batches valid and skipped frontage candidates into transient preview buffers", () => {
    const adapter = new PrefabRenderAdapter();
    const candidate = {
      side: "left" as const,
      distanceM: 10,
      xM: 10,
      zM: 20,
      rotationDeg: 180,
      footprint: [[5, 16], [15, 16], [15, 24], [5, 24]] as const,
      skipReason: null,
    };
    const plan: FrontagePlan = {
      roadId: "22222222-2222-4222-8222-222222222222",
      rangeLengthM: 30,
      rangePoints: [[0, 30], [30, 30]],
      candidates: [candidate, { ...candidate, xM: 24, skipReason: "prefab_overlap" }],
      acceptedCount: 1,
      skipped: { outside_world: 0, prefab_overlap: 1, road_clash: 0 },
    };
    adapter.sync([], catalog, null, { prefabs: true, terrainPads: true }, null, 101, plan);
    const preview = adapter.group.getObjectByName("frontage-preview");
    expect(preview?.getObjectByName("frontage-valid-candidates")).toBeDefined();
    expect(preview?.getObjectByName("frontage-skipped-candidates")).toBeDefined();
    expect(preview?.getObjectByName("frontage-road-range")).toBeDefined();
    expect(preview?.getObjectByName("frontage-range-anchors")).toBeDefined();
    expect(preview?.children).toHaveLength(4);
    adapter.dispose();
  });
});
