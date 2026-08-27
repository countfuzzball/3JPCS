import { COORDINATE_SYSTEM } from "../../src/model/references";

export const REFERENCE_PROJECT_ID = "11111111-1111-4111-8111-111111111111";
export const REFERENCE_ROAD_ID = "22222222-2222-4222-8222-222222222222";
export const REFERENCE_PLACE_ID = "33333333-3333-4333-8333-333333333333";
export const REFERENCE_BUILDING_ID = "44444444-4444-4444-8444-444444444444";
export const REFERENCE_REGION_ID = "55555555-5555-4555-8555-555555555555";

export function vegetationDocument() {
  return {
    schema_version: 1,
    project_id: REFERENCE_PROJECT_ID,
    project_name: "County",
    coordinate_system: COORDINATE_SYSTEM,
    generated_object_count: 1,
    objects: [{
      type: "forest_tree", model_or_species: "oak", x_m: 4, z_m: 5, terrain_y_m: 10,
      rotation_deg: 33, scale: 1, source_region_id: REFERENCE_REGION_ID,
    }],
  };
}

export function countyDocument() {
  return {
    format: "polygon-county-runtime-features",
    schema_version: 3,
    export_batch_id: "66666666-6666-4666-8666-666666666666",
    project_id: REFERENCE_PROJECT_ID,
    project_name: "County",
    world_width_m: 20,
    world_depth_m: 20,
    coordinate_system: COORDINATE_SYSTEM,
    settlement_regions: [{ id: REFERENCE_PLACE_ID, name: "Place", visible: true, points: [[1, 1], [9, 1], [5, 9]] }],
    roads: [{
      id: REFERENCE_ROAD_ID, name: "Road", visible: true, points: [[1, 2], [18, 2]], width_m: 5,
      surface: "gravel", elevation_mode: "follow_terrain",
    }],
    buildings: [{
      id: REFERENCE_BUILDING_ID, name: "House", visible: true, building_type: "residential_2storey", asset_id: "house",
      x_m: 5, z_m: 5, terrain_y_m: 13, rotation_deg: 90, footprint_width_m: 4, footprint_depth_m: 8,
      frontage_road_id: REFERENCE_ROAD_ID,
    }],
  };
}
