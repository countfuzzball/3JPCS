import { describe, expect, it } from "vitest";
import { AssetCatalog } from "../../src/model/assetCatalog";
import type { PrefabInstance, Road } from "../../src/model/entities";
import {
  buildFrontagePlan,
  closestRoadAnchor,
  projectPointToRoad,
  type FrontageSettings,
} from "../../src/interaction/frontageAssist";

const road: Road = {
  kind: "road",
  id: "11111111-1111-4111-8111-111111111111",
  name: "High Street",
  visible: true,
  locked: false,
  points: [[0, 50], [100, 50]],
  width_m: 8,
  road_class: "local_road",
  surface: "gravel",
};

const defaults: FrontageSettings = {
  side: "left",
  setbackM: 6,
  gapM: 4,
  endClearanceM: 5,
};

const catalog = AssetCatalog.fromDocument({
  format: "polygon-county-asset-catalog",
  schema_version: 3,
  category_defaults: {
    house: { proxy: { width_m: 10, depth_m: 8, wall_height_m: 5 } },
  },
  assets: {
    house: { category: "house", resource: "house.glb" },
  },
});

describe("frontage assist", () => {
  it("projects clicks to cumulative road distance and respects the road hit tolerance", () => {
    const curved: Road = { ...road, points: [[0, 50], [50, 50], [50, 100]] };
    expect(projectPointToRoad(curved, { x: 53, z: 75 })).toMatchObject({
      roadId: road.id,
      distanceM: 75,
      point: [50, 75],
    });
    expect(closestRoadAnchor([curved], { x: 53, z: 75 }, 4)?.distanceM).toBe(75);
    expect(closestRoadAnchor([curved], { x: 60, z: 75 }, 4)).toBeNull();
  });

  it("centres repeated houses along arc length on the default left side and faces them toward the road", () => {
    const start = projectPointToRoad(road, { x: 0, z: 50 });
    const end = projectPointToRoad(road, { x: 100, z: 50 });
    expect(start).not.toBeNull();
    expect(end).not.toBeNull();
    const plan = buildFrontagePlan(
      road,
      start!,
      end!,
      { widthM: 10, depthM: 8 },
      defaults,
      { widthM: 100, depthM: 100 },
      [road],
      [],
      catalog,
    );

    expect(plan.rangeLengthM).toBe(100);
    expect(plan.acceptedCount).toBe(6);
    expect(plan.candidates.map((candidate) => candidate.xM)).toEqual([15, 29, 43, 57, 71, 85]);
    expect(plan.candidates.every((candidate) => candidate.zM === 36)).toBe(true);
    expect(plan.candidates.every((candidate) => candidate.rotationDeg === 180)).toBe(true);
    expect(plan.skipped).toEqual({ outside_world: 0, prefab_overlap: 0, road_clash: 0 });
  });

  it("follows bends by cumulative polyline distance instead of using a straight endpoint chord", () => {
    const curved: Road = { ...road, points: [[0, 50], [50, 50], [50, 100]], width_m: 2 };
    const start = projectPointToRoad(curved, { x: 0, z: 50 });
    const end = projectPointToRoad(curved, { x: 50, z: 100 });
    expect(start).not.toBeNull();
    expect(end).not.toBeNull();
    const plan = buildFrontagePlan(
      curved,
      start!,
      end!,
      { widthM: 4, depthM: 4 },
      { side: "left", setbackM: 2, gapM: 1, endClearanceM: 0 },
      { widthM: 150, depthM: 150 },
      [curved],
      [],
      catalog,
    );

    expect(plan.rangeLengthM).toBe(100);
    expect(plan.rangePoints).toEqual([[0, 50], [50, 50], [50, 100]]);
    expect(plan.candidates).toHaveLength(20);
    expect(plan.candidates[0]?.distanceM).toBe(2.5);
    expect(plan.candidates.at(-1)?.distanceM).toBe(97.5);
  });

  it("defines left and right from the first click toward the second and can populate both sides", () => {
    const start = projectPointToRoad(road, { x: 100, z: 50 });
    const end = projectPointToRoad(road, { x: 0, z: 50 });
    expect(start).not.toBeNull();
    expect(end).not.toBeNull();
    const plan = buildFrontagePlan(
      road,
      start!,
      end!,
      { widthM: 10, depthM: 8 },
      { ...defaults, side: "both" },
      { widthM: 100, depthM: 100 },
      [road],
      [],
      catalog,
    );

    expect(plan.acceptedCount).toBe(12);
    expect(plan.candidates.slice(0, 2)).toMatchObject([
      { side: "left", xM: 85, zM: 64, rotationDeg: 0 },
      { side: "right", xM: 85, zM: 36, rotationDeg: 180 },
    ]);
  });

  it("previews overlapping, road-clashing, and out-of-world candidates as skipped", () => {
    const start = projectPointToRoad(road, { x: 0, z: 50 });
    const end = projectPointToRoad(road, { x: 100, z: 50 });
    expect(start).not.toBeNull();
    expect(end).not.toBeNull();
    const occupied: PrefabInstance = {
      kind: "prefab",
      id: "22222222-2222-4222-8222-222222222222",
      name: "Existing house",
      visible: true,
      locked: false,
      category: "house",
      asset_id: "house",
      x_m: 15,
      z_m: 36,
      rotation_deg: 180,
      scale: 1,
      frontage_road_id: road.id,
      terrain_pad: { enabled: false, width_m: 12, depth_m: 12, blend_m: 8, target_mode: "base_terrain_at_origin" },
    };
    const crossingRoad: Road = {
      ...road,
      id: "33333333-3333-4333-8333-333333333333",
      name: "Side road",
      points: [[29, 25], [29, 47]],
      width_m: 4,
    };
    const plan = buildFrontagePlan(
      road,
      start!,
      end!,
      { widthM: 10, depthM: 8 },
      { ...defaults, side: "both" },
      { widthM: 100, depthM: 60 },
      [road, crossingRoad],
      [occupied],
      catalog,
    );

    expect(plan.candidates).toHaveLength(12);
    expect(plan.acceptedCount).toBe(4);
    expect(plan.skipped).toEqual({ outside_world: 6, prefab_overlap: 1, road_clash: 1 });
  });
});
