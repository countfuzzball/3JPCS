import type { AssetCatalog } from "../model/assetCatalog";
import type { PointXZ } from "../model/coordinates";
import type { PointTuple, PrefabInstance, Road, WorldBounds } from "../model/entities";
import {
  buildPolylineMetrics,
  convexPolygonsOverlapStrict,
  GEOMETRY_EPSILON,
  pointsInsideWorld,
  projectPointToPolyline,
  samplePolyline,
  segmentPolygonDistance,
  slicePolylineRange,
  smoothedPolylineTangent,
} from "../generation/geometry";
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

export function projectPointToRoad(road: Road, point: PointXZ): FrontageAnchor | null {
  const hasSegment = road.points.some((start, index) => {
    const end = road.points[index + 1];
    return end !== undefined && Math.hypot(end[0] - start[0], end[1] - start[1]) > GEOMETRY_EPSILON;
  });
  if (!hasSegment) return null;
  const projection = projectPointToPolyline(buildPolylineMetrics(road.points), point);
  return { roadId: road.id, distanceM: projection.distanceM, point: projection.point };
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
  const metrics = buildPolylineMetrics(road.points);
  const direction = end.distanceM >= start.distanceM ? 1 : -1;
  const rangeLengthM = Math.abs(end.distanceM - start.distanceM);
  const usableLengthM = Math.max(0, rangeLengthM - 2 * settings.endClearanceM);
  const pitchM = proxy.widthM + settings.gapM;
  const count = Math.max(0, Math.floor((usableLengthM + settings.gapM + GEOMETRY_EPSILON) / pitchM));
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
    const tangent = smoothedPolylineTangent(metrics, distanceM, direction);
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
      if (!pointsInsideWorld(footprint, world)) {
        skipReason = "outside_world";
      } else if ([...existingFootprints, ...acceptedFootprints]
        .some((other) => convexPolygonsOverlapStrict(footprint, other))) {
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
    rangePoints: slicePolylineRange(metrics, start.distanceM, end.distanceM),
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

function footprintClashesWithRoad(footprint: readonly PointTuple[], road: Road): boolean {
  const clearanceM = road.width_m / 2;
  for (let index = 0; index < road.points.length - 1; index += 1) {
    const start = road.points[index];
    const end = road.points[index + 1];
    if (!start || !end) continue;
    if (segmentPolygonDistance(start, end, footprint) < clearanceM - GEOMETRY_EPSILON) return true;
  }
  return false;
}

function normalizeDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}
