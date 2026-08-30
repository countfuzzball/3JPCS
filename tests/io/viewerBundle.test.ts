import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  VIEWER_BUNDLE_FORMAT,
  VIEWER_BUNDLE_MANIFEST_PATH,
  viewerBundleArchive,
  type ViewerBundleManifest,
} from "../../src/io/viewerBundle";
import { AssetCatalog } from "../../src/model/assetCatalog";
import { ProjectModel } from "../../src/model/ProjectModel";
import { parseVegetationReference } from "../../src/model/references";
import { WorkingTerrain } from "../../src/terrain/WorkingTerrain";
import { fixtureTerrain } from "../helpers/fixtures";
import { vegetationDocument } from "../helpers/referenceFixtures";

describe("viewer bundle v1", () => {
  it("packages runtime v3, resampled vegetation v1, and the loaded asset catalogue", async () => {
    const base = await fixtureTerrain();
    const working = WorkingTerrain.compose(base, []);
    const model = project("Bundle County");
    const vegetation = parseVegetationReference(vegetationDocument(), model.bounds);
    const catalogDocument = {
      format: "polygon-county-asset-catalog",
      schema_version: 3,
      category_defaults: {
        tree: { proxy: { width_m: 2, depth_m: 2, wall_height_m: 7 } },
      },
      assets: {
        oak: { category: "tree", resource: "vegetation/oak.glb" },
      },
    };
    const archive = await viewerBundleArchive(
      model,
      working,
      vegetation,
      AssetCatalog.fromDocument(catalogDocument),
    );

    expect(archive.filename).toBe("Bundle-County.viewer-bundle-v1.zip");
    expect([...archive.bytes.slice(0, 4)]).toEqual([80, 75, 3, 4]);
    const files = unzipSync(archive.bytes);
    expect(Object.keys(files).sort()).toEqual([
      "Bundle-County.asset-catalog-v3.json",
      "Bundle-County.resampled-vegetation-v1.json",
      "Bundle-County.runtime-scenery-v3.json",
      VIEWER_BUNDLE_MANIFEST_PATH,
    ].sort());

    const manifest = json(files, VIEWER_BUNDLE_MANIFEST_PATH) as ViewerBundleManifest;
    expect(manifest).toEqual(archive.manifest);
    expect(manifest).toMatchObject({
      format: VIEWER_BUNDLE_FORMAT,
      schema_version: 1,
      project_name: "Bundle County",
      contents: {
        runtime_scenery: { path: "Bundle-County.runtime-scenery-v3.json", schema_version: 3 },
        resampled_vegetation: { path: "Bundle-County.resampled-vegetation-v1.json", schema_version: 1 },
        asset_catalog: { path: "Bundle-County.asset-catalog-v3.json", schema_version: 3 },
      },
    });
    const runtime = json(files, manifest.contents.runtime_scenery.path) as Record<string, unknown>;
    expect(runtime.schema_version).toBe(3);
    const exportedVegetation = json(
      files,
      manifest.contents.resampled_vegetation!.path,
    ) as { objects: { terrain_y_m: number }[] };
    expect(exportedVegetation.objects[0]?.terrain_y_m).toBe(working.heightAt(4, 5));
    expect(json(files, manifest.contents.asset_catalog!.path)).toEqual(catalogDocument);
  });

  it("uses explicit null manifest entries when optional sources are not loaded", async () => {
    const base = await fixtureTerrain();
    const archive = await viewerBundleArchive(
      project("***"),
      WorkingTerrain.compose(base, []),
      null,
      null,
    );
    const files = unzipSync(archive.bytes);
    const manifest = json(files, VIEWER_BUNDLE_MANIFEST_PATH) as ViewerBundleManifest;

    expect(archive.filename).toBe("scenery.viewer-bundle-v1.zip");
    expect(Object.keys(files).sort()).toEqual([VIEWER_BUNDLE_MANIFEST_PATH, "scenery.runtime-scenery-v3.json"]);
    expect(manifest.contents.resampled_vegetation).toBeNull();
    expect(manifest.contents.asset_catalog).toBeNull();
  });
});

function project(name: string): ProjectModel {
  return ProjectModel.create({
    name,
    world: { width_m: 20, depth_m: 20, terrain_spacing_m: 10 },
    sources: {
      terrain_npy: "terrain.npy",
      terrain_descriptor: "terrain.json",
      vegetation: null,
      county_features: null,
      asset_catalog: null,
    },
    terrain_fingerprint: {
      sha256: "c2013f1b8a7ea1a0bb6f325484795d231e98d9dd8505cb9b5fa94f056f4ef27f",
      world_width_m: 20,
      world_depth_m: 20,
      spacing_m: 10,
      cell_count_x: 2,
      cell_count_z: 2,
      point_count_x: 3,
      point_count_z: 3,
    },
  });
}

function json(files: Record<string, Uint8Array>, path: string): unknown {
  const bytes = files[path];
  if (!bytes) throw new Error(`missing ZIP entry ${path}`);
  return JSON.parse(strFromU8(bytes)) as unknown;
}
