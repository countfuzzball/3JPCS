import { importTerrainSources } from "./terrainImport";
import { AssetCatalog } from "../model/assetCatalog";
import { ContractError } from "../model/errors";
import { ProjectModel } from "../model/ProjectModel";
import {
  parseCountyReference,
  parseVegetationReference,
  type CountyReference,
  type VegetationReference,
} from "../model/references";
import type { TerrainReference } from "../terrain/TerrainReference";

export type SourceKey = "terrain_npy" | "terrain_descriptor" | "vegetation" | "county_features" | "asset_catalog";

export interface ProjectOpenSelection {
  readonly project: File;
  readonly companions?: readonly File[];
  readonly relink?: Partial<Record<SourceKey, File>>;
}

export interface OpenedBrowserProject {
  readonly model: ProjectModel;
  readonly terrain: TerrainReference;
  readonly vegetation: VegetationReference | null;
  readonly county: CountyReference | null;
  readonly assetCatalog: AssetCatalog | null;
  readonly warnings: readonly string[];
  readonly sourceSchemaVersion: 1 | 2 | 3 | 4;
  readonly requiresSave: boolean;
}

export class MissingProjectSourcesError extends ContractError {
  public constructor(public readonly sources: readonly SourceKey[]) {
    super(`Select or relink the missing project sources: ${sources.join(", ")}`);
    this.name = "MissingProjectSourcesError";
  }
}

export async function openBrowserProject(selection: ProjectOpenSelection): Promise<OpenedBrowserProject> {
  const document = await readJsonFile(selection.project, "scenery project");
  const sourceSchemaVersion = schemaVersion(document);
  const model = ProjectModel.fromDocument(document);
  const originalSources = { ...model.sources };
  const originalFingerprint = { ...model.terrainFingerprint };
  const companions = selection.companions ?? [];
  const resolve = (key: SourceKey): File | undefined => (
    selection.relink?.[key] ?? resolveSourceHint(model.sources[key], companions)
  );
  const npy = resolve("terrain_npy");
  const descriptor = resolve("terrain_descriptor");
  const missing: SourceKey[] = [];
  if (!npy) missing.push("terrain_npy");
  if (!descriptor) missing.push("terrain_descriptor");
  if (!npy || !descriptor) throw new MissingProjectSourcesError(missing);
  const terrain = await importTerrainSources({ npy, descriptor });
  assertTerrainCompatibility(model, terrain);
  const warnings: string[] = [];
  if (model.terrainFingerprint.sha256 !== terrain.fingerprint.sha256) {
    warnings.push("Terrain NPY contents changed, but dimensions remain compatible; prefab site heights were resampled.");
  }
  model.adoptTerrainReference(terrain.fingerprint, { npy: npy.name, descriptor: descriptor.name });

  const vegetationFile = resolve("vegetation");
  const countyFile = resolve("county_features");
  const catalogFile = resolve("asset_catalog");
  warnMissingOptional("vegetation", model.sources.vegetation, vegetationFile, warnings);
  warnMissingOptional("county-features", model.sources.county_features, countyFile, warnings);
  warnMissingOptional("asset catalogue", model.sources.asset_catalog, catalogFile, warnings);

  const world = model.bounds;
  const vegetation = vegetationFile
    ? parseVegetationReference(await readJsonFile(vegetationFile, "vegetation"), world)
    : null;
  const county = countyFile
    ? parseCountyReference(await readJsonFile(countyFile, "county features"), world)
    : null;
  if (vegetation && county && vegetation.project_id !== county.project_id) {
    throw new ContractError("vegetation and county project IDs disagree");
  }
  const assetCatalog = catalogFile
    ? AssetCatalog.fromDocument(await readJsonFile(catalogFile, "asset catalogue"))
    : null;
  if (vegetationFile) model.setSource("vegetation", vegetationFile.name);
  if (countyFile) model.setSource("county_features", countyFile.name);
  if (catalogFile) model.setSource("asset_catalog", catalogFile.name);
  appendAssetWarnings(model, assetCatalog, warnings);
  const requiresSave = sourceSchemaVersion !== 4
    || originalFingerprint.sha256 !== model.terrainFingerprint.sha256
    || (Object.keys(originalSources) as SourceKey[]).some((key) => originalSources[key] !== model.sources[key]);
  return { model, terrain, vegetation, county, assetCatalog, warnings, sourceSchemaVersion, requiresSave };
}

export function resolveSourceHint(hint: string | null, candidates: readonly File[]): File | undefined {
  if (hint === null || isAbsolutePath(hint)) return undefined;
  const normalizedHint = normalizeRelativePath(hint);
  if (!normalizedHint) return undefined;
  return candidates.find((file) => {
    const relativePath = normalizeRelativePath(file.webkitRelativePath || "");
    if (relativePath && relativePath === normalizedHint) return true;
    return !normalizedHint.includes("/") && file.name === normalizedHint;
  });
}

export function projectJson(model: ProjectModel): string {
  model.validate();
  return `${JSON.stringify(model.toDocument(), null, 2)}\n`;
}

export async function readJsonFile(file: File, context: string): Promise<unknown> {
  try {
    return JSON.parse(await file.text()) as unknown;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new ContractError(`${context} is not valid JSON: ${reason}`);
  }
}

function schemaVersion(value: unknown): 1 | 2 | 3 | 4 {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new ContractError("scenery project must be an object");
  const version = (value as Record<string, unknown>).schema_version;
  if (version !== 1 && version !== 2 && version !== 3 && version !== 4) {
    throw new ContractError("unsupported scenery project schema version");
  }
  return version;
}

function assertTerrainCompatibility(model: ProjectModel, terrain: TerrainReference): void {
  const expected = model.terrainFingerprint;
  const actual = terrain.fingerprint;
  for (const key of ["world_width_m", "world_depth_m", "spacing_m"] as const) {
    if (!isClose(expected[key], actual[key])) throw new ContractError(`terrain source fingerprint is dimensionally incompatible (${key})`);
  }
  for (const key of ["cell_count_x", "cell_count_z", "point_count_x", "point_count_z"] as const) {
    if (expected[key] !== actual[key]) throw new ContractError(`terrain source fingerprint is dimensionally incompatible (${key})`);
  }
}

function isClose(left: number, right: number): boolean {
  return Math.abs(left - right) <= Math.max(1e-6, 1e-9 * Math.max(Math.abs(left), Math.abs(right)));
}

function warnMissingOptional(label: string, hint: string | null, file: File | undefined, warnings: string[]): void {
  if (hint !== null && !file) warnings.push(`Optional ${label} source is missing and must be relinked to use it: ${hint}`);
}

function appendAssetWarnings(model: ProjectModel, catalog: AssetCatalog | null, warnings: string[]): void {
  const records = [...model.prefabInstances(), ...model.vegetationInstances()];
  if (!catalog && records.length > 0) {
    warnings.push("Project contains logical prefab or vegetation assets but has no usable asset catalogue source.");
    return;
  }
  if (!catalog) return;
  const missing = [...new Set(records.filter((entity) => !catalog.definition(entity.asset_id)).map((entity) => entity.asset_id))].sort();
  if (missing.length > 0) warnings.push(`Missing asset catalogue entries: ${missing.join(", ")}`);
}

function normalizeRelativePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\//, "").replace(/^\/+|\/+$/g, "");
}

function isAbsolutePath(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith("/") || value.startsWith("\\\\");
}
