import type { AssetCatalog } from "../model/assetCatalog";
import type {
  PlaceRegion,
  PointTuple,
  PrefabInstance,
  Road,
  WorldBounds,
} from "../model/entities";
import type { TerrainSurface } from "../terrain/TerrainSurface";
import {
  footprintClashesWithRoad,
  type FrontageCandidateSide,
  type FrontageSettings,
} from "../interaction/frontageAssist";
import { prefabFootprint, prefabProxySize } from "../interaction/prefabEditing";
import {
  buildPolylineMetrics,
  clipPolylineToPolygon,
  convexPolygonsOverlapStrict,
  GEOMETRY_EPSILON,
  pointInPolygon,
  pointsInsideWorld,
  samplePolyline,
  segmentPolygonDistance,
  smoothedPolylineTangent,
  type PolylineRange,
} from "./geometry";
import { SeededRandom } from "./seededRandom";

export type SettlementFrontageSkipReason =
  | "outside_settlement"
  | "outside_world"
  | "prefab_overlap"
  | "road_clash"
  | "junction_clearance"
  | "excessive_plot_slope";

export interface SettlementFrontageSettings extends FrontageSettings {
  readonly maximumPlotSlopeDeg: number;
  readonly junctionClearanceM: number;
  readonly spacingJitterM: number;
  readonly yawJitterDeg: number;
  readonly seed: number;
}

export interface SettlementRoadRange extends PolylineRange {
  readonly roadId: string;
}

export interface SettlementRoadEligibility {
  readonly road: Road;
  readonly ranges: readonly SettlementRoadRange[];
  readonly totalRangeLengthM: number;
}

export interface SettlementJunction {
  readonly point: PointTuple;
  readonly roadIds: readonly string[];
}

export interface SettlementFrontageCandidate {
  readonly roadId: string;
  readonly rangeIndex: number;
  readonly side: FrontageCandidateSide;
  readonly distanceM: number;
  readonly baseDistanceM: number;
  readonly spacingJitterM: number;
  readonly yawJitterDeg: number;
  readonly xM: number;
  readonly zM: number;
  readonly rotationDeg: number;
  readonly footprint: readonly PointTuple[];
  readonly maximumPlotSlopeDeg: number | null;
  readonly skipReason: SettlementFrontageSkipReason | null;
}

export interface SettlementFrontagePlan {
  readonly settlementId: string;
  readonly eligibleRoadIds: readonly string[];
  readonly ranges: readonly SettlementRoadRange[];
  readonly junctions: readonly SettlementJunction[];
  readonly candidates: readonly SettlementFrontageCandidate[];
  readonly acceptedCount: number;
  readonly skipped: Readonly<Record<SettlementFrontageSkipReason, number>>;
}

export interface SettlementFrontageInput {
  readonly settlement: PlaceRegion;
  readonly eligibleRoadIds: readonly string[];
  readonly roads: readonly Road[];
  readonly proxy: { readonly widthM: number; readonly depthM: number };
  readonly settings: SettlementFrontageSettings;
  readonly world: WorldBounds;
  readonly prefabs: readonly PrefabInstance[];
  readonly catalog: AssetCatalog | null;
  readonly terrain: TerrainSurface;
}

/** Returns every road/polygon intersection range; callers choose which roads are enabled. */
export function settlementRoadEligibility(
  settlement: PlaceRegion,
  roads: readonly Road[],
  world: WorldBounds,
): readonly SettlementRoadEligibility[] {
  return roads
    .map((road): SettlementRoadEligibility => {
      const ranges = clipPolylineToPolygon(road.points, settlement.points, world)
        .map((range): SettlementRoadRange => ({ roadId: road.id, ...range }));
      return {
        road,
        ranges,
        totalRangeLengthM: ranges.reduce((sum, range) => sum + range.lengthM, 0),
      };
    })
    .filter(({ ranges }) => ranges.length > 0);
}

/** Builds a deterministic, non-mutating settlement-wide frontage preview. */
export function buildSettlementFrontagePlan(input: SettlementFrontageInput): SettlementFrontagePlan {
  validateInput(input);
  const selectedIds = new Set(input.eligibleRoadIds);
  const eligibility = settlementRoadEligibility(input.settlement, input.roads, input.world)
    .filter(({ road }) => selectedIds.has(road.id))
    .sort((left, right) => left.road.id.localeCompare(right.road.id));
  const eligibleRoadIds = eligibility.map(({ road }) => road.id);
  const ranges = eligibility.flatMap(({ ranges: roadRanges }) => roadRanges);
  const junctions = settlementJunctions(
    input.roads,
    input.settlement,
    input.settings.junctionClearanceM + Math.max(input.proxy.widthM, input.proxy.depthM),
  );
  const random = new SeededRandom(input.settings.seed);
  const existingFootprints = input.prefabs.map((prefab) => {
    const size = prefabProxySize(prefab, input.catalog);
    return prefabFootprint(prefab.x_m, prefab.z_m, size.widthM, size.depthM, prefab.rotation_deg);
  });
  const acceptedFootprints: (readonly PointTuple[])[] = [];
  const candidates: SettlementFrontageCandidate[] = [];
  const skipped: Record<SettlementFrontageSkipReason, number> = {
    outside_settlement: 0,
    outside_world: 0,
    prefab_overlap: 0,
    road_clash: 0,
    junction_clearance: 0,
    excessive_plot_slope: 0,
  };
  const sides: readonly FrontageCandidateSide[] = input.settings.side === "both"
    ? ["left", "right"]
    : [input.settings.side];

  for (const { road, ranges: roadRanges } of eligibility) {
    const metrics = buildPolylineMetrics(road.points, input.world);
    for (let rangeIndex = 0; rangeIndex < roadRanges.length; rangeIndex += 1) {
      const range = roadRanges[rangeIndex];
      if (!range) continue;
      const baseDistances = regularlySpacedDistances(range, input.proxy.widthM, input.settings);
      for (const baseDistanceM of baseDistances) {
        const randomSpacingUnit = random.nextFloat() * 2 - 1;
        const minimumDistance = range.startDistanceM + input.settings.endClearanceM + input.proxy.widthM / 2;
        const maximumDistance = range.endDistanceM - input.settings.endClearanceM - input.proxy.widthM / 2;
        const distanceM = clamp(
          baseDistanceM + randomSpacingUnit * input.settings.spacingJitterM,
          minimumDistance,
          maximumDistance,
        );
        const sampled = samplePolyline(metrics, distanceM);
        const tangent = smoothedPolylineTangent(metrics, distanceM);
        for (const side of sides) {
          const yawUnit = random.nextFloat() * 2 - 1;
          const yawJitterDeg = yawUnit * input.settings.yawJitterDeg;
          const sideSign = side === "left" ? 1 : -1;
          const normal = { x: tangent.z * sideSign, z: -tangent.x * sideSign };
          const centerOffsetM = road.width_m / 2 + input.settings.setbackM + input.proxy.depthM / 2;
          const xM = sampled.point[0] + normal.x * centerOffsetM;
          const zM = sampled.point[1] + normal.z * centerOffsetM;
          const front = { x: -normal.x, z: -normal.z };
          const rotationDeg = normalizeDegrees(
            Math.atan2(front.x, -front.z) * 180 / Math.PI + yawJitterDeg,
          );
          const footprint = prefabFootprint(
            xM,
            zM,
            input.proxy.widthM,
            input.proxy.depthM,
            rotationDeg,
          );
          let maximumPlotSlopeDeg: number | null = null;
          let skipReason: SettlementFrontageSkipReason | null = null;
          if (!pointsInsideWorld(footprint, input.world)) {
            skipReason = "outside_world";
          } else if (!footprintInsideSettlement(footprint, input.settlement.points)) {
            skipReason = "outside_settlement";
          } else if ([...existingFootprints, ...acceptedFootprints]
            .some((other) => convexPolygonsOverlapStrict(footprint, other))) {
            skipReason = "prefab_overlap";
          } else if (input.settings.junctionClearanceM > 0 && junctions.some((junction) => (
            segmentPolygonDistance(junction.point, junction.point, footprint)
              < input.settings.junctionClearanceM - GEOMETRY_EPSILON
          ))) {
            skipReason = "junction_clearance";
          } else if (input.roads.some((candidateRoad) => footprintClashesWithRoad(footprint, candidateRoad))) {
            skipReason = "road_clash";
          } else {
            maximumPlotSlopeDeg = footprintMaximumSlope(input.terrain, [xM, zM], footprint);
            if (maximumPlotSlopeDeg > input.settings.maximumPlotSlopeDeg + GEOMETRY_EPSILON) {
              skipReason = "excessive_plot_slope";
            }
          }
          if (skipReason) skipped[skipReason] += 1;
          else acceptedFootprints.push(footprint);
          candidates.push({
            roadId: road.id,
            rangeIndex,
            side,
            distanceM,
            baseDistanceM,
            spacingJitterM: distanceM - baseDistanceM,
            yawJitterDeg,
            xM,
            zM,
            rotationDeg,
            footprint,
            maximumPlotSlopeDeg,
            skipReason,
          });
        }
      }
    }
  }

  return {
    settlementId: input.settlement.id,
    eligibleRoadIds,
    ranges,
    junctions,
    candidates,
    acceptedCount: candidates.length - Object.values(skipped).reduce((sum, count) => sum + count, 0),
    skipped,
  };
}

/** Detects intersections between distinct roads without persisting junction records. */
export function detectRoadJunctions(roads: readonly Road[]): readonly SettlementJunction[] {
  const junctions: { point: PointTuple; roadIds: Set<string> }[] = [];
  for (let leftIndex = 0; leftIndex < roads.length; leftIndex += 1) {
    const left = roads[leftIndex];
    if (!left) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < roads.length; rightIndex += 1) {
      const right = roads[rightIndex];
      if (!right) continue;
      for (let leftSegment = 0; leftSegment < left.points.length - 1; leftSegment += 1) {
        const a = left.points[leftSegment];
        const b = left.points[leftSegment + 1];
        if (!a || !b || distance(a, b) <= GEOMETRY_EPSILON) continue;
        for (let rightSegment = 0; rightSegment < right.points.length - 1; rightSegment += 1) {
          const c = right.points[rightSegment];
          const d = right.points[rightSegment + 1];
          if (!c || !d || distance(c, d) <= GEOMETRY_EPSILON || !boundsOverlap(a, b, c, d)) continue;
          for (const point of segmentIntersectionPoints(a, b, c, d)) {
            const existing = junctions.find((junction) => distance(junction.point, point) <= GEOMETRY_EPSILON);
            if (existing) {
              existing.roadIds.add(left.id);
              existing.roadIds.add(right.id);
            } else {
              junctions.push({ point, roadIds: new Set([left.id, right.id]) });
            }
          }
        }
      }
    }
  }
  return junctions
    .map(({ point, roadIds }) => ({ point, roadIds: [...roadIds].sort() }))
    .sort((left, right) => left.point[0] - right.point[0] || left.point[1] - right.point[1]);
}

function settlementJunctions(
  roads: readonly Road[],
  settlement: PlaceRegion,
  vicinityM: number,
): readonly SettlementJunction[] {
  return detectRoadJunctions(roads).filter(({ point }) => (
    pointInPolygon({ x: point[0], z: point[1] }, settlement.points)
      || segmentPolygonDistance(point, point, settlement.points) <= vicinityM + GEOMETRY_EPSILON
  ));
}

function regularlySpacedDistances(
  range: SettlementRoadRange,
  proxyWidthM: number,
  settings: FrontageSettings,
): readonly number[] {
  const usableLengthM = Math.max(0, range.lengthM - 2 * settings.endClearanceM);
  const pitchM = proxyWidthM + settings.gapM;
  const count = Math.max(0, Math.floor((usableLengthM + settings.gapM + GEOMETRY_EPSILON) / pitchM));
  const occupiedLengthM = count > 0 ? count * proxyWidthM + (count - 1) * settings.gapM : 0;
  const slackM = Math.max(0, usableLengthM - occupiedLengthM);
  const firstOffsetM = settings.endClearanceM + slackM / 2 + proxyWidthM / 2;
  return Array.from(
    { length: count },
    (_, index) => range.startDistanceM + firstOffsetM + index * pitchM,
  );
}

function footprintInsideSettlement(
  footprint: readonly PointTuple[],
  settlement: readonly PointTuple[],
): boolean {
  if (!footprint.every(([x, z]) => pointInPolygon({ x, z }, settlement))) return false;
  for (let index = 0; index < footprint.length; index += 1) {
    const start = footprint[index];
    const end = footprint[(index + 1) % footprint.length];
    if (!start || !end) return false;
    const edgeLengthM = distance(start, end);
    const insideLengthM = clipPolylineToPolygon([start, end], settlement)
      .reduce((sum, range) => sum + range.lengthM, 0);
    if (insideLengthM < edgeLengthM - GEOMETRY_EPSILON) return false;
  }
  return true;
}

function footprintMaximumSlope(
  terrain: TerrainSurface,
  center: PointTuple,
  footprint: readonly PointTuple[],
): number {
  return Math.max(
    terrain.slopeAt(center[0], center[1]),
    ...footprint.map(([x, z]) => terrain.slopeAt(x, z)),
  );
}

function segmentIntersectionPoints(
  a: PointTuple,
  b: PointTuple,
  c: PointTuple,
  d: PointTuple,
): readonly PointTuple[] {
  const rx = b[0] - a[0];
  const rz = b[1] - a[1];
  const sx = d[0] - c[0];
  const sz = d[1] - c[1];
  const qx = c[0] - a[0];
  const qz = c[1] - a[1];
  const denominator = cross(rx, rz, sx, sz);
  if (Math.abs(denominator) > GEOMETRY_EPSILON) {
    const t = cross(qx, qz, sx, sz) / denominator;
    const u = cross(qx, qz, rx, rz) / denominator;
    return t >= -GEOMETRY_EPSILON && t <= 1 + GEOMETRY_EPSILON
      && u >= -GEOMETRY_EPSILON && u <= 1 + GEOMETRY_EPSILON
      ? [[a[0] + t * rx, a[1] + t * rz]]
      : [];
  }
  if (Math.abs(cross(qx, qz, rx, rz)) > GEOMETRY_EPSILON) return [];
  const candidates = [a, b, c, d].filter((point) => onSegment(point, a, b) && onSegment(point, c, d));
  const unique: PointTuple[] = [];
  for (const point of candidates) {
    if (!unique.some((candidate) => distance(candidate, point) <= GEOMETRY_EPSILON)) unique.push(point);
  }
  return unique;
}

function validateInput(input: SettlementFrontageInput): void {
  if (input.proxy.widthM <= 0 || input.proxy.depthM <= 0
    || !Number.isFinite(input.proxy.widthM) || !Number.isFinite(input.proxy.depthM)) {
    throw new Error("house proxy dimensions must be finite and positive");
  }
  const nonNegative: readonly (readonly [string, number])[] = [
    ["setback", input.settings.setbackM],
    ["gap", input.settings.gapM],
    ["end clearance", input.settings.endClearanceM],
    ["junction clearance", input.settings.junctionClearanceM],
    ["spacing jitter", input.settings.spacingJitterM],
    ["yaw jitter", input.settings.yawJitterDeg],
  ];
  for (const [label, value] of nonNegative) {
    if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be zero or greater`);
  }
  if (!Number.isFinite(input.settings.maximumPlotSlopeDeg)
    || input.settings.maximumPlotSlopeDeg <= 0
    || input.settings.maximumPlotSlopeDeg >= 90) {
    throw new Error("maximum plot slope must be greater than zero and below 90 degrees");
  }
  if (!Number.isSafeInteger(input.settings.seed)) throw new Error("settlement frontage seed must be a safe integer");
  const roadIds = new Set(input.roads.map(({ id }) => id));
  if (input.eligibleRoadIds.some((id) => !roadIds.has(id))) throw new Error("eligible road selection contains an unknown road");
}

function boundsOverlap(a: PointTuple, b: PointTuple, c: PointTuple, d: PointTuple): boolean {
  return Math.max(Math.min(a[0], b[0]), Math.min(c[0], d[0]))
      <= Math.min(Math.max(a[0], b[0]), Math.max(c[0], d[0])) + GEOMETRY_EPSILON
    && Math.max(Math.min(a[1], b[1]), Math.min(c[1], d[1]))
      <= Math.min(Math.max(a[1], b[1]), Math.max(c[1], d[1])) + GEOMETRY_EPSILON;
}

function onSegment(point: PointTuple, start: PointTuple, end: PointTuple): boolean {
  return Math.abs(cross(end[0] - start[0], end[1] - start[1], point[0] - start[0], point[1] - start[1]))
      <= GEOMETRY_EPSILON
    && point[0] >= Math.min(start[0], end[0]) - GEOMETRY_EPSILON
    && point[0] <= Math.max(start[0], end[0]) + GEOMETRY_EPSILON
    && point[1] >= Math.min(start[1], end[1]) - GEOMETRY_EPSILON
    && point[1] <= Math.max(start[1], end[1]) + GEOMETRY_EPSILON;
}

function normalizeDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}

function distance(first: PointTuple, second: PointTuple): number {
  return Math.hypot(second[0] - first[0], second[1] - first[1]);
}

function cross(ax: number, az: number, bx: number, bz: number): number {
  return ax * bz - az * bx;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
