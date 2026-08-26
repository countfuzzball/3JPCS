import type { TerrainFingerprint, TerrainReference } from "../terrain/TerrainReference";

export interface ProjectSourceHints {
  readonly terrain_npy: string;
  readonly terrain_descriptor: string;
  readonly vegetation: null;
  readonly county_features: null;
  readonly asset_catalog: null;
}

export interface MilestoneOneProject {
  readonly format: "polygon-county-scenery-project";
  readonly schema_version: 3;
  readonly name: string;
  readonly world: {
    readonly width_m: number;
    readonly depth_m: number;
    readonly terrain_spacing_m: number;
  };
  readonly sources: ProjectSourceHints;
  readonly terrain_fingerprint: TerrainFingerprint;
  readonly places: readonly [];
  readonly land_use_regions: readonly [];
  readonly roads: readonly [];
  readonly linear_features: readonly [];
  readonly prefab_instances: readonly [];
}

export interface EditorState {
  readonly project: MilestoneOneProject | null;
  readonly terrain: TerrainReference | null;
  readonly dirty: boolean;
}

type Listener = (state: EditorState) => void;

export class EditorStore {
  readonly #listeners = new Set<Listener>();
  #state: EditorState = { project: null, terrain: null, dirty: false };

  public get state(): EditorState {
    return this.#state;
  }

  public subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    listener(this.#state);
    return () => this.#listeners.delete(listener);
  }

  public createProject(
    name: string,
    terrain: TerrainReference,
    sourceNames: { readonly npy: string; readonly descriptor: string },
  ): void {
    this.#state = {
      terrain,
      dirty: true,
      project: {
        format: "polygon-county-scenery-project",
        schema_version: 3,
        name: name.trim() || "Untitled Scenery",
        world: {
          width_m: terrain.worldWidthM,
          depth_m: terrain.worldDepthM,
          terrain_spacing_m: terrain.spacingM,
        },
        sources: {
          terrain_npy: sourceNames.npy,
          terrain_descriptor: sourceNames.descriptor,
          vegetation: null,
          county_features: null,
          asset_catalog: null,
        },
        terrain_fingerprint: terrain.fingerprint,
        places: [],
        land_use_regions: [],
        roads: [],
        linear_features: [],
        prefab_instances: [],
      },
    };
    this.#emit();
  }

  #emit(): void {
    for (const listener of this.#listeners) {
      listener(this.#state);
    }
  }
}
