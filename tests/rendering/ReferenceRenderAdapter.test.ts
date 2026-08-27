import { describe, expect, it } from "vitest";
import { parseCountyReference, parseVegetationReference } from "../../src/model/references";
import { ReferenceRenderAdapter } from "../../src/rendering/ReferenceRenderAdapter";
import { countyDocument, vegetationDocument } from "../helpers/referenceFixtures";

describe("reference render projection", () => {
  it("uses one GPU Points object for the complete vegetation reference and separate county buffers", () => {
    const vegetationSource = vegetationDocument();
    const seed = vegetationSource.objects[0]!;
    vegetationSource.generated_object_count = 32_498;
    vegetationSource.objects = Array.from({ length: 32_498 }, (_, index) => ({
      ...seed,
      x_m: (index % 200) / 10,
      z_m: (Math.floor(index / 200) % 200) / 10,
      rotation_deg: index % 360,
    }));
    const vegetation = parseVegetationReference(vegetationSource, { widthM: 20, depthM: 20 });
    const county = parseCountyReference(countyDocument(), { widthM: 20, depthM: 20 });
    const adapter = new ReferenceRenderAdapter();
    adapter.sync(county, vegetation, {
      vegetation: true, countySettlements: true, countyRoads: true, countyBuildings: true,
    }, 100);
    const points = adapter.group.getObjectByName("vegetation-points");
    expect(points?.type).toBe("Points");
    expect((points as { geometry?: { attributes?: { position?: { count?: number } } } }).geometry?.attributes?.position?.count).toBe(32_498);
    expect(adapter.group.getObjectByName("vegetation-reference")?.children).toHaveLength(1);
    expect(adapter.group.getObjectByName("county-buildings")).toBeDefined();
    adapter.sync(county, vegetation, {
      vegetation: false, countySettlements: true, countyRoads: false, countyBuildings: true,
    }, 100);
    expect(adapter.group.getObjectByName("vegetation-reference")?.visible).toBe(false);
    expect(adapter.group.getObjectByName("county-roads")?.visible).toBe(false);
    adapter.dispose();
  });
});
