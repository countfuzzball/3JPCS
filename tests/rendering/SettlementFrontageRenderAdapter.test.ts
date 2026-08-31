import { describe, expect, it } from "vitest";
import type { SettlementFrontagePlan } from "../../src/generation/settlementFrontage";
import { SettlementFrontageRenderAdapter } from "../../src/rendering/SettlementFrontageRenderAdapter";

describe("settlement frontage preview rendering", () => {
  it("uses batched objects for accepted/skipped footprints, ranges, and junctions", () => {
    const adapter = new SettlementFrontageRenderAdapter();
    const candidate = {
      roadId: "00000000-0000-4000-8000-000000000011",
      rangeIndex: 0,
      side: "left" as const,
      distanceM: 20,
      baseDistanceM: 20,
      spacingJitterM: 0,
      yawJitterDeg: 0,
      xM: 20,
      zM: 30,
      rotationDeg: 180,
      footprint: [[15, 26], [25, 26], [25, 34], [15, 34]] as const,
      maximumPlotSlopeDeg: 2,
      skipReason: null,
    };
    const plan: SettlementFrontagePlan = {
      settlementId: "00000000-0000-4000-8000-000000000001",
      eligibleRoadIds: [candidate.roadId],
      ranges: [{
        roadId: candidate.roadId,
        startDistanceM: 0,
        endDistanceM: 100,
        lengthM: 100,
        points: [[0, 40], [100, 40]],
      }],
      junctions: [{ point: [50, 40], roadIds: [candidate.roadId, "00000000-0000-4000-8000-000000000012"] }],
      candidates: [candidate, { ...candidate, xM: 40, skipReason: "junction_clearance" }],
      acceptedCount: 1,
      skipped: {
        outside_settlement: 0,
        outside_world: 0,
        prefab_overlap: 0,
        road_clash: 0,
        junction_clearance: 1,
        excessive_plot_slope: 0,
      },
    };
    adapter.sync(plan, 100);
    expect(adapter.group.getObjectByName("settlement-frontage-accepted")).toBeDefined();
    expect(adapter.group.getObjectByName("settlement-frontage-skipped")).toBeDefined();
    expect(adapter.group.getObjectByName("settlement-frontage-road-ranges")).toBeDefined();
    expect(adapter.group.getObjectByName("settlement-frontage-junctions")).toBeDefined();
    expect(adapter.group.children).toHaveLength(4);
    adapter.dispose();
    expect(adapter.group.children).toHaveLength(0);
  });
});
