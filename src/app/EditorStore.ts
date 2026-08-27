import {
  AddEntityCommand,
  BulkAddEntitiesCommand,
  CommandHistory,
  UpdateEntityCommand,
  createRemoveCommand,
  type ModelCommand,
} from "../history/CommandHistory";
import type { AssetCatalog } from "../model/assetCatalog";
import type { AuthoredEntity } from "../model/entities";
import type { CountyReference, VegetationReference } from "../model/references";
import { ProjectModel } from "../model/ProjectModel";
import type { ProjectDocumentV4 } from "../model/projectDto";
import type { TerrainReference } from "../terrain/TerrainReference";
import { WorkingTerrain } from "../terrain/WorkingTerrain";

export interface EditorState {
  readonly model: ProjectModel | null;
  readonly terrain: TerrainReference | null;
  readonly workingTerrain: WorkingTerrain | null;
  readonly assetCatalog: AssetCatalog | null;
  readonly vegetationReference: VegetationReference | null;
  readonly countyReference: CountyReference | null;
  readonly warnings: readonly string[];
  readonly dirty: boolean;
  readonly revision: number;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly undoLabel: string | null;
  readonly redoLabel: string | null;
}

type Listener = (state: EditorState) => void;

export class EditorStore {
  readonly #listeners = new Set<Listener>();
  readonly #history = new CommandHistory();
  #model: ProjectModel | null = null;
  #terrain: TerrainReference | null = null;
  #workingTerrain: WorkingTerrain | null = null;
  #assetCatalog: AssetCatalog | null = null;
  #vegetationReference: VegetationReference | null = null;
  #countyReference: CountyReference | null = null;
  #warnings: readonly string[] = [];
  #dirty = false;
  #revision = 0;

  public get state(): EditorState {
    return {
      model: this.#model,
      terrain: this.#terrain,
      workingTerrain: this.#workingTerrain,
      assetCatalog: this.#assetCatalog,
      vegetationReference: this.#vegetationReference,
      countyReference: this.#countyReference,
      warnings: this.#warnings,
      dirty: this.#dirty,
      revision: this.#revision,
      canUndo: this.#history.canUndo,
      canRedo: this.#history.canRedo,
      undoLabel: this.#history.undoLabel,
      redoLabel: this.#history.redoLabel,
    };
  }

  public subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    listener(this.state);
    return () => this.#listeners.delete(listener);
  }

  public createProject(
    name: string,
    terrain: TerrainReference,
    sourceNames: { readonly npy: string; readonly descriptor: string },
  ): void {
    this.#terrain = terrain;
    this.#assetCatalog = null;
    this.#vegetationReference = null;
    this.#countyReference = null;
    this.#warnings = [];
    this.#model = ProjectModel.create({
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
    });
    this.#history.clear();
    this.#recomposeWorkingTerrain();
    this.#dirty = true;
    this.#changed();
  }

  public openProject(
    model: ProjectModel,
    terrain: TerrainReference,
    references: {
      readonly vegetation: VegetationReference | null;
      readonly county: CountyReference | null;
      readonly assetCatalog: AssetCatalog | null;
      readonly warnings: readonly string[];
      readonly requiresSave?: boolean;
    },
  ): void {
    this.#model = model;
    this.#terrain = terrain;
    this.#vegetationReference = references.vegetation;
    this.#countyReference = references.county;
    this.#assetCatalog = references.assetCatalog;
    this.#warnings = [...references.warnings];
    this.#history.clear();
    this.#recomposeWorkingTerrain();
    this.#dirty = references.requiresSave ?? false;
    this.#changed();
  }

  public addEntity(entity: AuthoredEntity, label: string): boolean {
    return this.#execute(new AddEntityCommand(label, entity));
  }

  public addEntities(entities: readonly AuthoredEntity[], label: string): boolean {
    if (entities.length === 0) return false;
    return this.#execute(new BulkAddEntitiesCommand(label, entities));
  }

  public updateEntity(before: AuthoredEntity, after: AuthoredEntity, label: string): boolean {
    return this.#execute(new UpdateEntityCommand(label, before, after));
  }

  public replaceLive(entity: AuthoredEntity): void {
    const model = this.#requireModel();
    model.replace(entity);
    this.#changed();
  }

  public recordAppliedUpdate(before: AuthoredEntity, after: AuthoredEntity, label: string): boolean {
    const model = this.#requireModel();
    const command = new UpdateEntityCommand(label, before, after);
    const recorded = this.#history.recordApplied(model, command);
    if (recorded) {
      if (command.affectsWorkingTerrain) this.#recomposeWorkingTerrain();
      this.#dirty = true;
      this.#changed();
    }
    return recorded;
  }

  public deleteEntity(id: string, label: string): boolean {
    const model = this.#requireModel();
    return this.#execute(createRemoveCommand(model, id, label));
  }

  public setAssetCatalog(catalog: AssetCatalog, sourceName: string): void {
    const model = this.#requireModel();
    this.#assetCatalog = catalog;
    model.setAssetCatalogSource(sourceName);
    this.#dirty = true;
    this.#changed();
  }

  public setVegetationReference(reference: VegetationReference, sourceName: string): void {
    if (this.#countyReference && this.#countyReference.project_id !== reference.project_id) {
      throw new Error("vegetation and county project IDs disagree");
    }
    this.#vegetationReference = reference;
    this.#requireModel().setSource("vegetation", sourceName);
    this.#dirty = true;
    this.#changed();
  }

  public setCountyReference(reference: CountyReference, sourceName: string): void {
    if (this.#vegetationReference && this.#vegetationReference.project_id !== reference.project_id) {
      throw new Error("vegetation and county project IDs disagree");
    }
    this.#countyReference = reference;
    this.#requireModel().setSource("county_features", sourceName);
    this.#dirty = true;
    this.#changed();
  }

  public addWarnings(warnings: readonly string[]): void {
    if (warnings.length === 0) return;
    this.#warnings = [...this.#warnings, ...warnings];
    this.#changed();
  }

  public markSaved(): void {
    if (!this.#model) return;
    this.#dirty = false;
    this.#changed();
  }

  public undo(): string | null {
    const model = this.#requireModel();
    const affectsWorkingTerrain = this.#history.undoAffectsWorkingTerrain;
    const label = this.#history.undo(model);
    if (label) {
      if (affectsWorkingTerrain) this.#recomposeWorkingTerrain();
      this.#dirty = true;
      this.#changed();
    }
    return label;
  }

  public redo(): string | null {
    const model = this.#requireModel();
    const affectsWorkingTerrain = this.#history.redoAffectsWorkingTerrain;
    const label = this.#history.redo(model);
    if (label) {
      if (affectsWorkingTerrain) this.#recomposeWorkingTerrain();
      this.#dirty = true;
      this.#changed();
    }
    return label;
  }

  public toDocument(): ProjectDocumentV4 {
    return this.#requireModel().toDocument();
  }

  #execute(command: ModelCommand): boolean {
    const model = this.#requireModel();
    const executed = this.#history.execute(model, command);
    if (executed) {
      if (command.affectsWorkingTerrain) this.#recomposeWorkingTerrain();
      this.#dirty = true;
      this.#changed();
    }
    return executed;
  }

  #requireModel(): ProjectModel {
    if (!this.#model) throw new Error("no active scenery project");
    return this.#model;
  }

  #recomposeWorkingTerrain(): void {
    if (!this.#terrain || !this.#model) {
      this.#workingTerrain = null;
      return;
    }
    this.#workingTerrain = WorkingTerrain.compose(this.#terrain, this.#model.prefabInstances());
  }

  #changed(): void {
    this.#revision += 1;
    const state = this.state;
    for (const listener of this.#listeners) listener(state);
  }
}
