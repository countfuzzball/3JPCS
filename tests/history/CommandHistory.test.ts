import { describe, expect, it } from "vitest";
import {
  AddEntityCommand,
  CommandHistory,
  UpdateEntityCommand,
  createRemoveCommand,
} from "../../src/history/CommandHistory";
import type { PlaceRegion, PrefabInstance, Road, VegetationInstance } from "../../src/model/entities";
import { ProjectModel } from "../../src/model/ProjectModel";
import { fixtureTerrain } from "../helpers/fixtures";

const ROAD_ID = "10000000-0000-4000-8000-000000000001";
const PREFAB_ID = "10000000-0000-4000-8000-000000000002";

describe("delta command history", () => {
  it("groups one add/update gesture as one undo and supports redo", async () => {
    const model = await emptyModel();
    const history = new CommandHistory();
    const place = placeRegion();
    expect(history.execute(model, new AddEntityCommand("Create Town", place))).toBe(true);
    const moved: PlaceRegion = { ...place, points: [[2, 2], [8, 2], [8, 8]] };
    expect(history.execute(model, new UpdateEntityCommand("Move object", place, moved))).toBe(true);

    expect(history.undo(model)).toBe("Move object");
    expect(model.get(place.id)).toBe(place);
    expect(history.undo(model)).toBe("Create Town");
    expect(model.get(place.id)).toBeUndefined();
    expect(history.redo(model)).toBe("Create Town");
    expect(model.get(place.id)).toBe(place);
  });

  it("ignores no-op edits and invalidates redo after a new edit", async () => {
    const model = await emptyModel();
    const history = new CommandHistory();
    const place = placeRegion();
    history.execute(model, new AddEntityCommand("Create", place));
    expect(history.execute(model, new UpdateEntityCommand("No-op", place, { ...place }))).toBe(false);
    expect(history.undo(model)).toBe("Create");
    expect(history.canRedo).toBe(true);
    const replacement = { ...place, id: "10000000-0000-4000-8000-000000000099", name: "Replacement" };
    history.execute(model, new AddEntityCommand("Replacement", replacement));
    expect(history.canRedo).toBe(false);
  });

  it("deletes a road and clears frontage references in one reversible transaction", async () => {
    const model = await emptyModel();
    const history = new CommandHistory();
    const road = roadRecord();
    const prefab = prefabRecord();
    model.insert(road);
    model.insert(prefab);

    history.execute(model, createRemoveCommand(model, road.id, "Delete road"));
    expect(model.get(road.id)).toBeUndefined();
    expect(model.get(prefab.id)).toMatchObject({ frontage_road_id: null });
    expect(history.undo(model)).toBe("Delete road");
    expect(model.get(road.id)).toBe(road);
    expect(model.get(prefab.id)).toBe(prefab);
    expect(history.redo(model)).toBe("Delete road");
    expect(model.get(road.id)).toBeUndefined();
  });

  it("ordinary entity edits retain unrelated vegetation record identity", async () => {
    const model = await emptyModel();
    const history = new CommandHistory();
    const vegetation: VegetationInstance = {
      kind: "vegetation",
      id: "10000000-0000-4000-8000-000000000003",
      name: "Tree",
      visible: true,
      locked: false,
      vegetation_type: "forest_tree",
      asset_id: "oak",
      x_m: 5,
      z_m: 5,
      rotation_deg: 0,
      scale: 1,
      source_region_id: null,
    };
    const place = placeRegion();
    model.insert(vegetation);
    model.insert(place);
    history.execute(model, new UpdateEntityCommand("Rename", place, { ...place, name: "Renamed" }));
    expect(model.get(vegetation.id)).toBe(vegetation);
  });
});

async function emptyModel(): Promise<ProjectModel> {
  const terrain = await fixtureTerrain();
  return ProjectModel.create({
    name: "History Golden",
    world: { width_m: 20, depth_m: 20, terrain_spacing_m: 10 },
    sources: { terrain_npy: "terrain.npy", terrain_descriptor: "terrain.json", vegetation: null, county_features: null, asset_catalog: null },
    terrain_fingerprint: terrain.fingerprint,
  });
}

function placeRegion(): PlaceRegion {
  return {
    kind: "place",
    id: "10000000-0000-4000-8000-000000000010",
    name: "Town",
    visible: true,
    locked: false,
    place_type: "town",
    points: [[1, 1], [7, 1], [7, 7]],
  };
}

function roadRecord(): Road {
  return {
    kind: "road",
    id: ROAD_ID,
    name: "Road",
    visible: true,
    locked: false,
    points: [[1, 1], [19, 1]],
    width_m: 5,
    road_class: "lane",
    surface: "gravel",
  };
}

function prefabRecord(): PrefabInstance {
  return {
    kind: "prefab",
    id: PREFAB_ID,
    name: "House",
    visible: true,
    locked: false,
    category: "house",
    asset_id: "house",
    x_m: 5,
    z_m: 5,
    rotation_deg: 0,
    scale: 1,
    frontage_road_id: ROAD_ID,
    terrain_pad: { enabled: false, width_m: 12, depth_m: 12, blend_m: 8, target_mode: "base_terrain_at_origin" },
  };
}
