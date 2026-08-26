import type { PointXZ } from "../model/coordinates";
import type {
  GeometryEntity,
  PointTuple,
  Road,
  LinearFeature,
  WorldBounds,
} from "../model/entities";
import { ProjectModel } from "../model/ProjectModel";

export interface GeometryLayerState {
  readonly places: boolean;
  readonly landUse: boolean;
  readonly roads: boolean;
  readonly hedgerows: boolean;
}

export interface GeometryHit {
  readonly id: string;
  readonly vertexIndex: number | null;
}

export interface SegmentHit {
  readonly segmentIndex: number;
  readonly distance: number;
  readonly nearest: PointTuple;
}

export function hitTestGeometry(
  model: ProjectModel,
  point: PointXZ,
  toleranceM: number,
  layers: GeometryLayerState,
  selectedId: string | null,
): GeometryHit | null {
  const selected = selectedId ? model.get(selectedId) : undefined;
  if (selected && isEditableGeometry(selected) && isLayerVisible(selected, layers) && selected.visible) {
    for (let index = 0; index < selected.points.length; index += 1) {
      const vertex = selected.points[index];
      if (vertex && Math.hypot(point.x - vertex[0], point.z - vertex[1]) <= toleranceM) {
        return { id: selected.id, vertexIndex: index };
      }
    }
  }

  const linearGroups = [
    { kind: "linear_feature" as const, enabled: layers.hedgerows },
    { kind: "road" as const, enabled: layers.roads },
  ];
  for (const group of linearGroups) {
    if (!group.enabled) continue;
    for (const entity of [...model.list(group.kind)].reverse()) {
      if (entity.kind === group.kind && entity.visible && distanceToPolyline(point, entity.points) <= toleranceM) {
        return { id: entity.id, vertexIndex: null };
      }
    }
  }

  const regionGroups = [
    { kind: "land_use" as const, enabled: layers.landUse },
    { kind: "place" as const, enabled: layers.places },
  ];
  for (const group of regionGroups) {
    if (!group.enabled) continue;
    for (const entity of [...model.list(group.kind)].reverse()) {
      if (
        entity.kind === group.kind
        && entity.visible
        && (pointInPolygon(point, entity.points) || distanceToPolygonEdge(point, entity.points) <= toleranceM)
      ) {
        return { id: entity.id, vertexIndex: null };
      }
    }
  }
  return null;
}

export function moveGeometryEntity(
  entity: GeometryEntity,
  delta: PointXZ,
  world: WorldBounds,
  vertexIndex: number | null,
): GeometryEntity {
  const points = entity.points.map(([x, z]) => [x, z] as PointTuple);
  if (vertexIndex !== null) {
    const point = points[vertexIndex];
    if (!point) return entity;
    points[vertexIndex] = [
      clamp(point[0] + delta.x, 0, world.widthM),
      clamp(point[1] + delta.z, 0, world.depthM),
    ];
  } else {
    const xs = points.map(([x]) => x);
    const zs = points.map(([, z]) => z);
    const dx = clamp(delta.x, -Math.min(...xs), world.widthM - Math.max(...xs));
    const dz = clamp(delta.z, -Math.min(...zs), world.depthM - Math.max(...zs));
    points.forEach((point, index) => {
      points[index] = [point[0] + dx, point[1] + dz];
    });
  }
  return { ...entity, points };
}

export function insertControlPoint(
  entity: Road | LinearFeature,
  segmentIndex: number,
  point: PointXZ,
): Road | LinearFeature {
  const points = entity.points.map(([x, z]) => [x, z] as PointTuple);
  points.splice(segmentIndex + 1, 0, [point.x, point.z]);
  return { ...entity, points };
}

export function deleteControlPoint(entity: GeometryEntity, index: number): GeometryEntity | null {
  const minimum = entity.kind === "place" || entity.kind === "land_use" ? 3 : 2;
  if (entity.points.length <= minimum || index < 0 || index >= entity.points.length) return null;
  return { ...entity, points: entity.points.filter((_, pointIndex) => pointIndex !== index) };
}

export function nearestSegment(point: PointXZ, points: readonly PointTuple[]): SegmentHit {
  let best: SegmentHit | null = null;
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    if (!start || !end) continue;
    const candidate = distanceToSegment(point, start, end);
    if (!best || candidate.distance < best.distance) {
      best = { segmentIndex: index, ...candidate };
    }
  }
  if (!best) throw new Error("a polyline must contain at least one segment");
  return best;
}

export function distanceToSegment(
  point: PointXZ,
  start: PointTuple,
  end: PointTuple,
): { readonly distance: number; readonly nearest: PointTuple } {
  const dx = end[0] - start[0];
  const dz = end[1] - start[1];
  const lengthSquared = dx * dx + dz * dz;
  const t = lengthSquared === 0
    ? 0
    : clamp(((point.x - start[0]) * dx + (point.z - start[1]) * dz) / lengthSquared, 0, 1);
  const nearest: PointTuple = [start[0] + t * dx, start[1] + t * dz];
  return { distance: Math.hypot(point.x - nearest[0], point.z - nearest[1]), nearest };
}

export function pointInPolygon(point: PointXZ, points: readonly PointTuple[]): boolean {
  let inside = false;
  let previous = points.at(-1);
  if (!previous) return false;
  for (const current of points) {
    if ((previous[1] > point.z) !== (current[1] > point.z)) {
      const crossingX = (current[0] - previous[0]) * (point.z - previous[1])
        / (current[1] - previous[1]) + previous[0];
      if (point.x < crossingX) inside = !inside;
    }
    previous = current;
  }
  return inside;
}

export function dedupeDraft(points: readonly PointXZ[], epsilon = 1e-7): readonly PointTuple[] {
  const result: PointTuple[] = [];
  for (const point of points) {
    const previous = result.at(-1);
    if (!previous || Math.hypot(point.x - previous[0], point.z - previous[1]) > epsilon) {
      result.push([point.x, point.z]);
    }
  }
  return result;
}

export function countDistinctPoints(points: readonly PointTuple[], epsilon = 1e-7): number {
  const distinct: PointTuple[] = [];
  for (const point of points) {
    if (!distinct.some((candidate) => Math.hypot(point[0] - candidate[0], point[1] - candidate[1]) <= epsilon)) {
      distinct.push(point);
    }
  }
  return distinct.length;
}

export function clampPoint(point: PointXZ, world: WorldBounds): PointXZ {
  return {
    x: clamp(point.x, 0, world.widthM),
    z: clamp(point.z, 0, world.depthM),
  };
}

export function isPointInsideWorld(point: PointXZ, world: WorldBounds): boolean {
  return point.x >= 0 && point.x <= world.widthM && point.z >= 0 && point.z <= world.depthM;
}

function distanceToPolyline(point: PointXZ, points: readonly PointTuple[]): number {
  return nearestSegment(point, points).distance;
}

function distanceToPolygonEdge(point: PointXZ, points: readonly PointTuple[]): number {
  let minimum = Number.POSITIVE_INFINITY;
  for (let index = 0; index < points.length; index += 1) {
    const start = points[index];
    const end = points[(index + 1) % points.length];
    if (start && end) minimum = Math.min(minimum, distanceToSegment(point, start, end).distance);
  }
  return minimum;
}

function isEditableGeometry(entity: { readonly kind: string }): entity is GeometryEntity {
  return entity.kind === "place"
    || entity.kind === "land_use"
    || entity.kind === "road"
    || entity.kind === "linear_feature";
}

function isLayerVisible(entity: GeometryEntity, layers: GeometryLayerState): boolean {
  switch (entity.kind) {
    case "place": return layers.places;
    case "land_use": return layers.landUse;
    case "road": return layers.roads;
    case "linear_feature": return layers.hedgerows;
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
