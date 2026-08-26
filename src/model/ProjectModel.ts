import type { TerrainFingerprint } from "../terrain/TerrainReference";
import { ContractError } from "./errors";
import {
  isGeometryEntity,
  validateEntity,
  type AuthoredEntity,
  type EntityKind,
  type GeometryEntity,
  type PrefabInstance,
  type WorldBounds,
} from "./entities";
import {
  entityToDocument,
  parseProjectDocument,
  type ParsedProjectV4,
  type ProjectDocumentV4,
  type ProjectSources,
  type ProjectWorld,
} from "./projectDto";

export interface ProjectSeed {
  readonly name: string;
  readonly world: ProjectWorld;
  readonly sources: ProjectSources;
  readonly terrain_fingerprint: TerrainFingerprint;
}

export interface RemovedEntity {
  readonly entity: AuthoredEntity;
  readonly index: number;
}

const ENTITY_KINDS = ["place", "land_use", "road", "linear_feature", "prefab", "vegetation"] as const;

export class ProjectModel {
  public readonly name: string;
  public readonly world: ProjectWorld;
  public sources: ProjectSources;
  public readonly terrainFingerprint: TerrainFingerprint;
  readonly #records = new Map<string, AuthoredEntity>();
  readonly #orders: Record<EntityKind, string[]> = {
    place: [],
    land_use: [],
    road: [],
    linear_feature: [],
    prefab: [],
    vegetation: [],
  };

  private constructor(project: ParsedProjectV4) {
    this.name = project.name;
    this.world = { ...project.world };
    this.sources = { ...project.sources };
    this.terrainFingerprint = { ...project.terrain_fingerprint };
    for (const entity of [
      ...project.places,
      ...project.land_use_regions,
      ...project.roads,
      ...project.linear_features,
      ...project.prefab_instances,
      ...project.vegetation_instances,
    ]) {
      this.#records.set(entity.id, entity);
      this.#orders[entity.kind].push(entity.id);
    }
    this.validate();
  }

  public static create(seed: ProjectSeed): ProjectModel {
    return new ProjectModel({
      format: "polygon-county-scenery-project",
      schema_version: 4,
      name: seed.name.trim() || "Untitled Scenery",
      world: { ...seed.world },
      sources: { ...seed.sources },
      terrain_fingerprint: { ...seed.terrain_fingerprint },
      places: [],
      land_use_regions: [],
      roads: [],
      linear_features: [],
      prefab_instances: [],
      vegetation_instances: [],
    });
  }

  public static fromDocument(value: unknown): ProjectModel {
    return new ProjectModel(parseProjectDocument(value));
  }

  public get bounds(): WorldBounds {
    return { widthM: this.world.width_m, depthM: this.world.depth_m };
  }

  public get size(): number {
    return this.#records.size;
  }

  public get(id: string): AuthoredEntity | undefined {
    return this.#records.get(id);
  }

  public has(id: string): boolean {
    return this.#records.has(id);
  }

  public list(kind: EntityKind): readonly AuthoredEntity[] {
    return this.#orders[kind].map((id) => this.#require(id));
  }

  public geometryEntities(): readonly GeometryEntity[] {
    const result: GeometryEntity[] = [];
    for (const kind of ["place", "land_use", "road", "linear_feature"] as const) {
      for (const id of this.#orders[kind]) {
        const entity = this.#require(id);
        if (isGeometryEntity(entity)) result.push(entity);
      }
    }
    return result;
  }

  public prefabInstances(): readonly PrefabInstance[] {
    return this.#orders.prefab.map((id) => {
      const entity = this.#require(id);
      if (entity.kind !== "prefab") throw new ContractError("normalized prefab collection is inconsistent");
      return entity;
    });
  }

  public setAssetCatalogSource(sourceName: string | null): void {
    this.sources = { ...this.sources, asset_catalog: sourceName };
  }

  public all(): readonly AuthoredEntity[] {
    return ENTITY_KINDS.flatMap((kind) => this.#orders[kind].map((id) => this.#require(id)));
  }

  public indexOf(id: string): number {
    const entity = this.#require(id);
    return this.#orders[entity.kind].indexOf(id);
  }

  public insert(entity: AuthoredEntity, index = this.#orders[entity.kind].length): void {
    if (this.#records.has(entity.id)) {
      throw new ContractError(`duplicate authored object id: ${entity.id}`);
    }
    const order = this.#orders[entity.kind];
    if (!Number.isInteger(index) || index < 0 || index > order.length) {
      throw new ContractError("entity insertion index is invalid");
    }
    validateEntity(entity, this.bounds, this.#roadIds(entity.kind === "road" ? entity.id : undefined));
    this.#records.set(entity.id, entity);
    order.splice(index, 0, entity.id);
  }

  public replace(entity: AuthoredEntity): void {
    const previous = this.#require(entity.id);
    if (previous.kind !== entity.kind) {
      throw new ContractError("an authored entity cannot change collection kind");
    }
    validateEntity(entity, this.bounds, this.#roadIds());
    this.#records.set(entity.id, entity);
  }

  public remove(id: string): RemovedEntity {
    const entity = this.#require(id);
    if (entity.kind === "road") {
      const referenced = this.prefabsReferencingRoad(id);
      if (referenced.length > 0) {
        throw new ContractError("road cannot be removed until prefab frontage references are cleared");
      }
    }
    const order = this.#orders[entity.kind];
    const index = order.indexOf(id);
    if (index < 0) throw new ContractError("normalized entity order is inconsistent");
    order.splice(index, 1);
    this.#records.delete(id);
    return { entity, index };
  }

  public prefabsReferencingRoad(roadId: string): readonly PrefabInstance[] {
    return this.#orders.prefab
      .map((id) => this.#require(id))
      .filter((entity): entity is PrefabInstance => entity.kind === "prefab" && entity.frontage_road_id === roadId);
  }

  public nextUniqueName(stem: string): string {
    const names = new Set([...this.#records.values()].map((entity) => entity.name));
    if (!names.has(stem)) return stem;
    let suffix = 2;
    while (names.has(`${stem} ${String(suffix)}`)) suffix += 1;
    return `${stem} ${String(suffix)}`;
  }

  public validate(): void {
    if (this.name.trim().length === 0) throw new ContractError("project name must be non-empty");
    const ids = new Set<string>();
    const roadIds = this.#roadIds();
    for (const kind of ENTITY_KINDS) {
      for (const id of this.#orders[kind]) {
        if (ids.has(id)) throw new ContractError(`duplicate authored object id: ${id}`);
        const entity = this.#require(id);
        if (entity.kind !== kind) throw new ContractError("normalized entity collection is inconsistent");
        ids.add(id);
        validateEntity(entity, this.bounds, roadIds);
      }
    }
    if (ids.size !== this.#records.size) {
      throw new ContractError("normalized entity index contains unordered records");
    }
  }

  public toDocument(): ProjectDocumentV4 {
    this.validate();
    const records = (kind: EntityKind): readonly Record<string, unknown>[] => (
      this.#orders[kind].map((id) => entityToDocument(this.#require(id)))
    );
    return {
      format: "polygon-county-scenery-project",
      schema_version: 4,
      name: this.name,
      world: { ...this.world },
      sources: { ...this.sources },
      terrain_fingerprint: { ...this.terrainFingerprint },
      places: records("place"),
      land_use_regions: records("land_use"),
      roads: records("road"),
      linear_features: records("linear_feature"),
      prefab_instances: records("prefab"),
      vegetation_instances: records("vegetation"),
    };
  }

  #require(id: string): AuthoredEntity {
    const entity = this.#records.get(id);
    if (!entity) throw new ContractError(`unknown authored object id: ${id}`);
    return entity;
  }

  #roadIds(additional?: string): ReadonlySet<string> {
    const ids = new Set(this.#orders.road);
    if (additional) ids.add(additional);
    return ids;
  }
}
