import { describe, expect, it } from "vitest";
import type { PrefabInstance, Road, VegetationInstance } from "../../src/model/entities";
import { ProjectModel } from "../../src/model/ProjectModel";
import { fixtureTerrain } from "../helpers/fixtures";

const ROAD_ID = "00000000-0000-4000-8000-000000000001";
const PREFAB_ID = "00000000-0000-4000-8000-000000000002";
const VEGETATION_ID = "00000000-0000-4000-8000-000000000003";

describe("normalized project model and DTO contracts", () => {
  it("preserves explicit collection order, O(1) identity lookup, and v4 serialization", async () => {
    const model = await emptyModel();
    const first = road(ROAD_ID, "First road");
    const second = road("00000000-0000-4000-8000-000000000004", "Second road");
    model.insert(first);
    model.insert(second);

    expect(model.get(first.id)).toBe(first);
    expect(model.list("road").map((item) => item.name)).toEqual(["First road", "Second road"]);
    expect(model.nextUniqueName("First road")).toBe("First road 2");
    const document = model.toDocument();
    expect(document.schema_version).toBe(4);
    expect(document.roads.map((item) => item.name)).toEqual(["First road", "Second road"]);
    expect(document.roads[0]).not.toHaveProperty("kind");
    expect(document.vegetation_instances).toEqual([]);
  });

  it.each([1, 2, 3, 4] as const)("strictly loads schema v%s and normalizes to v4", async (version) => {
    const model = await populatedModel();
    const document = structuredClone(model.toDocument()) as unknown as Record<string, unknown>;
    document.schema_version = version;
    if (version < 4) delete document.vegetation_instances;
    if (version < 3) {
      const sources = document.sources as Record<string, unknown>;
      sources.prefab_catalog = sources.asset_catalog;
      delete sources.asset_catalog;
    }
    if (version === 1) {
      const prefabs = document.prefab_instances as Record<string, unknown>[];
      delete prefabs[0]?.terrain_pad;
    }

    const loaded = ProjectModel.fromDocument(document);
    expect(loaded.toDocument().schema_version).toBe(4);
    expect(loaded.sources.asset_catalog).toBe("catalog.json");
    expect(loaded.list("vegetation")).toHaveLength(version === 4 ? 1 : 0);
    const prefab = loaded.list("prefab")[0];
    expect(prefab?.kind).toBe("prefab");
    if (prefab?.kind === "prefab") {
      expect(prefab.rotation_deg).toBe(450);
      expect(prefab.terrain_pad.enabled).toBe(version === 1 ? false : true);
    }
  });

  it("rejects unknown fields, duplicate cross-collection UUIDs, and unresolved frontage", async () => {
    const model = await populatedModel();
    const unknown = structuredClone(model.toDocument()) as unknown as Record<string, unknown>;
    unknown.surprise = true;
    expect(() => ProjectModel.fromDocument(unknown)).toThrow(/unknown surprise/i);

    const duplicate = structuredClone(model.toDocument());
    const vegetation = duplicate.vegetation_instances[0];
    if (vegetation) vegetation.id = ROAD_ID;
    expect(() => ProjectModel.fromDocument(duplicate)).toThrow(/duplicate authored object id/i);

    const unresolved = structuredClone(model.toDocument());
    const prefab = unresolved.prefab_instances[0];
    if (prefab) prefab.frontage_road_id = "00000000-0000-4000-8000-000000000099";
    expect(() => ProjectModel.fromDocument(unresolved)).toThrow(/does not resolve/i);
  });

  it("rejects invalid enums, non-finite values, and inclusive-world violations", async () => {
    const model = await populatedModel();
    const invalidEnum = structuredClone(model.toDocument());
    const roadValue = invalidEnum.roads[0];
    if (roadValue) roadValue.surface = "mud";
    expect(() => ProjectModel.fromDocument(invalidEnum)).toThrow(/unsupported value/i);

    const nonFinite = structuredClone(model.toDocument());
    const vegetation = nonFinite.vegetation_instances[0];
    if (vegetation) vegetation.scale = Number.POSITIVE_INFINITY;
    expect(() => ProjectModel.fromDocument(nonFinite)).toThrow(/finite number/i);

    const outside = structuredClone(model.toDocument());
    const points = outside.roads[0]?.points as number[][] | undefined;
    if (points?.[0]) points[0][0] = 21;
    expect(() => ProjectModel.fromDocument(outside)).toThrow(/outside/i);

    const edge = structuredClone(model.toDocument());
    const edgePoints = edge.roads[0]?.points as number[][] | undefined;
    if (edgePoints?.[0]) edgePoints[0] = [20, 20];
    expect(() => ProjectModel.fromDocument(edge)).not.toThrow();
  });
});

async function emptyModel(): Promise<ProjectModel> {
  const terrain = await fixtureTerrain();
  return ProjectModel.create({
    name: "Model Golden",
    world: { width_m: 20, depth_m: 20, terrain_spacing_m: 10 },
    sources: {
      terrain_npy: "terrain.npy",
      terrain_descriptor: "terrain.json",
      vegetation: null,
      county_features: null,
      asset_catalog: "catalog.json",
    },
    terrain_fingerprint: terrain.fingerprint,
  });
}

async function populatedModel(): Promise<ProjectModel> {
  const model = await emptyModel();
  model.insert(road(ROAD_ID, "Road"));
  const prefab: PrefabInstance = {
    kind: "prefab",
    id: PREFAB_ID,
    name: "House",
    visible: true,
    locked: false,
    category: "house",
    asset_id: "house",
    x_m: 5,
    z_m: 5,
    rotation_deg: 450,
    scale: 1,
    frontage_road_id: ROAD_ID,
    terrain_pad: { enabled: true, width_m: 6, depth_m: 8, blend_m: 2, target_mode: "base_terrain_at_origin" },
  };
  const vegetation: VegetationInstance = {
    kind: "vegetation",
    id: VEGETATION_ID,
    name: "Oak",
    visible: true,
    locked: false,
    vegetation_type: "forest_tree",
    asset_id: "oak",
    x_m: 20,
    z_m: 20,
    rotation_deg: 217.5,
    scale: 1.04,
    source_region_id: null,
  };
  model.insert(prefab);
  model.insert(vegetation);
  return model;
}

function road(id: string, name: string): Road {
  return {
    kind: "road",
    id,
    name,
    visible: true,
    locked: false,
    points: [[0, 0], [10, 10]],
    width_m: 7.5,
    road_class: "local_road",
    surface: "gravel",
  };
}
