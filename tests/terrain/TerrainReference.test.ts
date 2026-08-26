import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { importTerrainSources } from "../../src/io/terrainImport";
import { TerrainReference } from "../../src/terrain/TerrainReference";
import { fixtureBytes, fixtureDescriptor, fixtureJson, fixtureTerrain } from "../helpers/fixtures";

interface GoldenSample { readonly x_m: number; readonly z_m: number; readonly height_m: number }
interface TerrainGolden {
  readonly samples: readonly GoldenSample[];
  readonly slopes_deg: { readonly upper_triangle: number; readonly lower_triangle: number };
  readonly source_sha256: Record<string, string>;
}

describe("immutable terrain reference and NW-SE queries", () => {
  it("matches the Python-derived height and slope goldens on both triangles and inclusive edges", async () => {
    const terrain = await fixtureTerrain();
    const golden = await fixtureJson<TerrainGolden>("terrain-golden.json");
    for (const sample of golden.samples) {
      expect(terrain.heightAt(sample.x_m, sample.z_m)).toBeCloseTo(sample.height_m, 10);
    }
    expect(terrain.slopeAt(8, 2)).toBeCloseTo(golden.slopes_deg.upper_triangle, 10);
    expect(terrain.slopeAt(2, 8)).toBeCloseTo(golden.slopes_deg.lower_triangle, 10);
    expect(terrain.heightAt(20, 0)).toBe(20);
    expect(terrain.heightAt(0, 20)).toBe(50);
  });

  it("rejects non-finite and outside queries", async () => {
    const terrain = await fixtureTerrain();
    expect(() => terrain.heightAt(-0.01, 2)).toThrow(/outside/i);
    expect(() => terrain.slopeAt(Number.NaN, 2)).toThrow(/finite/i);
  });

  it("copies its authoritative base and returns copies to callers", async () => {
    const descriptor = await fixtureDescriptor();
    const source = new Float32Array([0, 10, 20, 20, 40, 60, 50, 70, 90]);
    const terrain = new TerrainReference(descriptor, source, "a".repeat(64));
    source[0] = 99;
    const exposedCopy = terrain.copyHeights();
    exposedCopy[0] = 77;
    expect(terrain.heightAtGrid(0, 0)).toBe(0);
  });

  it("hashes the original NPY bytes and records portable source names", async () => {
    const npyBytes = await fixtureBytes("terrain-v1-c.npy");
    const descriptorText = JSON.stringify(await fixtureJson("terrain-descriptor.json"));
    const npy = new File([npyBytes], "terrain-v1-c.npy");
    const descriptor = new File([descriptorText], "terrain-descriptor.json", { type: "application/json" });
    const terrain = await importTerrainSources({ npy, descriptor });
    const expected = createHash("sha256").update(new Uint8Array(npyBytes)).digest("hex");
    expect(terrain.sourceSha256).toBe(expected);
  });

  it("rejects descriptor-incompatible shapes and endpoint excursions", async () => {
    const descriptor = await fixtureDescriptor();
    expect(() => new TerrainReference(descriptor, new Float32Array(8), "a".repeat(64))).toThrow(/shape/i);
    const heights = new Float32Array([0, 10, 20, 20, 40, 60, 50, 70, 100.001]);
    expect(() => new TerrainReference(descriptor, heights, "a".repeat(64))).toThrow(/endpoints/i);
  });
});
