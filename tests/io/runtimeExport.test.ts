import { describe, expect, it } from "vitest";
import { runtimeSceneryV2Document, runtimeSceneryV3Document } from "../../src/io/runtimeExport";
import { ProjectModel } from "../../src/model/ProjectModel";
import type { PrefabInstance, Road } from "../../src/model/entities";
import { WorkingTerrain } from "../../src/terrain/WorkingTerrain";
import { fixtureTerrain } from "../helpers/fixtures";

describe("runtime scenery v2", () => {
  it("uses derived Y/hash, normalizes yaw, and omits editor/source state", async () => {
    const terrain = await fixtureTerrain();
    const model = ProjectModel.create({
      name: "Runtime",
      world: { width_m: 20, depth_m: 20, terrain_spacing_m: 10 },
      sources: { terrain_npy: "terrain.npy", terrain_descriptor: "terrain.json", vegetation: null, county_features: null, asset_catalog: "catalog.json" },
      terrain_fingerprint: terrain.fingerprint,
    });
    const road: Road = {
      kind: "road", id: "11111111-1111-4111-8111-111111111111", name: "Road", visible: true, locked: true,
      points: [[0, 0], [20, 20]], width_m: 4, road_class: "local_road", surface: "gravel",
    };
    const prefab: PrefabInstance = {
      kind: "prefab", id: "22222222-2222-4222-8222-222222222222", name: "House", visible: false, locked: true,
      category: "house", asset_id: "missing", x_m: 5, z_m: 5, rotation_deg: -15, scale: 1,
      frontage_road_id: road.id, terrain_pad: { enabled: true, width_m: 4, depth_m: 4, blend_m: 0, target_mode: "base_terrain_at_origin" },
    };
    model.insert(road);
    model.insert(prefab);
    const working = WorkingTerrain.compose(terrain, model.prefabInstances());
    const output = await runtimeSceneryV2Document(model, working, null);
    const records = output.prefab_instances as Record<string, unknown>[];
    expect(output.terrain_float32_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(records[0]).toMatchObject({ rotation_deg: 345, visible: false, asset_status: "missing", terrain_y_m: working.heightAt(5, 5) });
    expect(records[0]).not.toHaveProperty("locked");
    expect(records[0]).not.toHaveProperty("terrain_pad");
    expect(JSON.stringify(output)).not.toContain("catalog.json");
    expect((output.roads as Record<string, unknown>[])[0]).toMatchObject({ elevation_mode: "follow_terrain" });
  });

  it("refuses to silently omit native v4 vegetation", async () => {
    const terrain = await fixtureTerrain();
    const model = ProjectModel.create({
      name: "Runtime",
      world: { width_m: 20, depth_m: 20, terrain_spacing_m: 10 },
      sources: { terrain_npy: "terrain.npy", terrain_descriptor: "terrain.json", vegetation: null, county_features: null, asset_catalog: null },
      terrain_fingerprint: terrain.fingerprint,
    });
    model.insert({
      kind: "vegetation", id: "33333333-3333-4333-8333-333333333333", name: "Tree", visible: true, locked: false,
      vegetation_type: "forest_tree", asset_id: "oak", x_m: 4, z_m: 5, rotation_deg: 0, scale: 1, source_region_id: null,
    });
    await expect(runtimeSceneryV2Document(model, WorkingTerrain.compose(terrain, []), null))
      .rejects.toThrow(/cannot represent native vegetation/i);
  });

  it("exports native vegetation through runtime v3 with derived Y and normalized yaw", async () => {
    const terrain = await fixtureTerrain();
    const model = ProjectModel.create({
      name: "Runtime v3",
      world: { width_m: 20, depth_m: 20, terrain_spacing_m: 10 },
      sources: { terrain_npy: "terrain.npy", terrain_descriptor: "terrain.json", vegetation: null, county_features: null, asset_catalog: null },
      terrain_fingerprint: terrain.fingerprint,
    });
    model.insert({
      kind: "vegetation", id: "33333333-3333-4333-8333-333333333333", name: "Tree", visible: false, locked: true,
      vegetation_type: "forest_tree", asset_id: "oak", x_m: 4, z_m: 5, rotation_deg: 450, scale: 1.2,
      source_region_id: "44444444-4444-4444-8444-444444444444",
    });
    const working = WorkingTerrain.compose(terrain, []);
    const output = await runtimeSceneryV3Document(model, working, null);
    const records = output.vegetation_instances as Record<string, unknown>[];
    expect(output.schema_version).toBe(3);
    expect(records[0]).toEqual({
      id: "33333333-3333-4333-8333-333333333333",
      name: "Tree",
      visible: false,
      vegetation_type: "forest_tree",
      asset_id: "oak",
      x_m: 4,
      z_m: 5,
      terrain_y_m: working.heightAt(4, 5),
      rotation_deg: 90,
      scale: 1.2,
      source_region_id: "44444444-4444-4444-8444-444444444444",
      asset_status: "missing",
    });
    expect(records[0]).not.toHaveProperty("locked");
  });
});
