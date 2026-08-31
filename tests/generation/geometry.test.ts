import { describe, expect, it } from "vitest";
import type { PointTuple } from "../../src/model/entities";
import {
  buildPolylineMetrics,
  clipPolylineToPolygon,
  convexPolygonsOverlapStrict,
  pointInPolygon,
  pointSegmentDistance,
  projectPointToPolyline,
  projectPointToSegment,
  samplePolyline,
  segmentDistance,
  segmentPolygonDistance,
  segmentsIntersect,
  slicePolylineRange,
  smoothedPolylineTangent,
} from "../../src/generation/geometry";

const square: readonly PointTuple[] = [[4, 0], [16, 0], [16, 10], [4, 10]];

describe("settlement generation geometry", () => {
  it("builds cumulative metrics, samples arc length, projects points, and slices either direction", () => {
    const metrics = buildPolylineMetrics([[0, 0], [3, 4], [3, 4], [9, 4]]);
    expect(metrics.totalLengthM).toBe(11);
    expect(metrics.vertexDistancesM).toEqual([0, 5, 5, 11]);
    expect(metrics.segments.map(({ index, startDistanceM, lengthM }) => ({ index, startDistanceM, lengthM })))
      .toEqual([{ index: 0, startDistanceM: 0, lengthM: 5 }, { index: 2, startDistanceM: 5, lengthM: 6 }]);
    expect(samplePolyline(metrics, 7)).toMatchObject({ point: [5, 4], distanceM: 7, segmentIndex: 2 });
    expect(samplePolyline(metrics, -10).point).toEqual([0, 0]);
    expect(samplePolyline(metrics, 100).point).toEqual([9, 4]);

    const projection = projectPointToPolyline(metrics, { x: 4, z: 7 });
    expect(projection.point).toEqual([4, 4]);
    expect(projection.distanceM).toBe(6);
    expect(projection.distanceToPointM).toBe(3);
    expect(slicePolylineRange(metrics, 2, 8)).toEqual([[1.2, 1.6], [3, 4], [3, 4], [6, 4]]);
    expect(slicePolylineRange(metrics, 8, 2)).toEqual([[6, 4], [3, 4], [3, 4], [1.2, 1.6]]);
  });

  it("smooths bend tangents and exposes deterministic point/segment operations", () => {
    const metrics = buildPolylineMetrics([[0, 0], [5, 0], [5, 5]]);
    const forward = smoothedPolylineTangent(metrics, 5);
    const reverse = smoothedPolylineTangent(metrics, 5, -1);
    expect(forward.x).toBeCloseTo(Math.SQRT1_2, 15);
    expect(forward.z).toBeCloseTo(Math.SQRT1_2, 15);
    expect(reverse.x).toBeCloseTo(-Math.SQRT1_2, 15);
    expect(reverse.z).toBeCloseTo(-Math.SQRT1_2, 15);
    expect(projectPointToSegment({ x: 5, z: 4 }, [0, 0], [10, 0])).toEqual({
      point: [5, 0], distanceM: 4, fraction: 0.5,
    });
    expect(pointSegmentDistance([5, 4], [0, 0], [10, 0])).toBe(4);
    expect(segmentsIntersect([0, 0], [10, 10], [0, 10], [10, 0])).toBe(true);
    expect(segmentDistance([0, 0], [2, 0], [5, 4], [5, 7])).toBe(5);
    expect(segmentPolygonDistance([0, 12], [20, 12], square)).toBe(2);
  });

  it("uses boundary-inclusive containment and strict convex footprint overlap", () => {
    expect(pointInPolygon({ x: 10, z: 5 }, square)).toBe(true);
    expect(pointInPolygon({ x: 4, z: 5 }, square)).toBe(true);
    expect(pointInPolygon({ x: 2, z: 5 }, square)).toBe(false);
    expect(convexPolygonsOverlapStrict(square, [[10, 2], [20, 2], [20, 8], [10, 8]])).toBe(true);
    expect(convexPolygonsOverlapStrict(square, [[16, 2], [20, 2], [20, 8], [16, 8]])).toBe(false);
  });

  it("clips road arc-length ranges through convex and concave place polygons", () => {
    const road: readonly PointTuple[] = [[0, 5], [5, 5], [15, 5], [20, 5]];
    expect(clipPolylineToPolygon(road, square)).toEqual([{
      startDistanceM: 4,
      endDistanceM: 16,
      lengthM: 12,
      points: [[4, 5], [5, 5], [15, 5], [16, 5]],
    }]);

    const uShape: readonly PointTuple[] = [
      [0, 0], [10, 0], [10, 10], [7, 10], [7, 3], [3, 3], [3, 10], [0, 10],
    ];
    expect(clipPolylineToPolygon([[-1, 5], [11, 5]], uShape)).toEqual([
      { startDistanceM: 1, endDistanceM: 4, lengthM: 3, points: [[0, 5], [3, 5]] },
      { startDistanceM: 8, endDistanceM: 11, lengthM: 3, points: [[7, 5], [10, 5]] },
    ]);
  });

  it("rejects non-finite, collapsed, malformed, and out-of-world geometry clearly", () => {
    expect(() => buildPolylineMetrics([[0, 0]])).toThrow(/at least two/);
    expect(() => buildPolylineMetrics([[1, 1], [1, 1]])).toThrow(/non-degenerate/);
    expect(() => buildPolylineMetrics([[0, 0], [Number.NaN, 1]])).toThrow(/finite/);
    expect(() => buildPolylineMetrics([[0, 0], [11, 1]], { widthM: 10, depthM: 10 })).toThrow(/outside/);
    const metrics = buildPolylineMetrics([[0, 0], [1, 1]]);
    expect(() => samplePolyline(metrics, Number.NaN)).toThrow(/finite/);
    expect(() => smoothedPolylineTangent(metrics, 0, 0)).toThrow(/direction/);
    expect(() => pointSegmentDistance([0, 0], [1, 1], [1, 1])).toThrow(/non-degenerate/);
    expect(() => pointInPolygon({ x: 1, z: 1 }, [[0, 0], [1, 1], [2, 2]])).toThrow(/area/);
    expect(() => pointInPolygon({ x: 11, z: 1 }, square, { widthM: 20, depthM: 10 })).not.toThrow();
    expect(() => pointInPolygon({ x: 21, z: 1 }, square, { widthM: 20, depthM: 10 })).toThrow(/outside/);
  });
});
