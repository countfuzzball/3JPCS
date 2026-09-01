import { describe, expect, it } from "vitest";
import {
  DEFAULT_COUNTY_ROAD_STYLES,
  buildCountyPlan,
  countyNamedSeed,
  materializeCountyPlan,
  settlementInteriorAnchor,
  type CountyAssetProgram,
  type CountyBuildInput,
  type CountyBuildRequest,
  type CountyBuildTerrainSnapshot,
} from "../../src/generation/countyBuild";
import type { PlaceRegion, PointTuple } from "../../src/model/entities";

describe("county build planning", () => {
  it("finds a deterministic interior anchor for a concave polygon", () => {
    const polygon: readonly PointTuple[] = [
      [0, 0], [10, 0], [10, 3], [4, 3], [4, 10], [0, 10],
    ];
    const first = settlementInteriorAnchor(polygon);
    const second = settlementInteriorAnchor(polygon);
    expect(second).toEqual(first);
    expect(first[0]).toBeGreaterThanOrEqual(0);
    expect(first[0]).toBeLessThanOrEqual(4);
    expect(first[1]).toBeGreaterThanOrEqual(0);
    expect(first[1]).toBeLessThanOrEqual(10);
  });

  it("plans, materializes, and atomically relates a complete existing-place county", () => {
    const input = countyInput();
    const request: CountyBuildRequest = { operationId: 1, kind: "county_build", seed: input.seed, input };
    const progress: string[] = [];
    const result = buildCountyPlan(request, flatTerrain(), (entry) => progress.push(entry.phase));
    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.output.complete).toBe(true);
    expect(result.output.places).toHaveLength(2);
    expect(result.output.roads.some(({ role }) => role === "backbone")).toBe(true);
    expect(result.output.roads.some(({ role }) => role === "access")).toBe(true);
    expect(result.output.roads.some(({ role }) => role === "plot" || role === "loop")).toBe(true);
    expect(result.output.prefabs.length).toBeGreaterThan(0);
    expect(result.output.prefabs.every(({ frontageRoadId }) => (
      result.output.roads.some(({ planId }) => planId === frontageRoadId)
    ))).toBe(true);
    expect(progress).toContain("survey");
    expect(progress).toContain("connections");
    expect(progress).toContain("buildings");

    let id = 0;
    const entities = materializeCountyPlan(result.output, input.existingPlaces.map(({ name }) => name), () => (
      `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}`
    ));
    const roads = entities.filter((entity) => entity.kind === "road");
    const prefabs = entities.filter((entity) => entity.kind === "prefab");
    expect(entities.filter((entity) => entity.kind === "place")).toHaveLength(0);
    expect(prefabs.length).toBe(result.output.prefabs.length);
    expect(prefabs.every(({ frontage_road_id }) => roads.some(({ id: roadId }) => roadId === frontage_road_id))).toBe(true);
  });

  it("keeps site, road, and building geometry deterministic for a named seed", () => {
    const input = countyInput();
    const first = buildCountyPlan({ operationId: 2, kind: "county_build", seed: input.seed, input }, flatTerrain());
    const second = buildCountyPlan({ operationId: 3, kind: "county_build", seed: input.seed, input }, flatTerrain());
    expect(first.status).toBe("success");
    expect(second.status).toBe("success");
    if (first.status !== "success" || second.status !== "success") return;
    expect(second.output.places).toEqual(first.output.places);
    expect(second.output.roads).toEqual(first.output.roads);
    expect(second.output.prefabs).toEqual(first.output.prefabs);
    expect(second.output.diagnostics).toEqual(first.output.diagnostics);
    expect(countyNamedSeed(17, "roads")).toBe(countyNamedSeed(17, "roads"));
    expect(countyNamedSeed(17, "roads")).not.toBe(countyNamedSeed(17, "buildings"));
  });

  it("supports an explicit main place, style policy, and roads-only specialist bake", () => {
    const base = countyInput();
    const input: CountyBuildInput = {
      ...base,
      outputMode: "network_only",
      mainPlaceIdOverride: base.selectedExistingPlaceIds[1] ?? null,
      styleByProfile: { ...base.styleByProfile, village: "organic" },
      assetProgram: { house: [], shop: [], civic: [], farmhouse: [], barn: [], shed: [], warehouse: [] },
    };
    const result = buildCountyPlan({ operationId: 8, kind: "county_build", seed: input.seed, input }, flatTerrain());
    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.output.complete).toBe(true);
    expect(result.output.outputMode).toBe("network_only");
    expect(result.output.mainPlacePlanId).toBe("county-place-existing-2");
    expect(result.output.places[1]?.style).toBe("organic");
    expect(result.output.roads.find(({ role }) => role === "backbone")?.ownerPlacePlanId).toBe("county-place-existing-2");
    expect(result.output.prefabs).toHaveLength(0);
    let id = 100;
    const entities = materializeCountyPlan(result.output, input.existingPlaces.map(({ name }) => name), () => (
      `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}`
    ));
    expect(entities.length).toBeGreaterThan(0);
    expect(entities.every(({ kind }) => kind === "road")).toBe(true);
  });

  it("runs the survey-to-network-to-frontage chain without mutating source entities", () => {
    const base = countyInput();
    const input: CountyBuildInput = {
      ...base,
      sourceMode: "survey",
      selectedExistingPlaceIds: [],
      existingPlaces: [],
      survey: { ...base.survey, radiusScale: 0.35, minimumSeparationM: 20, edgeClearanceM: 10, attemptBudgetPerSite: 600 },
    };
    const before = JSON.stringify(input.existingPlaces);
    const result = buildCountyPlan({ operationId: 9, kind: "county_build", seed: input.seed, input }, flatTerrain());
    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.output.complete).toBe(true);
    expect(result.output.places).toHaveLength(2);
    expect(result.output.places.every(({ existingEntityId }) => existingEntityId === null)).toBe(true);
    expect(result.output.roads.some(({ role }) => role === "backbone")).toBe(true);
    expect(result.output.prefabs.length).toBeGreaterThan(0);
    expect(JSON.stringify(input.existingPlaces)).toBe(before);
  });

  it("makes whole-build route budget exhaustion explicit and non-bakeable", () => {
    const base = countyInput();
    const input: CountyBuildInput = { ...base, budgets: { ...base.budgets, maximumRoutes: 1 } };
    const result = buildCountyPlan({ operationId: 10, kind: "county_build", seed: input.seed, input }, flatTerrain());
    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.output.complete).toBe(false);
    expect(result.output.diagnostics).toContainEqual(expect.objectContaining({ severity: "error", code: "county_route_budget" }));
    expect(() => materializeCountyPlan(result.output, [], () => crypto.randomUUID())).toThrow(/incomplete/);
  });
});

function countyInput(): CountyBuildInput {
  const places = [
    place("00000000-0000-4000-8000-000000000001", "Town", "town", 180, 180, 420, 420),
    place("00000000-0000-4000-8000-000000000002", "Village", "village", 650, 620, 850, 820),
  ];
  return {
    outputMode: "full",
    sourceMode: "existing_places",
    desiredSettlementCount: 2,
    selectedExistingPlaceIds: places.map(({ id }) => id),
    mainPlaceIdOverride: null,
    existingPlaces: places,
    existingRoads: [],
    existingPrefabFootprints: [],
    createBackbone: true,
    backboneOrientation: "west_east",
    routing: { gridStepM: 40, slopeWeight: 42, maximumGrade: 0.3, turnPenaltyM: 4, edgeClearanceM: 10 },
    roadStyles: DEFAULT_COUNTY_ROAD_STYLES,
    survey: { minimumSeparationM: 100, edgeClearanceM: 20, preferredElevationM: 0, attemptBudgetPerSite: 100, radiusScale: 1, siteMix: "balanced" },
    localStreets: { edgeClearanceM: 2, minimumRoadLengthM: 8, sampleStepM: 5, maximumGrade: 0.3 },
    styleByProfile: { town: "planned", village: "roadside", hamlet: "roadside", farm: "agricultural" },
    budgets: { maximumRoutes: 64, maximumVisitedNodes: 5_000_000, maximumPrefabs: 5_000, maximumDriveways: 5_000 },
    frontage: {
      side: "both",
      setbackM: 6,
      gapM: 4,
      endClearanceM: 5,
      maximumPlotSlopeDeg: 20,
      junctionClearanceM: 8,
      spacingJitterM: 0,
      yawJitterDeg: 0,
      seed: 17,
      drivewaysEnabled: true,
    },
    assetProgram: assets(),
    seed: 17,
    sourceRevision: 4,
  };
}

function assets(): CountyAssetProgram {
  const empty = [] as const;
  return {
    house: [{ assetId: "house", category: "house", displayName: "House", widthM: 10, depthM: 12 }],
    shop: empty,
    civic: empty,
    farmhouse: empty,
    barn: empty,
    shed: empty,
    warehouse: empty,
  };
}

function place(id: string, name: string, type: "town" | "village", x0: number, z0: number, x1: number, z1: number): PlaceRegion {
  return {
    kind: "place",
    id,
    name,
    visible: true,
    locked: false,
    place_type: type,
    points: [[x0, z0], [x1, z0], [x1, z1], [x0, z1]],
  };
}

function flatTerrain(): CountyBuildTerrainSnapshot {
  const pointCountX = 51;
  const pointCountZ = 51;
  return {
    worldWidthM: 1000,
    worldDepthM: 1000,
    spacingM: 20,
    pointCountX,
    pointCountZ,
    heights: new Float32Array(pointCountX * pointCountZ),
    minimumElevationM: -100,
    seaLevelM: 0,
    lowlandReferenceElevationM: 0,
    maximumElevationM: 100,
  };
}
