import { describe, expect, it } from "vitest";
import { parseTerrainDescriptor } from "../../src/model/terrainDescriptor";
import { fixtureJson } from "../helpers/fixtures";

describe("terrain descriptor contract", () => {
  it("accepts the golden descriptor and its prototype arithmetic", async () => {
    const source = await fixtureJson<Record<string, unknown>>("terrain-descriptor.json");
    const descriptor = parseTerrainDescriptor(source);
    expect(descriptor.terrain_cells).toEqual({ x: 2, z: 2, total: 4 });
    expect(descriptor.elevation_points).toEqual({ x: 3, z: 3, total: 9 });
    expect(descriptor.uint16_reference_values).toEqual({ sea_level: 32768, lowland_reference: 34406 });
  });

  it("requires every top-level terrain field while tolerating documented future metadata", async () => {
    const source = await fixtureJson<Record<string, unknown>>("terrain-descriptor.json");
    delete source.cell_diagonal;
    expect(() => parseTerrainDescriptor(source)).toThrow(/missing.*cell_diagonal/i);
    source.cell_diagonal = "Each cell is divided from northwest to southeast.";
    source.future_note = "allowed at the top level";
    expect(parseTerrainDescriptor(source).cell_diagonal).toContain("northwest");
  });

  it("rejects grid arithmetic, exact nested fields, endpoint order, and reference-code mismatches", async () => {
    const base = await fixtureJson<Record<string, unknown>>("terrain-descriptor.json");
    expect(() => parseTerrainDescriptor({ ...base, world_width_m: 21 })).toThrow(/world_width/i);
    expect(() => parseTerrainDescriptor({
      ...base,
      terrain_cells: { x: 2, z: 2, total: 4, extra: 1 },
    })).toThrow(/exactly/i);
    expect(() => parseTerrainDescriptor({ ...base, sea_level_m: 101 })).toThrow(/elevation references/i);
    expect(() => parseTerrainDescriptor({
      ...base,
      uint16_reference_values: { sea_level: 1, lowland_reference: 34406 },
    })).toThrow(/sea_level is inconsistent/i);
  });

  it("requires the declared row, column, and cell-diagonal orientations", async () => {
    const base = await fixtureJson<Record<string, unknown>>("terrain-descriptor.json");
    expect(() => parseTerrainDescriptor({ ...base, grid_layout: "Rows increase north." })).toThrow(/rows increasing/i);
    expect(() => parseTerrainDescriptor({ ...base, cell_diagonal: "northeast to southwest" })).toThrow(/northwest/i);
  });

  it("matches Python/NumPy half-to-even rounding for reference codes", async () => {
    const base = await fixtureJson<Record<string, unknown>>("terrain-descriptor.json");
    const descriptor = parseTerrainDescriptor({
      ...base,
      minimum_elevation_m: 0,
      sea_level_m: 2.5,
      lowland_reference_elevation_m: 2.5,
      maximum_elevation_m: 65_535,
      uint16_reference_values: { sea_level: 2, lowland_reference: 2 },
    });
    expect(descriptor.uint16_reference_values.sea_level).toBe(2);
  });
});
