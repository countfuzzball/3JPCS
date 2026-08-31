import type { PointXZ } from "../model/coordinates";
import type { PointTuple, WorldBounds } from "../model/entities";
import { ContractError } from "../model/errors";

export const GEOMETRY_EPSILON = 1e-7;

export interface PolylineSegment {
  readonly index: number;
  readonly start: PointTuple;
  readonly end: PointTuple;
  readonly startDistanceM: number;
  readonly lengthM: number;
  readonly tangent: PointXZ;
}

export interface PolylineMetrics {
  readonly segments: readonly PolylineSegment[];
  readonly totalLengthM: number;
  readonly vertexDistancesM: readonly number[];
}

export interface PolylineSample {
  readonly point: PointTuple;
  readonly tangent: PointXZ;
  readonly distanceM: number;
  readonly segmentIndex: number;
}

export interface PolylineProjection extends PolylineSample {
  readonly distanceToPointM: number;
  readonly segmentFraction: number;
}

export interface PointSegmentProjection {
  readonly point: PointTuple;
  readonly distanceM: number;
  readonly fraction: number;
}

export interface PolylineRange {
  readonly startDistanceM: number;
  readonly endDistanceM: number;
  readonly lengthM: number;
  readonly points: readonly PointTuple[];
}

export function buildPolylineMetrics(
  points: readonly PointTuple[],
  world?: WorldBounds,
): PolylineMetrics {
  if (points.length < 2) throw new ContractError("polyline must contain at least two points");
  if (world) assertWorld(world);
  points.forEach((point, index) => {
    assertFiniteTuple(point, `polyline point ${String(index)}`);
    if (world) assertTupleInsideWorld(point, world, `polyline point ${String(index)}`);
  });

  const segments: PolylineSegment[] = [];
  const vertexDistancesM: number[] = [0];
  let totalLengthM = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    if (!start || !end) throw new ContractError("polyline contains a missing point");
    const dx = end[0] - start[0];
    const dz = end[1] - start[1];
    const lengthM = Math.hypot(dx, dz);
    if (lengthM > GEOMETRY_EPSILON) {
      segments.push({
        index,
        start,
        end,
        startDistanceM: totalLengthM,
        lengthM,
        tangent: { x: dx / lengthM, z: dz / lengthM },
      });
      totalLengthM += lengthM;
    }
    vertexDistancesM.push(totalLengthM);
  }
  if (segments.length === 0) {
    throw new ContractError("polyline must contain at least one non-degenerate segment");
  }
  return Object.freeze({
    segments: Object.freeze(segments),
    totalLengthM,
    vertexDistancesM: Object.freeze(vertexDistancesM),
  });
}

export function samplePolyline(metrics: PolylineMetrics, requestedDistanceM: number): PolylineSample {
  assertFiniteNumber(requestedDistanceM, "polyline sample distance");
  const distanceM = clamp(requestedDistanceM, 0, metrics.totalLengthM);
  const fallback = metrics.segments.at(-1);
  if (!fallback) throw new ContractError("polyline metrics contain no segments");
  for (const segment of metrics.segments) {
    if (distanceM <= segment.startDistanceM + segment.lengthM + GEOMETRY_EPSILON) {
      const localDistanceM = clamp(distanceM - segment.startDistanceM, 0, segment.lengthM);
      return {
        point: [
          segment.start[0] + segment.tangent.x * localDistanceM,
          segment.start[1] + segment.tangent.z * localDistanceM,
        ],
        tangent: segment.tangent,
        distanceM,
        segmentIndex: segment.index,
      };
    }
  }
  return {
    point: fallback.end,
    tangent: fallback.tangent,
    distanceM,
    segmentIndex: fallback.index,
  };
}

export function smoothedPolylineTangent(
  metrics: PolylineMetrics,
  distanceM: number,
  direction = 1,
): PointXZ {
  if (direction !== -1 && direction !== 1) throw new ContractError("polyline direction must be -1 or 1");
  assertFiniteNumber(distanceM, "polyline tangent distance");
  const radiusM = Math.min(2, Math.max(0.25, metrics.totalLengthM * 0.01));
  const before = samplePolyline(metrics, distanceM - radiusM).point;
  const after = samplePolyline(metrics, distanceM + radiusM).point;
  const dx = (after[0] - before[0]) * direction;
  const dz = (after[1] - before[1]) * direction;
  const lengthM = Math.hypot(dx, dz);
  if (lengthM > GEOMETRY_EPSILON) return { x: dx / lengthM, z: dz / lengthM };
  const fallback = samplePolyline(metrics, distanceM).tangent;
  return { x: fallback.x * direction, z: fallback.z * direction };
}

export function projectPointToPolyline(metrics: PolylineMetrics, point: PointXZ): PolylineProjection {
  assertFinitePoint(point, "polyline projection point");
  let best: PolylineProjection | null = null;
  let bestDistanceSquared = Number.POSITIVE_INFINITY;
  for (const segment of metrics.segments) {
    const projection = projectPointToSegmentUnchecked(point, segment.start, segment.end);
    const distanceSquared = projection.distanceM ** 2;
    if (distanceSquared < bestDistanceSquared) {
      bestDistanceSquared = distanceSquared;
      best = {
        point: projection.point,
        tangent: segment.tangent,
        distanceM: segment.startDistanceM + projection.fraction * segment.lengthM,
        segmentIndex: segment.index,
        distanceToPointM: projection.distanceM,
        segmentFraction: projection.fraction,
      };
    }
  }
  if (!best) throw new ContractError("polyline projection requires a non-degenerate segment");
  return best;
}

export function slicePolylineRange(
  metrics: PolylineMetrics,
  startDistanceM: number,
  endDistanceM: number,
): readonly PointTuple[] {
  assertFiniteNumber(startDistanceM, "polyline range start");
  assertFiniteNumber(endDistanceM, "polyline range end");
  const lower = Math.min(startDistanceM, endDistanceM);
  const upper = Math.max(startDistanceM, endDistanceM);
  const points: PointTuple[] = [samplePolyline(metrics, lower).point];
  metrics.vertexDistancesM.forEach((distanceM) => {
    if (distanceM <= lower + GEOMETRY_EPSILON || distanceM >= upper - GEOMETRY_EPSILON) return;
    points.push(samplePolyline(metrics, distanceM).point);
  });
  points.push(samplePolyline(metrics, upper).point);
  return startDistanceM <= endDistanceM ? points : points.reverse();
}

export function projectPointToSegment(
  point: PointXZ,
  start: PointTuple,
  end: PointTuple,
): PointSegmentProjection {
  assertFinitePoint(point, "segment projection point");
  assertNonDegenerateSegment(start, end, "segment projection");
  return projectPointToSegmentUnchecked(point, start, end);
}

export function pointSegmentDistance(point: PointTuple, start: PointTuple, end: PointTuple): number {
  assertFiniteTuple(point, "segment distance point");
  assertNonDegenerateSegment(start, end, "segment distance");
  return pointSegmentDistanceUnchecked(point, start, end);
}

export function segmentsIntersect(a: PointTuple, b: PointTuple, c: PointTuple, d: PointTuple): boolean {
  assertNonDegenerateSegment(a, b, "first intersection segment");
  assertNonDegenerateSegment(c, d, "second intersection segment");
  return segmentsIntersectUnchecked(a, b, c, d);
}

export function segmentDistance(a: PointTuple, b: PointTuple, c: PointTuple, d: PointTuple): number {
  assertNonDegenerateSegment(a, b, "first distance segment");
  assertNonDegenerateSegment(c, d, "second distance segment");
  return segmentDistanceUnchecked(a, b, c, d);
}

export function pointInPolygon(
  point: PointXZ,
  polygon: readonly PointTuple[],
  world?: WorldBounds,
): boolean {
  assertFinitePoint(point, "polygon query point");
  validatePolygon(polygon, world);
  if (world) assertPointInsideWorld(point, world, "polygon query point");
  return pointInPolygonUnchecked([point.x, point.z], polygon);
}

export function convexPolygonsOverlapStrict(
  left: readonly PointTuple[],
  right: readonly PointTuple[],
): boolean {
  validatePolygon(left);
  validatePolygon(right);
  for (const polygon of [left, right]) {
    for (let index = 0; index < polygon.length; index += 1) {
      const start = polygon[index];
      const end = polygon[(index + 1) % polygon.length];
      if (!start || !end) throw new ContractError("convex polygon contains a missing point");
      const axisX = -(end[1] - start[1]);
      const axisZ = end[0] - start[0];
      const leftProjection = projectPolygon(left, axisX, axisZ);
      const rightProjection = projectPolygon(right, axisX, axisZ);
      if (leftProjection.maximum <= rightProjection.minimum + GEOMETRY_EPSILON
        || rightProjection.maximum <= leftProjection.minimum + GEOMETRY_EPSILON) return false;
    }
  }
  return true;
}

export function segmentPolygonDistance(
  start: PointTuple,
  end: PointTuple,
  polygon: readonly PointTuple[],
): number {
  assertFiniteTuple(start, "polygon distance segment start");
  assertFiniteTuple(end, "polygon distance segment end");
  validatePolygon(polygon);
  if (pointInPolygonUnchecked(start, polygon) || pointInPolygonUnchecked(end, polygon)) return 0;
  const collapsed = Math.hypot(end[0] - start[0], end[1] - start[1]) <= GEOMETRY_EPSILON;
  let minimum = Number.POSITIVE_INFINITY;
  for (let index = 0; index < polygon.length; index += 1) {
    const edgeStart = polygon[index];
    const edgeEnd = polygon[(index + 1) % polygon.length];
    if (!edgeStart || !edgeEnd) throw new ContractError("polygon contains a missing edge");
    minimum = Math.min(minimum, collapsed
      ? pointSegmentDistanceUnchecked(start, edgeStart, edgeEnd)
      : segmentDistanceUnchecked(start, end, edgeStart, edgeEnd));
  }
  return minimum;
}

export function pointsInsideWorld(points: readonly PointTuple[], world: WorldBounds): boolean {
  assertWorld(world);
  if (points.length === 0) throw new ContractError("world point collection must not be empty");
  return points.every((point, index) => {
    assertFiniteTuple(point, `world point ${String(index)}`);
    return point[0] >= -GEOMETRY_EPSILON
      && point[0] <= world.widthM + GEOMETRY_EPSILON
      && point[1] >= -GEOMETRY_EPSILON
      && point[1] <= world.depthM + GEOMETRY_EPSILON;
  });
}

export function clipPolylineToPolygon(
  points: readonly PointTuple[],
  polygon: readonly PointTuple[],
  world?: WorldBounds,
): readonly PolylineRange[] {
  const metrics = buildPolylineMetrics(points, world);
  validatePolygon(polygon, world);
  const rawRanges: { startDistanceM: number; endDistanceM: number }[] = [];

  for (const segment of metrics.segments) {
    const parameters = [0, 1];
    for (let edgeIndex = 0; edgeIndex < polygon.length; edgeIndex += 1) {
      const edgeStart = polygon[edgeIndex];
      const edgeEnd = polygon[(edgeIndex + 1) % polygon.length];
      if (!edgeStart || !edgeEnd) throw new ContractError("polygon contains a missing edge");
      parameters.push(...segmentBoundaryParameters(segment.start, segment.end, edgeStart, edgeEnd));
    }
    const unique = uniqueSorted(parameters.map((value) => clamp(value, 0, 1)));
    for (let index = 0; index < unique.length - 1; index += 1) {
      const startFraction = unique[index];
      const endFraction = unique[index + 1];
      if (startFraction === undefined || endFraction === undefined
        || endFraction - startFraction <= GEOMETRY_EPSILON) continue;
      const middle = (startFraction + endFraction) / 2;
      const midpoint: PointTuple = [
        segment.start[0] + (segment.end[0] - segment.start[0]) * middle,
        segment.start[1] + (segment.end[1] - segment.start[1]) * middle,
      ];
      if (!pointInPolygonUnchecked(midpoint, polygon)) continue;
      const startDistanceM = segment.startDistanceM + startFraction * segment.lengthM;
      const endDistanceM = segment.startDistanceM + endFraction * segment.lengthM;
      const previous = rawRanges.at(-1);
      if (previous && startDistanceM <= previous.endDistanceM + GEOMETRY_EPSILON) {
        previous.endDistanceM = Math.max(previous.endDistanceM, endDistanceM);
      } else {
        rawRanges.push({ startDistanceM, endDistanceM });
      }
    }
  }

  return rawRanges.map(({ startDistanceM, endDistanceM }) => Object.freeze({
    startDistanceM,
    endDistanceM,
    lengthM: endDistanceM - startDistanceM,
    points: Object.freeze(slicePolylineRange(metrics, startDistanceM, endDistanceM)),
  }));
}

function validatePolygon(polygon: readonly PointTuple[], world?: WorldBounds): void {
  if (polygon.length < 3) throw new ContractError("polygon must contain at least three points");
  if (world) assertWorld(world);
  let twiceArea = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const point = polygon[index];
    const next = polygon[(index + 1) % polygon.length];
    if (!point || !next) throw new ContractError("polygon contains a missing point");
    assertFiniteTuple(point, `polygon point ${String(index)}`);
    if (world) assertTupleInsideWorld(point, world, `polygon point ${String(index)}`);
    if (Math.hypot(next[0] - point[0], next[1] - point[1]) <= GEOMETRY_EPSILON) {
      throw new ContractError("polygon contains a degenerate edge");
    }
    twiceArea += point[0] * next[1] - next[0] * point[1];
  }
  if (Math.abs(twiceArea) <= GEOMETRY_EPSILON) throw new ContractError("polygon area must be non-zero");
}

function projectPointToSegmentUnchecked(
  point: PointXZ,
  start: PointTuple,
  end: PointTuple,
): PointSegmentProjection {
  const dx = end[0] - start[0];
  const dz = end[1] - start[1];
  const lengthSquared = dx * dx + dz * dz;
  const fraction = clamp(((point.x - start[0]) * dx + (point.z - start[1]) * dz) / lengthSquared, 0, 1);
  const nearest: PointTuple = [start[0] + fraction * dx, start[1] + fraction * dz];
  return {
    point: nearest,
    distanceM: Math.hypot(point.x - nearest[0], point.z - nearest[1]),
    fraction,
  };
}

function pointSegmentDistanceUnchecked(point: PointTuple, start: PointTuple, end: PointTuple): number {
  return projectPointToSegmentUnchecked({ x: point[0], z: point[1] }, start, end).distanceM;
}

function segmentDistanceUnchecked(a: PointTuple, b: PointTuple, c: PointTuple, d: PointTuple): number {
  if (segmentsIntersectUnchecked(a, b, c, d)) return 0;
  return Math.min(
    pointSegmentDistanceUnchecked(a, c, d),
    pointSegmentDistanceUnchecked(b, c, d),
    pointSegmentDistanceUnchecked(c, a, b),
    pointSegmentDistanceUnchecked(d, a, b),
  );
}

function segmentsIntersectUnchecked(a: PointTuple, b: PointTuple, c: PointTuple, d: PointTuple): boolean {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  if (((abC > GEOMETRY_EPSILON && abD < -GEOMETRY_EPSILON)
    || (abC < -GEOMETRY_EPSILON && abD > GEOMETRY_EPSILON))
    && ((cdA > GEOMETRY_EPSILON && cdB < -GEOMETRY_EPSILON)
      || (cdA < -GEOMETRY_EPSILON && cdB > GEOMETRY_EPSILON))) return true;
  return (Math.abs(abC) <= GEOMETRY_EPSILON && pointOnSegmentUnchecked(c, a, b))
    || (Math.abs(abD) <= GEOMETRY_EPSILON && pointOnSegmentUnchecked(d, a, b))
    || (Math.abs(cdA) <= GEOMETRY_EPSILON && pointOnSegmentUnchecked(a, c, d))
    || (Math.abs(cdB) <= GEOMETRY_EPSILON && pointOnSegmentUnchecked(b, c, d));
}

function pointInPolygonUnchecked(point: PointTuple, polygon: readonly PointTuple[]): boolean {
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index];
    const end = polygon[(index + 1) % polygon.length];
    if (start && end && Math.abs(orientation(start, end, point)) <= GEOMETRY_EPSILON
      && pointOnSegmentUnchecked(point, start, end)) return true;
  }
  let inside = false;
  let previous = polygon.at(-1);
  if (!previous) return false;
  for (const current of polygon) {
    if ((previous[1] > point[1]) !== (current[1] > point[1])) {
      const crossingX = (current[0] - previous[0]) * (point[1] - previous[1])
        / (current[1] - previous[1]) + previous[0];
      if (point[0] < crossingX) inside = !inside;
    }
    previous = current;
  }
  return inside;
}

function segmentBoundaryParameters(
  start: PointTuple,
  end: PointTuple,
  edgeStart: PointTuple,
  edgeEnd: PointTuple,
): readonly number[] {
  const rx = end[0] - start[0];
  const rz = end[1] - start[1];
  const sx = edgeEnd[0] - edgeStart[0];
  const sz = edgeEnd[1] - edgeStart[1];
  const qx = edgeStart[0] - start[0];
  const qz = edgeStart[1] - start[1];
  const denominator = cross(rx, rz, sx, sz);
  const collinearity = cross(qx, qz, rx, rz);
  if (Math.abs(denominator) <= GEOMETRY_EPSILON) {
    if (Math.abs(collinearity) > GEOMETRY_EPSILON) return [];
    const lengthSquared = rx * rx + rz * rz;
    return [
      (qx * rx + qz * rz) / lengthSquared,
      ((edgeEnd[0] - start[0]) * rx + (edgeEnd[1] - start[1]) * rz) / lengthSquared,
    ].filter((value) => value >= -GEOMETRY_EPSILON && value <= 1 + GEOMETRY_EPSILON);
  }
  const alongSegment = cross(qx, qz, sx, sz) / denominator;
  const alongEdge = cross(qx, qz, rx, rz) / denominator;
  return alongSegment >= -GEOMETRY_EPSILON && alongSegment <= 1 + GEOMETRY_EPSILON
    && alongEdge >= -GEOMETRY_EPSILON && alongEdge <= 1 + GEOMETRY_EPSILON
    ? [alongSegment]
    : [];
}

function uniqueSorted(values: readonly number[]): number[] {
  const sorted = [...values].sort((left, right) => left - right);
  const output: number[] = [];
  for (const value of sorted) {
    if (!Number.isFinite(value)) throw new ContractError("segment intersection produced a non-finite value");
    const previous = output.at(-1);
    if (previous === undefined || Math.abs(value - previous) > GEOMETRY_EPSILON) output.push(value);
  }
  return output;
}

function projectPolygon(
  polygon: readonly PointTuple[],
  axisX: number,
  axisZ: number,
): { readonly minimum: number; readonly maximum: number } {
  const values = polygon.map(([x, z]) => x * axisX + z * axisZ);
  return { minimum: Math.min(...values), maximum: Math.max(...values) };
}

function orientation(a: PointTuple, b: PointTuple, c: PointTuple): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function pointOnSegmentUnchecked(point: PointTuple, start: PointTuple, end: PointTuple): boolean {
  return point[0] >= Math.min(start[0], end[0]) - GEOMETRY_EPSILON
    && point[0] <= Math.max(start[0], end[0]) + GEOMETRY_EPSILON
    && point[1] >= Math.min(start[1], end[1]) - GEOMETRY_EPSILON
    && point[1] <= Math.max(start[1], end[1]) + GEOMETRY_EPSILON;
}

function assertNonDegenerateSegment(start: PointTuple, end: PointTuple, context: string): void {
  assertFiniteTuple(start, `${context} start`);
  assertFiniteTuple(end, `${context} end`);
  if (Math.hypot(end[0] - start[0], end[1] - start[1]) <= GEOMETRY_EPSILON) {
    throw new ContractError(`${context} must be non-degenerate`);
  }
}

function assertFiniteTuple(point: PointTuple, context: string): void {
  if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) {
    throw new ContractError(`${context} coordinates must be finite`);
  }
}

function assertFinitePoint(point: PointXZ, context: string): void {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.z)) {
    throw new ContractError(`${context} coordinates must be finite`);
  }
}

function assertFiniteNumber(value: number, context: string): void {
  if (!Number.isFinite(value)) throw new ContractError(`${context} must be finite`);
}

function assertWorld(world: WorldBounds): void {
  if (!Number.isFinite(world.widthM) || !Number.isFinite(world.depthM)
    || world.widthM <= 0 || world.depthM <= 0) {
    throw new ContractError("world bounds must be finite and positive");
  }
}

function assertTupleInsideWorld(point: PointTuple, world: WorldBounds, context: string): void {
  if (point[0] < 0 || point[0] > world.widthM || point[1] < 0 || point[1] > world.depthM) {
    throw new ContractError(`${context} is outside the world`);
  }
}

function assertPointInsideWorld(point: PointXZ, world: WorldBounds, context: string): void {
  if (point.x < 0 || point.x > world.widthM || point.z < 0 || point.z > world.depthM) {
    throw new ContractError(`${context} is outside the world`);
  }
}

function cross(ax: number, az: number, bx: number, bz: number): number {
  return ax * bz - az * bx;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
