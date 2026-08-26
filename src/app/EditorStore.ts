import {
  AddEntityCommand,
  CommandHistory,
  UpdateEntityCommand,
  createRemoveCommand,
  type ModelCommand,
} from "../history/CommandHistory";
import type { AuthoredEntity } from "../model/entities";
import { ProjectModel } from "../model/ProjectModel";
import type { ProjectDocumentV4 } from "../model/projectDto";
import type { TerrainReference } from "../terrain/TerrainReference";

export interface EditorState {
  readonly model: ProjectModel | null;
  readonly terrain: TerrainReference | null;
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
  #dirty = false;
  #revision = 0;

  public get state(): EditorState {
    return {
      model: this.#model,
      terrain: this.#terrain,
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
    this.#dirty = true;
    this.#changed();
  }

  public addEntity(entity: AuthoredEntity, label: string): boolean {
    return this.#execute(new AddEntityCommand(label, entity));
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
    const recorded = this.#history.recordApplied(model, new UpdateEntityCommand(label, before, after));
    if (recorded) {
      this.#dirty = true;
      this.#changed();
    }
    return recorded;
  }

  public deleteEntity(id: string, label: string): boolean {
    const model = this.#requireModel();
    return this.#execute(createRemoveCommand(model, id, label));
  }

  public undo(): string | null {
    const model = this.#requireModel();
    const label = this.#history.undo(model);
    if (label) {
      this.#dirty = true;
      this.#changed();
    }
    return label;
  }

  public redo(): string | null {
    const model = this.#requireModel();
    const label = this.#history.redo(model);
    if (label) {
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
      this.#dirty = true;
      this.#changed();
    }
    return executed;
  }

  #requireModel(): ProjectModel {
    if (!this.#model) throw new Error("no active scenery project");
    return this.#model;
  }

  #changed(): void {
    this.#revision += 1;
    const state = this.state;
    for (const listener of this.#listeners) listener(state);
  }
}
