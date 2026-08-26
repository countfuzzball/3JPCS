import type { TerrainFingerprint } from "../terrain/TerrainReference";
import { ContractError } from "./errors";
import {
  DEFAULT_TERRAIN_PAD,
  LAND_USE_TYPES,
  PLACE_TYPES,
  ROAD_CLASSES,
  ROAD_SURFACES,
  VEGETATION_TYPES,
  requireArray,
  requireBoolean,
  requireEnum,
  requireExactKeys,
  requireFiniteNumber,
  requireNonEmptyString,
  requireNonNegativeNumber,
  requirePositiveNumber,
  requireRecord,
  requireUuid,
  validateEntity,
  type AuthoredEntity,
  type LandUseRegion,
  type LinearFeature,
  type PlaceRegion,
  type PointTuple,
  type PrefabInstance,
  type Road,
  type TerrainPad,
  type VegetationInstance,
  type WorldBounds,
} from "./entities";

export interface ProjectWorld {
  readonly width_m: number;
  readonly depth_m: number;
  readonly terrain_spacing_m: number;
}

export interface ProjectSources {
  readonly terrain_npy: string;
  readonly terrain_descriptor: string;
  readonly vegetation: string | null;
  readonly county_features: string | null;
  readonly asset_catalog: string | null;
}

export interface ParsedProjectV4 {
  readonly format: "polygon-county-scenery-project";
  readonly schema_version: 4;
  readonly name: string;
  readonly world: ProjectWorld;
  readonly sources: ProjectSources;
  readonly terrain_fingerprint: TerrainFingerprint;
  readonly places: readonly PlaceRegion[];
  readonly land_use_regions: readonly LandUseRegion[];
  readonly roads: readonly Road[];
  readonly linear_features: readonly LinearFeature[];
  readonly prefab_instances: readonly PrefabInstance[];
  readonly vegetation_instances: readonly VegetationInstance[];
}

export interface ProjectDocumentV4 {
  readonly format: "polygon-county-scenery-project";
  readonly schema_version: 4;
  readonly name: string;
  readonly world: ProjectWorld;
  readonly sources: ProjectSources;
  readonly terrain_fingerprint: TerrainFingerprint;
  readonly places: readonly Record<string, unknown>[];
  readonly land_use_regions: readonly Record<string, unknown>[];
  readonly roads: readonly Record<string, unknown>[];
  readonly linear_features: readonly Record<string, unknown>[];
  readonly prefab_instances: readonly Record<string, unknown>[];
  readonly vegetation_instances: readonly Record<string, unknown>[];
}

const TOP_LEVEL_V3 = [
  "format", "schema_version", "name", "world", "sources", "terrain_fingerprint",
  "places", "land_use_regions", "roads", "linear_features", "prefab_instances",
] as const;

export function parseProjectDocument(value: unknown): ParsedProjectV4 {
  const document = requireRecord(value, "scenery project");
  const schemaVersion = requireSchemaVersion(document.schema_version);
  requireExactKeys(
    document,
    schemaVersion === 4 ? [...TOP_LEVEL_V3, "vegetation_instances"] : TOP_LEVEL_V3,
    "scenery project",
  );
  if (document.format !== "polygon-county-scenery-project") {
    throw new ContractError("unsupported scenery project format");
  }

  const world = parseWorld(document.world);
  const bounds = { widthM: world.width_m, depthM: world.depth_m };
  const sources = parseSources(document.sources, schemaVersion);
  const fingerprint = parseFingerprint(document.terrain_fingerprint, world);
  const places = parseCollection(document.places, "places", (item, index) => parsePlace(item, bounds, index));
  const landUse = parseCollection(document.land_use_regions, "land_use_regions", (item, index) => parseLandUse(item, bounds, index));
  const roads = parseCollection(document.roads, "roads", (item, index) => parseRoad(item, bounds, index));
  const roadIds = new Set(roads.map((road) => road.id));
  const linear = parseCollection(document.linear_features, "linear_features", (item, index) => parseLinear(item, bounds, index));
  const prefabs = parseCollection(
    document.prefab_instances,
    "prefab_instances",
    (item, index) => parsePrefab(item, bounds, roadIds, schemaVersion, index),
  );
  const vegetation = schemaVersion === 4
    ? parseCollection(document.vegetation_instances, "vegetation_instances", (item, index) => parseVegetation(item, bounds, index))
    : [];
  assertUniqueIds([...places, ...landUse, ...roads, ...linear, ...prefabs, ...vegetation]);

  return {
    format: "polygon-county-scenery-project",
    schema_version: 4,
    name: requireNonEmptyString(document.name, "project.name"),
    world,
    sources,
    terrain_fingerprint: fingerprint,
    places,
    land_use_regions: landUse,
    roads,
    linear_features: linear,
    prefab_instances: prefabs,
    vegetation_instances: vegetation,
  };
}

export function entityToDocument(entity: AuthoredEntity): Record<string, unknown> {
  const common = {
    id: entity.id,
    name: entity.name,
    visible: entity.visible,
    locked: entity.locked,
  };
  switch (entity.kind) {
    case "place":
      return { ...common, place_type: entity.place_type, points: copyPoints(entity.points) };
    case "land_use":
      return { ...common, land_use_type: entity.land_use_type, points: copyPoints(entity.points) };
    case "road":
      return {
        ...common,
        points: copyPoints(entity.points),
        width_m: entity.width_m,
        road_class: entity.road_class,
        surface: entity.surface,
      };
    case "linear_feature":
      return {
        ...common,
        feature_type: entity.feature_type,
        points: copyPoints(entity.points),
        nominal_width_m: entity.nominal_width_m,
        nominal_height_m: entity.nominal_height_m,
      };
    case "prefab":
      return {
        ...common,
        category: entity.category,
        asset_id: entity.asset_id,
        x_m: entity.x_m,
        z_m: entity.z_m,
        rotation_deg: entity.rotation_deg,
        scale: entity.scale,
        frontage_road_id: entity.frontage_road_id,
        terrain_pad: { ...entity.terrain_pad },
      };
    case "vegetation":
      return {
        ...common,
        vegetation_type: entity.vegetation_type,
        asset_id: entity.asset_id,
        x_m: entity.x_m,
        z_m: entity.z_m,
        rotation_deg: entity.rotation_deg,
        scale: entity.scale,
        source_region_id: entity.source_region_id,
      };
  }
}

function requireSchemaVersion(value: unknown): 1 | 2 | 3 | 4 {
  if (value !== 1 && value !== 2 && value !== 3 && value !== 4) {
    throw new ContractError("unsupported scenery project schema version");
  }
  return value;
}

function parseWorld(value: unknown): ProjectWorld {
  const world = requireRecord(value, "world");
  requireExactKeys(world, ["width_m", "depth_m", "terrain_spacing_m"], "world");
  return {
    width_m: requirePositiveNumber(world.width_m, "world.width_m"),
    depth_m: requirePositiveNumber(world.depth_m, "world.depth_m"),
    terrain_spacing_m: requirePositiveNumber(world.terrain_spacing_m, "world.terrain_spacing_m"),
  };
}

function parseSources(value: unknown, version: 1 | 2 | 3 | 4): ProjectSources {
  const sources = requireRecord(value, "sources");
  const catalogKey = version >= 3 ? "asset_catalog" : "prefab_catalog";
  requireExactKeys(
    sources,
    ["terrain_npy", "terrain_descriptor", "vegetation", "county_features", catalogKey],
    "sources",
  );
  return {
    terrain_npy: requireNonEmptyString(sources.terrain_npy, "sources.terrain_npy"),
    terrain_descriptor: requireNonEmptyString(sources.terrain_descriptor, "sources.terrain_descriptor"),
    vegetation: optionalSource(sources.vegetation, "sources.vegetation"),
    county_features: optionalSource(sources.county_features, "sources.county_features"),
    asset_catalog: optionalSource(sources[catalogKey], `sources.${catalogKey}`),
  };
}

function parseFingerprint(value: unknown, world: ProjectWorld): TerrainFingerprint {
  const fingerprint = requireRecord(value, "terrain_fingerprint");
  const keys = [
    "sha256", "world_width_m", "world_depth_m", "spacing_m", "cell_count_x", "cell_count_z",
    "point_count_x", "point_count_z",
  ] as const;
  requireExactKeys(fingerprint, keys, "terrain_fingerprint");
  const sha256 = requireNonEmptyString(fingerprint.sha256, "terrain_fingerprint.sha256");
  if (!/^[0-9a-f]{64}$/.test(sha256)) {
    throw new ContractError("terrain_fingerprint.sha256 must be 64 lowercase hexadecimal characters");
  }
  const result: TerrainFingerprint = {
    sha256,
    world_width_m: requirePositiveNumber(fingerprint.world_width_m, "terrain_fingerprint.world_width_m"),
    world_depth_m: requirePositiveNumber(fingerprint.world_depth_m, "terrain_fingerprint.world_depth_m"),
    spacing_m: requirePositiveNumber(fingerprint.spacing_m, "terrain_fingerprint.spacing_m"),
    cell_count_x: requirePositiveInteger(fingerprint.cell_count_x, "terrain_fingerprint.cell_count_x"),
    cell_count_z: requirePositiveInteger(fingerprint.cell_count_z, "terrain_fingerprint.cell_count_z"),
    point_count_x: requirePositiveInteger(fingerprint.point_count_x, "terrain_fingerprint.point_count_x"),
    point_count_z: requirePositiveInteger(fingerprint.point_count_z, "terrain_fingerprint.point_count_z"),
  };
  if (
    result.point_count_x !== result.cell_count_x + 1
    || result.point_count_z !== result.cell_count_z + 1
    || !isClose(result.world_width_m, result.cell_count_x * result.spacing_m)
    || !isClose(result.world_depth_m, result.cell_count_z * result.spacing_m)
    || !isClose(world.width_m, result.world_width_m)
    || !isClose(world.depth_m, result.world_depth_m)
    || !isClose(world.terrain_spacing_m, result.spacing_m)
  ) {
    throw new ContractError("terrain_fingerprint is dimensionally incompatible with the scenery world");
  }
  return result;
}

function parsePlace(value: unknown, world: WorldBounds, index: number): PlaceRegion {
  const item = requireRecord(value, `places[${String(index)}]`);
  requireExactKeys(item, ["id", "name", "place_type", "points", "visible", "locked"], `places[${String(index)}]`);
  const result: PlaceRegion = {
    ...parseCommon(item, `places[${String(index)}]`),
    kind: "place",
    place_type: requireEnum(item.place_type, PLACE_TYPES, `places[${String(index)}].place_type`),
    points: parsePoints(item.points, `places[${String(index)}].points`),
  };
  validateEntity(result, world);
  return result;
}

function parseLandUse(value: unknown, world: WorldBounds, index: number): LandUseRegion {
  const item = requireRecord(value, `land_use_regions[${String(index)}]`);
  requireExactKeys(item, ["id", "name", "land_use_type", "points", "visible", "locked"], `land_use_regions[${String(index)}]`);
  const result: LandUseRegion = {
    ...parseCommon(item, `land_use_regions[${String(index)}]`),
    kind: "land_use",
    land_use_type: requireEnum(item.land_use_type, LAND_USE_TYPES, `land_use_regions[${String(index)}].land_use_type`),
    points: parsePoints(item.points, `land_use_regions[${String(index)}].points`),
  };
  validateEntity(result, world);
  return result;
}

function parseRoad(value: unknown, world: WorldBounds, index: number): Road {
  const item = requireRecord(value, `roads[${String(index)}]`);
  requireExactKeys(item, ["id", "name", "points", "width_m", "road_class", "surface", "visible", "locked"], `roads[${String(index)}]`);
  const result: Road = {
    ...parseCommon(item, `roads[${String(index)}]`),
    kind: "road",
    points: parsePoints(item.points, `roads[${String(index)}].points`),
    width_m: requirePositiveNumber(item.width_m, `roads[${String(index)}].width_m`),
    road_class: requireEnum(item.road_class, ROAD_CLASSES, `roads[${String(index)}].road_class`),
    surface: requireEnum(item.surface, ROAD_SURFACES, `roads[${String(index)}].surface`),
  };
  validateEntity(result, world);
  return result;
}

function parseLinear(value: unknown, world: WorldBounds, index: number): LinearFeature {
  const item = requireRecord(value, `linear_features[${String(index)}]`);
  requireExactKeys(
    item,
    ["id", "name", "feature_type", "points", "nominal_width_m", "nominal_height_m", "visible", "locked"],
    `linear_features[${String(index)}]`,
  );
  if (item.feature_type !== "hedgerow") throw new ContractError("linear feature type must be hedgerow");
  const result: LinearFeature = {
    ...parseCommon(item, `linear_features[${String(index)}]`),
    kind: "linear_feature",
    feature_type: "hedgerow",
    points: parsePoints(item.points, `linear_features[${String(index)}].points`),
    nominal_width_m: requirePositiveNumber(item.nominal_width_m, `linear_features[${String(index)}].nominal_width_m`),
    nominal_height_m: requirePositiveNumber(item.nominal_height_m, `linear_features[${String(index)}].nominal_height_m`),
  };
  validateEntity(result, world);
  return result;
}

function parsePrefab(
  value: unknown,
  world: WorldBounds,
  roadIds: ReadonlySet<string>,
  version: 1 | 2 | 3 | 4,
  index: number,
): PrefabInstance {
  const context = `prefab_instances[${String(index)}]`;
  const item = requireRecord(value, context);
  const keys = [
    "id", "name", "category", "asset_id", "x_m", "z_m", "rotation_deg", "scale",
    "frontage_road_id", "visible", "locked",
  ];
  if (version >= 2) keys.push("terrain_pad");
  requireExactKeys(item, keys, context);
  const result: PrefabInstance = {
    ...parseCommon(item, context),
    kind: "prefab",
    category: requireNonEmptyString(item.category, `${context}.category`),
    asset_id: requireNonEmptyString(item.asset_id, `${context}.asset_id`),
    x_m: requireFiniteNumber(item.x_m, `${context}.x_m`),
    z_m: requireFiniteNumber(item.z_m, `${context}.z_m`),
    rotation_deg: requireFiniteNumber(item.rotation_deg, `${context}.rotation_deg`),
    scale: requirePositiveNumber(item.scale, `${context}.scale`),
    frontage_road_id: optionalUuid(item.frontage_road_id, `${context}.frontage_road_id`),
    terrain_pad: version === 1 ? { ...DEFAULT_TERRAIN_PAD } : parseTerrainPad(item.terrain_pad, `${context}.terrain_pad`),
  };
  validateEntity(result, world, roadIds);
  return result;
}

function parseVegetation(value: unknown, world: WorldBounds, index: number): VegetationInstance {
  const context = `vegetation_instances[${String(index)}]`;
  const item = requireRecord(value, context);
  requireExactKeys(
    item,
    ["id", "name", "visible", "locked", "vegetation_type", "asset_id", "x_m", "z_m", "rotation_deg", "scale", "source_region_id"],
    context,
  );
  const result: VegetationInstance = {
    ...parseCommon(item, context),
    kind: "vegetation",
    vegetation_type: requireEnum(item.vegetation_type, VEGETATION_TYPES, `${context}.vegetation_type`),
    asset_id: requireNonEmptyString(item.asset_id, `${context}.asset_id`),
    x_m: requireFiniteNumber(item.x_m, `${context}.x_m`),
    z_m: requireFiniteNumber(item.z_m, `${context}.z_m`),
    rotation_deg: requireFiniteNumber(item.rotation_deg, `${context}.rotation_deg`),
    scale: requirePositiveNumber(item.scale, `${context}.scale`),
    source_region_id: optionalUuid(item.source_region_id, `${context}.source_region_id`),
  };
  validateEntity(result, world);
  return result;
}

function parseTerrainPad(value: unknown, context: string): TerrainPad {
  const pad = requireRecord(value, context);
  requireExactKeys(pad, ["enabled", "width_m", "depth_m", "blend_m", "target_mode"], context);
  if (pad.target_mode !== "base_terrain_at_origin") {
    throw new ContractError(`${context}.target_mode is unsupported`);
  }
  return {
    enabled: requireBoolean(pad.enabled, `${context}.enabled`),
    width_m: requirePositiveNumber(pad.width_m, `${context}.width_m`),
    depth_m: requirePositiveNumber(pad.depth_m, `${context}.depth_m`),
    blend_m: requireNonNegativeNumber(pad.blend_m, `${context}.blend_m`),
    target_mode: "base_terrain_at_origin",
  };
}

function parseCommon(value: Record<string, unknown>, context: string) {
  return {
    id: requireUuid(value.id, `${context}.id`),
    name: requireNonEmptyString(value.name, `${context}.name`),
    visible: requireBoolean(value.visible, `${context}.visible`),
    locked: requireBoolean(value.locked, `${context}.locked`),
  } as const;
}

function parsePoints(value: unknown, context: string): readonly PointTuple[] {
  return requireArray(value, context).map((rawPoint, index) => {
    if (!Array.isArray(rawPoint) || rawPoint.length !== 2) {
      throw new ContractError(`${context}[${String(index)}] must be [x_m, z_m]`);
    }
    return [
      requireFiniteNumber(rawPoint[0], `${context}[${String(index)}].x`),
      requireFiniteNumber(rawPoint[1], `${context}[${String(index)}].z`),
    ] as const;
  });
}

function parseCollection<T>(
  value: unknown,
  context: string,
  parser: (item: unknown, index: number) => T,
): readonly T[] {
  return requireArray(value, context).map(parser);
}

function optionalSource(value: unknown, context: string): string | null {
  return value === null ? null : requireNonEmptyString(value, context);
}

function optionalUuid(value: unknown, context: string): string | null {
  return value === null ? null : requireUuid(value, context);
}

function requirePositiveInteger(value: unknown, context: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new ContractError(`${context} must be a positive integer`);
  }
  return value;
}

function assertUniqueIds(entities: readonly AuthoredEntity[]): void {
  const ids = new Set<string>();
  for (const entity of entities) {
    if (ids.has(entity.id)) throw new ContractError(`duplicate authored object id: ${entity.id}`);
    ids.add(entity.id);
  }
}

function copyPoints(points: readonly PointTuple[]): number[][] {
  return points.map(([x, z]) => [x, z]);
}

function isClose(left: number, right: number): boolean {
  return Math.abs(left - right) <= Math.max(1e-6, 1e-9 * Math.max(Math.abs(left), Math.abs(right)));
}
