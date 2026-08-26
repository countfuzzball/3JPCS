import { ContractError } from "./errors";

export const PLACE_TYPES = ["town", "village", "farm", "military_area"] as const;
export const LAND_USE_TYPES = ["pasture", "rough_grazing", "woodland"] as const;
export const ROAD_CLASSES = ["county_road", "local_road", "lane", "farm_track", "military_road"] as const;
export const ROAD_SURFACES = ["paved", "gravel", "dirt"] as const;
export const VEGETATION_TYPES = ["forest_tree", "scattered_tree", "shrub"] as const;

export type PlaceType = typeof PLACE_TYPES[number];
export type LandUseType = typeof LAND_USE_TYPES[number];
export type RoadClass = typeof ROAD_CLASSES[number];
export type RoadSurface = typeof ROAD_SURFACES[number];
export type VegetationType = typeof VEGETATION_TYPES[number];
export type PointTuple = readonly [xM: number, zM: number];

export interface WorldBounds {
  readonly widthM: number;
  readonly depthM: number;
}

interface AuthoredCommon {
  readonly id: string;
  readonly name: string;
  readonly visible: boolean;
  readonly locked: boolean;
}

export interface PlaceRegion extends AuthoredCommon {
  readonly kind: "place";
  readonly place_type: PlaceType;
  readonly points: readonly PointTuple[];
}

export interface LandUseRegion extends AuthoredCommon {
  readonly kind: "land_use";
  readonly land_use_type: LandUseType;
  readonly points: readonly PointTuple[];
}

export interface Road extends AuthoredCommon {
  readonly kind: "road";
  readonly points: readonly PointTuple[];
  readonly width_m: number;
  readonly road_class: RoadClass;
  readonly surface: RoadSurface;
}

export interface LinearFeature extends AuthoredCommon {
  readonly kind: "linear_feature";
  readonly feature_type: "hedgerow";
  readonly points: readonly PointTuple[];
  readonly nominal_width_m: number;
  readonly nominal_height_m: number;
}

export interface TerrainPad {
  readonly enabled: boolean;
  readonly width_m: number;
  readonly depth_m: number;
  readonly blend_m: number;
  readonly target_mode: "base_terrain_at_origin";
}

export interface PrefabInstance extends AuthoredCommon {
  readonly kind: "prefab";
  readonly category: string;
  readonly asset_id: string;
  readonly x_m: number;
  readonly z_m: number;
  readonly rotation_deg: number;
  readonly scale: number;
  readonly frontage_road_id: string | null;
  readonly terrain_pad: TerrainPad;
}

export interface VegetationInstance extends AuthoredCommon {
  readonly kind: "vegetation";
  readonly vegetation_type: VegetationType;
  readonly asset_id: string;
  readonly x_m: number;
  readonly z_m: number;
  readonly rotation_deg: number;
  readonly scale: number;
  readonly source_region_id: string | null;
}

export type GeometryEntity = PlaceRegion | LandUseRegion | Road | LinearFeature;
export type AuthoredEntity = GeometryEntity | PrefabInstance | VegetationInstance;
export type EntityKind = AuthoredEntity["kind"];

export const DEFAULT_TERRAIN_PAD: TerrainPad = Object.freeze({
  enabled: false,
  width_m: 12,
  depth_m: 12,
  blend_m: 8,
  target_mode: "base_terrain_at_origin",
});

export function newEntityId(): string {
  return crypto.randomUUID();
}

export function geometryPoints(entity: GeometryEntity): readonly PointTuple[] {
  return entity.points;
}

export function isGeometryEntity(entity: AuthoredEntity): entity is GeometryEntity {
  return entity.kind === "place"
    || entity.kind === "land_use"
    || entity.kind === "road"
    || entity.kind === "linear_feature";
}

export function validateEntity(
  entity: AuthoredEntity,
  world: WorldBounds,
  roadIds: ReadonlySet<string> = new Set(),
): void {
  requireUuid(entity.id, `${entity.kind}.id`);
  requireNonEmptyString(entity.name, `${entity.kind}.name`);
  requireBoolean(entity.visible, `${entity.kind}.visible`);
  requireBoolean(entity.locked, `${entity.kind}.locked`);

  switch (entity.kind) {
    case "place":
      requireEnum(entity.place_type, PLACE_TYPES, "place.place_type");
      validatePointList(entity.points, 3, world, "place.points");
      break;
    case "land_use":
      requireEnum(entity.land_use_type, LAND_USE_TYPES, "land_use.land_use_type");
      validatePointList(entity.points, 3, world, "land_use.points");
      break;
    case "road":
      validatePointList(entity.points, 2, world, "road.points");
      requirePositiveNumber(entity.width_m, "road.width_m");
      requireEnum(entity.road_class, ROAD_CLASSES, "road.road_class");
      requireEnum(entity.surface, ROAD_SURFACES, "road.surface");
      break;
    case "linear_feature":
      if ((entity.feature_type as string) !== "hedgerow") {
        throw new ContractError("linear_feature.feature_type must be hedgerow");
      }
      validatePointList(entity.points, 2, world, "linear_feature.points");
      requirePositiveNumber(entity.nominal_width_m, "linear_feature.nominal_width_m");
      requirePositiveNumber(entity.nominal_height_m, "linear_feature.nominal_height_m");
      break;
    case "prefab":
      requireNonEmptyString(entity.category, "prefab.category");
      requireNonEmptyString(entity.asset_id, "prefab.asset_id");
      validateOrigin(entity.x_m, entity.z_m, world, "prefab");
      requireFiniteNumber(entity.rotation_deg, "prefab.rotation_deg");
      requirePositiveNumber(entity.scale, "prefab.scale");
      validateTerrainPad(entity.terrain_pad);
      if (entity.frontage_road_id !== null) {
        requireUuid(entity.frontage_road_id, "prefab.frontage_road_id");
        if (!roadIds.has(entity.frontage_road_id)) {
          throw new ContractError("prefab.frontage_road_id does not resolve");
        }
      }
      break;
    case "vegetation":
      requireEnum(entity.vegetation_type, VEGETATION_TYPES, "vegetation.vegetation_type");
      requireNonEmptyString(entity.asset_id, "vegetation.asset_id");
      validateOrigin(entity.x_m, entity.z_m, world, "vegetation");
      requireFiniteNumber(entity.rotation_deg, "vegetation.rotation_deg");
      requirePositiveNumber(entity.scale, "vegetation.scale");
      if (entity.source_region_id !== null) {
        requireUuid(entity.source_region_id, "vegetation.source_region_id");
      }
      break;
  }
}

export function validatePointList(
  points: readonly PointTuple[],
  minimum: number,
  world: WorldBounds,
  context: string,
): void {
  if (!Array.isArray(points) || points.length < minimum) {
    throw new ContractError(`${context} must contain at least ${String(minimum)} points`);
  }
  points.forEach((point, index) => {
    if (!Array.isArray(point) || point.length !== 2) {
      throw new ContractError(`${context}[${String(index)}] must be [x_m, z_m]`);
    }
    const x = requireFiniteNumber(point[0], `${context}[${String(index)}].x`);
    const z = requireFiniteNumber(point[1], `${context}[${String(index)}].z`);
    if (x < 0 || x > world.widthM || z < 0 || z > world.depthM) {
      throw new ContractError(`${context}[${String(index)}] is outside the terrain world`);
    }
  });
}

export function requireExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  context: string,
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    const missing = wanted.filter((key) => !actual.includes(key));
    const unknown = actual.filter((key) => !wanted.includes(key));
    const details = [
      missing.length > 0 ? `missing ${missing.join(", ")}` : "",
      unknown.length > 0 ? `unknown ${unknown.join(", ")}` : "",
    ].filter(Boolean).join("; ");
    throw new ContractError(`${context} has invalid fields: ${details}`);
  }
}

export function requireRecord(value: unknown, context: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ContractError(`${context} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function requireArray(value: unknown, context: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new ContractError(`${context} must be an array`);
  }
  return value;
}

export function requireFiniteNumber(value: unknown, context: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ContractError(`${context} must be a finite number`);
  }
  return value;
}

export function requirePositiveNumber(value: unknown, context: string): number {
  const result = requireFiniteNumber(value, context);
  if (result <= 0) throw new ContractError(`${context} must be greater than zero`);
  return result;
}

export function requireNonNegativeNumber(value: unknown, context: string): number {
  const result = requireFiniteNumber(value, context);
  if (result < 0) throw new ContractError(`${context} must be zero or greater`);
  return result;
}

export function requireNonEmptyString(value: unknown, context: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ContractError(`${context} must be a non-empty string`);
  }
  return value.trim();
}

export function requireBoolean(value: unknown, context: string): boolean {
  if (typeof value !== "boolean") throw new ContractError(`${context} must be a boolean`);
  return value;
}

export function requireUuid(value: unknown, context: string): string {
  const text = requireNonEmptyString(value, context).toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(text)) {
    throw new ContractError(`${context} must be an RFC 4122 UUID`);
  }
  return text;
}

export function requireEnum<T extends string>(value: unknown, values: readonly T[], context: string): T {
  if (typeof value !== "string" || !values.includes(value as T)) {
    throw new ContractError(`${context} has an unsupported value`);
  }
  return value as T;
}

function validateOrigin(xValue: unknown, zValue: unknown, world: WorldBounds, context: string): void {
  const x = requireFiniteNumber(xValue, `${context}.x_m`);
  const z = requireFiniteNumber(zValue, `${context}.z_m`);
  if (x < 0 || x > world.widthM || z < 0 || z > world.depthM) {
    throw new ContractError(`${context} origin is outside the terrain world`);
  }
}

function validateTerrainPad(pad: TerrainPad): void {
  requireBoolean(pad.enabled, "prefab.terrain_pad.enabled");
  requirePositiveNumber(pad.width_m, "prefab.terrain_pad.width_m");
  requirePositiveNumber(pad.depth_m, "prefab.terrain_pad.depth_m");
  requireNonNegativeNumber(pad.blend_m, "prefab.terrain_pad.blend_m");
  if ((pad.target_mode as string) !== "base_terrain_at_origin") {
    throw new ContractError("prefab.terrain_pad.target_mode is unsupported");
  }
}
