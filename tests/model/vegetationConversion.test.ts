import { describe, expect, it } from "vitest";
import { ProjectModel } from "../../src/model/ProjectModel";
import { convertVegetationToNative, parseVegetationReference } from "../../src/model/references";
import { fixtureTerrain } from "../helpers/fixtures";
import { vegetationDocument } from "../helpers/referenceFixtures";

describe("vegetation reference conversion", () => {
  it("assigns stable UUID records once and deterministically skips exact duplicate conversions", async () => {
    const terrain = await fixtureTerrain();
    const model = ProjectModel.create({
      name: "Conversion",
      world: { width_m: 20, depth_m: 20, terrain_spacing_m: 10 },
      sources: { terrain_npy: "terrain.npy", terrain_descriptor: "terrain.json", vegetation: "vegetation.json", county_features: null, asset_catalog: null },
      terrain_fingerprint: terrain.fingerprint,
    });
    const reference = parseVegetationReference(vegetationDocument(), model.bounds);
    let nextId = 1;
    const conversion = convertVegetationToNative(
      model,
      reference,
      () => `00000004-0000-4000-8000-${(nextId++).toString(16).padStart(12, "0")}`,
    );
    expect(conversion.entities).toHaveLength(reference.objects.length);
    expect(conversion.entities[0]).toMatchObject({
      vegetation_type: reference.objects[0]?.type,
      asset_id: reference.objects[0]?.model_or_species,
      source_region_id: reference.objects[0]?.source_region_id,
      locked: false,
    });
    model.insertMany(conversion.entities);
    const duplicate = convertVegetationToNative(model, reference);
    expect(duplicate.entities).toEqual([]);
    expect(duplicate.skippedDuplicates).toBe(reference.objects.length);
    expect(duplicate.warnings[0]).toMatch(/already represented/i);
  });

  it("skips duplicate source rows within one conversion in first-record order", async () => {
    const terrain = await fixtureTerrain();
    const model = ProjectModel.create({
      name: "Conversion",
      world: { width_m: 20, depth_m: 20, terrain_spacing_m: 10 },
      sources: { terrain_npy: "terrain.npy", terrain_descriptor: "terrain.json", vegetation: null, county_features: null, asset_catalog: null },
      terrain_fingerprint: terrain.fingerprint,
    });
    const document = vegetationDocument();
    document.objects.push({ ...document.objects[0]! });
    document.generated_object_count = document.objects.length;
    const conversion = convertVegetationToNative(model, parseVegetationReference(document, model.bounds));
    expect(conversion.entities).toHaveLength(document.objects.length - 1);
    expect(conversion.skippedDuplicates).toBe(1);
  });
});
