import { rotateLocalPoint } from "./coordinates";
import {
  DEFAULT_TERRAIN_PAD,
  ROAD_SURFACES,
  VEGETATION_TYPES,
  requireArray,
  requireBoolean,
  requireEnum,
  requireExactKeys,
  requireFiniteNumber,
  requireNonEmptyString,
  requirePositiveNumber,
  requireRecord,
  requireUuid,
  validatePointList,
  type AuthoredEntity,
  type PointTuple,
  type PrefabInstance,
  type Road,
  type WorldBounds,
} from "./entities";
import { ContractError } from "./errors";
import type { ProjectModel } from "./ProjectModel";

export const COORDINATE_SYSTEM = "X east/right, terrain Y elevation, Z south/down; metres";

export interface VegetationReferenceObject {
  readonly type: typeof VEGETATION_TYPES[number];
  readonly model_or_species: string;
  readonly x_m: number;
  readonly z_m: number;
  readonly terrain_y_m: number;
  readonly rotation_deg: number;
  readonly scale: number;
  readonly source_region_id: string;
}

export interface VegetationReference {
  readonly project_id: string;
  readonly project_name: string;
  readonly objects: readonly VegetationReferenceObject[];
}

export interface CountySettlementReference {
  readonly id: string;
  readonly name: string;
  readonly visible: boolean;
  readonly points: readonly PointTuple[];
}

export interface CountyRoadReference extends CountySettlementReference {
  readonly width_m: number;
  readonly surface: string;
  readonly elevation_mode: "follow_terrain";
}

export interface CountyBuildingReference {
  readonly id: string;
  readonly name: string;
  readonly visible: boolean;
  readonly building_type: string;
  readonly asset_id: string | null;
  readonly x_m: number;
  readonly z_m: number;
  readonly terrain_y_m: number;
  readonly rotation_deg: number;
  readonly footprint_width_m: number;
  readonly footprint_depth_m: number;
  readonly frontage_road_id: string | null;
}

export interface CountyReference {
  readonly export_batch_id: string;
  readonly project_id: string;
  readonly project_name: string;
  readonly settlement_regions: readonly CountySettlementReference[];
  readonly roads: readonly CountyRoadReference[];
  readonly buildings: readonly CountyBuildingReference[];
}

export interface CountyConversion {
  readonly entities: readonly AuthoredEntity[];
  readonly warnings: readonly string[];
}

export function parseVegetationReference(value: unknown, world: WorldBounds): VegetationReference {
  const document = requireRecord(value, "vegetation");
  requireExactKeys(
    document,
    ["schema_version", "project_id", "project_name", "coordinate_system", "generated_object_count", "objects"],
    "vegetation",
  );
  if (document.schema_version !== 1) throw new ContractError("vegetation schema_version must be 1");
  if (document.coordinate_system !== COORDINATE_SYSTEM) throw new ContractError("vegetation coordinate_system is unsupported");
  const rawObjects = requireArray(document.objects, "vegetation.objects");
  if (document.generated_object_count !== rawObjects.length) {
    throw new ContractError("vegetation generated_object_count does not match objects");
  }
  const objects = rawObjects.map((raw, index): VegetationReferenceObject => {
    const context = `vegetation.objects[${String(index)}]`;
    const item = requireRecord(raw, context);
    requireExactKeys(
      item,
      ["type", "model_or_species", "x_m", "z_m", "terrain_y_m", "rotation_deg", "scale", "source_region_id"],
      context,
    );
    const x = requireFiniteNumber(item.x_m, `${context}.x_m`);
    const z = requireFiniteNumber(item.z_m, `${context}.z_m`);
    assertOriginInside(x, z, world, context);
    return Object.freeze({
      type: requireEnum(item.type, VEGETATION_TYPES, `${context}.type`),
      model_or_species: requireNonEmptyString(item.model_or_species, `${context}.model_or_species`),
      x_m: x,
      z_m: z,
      terrain_y_m: requireFiniteNumber(item.terrain_y_m, `${context}.terrain_y_m`),
      rotation_deg: requireFiniteNumber(item.rotation_deg, `${context}.rotation_deg`),
      scale: requirePositiveNumber(item.scale, `${context}.scale`),
      source_region_id: requireUuid(item.source_region_id, `${context}.source_region_id`),
    });
  });
  return Object.freeze({
    project_id: requireUuid(document.project_id, "vegetation.project_id"),
    project_name: requireNonEmptyString(document.project_name, "vegetation.project_name"),
    objects: Object.freeze(objects),
  });
}

export function parseCountyReference(value: unknown, world: WorldBounds): CountyReference {
  const document = requireRecord(value, "county features");
  requireExactKeys(document, [
    "format", "schema_version", "export_batch_id", "project_id", "project_name",
    "world_width_m", "world_depth_m", "coordinate_system", "settlement_regions", "roads", "buildings",
  ], "county features");
  if (document.format !== "polygon-county-runtime-features" || document.schema_version !== 3) {
    throw new ContractError("county features must use runtime schema v3");
  }
  if (document.coordinate_system !== COORDINATE_SYSTEM) throw new ContractError("county coordinate_system is unsupported");
  const width = requirePositiveNumber(document.world_width_m, "county.world_width_m");
  const depth = requirePositiveNumber(document.world_depth_m, "county.world_depth_m");
  if (Math.abs(width - world.widthM) > 1e-6 || Math.abs(depth - world.depthM) > 1e-6) {
    throw new ContractError("county world dimensions do not match terrain");
  }

  const settlements = requireArray(document.settlement_regions, "county.settlement_regions")
    .map((raw, index): CountySettlementReference => {
      const context = `settlement_regions[${String(index)}]`;
      const item = requireRecord(raw, context);
      requireExactKeys(item, ["id", "name", "visible", "points"], context);
      return Object.freeze({
        id: requireUuid(item.id, `${context}.id`),
        name: requireNonEmptyString(item.name, `${context}.name`),
        visible: requireBoolean(item.visible, `${context}.visible`),
        points: parseReferencePoints(item.points, 3, { widthM: width, depthM: depth }, `${context}.points`),
      });
    });
  const roads = requireArray(document.roads, "county.roads").map((raw, index): CountyRoadReference => {
    const context = `roads[${String(index)}]`;
    const item = requireRecord(raw, context);
    requireExactKeys(item, ["id", "name", "visible", "points", "width_m", "surface", "elevation_mode"], context);
    if (item.elevation_mode !== "follow_terrain") throw new ContractError(`${context} must follow terrain`);
    return Object.freeze({
      id: requireUuid(item.id, `${context}.id`),
      name: requireNonEmptyString(item.name, `${context}.name`),
      visible: requireBoolean(item.visible, `${context}.visible`),
      points: parseReferencePoints(item.points, 2, { widthM: width, depthM: depth }, `${context}.points`),
      width_m: requirePositiveNumber(item.width_m, `${context}.width_m`),
      surface: requireNonEmptyString(item.surface, `${context}.surface`),
      elevation_mode: "follow_terrain",
    });
  });
  const roadIds = new Set(roads.map((road) => road.id));
  const buildings = requireArray(document.buildings, "county.buildings").map((raw, index): CountyBuildingReference => {
    const context = `buildings[${String(index)}]`;
    const item = requireRecord(raw, context);
    requireExactKeys(item, [
      "id", "name", "visible", "building_type", "asset_id", "x_m", "z_m", "terrain_y_m",
      "rotation_deg", "footprint_width_m", "footprint_depth_m", "frontage_road_id",
    ], context);
    const x = requireFiniteNumber(item.x_m, `${context}.x_m`);
    const z = requireFiniteNumber(item.z_m, `${context}.z_m`);
    assertOriginInside(x, z, { widthM: width, depthM: depth }, context);
    const frontage = item.frontage_road_id === null ? null : requireUuid(item.frontage_road_id, `${context}.frontage_road_id`);
    if (frontage !== null && !roadIds.has(frontage)) throw new ContractError(`${context}.frontage_road_id does not resolve`);
    return Object.freeze({
      id: requireUuid(item.id, `${context}.id`),
      name: requireNonEmptyString(item.name, `${context}.name`),
      visible: requireBoolean(item.visible, `${context}.visible`),
      building_type: requireNonEmptyString(item.building_type, `${context}.building_type`),
      asset_id: item.asset_id === null ? null : requireNonEmptyString(item.asset_id, `${context}.asset_id`),
      x_m: x,
      z_m: z,
      terrain_y_m: requireFiniteNumber(item.terrain_y_m, `${context}.terrain_y_m`),
      rotation_deg: requireFiniteNumber(item.rotation_deg, `${context}.rotation_deg`),
      footprint_width_m: requirePositiveNumber(item.footprint_width_m, `${context}.footprint_width_m`),
      footprint_depth_m: requirePositiveNumber(item.footprint_depth_m, `${context}.footprint_depth_m`),
      frontage_road_id: frontage,
    });
  });
  assertUniqueCountyIds([...settlements, ...roads, ...buildings]);
  return Object.freeze({
    export_batch_id: requireUuid(document.export_batch_id, "county.export_batch_id"),
    project_id: requireUuid(document.project_id, "county.project_id"),
    project_name: requireNonEmptyString(document.project_name, "county.project_name"),
    settlement_regions: Object.freeze(settlements),
    roads: Object.freeze(roads),
    buildings: Object.freeze(buildings),
  });
}

export function convertCountyToNative(model: ProjectModel, county: CountyReference): CountyConversion {
  const warnings: string[] = [];
  const entities: AuthoredEntity[] = [];
  const existingIds = new Set(model.all().map((entity) => entity.id));
  for (const item of county.settlement_regions) {
    if (existingIds.has(item.id)) {
      warnings.push(`Skipped duplicate county object ${item.id}`);
      continue;
    }
    entities.push({
      kind: "place", id: item.id, name: item.name, visible: item.visible, locked: false,
      place_type: "village", points: item.points,
    });
    existingIds.add(item.id);
  }
  for (const item of county.roads) {
    if (existingIds.has(item.id)) {
      warnings.push(`Skipped duplicate county object ${item.id}`);
      continue;
    }
    const surface: Road["surface"] = ROAD_SURFACES.includes(item.surface as Road["surface"])
      ? item.surface as Road["surface"]
      : "gravel";
    entities.push({
      kind: "road", id: item.id, name: item.name, visible: item.visible, locked: false,
      points: item.points, width_m: item.width_m, road_class: "local_road", surface,
    });
    existingIds.add(item.id);
  }
  const roadIds = new Set([
    ...model.list("road").filter((entity): entity is Road => entity.kind === "road").map((road) => road.id),
    ...entities.filter((entity): entity is Road => entity.kind === "road").map((road) => road.id),
  ]);
  for (const item of county.buildings) {
    if (existingIds.has(item.id)) {
      warnings.push(`Skipped duplicate county object ${item.id}`);
      continue;
    }
    const assetId = item.asset_id ?? item.building_type;
    if (item.asset_id === null) warnings.push(`Building ${item.name} had no asset_id; using '${assetId}' as an unresolved asset`);
    const prefab: PrefabInstance = {
      kind: "prefab", id: item.id, name: item.name, visible: item.visible, locked: false,
      category: item.building_type, asset_id: assetId, x_m: item.x_m, z_m: item.z_m,
      rotation_deg: item.rotation_deg, scale: 1,
      frontage_road_id: item.frontage_road_id && roadIds.has(item.frontage_road_id) ? item.frontage_road_id : null,
      terrain_pad: { ...DEFAULT_TERRAIN_PAD },
    };
    entities.push(prefab);
    existingIds.add(item.id);
  }
  return { entities, warnings };
}

export function countyBuildingFootprint(building: CountyBuildingReference): readonly PointTuple[] {
  const halfWidth = building.footprint_width_m / 2;
  const halfDepth = building.footprint_depth_m / 2;
  return [
    { x: -halfWidth, z: -halfDepth }, { x: halfWidth, z: -halfDepth },
    { x: halfWidth, z: halfDepth }, { x: -halfWidth, z: halfDepth },
  ].map((point) => {
    const offset = rotateLocalPoint(point, building.rotation_deg);
    return [building.x_m + offset.x, building.z_m + offset.z] as PointTuple;
  });
}

function parseReferencePoints(value: unknown, minimum: number, world: WorldBounds, context: string): readonly PointTuple[] {
  const points = requireArray(value, context).map((raw, index) => {
    if (!Array.isArray(raw) || raw.length !== 2) throw new ContractError(`${context}[${String(index)}] must be [x_m, z_m]`);
    return [
      requireFiniteNumber(raw[0], `${context}[${String(index)}].x`),
      requireFiniteNumber(raw[1], `${context}[${String(index)}].z`),
    ] as PointTuple;
  });
  validatePointList(points, minimum, world, context);
  return Object.freeze(points);
}

function assertOriginInside(x: number, z: number, world: WorldBounds, context: string): void {
  if (x < 0 || x > world.widthM || z < 0 || z > world.depthM) throw new ContractError(`${context} lies outside the world`);
}

function assertUniqueCountyIds(items: readonly { readonly id: string }[]): void {
  const ids = new Set<string>();
  for (const item of items) {
    if (ids.has(item.id)) throw new ContractError(`duplicate county object id: ${item.id}`);
    ids.add(item.id);
  }
}
