import { strToU8, zip, type Zippable } from "fflate";
import { resampledVegetationDocument } from "./finalExport";
import { runtimeSceneryV3Document } from "./runtimeExport";
import {
  ASSET_CATALOG_FORMAT,
  ASSET_CATALOG_SCHEMA_VERSION,
  type AssetCatalog,
} from "../model/assetCatalog";
import type { ProjectModel } from "../model/ProjectModel";
import type { VegetationReference } from "../model/references";
import type { WorkingTerrain } from "../terrain/WorkingTerrain";

export const VIEWER_BUNDLE_FORMAT = "polygon-county-viewer-bundle";
export const VIEWER_BUNDLE_SCHEMA_VERSION = 1;
export const VIEWER_BUNDLE_MANIFEST_PATH = "bundle_manifest.json";

interface BundleFileDescriptor {
  readonly path: string;
  readonly media_type: "application/json";
  readonly schema_version: number;
  readonly format?: string;
}

export interface ViewerBundleManifest {
  readonly format: typeof VIEWER_BUNDLE_FORMAT;
  readonly schema_version: typeof VIEWER_BUNDLE_SCHEMA_VERSION;
  readonly project_name: string;
  readonly contents: {
    readonly runtime_scenery: BundleFileDescriptor;
    readonly resampled_vegetation: BundleFileDescriptor | null;
    readonly asset_catalog: BundleFileDescriptor | null;
  };
}

export interface ViewerBundleArchive {
  readonly bytes: Uint8Array;
  readonly filename: string;
  readonly manifest: ViewerBundleManifest;
}

export async function viewerBundleArchive(
  model: ProjectModel,
  terrain: WorkingTerrain,
  vegetation: VegetationReference | null,
  catalog: AssetCatalog | null,
): Promise<ViewerBundleArchive> {
  const stem = fileStem(model.name);
  const runtimePath = `${stem}.runtime-scenery-v3.json`;
  const vegetationPath = vegetation ? `${stem}.resampled-vegetation-v1.json` : null;
  const catalogPath = catalog ? `${stem}.asset-catalog-v3.json` : null;
  const runtimeDocument = await runtimeSceneryV3Document(model, terrain, catalog);
  const manifest: ViewerBundleManifest = {
    format: VIEWER_BUNDLE_FORMAT,
    schema_version: VIEWER_BUNDLE_SCHEMA_VERSION,
    project_name: model.name,
    contents: {
      runtime_scenery: {
        path: runtimePath,
        media_type: "application/json",
        format: "polygon-county-runtime-scenery",
        schema_version: 3,
      },
      resampled_vegetation: vegetationPath ? {
        path: vegetationPath,
        media_type: "application/json",
        schema_version: 1,
      } : null,
      asset_catalog: catalogPath ? {
        path: catalogPath,
        media_type: "application/json",
        format: ASSET_CATALOG_FORMAT,
        schema_version: ASSET_CATALOG_SCHEMA_VERSION,
      } : null,
    },
  };
  const files: Zippable = {
    [VIEWER_BUNDLE_MANIFEST_PATH]: jsonBytes(manifest),
    [runtimePath]: jsonBytes(runtimeDocument),
  };
  if (vegetation && vegetationPath) {
    files[vegetationPath] = jsonBytes(resampledVegetationDocument(vegetation, terrain));
  }
  if (catalog && catalogPath) files[catalogPath] = jsonBytes(catalog.toDocument());
  return {
    bytes: await compress(files),
    filename: `${stem}.viewer-bundle-v1.zip`,
    manifest,
  };
}

function jsonBytes(value: unknown): Uint8Array {
  return strToU8(`${JSON.stringify(value, null, 2)}\n`);
}

function compress(files: Zippable): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    zip(files, { level: 6 }, (error, bytes) => {
      if (error) reject(error);
      else resolve(bytes);
    });
  });
}

function fileStem(value: string): string {
  const stem = value.trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return stem || "scenery";
}
