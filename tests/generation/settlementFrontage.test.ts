import { describe, expect, it } from "vitest";
import {
  buildSettlementFrontagePlan,
  detectRoadJunctions,
  settlementRoadEligibility,
  type SettlementFrontageInput,
  type SettlementFrontageSettings,
} from "../../src/generation/settlementFrontage";
import { pointInPolygon } from "../../src/generation/geometry";
import type { PlaceRegion, PrefabInstance, Road, WorldBounds } from "../../src/model/entities";
import type { TerrainSurface } from "../../src/terrain/TerrainSurface";

const WORLD: WorldBounds = { widthM: 200, depthM: 200 };
const SETTLEMENT: PlaceRegion = {
  kind: "place",
  id: "00000000-0000-4000-8000-000000000001",
  name: "Village",
  visible: true,
  locked: false,
  place_type: "village",
  points: [[20, 20], [180, 20], [180, 180], [20, 180]],
};
const EAST_WEST = road("00000000-0000-4000-8000-000000000011", "High Street", [[0, 80], [200, 80]]);
const NORTH_SOUTH = road("00000000-0000-4000-8000-000000000012", "Cross Road", [[120, 0], [120, 200]]);
const SETTINGS: SettlementFrontageSettings = {
  side: "left",
  setbackM: 6,
  gapM: 10,
  endClearanceM: 10,
  maximumPlotSlopeDeg: 15,
  junctionClearanceM: 18,
  spacingJitterM: 2,
  yawJitterDeg: 5,
  seed: 123,
};

describe("settlement-scale frontage", () => {
  it("clips multiple eligible roads, detects junctions, and produces deterministic jittered candidates", () => {
    const input = frontageInput([EAST_WEST, NORTH_SOUTH]);
    const first = buildSettlementFrontagePlan(input);
    const second = buildSettlementFrontagePlan(input);
    const otherSeed = buildSettlementFrontagePlan({
      ...input,
      settings: { ...input.settings, seed: 124 },
    });

    expect(second).toEqual(first);
    expect(first.eligibleRoadIds).toEqual([EAST_WEST.id, NORTH_SOUTH.id]);
    expect(first.ranges).toHaveLength(2);
    expect(first.ranges.map(({ lengthM }) => lengthM)).toEqual([160, 160]);
    expect(first.junctions).toEqual([{ point: [120, 80], roadIds: [EAST_WEST.id, NORTH_SOUTH.id] }]);
    expect(first.candidates.length).toBeGreaterThan(10);
    expect(first.acceptedCount).toBeGreaterThan(0);
    expect(first.skipped.junction_clearance).toBeGreaterThan(0);
    expect(otherSeed.candidates.map(({ xM, zM, rotationDeg }) => [xM, zM, rotationDeg]))
      .not.toEqual(first.candidates.map(({ xM, zM, rotationDeg }) => [xM, zM, rotationDeg]));
    for (const candidate of first.candidates.filter(({ skipReason }) => skipReason === null)) {
      expect(candidate.footprint.every(([x, z]) => pointInPolygon({ x, z }, SETTLEMENT.points))).toBe(true);
      expect([EAST_WEST.id, NORTH_SOUTH.id]).toContain(candidate.roadId);
      expect(candidate.maximumPlotSlopeDeg).toBe(0);
    }
  });

  it("clips concave settlements into every disjoint road range", () => {
    const place: PlaceRegion = {
      ...SETTLEMENT,
      points: [[0, 0], [100, 0], [100, 100], [70, 100], [70, 30], [30, 30], [30, 100], [0, 100]],
    };
    const crossing = road("00000000-0000-4000-8000-000000000013", "Crossing", [[0, 50], [100, 50]]);
    const eligibility = settlementRoadEligibility(place, [crossing], { widthM: 100, depthM: 100 });
    expect(eligibility).toHaveLength(1);
    expect(eligibility[0]?.ranges).toEqual([
      { roadId: crossing.id, startDistanceM: 0, endDistanceM: 30, lengthM: 30, points: [[0, 50], [30, 50]] },
      { roadId: crossing.id, startDistanceM: 70, endDistanceM: 100, lengthM: 30, points: [[70, 50], [100, 50]] },
    ]);
  });

  it("detects crossing, endpoint, and multi-road junctions without duplicate records", () => {
    const endpoint = road("00000000-0000-4000-8000-000000000013", "Endpoint", [[120, 80], [160, 120]]);
    expect(detectRoadJunctions([EAST_WEST, NORTH_SOUTH, endpoint])).toEqual([{
      point: [120, 80],
      roadIds: [EAST_WEST.id, NORTH_SOUTH.id, endpoint.id],
    }]);
  });

  it("checks plot slope at candidate centres and footprint corners", () => {
    const input = frontageInput([EAST_WEST], {
      terrain: terrain((x) => x >= 105 ? 30 : 0),
      settings: { ...SETTINGS, spacingJitterM: 0, yawJitterDeg: 0, junctionClearanceM: 0 },
    });
    const plan = buildSettlementFrontagePlan(input);
    expect(plan.acceptedCount).toBeGreaterThan(0);
    expect(plan.skipped.excessive_plot_slope).toBeGreaterThan(0);
    expect(plan.candidates.some(({ skipReason, maximumPlotSlopeDeg }) => (
      skipReason === "excessive_plot_slope" && maximumPlotSlopeDeg === 30
    ))).toBe(true);
  });

  it("rechecks existing-prefab overlap after deterministic placement", () => {
    const settings = { ...SETTINGS, spacingJitterM: 0, yawJitterDeg: 0, junctionClearanceM: 0 };
    const baseInput = frontageInput([EAST_WEST], { settings });
    const baseline = buildSettlementFrontagePlan(baseInput);
    const target = baseline.candidates.find(({ skipReason }) => skipReason === null);
    expect(target).toBeDefined();
    const occupied: PrefabInstance = {
      kind: "prefab",
      id: "00000000-0000-4000-8000-000000000021",
      name: "Existing House",
      visible: true,
      locked: false,
      category: "house",
      asset_id: "house",
      x_m: target?.xM ?? 0,
      z_m: target?.zM ?? 0,
      rotation_deg: target?.rotationDeg ?? 0,
      scale: 1,
      frontage_road_id: EAST_WEST.id,
      terrain_pad: { enabled: false, width_m: 12, depth_m: 12, blend_m: 0, target_mode: "base_terrain_at_origin" },
    };
    const plan = buildSettlementFrontagePlan({ ...baseInput, prefabs: [occupied] });
    expect(plan.skipped.prefab_overlap).toBeGreaterThan(0);
  });

  it("accounts separately for outside-world, outside-settlement, road, junction, and slope skips", () => {
    const stable = { ...SETTINGS, spacingJitterM: 0, yawJitterDeg: 0 };
    const edgeSettlement: PlaceRegion = {
      ...SETTLEMENT,
      points: [[0, 0], [200, 0], [200, 200], [0, 200]],
    };
    const edgeRoad = road("00000000-0000-4000-8000-000000000014", "Edge", [[0, 5], [200, 5]]);
    const outsideWorld = buildSettlementFrontagePlan(frontageInput([edgeRoad], {
      settlement: edgeSettlement,
      settings: { ...stable, junctionClearanceM: 0 },
    }));
    expect(outsideWorld.skipped.outside_world).toBeGreaterThan(0);

    const narrowSettlement: PlaceRegion = {
      ...SETTLEMENT,
      points: [[20, 70], [180, 70], [180, 90], [20, 90]],
    };
    const outsideSettlement = buildSettlementFrontagePlan(frontageInput([EAST_WEST], {
      settlement: narrowSettlement,
      settings: { ...stable, junctionClearanceM: 0 },
    }));
    expect(outsideSettlement.skipped.outside_settlement).toBeGreaterThan(0);

    const parallel = road("00000000-0000-4000-8000-000000000015", "Parallel", [[0, 68], [200, 68]]);
    const roadClash = buildSettlementFrontagePlan(frontageInput([EAST_WEST, parallel], {
      eligibleRoadIds: [EAST_WEST.id],
      settings: { ...stable, junctionClearanceM: 0 },
    }));
    expect(roadClash.skipped.road_clash).toBeGreaterThan(0);

    const junction = buildSettlementFrontagePlan(frontageInput([EAST_WEST, NORTH_SOUTH], {
      settings: { ...stable, junctionClearanceM: 18 },
    }));
    expect(junction.skipped.junction_clearance).toBeGreaterThan(0);

    const slope = buildSettlementFrontagePlan(frontageInput([EAST_WEST], {
      terrain: terrain(() => 30),
      settings: { ...stable, junctionClearanceM: 0 },
    }));
    expect(slope.skipped.excessive_plot_slope).toBeGreaterThan(0);

    for (const plan of [outsideWorld, outsideSettlement, roadClash, junction, slope]) {
      expect(plan.acceptedCount + Object.values(plan.skipped).reduce((sum, count) => sum + count, 0))
        .toBe(plan.candidates.length);
    }
  });
});

function frontageInput(
  roads: readonly Road[],
  overrides: Partial<SettlementFrontageInput> = {},
): SettlementFrontageInput {
  return {
    settlement: SETTLEMENT,
    eligibleRoadIds: roads.map(({ id }) => id),
    roads,
    proxy: { widthM: 10, depthM: 8 },
    settings: SETTINGS,
    world: WORLD,
    prefabs: [],
    catalog: null,
    terrain: terrain(() => 0),
    ...overrides,
  };
}

function road(id: string, name: string, points: Road["points"]): Road {
  return {
    kind: "road",
    id,
    name,
    visible: true,
    locked: false,
    points,
    width_m: 4,
    road_class: "local_road",
    surface: "gravel",
  };
}

function terrain(slopeAt: (xM: number, zM: number) => number): TerrainSurface {
  return {
    worldWidthM: WORLD.widthM,
    worldDepthM: WORLD.depthM,
    spacingM: 10,
    cellCountX: 20,
    cellCountZ: 20,
    pointCountX: 21,
    pointCountZ: 21,
    minimumElevationM: 0,
    seaLevelM: 0,
    lowlandReferenceElevationM: 0,
    maximumElevationM: 100,
    heightAtGrid: () => 0,
    heightAt: () => 0,
    slopeAt,
    copyHeights: () => new Float32Array(21 * 21),
  };
}
