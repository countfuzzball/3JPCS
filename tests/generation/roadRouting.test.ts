import { describe, expect, it } from "vitest";
import {
  MAX_ROUTE_GRID_NODES,
  routeRoad,
  type RoadRouteInput,
  type RoadRouteRequest,
  type RoadRouteTerrainSnapshot,
} from "../../src/generation/roadRouting";

const BASE_INPUT: RoadRouteInput = {
  start: [10, 50],
  end: [90, 50],
  gridStepM: 10,
  slopeWeight: 42,
  maximumGrade: 0.2,
  turnPenaltyM: 4,
  edgeClearanceM: 0,
};

describe("terrain-aware road routing", () => {
  it("finds a deterministic near-direct flat route with exact endpoints", () => {
    const terrain = terrainSnapshot(10, 10, () => 0);
    const first = routeRoad(request(BASE_INPUT, 73), terrain);
    const second = routeRoad(request(BASE_INPUT, 73), terrain);
    expect(first.status).toBe("success");
    expect(second.status).toBe("success");
    if (first.status !== "success" || second.status !== "success") return;
    expect(second.output.points).toEqual(first.output.points);
    expect(first.output.points[0]).toEqual(BASE_INPUT.start);
    expect(first.output.points.at(-1)).toEqual(BASE_INPUT.end);
    expect(first.output.pathLengthM).toBeCloseTo(80, 6);
    expect(first.output.maximumGrade).toBe(0);
    expect(first.output.points.every(([, z]) => z === 50)).toBe(true);
  });

  it("detours around a locally impassable terrain barrier", () => {
    const terrain = terrainSnapshot(10, 10, (x, z) => x === 5 && z === 5 ? 30 : 0);
    const result = routeRoad(request(BASE_INPUT, 91), terrain);
    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.output.rawPoints.some(([x, z]) => x === 50 && z === 50)).toBe(false);
    expect(result.output.points.some(([, z]) => Math.abs(z - 50) > 1)).toBe(true);
    expect(result.output.maximumGrade).toBeLessThanOrEqual(BASE_INPUT.maximumGrade + 1e-8);
    expect(result.rejections.find(({ reason }) => reason === "maximum_grade")?.count).toBeGreaterThan(0);
  });

  it("reports an explicit failure instead of falling back to a straight line", () => {
    const terrain = terrainSnapshot(10, 10, (x) => x === 5 ? 30 : 0);
    const result = routeRoad(request(BASE_INPUT, 91), terrain);
    expect(result.status).toBe("failure");
    if (result.status !== "failure") return;
    expect(result.reason).toBe("no_valid_result");
    expect(result.diagnostics[0]?.message).toContain("No traversable route");
  });

  it("enforces endpoint clearance and the routing-grid node budget", () => {
    const terrain = terrainSnapshot(10, 10, () => 0);
    const outside = routeRoad(request({ ...BASE_INPUT, start: [0, 50], edgeClearanceM: 5 }), terrain);
    expect(outside.status).toBe("failure");
    if (outside.status === "failure") expect(outside.reason).toBe("invalid_request");

    const largeTerrain = terrainSnapshot(100, 100, () => 0);
    const overBudget = routeRoad(request({
      ...BASE_INPUT,
      start: [0, 500],
      end: [1_000, 500],
      gridStepM: 1,
    }), largeTerrain);
    expect(overBudget.status).toBe("failure");
    if (overBudget.status !== "failure") return;
    expect(overBudget.reason).toBe("budget_exhausted");
    expect(overBudget.diagnostics[0]?.message).toContain(MAX_ROUTE_GRID_NODES.toLocaleString());
  });

  it("preserves exact endpoints after route smoothing and validates the final grade", () => {
    const terrain = terrainSnapshot(10, 10, (x, z) => x + z < 95 ? 0 : 1);
    const input: RoadRouteInput = {
      ...BASE_INPUT,
      start: [10.25, 15.75],
      end: [88.5, 86.25],
      maximumGrade: 0.3,
    };
    const result = routeRoad(request(input, 5), terrain);
    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.output.points[0]).toEqual(input.start);
    expect(result.output.points.at(-1)).toEqual(input.end);
    expect(result.output.maximumGrade).toBeLessThanOrEqual(input.maximumGrade + 1e-8);
    expect(result.metrics.map(({ name }) => name)).toEqual([
      "visited_nodes", "path_length", "maximum_grade", "mean_grade", "route_cost", "elapsed",
    ]);
  });
});

function request(input: RoadRouteInput, seed = 1): RoadRouteRequest {
  return { operationId: 1, kind: "road_route", seed, input };
}

function terrainSnapshot(
  cellsX: number,
  cellsZ: number,
  elevation: (xIndex: number, zIndex: number) => number,
): RoadRouteTerrainSnapshot {
  const spacingM = 10;
  const pointCountX = cellsX + 1;
  const pointCountZ = cellsZ + 1;
  const heights = new Float32Array(pointCountX * pointCountZ);
  for (let z = 0; z < pointCountZ; z += 1) {
    for (let x = 0; x < pointCountX; x += 1) heights[z * pointCountX + x] = elevation(x, z);
  }
  return {
    worldWidthM: cellsX * spacingM,
    worldDepthM: cellsZ * spacingM,
    spacingM,
    pointCountX,
    pointCountZ,
    heights,
  };
}
