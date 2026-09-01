import { describe, expect, it } from "vitest";
import {
  clipCountyStreetToUsablePolygon,
  countyRoadCorridorsOverlap,
  deriveCountySettlementFrame,
  settlementInteriorAnchor,
} from "../../src/generation/countyBuild";
import { pointInPolygon, pointSegmentDistance } from "../../src/generation/geometry";
import type { PointTuple } from "../../src/model/entities";

describe("SN-1 county-local polygon geometry", () => {
  it("derives deterministic rotated axes and positive extents", () => {
    const polygon: readonly PointTuple[] = [[50, 20], [80, 50], [50, 80], [20, 50]];
    const frame = deriveCountySettlementFrame(polygon, [50, 50], [1, 1]);
    expect(frame.along[0]).toBeCloseTo(Math.SQRT1_2);
    expect(frame.along[1]).toBeCloseTo(Math.SQRT1_2);
    expect(frame.normal[0]).toBeCloseTo(-Math.SQRT1_2);
    expect(frame.negativeU).toBeGreaterThan(0);
    expect(frame.positiveU).toBeGreaterThan(0);
    expect(frame.negativeV).toBeGreaterThan(0);
    expect(frame.positiveV).toBeGreaterThan(0);
  });

  it("keeps only the connected inset fragment through a narrow-neck polygon", () => {
    const polygon: readonly PointTuple[] = [
      [0, 0], [12, 0], [12, 8], [20, 8], [20, 0], [32, 0],
      [32, 20], [20, 20], [20, 12], [12, 12], [12, 20], [0, 20],
    ];
    const raw: readonly PointTuple[] = [[2, 10], [30, 10]];
    const clipped = clipCountyStreetToUsablePolygon(raw, polygon, 3, 0.5, [6, 10]);
    expect(clipped.length).toBeGreaterThan(2);
    expect(clipped.every(([x, z]) => pointInPolygon({ x, z }, polygon))).toBe(true);
    expect(clipped.every((point) => boundaryDistance(point, polygon) >= 3 - 1e-7)).toBe(true);
    expect(Math.max(...clipped.map(([x]) => x))).toBeLessThan(12);
  });

  it("degrades small corridors to no road and rejects a degenerate access tangent", () => {
    const tiny: readonly PointTuple[] = [[0, 0], [3, 0], [3, 3], [0, 3]];
    expect(clipCountyStreetToUsablePolygon([[0, 1.5], [3, 1.5]], tiny, 2, 0.25, [1.5, 1.5])).toEqual([]);
    expect(() => deriveCountySettlementFrame(tiny, [1.5, 1.5], [0, 0])).toThrow(/degenerate/);
  });

  it("finds a true interior anchor and detects road-corridor crossings", () => {
    const concave: readonly PointTuple[] = [[0, 0], [12, 0], [12, 3], [4, 3], [4, 12], [0, 12]];
    const anchor = settlementInteriorAnchor(concave);
    expect(pointInPolygon({ x: anchor[0], z: anchor[1] }, concave)).toBe(true);
    expect(boundaryDistance(anchor, concave)).toBeGreaterThan(0);
    expect(countyRoadCorridorsOverlap(
      { points: [[0, 5], [10, 5]], widthM: 2 },
      { points: [[5, 0], [5, 10]], widthM: 2 },
    )).toBe(true);
    expect(countyRoadCorridorsOverlap(
      { points: [[0, 0], [10, 0]], widthM: 1 },
      { points: [[0, 4], [10, 4]], widthM: 1 },
    )).toBe(false);
  });
});

function boundaryDistance(point: PointTuple, polygon: readonly PointTuple[]): number {
  let distance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index];
    const end = polygon[(index + 1) % polygon.length];
    if (start && end) distance = Math.min(distance, pointSegmentDistance(point, start, end));
  }
  return distance;
}
