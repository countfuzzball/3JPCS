import { describe, expect, it } from "vitest";
import { ProjectModel } from "../../src/model/ProjectModel";
import {
  convertCountyToNative,
  parseCountyReference,
  parseVegetationReference,
} from "../../src/model/references";
import { fixtureTerrain } from "../helpers/fixtures";
import {
  REFERENCE_PLACE_ID,
  REFERENCE_REGION_ID,
  REFERENCE_ROAD_ID,
  countyDocument,
  vegetationDocument,
} from "../helpers/referenceFixtures";

describe("strict external references", () => {
  it("loads vegetation v1 exactly and rejects count/bounds failures", () => {
    const document = vegetationDocument();
    const reference = parseVegetationReference(document, { widthM: 20, depthM: 20 });
    expect(reference.objects).toHaveLength(1);
    expect(reference.objects[0]?.model_or_species).toBe("oak");
    expect(() => parseVegetationReference({ ...document, generated_object_count: 2 }, { widthM: 20, depthM: 20 })).toThrow(/count/);
    const outside = structuredClone(document);
    outside.objects[0]!.x_m = 21;
    expect(() => parseVegetationReference(outside, { widthM: 20, depthM: 20 })).toThrow(/outside/);
  });

  it("strictly loads county v3 and converts supported records without importing footprint dimensions", async () => {
    const county = parseCountyReference(countyDocument(), { widthM: 20, depthM: 20 });
    const terrain = await fixtureTerrain();
    const model = ProjectModel.create({
      name: "County",
      world: { width_m: 20, depth_m: 20, terrain_spacing_m: 10 },
      sources: { terrain_npy: "terrain.npy", terrain_descriptor: "terrain.json", vegetation: null, county_features: null, asset_catalog: null },
      terrain_fingerprint: terrain.fingerprint,
    });
    const conversion = convertCountyToNative(model, county);
    expect(conversion.warnings).toEqual([]);
    expect(conversion.entities.map((entity) => entity.kind)).toEqual(["place", "road", "prefab"]);
    const prefab = conversion.entities.find((entity) => entity.kind === "prefab");
    expect(prefab).toMatchObject({ frontage_road_id: REFERENCE_ROAD_ID, scale: 1, terrain_pad: { enabled: false, width_m: 12 } });
    expect(prefab?.kind === "prefab" ? prefab.terrain_pad.width_m : 0).not.toBe(4);
  });

  it("rejects legacy county versions, unresolved frontage, and duplicate cross-collection IDs", () => {
    expect(() => parseCountyReference({ ...countyDocument(), schema_version: 2 }, { widthM: 20, depthM: 20 })).toThrow(/v3/);
    const unresolved = countyDocument();
    unresolved.buildings[0]!.frontage_road_id = REFERENCE_REGION_ID;
    expect(() => parseCountyReference(unresolved, { widthM: 20, depthM: 20 })).toThrow(/does not resolve/);
    const duplicate = countyDocument();
    duplicate.buildings[0]!.id = REFERENCE_PLACE_ID;
    expect(() => parseCountyReference(duplicate, { widthM: 20, depthM: 20 })).toThrow(/duplicate/);
  });
});
