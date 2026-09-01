import { describe, expect, it } from "vitest";
import type { CountyBuildPlan } from "../../src/generation/countyBuild";
import { CountyBuildRenderAdapter } from "../../src/rendering/CountyBuildRenderAdapter";

describe("complete county preview rendering", () => {
  it("batches places, each road role, prefabs, and junctions into bounded objects", () => {
    const plan: CountyBuildPlan = {
      policyVersion: 1,
      sourceRevision: 1,
      seed: 1,
      outputMode: "full",
      mainPlacePlanId: "place-1",
      places: [{
        planId: "place-1",
        existingEntityId: null,
        name: "Town",
        placeType: "town",
        surveyProfile: "town",
        style: "planned",
        rank: 1,
        center: [50, 50],
        anchor: [50, 50],
        radiusM: 40,
        points: [[10, 10], [90, 10], [90, 90], [10, 90]],
        score: 0.1,
      }],
      roads: [
        road("backbone", "road-1", [[0, 50], [100, 50]]),
        road("plot", "road-2", [[50, 10], [50, 90]]),
        road("property_access", "road-3", [[40, 50], [40, 60]]),
      ],
      junctions: [{ point: [50, 50], roadIds: ["road-1", "road-2"], ownerPlacePlanId: "place-1", clearanceRadiusM: 8 }],
      prefabs: [{
        planId: "prefab-1",
        ownerPlacePlanId: "place-1",
        role: "house",
        assetId: "house",
        category: "house",
        displayName: "House",
        xM: 40,
        zM: 60,
        rotationDeg: 0,
        frontageRoadId: "road-1",
        footprint: [[35, 55], [45, 55], [45, 65], [35, 65]],
        drivewayRoadPlanId: "road-3",
      }],
      skippedCandidates: [{ ownerPlacePlanId: "place-1", point: [45, 45], reason: "road_clash" }],
      placeResults: [{ placePlanId: "place-1", connected: true, accessRoadId: "road-1", localRoadCount: 1, buildingCount: 1, skippedBuildingCount: 0 }],
      diagnostics: [],
      metrics: [],
      complete: true,
    };
    const adapter = new CountyBuildRenderAdapter();
    adapter.sync(plan, 100);
    expect(adapter.group.getObjectByName("county-build-place-fills")).toBeDefined();
    expect(adapter.group.getObjectByName("county-build-place-outlines")).toBeDefined();
    expect(adapter.group.getObjectByName("county-build-roads-backbone")).toBeDefined();
    expect(adapter.group.getObjectByName("county-build-roads-plot")).toBeDefined();
    expect(adapter.group.getObjectByName("county-build-roads-property_access")).toBeDefined();
    expect(adapter.group.getObjectByName("county-build-prefabs")).toBeDefined();
    expect(adapter.group.getObjectByName("county-build-junctions")).toBeDefined();
    expect(adapter.group.getObjectByName("county-build-skipped-candidates")).toBeDefined();
    expect(adapter.group.children.length).toBeLessThanOrEqual(11);
    adapter.sync(plan, 100, { placePlanId: "place-1", places: false, roads: true, prefabs: false, junctions: false, skipped: false });
    expect(adapter.group.getObjectByName("county-build-place-fills")).toBeUndefined();
    expect(adapter.group.getObjectByName("county-build-prefabs")).toBeUndefined();
    expect(adapter.group.getObjectByName("county-build-roads-backbone")).toBeDefined();
    adapter.dispose();
    expect(adapter.group.children).toHaveLength(0);
  });
});

function road(role: "backbone" | "plot" | "property_access", planId: string, points: readonly (readonly [number, number])[]) {
  return {
    planId,
    name: planId,
    role,
    ownerPlacePlanId: "place-1",
    points,
    widthM: 4,
    roadClass: "local_road" as const,
    surface: "gravel" as const,
    plotEligible: role !== "property_access",
    lengthM: 100,
    maximumGrade: 0,
  };
}
