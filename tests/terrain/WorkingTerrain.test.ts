import { describe, expect, it } from "vitest";
import { DEFAULT_TERRAIN_PAD, type PrefabInstance } from "../../src/model/entities";
import { parseTerrainDescriptor } from "../../src/model/terrainDescriptor";
import { TerrainReference } from "../../src/terrain/TerrainReference";
import { WorkingTerrain } from "../../src/terrain/WorkingTerrain";
import { fixtureJson } from "../helpers/fixtures";

interface Golden {
  readonly base: readonly (readonly number[])[];
  readonly world: { readonly width_m: number; readonly depth_m: number; readonly spacing_m: number; readonly minimum_elevation_m: number; readonly maximum_elevation_m: number };
  readonly rotated: readonly (readonly number[])[];
  readonly overlap_ab: readonly (readonly number[])[];
  readonly overlap_ba: readonly (readonly number[])[];
}

const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_B = "22222222-2222-4222-8222-222222222222";

function prefab(id: string, name: string, overrides: Partial<PrefabInstance>): PrefabInstance {
  return {
    kind: "prefab",
    id,
    name,
    visible: true,
    locked: false,
    category: "house",
    asset_id: name.toLowerCase(),
    x_m: 10,
    z_m: 10,
    rotation_deg: 0,
    scale: 1,
    frontage_road_id: null,
    terrain_pad: { ...DEFAULT_TERRAIN_PAD },
    ...overrides,
  };
}

async function goldenTerrain(): Promise<{ readonly golden: Golden; readonly terrain: TerrainReference }> {
  const golden = await fixtureJson<Golden>("working-terrain-python-golden.json");
  const descriptor = parseTerrainDescriptor({
    world_width_m: golden.world.width_m,
    world_depth_m: golden.world.depth_m,
    terrain_spacing_m: golden.world.spacing_m,
    terrain_cells: { x: 4, z: 4, total: 16 },
    elevation_points: { x: 5, z: 5, total: 25 },
    minimum_elevation_m: golden.world.minimum_elevation_m,
    sea_level_m: 0,
    lowland_reference_elevation_m: 5,
    maximum_elevation_m: golden.world.maximum_elevation_m,
    uint16_reference_values: { sea_level: 0, lowland_reference: 3277 },
    vertical_encoding: "Unsigned 16-bit greyscale: 0 maps to minimum_elevation_m and 65535 maps to maximum_elevation_m; values outside that range are clipped.",
    grid_layout: "Rows increase along +Z; columns increase along +X.",
    cell_diagonal: "Each cell is divided from northwest to southeast.",
  });
  return {
    golden,
    terrain: new TerrainReference(descriptor, new Float32Array(golden.base.flat()), "0".repeat(64)),
  };
}

describe("WorkingTerrain", () => {
  it("matches the Python rotated/blended float32 golden exactly and leaves base immutable", async () => {
    const { golden, terrain } = await goldenTerrain();
    const before = terrain.copyHeights();
    const rotated = prefab(ID_A, "Rotated", {
      x_m: 17,
      z_m: 19,
      rotation_deg: 33,
      terrain_pad: { enabled: true, width_m: 12, depth_m: 7, blend_m: 6, target_mode: "base_terrain_at_origin" },
    });
    const working = WorkingTerrain.compose(terrain, [rotated]);
    expect([...working.copyHeights()]).toEqual(golden.rotated.flat());
    expect(await working.sha256()).toBe("34c065d9c71f9ac40b69a7660f6f4359b1fd96036ca7800b727e1beb4b458160");
    expect(terrain.copyHeights()).toEqual(before);
  });

  it("matches Python order-sensitive overlapping pad goldens deterministically", async () => {
    const { golden, terrain } = await goldenTerrain();
    const a = prefab(ID_A, "A", {
      x_m: 15,
      z_m: 15,
      terrain_pad: { enabled: true, width_m: 12, depth_m: 10, blend_m: 8, target_mode: "base_terrain_at_origin" },
    });
    const b = prefab(ID_B, "B", {
      x_m: 23,
      z_m: 18,
      rotation_deg: 35,
      terrain_pad: { enabled: true, width_m: 9, depth_m: 15, blend_m: 5, target_mode: "base_terrain_at_origin" },
    });
    expect([...WorkingTerrain.compose(terrain, [a, b]).copyHeights()]).toEqual(golden.overlap_ab.flat());
    expect([...WorkingTerrain.compose(terrain, [b, a]).copyHeights()]).toEqual(golden.overlap_ba.flat());
    expect(golden.overlap_ab).not.toEqual(golden.overlap_ba);
  });

  it("ignores hidden or disabled pads and does not let prefab scale alter pad composition", async () => {
    const { terrain } = await goldenTerrain();
    const active = prefab(ID_A, "Active", {
      x_m: 17,
      z_m: 19,
      terrain_pad: { enabled: true, width_m: 5, depth_m: 5, blend_m: 4, target_mode: "base_terrain_at_origin" },
    });
    const baseline = WorkingTerrain.compose(terrain, [active]).copyHeights();
    expect(WorkingTerrain.compose(terrain, [{ ...active, scale: 4 }]).copyHeights()).toEqual(baseline);
    expect(WorkingTerrain.compose(terrain, [{ ...active, visible: false }]).copyHeights()).toEqual(terrain.copyHeights());
    expect(WorkingTerrain.compose(terrain, [{ ...active, terrain_pad: { ...active.terrain_pad, enabled: false } }]).copyHeights()).toEqual(terrain.copyHeights());
  });

  it("expands a sub-cell pad so it still changes its intersected coarse cell", async () => {
    const { terrain } = await goldenTerrain();
    const tiny = prefab(ID_A, "Tiny", {
      x_m: 15,
      z_m: 15,
      terrain_pad: { enabled: true, width_m: 1, depth_m: 1, blend_m: 0, target_mode: "base_terrain_at_origin" },
    });
    expect(WorkingTerrain.compose(terrain, [tiny]).copyHeights()).not.toEqual(terrain.copyHeights());
  });

  it("reports footprint elevation, slope, and out-of-world site information", async () => {
    const { terrain } = await goldenTerrain();
    const working = WorkingTerrain.compose(terrain, []);
    const info = working.footprintSiteInfo([[-2, 2], [8, 2], [8, 12], [-2, 12]], [3, 7]);
    expect(info.footprintOutsideWorld).toBe(true);
    expect(info.maximumElevationM).toBeGreaterThanOrEqual(info.minimumElevationM);
    expect(info.elevationRangeM).toBeCloseTo(info.maximumElevationM - info.minimumElevationM);
    expect(info.maximumSlopeDeg).toBeGreaterThanOrEqual(info.averageSlopeDeg);
  });
});
