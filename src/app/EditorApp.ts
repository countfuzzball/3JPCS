import { importTerrainSources } from "../io/terrainImport";
import type { PointXZ } from "../model/coordinates";
import {
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
  TerrainViewport,
  type CanvasClickIntent,
  type PrimaryPointerIntent,
} from "../rendering/TerrainViewport";
import type { TerrainLayerState } from "../rendering/terrain/terrainTexture";
import type { TerrainReference } from "../terrain/TerrainReference";
import { buildRootLayout, type EditorElements } from "../ui/rootLayout";
import { EditorStore, type EditorState } from "./EditorStore";

type Tool = "select"
  | `place:${typeof PLACE_TYPES[number]}`
  | `land:${typeof LAND_USE_TYPES[number]}`
  | "road"
  | "hedgerow";

interface DragState {
  readonly id: string;
  readonly start: PointXZ;
  readonly original: GeometryEntity;
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
};

export class EditorApp {
  readonly #elements: EditorElements;
  readonly #store = new EditorStore();
  readonly #viewport: TerrainViewport;
  #activeTerrain: TerrainReference | null = null;
  #tool: Tool = "select";
  #selectedId: string | null = null;
  #selectedVertex: number | null = null;
  #draft: PointXZ[] = [];
  #draftHover: PointXZ | null = null;
  #drag: DragState | null = null;

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
    for (const button of this.#elements.toolButtons) {
      button.addEventListener("click", () => {
        const tool = button.dataset.tool;
        if (isTool(tool)) this.#setTool(tool);
      });
    }
    for (const input of [this.#elements.layerTerrain, this.#elements.layerHillshade, this.#elements.layerContours]) {
      input.addEventListener("change", () => this.#viewport.setLayers(this.#terrainLayers()));
    }
    for (const input of [this.#elements.layerPlaces, this.#elements.layerLandUse, this.#elements.layerRoads, this.#elements.layerHedgerows]) {
      input.addEventListener("change", () => this.#syncProjection());
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
    for (const button of this.#elements.toolButtons) button.disabled = !state.model;

    if (state.terrain && state.terrain !== this.#activeTerrain) {
      this.#activeTerrain = state.terrain;
      this.#viewport.setTerrain(state.terrain);
      this.#elements.viewportEmpty.hidden = true;
      this.#viewport.setDrawingCursor(false);
    }
    this.#syncProjection();
    this.#renderInspector();
  }

  #setTool(tool: Tool): void {
    if (!this.#store.state.model) return;
    this.#tool = tool;
    this.#draft = [];
    this.#draftHover = null;
    this.#drag = null;
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
    const hit = hitTestGeometry(
      model,
      point,
      this.#viewport.worldUnitsPerPixel() * 8,
      this.#geometryLayers(),
      this.#selectedId,
    );
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
    if (entity && !entity.locked && isGeometry(entity)) {
      this.#drag = { id: entity.id, start: point, original: entity, vertexIndex: hit?.vertexIndex ?? null };
    }
    this.#renderInteraction();
  }

  #primaryMove(point: PointXZ): void {
    const model = this.#store.state.model;
    if (!model || !this.#drag) return;
    const current = clampPoint(point, model.bounds);
    const delta = { x: current.x - this.#drag.start.x, z: current.z - this.#drag.start.z };
    const replacement = moveGeometryEntity(this.#drag.original, delta, model.bounds, this.#drag.vertexIndex);
    this.#store.replaceLive(replacement);
  }

  #primaryUp(): void {
    const model = this.#store.state.model;
    if (!model || !this.#drag) return;
    const drag = this.#drag;
    this.#drag = null;
    const final = model.get(drag.id);
    if (final && isGeometry(final)) {
      this.#store.recordAppliedUpdate(
        drag.original,
        final,
        drag.vertexIndex === null ? "Move object" : "Move vertex",
      );
    }
  }

  #canvasClick(intent: CanvasClickIntent): void {
    if (this.#tool === "select" || intent.detail !== 1) return;
    const model = this.#store.state.model;
    if (!model || !isPointInsideWorld(intent.point, model.bounds)) return;
    this.#draft.push(clampPoint(intent.point, model.bounds));
    this.#elements.statusMessage.textContent = `${String(this.#draft.length)} draft point${this.#draft.length === 1 ? "" : "s"} — Enter or double-click to finish`;
    this.#syncProjection();
  }

  #finishDraft(): void {
    const model = this.#store.state.model;
    if (!model || this.#tool === "select") return;
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

  #cancelInteraction(): void {
    if (this.#drag) {
      this.#store.replaceLive(this.#drag.original);
      this.#drag = null;
    }
    this.#draft = [];
    this.#draftHover = null;
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

  #applyProperties(form: HTMLFormElement): void {
    const model = this.#store.state.model;
    if (!model || !this.#selectedId) return;
    const before = model.get(this.#selectedId);
    if (!before || !isGeometry(before)) return;
    const data = new FormData(form);
    try {
      const common = {
        name: requiredText(data, "name"),
        visible: data.get("visible") === "on",
        locked: data.get("locked") === "on",
      };
      let after: GeometryEntity;
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
      }
      this.#store.updateEntity(before, after, "Edit properties");
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
    }
  }

  #updatePointerStatus(point: PointXZ | null): void {
    const terrain = this.#store.state.terrain;
    const model = this.#store.state.model;
    if (!point || !terrain || !model || !isPointInsideWorld(point, model.bounds)) {
      this.#elements.statusCoordinates.textContent = "—";
      this.#elements.statusElevation.textContent = "—";
      this.#elements.statusSlope.textContent = "—";
      if (this.#draftHover) {
        this.#draftHover = null;
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
  }

  #renderInteraction(): void {
    this.#syncProjection();
    this.#renderInspector();
  }

  #syncProjection(): void {
    this.#viewport.setAuthoringProjection(
      this.#store.state.model,
      this.#selectedId,
      this.#selectedVertex,
      this.#geometryLayers(),
      {
        points: this.#draft.map((point) => [point.x, point.z] as PointTuple),
        hover: this.#draftHover ? [this.#draftHover.x, this.#draftHover.z] : null,
      },
    );
  }

  #renderInspector(): void {
    const model = this.#store.state.model;
    const terrain = this.#store.state.terrain;
    const selected = this.#selectedId ? model?.get(this.#selectedId) : undefined;
    if (selected && isGeometry(selected)) {
      this.#elements.inspectorTitle.textContent = selected.name;
      this.#elements.inspector.className = "object-inspector";
      this.#elements.inspector.innerHTML = propertyForm(selected, this.#selectedVertex);
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

  #resetInteraction(): void {
    this.#selectedId = null;
    this.#selectedVertex = null;
    this.#draft = [];
    this.#draftHover = null;
    this.#drag = null;
    this.#tool = "select";
  }

  #showDialogError(message: string): void {
    this.#elements.dialogError.textContent = message;
    this.#elements.dialogError.hidden = false;
  }
}

function propertyForm(entity: GeometryEntity, selectedVertex: number | null): string {
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
  }
  return `
    <div class="object-kind"><strong>${escapeHtml(kind)}</strong><code title="${entity.id}">${entity.id}</code></div>
    <form class="property-form" data-property-form>
      ${fields.join("")}
      <p class="property-meta">${entity.points.length.toLocaleString()} vertices${selectedVertex === null ? "" : ` · vertex ${String(selectedVertex + 1)} selected`}${locked ? " · locked spatially" : ""}</p>
      <div class="property-error" data-property-error hidden></div>
      <div class="property-actions">
        <button class="button button-primary" type="submit">Apply properties</button>
        <button class="button" data-action="delete-vertex" type="button" ${selectedVertex === null || locked ? "disabled" : ""}>Delete vertex</button>
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

function entityKindLabel(entity: GeometryEntity): string {
  switch (entity.kind) {
    case "place": return "Place region";
    case "land_use": return entity.land_use_type === "woodland" ? "Woodland region" : "Land-use region";
    case "road": return "Native road";
    case "linear_feature": return "Hedgerow";
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

function isTool(value: string | undefined): value is Tool {
  return value === "select"
    || value === "road"
    || value === "hedgerow"
    || PLACE_TYPES.some((kind) => value === `place:${kind}`)
    || LAND_USE_TYPES.some((kind) => value === `land:${kind}`);
}

function isGeometry(entity: AuthoredEntity): entity is GeometryEntity {
  return entity.kind === "place" || entity.kind === "land_use" || entity.kind === "road" || entity.kind === "linear_feature";
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
