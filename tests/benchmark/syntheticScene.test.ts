import { describe, expect, it } from "vitest";
import {
  BENCHMARK_PREFAB_COUNT,
  BENCHMARK_ROAD_COUNT,
  BENCHMARK_SHRUB_COUNT,
  BENCHMARK_TREE_COUNT,
  BENCHMARK_VEGETATION_COUNT,
  benchmarkCounts,
  syntheticBenchmarkDocument,
} from "../../src/benchmark/syntheticScene";
import { ProjectModel } from "../../src/model/ProjectModel";

describe("seeded Polygon County benchmark generator", () => {
  it("is deterministic and preserves the exact full workload", () => {
    const first = syntheticBenchmarkDocument();
    const second = syntheticBenchmarkDocument();
    expect(second).toEqual(first);
    const model = ProjectModel.fromDocument(first);
    expect(benchmarkCounts(model)).toEqual({
      roads: BENCHMARK_ROAD_COUNT,
      prefabs: BENCHMARK_PREFAB_COUNT,
      trees: BENCHMARK_TREE_COUNT,
      shrubs: BENCHMARK_SHRUB_COUNT,
      vegetation: BENCHMARK_VEGETATION_COUNT,
    });
    expect(new Set(model.vegetationInstances().map((entity) => entity.id)).size).toBe(BENCHMARK_VEGETATION_COUNT);
  }, 15_000);

  it("changes deterministically with the seed without reducing counts", () => {
    const left = syntheticBenchmarkDocument(1);
    const right = syntheticBenchmarkDocument(2);
    expect(left.vegetation_instances[0]).not.toEqual(right.vegetation_instances[0]);
    expect(right.vegetation_instances).toHaveLength(BENCHMARK_VEGETATION_COUNT);
  });

  it("does not encode a fixed 10 km extent into the normalized model", () => {
    const source = syntheticBenchmarkDocument();
    const document = {
      ...source,
      world: { width_m: 60_000, depth_m: 60_000, terrain_spacing_m: 300 },
      terrain_fingerprint: {
        ...source.terrain_fingerprint,
        world_width_m: 60_000,
        world_depth_m: 60_000,
        spacing_m: 300,
      },
      roads: [],
      prefab_instances: [],
      vegetation_instances: [],
    };
    const model = ProjectModel.fromDocument(document);
    expect(model.bounds).toEqual({ widthM: 60_000, depthM: 60_000 });
    expect(model.size).toBe(0);
  });
});
