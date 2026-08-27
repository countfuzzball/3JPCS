import { AssetCatalog } from "../model/assetCatalog";
import type { PrefabInstance, Road, VegetationInstance, VegetationType } from "../model/entities";
import { ProjectModel } from "../model/ProjectModel";
import type { ProjectDocumentV4 } from "../model/projectDto";
import { parseTerrainDescriptor } from "../model/terrainDescriptor";
import { TerrainReference } from "../terrain/TerrainReference";

export const BENCHMARK_SEED = 0x5eedc0de;
export const BENCHMARK_ROAD_COUNT = 309;
export const BENCHMARK_PREFAB_COUNT = 279;
export const BENCHMARK_TREE_COUNT = 4_870;
export const BENCHMARK_SHRUB_COUNT = 27_628;
export const BENCHMARK_VEGETATION_COUNT = BENCHMARK_TREE_COUNT + BENCHMARK_SHRUB_COUNT;

export interface SyntheticBenchmarkScene {
  readonly model: ProjectModel;
  readonly terrain: TerrainReference;
  readonly catalog: AssetCatalog;
  readonly constructionAndValidationMs: number;
  readonly densePick: { readonly x: number; readonly z: number; readonly id: string };
  readonly sparsePick: { readonly x: number; readonly z: number; readonly id: string };
  readonly moveId: string;
  readonly padPrefabId: string;
}

export function syntheticBenchmarkDocument(seed = BENCHMARK_SEED): ProjectDocumentV4 {
  const random = mulberry32(seed);
  const roads: Record<string, unknown>[] = [];
  for (let index = 0; index < BENCHMARK_ROAD_COUNT; index += 1) {
    const horizontal = index % 2 === 0;
    const band = (Math.floor(index / 2) + 1) / (Math.ceil(BENCHMARK_ROAD_COUNT / 2) + 1);
    const points = Array.from({ length: 6 }, (_, pointIndex) => {
      const along = pointIndex / 5 * 10_000;
      const cross = band * 10_000 + (random() - 0.5) * 180;
      return horizontal ? [along, clampWorld(cross)] : [clampWorld(cross), along];
    });
    roads.push({
      id: benchmarkUuid(1, index + 1),
      name: `Benchmark Road ${String(index + 1)}`,
      visible: true,
      locked: false,
      points,
      width_m: index % 5 === 0 ? 9 : 6,
      road_class: index % 7 === 0 ? "county_road" : "local_road",
      surface: index % 4 === 0 ? "paved" : "gravel",
    });
  }

  const prefabs: Record<string, unknown>[] = [];
  for (let index = 0; index < BENCHMARK_PREFAB_COUNT; index += 1) {
    const assetId = index % 3 === 0 ? "farmhouse" : index % 3 === 1 ? "cottage" : "barn";
    prefabs.push({
      id: benchmarkUuid(2, index + 1),
      name: `Benchmark ${assetId} ${String(index + 1)}`,
      visible: true,
      locked: false,
      category: assetId === "barn" ? "farm" : "house",
      asset_id: assetId,
      x_m: 150 + (index * 347 % 9_700),
      z_m: 150 + (index * 613 % 9_700),
      rotation_deg: random() * 720 - 180,
      scale: 0.85 + random() * 0.35,
      frontage_road_id: null,
      terrain_pad: {
        enabled: false,
        width_m: assetId === "barn" ? 20 : 12,
        depth_m: assetId === "barn" ? 14 : 10,
        blend_m: 8,
        target_mode: "base_terrain_at_origin",
      },
    });
  }

  const vegetation: Record<string, unknown>[] = [];
  const clusterCenters = Array.from({ length: 18 }, (_, index) => ({
    x: 500 + (index * 2_137 % 9_000),
    z: 500 + (index * 3_761 % 9_000),
  }));
  for (let index = 0; index < BENCHMARK_VEGETATION_COUNT; index += 1) {
    const tree = index < BENCHMARK_TREE_COUNT;
    const vegetationType: VegetationType = tree
      ? index % 5 === 0 ? "scattered_tree" : "forest_tree"
      : "shrub";
    const assetId = vegetationType === "shrub"
      ? index % 2 === 0 ? "hazel_shrub" : "gorse_shrub"
      : index % 3 === 0 ? "pine_tree" : "oak_tree";
    const mostlyClustered = index < BENCHMARK_VEGETATION_COUNT - 1 && random() < 0.99;
    const center = clusterCenters[index % clusterCenters.length];
    const x = mostlyClustered && center
      ? center.x + triangular(random) * 420
      : 40 + random() * 9_920;
    const z = mostlyClustered && center
      ? center.z + triangular(random) * 420
      : 40 + random() * 9_920;
    vegetation.push({
      id: benchmarkUuid(3, index + 1),
      name: `Benchmark ${assetId} ${String(index + 1)}`,
      visible: true,
      locked: false,
      vegetation_type: vegetationType,
      asset_id: assetId,
      x_m: clampWorld(x),
      z_m: clampWorld(z),
      rotation_deg: random() * 720 - 180,
      scale: vegetationType === "shrub" ? 0.65 + random() * 0.8 : 0.8 + random() * 0.55,
      source_region_id: benchmarkUuid(9, index % 96 + 1),
    });
  }

  return {
    format: "polygon-county-scenery-project",
    schema_version: 4,
    name: `Polygon County seeded benchmark ${seed.toString(16)}`,
    world: { width_m: 10_000, depth_m: 10_000, terrain_spacing_m: 50 },
    sources: {
      terrain_npy: "benchmark-terrain.npy",
      terrain_descriptor: "benchmark-terrain.json",
      vegetation: null,
      county_features: null,
      asset_catalog: "benchmark-assets.json",
    },
    terrain_fingerprint: {
      sha256: seed.toString(16).padStart(64, "0"),
      world_width_m: 10_000,
      world_depth_m: 10_000,
      spacing_m: 50,
      cell_count_x: 200,
      cell_count_z: 200,
      point_count_x: 201,
      point_count_z: 201,
    },
    places: [],
    land_use_regions: [],
    roads,
    linear_features: [],
    prefab_instances: prefabs,
    vegetation_instances: vegetation,
  };
}

export function buildSyntheticBenchmarkScene(seed = BENCHMARK_SEED): SyntheticBenchmarkScene {
  const start = performance.now();
  const document = syntheticBenchmarkDocument(seed);
  const model = ProjectModel.fromDocument(document);
  const terrain = syntheticBenchmarkTerrain(seed);
  const catalog = AssetCatalog.fromDocument({
    format: "polygon-county-asset-catalog",
    schema_version: 3,
    category_defaults: {
      house: { proxy: { width_m: 12, depth_m: 10, wall_height_m: 5 } },
      farm: { proxy: { width_m: 20, depth_m: 14, wall_height_m: 6 } },
      tree: { proxy: { width_m: 5, depth_m: 5, wall_height_m: 10 } },
      shrub: { proxy: { width_m: 2, depth_m: 2, wall_height_m: 2 } },
    },
    assets: {
      farmhouse: { category: "house", resource: "farmhouse.glb" },
      cottage: { category: "house", resource: "cottage.glb" },
      barn: { category: "farm", resource: "barn.glb" },
      oak_tree: { category: "tree", resource: "oak-tree.glb" },
      pine_tree: { category: "tree", resource: "pine-tree.glb" },
      hazel_shrub: { category: "shrub", resource: "hazel-shrub.glb" },
      gorse_shrub: { category: "shrub", resource: "gorse-shrub.glb" },
    },
  });
  const nativeVegetation = model.vegetationInstances();
  const dense = nativeVegetation[0];
  const sparse = nativeVegetation.at(-1);
  const firstPrefab = model.prefabInstances()[0];
  if (!dense || !sparse || !firstPrefab) throw new Error("synthetic benchmark scene is incomplete");
  return {
    model,
    terrain,
    catalog,
    constructionAndValidationMs: performance.now() - start,
    densePick: { x: dense.x_m, z: dense.z_m, id: dense.id },
    sparsePick: { x: sparse.x_m, z: sparse.z_m, id: sparse.id },
    moveId: dense.id,
    padPrefabId: firstPrefab.id,
  };
}

function syntheticBenchmarkTerrain(seed: number): TerrainReference {
  const pointCount = 201;
  const heights = new Float32Array(pointCount * pointCount);
  for (let z = 0; z < pointCount; z += 1) {
    for (let x = 0; x < pointCount; x += 1) {
      const wave = 50 + Math.sin((x + seed % 31) * 0.08) * 18 + Math.cos((z + seed % 17) * 0.065) * 16;
      heights[z * pointCount + x] = Math.fround(Math.max(10, Math.min(90, wave)));
    }
  }
  heights[0] = 10;
  heights[heights.length - 1] = 90;
  const descriptor = parseTerrainDescriptor({
    world_width_m: 10_000,
    world_depth_m: 10_000,
    terrain_spacing_m: 50,
    terrain_cells: { x: 200, z: 200, total: 40_000 },
    elevation_points: { x: 201, z: 201, total: 40_401 },
    minimum_elevation_m: 10,
    sea_level_m: 30,
    lowland_reference_elevation_m: 50,
    maximum_elevation_m: 90,
    uint16_reference_values: { sea_level: 16_384, lowland_reference: 32_768 },
    vertical_encoding: "uint16 maps linearly from minimum_elevation_m to maximum_elevation_m",
    grid_layout: "Rows increase along +Z; columns increase along +X",
    cell_diagonal: "northwest to southeast",
  });
  return new TerrainReference(descriptor, heights, seed.toString(16).padStart(64, "0"));
}

function mulberry32(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let mixed = value;
    mixed = Math.imul(mixed ^ mixed >>> 15, mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ mixed >>> 7, mixed | 61);
    return ((mixed ^ mixed >>> 14) >>> 0) / 4_294_967_296;
  };
}

function triangular(random: () => number): number {
  return (random() + random() + random()) / 3 - 0.5;
}

function clampWorld(value: number): number {
  return Math.max(0, Math.min(10_000, value));
}

function benchmarkUuid(namespace: number, index: number): string {
  return `${namespace.toString(16).padStart(8, "0")}-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
}

export function benchmarkCounts(model: ProjectModel): {
  readonly roads: number;
  readonly prefabs: number;
  readonly trees: number;
  readonly shrubs: number;
  readonly vegetation: number;
} {
  const vegetation = model.vegetationInstances();
  return {
    roads: model.list("road").length,
    prefabs: model.prefabInstances().length,
    trees: vegetation.filter((entity) => entity.vegetation_type !== "shrub").length,
    shrubs: vegetation.filter((entity) => entity.vegetation_type === "shrub").length,
    vegetation: vegetation.length,
  };
}

export function benchmarkMoveTargets(model: ProjectModel, id: string): {
  readonly withinChunk: VegetationInstance;
  readonly acrossChunk: VegetationInstance;
} {
  const entity = model.get(id);
  if (entity?.kind !== "vegetation") throw new Error("benchmark vegetation target is missing");
  return {
    withinChunk: { ...entity, x_m: Math.min(model.world.width_m, entity.x_m + 1) },
    acrossChunk: { ...entity, x_m: Math.min(model.world.width_m, entity.x_m + 600) },
  };
}

export function benchmarkPadChange(model: ProjectModel, id: string): { readonly before: PrefabInstance; readonly after: PrefabInstance } {
  const entity = model.get(id);
  if (entity?.kind !== "prefab") throw new Error("benchmark prefab target is missing");
  return {
    before: entity,
    after: {
      ...entity,
      terrain_pad: { ...entity.terrain_pad, enabled: true, width_m: 24, depth_m: 18, blend_m: 10 },
    },
  };
}

export function benchmarkRoads(model: ProjectModel): readonly Road[] {
  return model.list("road").filter((entity): entity is Road => entity.kind === "road");
}
