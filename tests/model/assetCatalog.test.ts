import { describe, expect, it } from "vitest";
import { AssetCatalog } from "../../src/model/assetCatalog";

function document(): Record<string, unknown> {
  return {
    format: "polygon-county-asset-catalog",
    schema_version: 3,
    category_defaults: {
      house: { proxy: { width_m: 10, depth_m: 8, wall_height_m: 4.5 } },
      barn: { proxy: { width_m: 18, depth_m: 28, wall_height_m: 8 } },
    },
    assets: {
      example_house: { category: "house", resource: "buildings/example_house.glb" },
      field_barn: { category: "barn", resource: "buildings/field_barn.glb" },
    },
  };
}

describe("AssetCatalog", () => {
  it("strictly loads v3 while preserving asset order and logical resources", () => {
    const catalog = AssetCatalog.fromDocument(document());
    expect(catalog.assets.map((asset) => asset.asset_id)).toEqual(["example_house", "field_barn"]);
    expect(catalog.definition("example_house")).toMatchObject({
      category: "house",
      resource: "buildings/example_house.glb",
      display_name: "Example House",
    });
    expect(catalog.proxyForCategory("barn")).toEqual({ width_m: 18, depth_m: 28, wall_height_m: 8 });
  });

  it("rejects legacy catalogue versions clearly", () => {
    expect(() => AssetCatalog.fromDocument({ ...document(), schema_version: 2 })).toThrow(/legacy prefab catalogues/);
  });

  it("rejects legacy correction fields and unknown envelope fields", () => {
    const source = document();
    const assets = source.assets as Record<string, Record<string, unknown>>;
    assets.example_house = { ...assets.example_house, yaw_correction_deg: 90 };
    expect(() => AssetCatalog.fromDocument(source)).toThrow(/unknown yaw_correction_deg/);
    expect(() => AssetCatalog.fromDocument({ ...document(), resource_root: "assets" })).toThrow(/unknown resource_root/);
  });

  it("requires positive proxy dimensions and non-empty resource strings", () => {
    const badProxy = document();
    const defaults = badProxy.category_defaults as Record<string, { proxy: Record<string, unknown> }>;
    defaults.house!.proxy.width_m = 0;
    expect(() => AssetCatalog.fromDocument(badProxy)).toThrow(/greater than zero/);
    const badResource = document();
    const assets = badResource.assets as Record<string, Record<string, unknown>>;
    assets.example_house!.resource = " ";
    expect(() => AssetCatalog.fromDocument(badResource)).toThrow(/non-empty/);
  });

  it("reports malformed JSON through the catalogue contract", () => {
    expect(() => AssetCatalog.fromJson("{")) .toThrow(/not valid JSON/);
  });
});
