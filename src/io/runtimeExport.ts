import type { AssetCatalog } from "../model/assetCatalog";
import type { ProjectModel } from "../model/ProjectModel";
import { COORDINATE_SYSTEM } from "../model/references";
import type { WorkingTerrain } from "../terrain/WorkingTerrain";

export async function runtimeSceneryV2Document(
  model: ProjectModel,
  terrain: WorkingTerrain,
  catalog: AssetCatalog | null,
  allowVegetationOmission = false,
): Promise<Record<string, unknown>> {
  model.validate();
  if (model.list("vegetation").length > 0 && !allowVegetationOmission) {
    throw new Error("Runtime scenery v2 cannot represent native vegetation instances; export runtime scenery v3 or explicitly confirm legacy omission");
  }
  return runtimeBase(model, terrain, catalog, 2);
}

export async function runtimeSceneryV3Document(
  model: ProjectModel,
  terrain: WorkingTerrain,
  catalog: AssetCatalog | null,
): Promise<Record<string, unknown>> {
  model.validate();
  const base = await runtimeBase(model, terrain, catalog, 3);
  return {
    ...base,
    vegetation_instances: model.vegetationInstances().map((entity) => ({
      id: entity.id,
      name: entity.name,
      visible: entity.visible,
      vegetation_type: entity.vegetation_type,
      asset_id: entity.asset_id,
      x_m: entity.x_m,
      z_m: entity.z_m,
      terrain_y_m: terrain.heightAt(entity.x_m, entity.z_m),
      rotation_deg: normalizeDegrees(entity.rotation_deg),
      scale: entity.scale,
      source_region_id: entity.source_region_id,
      asset_status: catalog?.definition(entity.asset_id) ? "resolved" : "missing",
    })),
  };
}

async function runtimeBase(
  model: ProjectModel,
  terrain: WorkingTerrain,
  catalog: AssetCatalog | null,
  schemaVersion: 2 | 3,
): Promise<Record<string, unknown>> {
  assertCompatible(model, terrain);
  return {
    format: "polygon-county-runtime-scenery",
    schema_version: schemaVersion,
    coordinate_system: COORDINATE_SYSTEM,
    world: { ...model.world },
    terrain_float32_sha256: await terrain.sha256(),
    place_regions: model.list("place").map((entity) => {
      if (entity.kind !== "place") throw new Error("normalized place collection is inconsistent");
      return { id: entity.id, name: entity.name, place_type: entity.place_type, points: copyPoints(entity.points), visible: entity.visible };
    }),
    land_use_regions: model.list("land_use").map((entity) => {
      if (entity.kind !== "land_use") throw new Error("normalized land-use collection is inconsistent");
      return { id: entity.id, name: entity.name, land_use_type: entity.land_use_type, points: copyPoints(entity.points), visible: entity.visible };
    }),
    roads: model.list("road").map((entity) => {
      if (entity.kind !== "road") throw new Error("normalized road collection is inconsistent");
      return {
        id: entity.id, name: entity.name, points: copyPoints(entity.points), width_m: entity.width_m,
        road_class: entity.road_class, surface: entity.surface, elevation_mode: "follow_terrain", visible: entity.visible,
      };
    }),
    hedgerows: model.list("linear_feature").map((entity) => {
      if (entity.kind !== "linear_feature") throw new Error("normalized linear-feature collection is inconsistent");
      return {
        id: entity.id, name: entity.name, points: copyPoints(entity.points), nominal_width_m: entity.nominal_width_m,
        nominal_height_m: entity.nominal_height_m, visible: entity.visible,
      };
    }),
    prefab_instances: model.prefabInstances().map((entity) => ({
      id: entity.id,
      name: entity.name,
      visible: entity.visible,
      asset_id: entity.asset_id,
      category: entity.category,
      x_m: entity.x_m,
      z_m: entity.z_m,
      terrain_y_m: terrain.heightAt(entity.x_m, entity.z_m),
      rotation_deg: normalizeDegrees(entity.rotation_deg),
      scale: entity.scale,
      frontage_road_id: entity.frontage_road_id,
      asset_status: catalog?.definition(entity.asset_id) ? "resolved" : "missing",
    })),
  };
}

function copyPoints(points: readonly (readonly [number, number])[]): number[][] {
  return points.map(([x, z]) => [x, z]);
}

function normalizeDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}

function assertCompatible(model: ProjectModel, terrain: WorkingTerrain): void {
  if (
    model.world.width_m !== terrain.worldWidthM
    || model.world.depth_m !== terrain.worldDepthM
    || model.world.terrain_spacing_m !== terrain.spacingM
  ) throw new Error("runtime terrain is incompatible with scenery project");
}
