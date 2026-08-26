import {
  requireExactKeys,
  requireNonEmptyString,
  requirePositiveNumber,
  requireRecord,
} from "./entities";
import { ContractError } from "./errors";

export const ASSET_CATALOG_FORMAT = "polygon-county-asset-catalog";
export const ASSET_CATALOG_SCHEMA_VERSION = 3;

export interface CategoryProxy {
  readonly width_m: number;
  readonly depth_m: number;
  readonly wall_height_m: number;
}

export interface AssetDefinition {
  readonly asset_id: string;
  readonly category: string;
  readonly resource: string;
  readonly display_name: string;
}

export class AssetCatalog {
  public readonly assets: readonly AssetDefinition[];
  readonly #categoryDefaults: ReadonlyMap<string, CategoryProxy>;
  readonly #byAssetId: ReadonlyMap<string, AssetDefinition>;

  private constructor(
    categoryDefaults: ReadonlyMap<string, CategoryProxy>,
    assets: readonly AssetDefinition[],
  ) {
    this.#categoryDefaults = categoryDefaults;
    this.assets = assets;
    this.#byAssetId = new Map(assets.map((asset) => [asset.asset_id, asset]));
  }

  public static fromDocument(value: unknown): AssetCatalog {
    const document = requireRecord(value, "asset catalogue");
    requireExactKeys(document, ["format", "schema_version", "category_defaults", "assets"], "asset catalogue");
    if (document.format !== ASSET_CATALOG_FORMAT) {
      throw new ContractError(`asset catalogue format must be ${ASSET_CATALOG_FORMAT}`);
    }
    if (document.schema_version !== ASSET_CATALOG_SCHEMA_VERSION) {
      throw new ContractError(
        `asset catalogue schema_version must be ${String(ASSET_CATALOG_SCHEMA_VERSION)}; legacy prefab catalogues are not runtime-compatible`,
      );
    }

    const defaultDocument = requireRecord(document.category_defaults, "category_defaults");
    const defaults = new Map<string, CategoryProxy>();
    for (const [categoryKey, rawDefault] of Object.entries(defaultDocument)) {
      const category = requireNonEmptyString(categoryKey, "category default key");
      const categoryDefault = requireRecord(rawDefault, `category_defaults.${category}`);
      requireExactKeys(categoryDefault, ["proxy"], `category_defaults.${category}`);
      const proxy = requireRecord(categoryDefault.proxy, `category_defaults.${category}.proxy`);
      requireExactKeys(proxy, ["width_m", "depth_m", "wall_height_m"], `category_defaults.${category}.proxy`);
      defaults.set(category, Object.freeze({
        width_m: requirePositiveNumber(proxy.width_m, `category_defaults.${category}.proxy.width_m`),
        depth_m: requirePositiveNumber(proxy.depth_m, `category_defaults.${category}.proxy.depth_m`),
        wall_height_m: requirePositiveNumber(proxy.wall_height_m, `category_defaults.${category}.proxy.wall_height_m`),
      }));
    }

    const assetDocument = requireRecord(document.assets, "assets");
    const assets: AssetDefinition[] = [];
    for (const [assetKey, rawAsset] of Object.entries(assetDocument)) {
      const assetId = requireNonEmptyString(assetKey, "asset ID");
      const asset = requireRecord(rawAsset, `assets.${assetId}`);
      requireExactKeys(asset, ["category", "resource"], `assets.${assetId}`);
      assets.push(Object.freeze({
        asset_id: assetId,
        category: requireNonEmptyString(asset.category, `assets.${assetId}.category`),
        resource: requireNonEmptyString(asset.resource, `assets.${assetId}.resource`),
        display_name: displayNameForAsset(assetId),
      }));
    }
    return new AssetCatalog(defaults, Object.freeze(assets));
  }

  public static fromJson(text: string): AssetCatalog {
    try {
      return AssetCatalog.fromDocument(JSON.parse(text) as unknown);
    } catch (error) {
      if (error instanceof SyntaxError) throw new ContractError(`asset catalogue is not valid JSON: ${error.message}`);
      throw error;
    }
  }

  public definition(assetId: string): AssetDefinition | undefined {
    return this.#byAssetId.get(assetId);
  }

  public proxyForCategory(category: string): CategoryProxy | undefined {
    return this.#categoryDefaults.get(category);
  }
}

export function displayNameForAsset(assetId: string): string {
  return assetId.replaceAll("_", " ").trim().replace(/\b\w/g, (letter) => letter.toUpperCase());
}
