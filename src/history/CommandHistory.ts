import type { AuthoredEntity, PrefabInstance } from "../model/entities";
import { ProjectModel } from "../model/ProjectModel";

export interface ModelCommand {
  readonly label: string;
  readonly isNoop: boolean;
  apply(model: ProjectModel): void;
  revert(model: ProjectModel): void;
}

export class AddEntityCommand implements ModelCommand {
  public readonly isNoop = false;

  public constructor(
    public readonly label: string,
    public readonly entity: AuthoredEntity,
    public readonly index?: number,
  ) {}

  public apply(model: ProjectModel): void {
    model.insert(this.entity, this.index);
  }

  public revert(model: ProjectModel): void {
    model.remove(this.entity.id);
  }
}

export class UpdateEntityCommand implements ModelCommand {
  public readonly isNoop: boolean;

  public constructor(
    public readonly label: string,
    public readonly before: AuthoredEntity,
    public readonly after: AuthoredEntity,
  ) {
    this.isNoop = recordsEqual(before, after);
  }

  public apply(model: ProjectModel): void {
    model.replace(this.after);
  }

  public revert(model: ProjectModel): void {
    model.replace(this.before);
  }
}

export class RemoveEntityCommand implements ModelCommand {
  public readonly isNoop = false;

  public constructor(
    public readonly label: string,
    public readonly entity: AuthoredEntity,
    public readonly index: number,
  ) {}

  public apply(model: ProjectModel): void {
    model.remove(this.entity.id);
  }

  public revert(model: ProjectModel): void {
    model.insert(this.entity, this.index);
  }
}

export class CompositeCommand implements ModelCommand {
  public readonly isNoop: boolean;

  public constructor(
    public readonly label: string,
    public readonly commands: readonly ModelCommand[],
  ) {
    this.isNoop = commands.every((command) => command.isNoop);
  }

  public apply(model: ProjectModel): void {
    for (const command of this.commands) command.apply(model);
  }

  public revert(model: ProjectModel): void {
    for (const command of [...this.commands].reverse()) command.revert(model);
  }
}

export class CommandHistory {
  readonly #undo: ModelCommand[] = [];
  readonly #redo: ModelCommand[] = [];

  public get canUndo(): boolean { return this.#undo.length > 0; }
  public get canRedo(): boolean { return this.#redo.length > 0; }
  public get undoLabel(): string | null { return this.#undo.at(-1)?.label ?? null; }
  public get redoLabel(): string | null { return this.#redo.at(-1)?.label ?? null; }

  public clear(): void {
    this.#undo.length = 0;
    this.#redo.length = 0;
  }

  public execute(model: ProjectModel, command: ModelCommand): boolean {
    if (command.isNoop) return false;
    command.apply(model);
    model.validate();
    this.#undo.push(command);
    this.#redo.length = 0;
    return true;
  }

  public recordApplied(model: ProjectModel, command: ModelCommand): boolean {
    if (command.isNoop) return false;
    model.validate();
    this.#undo.push(command);
    this.#redo.length = 0;
    return true;
  }

  public undo(model: ProjectModel): string | null {
    const command = this.#undo.pop();
    if (!command) return null;
    command.revert(model);
    model.validate();
    this.#redo.push(command);
    return command.label;
  }

  public redo(model: ProjectModel): string | null {
    const command = this.#redo.pop();
    if (!command) return null;
    command.apply(model);
    model.validate();
    this.#undo.push(command);
    return command.label;
  }
}

export function createRemoveCommand(model: ProjectModel, id: string, label: string): ModelCommand {
  const entity = model.get(id);
  if (!entity) throw new Error(`unknown authored object id: ${id}`);
  const commands: ModelCommand[] = [];
  if (entity.kind === "road") {
    for (const prefab of model.prefabsReferencingRoad(id)) {
      const after: PrefabInstance = { ...prefab, frontage_road_id: null };
      commands.push(new UpdateEntityCommand("Clear frontage road", prefab, after));
    }
  }
  commands.push(new RemoveEntityCommand(label, entity, model.indexOf(id)));
  const only = commands[0];
  return commands.length === 1 && only ? only : new CompositeCommand(label, commands);
}

function recordsEqual(left: AuthoredEntity, right: AuthoredEntity): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
