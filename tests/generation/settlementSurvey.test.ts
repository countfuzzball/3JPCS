import { describe, expect, it } from "vitest";
import {
  SETTLEMENT_SURVEY_PROFILES,
  degreesToGrade,
  evaluateSettlementSite,
  gradeToDegrees,
  runSettlementSurvey,
  settlementBoundary,
  type SettlementSurveySettings,
} from "../../src/generation/settlementSurvey";
import type { PlaceRegion, PointTuple } from "../../src/model/entities";
import type { TerrainSurface } from "../../src/terrain/TerrainSurface";
import { EditorStore } from "../../src/app/EditorStore";
import { ProjectModel } from "../../src/model/ProjectModel";
import { fixtureTerrain } from "../helpers/fixtures";

const BASE_SETTINGS: SettlementSurveySettings = {
  profile: "village",
  desiredCount: 4,
  radiusM: 100,
  maximumSlopeDeg: 12,
  minimumSeparationM: 50,
  edgeClearanceM: 25,
  preferredElevationM: 50,
  seed: 2748,
  attemptBudget: 300,
};

describe("settlement survey profiles", () => {
  it("retains legacy profile grades while exposing editor slope degrees and current place types", () => {
    expect(gradeToDegrees(0.11)).toBeCloseTo(6.2773, 4);
    expect(gradeToDegrees(0.14)).toBeCloseTo(7.9696, 4);
    expect(gradeToDegrees(0.18)).toBeCloseTo(10.204, 3);
    expect(gradeToDegrees(0.22)).toBeCloseTo(12.407, 3);
    expect(degreesToGrade(gradeToDegrees(0.22))).toBeCloseTo(0.22, 12);
    expect(SETTLEMENT_SURVEY_PROFILES.hamlet.placeType).toBe("village");
    expect(SETTLEMENT_SURVEY_PROFILES.farm.radiusM).toBe(125);
  });
});

describe("settlement candidate evaluation", () => {
  it("creates a useful 32-point editable boundary and rejects insufficient world-edge clearance", () => {
    const terrain = analyticTerrain();
    const boundary = settlementBoundary([500, 600], 100);
    expect(boundary).toHaveLength(32);
    expect(boundary[0]).toEqual([500, 500]);
    expect(evaluateSettlementSite(terrain, [100, 500], 100, 10, 1, 0, [])).toEqual({
      status: "rejected",
      reason: "edge_clearance",
    });
    expect(evaluateSettlementSite(terrain, [101, 500], 100, 10, 1, 0, []).status).toBe("accepted");
  });

  it("samples across the proposed site rather than trusting a flat centre", () => {
    const terrain = analyticTerrain({
      slopeAt: (x) => x > 1_100 ? 25 : 0,
    });
    expect(terrain.slopeAt(1_000, 1_000)).toBe(0);
    expect(evaluateSettlementSite(terrain, [1_000, 1_000], 200, 10, 0, 0, [])).toEqual({
      status: "rejected",
      reason: "slope",
    });
  });

  it("enforces edge-to-polygon separation from existing places", () => {
    const terrain = analyticTerrain();
    const existing = place([
      [500, 500], [650, 500], [650, 650], [500, 650],
    ]);
    expect(evaluateSettlementSite(terrain, [800, 575], 100, 10, 0, 75, [existing])).toEqual({
      status: "rejected",
      reason: "existing_place_separation",
    });
    expect(evaluateSettlementSite(terrain, [826, 575], 100, 10, 0, 75, [existing]).status).toBe("accepted");
  });
});

describe("settlement survey", () => {
  it("is deterministic, ranked, inside the world, and mutually separated", () => {
    const terrain = analyticTerrain({
      heightAt: (x, z) => 30 + x * 0.012 + z * 0.004,
      slopeAt: () => 0.75,
    });
    const first = runSettlementSurvey(terrain, [], BASE_SETTINGS);
    const second = runSettlementSurvey(terrain, [], BASE_SETTINGS);
    expect(second).toEqual(first);
    expect(first.status).toBe("success");
    if (first.status !== "success") return;
    expect(first.output.candidates).toHaveLength(4);
    expect(first.output.candidates.map(({ rank }) => rank)).toEqual([1, 2, 3, 4]);
    expect(first.output.candidates.map(({ score }) => score)).toEqual(
      [...first.output.candidates.map(({ score }) => score)].sort((left, right) => left - right),
    );
    for (const candidate of first.output.candidates) {
      expect(candidate.boundary).toHaveLength(32);
      expect(candidate.boundary.every(([x, z]) => x >= 0 && x <= 2_000 && z >= 0 && z <= 2_000)).toBe(true);
    }
    for (let left = 0; left < first.output.candidates.length; left += 1) {
      for (let right = left + 1; right < first.output.candidates.length; right += 1) {
        const a = first.output.candidates[left];
        const b = first.output.candidates[right];
        expect(a && b ? Math.hypot(b.center[0] - a.center[0], b.center[1] - a.center[1]) : 0)
          .toBeGreaterThanOrEqual(250 - 1e-7);
      }
    }
  });

  it("reports a partial result when the attempt budget cannot satisfy the desired count", () => {
    const result = runSettlementSurvey(analyticTerrain(), [], {
      ...BASE_SETTINGS,
      desiredCount: 3,
      radiusM: 400,
      minimumSeparationM: 1_000,
      attemptBudget: 20,
    });
    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.output.candidates).toHaveLength(1);
    expect(result.output.attemptBudgetExhausted).toBe(true);
    expect(result.diagnostics.some(({ code }) => code === "attempt_budget_exhausted")).toBe(true);
    expect(result.rejections.find(({ reason }) => reason === "candidate_separation")?.count).toBeGreaterThan(0);
  });

  it("returns an explicit non-destructive failure when every sampled site is too steep", () => {
    const result = runSettlementSurvey(analyticTerrain({ slopeAt: () => 30 }), [], {
      ...BASE_SETTINGS,
      maximumSlopeDeg: 5,
      attemptBudget: 17,
    });
    expect(result.status).toBe("failure");
    if (result.status !== "failure") return;
    expect(result.reason).toBe("no_valid_result");
    expect(result.rejections.find(({ reason }) => reason === "slope")?.count).toBe(17);
    expect(result.diagnostics[0]?.code).toBe("no_valid_site");
  });

  it("rejects settings whose radius-aware sampling domain cannot fit the world", () => {
    expect(() => runSettlementSurvey(analyticTerrain(), [], {
      ...BASE_SETTINGS,
      radiusM: 1_000,
      edgeClearanceM: 1,
    })).toThrow("settlement radius and edge clearance do not fit inside the terrain world");
  });

  it("keeps preview generation outside project state and round-trips an accepted site through history and persistence", async () => {
    const terrain = await fixtureTerrain();
    const store = new EditorStore();
    store.createProject("Survey persistence", terrain, { npy: "terrain.npy", descriptor: "terrain.json" });
    store.markSaved();
    const before = store.toDocument();
    const result = runSettlementSurvey(store.state.workingTerrain!, [], {
      profile: "town",
      desiredCount: 1,
      radiusM: 2,
      maximumSlopeDeg: 89,
      minimumSeparationM: 0,
      edgeClearanceM: 0,
      preferredElevationM: terrain.lowlandReferenceElevationM,
      seed: 9,
      attemptBudget: 20,
    });
    expect(store.state.dirty).toBe(false);
    expect(store.toDocument()).toEqual(before);
    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    const candidate = result.output.candidates[0];
    expect(candidate).toBeDefined();
    const accepted: PlaceRegion = {
      kind: "place",
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      name: "Town",
      visible: true,
      locked: false,
      place_type: candidate!.placeType,
      points: candidate!.boundary,
    };
    expect(store.addEntities([accepted], "Accept 1 surveyed settlement")).toBe(true);
    expect(store.state.dirty).toBe(true);
    expect(ProjectModel.fromDocument(store.toDocument()).get(accepted.id)).toEqual(accepted);
    expect(store.undo()).toBe("Accept 1 surveyed settlement");
    expect(store.state.model?.get(accepted.id)).toBeUndefined();
    expect(store.redo()).toBe("Accept 1 surveyed settlement");
    expect(store.state.model?.get(accepted.id)).toEqual(accepted);
  });
});

function analyticTerrain(overrides: {
  readonly heightAt?: (x: number, z: number) => number;
  readonly slopeAt?: (x: number, z: number) => number;
} = {}): TerrainSurface {
  const heightAt = overrides.heightAt ?? (() => 50);
  const slopeAt = overrides.slopeAt ?? (() => 0);
  return {
    worldWidthM: 2_000,
    worldDepthM: 2_000,
    spacingM: 100,
    cellCountX: 20,
    cellCountZ: 20,
    pointCountX: 21,
    pointCountZ: 21,
    minimumElevationM: 0,
    seaLevelM: 0,
    lowlandReferenceElevationM: 50,
    maximumElevationM: 200,
    heightAtGrid: (x, z) => heightAt(x * 100, z * 100),
    heightAt,
    slopeAt,
    copyHeights: () => new Float32Array(21 * 21),
  };
}

function place(points: readonly PointTuple[]): PlaceRegion {
  return {
    kind: "place",
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    name: "Existing place",
    visible: true,
    locked: false,
    place_type: "village",
    points,
  };
}
