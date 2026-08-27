import type { AssetCatalog } from "../model/assetCatalog";
import type { PointXZ } from "../model/coordinates";
import type { PointTuple, PrefabInstance, Road, WorldBounds } from "../model/entities";
import { prefabFootprint, prefabProxySize } from "./prefabEditing";

export type FrontageSide = "left" | "right" | "both";
export type FrontageCandidateSide = Exclude<FrontageSide, "both">;
export type FrontageSkipReason = "outside_world" | "prefab_overlap" | "road_clash";

export interface FrontageSettings {
  readonly side: FrontageSide;
  readonly setbackM: number;
  readonly gapM: number;
  readonly endClearanceM: number;
}

export interface FrontageAnchor {
  readonly roadId: string;
  readonly distanceM: number;
  readonly point: PointTuple;
}

export interface FrontageCandidate {
  readonly side: FrontageCandidateSide;
  readonly distanceM: number;
  readonly xM: number;
  readonly zM: number;
  readonly rotationDeg: number;
  readonly footprint: readonly PointTuple[];
  readonly skipReason: FrontageSkipReason | null;
}

export interface FrontagePlan {
  readonly roadId: string;
  readonly rangeLengthM: number;
  readonly rangePoints: readonly PointTuple[];
  readonly candidates: readonly FrontageCandidate[];
  readonly acceptedCount: number;
  readonly skipped: Readonly<Record<FrontageSkipReason, number>>;
}

interface PolylineSegment {
  readonly index: number;
  readonly start: PointTuple;
  readonly end: PointTuple;
  readonly startDistanceM: number;
  readonly lengthM: number;
  readonly tangent: PointXZ;
}

interface PolylineMetrics {
  readonly segments: readonly PolylineSegment[];
  readonly totalLengthM: number;
  readonly vertexDistancesM: readonly number[];
}

interface SampledPoint {
  readonly point: PointTuple;
  readonly tangent: PointXZ;
}

const EPSILON = 1e-7;

export function projectPointToRoad(road: Road, point: PointXZ): FrontageAnchor | null {
  const metrics = polylineMetrics(road.points);
  let best: { readonly distanceSq: number; readonly distanceM: number; readonly point: PointTuple } | null = null;
  for (const segment of metrics.segments) {
    const dx = point.x - segment.start[0];
    const dz = point.z - segment.start[1];
    const along = dx * segment.tangent.x + dz * segment.tangent.z;
    const localDistanceM = Math.max(0, Math.min(segment.lengthM, along));
    const projected: PointTuple = [
      segment.start[0] + segment.tangent.x * localDistanceM,
      segment.start[1] + segment.tangent.z * localDistanceM,
    ];
    const distanceSq = (point.x - projected[0]) ** 2 + (point.z - projected[1]) ** 2;
    if (!best || distanceSq < best.distanceSq) {
      best = {
        distanceSq,
        distanceM: segment.startDistanceM + localDistanceM,
        point: projected,
      };
    }
  }
  return best
    ? { roadId: road.id, distanceM: best.distanceM, point: best.point }
    : null;
}

export function closestRoadAnchor(
  roads: readonly Road[],
  point: PointXZ,
  maximumDistanceM: number,
): FrontageAnchor | null {
  let closest: { readonly anchor: FrontageAnchor; readonly distanceSq: number } | null = null;
  for (const road of roads) {
    if (!road.visible) continue;
    const anchor = projectPointToRoad(road, point);
    if (!anchor) continue;
    const distanceSq = (point.x - anchor.point[0]) ** 2 + (point.z - anchor.point[1]) ** 2;
    const toleranceM = Math.max(maximumDistanceM, road.width_m / 2);
    if (distanceSq > toleranceM ** 2) continue;
    if (!closest || distanceSq < closest.distanceSq) closest = { anchor, distanceSq };
  }
  return closest?.anchor ?? null;
}

export function buildFrontagePlan(
  road: Road,
  start: FrontageAnchor,
  end: FrontageAnchor,
  proxy: { readonly widthM: number; readonly depthM: number },
  settings: FrontageSettings,
  world: WorldBounds,
  roads: readonly Road[],
  prefabs: readonly PrefabInstance[],
  catalog: AssetCatalog | null,
): FrontagePlan {
  validateInputs(road, start, end, proxy, settings);
  const metrics = polylineMetrics(road.points);
  const direction = end.distanceM >= start.distanceM ? 1 : -1;
  const rangeLengthM = Math.abs(end.distanceM - start.distanceM);
  const usableLengthM = Math.max(0, rangeLengthM - 2 * settings.endClearanceM);
  const pitchM = proxy.widthM + settings.gapM;
  const count = Math.max(0, Math.floor((usableLengthM + settings.gapM + EPSILON) / pitchM));
  const occupiedLengthM = count > 0 ? count * proxy.widthM + (count - 1) * settings.gapM : 0;
  const slackM = Math.max(0, usableLengthM - occupiedLengthM);
  const firstOffsetM = settings.endClearanceM + slackM / 2 + proxy.widthM / 2;
  const sides: readonly FrontageCandidateSide[] = settings.side === "both"
    ? ["left", "right"]
    : [settings.side];
  const existingFootprints = prefabs.map((prefab) => {
    const size = prefabProxySize(prefab, catalog);
    return prefabFootprint(prefab.x_m, prefab.z_m, size.widthM, size.depthM, prefab.rotation_deg);
  });
  const acceptedFootprints: (readonly PointTuple[])[] = [];
  const candidates: FrontageCandidate[] = [];
  const skipped: Record<FrontageSkipReason, number> = {
    outside_world: 0,
    prefab_overlap: 0,
    road_clash: 0,
  };

  for (let index = 0; index < count; index += 1) {
    const traversalOffsetM = firstOffsetM + index * pitchM;
    const distanceM = start.distanceM + direction * traversalOffsetM;
    const sampled = samplePolyline(metrics, distanceM);
    const tangent = smoothedTangent(metrics, distanceM, direction);
    for (const side of sides) {
      const sideSign = side === "left" ? 1 : -1;
      const normal = { x: tangent.z * sideSign, z: -tangent.x * sideSign };
      const centerOffsetM = road.width_m / 2 + settings.setbackM + proxy.depthM / 2;
      const xM = sampled.point[0] + normal.x * centerOffsetM;
      const zM = sampled.point[1] + normal.z * centerOffsetM;
      const front = { x: -normal.x, z: -normal.z };
      const rotationDeg = normalizeDegrees(Math.atan2(front.x, -front.z) * 180 / Math.PI);
      const footprint = prefabFootprint(xM, zM, proxy.widthM, proxy.depthM, rotationDeg);
      let skipReason: FrontageSkipReason | null = null;
      if (!footprintInsideWorld(footprint, world)) {
        skipReason = "outside_world";
      } else if ([...existingFootprints, ...acceptedFootprints].some((other) => polygonsOverlap(footprint, other))) {
        skipReason = "prefab_overlap";
      } else if (roads.some((candidateRoad) => footprintClashesWithRoad(footprint, candidateRoad))) {
        skipReason = "road_clash";
      }
      if (skipReason) skipped[skipReason] += 1;
      else acceptedFootprints.push(footprint);
      candidates.push({ side, distanceM, xM, zM, rotationDeg, footprint, skipReason });
    }
  }

  return {
    roadId: road.id,
    rangeLengthM,
    rangePoints: rangePolyline(metrics, start.distanceM, end.distanceM),
    candidates,
    acceptedCount: candidates.length - Object.values(skipped).reduce((sum, value) => sum + value, 0),
    skipped,
  };
}

function validateInputs(
  road: Road,
  start: FrontageAnchor,
  end: FrontageAnchor,
  proxy: { readonly widthM: number; readonly depthM: number },
  settings: FrontageSettings,
): void {
  if (start.roadId !== road.id || end.roadId !== road.id) throw new Error("frontage anchors must belong to the selected road");
  for (const [label, value] of [
    ["asset width", proxy.widthM],
    ["asset depth", proxy.depthM],
  ] as const) {
    if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be positive`);
  }
  for (const [label, value] of [
    ["setback", settings.setbackM],
    ["gap", settings.gapM],
    ["end clearance", settings.endClearanceM],
  ] as const) {
    if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be zero or greater`);
  }
}

function polylineMetrics(points: readonly PointTuple[]): PolylineMetrics {
  const segments: PolylineSegment[] = [];
  const vertexDistancesM: number[] = [0];
  let totalLengthM = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    if (!start || !end) continue;
    const dx = end[0] - start[0];
    const dz = end[1] - start[1];
    const lengthM = Math.hypot(dx, dz);
    if (lengthM > EPSILON) {
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
  return { segments, totalLengthM, vertexDistancesM };
}

function samplePolyline(metrics: PolylineMetrics, requestedDistanceM: number): SampledPoint {
  const distanceM = Math.max(0, Math.min(metrics.totalLengthM, requestedDistanceM));
  const fallback = metrics.segments.at(-1);
  for (const segment of metrics.segments) {
    if (distanceM <= segment.startDistanceM + segment.lengthM + EPSILON) {
      const localDistanceM = Math.max(0, Math.min(segment.lengthM, distanceM - segment.startDistanceM));
      return {
        point: [
          segment.start[0] + segment.tangent.x * localDistanceM,
          segment.start[1] + segment.tangent.z * localDistanceM,
        ],
        tangent: segment.tangent,
      };
    }
  }
  if (!fallback) return { point: [0, 0], tangent: { x: 1, z: 0 } };
  return { point: fallback.end, tangent: fallback.tangent };
}

function smoothedTangent(metrics: PolylineMetrics, distanceM: number, direction: number): PointXZ {
  const radiusM = Math.min(2, Math.max(0.25, metrics.totalLengthM * 0.01));
  const before = samplePolyline(metrics, distanceM - radiusM).point;
  const after = samplePolyline(metrics, distanceM + radiusM).point;
  const dx = (after[0] - before[0]) * direction;
  const dz = (after[1] - before[1]) * direction;
  const lengthM = Math.hypot(dx, dz);
  if (lengthM > EPSILON) return { x: dx / lengthM, z: dz / lengthM };
  const fallback = samplePolyline(metrics, distanceM).tangent;
  return { x: fallback.x * direction, z: fallback.z * direction };
}

function rangePolyline(metrics: PolylineMetrics, startDistanceM: number, endDistanceM: number): readonly PointTuple[] {
  const lower = Math.min(startDistanceM, endDistanceM);
  const upper = Math.max(startDistanceM, endDistanceM);
  const points: PointTuple[] = [samplePolyline(metrics, lower).point];
  metrics.vertexDistancesM.forEach((distanceM) => {
    if (distanceM <= lower + EPSILON || distanceM >= upper - EPSILON) return;
    points.push(samplePolyline(metrics, distanceM).point);
  });
  points.push(samplePolyline(metrics, upper).point);
  return startDistanceM <= endDistanceM ? points : points.reverse();
}

function footprintInsideWorld(footprint: readonly PointTuple[], world: WorldBounds): boolean {
  return footprint.every(([x, z]) => x >= -EPSILON && x <= world.widthM + EPSILON && z >= -EPSILON && z <= world.depthM + EPSILON);
}

function polygonsOverlap(left: readonly PointTuple[], right: readonly PointTuple[]): boolean {
  for (const polygon of [left, right]) {
    for (let index = 0; index < polygon.length; index += 1) {
      const start = polygon[index];
      const end = polygon[(index + 1) % polygon.length];
      if (!start || !end) continue;
      const axisX = -(end[1] - start[1]);
      const axisZ = end[0] - start[0];
      const leftProjection = projectPolygon(left, axisX, axisZ);
      const rightProjection = projectPolygon(right, axisX, axisZ);
      if (leftProjection.maximum <= rightProjection.minimum + EPSILON
        || rightProjection.maximum <= leftProjection.minimum + EPSILON) return false;
    }
  }
  return true;
}

function projectPolygon(
  polygon: readonly PointTuple[],
  axisX: number,
  axisZ: number,
): { readonly minimum: number; readonly maximum: number } {
  const values = polygon.map(([x, z]) => x * axisX + z * axisZ);
  return { minimum: Math.min(...values), maximum: Math.max(...values) };
}

function footprintClashesWithRoad(footprint: readonly PointTuple[], road: Road): boolean {
  const clearanceM = road.width_m / 2;
  for (let index = 0; index < road.points.length - 1; index += 1) {
    const start = road.points[index];
    const end = road.points[index + 1];
    if (!start || !end) continue;
    if (segmentPolygonDistance(start, end, footprint) < clearanceM - EPSILON) return true;
  }
  return false;
}

function segmentPolygonDistance(start: PointTuple, end: PointTuple, polygon: readonly PointTuple[]): number {
  if (pointInPolygon(start, polygon) || pointInPolygon(end, polygon)) return 0;
  let minimum = Number.POSITIVE_INFINITY;
  for (let index = 0; index < polygon.length; index += 1) {
    const edgeStart = polygon[index];
    const edgeEnd = polygon[(index + 1) % polygon.length];
    if (!edgeStart || !edgeEnd) continue;
    minimum = Math.min(minimum, segmentDistance(start, end, edgeStart, edgeEnd));
  }
  return minimum;
}

function segmentDistance(a: PointTuple, b: PointTuple, c: PointTuple, d: PointTuple): number {
  if (segmentsIntersect(a, b, c, d)) return 0;
  return Math.min(
    pointSegmentDistance(a, c, d),
    pointSegmentDistance(b, c, d),
    pointSegmentDistance(c, a, b),
    pointSegmentDistance(d, a, b),
  );
}

function pointSegmentDistance(point: PointTuple, start: PointTuple, end: PointTuple): number {
  const dx = end[0] - start[0];
  const dz = end[1] - start[1];
  const lengthSq = dx * dx + dz * dz;
  if (lengthSq <= EPSILON) return Math.hypot(point[0] - start[0], point[1] - start[1]);
  const t = Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dz) / lengthSq));
  return Math.hypot(point[0] - (start[0] + dx * t), point[1] - (start[1] + dz * t));
}

function segmentsIntersect(a: PointTuple, b: PointTuple, c: PointTuple, d: PointTuple): boolean {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  if (((abC > EPSILON && abD < -EPSILON) || (abC < -EPSILON && abD > EPSILON))
    && ((cdA > EPSILON && cdB < -EPSILON) || (cdA < -EPSILON && cdB > EPSILON))) return true;
  return (Math.abs(abC) <= EPSILON && pointOnSegment(c, a, b))
    || (Math.abs(abD) <= EPSILON && pointOnSegment(d, a, b))
    || (Math.abs(cdA) <= EPSILON && pointOnSegment(a, c, d))
    || (Math.abs(cdB) <= EPSILON && pointOnSegment(b, c, d));
}

function orientation(a: PointTuple, b: PointTuple, c: PointTuple): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function pointOnSegment(point: PointTuple, start: PointTuple, end: PointTuple): boolean {
  return point[0] >= Math.min(start[0], end[0]) - EPSILON
    && point[0] <= Math.max(start[0], end[0]) + EPSILON
    && point[1] >= Math.min(start[1], end[1]) - EPSILON
    && point[1] <= Math.max(start[1], end[1]) + EPSILON;
}

function pointInPolygon(point: PointTuple, polygon: readonly PointTuple[]): boolean {
  let inside = false;
  let previous = polygon.at(-1);
  if (!previous) return false;
  for (const current of polygon) {
    if ((previous[1] > point[1]) !== (current[1] > point[1])) {
      const crossingX = (current[0] - previous[0]) * (point[1] - previous[1]) / (current[1] - previous[1]) + previous[0];
      if (point[0] < crossingX) inside = !inside;
    }
    previous = current;
  }
  return inside;
}

function normalizeDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}
