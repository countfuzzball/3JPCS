import { importTerrainSources } from "../io/terrainImport";
import { AssetCatalog, type AssetDefinition } from "../model/assetCatalog";
import type { PointXZ } from "../model/coordinates";
import {
  DEFAULT_TERRAIN_PAD,
  LAND_USE_TYPES,
  PLACE_TYPES,
  ROAD_CLASSES,
  ROAD_SURFACES,
  newEntityId,
  type AuthoredEntity,
  type GeometryEntity,
  type LandUseRegion,
  type PlaceRegion,
  type PointTuple,
  type PrefabInstance,
  type Road,
} from "../model/entities";
import {
  clampPoint,
  countDistinctPoints,
  dedupeDraft,
  deleteControlPoint,
  hitTestGeometry,
  insertControlPoint,
  isPointInsideWorld,
  moveGeometryEntity,
  nearestSegment,
  type GeometryLayerState,
} from "../interaction/geometryEditing";
import {
  hitTestPrefab,
  movePrefab,
  prefabFootprint,
} from "../interaction/prefabEditing";
import {
  TerrainViewport,
  type CanvasClickIntent,
  type PrimaryPointerIntent,
} from "../rendering/TerrainViewport";
import type { TerrainLayerState } from "../rendering/terrain/terrainTexture";
import type { TerrainReference } from "../terrain/TerrainReference";
import type { TerrainSurface } from "../terrain/TerrainSurface";
import type { WorkingTerrain } from "../terrain/WorkingTerrain";
import { buildRootLayout, type EditorElements } from "../ui/rootLayout";
import { EditorStore, type EditorState } from "./EditorStore";

type Tool = "select"
  | `place:${typeof PLACE_TYPES[number]}`
  | `land:${typeof LAND_USE_TYPES[number]}`
  | "road"
  | "hedgerow"
  | "prefab";

interface DragState {
  readonly id: string;
  readonly start: PointXZ;
  readonly original: GeometryEntity | PrefabInstance;
  readonly vertexIndex: number | null;
}

const TOOL_INSTRUCTIONS: Record<Tool, string> = {
  select: "Click to select. Drag a handle or whole object. Ctrl-click a selected road or hedgerow segment to insert a point.",
  "place:town": "Click town boundary vertices. Enter or double-click finishes; Backspace removes; Escape cancels.",
  "place:village": "Click village boundary vertices. Enter or double-click finishes; Backspace removes; Escape cancels.",
  "place:farm": "Click farm boundary vertices. Enter or double-click finishes; Backspace removes; Escape cancels.",
  "place:military_area": "Click military-area vertices. Enter or double-click finishes; Backspace removes; Escape cancels.",
  "land:pasture": "Click pasture vertices. Enter or double-click finishes; Backspace removes; Escape cancels.",
  "land:rough_grazing": "Click rough-grazing vertices. Enter or double-click finishes; Backspace removes; Escape cancels.",
  "land:woodland": "Click woodland vertices. Enter or double-click finishes; Backspace removes; Escape cancels.",
  road: "Click ordered road control points. Enter or double-click finishes; Backspace removes; Escape cancels.",
  hedgerow: "Click ordered hedgerow control points. Enter or double-click finishes; Backspace removes; Escape cancels.",
  prefab: "Choose a catalogue asset, hover to preview its footprint/front, then click once to place it.",
};

export class EditorApp {
  readonly #elements: EditorElements;
  readonly #store = new EditorStore();
  readonly #viewport: TerrainViewport;
  #activeBaseTerrain: TerrainReference | null = null;
  #activeTerrain: TerrainSurface | null = null;
  #activeCatalog: AssetCatalog | null = null;
  #tool: Tool = "select";
  #selectedId: string | null = null;
  #selectedVertex: number | null = null;
  #draft: PointXZ[] = [];
  #draftHover: PointXZ | null = null;
  #drag: DragState | null = null;
  #prefabGhost: PointXZ | null = null;

  public constructor(host: HTMLElement) {
    this.#elements = buildRootLayout(host);
    this.#viewport = new TerrainViewport(this.#elements.viewport, {
      onPointerWorld: (point) => this.#updatePointerStatus(point),
      onViewChanged: (view) => {
        this.#elements.viewReadout.textContent = `${view.heightM.toLocaleString(undefined, { maximumFractionDigits: 0 })} m view height`;
      },
      onPrimaryDown: (intent) => this.#primaryDown(intent),
      onPrimaryMove: (point) => this.#primaryMove(point),
      onPrimaryUp: () => this.#primaryUp(),
      onCanvasClick: (intent) => this.#canvasClick(intent),
      onCanvasDoubleClick: () => this.#finishDraft(),
    });
    this.#bindEvents();
    this.#store.subscribe((state) => this.#renderState(state));
  }

  public dispose(): void {
    this.#viewport.dispose();
  }

  #bindEvents(): void {
    this.#elements.newProjectButton.addEventListener("click", () => {
      if (this.#store.state.dirty && !window.confirm("Discard the current unsaved project and choose new terrain sources?")) return;
      this.#elements.dialogError.hidden = true;
      this.#elements.dialog.showModal();
    });
    this.#elements.projectForm.addEventListener("submit", async (event) => {
      const submitter = event.submitter as HTMLButtonElement | null;
      if (submitter?.value === "cancel") return;
      event.preventDefault();
      await this.#createProject();
    });
    this.#elements.fitButton.addEventListener("click", () => this.#viewport.fitTerrain());
    this.#elements.undoButton.addEventListener("click", () => this.#undo());
    this.#elements.redoButton.addEventListener("click", () => this.#redo());
    this.#elements.assetCatalogInput.addEventListener("change", () => { void this.#loadAssetCatalog(); });
    this.#elements.assetSelect.addEventListener("change", () => this.#syncProjection());
    for (const button of this.#elements.toolButtons) {
      button.addEventListener("click", () => {
        const tool = button.dataset.tool;
        if (isTool(tool)) this.#setTool(tool);
      });
    }
    for (const input of [this.#elements.layerTerrain, this.#elements.layerHillshade, this.#elements.layerContours]) {
      input.addEventListener("change", () => this.#viewport.setLayers(this.#terrainLayers()));
    }
    for (const input of [
      this.#elements.layerPlaces,
      this.#elements.layerLandUse,
      this.#elements.layerRoads,
      this.#elements.layerHedgerows,
      this.#elements.layerPrefabs,
      this.#elements.layerTerrainPads,
    ]) {
      input.addEventListener("change", () => this.#authoringLayerChanged());
    }
    this.#elements.inspector.addEventListener("submit", (event) => {
      if (event.target instanceof HTMLFormElement && event.target.matches("[data-property-form]")) {
        event.preventDefault();
        this.#applyProperties(event.target);
      }
    });
    this.#elements.inspector.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("button[data-action]") : null;
      if (!target) return;
      if (target.dataset.action === "delete-object") this.#deleteSelected(false);
      if (target.dataset.action === "delete-vertex") this.#deleteSelected(true);
      if (target.dataset.action === "rotate-negative") this.#rotateSelected(-15);
      if (target.dataset.action === "rotate-positive") this.#rotateSelected(15);
      if (target.dataset.action === "reset-pad") this.#resetSelectedPad();
    });
    window.addEventListener("keydown", (event) => this.#keyDown(event));
    window.addEventListener("beforeunload", (event) => {
      if (this.#store.state.dirty) event.preventDefault();
    });
  }

  async #createProject(): Promise<void> {
    const npy = this.#elements.npyInput.files?.[0];
    const descriptor = this.#elements.descriptorInput.files?.[0];
    if (!npy || !descriptor) {
      this.#showDialogError("Select both the terrain NPY and matching descriptor JSON.");
      return;
    }
    this.#elements.createButton.disabled = true;
    this.#elements.createButton.textContent = "Validating terrain…";
    this.#elements.dialogError.hidden = true;
    try {
      const terrain = await importTerrainSources({ npy, descriptor });
      this.#resetInteraction();
      this.#store.createProject(
        this.#elements.projectName.value,
        terrain,
        { npy: npy.name, descriptor: descriptor.name },
      );
      this.#elements.dialog.close();
      this.#elements.statusMessage.textContent = `Loaded ${npy.name} — geometry authoring ready`;
    } catch (error) {
      this.#showDialogError(error instanceof Error ? error.message : String(error));
    } finally {
      this.#elements.createButton.disabled = false;
      this.#elements.createButton.textContent = "Validate & create project";
    }
  }

  async #loadAssetCatalog(): Promise<void> {
    const file = this.#elements.assetCatalogInput.files?.[0];
    if (!file || !this.#store.state.model) return;
    this.#elements.assetSummary.textContent = "Validating catalogue…";
    try {
      const catalog = AssetCatalog.fromJson(await file.text());
      this.#store.setAssetCatalog(catalog, file.name);
      this.#elements.statusMessage.textContent = `Loaded ${file.name} — ${String(catalog.assets.length)} prefab assets ready`;
    } catch (error) {
      this.#elements.assetCatalogInput.value = "";
      this.#elements.assetSummary.textContent = error instanceof Error ? error.message : String(error);
    }
  }

  #renderState(state: EditorState): void {
    if (this.#selectedId && !state.model?.has(this.#selectedId)) {
      this.#selectedId = null;
      this.#selectedVertex = null;
    }
    const projectName = state.model?.name ?? "Scenery Editor";
    this.#elements.projectTitle.textContent = projectName;
    this.#elements.dirtyMarker.hidden = !state.dirty;
    this.#elements.projectState.innerHTML = state.model
      ? `<span class="state-dot is-ready"></span>${escapeHtml(projectName)}`
      : `<span class="state-dot"></span>No project`;
    document.title = `${state.model?.name ?? "Polygon County Scenery Editor"}${state.dirty ? " *" : ""}`;
    this.#elements.fitButton.disabled = !state.terrain;
    this.#elements.undoButton.disabled = !state.canUndo;
    this.#elements.redoButton.disabled = !state.canRedo;
    this.#elements.undoButton.title = state.undoLabel ? `Undo ${state.undoLabel}` : "Nothing to undo";
    this.#elements.redoButton.title = state.redoLabel ? `Redo ${state.redoLabel}` : "Nothing to redo";
    if (state.assetCatalog !== this.#activeCatalog) {
      this.#activeCatalog = state.assetCatalog;
      this.#renderAssetChoices(state.assetCatalog);
    }
    for (const button of this.#elements.toolButtons) {
      button.disabled = !state.model || (button.dataset.tool === "prefab" && (!state.assetCatalog || state.assetCatalog.assets.length === 0));
    }
    this.#elements.assetCatalogInput.disabled = !state.model;

    if (state.terrain && state.workingTerrain && state.workingTerrain !== this.#activeTerrain) {
      const preserveView = this.#activeBaseTerrain === state.terrain;
      this.#activeBaseTerrain = state.terrain;
      this.#activeTerrain = state.workingTerrain;
      this.#viewport.setTerrain(state.workingTerrain, preserveView);
      this.#elements.viewportEmpty.hidden = true;
      this.#viewport.setDrawingCursor(false);
    }
    this.#syncProjection();
    this.#renderInspector();
  }

  #setTool(tool: Tool): void {
    if (!this.#store.state.model) return;
    if (tool === "prefab" && !this.#selectedAsset()) {
      this.#elements.statusMessage.textContent = "Load an asset catalogue and choose an asset before placing a prefab";
      return;
    }
    this.#tool = tool;
    this.#draft = [];
    this.#draftHover = null;
    this.#drag = null;
    this.#prefabGhost = null;
    for (const button of this.#elements.toolButtons) {
      const active = button.dataset.tool === tool;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    }
    this.#elements.toolInstructions.textContent = TOOL_INSTRUCTIONS[tool];
    this.#viewport.setDrawingCursor(tool !== "select");
    this.#syncProjection();
  }

  #primaryDown(intent: PrimaryPointerIntent): void {
    if (this.#tool !== "select") return;
    const model = this.#store.state.model;
    if (!model || !isPointInsideWorld(intent.point, model.bounds)) return;
    const point = clampPoint(intent.point, model.bounds);
    const geometryHit = hitTestGeometry(
      model,
      point,
      this.#viewport.worldUnitsPerPixel() * 8,
      this.#geometryLayers(),
      this.#selectedId,
    );
    const prefab = hitTestPrefab(
      model.prefabInstances(),
      point,
      this.#store.state.assetCatalog,
      this.#elements.layerPrefabs.checked,
    );
    const hit = geometryHit && geometryHit.vertexIndex !== null
      ? geometryHit
      : prefab
        ? { id: prefab.id, vertexIndex: null }
        : geometryHit;
    this.#selectedId = hit?.id ?? null;
    this.#selectedVertex = hit?.vertexIndex ?? null;
    const entity = hit ? model.get(hit.id) : undefined;
    if (
      intent.ctrlKey
      && entity
      && !entity.locked
      && hit?.vertexIndex === null
      && (entity.kind === "road" || entity.kind === "linear_feature")
    ) {
      const segment = nearestSegment(point, entity.points);
      if (segment.distance <= this.#viewport.worldUnitsPerPixel() * 10) {
        const after = insertControlPoint(entity, segment.segmentIndex, point);
        this.#store.updateEntity(entity, after, "Insert control point");
        this.#selectedVertex = segment.segmentIndex + 1;
        this.#elements.statusMessage.textContent = "Inserted one control point";
        this.#renderInteraction();
        return;
      }
    }
    if (entity && !entity.locked && (isGeometry(entity) || entity.kind === "prefab")) {
      this.#drag = { id: entity.id, start: point, original: entity, vertexIndex: hit?.vertexIndex ?? null };
    }
    this.#renderInteraction();
  }

  #primaryMove(point: PointXZ): void {
    const model = this.#store.state.model;
    if (!model || !this.#drag) return;
    const current = clampPoint(point, model.bounds);
    const delta = { x: current.x - this.#drag.start.x, z: current.z - this.#drag.start.z };
    const replacement = this.#drag.original.kind === "prefab"
      ? movePrefab(this.#drag.original, delta, model.bounds)
      : moveGeometryEntity(this.#drag.original, delta, model.bounds, this.#drag.vertexIndex);
    this.#store.replaceLive(replacement);
  }

  #primaryUp(): void {
    const model = this.#store.state.model;
    if (!model || !this.#drag) return;
    const drag = this.#drag;
    this.#drag = null;
    const final = model.get(drag.id);
    if (final && (isGeometry(final) || final.kind === "prefab")) {
      this.#store.recordAppliedUpdate(
        drag.original,
        final,
        drag.original.kind === "prefab" ? "Move prefab" : drag.vertexIndex === null ? "Move object" : "Move vertex",
      );
    }
  }

  #canvasClick(intent: CanvasClickIntent): void {
    if (this.#tool === "select" || intent.detail !== 1) return;
    const model = this.#store.state.model;
    if (!model || !isPointInsideWorld(intent.point, model.bounds)) return;
    if (this.#tool === "prefab") {
      this.#placePrefab(clampPoint(intent.point, model.bounds));
      return;
    }
    this.#draft.push(clampPoint(intent.point, model.bounds));
    this.#elements.statusMessage.textContent = `${String(this.#draft.length)} draft point${this.#draft.length === 1 ? "" : "s"} — Enter or double-click to finish`;
    this.#syncProjection();
  }

  #finishDraft(): void {
    const model = this.#store.state.model;
    if (!model || this.#tool === "select" || this.#tool === "prefab") return;
    const points = dedupeDraft(this.#draft);
    const polygon = this.#tool.startsWith("place:") || this.#tool.startsWith("land:");
    const required = polygon ? 3 : 2;
    if (points.length < required || countDistinctPoints(points) < required) {
      this.#elements.statusMessage.textContent = `Incomplete geometry — this tool needs ${String(required)} distinct points`;
      return;
    }

    let entity: GeometryEntity;
    if (this.#tool.startsWith("place:")) {
      const placeType = this.#tool.slice("place:".length) as PlaceRegion["place_type"];
      const stem = labelFor(placeType);
      entity = {
        kind: "place",
        id: newEntityId(),
        name: model.nextUniqueName(stem),
        visible: true,
        locked: false,
        place_type: placeType,
        points,
      };
    } else if (this.#tool.startsWith("land:")) {
      const landUseType = this.#tool.slice("land:".length) as LandUseRegion["land_use_type"];
      const stem = labelFor(landUseType);
      entity = {
        kind: "land_use",
        id: newEntityId(),
        name: model.nextUniqueName(stem),
        visible: true,
        locked: false,
        land_use_type: landUseType,
        points,
      };
    } else if (this.#tool === "road") {
      entity = {
        kind: "road",
        id: newEntityId(),
        name: model.nextUniqueName("Road"),
        visible: true,
        locked: false,
        points,
        width_m: 7.5,
        road_class: "local_road",
        surface: "gravel",
      };
    } else {
      entity = {
        kind: "linear_feature",
        id: newEntityId(),
        name: model.nextUniqueName("Hedgerow"),
        visible: true,
        locked: false,
        feature_type: "hedgerow",
        points,
        nominal_width_m: 2,
        nominal_height_m: 2,
      };
    }
    this.#store.addEntity(entity, `Create ${entity.name}`);
    this.#selectedId = entity.id;
    this.#selectedVertex = null;
    this.#elements.statusMessage.textContent = `Created ${entity.name}`;
    this.#setTool("select");
    this.#renderInspector();
  }

  #placePrefab(point: PointXZ): void {
    const model = this.#store.state.model;
    const asset = this.#selectedAsset();
    if (!model || !asset) return;
    const entity: PrefabInstance = {
      kind: "prefab",
      id: newEntityId(),
      name: model.nextUniqueName(asset.display_name),
      visible: true,
      locked: false,
      category: asset.category,
      asset_id: asset.asset_id,
      x_m: point.x,
      z_m: point.z,
      rotation_deg: 0,
      scale: 1,
      frontage_road_id: null,
      terrain_pad: { ...DEFAULT_TERRAIN_PAD },
    };
    this.#selectedId = entity.id;
    this.#selectedVertex = null;
    this.#store.addEntity(entity, `Place ${asset.display_name}`);
    this.#elements.statusMessage.textContent = `Placed ${entity.name}`;
    this.#setTool("select");
    this.#renderInspector();
  }

  #cancelInteraction(): void {
    if (this.#drag) {
      this.#store.replaceLive(this.#drag.original);
      this.#drag = null;
    }
    this.#draft = [];
    this.#draftHover = null;
    this.#prefabGhost = null;
    this.#elements.statusMessage.textContent = "Draft cancelled";
    this.#syncProjection();
  }

  #removeDraftPoint(): void {
    if (this.#draft.length === 0) return;
    this.#draft.pop();
    this.#elements.statusMessage.textContent = `${String(this.#draft.length)} draft points remain`;
    this.#syncProjection();
  }

  #deleteSelected(vertexOnly: boolean): void {
    const model = this.#store.state.model;
    if (!model || !this.#selectedId) return;
    const entity = model.get(this.#selectedId);
    if (!entity) return;
    if (entity.locked) {
      this.#elements.statusMessage.textContent = `${entity.name} is locked — unlock it in Properties first`;
      return;
    }
    if (vertexOnly) {
      if (!isGeometry(entity) || this.#selectedVertex === null) return;
      const replacement = deleteControlPoint(entity, this.#selectedVertex);
      if (!replacement) {
        const minimum = entity.kind === "place" || entity.kind === "land_use" ? 3 : 2;
        this.#elements.statusMessage.textContent = `Cannot delete vertex — geometry must retain ${String(minimum)} points`;
        return;
      }
      this.#store.updateEntity(entity, replacement, "Delete vertex");
      this.#selectedVertex = null;
      this.#elements.statusMessage.textContent = "Deleted one vertex";
      this.#renderInteraction();
      return;
    }
    this.#store.deleteEntity(entity.id, `Delete ${entity.name}`);
    this.#selectedId = null;
    this.#selectedVertex = null;
    this.#elements.statusMessage.textContent = `Deleted ${entity.name}`;
    this.#renderInteraction();
  }

  #rotateSelected(deltaDeg: number): void {
    const model = this.#store.state.model;
    const before = this.#selectedId ? model?.get(this.#selectedId) : undefined;
    if (before?.kind !== "prefab") return;
    if (before.locked) {
      this.#elements.statusMessage.textContent = `${before.name} is locked — unlock it before rotating`;
      return;
    }
    const rotation = normalizeDegrees(before.rotation_deg + deltaDeg);
    const after: PrefabInstance = { ...before, rotation_deg: rotation };
    this.#store.updateEntity(before, after, "Rotate prefab");
    this.#elements.statusMessage.textContent = `Rotated ${after.name} to ${rotation.toFixed(0)}°`;
  }

  #resetSelectedPad(): void {
    const model = this.#store.state.model;
    const before = this.#selectedId ? model?.get(this.#selectedId) : undefined;
    if (before?.kind !== "prefab") return;
    if (before.locked) {
      this.#elements.statusMessage.textContent = `${before.name} is locked — unlock it before resetting its terrain pad`;
      return;
    }
    const after: PrefabInstance = { ...before, terrain_pad: { ...DEFAULT_TERRAIN_PAD } };
    this.#store.updateEntity(before, after, "Reset terrain pad");
    this.#elements.statusMessage.textContent = `Reset ${after.name} to the disabled placement pad default`;
  }

  #applyProperties(form: HTMLFormElement): void {
    const model = this.#store.state.model;
    if (!model || !this.#selectedId) return;
    const before = model.get(this.#selectedId);
    if (!before || (!isGeometry(before) && before.kind !== "prefab")) return;
    const data = new FormData(form);
    try {
      const common = {
        name: requiredText(data, "name"),
        visible: data.get("visible") === "on",
        locked: data.get("locked") === "on",
      };
      let after: GeometryEntity | PrefabInstance;
      switch (before.kind) {
        case "place":
          after = { ...before, ...common, place_type: requiredText(data, "place_type") as PlaceRegion["place_type"] };
          break;
        case "land_use":
          after = { ...before, ...common, land_use_type: requiredText(data, "land_use_type") as LandUseRegion["land_use_type"] };
          break;
        case "road":
          after = {
            ...before,
            ...common,
            road_class: requiredText(data, "road_class") as Road["road_class"],
            surface: requiredText(data, "surface") as Road["surface"],
            width_m: requiredNumber(data, "width_m"),
          };
          break;
        case "linear_feature":
          after = {
            ...before,
            ...common,
            nominal_width_m: requiredNumber(data, "nominal_width_m"),
            nominal_height_m: requiredNumber(data, "nominal_height_m"),
          };
          break;
        case "prefab": {
          const assetId = requiredText(data, "asset_id");
          const definition = this.#store.state.assetCatalog?.definition(assetId);
          after = {
            ...before,
            ...common,
            asset_id: assetId,
            category: definition?.category ?? requiredText(data, "category"),
            x_m: requiredNumber(data, "x_m"),
            z_m: requiredNumber(data, "z_m"),
            rotation_deg: normalizeDegrees(requiredNumber(data, "rotation_deg")),
            scale: requiredNumber(data, "scale"),
            frontage_road_id: optionalText(data, "frontage_road_id"),
            terrain_pad: {
              enabled: data.get("terrain_pad_enabled") === "on",
              width_m: requiredNumber(data, "terrain_pad_width_m"),
              depth_m: requiredNumber(data, "terrain_pad_depth_m"),
              blend_m: requiredNumber(data, "terrain_pad_blend_m"),
              target_mode: "base_terrain_at_origin",
            },
          };
          if (before.locked && prefabSpatialFieldsChanged(before, after)) {
            throw new Error("Unlock this prefab and apply before changing its footprint, transform, or terrain pad");
          }
          break;
        }
      }
      if (!this.#store.updateEntity(before, after, "Edit properties")) this.#renderInspector();
      this.#elements.statusMessage.textContent = `Updated ${after.name}`;
    } catch (error) {
      const errorBox = form.querySelector<HTMLElement>("[data-property-error]");
      if (errorBox) {
        errorBox.textContent = error instanceof Error ? error.message : String(error);
        errorBox.hidden = false;
      }
    }
  }

  #undo(): void {
    const label = this.#store.undo();
    if (label) this.#elements.statusMessage.textContent = `Undid ${label}`;
  }

  #redo(): void {
    const label = this.#store.redo();
    if (label) this.#elements.statusMessage.textContent = `Redid ${label}`;
  }

  #keyDown(event: KeyboardEvent): void {
    if (isTypingTarget(event.target)) return;
    const modifier = event.ctrlKey || event.metaKey;
    if (modifier && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) this.#redo();
      else this.#undo();
      return;
    }
    if (modifier && event.key.toLowerCase() === "y") {
      event.preventDefault();
      this.#redo();
      return;
    }
    if (event.key.toLowerCase() === "f" && this.#store.state.terrain) {
      event.preventDefault();
      this.#viewport.fitTerrain();
    } else if (event.key.toLowerCase() === "v" && this.#store.state.model) {
      event.preventDefault();
      this.#setTool("select");
    } else if (event.key === "Enter") {
      event.preventDefault();
      this.#finishDraft();
    } else if (event.key === "Escape") {
      event.preventDefault();
      this.#cancelInteraction();
    } else if (event.key === "Backspace") {
      event.preventDefault();
      this.#removeDraftPoint();
    } else if (event.key === "Delete") {
      event.preventDefault();
      this.#deleteSelected(event.shiftKey);
    } else if (event.key.toLowerCase() === "q") {
      event.preventDefault();
      this.#rotateSelected(-15);
    } else if (event.key.toLowerCase() === "e") {
      event.preventDefault();
      this.#rotateSelected(15);
    }
  }

  #updatePointerStatus(point: PointXZ | null): void {
    const terrain = this.#store.state.workingTerrain;
    const model = this.#store.state.model;
    if (!point || !terrain || !model || !isPointInsideWorld(point, model.bounds)) {
      this.#elements.statusCoordinates.textContent = "—";
      this.#elements.statusElevation.textContent = "—";
      this.#elements.statusSlope.textContent = "—";
      if (this.#draftHover) {
        this.#draftHover = null;
        this.#syncProjection();
      }
      if (this.#prefabGhost) {
        this.#prefabGhost = null;
        this.#syncProjection();
      }
      return;
    }
    this.#elements.statusCoordinates.textContent = `${point.x.toFixed(2)} / ${point.z.toFixed(2)} m`;
    this.#elements.statusElevation.textContent = `${terrain.heightAt(point.x, point.z).toFixed(2)} m`;
    this.#elements.statusSlope.textContent = `${terrain.slopeAt(point.x, point.z).toFixed(2)}°`;
    if (this.#tool !== "select" && this.#draft.length > 0) {
      this.#draftHover = point;
      this.#syncProjection();
    }
    if (this.#tool === "prefab") {
      this.#prefabGhost = point;
      this.#syncProjection();
    }
  }

  #renderInteraction(): void {
    this.#syncProjection();
    this.#renderInspector();
  }

  #syncProjection(): void {
    const selectedAsset = this.#selectedAsset();
    this.#viewport.setAuthoringProjection(
      this.#store.state.model,
      this.#store.state.assetCatalog,
      this.#selectedId,
      this.#selectedVertex,
      this.#geometryLayers(),
      this.#prefabLayers(),
      {
        points: this.#draft.map((point) => [point.x, point.z] as PointTuple),
        hover: this.#draftHover ? [this.#draftHover.x, this.#draftHover.z] : null,
      },
      this.#prefabGhost && selectedAsset
        ? { xM: this.#prefabGhost.x, zM: this.#prefabGhost.z, asset: selectedAsset }
        : null,
    );
  }

  #renderInspector(): void {
    const model = this.#store.state.model;
    const terrain = this.#store.state.workingTerrain;
    const selected = this.#selectedId ? model?.get(this.#selectedId) : undefined;
    if (selected && model && terrain && (isGeometry(selected) || selected.kind === "prefab")) {
      this.#elements.inspectorTitle.textContent = selected.name;
      this.#elements.inspector.className = "object-inspector";
      this.#elements.inspector.innerHTML = propertyForm(
        selected,
        this.#selectedVertex,
        model,
        this.#store.state.assetCatalog,
        terrain,
      );
      return;
    }
    this.#elements.inspectorTitle.textContent = "Terrain reference";
    if (!model || !terrain) {
      this.#elements.inspector.className = "inspector-empty";
      this.#elements.inspector.innerHTML = `<div class="inspector-placeholder"></div><h3>No terrain loaded</h3><p>World dimensions and authored geometry appear here.</p>`;
      return;
    }
    const rows: readonly (readonly [string, string])[] = [
      ["World", `${formatMetres(terrain.worldWidthM)} × ${formatMetres(terrain.worldDepthM)}`],
      ["Spacing", formatMetres(terrain.spacingM)],
      ["Cells", `${terrain.cellCountX.toLocaleString()} × ${terrain.cellCountZ.toLocaleString()}`],
      ["Places / land use", `${model.list("place").length.toLocaleString()} / ${model.list("land_use").length.toLocaleString()}`],
      ["Roads / hedgerows", `${model.list("road").length.toLocaleString()} / ${model.list("linear_feature").length.toLocaleString()}`],
      ["Prefabs / catalogue", `${model.list("prefab").length.toLocaleString()} / ${(this.#store.state.assetCatalog?.assets.length ?? 0).toLocaleString()}`],
      ["Elevation range", `${terrain.minimumElevationM.toFixed(2)} — ${terrain.maximumElevationM.toFixed(2)} m`],
    ];
    this.#elements.inspector.className = "inspector-data";
    this.#elements.inspector.innerHTML = `
      <div class="terrain-badge"><span>NW–SE</span><strong>Triangle terrain</strong><small>Rows +Z · columns +X</small></div>
      <dl class="data-list">${rows.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl>
      <div class="fingerprint-block"><p class="eyebrow">BASE NPY SHA-256</p><code>${model.terrainFingerprint.sha256}</code></div>
      <div class="source-hints"><p><span>NPY</span>${escapeHtml(model.sources.terrain_npy)}</p><p><span>JSON</span>${escapeHtml(model.sources.terrain_descriptor)}</p></div>
    `;
  }

  #terrainLayers(): TerrainLayerState {
    return {
      terrain: this.#elements.layerTerrain.checked,
      hillshade: this.#elements.layerHillshade.checked,
      contours: this.#elements.layerContours.checked,
    };
  }

  #geometryLayers(): GeometryLayerState {
    return {
      places: this.#elements.layerPlaces.checked,
      landUse: this.#elements.layerLandUse.checked,
      roads: this.#elements.layerRoads.checked,
      hedgerows: this.#elements.layerHedgerows.checked,
    };
  }

  #prefabLayers(): { readonly prefabs: boolean; readonly terrainPads: boolean } {
    return {
      prefabs: this.#elements.layerPrefabs.checked,
      terrainPads: this.#elements.layerTerrainPads.checked,
    };
  }

  #authoringLayerChanged(): void {
    const selected = this.#selectedId ? this.#store.state.model?.get(this.#selectedId) : undefined;
    const remainsVisible = !selected || ((): boolean => {
      switch (selected.kind) {
        case "place": return this.#elements.layerPlaces.checked;
        case "land_use": return this.#elements.layerLandUse.checked;
        case "road": return this.#elements.layerRoads.checked;
        case "linear_feature": return this.#elements.layerHedgerows.checked;
        case "prefab": return this.#elements.layerPrefabs.checked;
        default: return true;
      }
    })();
    if (!remainsVisible) {
      this.#selectedId = null;
      this.#selectedVertex = null;
    }
    this.#renderInteraction();
  }

  #resetInteraction(): void {
    this.#selectedId = null;
    this.#selectedVertex = null;
    this.#draft = [];
    this.#draftHover = null;
    this.#drag = null;
    this.#prefabGhost = null;
    this.#tool = "select";
  }

  #renderAssetChoices(catalog: AssetCatalog | null): void {
    const previous = this.#elements.assetSelect.value;
    if (!catalog || catalog.assets.length === 0) {
      this.#elements.assetSelect.innerHTML = `<option value="">No catalogue loaded</option>`;
      this.#elements.assetSelect.disabled = true;
      this.#elements.assetSummary.textContent = catalog ? "Catalogue contains no assets." : "Load the shared catalogue to enable proxy placement.";
      return;
    }
    this.#elements.assetSelect.innerHTML = catalog.assets.map((asset) => (
      `<option value="${escapeHtml(asset.asset_id)}">${escapeHtml(asset.display_name)} [${escapeHtml(asset.asset_id)}]</option>`
    )).join("");
    if (catalog.definition(previous)) this.#elements.assetSelect.value = previous;
    this.#elements.assetSelect.disabled = false;
    this.#elements.assetSummary.textContent = `${String(catalog.assets.length)} assets · ${String(new Set(catalog.assets.map((asset) => asset.category)).size)} proxy categories`;
  }

  #selectedAsset(): AssetDefinition | undefined {
    return this.#store.state.assetCatalog?.definition(this.#elements.assetSelect.value);
  }

  #showDialogError(message: string): void {
    this.#elements.dialogError.textContent = message;
    this.#elements.dialogError.hidden = false;
  }
}

function propertyForm(
  entity: GeometryEntity | PrefabInstance,
  selectedVertex: number | null,
  model: NonNullable<EditorState["model"]>,
  catalog: AssetCatalog | null,
  workingTerrain: WorkingTerrain,
): string {
  const kind = entityKindLabel(entity);
  const locked = entity.locked;
  const fields: string[] = [
    textField("Name", "name", entity.name),
    checkField("Visible", "visible", entity.visible),
    checkField("Locked", "locked", entity.locked),
  ];
  switch (entity.kind) {
    case "place":
      fields.push(selectField("Place type", "place_type", entity.place_type, PLACE_TYPES));
      break;
    case "land_use":
      fields.push(selectField("Land use", "land_use_type", entity.land_use_type, LAND_USE_TYPES));
      break;
    case "road":
      fields.push(selectField("Road class", "road_class", entity.road_class, ROAD_CLASSES));
      fields.push(selectField("Surface", "surface", entity.surface, ROAD_SURFACES));
      fields.push(numberField("Full width (m)", "width_m", entity.width_m));
      break;
    case "linear_feature":
      fields.push(numberField("Nominal width (m)", "nominal_width_m", entity.nominal_width_m));
      fields.push(numberField("Nominal height (m)", "nominal_height_m", entity.nominal_height_m));
      break;
    case "prefab": {
      const assets = catalog?.assets.map((asset) => ({ value: asset.asset_id, label: `${asset.display_name} [${asset.asset_id}]` })) ?? [];
      if (!assets.some((asset) => asset.value === entity.asset_id)) {
        assets.unshift({ value: entity.asset_id, label: `${entity.asset_id} [missing definition]` });
      }
      const roads = model.list("road")
        .filter((item) => item.kind === "road")
        .map((road) => ({ value: road.id, label: `${road.name} [${road.id.slice(0, 8)}]` }));
      fields.push(selectOptionsField("Asset", "asset_id", entity.asset_id, assets));
      fields.push(textField("Category", "category", entity.category));
      fields.push(`<p class="property-heading">Transform</p>`);
      fields.push(numberField("X (m)", "x_m", entity.x_m));
      fields.push(numberField("Z (m)", "z_m", entity.z_m));
      fields.push(numberField("Rotation (deg)", "rotation_deg", entity.rotation_deg));
      fields.push(numberField("Scale", "scale", entity.scale));
      fields.push(`<div class="property-inline-actions">
        <button class="button" data-action="rotate-negative" type="button" ${locked ? "disabled" : ""}>Rotate −15°</button>
        <button class="button" data-action="rotate-positive" type="button" ${locked ? "disabled" : ""}>Rotate +15°</button>
      </div>`);
      fields.push(`<p class="property-heading">Relationships</p>`);
      fields.push(selectOptionsField("Frontage road", "frontage_road_id", entity.frontage_road_id ?? "", [
        { value: "", label: "None" },
        ...roads,
      ]));
      fields.push(`<p class="property-heading">Terrain pad</p>`);
      fields.push(checkField("Enabled", "terrain_pad_enabled", entity.terrain_pad.enabled));
      fields.push(numberField("Pad width (m)", "terrain_pad_width_m", entity.terrain_pad.width_m));
      fields.push(numberField("Pad depth (m)", "terrain_pad_depth_m", entity.terrain_pad.depth_m));
      fields.push(numberField("Blend distance (m)", "terrain_pad_blend_m", entity.terrain_pad.blend_m));
      fields.push(`<p class="property-explanation">Target is always immutable base terrain at the prefab origin. Prefab scale does not scale pad dimensions.</p>`);
      fields.push(`<div class="property-inline-actions"><button class="button" data-action="reset-pad" type="button" ${locked ? "disabled" : ""}>Reset to disabled placement default</button></div>`);
      if (entity.terrain_pad.enabled) {
        const points = prefabFootprint(
          entity.x_m,
          entity.z_m,
          entity.terrain_pad.width_m,
          entity.terrain_pad.depth_m,
          entity.rotation_deg,
        );
        const site = workingTerrain.footprintSiteInfo(points, [entity.x_m, entity.z_m]);
        fields.push(`<div class="site-information${site.footprintOutsideWorld ? " is-warning" : ""}">
          Origin elevation: ${site.originElevationM.toFixed(2)} m<br />
          Footprint min/max: ${site.minimumElevationM.toFixed(2)} / ${site.maximumElevationM.toFixed(2)} m<br />
          Elevation range: ${site.elevationRangeM.toFixed(2)} m<br />
          Max / average slope: ${site.maximumSlopeDeg.toFixed(2)}° / ${site.averageSlopeDeg.toFixed(2)}°
          ${site.footprintOutsideWorld ? "<br />⚠ Part of the pad footprint lies outside the terrain world." : ""}
        </div>`);
      }
      break;
    }
  }
  const meta = entity.kind === "prefab"
    ? `${catalog?.definition(entity.asset_id) ? "resolved catalogue asset" : "missing catalogue asset"} · pad ${entity.terrain_pad.enabled ? "enabled" : "disabled"}${locked ? " · locked spatially" : ""}`
    : `${entity.points.length.toLocaleString()} vertices${selectedVertex === null ? "" : ` · vertex ${String(selectedVertex + 1)} selected`}${locked ? " · locked spatially" : ""}`;
  return `
    <div class="object-kind"><strong>${escapeHtml(kind)}</strong><code title="${entity.id}">${entity.id}</code></div>
    <form class="property-form" data-property-form>
      ${fields.join("")}
      <p class="property-meta">${meta}</p>
      <div class="property-error" data-property-error hidden></div>
      <div class="property-actions">
        <button class="button button-primary" type="submit">Apply properties</button>
        ${entity.kind === "prefab" ? "" : `<button class="button" data-action="delete-vertex" type="button" ${selectedVertex === null || locked ? "disabled" : ""}>Delete vertex</button>`}
        <button class="button button-danger" data-action="delete-object" type="button" ${locked ? "disabled" : ""}>Delete object</button>
      </div>
    </form>`;
}

function textField(label: string, name: string, value: string): string {
  return `<label for="property-${name}">${label}</label><input id="property-${name}" name="${name}" type="text" value="${escapeHtml(value)}" required />`;
}

function numberField(label: string, name: string, value: number): string {
  return `<label for="property-${name}">${label}</label><input id="property-${name}" name="${name}" type="number" value="${String(value)}" step="any" required />`;
}

function checkField(label: string, name: string, checked: boolean): string {
  return `<label for="property-${name}">${label}</label><span class="property-check"><input id="property-${name}" name="${name}" type="checkbox" ${checked ? "checked" : ""} /></span>`;
}

function selectField(label: string, name: string, value: string, values: readonly string[]): string {
  return `<label for="property-${name}">${label}</label><select id="property-${name}" name="${name}">${values.map((option) => `<option value="${option}" ${option === value ? "selected" : ""}>${labelFor(option)}</option>`).join("")}</select>`;
}

function selectOptionsField(
  label: string,
  name: string,
  value: string,
  values: readonly { readonly value: string; readonly label: string }[],
): string {
  return `<label for="property-${name}">${label}</label><select id="property-${name}" name="${name}">${values.map((option) => `<option value="${escapeHtml(option.value)}" ${option.value === value ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}</select>`;
}

function entityKindLabel(entity: GeometryEntity | PrefabInstance): string {
  switch (entity.kind) {
    case "place": return "Place region";
    case "land_use": return entity.land_use_type === "woodland" ? "Woodland region" : "Land-use region";
    case "road": return "Native road";
    case "linear_feature": return "Hedgerow";
    case "prefab": return "Prefab instance";
  }
}

function requiredText(data: FormData, name: string): string {
  const value = data.get(name);
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${labelFor(name)} must be non-empty`);
  return value.trim();
}

function requiredNumber(data: FormData, name: string): number {
  const value = Number(requiredText(data, name));
  if (!Number.isFinite(value)) throw new Error(`${labelFor(name)} must be a finite number`);
  return value;
}

function optionalText(data: FormData, name: string): string | null {
  const value = data.get(name);
  if (typeof value !== "string") return null;
  return value.trim() || null;
}

function isTool(value: string | undefined): value is Tool {
  return value === "select"
    || value === "road"
    || value === "hedgerow"
    || value === "prefab"
    || PLACE_TYPES.some((kind) => value === `place:${kind}`)
    || LAND_USE_TYPES.some((kind) => value === `land:${kind}`);
}

function isGeometry(entity: AuthoredEntity): entity is GeometryEntity {
  return entity.kind === "place" || entity.kind === "land_use" || entity.kind === "road" || entity.kind === "linear_feature";
}

function prefabSpatialFieldsChanged(before: PrefabInstance, after: PrefabInstance): boolean {
  return before.asset_id !== after.asset_id
    || before.category !== after.category
    || before.x_m !== after.x_m
    || before.z_m !== after.z_m
    || before.rotation_deg !== after.rotation_deg
    || before.scale !== after.scale
    || JSON.stringify(before.terrain_pad) !== JSON.stringify(after.terrain_pad);
}

function normalizeDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}

function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement;
}

function formatMetres(value: number): string {
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })} m`;
}

function labelFor(value: string): string {
  return value.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
