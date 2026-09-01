import { importTerrainSources } from "../io/terrainImport";
import { downloadBytes, downloadJson, saveJsonFile, type SaveFileHandle } from "../io/browserFiles";
import { finalTerrainArtifacts, resampledVegetationDocument } from "../io/finalExport";
import {
  MissingProjectSourcesError,
  openBrowserProject,
  projectJson,
  readJsonFile,
  type SourceKey,
} from "../io/projectFiles";
import { runtimeSceneryV2Document, runtimeSceneryV3Document } from "../io/runtimeExport";
import { viewerBundleArchive } from "../io/viewerBundle";
import { AssetCatalog, type AssetDefinition } from "../model/assetCatalog";
import type { PointXZ } from "../model/coordinates";
import {
  DEFAULT_TERRAIN_PAD,
  LAND_USE_TYPES,
  PLACE_TYPES,
  ROAD_CLASSES,
  ROAD_SURFACES,
  VEGETATION_TYPES,
  newEntityId,
  type AuthoredEntity,
  type GeometryEntity,
  type LandUseRegion,
  type PlaceRegion,
  type PointTuple,
  type PrefabInstance,
  type Road,
  type RoadClass,
  type RoadSurface,
  type VegetationInstance,
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
  prefabProxySize,
} from "../interaction/prefabEditing";
import {
  buildFrontagePlan,
  closestRoadAnchor,
  type FrontageAnchor,
  type FrontagePlan,
  type FrontageSettings,
  type FrontageSide,
} from "../interaction/frontageAssist";
import { moveVegetation, rotateVegetation } from "../interaction/vegetationEditing";
import {
  TerrainViewport,
  type CanvasClickIntent,
  type PrimaryPointerIntent,
} from "../rendering/TerrainViewport";
import type { TerrainLayerState } from "../rendering/terrain/terrainTexture";
import type { CountyBuildPreviewFilter } from "../rendering/CountyBuildRenderAdapter";
import {
  convertCountyToNative,
  convertVegetationToNative,
  parseCountyReference,
  parseVegetationReference,
} from "../model/references";
import type { TerrainReference } from "../terrain/TerrainReference";
import type { TerrainSurface } from "../terrain/TerrainSurface";
import type { WorkingTerrain } from "../terrain/WorkingTerrain";
import { buildRootLayout, type EditorElements } from "../ui/rootLayout";
import { EditorStore, type EditorState } from "./EditorStore";
import type { SyntheticBenchmarkScene } from "../benchmark/syntheticScene";
import type { FrameTimeSummary, ViewportPerformanceSnapshot } from "../rendering/TerrainViewport";
import {
  gradeToDegrees,
  runSettlementSurvey,
  settlementSurveyProfile,
  type SettlementSurveyProfileId,
  type SettlementSurveyResult,
  type SettlementSurveySettings,
} from "../generation/settlementSurvey";
import { RoadRoutingWorkerClient } from "../generation/RoadRoutingWorkerClient";
import {
  copyRoadRouteTerrain,
  type RoadRouteInput,
  type RoadRouteResult,
} from "../generation/roadRouting";
import {
  buildSettlementFrontagePlan,
  settlementRoadEligibility,
  type SettlementFrontagePlan,
  type SettlementFrontageSettings,
  type SettlementRoadEligibility,
} from "../generation/settlementFrontage";
import { CountyBuildWorkerClient } from "../generation/CountyBuildWorkerClient";
import {
  COUNTY_BUILDING_ROLES,
  COUNTY_STREET_STYLES,
  DEFAULT_COUNTY_ROAD_STYLES,
  copyCountyBuildTerrain,
  materializeCountyPlan,
  type CountyAssetChoice,
  type CountyAssetProgram,
  type CountyBackboneOrientation,
  type CountyBuildingRole,
  type CountyBuildInput,
  type CountyBuildPlan,
  type CountyBuildProgress,
  type CountyBuildResult,
  type CountySourceMode,
  type CountyOutputMode,
  type CountySiteMix,
  type CountyStreetStyle,
} from "../generation/countyBuild";

type Tool = "select"
  | `place:${typeof PLACE_TYPES[number]}`
  | `land:${typeof LAND_USE_TYPES[number]}`
  | "road"
  | "route_road"
  | "hedgerow"
  | "prefab"
  | "frontage"
  | "vegetation";

interface DragState {
  readonly id: string;
  readonly start: PointXZ;
  readonly original: GeometryEntity | PrefabInstance | VegetationInstance;
  readonly vertexIndex: number | null;
}

interface RoadRouteEndpoint {
  readonly point: PointTuple;
  readonly snappedRoadId: string | null;
}

interface RoadRouteAuthoringSettings {
  readonly roadClass: RoadClass;
  readonly surface: RoadSurface;
  readonly widthM: number;
  readonly seed: number;
  readonly routing: Omit<RoadRouteInput, "start" | "end">;
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
  route_road: "Click a start and destination. Terrain-aware A* runs off the UI thread; review diagnostics, then accept the ordinary editable road.",
  hedgerow: "Click ordered hedgerow control points. Enter or double-click finishes; Backspace removes; Escape cancels.",
  prefab: "Placement is on. Choose a catalogue asset, then click repeatedly to place it. Click Place prefab again to return to Select.",
  frontage: "Click two points on the same road. Left and right are relative to the first click looking toward the second; review the preview, then generate.",
  vegetation: "Placement is on. Choose a type and logical species/asset ID, then click repeatedly to place it. Click Place vegetation again to return to Select.",
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
  #frontageStart: FrontageAnchor | null = null;
  #frontageEnd: FrontageAnchor | null = null;
  #frontagePlan: FrontagePlan | null = null;
  #settlementSurveyResult: SettlementSurveyResult | null = null;
  readonly #settlementSurveySelected = new Set<string>();
  #settlementSurveyTerrain: WorkingTerrain | null = null;
  #settlementSurveyPlacesKey: string | null = null;
  #settlementSurveyError: string | null = null;
  #settlementSurveyInvalidated = false;
  readonly #roadRouter = new RoadRoutingWorkerClient();
  #roadRouteStart: RoadRouteEndpoint | null = null;
  #roadRouteEnd: RoadRouteEndpoint | null = null;
  #roadRouteResult: RoadRouteResult | null = null;
  #roadRouteTerrain: WorkingTerrain | null = null;
  #roadRouteRunning = false;
  #roadRouteError: string | null = null;
  #roadRouteInvalidated = false;
  #settlementFrontagePlan: SettlementFrontagePlan | null = null;
  readonly #settlementFrontageRoadIds = new Set<string>();
  #settlementFrontageRoadsCustomized = false;
  #settlementFrontagePlaceId: string | null = null;
  #settlementFrontageTerrain: WorkingTerrain | null = null;
  #settlementFrontageSourceKey: string | null = null;
  #settlementFrontageError: string | null = null;
  #settlementFrontageInvalidated = false;
  readonly #countyBuilder = new CountyBuildWorkerClient();
  #countyBuildResult: CountyBuildResult | null = null;
  #countyBuildProgress: CountyBuildProgress | null = null;
  #countyBuildRunning = false;
  #countyBuildSourceRevision: number | null = null;
  #countyBuildSettingsKey: string | null = null;
  #countyBuildError: string | null = null;
  #countyBuildInvalidated = false;
  #saveHandle: SaveFileHandle | null = null;
  #projectFileName = "project.scenery.json";

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
    this.#roadRouter.dispose();
    this.#countyBuilder.dispose();
    this.#viewport.dispose();
  }

  public loadBenchmarkScene(scene: SyntheticBenchmarkScene): ViewportPerformanceSnapshot {
    this.#resetInteraction();
    this.#store.openProject(scene.model, scene.terrain, {
      vegetation: null,
      county: null,
      assetCatalog: scene.catalog,
      warnings: [],
    });
    this.#saveHandle = null;
    this.#projectFileName = "polygon-county-benchmark.scenery.json";
    this.#elements.statusMessage.textContent = `Benchmark ready — ${scene.model.vegetationInstances().length.toLocaleString()} editable vegetation records`;
    return this.#viewport.performanceSnapshot(true);
  }

  public benchmarkSelectVegetation(point: PointXZ): {
    readonly id: string | null;
    readonly latencyMs: number;
  } {
    const start = performance.now();
    const id = this.#viewport.pickNativeVegetation(point, 2);
    this.#selectedId = id;
    this.#selectedVertex = null;
    this.#renderInteraction();
    this.#viewport.performanceSnapshot(true);
    return { id, latencyMs: performance.now() - start };
  }

  public benchmarkMoveVegetation(id: string, deltaX: number): {
    readonly latencyMs: number;
    readonly snapshot: ViewportPerformanceSnapshot;
  } {
    const model = this.#store.state.model;
    const before = model?.get(id);
    if (!model || before?.kind !== "vegetation") throw new Error("benchmark vegetation target is missing");
    const after = moveVegetation(before, { x: deltaX, z: 0 }, model.bounds);
    const start = performance.now();
    this.#store.updateEntity(before, after, "Benchmark move vegetation");
    const snapshot = this.#viewport.performanceSnapshot(true);
    return { latencyMs: performance.now() - start, snapshot };
  }

  public benchmarkTerrainPadRefresh(prefabId: string): {
    readonly latencyMs: number;
    readonly snapshot: ViewportPerformanceSnapshot;
  } {
    const model = this.#store.state.model;
    const before = model?.get(prefabId);
    if (!model || before?.kind !== "prefab") throw new Error("benchmark prefab target is missing");
    const after: PrefabInstance = {
      ...before,
      terrain_pad: { ...before.terrain_pad, enabled: true, width_m: 24, depth_m: 18, blend_m: 10 },
    };
    const start = performance.now();
    this.#store.updateEntity(before, after, "Benchmark terrain-pad refresh");
    const snapshot = this.#viewport.performanceSnapshot(true);
    return { latencyMs: performance.now() - start, snapshot };
  }

  public benchmarkSerialization(): { readonly latencyMs: number; readonly bytes: number } {
    const start = performance.now();
    const json = JSON.stringify(this.#store.toDocument());
    return { latencyMs: performance.now() - start, bytes: new TextEncoder().encode(json).byteLength };
  }

  public benchmarkPanZoomFrames(frameCount?: number, warmupFrames?: number): Promise<FrameTimeSummary> {
    return this.#viewport.benchmarkPanZoomFrames(frameCount, warmupFrames);
  }

  #bindEvents(): void {
    this.#elements.newProjectButton.addEventListener("click", () => {
      if (this.#store.state.dirty && !window.confirm("Discard the current unsaved project and choose new terrain sources?")) return;
      this.#elements.dialogError.hidden = true;
      this.#elements.dialog.showModal();
    });
    this.#elements.openProjectButton.addEventListener("click", () => {
      if (this.#store.state.dirty && !window.confirm("Discard the current unsaved project and open another project?")) return;
      this.#elements.openForm.reset();
      this.#elements.openDialogError.hidden = true;
      this.#elements.openDialog.showModal();
    });
    this.#elements.projectForm.addEventListener("submit", async (event) => {
      const submitter = event.submitter as HTMLButtonElement | null;
      if (submitter?.value === "cancel") return;
      event.preventDefault();
      await this.#createProject();
    });
    this.#elements.openForm.addEventListener("submit", async (event) => {
      const submitter = event.submitter as HTMLButtonElement | null;
      if (submitter?.value === "cancel") return;
      event.preventDefault();
      await this.#openProject();
    });
    this.#elements.saveButton.addEventListener("click", () => { void this.#saveProject(false); });
    this.#elements.saveAsButton.addEventListener("click", () => { void this.#saveProject(true); });
    this.#elements.fitButton.addEventListener("click", () => this.#viewport.fitTerrain());
    this.#elements.undoButton.addEventListener("click", () => this.#undo());
    this.#elements.redoButton.addEventListener("click", () => this.#redo());
    this.#elements.assetCatalogInput.addEventListener("change", () => { void this.#loadAssetCatalog(); });
    this.#elements.vegetationInput.addEventListener("change", () => { void this.#loadVegetationReference(); });
    this.#elements.countyInput.addEventListener("change", () => { void this.#loadCountyReference(); });
    this.#elements.convertCountyButton.addEventListener("click", () => this.#convertCountyReference());
    this.#elements.convertVegetationButton.addEventListener("click", () => this.#convertVegetationReference());
    this.#elements.exportViewerBundleButton.addEventListener("click", () => { void this.#exportViewerBundle(); });
    this.#elements.exportRuntimeButton.addEventListener("click", () => { void this.#exportRuntime(); });
    this.#elements.exportRuntimeV2Button.addEventListener("click", () => { void this.#exportLegacyRuntime(); });
    this.#elements.exportTerrainButton.addEventListener("click", () => { void this.#exportFinalTerrain(); });
    this.#elements.exportVegetationButton.addEventListener("click", () => this.#exportResampledVegetation());
    this.#elements.assetSelect.addEventListener("change", () => this.#assetSelectionChanged());
    for (const input of [
      this.#elements.countyOutputMode,
      this.#elements.countySourceMode,
      this.#elements.countyMainPlace,
      this.#elements.countySettlementCount,
      this.#elements.countySeed,
      this.#elements.countySiteMix,
      this.#elements.countyCreateBackbone,
      this.#elements.countyBackboneOrientation,
      this.#elements.countyGridStep,
      this.#elements.countyMaximumGrade,
      this.#elements.countyRadiusScale,
      this.#elements.countyLocalEdgeClearance,
      this.#elements.countyBackboneWidth,
      this.#elements.countyAccessWidth,
      this.#elements.countyLocalWidth,
      this.#elements.countyDrivewayWidth,
      this.#elements.countySetback,
      this.#elements.countyGap,
      this.#elements.countyEndClearance,
      this.#elements.countyMaximumPlotSlope,
      this.#elements.countyJunctionClearance,
      this.#elements.countySpacingJitter,
      this.#elements.countyYawJitter,
      this.#elements.countyMaximumRoutes,
      this.#elements.countyMaximumVisitedNodes,
      this.#elements.countyMaximumPrefabs,
      this.#elements.countyMaximumDriveways,
      this.#elements.countyDriveways,
      ...this.#elements.countyAssetRoleSelects,
      ...this.#elements.countyStyleSelects,
    ]) {
      input.addEventListener(input instanceof HTMLInputElement && input.type !== "checkbox" ? "input" : "change", () => {
        this.#countyBuildInputChanged();
      });
    }
    this.#elements.countyOutputMode.addEventListener("change", () => {
      if (this.#elements.countyOutputMode.value === "network_only") {
        this.#elements.countySourceMode.value = "existing_places";
      }
      this.#renderCountyBuildControls();
    });
    this.#elements.countySourceMode.addEventListener("change", () => this.#renderCountyBuildControls());
    this.#elements.countyPreviewPlaceFilter.addEventListener("change", () => this.#syncProjection());
    for (const filter of this.#elements.countyPreviewClassFilters) {
      filter.addEventListener("change", () => this.#syncProjection());
    }
    this.#elements.generateCountyButton.addEventListener("click", () => this.#generateCountyPreview());
    this.#elements.cancelCountyButton.addEventListener("click", () => this.#cancelCountyBuild(true));
    this.#elements.bakeCountyButton.addEventListener("click", () => this.#bakeCounty());
    this.#elements.clearCountyButton.addEventListener("click", () => this.#clearCountyBuild(true));
    this.#elements.settlementProfile.addEventListener("change", () => this.#settlementProfileChanged());
    for (const input of [
      this.#elements.settlementCandidateCount,
      this.#elements.settlementRadius,
      this.#elements.settlementMaximumSlope,
      this.#elements.settlementMinimumSeparation,
      this.#elements.settlementEdgeClearance,
      this.#elements.settlementPreferredElevation,
      this.#elements.settlementSeed,
      this.#elements.settlementAttemptBudget,
    ]) {
      input.addEventListener("input", () => {
        this.#settlementSurveyInputChanged();
        this.#countyBuildInputChanged();
      });
    }
    this.#elements.settlementUsePreferredElevation.addEventListener("change", () => {
      this.#settlementSurveyInputChanged();
      this.#countyBuildInputChanged();
      this.#renderSettlementSurveyControls();
    });
    this.#elements.runSettlementSurveyButton.addEventListener("click", () => this.#runSettlementSurvey());
    this.#elements.acceptSettlementsButton.addEventListener("click", () => this.#acceptSurveyedSettlements());
    this.#elements.clearSettlementSurveyButton.addEventListener("click", () => this.#clearSettlementSurvey(true));
    this.#elements.settlementSurveyCandidates.addEventListener("change", (event) => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement) || input.dataset.surveyCandidate === undefined) return;
      if (input.checked) this.#settlementSurveySelected.add(input.dataset.surveyCandidate);
      else this.#settlementSurveySelected.delete(input.dataset.surveyCandidate);
      this.#renderSettlementSurveyControls();
      this.#syncProjection();
    });
    for (const input of [
      this.#elements.routeRoadClass,
      this.#elements.routeRoadSurface,
      this.#elements.routeRoadWidth,
      this.#elements.routeGridStep,
      this.#elements.routeSlopeWeight,
      this.#elements.routeMaximumGrade,
      this.#elements.routeTurnPenalty,
      this.#elements.routeEdgeClearance,
      this.#elements.routeSeed,
      this.#elements.routeSnapEndpoints,
    ]) {
      input.addEventListener(input instanceof HTMLInputElement && input.type !== "checkbox" ? "input" : "change", () => {
        this.#roadRouteSettingsChanged();
      });
    }
    this.#elements.acceptRoadRouteButton.addEventListener("click", () => this.#acceptRoadRoute());
    this.#elements.clearRoadRouteButton.addEventListener("click", () => this.#clearRoadRoute(true));
    for (const input of [
      this.#elements.settlementFrontageMaximumSlope,
      this.#elements.settlementFrontageJunctionClearance,
      this.#elements.settlementFrontageSpacingJitter,
      this.#elements.settlementFrontageYawJitter,
      this.#elements.settlementFrontageSeed,
    ]) {
      input.addEventListener("input", () => {
        this.#settlementFrontageInputChanged();
      });
    }
    this.#elements.settlementFrontageRoads.addEventListener("change", (event) => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement) || input.dataset.settlementRoad === undefined) return;
      if (input.checked) this.#settlementFrontageRoadIds.add(input.dataset.settlementRoad);
      else this.#settlementFrontageRoadIds.delete(input.dataset.settlementRoad);
      this.#settlementFrontageRoadsCustomized = true;
      this.#settlementFrontageInputChanged();
    });
    this.#elements.populateSettlementButton.addEventListener("click", () => this.#populateSettlement());
    this.#elements.generateSettlementFrontageButton.addEventListener("click", () => this.#generateSettlementFrontage());
    this.#elements.clearSettlementFrontageButton.addEventListener("click", () => this.#clearSettlementFrontage(true));
    for (const input of this.#elements.frontageSideInputs) {
      input.addEventListener("change", () => {
        this.#frontageOptionsChanged();
      });
    }
    for (const input of [
      this.#elements.frontageSetback,
      this.#elements.frontageGap,
      this.#elements.frontageEndClearance,
    ]) {
      input.addEventListener("input", () => {
        this.#frontageOptionsChanged();
      });
    }
    this.#elements.generateFrontageButton.addEventListener("click", () => this.#generateFrontage());
    this.#elements.clearFrontageButton.addEventListener("click", () => this.#clearFrontageRange(true));
    for (const button of this.#elements.toolButtons) {
      button.addEventListener("click", () => {
        const tool = button.dataset.tool;
        if (!isTool(tool)) return;
        const toggleOff = isToggleTool(tool) && this.#tool === tool;
        this.#setTool(toggleOff ? "select" : tool);
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
      this.#elements.layerNativeVegetation,
    ]) {
      input.addEventListener("change", () => this.#authoringLayerChanged());
    }
    for (const input of [
      this.#elements.layerVegetationReference,
      this.#elements.layerCountySettlements,
      this.#elements.layerCountyRoads,
      this.#elements.layerCountyBuildings,
    ]) {
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
      this.#saveHandle = null;
      this.#projectFileName = `${fileStem(this.#elements.projectName.value)}.scenery.json`;
      this.#elements.dialog.close();
      this.#elements.statusMessage.textContent = `Loaded ${npy.name} — geometry authoring ready`;
    } catch (error) {
      this.#showDialogError(error instanceof Error ? error.message : String(error));
    } finally {
      this.#elements.createButton.disabled = false;
      this.#elements.createButton.textContent = "Validate & create project";
    }
  }

  async #openProject(): Promise<void> {
    const project = this.#elements.openProjectInput.files?.[0];
    if (!project) {
      this.#showOpenDialogError("Select a scenery project JSON file.");
      return;
    }
    this.#elements.openButton.disabled = true;
    this.#elements.openButton.textContent = "Opening…";
    this.#elements.openDialogError.hidden = true;
    try {
      const relinkInputs: readonly [SourceKey, HTMLInputElement][] = [
        ["terrain_npy", this.#elements.openNpyInput],
        ["terrain_descriptor", this.#elements.openDescriptorInput],
        ["vegetation", this.#elements.openVegetationInput],
        ["county_features", this.#elements.openCountyInput],
        ["asset_catalog", this.#elements.openCatalogInput],
      ];
      const relink: Partial<Record<SourceKey, File>> = {};
      for (const [key, input] of relinkInputs) {
        const file = input.files?.[0];
        if (file) relink[key] = file;
      }
      const opened = await openBrowserProject({
        project,
        companions: [...(this.#elements.openCompanionsInput.files ?? [])],
        relink,
      });
      this.#resetInteraction();
      this.#store.openProject(opened.model, opened.terrain, {
        vegetation: opened.vegetation,
        county: opened.county,
        assetCatalog: opened.assetCatalog,
        warnings: opened.warnings,
        requiresSave: opened.requiresSave,
      });
      this.#saveHandle = null;
      this.#projectFileName = project.name;
      this.#elements.openDialog.close();
      const migration = opened.sourceSchemaVersion === 4 ? "" : ` · migrated from schema v${String(opened.sourceSchemaVersion)}`;
      const warningSummary = opened.warnings.length === 0 ? "" : ` · ${String(opened.warnings.length)} warning${opened.warnings.length === 1 ? "" : "s"}`;
      this.#elements.statusMessage.textContent = `Opened ${project.name}${migration}${warningSummary}`;
    } catch (error) {
      const message = error instanceof MissingProjectSourcesError
        ? `${error.message}. Use the explicit relink fields above.`
        : error instanceof Error ? error.message : String(error);
      this.#showOpenDialogError(message);
    } finally {
      this.#elements.openButton.disabled = false;
      this.#elements.openButton.textContent = "Validate & open";
    }
  }

  async #saveProject(saveAs: boolean): Promise<void> {
    const model = this.#store.state.model;
    if (!model) return;
    const button = saveAs ? this.#elements.saveAsButton : this.#elements.saveButton;
    button.disabled = true;
    try {
      this.#saveHandle = await saveJsonFile(
        projectJson(model),
        this.#projectFileName,
        saveAs ? null : this.#saveHandle,
      );
      this.#projectFileName = this.#saveHandle?.name ?? this.#projectFileName;
      this.#store.markSaved();
      this.#elements.statusMessage.textContent = `Saved ${this.#projectFileName}`;
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        this.#elements.statusMessage.textContent = `Save failed — ${error instanceof Error ? error.message : String(error)}`;
      }
    } finally {
      button.disabled = !this.#store.state.model;
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

  async #loadVegetationReference(): Promise<void> {
    const file = this.#elements.vegetationInput.files?.[0];
    const model = this.#store.state.model;
    if (!file || !model) return;
    this.#elements.vegetationSummary.textContent = "Validating vegetation…";
    try {
      const reference = parseVegetationReference(await readJsonFile(file, "vegetation"), model.bounds);
      this.#store.setVegetationReference(reference, file.name);
      this.#elements.statusMessage.textContent = `Loaded ${reference.objects.length.toLocaleString()} imported vegetation records as one GPU batch`;
    } catch (error) {
      this.#elements.vegetationInput.value = "";
      this.#elements.vegetationSummary.textContent = error instanceof Error ? error.message : String(error);
    }
  }

  async #loadCountyReference(): Promise<void> {
    const file = this.#elements.countyInput.files?.[0];
    const model = this.#store.state.model;
    if (!file || !model) return;
    this.#elements.countySummary.textContent = "Validating county features…";
    try {
      const reference = parseCountyReference(await readJsonFile(file, "county features"), model.bounds);
      this.#store.setCountyReference(reference, file.name);
      const count = reference.settlement_regions.length + reference.roads.length + reference.buildings.length;
      this.#elements.statusMessage.textContent = `Loaded ${count.toLocaleString()} county reference objects`;
    } catch (error) {
      this.#elements.countyInput.value = "";
      this.#elements.countySummary.textContent = error instanceof Error ? error.message : String(error);
    }
  }

  #convertCountyReference(): void {
    const model = this.#store.state.model;
    const county = this.#store.state.countyReference;
    if (!model || !county) return;
    const conversion = convertCountyToNative(model, county);
    const changed = this.#store.addEntities(conversion.entities, "Convert county reference to native objects");
    this.#store.addWarnings(conversion.warnings);
    this.#elements.statusMessage.textContent = changed
      ? `Converted ${conversion.entities.length.toLocaleString()} county objects to one undoable native edit`
      : "County conversion added no objects; all source UUIDs already exist";
  }

  #convertVegetationReference(): void {
    const model = this.#store.state.model;
    const vegetation = this.#store.state.vegetationReference;
    if (!model || !vegetation) return;
    const conversion = convertVegetationToNative(model, vegetation);
    const changed = this.#store.addEntities(
      conversion.entities,
      "Convert vegetation reference to editable instances",
    );
    this.#store.addWarnings(conversion.warnings);
    this.#elements.statusMessage.textContent = changed
      ? `Converted ${conversion.entities.length.toLocaleString()} vegetation records to one undoable native edit${conversion.skippedDuplicates > 0 ? ` · skipped ${conversion.skippedDuplicates.toLocaleString()} duplicates` : ""}`
      : "Vegetation conversion added no records; every source placement is already represented";
  }

  async #exportViewerBundle(): Promise<void> {
    const { model, workingTerrain, vegetationReference, assetCatalog } = this.#store.state;
    if (!model || !workingTerrain) return;
    try {
      this.#elements.exportViewerBundleButton.disabled = true;
      this.#elements.statusMessage.textContent = "Building compressed viewer bundle…";
      const archive = await viewerBundleArchive(model, workingTerrain, vegetationReference, assetCatalog);
      downloadBytes(archive.bytes, archive.filename, "application/zip");
      const optionalContents = [
        vegetationReference ? `${vegetationReference.objects.length.toLocaleString()} imported vegetation records` : null,
        assetCatalog ? `${assetCatalog.assets.length.toLocaleString()} asset catalogue entries` : null,
      ].filter((value): value is string => value !== null);
      this.#elements.statusMessage.textContent = `Exported viewer bundle with runtime scenery v3${optionalContents.length > 0 ? ` · ${optionalContents.join(" · ")}` : ""}`;
    } catch (error) {
      this.#elements.statusMessage.textContent = `Viewer bundle export failed — ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      this.#elements.exportViewerBundleButton.disabled = !this.#store.state.model || !this.#store.state.workingTerrain;
    }
  }

  async #exportRuntime(): Promise<void> {
    const { model, workingTerrain, assetCatalog } = this.#store.state;
    if (!model || !workingTerrain) return;
    try {
      this.#elements.exportRuntimeButton.disabled = true;
      const document = await runtimeSceneryV3Document(model, workingTerrain, assetCatalog);
      downloadJson(document, `${fileStem(model.name)}.runtime-scenery-v3.json`);
      this.#elements.statusMessage.textContent = `Exported runtime scenery v3 with ${model.vegetationInstances().length.toLocaleString()} native vegetation records`;
    } catch (error) {
      this.#elements.statusMessage.textContent = `Runtime export failed — ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      this.#elements.exportRuntimeButton.disabled = !this.#store.state.model;
    }
  }

  async #exportLegacyRuntime(): Promise<void> {
    const { model, workingTerrain, assetCatalog } = this.#store.state;
    if (!model || !workingTerrain) return;
    const nativeCount = model.vegetationInstances().length;
    if (nativeCount > 0 && !window.confirm(
      `Legacy runtime scenery v2 cannot represent ${nativeCount.toLocaleString()} native vegetation records. Export v2 without those records anyway?`,
    )) return;
    try {
      this.#elements.exportRuntimeV2Button.disabled = true;
      const document = await runtimeSceneryV2Document(model, workingTerrain, assetCatalog, nativeCount > 0);
      downloadJson(document, `${fileStem(model.name)}.runtime-scenery-v2.json`);
      this.#elements.statusMessage.textContent = nativeCount > 0
        ? `Exported legacy runtime scenery v2 after explicitly omitting ${nativeCount.toLocaleString()} native vegetation records`
        : "Exported legacy runtime scenery v2";
    } catch (error) {
      this.#elements.statusMessage.textContent = `Legacy runtime export failed — ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      this.#elements.exportRuntimeV2Button.disabled = !this.#store.state.model;
    }
  }

  async #exportFinalTerrain(): Promise<void> {
    const { model, workingTerrain } = this.#store.state;
    if (!model || !workingTerrain) return;
    try {
      this.#elements.exportTerrainButton.disabled = true;
      this.#elements.statusMessage.textContent = "Encoding unsigned 16-bit terrain PNG…";
      const artifacts = await finalTerrainArtifacts(workingTerrain);
      const stem = fileStem(model.name);
      downloadBytes(artifacts.png, `${stem}.final-heightmap.png`, "image/png");
      downloadJson(artifacts.metadata, `${stem}.final-heightmap.json`);
      this.#elements.statusMessage.textContent = `Exported ${String(workingTerrain.pointCountX)} × ${String(workingTerrain.pointCountZ)} 16-bit terrain and metadata`;
    } catch (error) {
      this.#elements.statusMessage.textContent = `Terrain export failed — ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      this.#elements.exportTerrainButton.disabled = !this.#store.state.model;
    }
  }

  #exportResampledVegetation(): void {
    const { model, workingTerrain, vegetationReference } = this.#store.state;
    if (!model || !workingTerrain || !vegetationReference) return;
    downloadJson(
      resampledVegetationDocument(vegetationReference, workingTerrain),
      `${fileStem(model.name)}.resampled-vegetation-v1.json`,
    );
    this.#elements.statusMessage.textContent = `Exported ${vegetationReference.objects.length.toLocaleString()} vegetation records with working-terrain heights`;
  }

  #renderState(state: EditorState): void {
    if (this.#selectedId && !state.model?.has(this.#selectedId)) {
      this.#selectedId = null;
      this.#selectedVertex = null;
    }
    if (state.terrain && state.terrain !== this.#activeBaseTerrain) {
      this.#elements.settlementPreferredElevation.value = String(state.terrain.lowlandReferenceElevationM);
      this.#elements.routeGridStep.value = String(Math.max(50, state.terrain.spacingM));
      this.#elements.countyGridStep.value = String(Math.max(50, state.terrain.spacingM));
    }
    if (this.#settlementSurveyResult) {
      const places = state.model?.list("place").filter((entity): entity is PlaceRegion => entity.kind === "place") ?? [];
      const surveySourceChanged = state.workingTerrain !== this.#settlementSurveyTerrain
        || settlementPlacesKey(places) !== this.#settlementSurveyPlacesKey;
      if (surveySourceChanged) {
        this.#settlementSurveyResult = null;
        this.#settlementSurveySelected.clear();
        this.#settlementSurveyTerrain = null;
        this.#settlementSurveyPlacesKey = null;
        this.#settlementSurveyError = null;
        this.#settlementSurveyInvalidated = true;
      }
    }
    if (
      (this.#roadRouteStart || this.#roadRouteEnd || this.#roadRouteResult || this.#roadRouteRunning)
      && state.workingTerrain !== this.#roadRouteTerrain
    ) {
      this.#roadRouter.cancel();
      this.#roadRouteStart = null;
      this.#roadRouteEnd = null;
      this.#roadRouteResult = null;
      this.#roadRouteTerrain = null;
      this.#roadRouteRunning = false;
      this.#roadRouteError = null;
      this.#roadRouteInvalidated = true;
    }
    if (this.#settlementFrontagePlan) {
      const sourceChanged = state.workingTerrain !== this.#settlementFrontageTerrain
        || this.#settlementFrontageCurrentSourceKey() !== this.#settlementFrontageSourceKey;
      if (sourceChanged) this.#invalidateSettlementFrontage();
    }
    if (
      (this.#countyBuildRunning || this.#countyBuildResult)
      && this.#countyBuildSourceRevision !== null
      && state.revision !== this.#countyBuildSourceRevision
    ) this.#invalidateCountyBuild();
    const projectName = state.model?.name ?? "Scenery Editor";
    this.#elements.projectTitle.textContent = projectName;
    this.#elements.dirtyMarker.hidden = !state.dirty;
    this.#elements.projectState.innerHTML = state.model
      ? `<span class="state-dot is-ready"></span>${escapeHtml(projectName)}`
      : `<span class="state-dot"></span>No project`;
    document.title = `${state.model?.name ?? "Polygon County Scenery Editor"}${state.dirty ? " *" : ""}`;
    this.#elements.fitButton.disabled = !state.terrain;
    this.#elements.saveButton.disabled = !state.model;
    this.#elements.saveAsButton.disabled = !state.model;
    this.#elements.undoButton.disabled = !state.canUndo;
    this.#elements.redoButton.disabled = !state.canRedo;
    this.#elements.undoButton.title = state.undoLabel ? `Undo ${state.undoLabel}` : "Nothing to undo";
    this.#elements.redoButton.title = state.redoLabel ? `Redo ${state.redoLabel}` : "Nothing to redo";
    if (state.assetCatalog !== this.#activeCatalog) {
      this.#activeCatalog = state.assetCatalog;
      this.#renderAssetChoices(state.assetCatalog);
    }
    const selectedAsset = this.#selectedAsset();
    const hasRoad = (state.model?.list("road").length ?? 0) > 0;
    const frontageAvailable = selectedAsset?.category === "house" && hasRoad;
    if (this.#tool === "frontage" && !frontageAvailable) {
      this.#setTool("select");
      this.#elements.statusMessage.textContent = "Frontage assist stopped because its house asset or road is no longer available";
    }
    for (const button of this.#elements.toolButtons) {
      const requiresAsset = button.dataset.tool === "prefab" || button.dataset.tool === "frontage";
      const frontageUnavailable = button.dataset.tool === "frontage" && !frontageAvailable;
      button.disabled = !state.model || (requiresAsset && !selectedAsset) || frontageUnavailable;
    }
    this.#elements.toolInstructions.textContent = state.model
      ? TOOL_INSTRUCTIONS[this.#tool]
      : "Create a terrain project to enable geometry authoring.";
    this.#elements.assetCatalogInput.disabled = !state.model;
    this.#elements.countyBuildOptions.disabled = !state.model || !state.workingTerrain;
    this.#elements.settlementSurveyOptions.disabled = !state.model || !state.workingTerrain;
    this.#elements.routeRoadOptions.disabled = !state.model || !state.workingTerrain;
    this.#elements.settlementFrontageOptions.disabled = !state.model || !state.workingTerrain;
    this.#elements.frontageOptions.disabled = !state.model || !frontageAvailable;
    this.#elements.vegetationTypeSelect.disabled = !state.model;
    this.#elements.vegetationAssetId.disabled = !state.model;
    this.#elements.vegetationInput.disabled = !state.model;
    this.#elements.countyInput.disabled = !state.model;
    this.#elements.convertCountyButton.disabled = !state.model || !state.countyReference;
    this.#elements.convertVegetationButton.disabled = !state.model || !state.vegetationReference;
    this.#elements.exportViewerBundleButton.disabled = !state.model || !state.workingTerrain;
    this.#elements.exportRuntimeButton.disabled = !state.model || !state.workingTerrain;
    this.#elements.exportRuntimeV2Button.disabled = !state.model || !state.workingTerrain;
    this.#elements.exportTerrainButton.disabled = !state.model || !state.workingTerrain;
    this.#elements.exportVegetationButton.disabled = !state.model || !state.workingTerrain || !state.vegetationReference;
    this.#elements.vegetationSummary.textContent = state.vegetationReference
      ? `${state.vegetationReference.objects.length.toLocaleString()} non-editable records · ${state.model?.vegetationInstances().length.toLocaleString() ?? "0"} native · ${state.vegetationReference.project_name}`
      : "No imported vegetation reference.";
    this.#elements.countySummary.textContent = state.countyReference
      ? `${state.countyReference.settlement_regions.length.toLocaleString()} settlements · ${state.countyReference.roads.length.toLocaleString()} roads · ${state.countyReference.buildings.length.toLocaleString()} buildings`
      : "No county reference.";
    this.#recomputeFrontagePlan();
    this.#renderFrontageControls();
    this.#renderSettlementSurveyControls();
    this.#renderRoadRouteControls();
    this.#renderSettlementFrontageControls();
    this.#renderCountyContextChoices();
    this.#renderCountyBuildControls();
    this.#renderWarnings(state);

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
    if (tool === "frontage") {
      const asset = this.#selectedAsset();
      if (asset?.category !== "house") {
        this.#elements.statusMessage.textContent = "Choose a house asset before using frontage assist";
        return;
      }
      if ((this.#store.state.model.list("road").length) === 0) {
        this.#elements.statusMessage.textContent = "Create a road before using frontage assist";
        return;
      }
    }
    if (tool === "vegetation" && this.#elements.vegetationAssetId.value.trim().length === 0) {
      this.#elements.statusMessage.textContent = "Enter a logical vegetation species/asset ID before placing vegetation";
      return;
    }
    if (this.#countyBuildRunning || this.#countyBuildResult) this.#clearCountyBuild(false);
    if (this.#tool === "frontage" || tool === "frontage") {
      this.#frontageStart = null;
      this.#frontageEnd = null;
      this.#frontagePlan = null;
    }
    if (this.#tool === "route_road" || tool === "route_road") {
      this.#roadRouter.cancel();
      this.#roadRouteStart = null;
      this.#roadRouteEnd = null;
      this.#roadRouteResult = null;
      this.#roadRouteTerrain = null;
      this.#roadRouteRunning = false;
      this.#roadRouteError = null;
      this.#roadRouteInvalidated = false;
    }
    if (tool === "frontage" || tool === "route_road") {
      this.#selectedId = null;
      this.#selectedVertex = null;
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
    this.#renderFrontageControls();
    this.#renderRoadRouteControls();
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
    const vegetationId = this.#viewport.pickNativeVegetation(
      point,
      this.#viewport.worldUnitsPerPixel() * 8,
    );
    const hit = geometryHit && geometryHit.vertexIndex !== null
      ? geometryHit
      : prefab
        ? { id: prefab.id, vertexIndex: null }
        : vegetationId
          ? { id: vegetationId, vertexIndex: null }
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
    if (entity && !entity.locked) {
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
      : this.#drag.original.kind === "vegetation"
        ? moveVegetation(this.#drag.original, delta, model.bounds)
        : moveGeometryEntity(this.#drag.original, delta, model.bounds, this.#drag.vertexIndex);
    this.#store.replaceLive(replacement);
  }

  #primaryUp(): void {
    const model = this.#store.state.model;
    if (!model || !this.#drag) return;
    const drag = this.#drag;
    this.#drag = null;
    const final = model.get(drag.id);
    if (final) {
      this.#store.recordAppliedUpdate(
        drag.original,
        final,
        drag.original.kind === "prefab"
          ? "Move prefab"
          : drag.original.kind === "vegetation"
            ? "Move vegetation"
            : drag.vertexIndex === null ? "Move object" : "Move vertex",
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
    if (this.#tool === "vegetation") {
      this.#placeVegetation(clampPoint(intent.point, model.bounds));
      return;
    }
    if (this.#tool === "frontage") {
      this.#frontageClick(clampPoint(intent.point, model.bounds));
      return;
    }
    if (this.#tool === "route_road") {
      this.#roadRouteClick(clampPoint(intent.point, model.bounds));
      return;
    }
    this.#draft.push(clampPoint(intent.point, model.bounds));
    this.#elements.statusMessage.textContent = `${String(this.#draft.length)} draft point${this.#draft.length === 1 ? "" : "s"} — Enter or double-click to finish`;
    this.#syncProjection();
  }

  #finishDraft(): void {
    const model = this.#store.state.model;
    if (
      !model
      || this.#tool === "select"
      || this.#tool === "prefab"
      || this.#tool === "vegetation"
      || this.#tool === "frontage"
      || this.#tool === "route_road"
    ) return;
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
    this.#elements.statusMessage.textContent = `Placed ${entity.name} — prefab placement remains on`;
    this.#renderInspector();
  }

  #placeVegetation(point: PointXZ): void {
    const model = this.#store.state.model;
    if (!model) return;
    const assetId = this.#elements.vegetationAssetId.value.trim();
    const vegetationType = this.#elements.vegetationTypeSelect.value;
    if (assetId.length === 0 || !VEGETATION_TYPES.includes(vegetationType as VegetationInstance["vegetation_type"])) return;
    const entity: VegetationInstance = {
      kind: "vegetation",
      id: newEntityId(),
      name: model.nextUniqueName(this.#store.state.assetCatalog?.definition(assetId)?.display_name ?? labelFor(assetId)),
      visible: true,
      locked: false,
      vegetation_type: vegetationType as VegetationInstance["vegetation_type"],
      asset_id: assetId,
      x_m: point.x,
      z_m: point.z,
      rotation_deg: 0,
      scale: 1,
      source_region_id: null,
    };
    this.#selectedId = entity.id;
    this.#selectedVertex = null;
    this.#store.addEntity(entity, `Place ${entity.name}`);
    this.#elements.statusMessage.textContent = `Placed ${entity.name} — vegetation placement remains on`;
    this.#renderInspector();
  }

  #countyAssetProgram(): CountyAssetProgram | null {
    const catalog = this.#store.state.assetCatalog;
    if (!catalog) return null;
    const program = Object.fromEntries(
      COUNTY_BUILDING_ROLES.map((role) => [role, [] as CountyAssetChoice[]]),
    ) as Record<CountyBuildingRole, CountyAssetChoice[]>;
    for (const select of this.#elements.countyAssetRoleSelects) {
      const role = select.dataset.countyAssetRole;
      if (!isCountyBuildingRole(role)) continue;
      for (const option of [...select.selectedOptions]) {
        if (!option.value) continue;
        const asset = catalog.definition(option.value);
        const proxy = asset ? catalog.proxyForCategory(asset.category) : undefined;
        if (!asset || !proxy) continue;
        program[role].push({
          assetId: asset.asset_id,
          category: asset.category,
          displayName: asset.display_name,
          widthM: proxy.width_m,
          depthM: proxy.depth_m,
        });
      }
    }
    return program;
  }

  #countyStyleProgram(): Readonly<Record<SettlementSurveyProfileId, CountyStreetStyle>> | null {
    const result = {} as Record<SettlementSurveyProfileId, CountyStreetStyle>;
    for (const select of this.#elements.countyStyleSelects) {
      const profile = select.dataset.countyStyleProfile;
      const style = select.value;
      if (!profile || !isSettlementSurveyProfileId(profile) || !isCountyStreetStyle(style)) return null;
      result[profile] = style;
    }
    return Object.keys(result).length === 4 ? result : null;
  }

  #countyBuildInput(): CountyBuildInput | null {
    const { model, workingTerrain, assetCatalog } = this.#store.state;
    if (!model || !workingTerrain) return null;
    const sourceModeValue = this.#elements.countySourceMode.value;
    const sourceMode = isCountySourceMode(sourceModeValue) ? sourceModeValue : null;
    const outputModeValue = this.#elements.countyOutputMode.value;
    const outputMode = isCountyOutputMode(outputModeValue) ? outputModeValue : null;
    this.#elements.countySourceMode.setAttribute("aria-invalid", String(sourceMode === null));
    const desiredSettlementCount = surveyInputNumber(
      this.#elements.countySettlementCount,
      (value) => Number.isSafeInteger(value) && value >= 1 && value <= 25,
    );
    const seed = surveyInputNumber(this.#elements.countySeed, Number.isSafeInteger);
    const gridStepM = surveyInputNumber(this.#elements.countyGridStep, (value) => value > 0);
    const maximumGrade = surveyInputNumber(this.#elements.countyMaximumGrade, (value) => value > 0);
    const radiusScale = surveyInputNumber(this.#elements.countyRadiusScale, (value) => value >= 0.05 && value <= 4);
    const localEdgeClearanceM = surveyInputNumber(this.#elements.countyLocalEdgeClearance, (value) => value >= 0);
    const backboneWidthM = surveyInputNumber(this.#elements.countyBackboneWidth, (value) => value > 0);
    const accessWidthM = surveyInputNumber(this.#elements.countyAccessWidth, (value) => value > 0);
    const localWidthM = surveyInputNumber(this.#elements.countyLocalWidth, (value) => value > 0);
    const drivewayWidthM = surveyInputNumber(this.#elements.countyDrivewayWidth, (value) => value > 0);
    const maximumRoutes = surveyInputNumber(this.#elements.countyMaximumRoutes, (value) => Number.isSafeInteger(value) && value >= 1);
    const maximumVisitedNodes = surveyInputNumber(this.#elements.countyMaximumVisitedNodes, (value) => Number.isSafeInteger(value) && value >= 1);
    const maximumPrefabs = surveyInputNumber(this.#elements.countyMaximumPrefabs, (value) => Number.isSafeInteger(value) && value >= 1);
    const maximumDriveways = surveyInputNumber(this.#elements.countyMaximumDriveways, (value) => Number.isSafeInteger(value) && value >= 1);
    const minimumSeparationM = surveyInputNumber(this.#elements.settlementMinimumSeparation, (value) => value >= 0);
    const edgeClearanceM = surveyInputNumber(this.#elements.settlementEdgeClearance, (value) => value >= 0);
    const attemptBudgetPerSite = surveyInputNumber(
      this.#elements.settlementAttemptBudget,
      (value) => Number.isSafeInteger(value) && value >= 1 && value <= 100_000,
    );
    const frontageValues = [
      surveyInputNumber(this.#elements.countySetback, (value) => value >= 0),
      surveyInputNumber(this.#elements.countyGap, (value) => value >= 0),
      surveyInputNumber(this.#elements.countyEndClearance, (value) => value >= 0),
      surveyInputNumber(this.#elements.countyMaximumPlotSlope, (value) => value >= 0 && value < 90),
      surveyInputNumber(this.#elements.countyJunctionClearance, (value) => value >= 0),
      surveyInputNumber(this.#elements.countySpacingJitter, (value) => value >= 0),
      surveyInputNumber(this.#elements.countyYawJitter, (value) => value >= 0 && value <= 45),
    ] as const;
    const assetProgram = this.#countyAssetProgram() ?? emptyCountyAssetProgram();
    const orientationValue = this.#elements.countyBackboneOrientation.value;
    const backboneOrientation = isCountyBackboneOrientation(orientationValue) ? orientationValue : null;
    this.#elements.countyBackboneOrientation.setAttribute("aria-invalid", String(backboneOrientation === null));
    if (
      sourceMode === null
      || outputMode === null
      || desiredSettlementCount === null
      || seed === null
      || gridStepM === null
      || maximumGrade === null
      || radiusScale === null
      || localEdgeClearanceM === null
      || backboneWidthM === null
      || accessWidthM === null
      || localWidthM === null
      || drivewayWidthM === null
      || maximumRoutes === null
      || maximumVisitedNodes === null
      || maximumPrefabs === null
      || maximumDriveways === null
      || minimumSeparationM === null
      || edgeClearanceM === null
      || attemptBudgetPerSite === null
      || frontageValues.some((value) => value === null)
      || (outputMode === "full" && assetProgram.house.length === 0)
      || backboneOrientation === null
    ) return null;
    const siteMixValue = this.#elements.countySiteMix.value;
    const siteMix = isCountySiteMix(siteMixValue) ? siteMixValue : null;
    const styleByProfile = this.#countyStyleProgram();
    if (!siteMix || !styleByProfile || (outputMode === "network_only" && sourceMode !== "existing_places")) return null;
    const places = model.list("place").filter((entity): entity is PlaceRegion => entity.kind === "place");
    const selectedExistingPlaceIds = places
      .filter((place) => place.visible && place.place_type !== "military_area")
      .map(({ id }) => id);
    const roads = model.list("road").filter((entity): entity is Road => entity.kind === "road");
    const existingPrefabFootprints = outputMode === "full" && assetCatalog ? model.prefabInstances().map((prefab) => {
      const size = prefabProxySize(prefab, assetCatalog);
      return prefabFootprint(prefab.x_m, prefab.z_m, size.widthM, size.depthM, prefab.rotation_deg);
    }) : [];
    const preferredElevationM = this.#elements.settlementUsePreferredElevation.checked
      ? Number(this.#elements.settlementPreferredElevation.value)
      : null;
    if (preferredElevationM !== null && !Number.isFinite(preferredElevationM)) return null;
    return {
      outputMode,
      sourceMode,
      desiredSettlementCount,
      selectedExistingPlaceIds,
      mainPlaceIdOverride: this.#elements.countyMainPlace.value || null,
      existingPlaces: places,
      existingRoads: roads,
      existingPrefabFootprints,
      createBackbone: this.#elements.countyCreateBackbone.checked,
      backboneOrientation,
      routing: {
        gridStepM,
        slopeWeight: 42,
        maximumGrade,
        turnPenaltyM: 4,
        edgeClearanceM: 0,
      },
      roadStyles: {
        backbone: { ...DEFAULT_COUNTY_ROAD_STYLES.backbone, widthM: backboneWidthM },
        access: { ...DEFAULT_COUNTY_ROAD_STYLES.access, widthM: accessWidthM },
        local: { ...DEFAULT_COUNTY_ROAD_STYLES.local, widthM: localWidthM },
        terminal: { ...DEFAULT_COUNTY_ROAD_STYLES.terminal, widthM: localWidthM },
        farmYard: { ...DEFAULT_COUNTY_ROAD_STYLES.farmYard, widthM: localWidthM },
        driveway: { ...DEFAULT_COUNTY_ROAD_STYLES.driveway, widthM: drivewayWidthM },
      },
      survey: {
        minimumSeparationM,
        edgeClearanceM,
        preferredElevationM,
        attemptBudgetPerSite,
        radiusScale,
        siteMix,
      },
      styleByProfile,
      budgets: { maximumRoutes, maximumVisitedNodes, maximumPrefabs, maximumDriveways },
      localStreets: {
        edgeClearanceM: localEdgeClearanceM,
        minimumRoadLengthM: Math.max(4, gridStepM * 0.2),
        sampleStepM: Math.max(1, Math.min(10, workingTerrain.spacingM / 2)),
        maximumGrade,
      },
      frontage: {
        side: "both",
        setbackM: frontageValues[0] ?? 0,
        gapM: frontageValues[1] ?? 0,
        endClearanceM: frontageValues[2] ?? 0,
        maximumPlotSlopeDeg: frontageValues[3] ?? 0,
        junctionClearanceM: frontageValues[4] ?? 0,
        spacingJitterM: frontageValues[5] ?? 0,
        yawJitterDeg: frontageValues[6] ?? 0,
        seed,
        drivewaysEnabled: this.#elements.countyDriveways.checked,
      },
      assetProgram,
      seed,
      sourceRevision: this.#store.state.revision,
    };
  }

  #generateCountyPreview(): void {
    const input = this.#countyBuildInput();
    const terrain = this.#store.state.workingTerrain;
    this.#countyBuilder.cancel();
    this.#countyBuildResult = null;
    this.#countyBuildProgress = null;
    this.#countyBuildError = null;
    this.#countyBuildInvalidated = false;
    if (!input || !terrain) {
      this.#countyBuildError = "Map a valid house asset and correct the highlighted county settings before generating.";
      this.#renderCountyBuildControls();
      this.#syncProjection();
      return;
    }
    try {
      this.#countyBuildRunning = true;
      this.#countyBuildSourceRevision = input.sourceRevision;
      this.#countyBuildSettingsKey = countyBuildInputKey(input);
      this.#elements.statusMessage.textContent = "Build County started — surveying and planning without changing the project";
      this.#countyBuilder.start(input, copyCountyBuildTerrain(terrain), {
        onProgress: (progress) => {
          this.#countyBuildProgress = progress;
          this.#renderCountyBuildControls();
        },
        onResult: (result) => {
          this.#countyBuildRunning = false;
          this.#countyBuildProgress = null;
          this.#countyBuildResult = result;
          this.#countyBuildError = result.status === "failure"
            ? result.diagnostics[0]?.message ?? "The county build failed."
            : null;
          if (result.status === "success") {
            const plan = result.output;
            this.#elements.statusMessage.textContent = plan.complete
              ? `Complete county preview ready — ${plan.places.length.toLocaleString()} settlements, ${plan.roads.length.toLocaleString()} roads, ${plan.prefabs.length.toLocaleString()} buildings · project unchanged`
              : "County preview is incomplete — review its diagnostics; project unchanged";
          } else {
            this.#elements.statusMessage.textContent = `Build County could not complete — ${this.#countyBuildError ?? "unknown error"}`;
          }
          this.#renderCountyBuildControls();
          this.#syncProjection();
        },
        onError: (message) => {
          this.#countyBuildRunning = false;
          this.#countyBuildProgress = null;
          this.#countyBuildResult = null;
          this.#countyBuildError = message;
          this.#elements.statusMessage.textContent = `Build County worker failed — ${message}`;
          this.#renderCountyBuildControls();
          this.#syncProjection();
        },
      });
    } catch (error) {
      this.#countyBuildRunning = false;
      this.#countyBuildSourceRevision = null;
      this.#countyBuildSettingsKey = null;
      this.#countyBuildError = error instanceof Error ? error.message : String(error);
    }
    this.#renderCountyBuildControls();
    this.#syncProjection();
  }

  #countyBuildInputChanged(): void {
    if (this.#countyBuildRunning || this.#countyBuildResult || this.#countyBuildError) {
      this.#invalidateCountyBuild();
    } else {
      this.#renderCountyBuildControls();
    }
  }

  #invalidateCountyBuild(): void {
    this.#countyBuilder.cancel();
    this.#countyBuildResult = null;
    this.#countyBuildProgress = null;
    this.#countyBuildRunning = false;
    this.#countyBuildSourceRevision = null;
    this.#countyBuildSettingsKey = null;
    this.#countyBuildError = null;
    this.#countyBuildInvalidated = true;
    this.#renderCountyBuildControls();
    this.#syncProjection();
  }

  #cancelCountyBuild(showStatus: boolean): void {
    const cancelled = this.#countyBuilder.cancel();
    this.#countyBuildResult = null;
    this.#countyBuildProgress = null;
    this.#countyBuildRunning = false;
    this.#countyBuildSourceRevision = null;
    this.#countyBuildSettingsKey = null;
    this.#countyBuildError = null;
    this.#countyBuildInvalidated = false;
    if (showStatus && cancelled) this.#elements.statusMessage.textContent = "Build County cancelled — project unchanged";
    this.#renderCountyBuildControls();
    this.#syncProjection();
  }

  #clearCountyBuild(showStatus: boolean): void {
    this.#countyBuilder.cancel();
    this.#countyBuildResult = null;
    this.#countyBuildProgress = null;
    this.#countyBuildRunning = false;
    this.#countyBuildSourceRevision = null;
    this.#countyBuildSettingsKey = null;
    this.#countyBuildError = null;
    this.#countyBuildInvalidated = false;
    if (showStatus) this.#elements.statusMessage.textContent = "County preview cleared — project unchanged";
    this.#renderCountyBuildControls();
    this.#syncProjection();
  }

  #bakeCounty(): void {
    const model = this.#store.state.model;
    const result = this.#countyBuildResult;
    const input = this.#countyBuildInput();
    if (!model || result?.status !== "success" || !result.output.complete || !input) return;
    if (
      this.#countyBuildSourceRevision !== this.#store.state.revision
      || this.#countyBuildSettingsKey !== countyBuildInputKey(input)
    ) {
      this.#invalidateCountyBuild();
      return;
    }
    try {
      const entities = materializeCountyPlan(result.output, model.all().map(({ name }) => name), newEntityId);
      if (entities.length === 0) throw new Error("The complete county plan contains no new entities to bake.");
      const counts = {
        places: entities.filter(({ kind }) => kind === "place").length,
        roads: entities.filter(({ kind }) => kind === "road").length,
        prefabs: entities.filter(({ kind }) => kind === "prefab").length,
      };
      this.#selectedId = [...entities].reverse().find(({ kind }) => kind === "prefab")?.id ?? entities.at(-1)?.id ?? null;
      this.#selectedVertex = null;
      const networkOnly = input.outputMode === "network_only";
      this.#store.addEntities(
        entities,
        networkOnly
          ? `Build settlement network (${String(counts.roads)} roads)`
          : `Build county (${String(counts.places)} places, ${String(counts.roads)} roads, ${String(counts.prefabs)} prefabs)`,
      );
      this.#countyBuilder.cancel();
      this.#countyBuildResult = null;
      this.#countyBuildProgress = null;
      this.#countyBuildRunning = false;
      this.#countyBuildSourceRevision = null;
      this.#countyBuildSettingsKey = null;
      this.#countyBuildError = null;
      this.#countyBuildInvalidated = false;
      this.#elements.statusMessage.textContent = networkOnly
        ? `Baked settlement network atomically — ${counts.roads.toLocaleString()} roads · one undo removes the complete network`
        : `Baked county atomically — ${counts.places.toLocaleString()} places, ${counts.roads.toLocaleString()} roads, ${counts.prefabs.toLocaleString()} prefabs · one undo removes the complete build`;
    } catch (error) {
      this.#countyBuildError = error instanceof Error ? error.message : String(error);
      this.#elements.statusMessage.textContent = `County bake failed without mutation — ${this.#countyBuildError}`;
      this.#renderCountyBuildControls();
      this.#syncProjection();
    }
  }

  #renderCountyBuildControls(): void {
    const { model, workingTerrain, assetCatalog } = this.#store.state;
    const input = model && workingTerrain ? this.#countyBuildInput() : null;
    const result = this.#countyBuildResult;
    const plan: CountyBuildPlan | null = result?.status === "success" ? result.output : null;
    const summary = this.#elements.countyBuildSummary;
    const networkOnly = this.#elements.countyOutputMode.value === "network_only";
    if (networkOnly && this.#elements.countySourceMode.value !== "existing_places") {
      this.#elements.countySourceMode.value = "existing_places";
    }
    this.#elements.countySourceMode.disabled = networkOnly;
    this.#elements.countySiteMix.disabled = networkOnly;
    this.#elements.countyMainPlace.disabled = this.#elements.countySourceMode.value !== "existing_places";
    this.#elements.countyDriveways.disabled = networkOnly;
    this.#elements.generateCountyButton.textContent = networkOnly ? "Generate Network Preview" : "Generate County Preview";
    this.#elements.bakeCountyButton.textContent = networkOnly ? "Bake Roads" : "Bake County";
    summary.classList.remove("has-preview", "has-warning", "has-error");
    this.#elements.countyBackboneOrientation.disabled = !this.#elements.countyCreateBackbone.checked;
    for (const select of this.#elements.countyAssetRoleSelects) select.disabled = networkOnly || !model || !assetCatalog;
    if (!model || !workingTerrain) {
      summary.textContent = "Create a terrain project to build a county.";
    } else if (this.#countyBuildRunning) {
      summary.textContent = this.#countyBuildProgress?.message ?? "Preparing the complete county build…";
      summary.classList.add("has-preview");
    } else if (this.#countyBuildError) {
      summary.textContent = this.#countyBuildError;
      summary.classList.add("has-error");
    } else if (plan) {
      const driveways = plan.roads.filter(({ role }) => role === "property_access").length;
      summary.textContent = `${plan.complete ? "Complete" : "Incomplete"} preview · ${plan.places.length.toLocaleString()} settlements · ${plan.roads.length.toLocaleString()} roads · ${plan.junctions.length.toLocaleString()} junctions · ${plan.prefabs.length.toLocaleString()} buildings · ${driveways.toLocaleString()} driveways`;
      summary.classList.add(plan.complete ? "has-preview" : "has-warning");
    } else if (this.#countyBuildInvalidated) {
      summary.textContent = "County inputs or project sources changed; generate the complete preview again.";
      summary.classList.add("has-warning");
    } else if (!input) {
      summary.textContent = networkOnly
        ? "Use visible existing places and an existing network or backbone."
        : assetCatalog
          ? "Map a required house asset and correct the highlighted county settings."
          : "Load an asset catalogue and map a required house asset.";
      summary.classList.add("has-warning");
    } else if (input.sourceMode === "existing_places") {
      summary.textContent = `${input.selectedExistingPlaceIds.length.toLocaleString()} visible existing places available · generate a complete county preview.`;
    } else {
      summary.textContent = `Survey and build ${input.desiredSettlementCount.toLocaleString()} settlements as one complete preview.`;
    }

    const progress = this.#countyBuildProgress;
    this.#elements.countyBuildProgress.hidden = !this.#countyBuildRunning;
    this.#elements.countyBuildProgress.max = Math.max(1, progress?.total ?? 1);
    this.#elements.countyBuildProgress.value = Math.max(0, progress?.completed ?? 0);
    const diagnostics = result?.status === "success" ? result.output.diagnostics
      : result?.status === "failure" ? result.diagnostics : [];
    this.#elements.countyBuildDiagnostics.innerHTML = diagnostics.map((diagnostic) => (
      `<p class="county-build-diagnostic" data-severity="${diagnostic.severity}"><strong>${escapeHtml(labelFor(diagnostic.code))}</strong><br />${escapeHtml(diagnostic.message)}</p>`
    )).join("");

    const currentKey = input ? countyBuildInputKey(input) : null;
    const currentPlan = plan?.complete
      && this.#countyBuildSourceRevision === this.#store.state.revision
      && currentKey !== null
      && currentKey === this.#countyBuildSettingsKey;
    this.#elements.generateCountyButton.disabled = !input || this.#countyBuildRunning;
    this.#elements.cancelCountyButton.disabled = !this.#countyBuildRunning;
    this.#elements.bakeCountyButton.disabled = !currentPlan;
    this.#elements.clearCountyButton.disabled = !this.#countyBuildRunning
      && !this.#countyBuildResult
      && !this.#countyBuildError
      && !this.#countyBuildInvalidated;
    this.#renderCountyPreviewFilterChoices(plan);
  }

  #renderCountyPreviewFilterChoices(plan: CountyBuildPlan | null): void {
    const previous = this.#elements.countyPreviewPlaceFilter.value;
    const options = plan?.places ?? [];
    this.#elements.countyPreviewPlaceFilter.innerHTML = `<option value="">All settlements</option>${options.map((place) => (
      `<option value="${escapeHtml(place.planId)}">${escapeHtml(place.name)}</option>`
    )).join("")}`;
    this.#elements.countyPreviewPlaceFilter.value = options.some(({ planId }) => planId === previous) ? previous : "";
    this.#elements.countyPreviewPlaceFilter.disabled = !plan;
    for (const filter of this.#elements.countyPreviewClassFilters) filter.disabled = !plan;
  }

  #settlementProfileChanged(): void {
    const profileId = this.#elements.settlementProfile.value;
    if (!isSettlementSurveyProfileId(profileId)) return;
    const profile = settlementSurveyProfile(profileId);
    this.#elements.settlementRadius.value = String(profile.radiusM);
    this.#elements.settlementMaximumSlope.value = gradeToDegrees(profile.maximumGrade).toFixed(1);
    this.#settlementSurveyInputChanged();
  }

  #settlementSurveyInputChanged(): void {
    const hadFeedback = this.#settlementSurveyResult !== null || this.#settlementSurveyError !== null;
    this.#settlementSurveyResult = null;
    this.#settlementSurveySelected.clear();
    this.#settlementSurveyTerrain = null;
    this.#settlementSurveyPlacesKey = null;
    this.#settlementSurveyError = null;
    this.#settlementSurveyInvalidated = hadFeedback;
    this.#renderSettlementSurveyControls();
    this.#syncProjection();
  }

  #settlementSurveySettings(): SettlementSurveySettings | null {
    const profileValue = this.#elements.settlementProfile.value;
    const profile = isSettlementSurveyProfileId(profileValue) ? profileValue : null;
    this.#elements.settlementProfile.setAttribute("aria-invalid", String(profile === null));
    const desiredCount = surveyInputNumber(
      this.#elements.settlementCandidateCount,
      (value) => Number.isSafeInteger(value) && value >= 1 && value <= 100,
    );
    const radiusM = surveyInputNumber(this.#elements.settlementRadius, (value) => value > 0);
    const maximumSlopeDeg = surveyInputNumber(
      this.#elements.settlementMaximumSlope,
      (value) => value > 0 && value < 90,
    );
    const minimumSeparationM = surveyInputNumber(
      this.#elements.settlementMinimumSeparation,
      (value) => value >= 0,
    );
    const edgeClearanceM = surveyInputNumber(
      this.#elements.settlementEdgeClearance,
      (value) => value >= 0,
    );
    const seed = surveyInputNumber(this.#elements.settlementSeed, Number.isSafeInteger);
    const attemptBudget = surveyInputNumber(
      this.#elements.settlementAttemptBudget,
      (value) => Number.isSafeInteger(value) && value >= 1 && value <= 100_000,
    );
    const usePreferredElevation = this.#elements.settlementUsePreferredElevation.checked;
    const preferredElevationM = usePreferredElevation
      ? surveyInputNumber(this.#elements.settlementPreferredElevation, () => true)
      : null;
    if (!usePreferredElevation) this.#elements.settlementPreferredElevation.setAttribute("aria-invalid", "false");
    if (
      profile === null
      || desiredCount === null
      || radiusM === null
      || maximumSlopeDeg === null
      || minimumSeparationM === null
      || edgeClearanceM === null
      || seed === null
      || attemptBudget === null
      || (usePreferredElevation && preferredElevationM === null)
    ) return null;
    return {
      profile,
      desiredCount,
      radiusM,
      maximumSlopeDeg,
      minimumSeparationM,
      edgeClearanceM,
      preferredElevationM,
      seed,
      attemptBudget,
    };
  }

  #runSettlementSurvey(): void {
    const { model, workingTerrain } = this.#store.state;
    if (!model || !workingTerrain) return;
    const settings = this.#settlementSurveySettings();
    this.#settlementSurveyInvalidated = false;
    this.#settlementSurveyError = null;
    this.#settlementSurveyResult = null;
    this.#settlementSurveySelected.clear();
    if (!settings) {
      this.#settlementSurveyError = "Correct the highlighted survey inputs before running.";
      this.#renderSettlementSurveyControls();
      this.#syncProjection();
      return;
    }
    const places = model.list("place").filter((entity): entity is PlaceRegion => entity.kind === "place");
    try {
      this.#settlementSurveyResult = runSettlementSurvey(workingTerrain, places, settings);
      this.#settlementSurveyTerrain = workingTerrain;
      this.#settlementSurveyPlacesKey = settlementPlacesKey(places);
      if (this.#settlementSurveyResult.status === "success") {
        const first = this.#settlementSurveyResult.output.candidates[0];
        if (first) this.#settlementSurveySelected.add(first.id);
        const count = this.#settlementSurveyResult.output.candidates.length;
        const partial = this.#settlementSurveyResult.output.attemptBudgetExhausted
          ? ` of ${String(settings.desiredCount)} requested`
          : "";
        this.#elements.statusMessage.textContent = `Settlement survey found ${String(count)} ranked candidate${count === 1 ? "" : "s"}${partial} — preview only`;
      } else {
        this.#elements.statusMessage.textContent = `Settlement survey found no valid site in ${String(settings.attemptBudget)} attempts — project unchanged`;
      }
    } catch (error) {
      this.#settlementSurveyTerrain = null;
      this.#settlementSurveyPlacesKey = null;
      this.#settlementSurveyError = error instanceof Error ? error.message : String(error);
      this.#elements.statusMessage.textContent = `Settlement survey could not run — ${this.#settlementSurveyError}`;
    }
    this.#renderSettlementSurveyControls();
    this.#syncProjection();
  }

  #renderSettlementSurveyControls(): void {
    const model = this.#store.state.model;
    const summary = this.#elements.settlementSurveySummary;
    const usePreferredElevation = this.#elements.settlementUsePreferredElevation.checked;
    this.#elements.settlementPreferredElevation.disabled = !model || !usePreferredElevation;
    this.#elements.settlementPreferredElevation.closest("label")?.classList.toggle("is-disabled", !usePreferredElevation);
    summary.classList.remove("has-preview", "has-warning", "has-error");
    const settings = model ? this.#settlementSurveySettings() : null;
    const result = this.#settlementSurveyResult;
    if (!model) {
      summary.textContent = "Create a terrain project to survey settlement sites.";
    } else if (this.#settlementSurveyError) {
      summary.textContent = this.#settlementSurveyError;
      summary.classList.add("has-error");
    } else if (!settings) {
      summary.textContent = "Correct the highlighted survey inputs before running.";
      summary.classList.add("has-error");
    } else if (this.#settlementSurveyInvalidated) {
      summary.textContent = "Survey inputs or source terrain changed; run the survey again.";
      summary.classList.add("has-warning");
    } else if (result?.status === "failure") {
      const rejected = surveyRejectionText(result.rejections);
      summary.textContent = `No valid sites after ${settings.attemptBudget.toLocaleString()} attempts${rejected ? ` · ${rejected}` : ""}. Project unchanged.`;
      summary.classList.add("has-error");
    } else if (result?.status === "success") {
      const count = result.output.candidates.length;
      const selected = this.#settlementSurveySelected.size;
      summary.textContent = `${String(count)} ranked candidate${count === 1 ? "" : "s"} · ${String(selected)} selected${result.output.attemptBudgetExhausted ? ` · attempt budget exhausted before ${String(result.output.desiredCount)}` : ""}`;
      summary.classList.add(result.output.attemptBudgetExhausted ? "has-warning" : "has-preview");
    } else {
      summary.textContent = "Run a deterministic survey over the current working terrain.";
    }

    const candidates = result?.status === "success" ? result.output.candidates : [];
    this.#elements.settlementSurveyCandidates.innerHTML = candidates.map((candidate) => `
      <label class="survey-candidate">
        <input type="checkbox" data-survey-candidate="${escapeHtml(candidate.id)}" ${this.#settlementSurveySelected.has(candidate.id) ? "checked" : ""} />
        <span class="survey-rank">#${String(candidate.rank)}</span>
        <span><strong>${escapeHtml(labelFor(candidate.placeType))} · score ${candidate.score.toFixed(3)}</strong>
          <small>${candidate.center[0].toFixed(0)} / ${candidate.center[1].toFixed(0)} m · slope ${candidate.maximumSlopeDeg.toFixed(2)}° · elev ${candidate.elevationM.toFixed(1)} m</small>
        </span>
      </label>`).join("");
    this.#elements.acceptSettlementsButton.disabled = !model
      || result?.status !== "success"
      || this.#settlementSurveySelected.size === 0;
    this.#elements.clearSettlementSurveyButton.disabled = result === null
      && this.#settlementSurveyError === null
      && !this.#settlementSurveyInvalidated;
  }

  #acceptSurveyedSettlements(): void {
    const model = this.#store.state.model;
    const result = this.#settlementSurveyResult;
    if (!model || result?.status !== "success") return;
    const candidates = result.output.candidates.filter((candidate) => this.#settlementSurveySelected.has(candidate.id));
    if (candidates.length === 0) return;
    const usedNames = new Set(model.all().map((entity) => entity.name));
    const entities: PlaceRegion[] = candidates.map((candidate) => ({
      kind: "place",
      id: newEntityId(),
      name: nextUniqueName(labelFor(candidate.placeType), usedNames),
      visible: true,
      locked: false,
      place_type: candidate.placeType,
      points: candidate.boundary,
    }));
    this.#settlementSurveyResult = null;
    this.#settlementSurveySelected.clear();
    this.#settlementSurveyTerrain = null;
    this.#settlementSurveyPlacesKey = null;
    this.#settlementSurveyError = null;
    this.#settlementSurveyInvalidated = false;
    this.#selectedId = entities.at(-1)?.id ?? null;
    this.#selectedVertex = null;
    const label = `Accept ${String(entities.length)} surveyed settlement${entities.length === 1 ? "" : "s"}`;
    this.#store.addEntities(entities, label);
    this.#elements.statusMessage.textContent = `Accepted ${String(entities.length)} surveyed settlement${entities.length === 1 ? "" : "s"} as one undoable edit`;
  }

  #clearSettlementSurvey(showStatus: boolean): void {
    this.#settlementSurveyResult = null;
    this.#settlementSurveySelected.clear();
    this.#settlementSurveyTerrain = null;
    this.#settlementSurveyPlacesKey = null;
    this.#settlementSurveyError = null;
    this.#settlementSurveyInvalidated = false;
    if (showStatus) this.#elements.statusMessage.textContent = "Settlement survey preview cleared";
    this.#renderSettlementSurveyControls();
    this.#syncProjection();
  }

  #frontageClick(point: PointXZ): void {
    const model = this.#store.state.model;
    if (!model) return;
    if (!this.#elements.layerRoads.checked) {
      this.#elements.statusMessage.textContent = "Turn on the Native roads layer before choosing a frontage range";
      return;
    }
    const roads = model.list("road").filter((entity): entity is Road => entity.kind === "road");
    const anchor = closestRoadAnchor(roads, point, this.#viewport.worldUnitsPerPixel() * 10);
    if (!anchor) {
      this.#elements.statusMessage.textContent = "Frontage point must be on a visible native road";
      return;
    }
    if (!this.#frontageStart || this.#frontageEnd) {
      this.#frontageStart = anchor;
      this.#frontageEnd = null;
      this.#frontagePlan = null;
      const road = model.get(anchor.roadId);
      this.#elements.statusMessage.textContent = `Frontage start set on ${road?.name ?? "road"} — click the end point on the same road`;
    } else if (anchor.roadId !== this.#frontageStart.roadId) {
      this.#elements.statusMessage.textContent = "The frontage end must be on the same road as the start";
      return;
    } else if (Math.abs(anchor.distanceM - this.#frontageStart.distanceM) < 0.01) {
      this.#elements.statusMessage.textContent = "Choose a different end point to define a road stretch";
      return;
    } else {
      this.#frontageEnd = anchor;
      this.#recomputeFrontagePlan();
      const ready = this.#frontagePlan?.acceptedCount ?? 0;
      const skipped = (this.#frontagePlan?.candidates.length ?? 0) - ready;
      this.#elements.statusMessage.textContent = `Frontage preview ready — ${ready.toLocaleString()} house${ready === 1 ? "" : "s"}${skipped > 0 ? `, ${skipped.toLocaleString()} skipped` : ""}`;
    }
    this.#renderFrontageControls();
    this.#syncProjection();
  }

  #assetSelectionChanged(): void {
    this.#invalidateSettlementFrontage();
    const asset = this.#selectedAsset();
    const hasRoad = (this.#store.state.model?.list("road").length ?? 0) > 0;
    const frontageAvailable = asset?.category === "house" && hasRoad;
    this.#elements.frontageOptions.disabled = !frontageAvailable;
    const frontageButton = this.#elements.toolButtons.find((button) => button.dataset.tool === "frontage");
    if (frontageButton) frontageButton.disabled = !frontageAvailable;
    if (this.#tool === "frontage" && this.#selectedAsset()?.category !== "house") {
      this.#setTool("select");
      this.#elements.statusMessage.textContent = "Frontage assist stopped — choose a house asset to use it";
      return;
    }
    this.#recomputeFrontagePlan();
    this.#renderFrontageControls();
    this.#renderSettlementFrontageControls();
    this.#syncProjection();
  }

  #frontageOptionsChanged(): void {
    this.#invalidateSettlementFrontage();
    this.#recomputeFrontagePlan();
    this.#renderFrontageControls();
    this.#renderSettlementFrontageControls();
    this.#syncProjection();
  }

  #frontageSettings(): FrontageSettings | null {
    const checked = this.#elements.frontageSideInputs.find((input) => input.checked)?.value;
    const side = isFrontageSide(checked) ? checked : "left";
    const values: readonly [HTMLInputElement, number, boolean][] = [
      [this.#elements.frontageSetback, Number(this.#elements.frontageSetback.value), this.#elements.frontageSetback.value.trim().length > 0],
      [this.#elements.frontageGap, Number(this.#elements.frontageGap.value), this.#elements.frontageGap.value.trim().length > 0],
      [this.#elements.frontageEndClearance, Number(this.#elements.frontageEndClearance.value), this.#elements.frontageEndClearance.value.trim().length > 0],
    ];
    let valid = true;
    for (const [input, value, present] of values) {
      const invalid = !present || !Number.isFinite(value) || value < 0;
      input.setAttribute("aria-invalid", String(invalid));
      valid &&= !invalid;
    }
    if (!valid) return null;
    return {
      side,
      setbackM: values[0]?.[1] ?? 0,
      gapM: values[1]?.[1] ?? 0,
      endClearanceM: values[2]?.[1] ?? 0,
    };
  }

  #recomputeFrontagePlan(): void {
    if (!this.#frontageStart || !this.#frontageEnd) {
      this.#frontagePlan = null;
      return;
    }
    const model = this.#store.state.model;
    const asset = this.#selectedAsset();
    const settings = this.#frontageSettings();
    const road = model?.get(this.#frontageStart.roadId);
    if (!model || asset?.category !== "house" || !settings || road?.kind !== "road") {
      this.#frontagePlan = null;
      if (road?.kind !== "road") {
        this.#frontageStart = null;
        this.#frontageEnd = null;
      }
      return;
    }
    const proxy = prefabProxySize({ category: asset.category, scale: 1 }, this.#store.state.assetCatalog);
    const roads = model.list("road").filter((entity): entity is Road => entity.kind === "road");
    this.#frontagePlan = buildFrontagePlan(
      road,
      this.#frontageStart,
      this.#frontageEnd,
      proxy,
      settings,
      model.bounds,
      roads,
      model.prefabInstances(),
      this.#store.state.assetCatalog,
    );
  }

  #renderFrontageControls(): void {
    const model = this.#store.state.model;
    const asset = this.#selectedAsset();
    const hasRoad = (model?.list("road").length ?? 0) > 0;
    const summary = this.#elements.frontageSummary;
    summary.classList.remove("has-preview", "has-skips");
    if (!model) {
      summary.textContent = "Create a terrain project to begin.";
    } else if (asset?.category !== "house") {
      summary.textContent = "Select a house asset to enable frontage assist.";
    } else if (!hasRoad) {
      summary.textContent = "Create at least one native road to begin.";
    } else if (!this.#frontageSettings()) {
      summary.textContent = "Setback, gap, and end clearance must be zero or greater.";
    } else if (!this.#frontageStart) {
      summary.textContent = this.#tool === "frontage"
        ? "Click the first point of the road stretch."
        : "Turn on Frontage assist, then click a road stretch.";
    } else if (!this.#frontageEnd) {
      const road = model.get(this.#frontageStart.roadId);
      summary.textContent = `Start set on ${road?.name ?? "road"}; click the end point on the same road.`;
      summary.classList.add("has-preview");
    } else if (this.#frontagePlan) {
      const plan = this.#frontagePlan;
      const skippedCount = plan.candidates.length - plan.acceptedCount;
      const reasons = [
        plan.skipped.prefab_overlap > 0 ? `${String(plan.skipped.prefab_overlap)} overlapping` : "",
        plan.skipped.road_clash > 0 ? `${String(plan.skipped.road_clash)} road-clashing` : "",
        plan.skipped.outside_world > 0 ? `${String(plan.skipped.outside_world)} out-of-world` : "",
      ].filter((value) => value.length > 0);
      summary.textContent = plan.candidates.length === 0
        ? `${plan.rangeLengthM.toFixed(1)} m range is too short for this house and the current clearances.`
        : `${plan.acceptedCount.toLocaleString()} ready · ${plan.rangeLengthM.toFixed(1)} m range${skippedCount > 0 ? ` · ${skippedCount.toLocaleString()} skipped (${reasons.join(", ")})` : ""}`;
      summary.classList.add("has-preview");
      if (skippedCount > 0) summary.classList.add("has-skips");
    }
    this.#elements.generateFrontageButton.disabled = this.#tool !== "frontage" || (this.#frontagePlan?.acceptedCount ?? 0) === 0;
    this.#elements.clearFrontageButton.disabled = !this.#frontageStart;
  }

  #generateFrontage(): void {
    const model = this.#store.state.model;
    const asset = this.#selectedAsset();
    const plan = this.#frontagePlan;
    if (!model || asset?.category !== "house" || !plan) return;
    const candidates = plan.candidates.filter((candidate) => candidate.skipReason === null);
    if (candidates.length === 0) return;
    const usedNames = new Set(model.all().map((entity) => entity.name));
    const entities: PrefabInstance[] = candidates.map((candidate) => ({
      kind: "prefab",
      id: newEntityId(),
      name: nextUniqueName(asset.display_name, usedNames),
      visible: true,
      locked: false,
      category: asset.category,
      asset_id: asset.asset_id,
      x_m: candidate.xM,
      z_m: candidate.zM,
      rotation_deg: candidate.rotationDeg,
      scale: 1,
      frontage_road_id: plan.roadId,
      terrain_pad: { ...DEFAULT_TERRAIN_PAD, enabled: false },
    }));
    const skippedCount = plan.candidates.length - plan.acceptedCount;
    this.#frontageStart = null;
    this.#frontageEnd = null;
    this.#frontagePlan = null;
    this.#selectedId = entities.at(-1)?.id ?? null;
    this.#selectedVertex = null;
    this.#store.addEntities(entities, `Generate ${String(entities.length)} frontage houses`);
    this.#elements.statusMessage.textContent = `Generated ${entities.length.toLocaleString()} frontage house${entities.length === 1 ? "" : "s"} as one undoable edit${skippedCount > 0 ? ` · skipped ${skippedCount.toLocaleString()}` : ""}`;
  }

  #clearFrontageRange(showStatus: boolean): void {
    this.#frontageStart = null;
    this.#frontageEnd = null;
    this.#frontagePlan = null;
    if (showStatus) this.#elements.statusMessage.textContent = "Frontage range cleared";
    this.#renderFrontageControls();
    this.#syncProjection();
  }

  #selectedSettlement(): PlaceRegion | null {
    const selected = this.#selectedId ? this.#store.state.model?.get(this.#selectedId) : undefined;
    return selected?.kind === "place" ? selected : null;
  }

  #settlementFrontageEligibility(settlement: PlaceRegion): readonly SettlementRoadEligibility[] {
    const model = this.#store.state.model;
    if (!model) return [];
    const roads = model.list("road").filter((entity): entity is Road => entity.kind === "road");
    return settlementRoadEligibility(settlement, roads, model.bounds);
  }

  #syncSettlementFrontageContext(
    settlement: PlaceRegion | null,
    eligibility: readonly SettlementRoadEligibility[],
  ): void {
    const placeId = settlement?.id ?? null;
    if (placeId !== this.#settlementFrontagePlaceId) {
      this.#invalidateSettlementFrontage();
      this.#settlementFrontagePlaceId = placeId;
      this.#settlementFrontageRoadIds.clear();
      this.#settlementFrontageRoadsCustomized = false;
    }
    const eligibleIds = new Set(eligibility.map(({ road }) => road.id));
    if (!this.#settlementFrontageRoadsCustomized) {
      this.#settlementFrontageRoadIds.clear();
      for (const { road } of eligibility) {
        if (road.visible) this.#settlementFrontageRoadIds.add(road.id);
      }
    } else {
      for (const id of this.#settlementFrontageRoadIds) {
        if (!eligibleIds.has(id)) this.#settlementFrontageRoadIds.delete(id);
      }
    }
  }

  #settlementFrontageSettings(): SettlementFrontageSettings | null {
    const frontage = this.#frontageSettings();
    const maximumPlotSlopeDeg = surveyInputNumber(
      this.#elements.settlementFrontageMaximumSlope,
      (value) => value > 0 && value < 90,
    );
    const junctionClearanceM = surveyInputNumber(
      this.#elements.settlementFrontageJunctionClearance,
      (value) => value >= 0,
    );
    const spacingJitterM = surveyInputNumber(
      this.#elements.settlementFrontageSpacingJitter,
      (value) => value >= 0,
    );
    const yawJitterDeg = surveyInputNumber(
      this.#elements.settlementFrontageYawJitter,
      (value) => value >= 0 && value <= 180,
    );
    const seed = surveyInputNumber(this.#elements.settlementFrontageSeed, Number.isSafeInteger);
    if (
      !frontage
      || maximumPlotSlopeDeg === null
      || junctionClearanceM === null
      || spacingJitterM === null
      || yawJitterDeg === null
      || seed === null
    ) return null;
    return {
      ...frontage,
      maximumPlotSlopeDeg,
      junctionClearanceM,
      spacingJitterM,
      yawJitterDeg,
      seed,
    };
  }

  #settlementFrontageInputChanged(): void {
    this.#invalidateSettlementFrontage();
    this.#renderSettlementFrontageControls();
    this.#syncProjection();
  }

  #invalidateSettlementFrontage(): void {
    const hadPreview = this.#settlementFrontagePlan !== null;
    this.#settlementFrontagePlan = null;
    this.#settlementFrontageTerrain = null;
    this.#settlementFrontageSourceKey = null;
    this.#settlementFrontageError = null;
    this.#settlementFrontageInvalidated ||= hadPreview;
  }

  #settlementFrontageCurrentSourceKey(): string | null {
    const model = this.#store.state.model;
    const settlement = this.#selectedSettlement();
    const asset = this.#selectedAsset();
    if (!model || !settlement || asset?.category !== "house") return null;
    const roads = model.list("road").filter((entity): entity is Road => entity.kind === "road");
    return JSON.stringify({
      bounds: model.bounds,
      settlement,
      eligibleRoadIds: [...this.#settlementFrontageRoadIds].sort(),
      roads,
      prefabs: model.prefabInstances(),
      asset,
      proxy: prefabProxySize({ category: asset.category, scale: 1 }, this.#store.state.assetCatalog),
    });
  }

  #populateSettlement(): void {
    const { model, workingTerrain, assetCatalog } = this.#store.state;
    const settlement = this.#selectedSettlement();
    const asset = this.#selectedAsset();
    const settings = this.#settlementFrontageSettings();
    this.#settlementFrontagePlan = null;
    this.#settlementFrontageTerrain = null;
    this.#settlementFrontageSourceKey = null;
    this.#settlementFrontageError = null;
    this.#settlementFrontageInvalidated = false;
    if (!model || !workingTerrain || !settlement || asset?.category !== "house" || !settings) {
      this.#settlementFrontageError = "Select a place and house asset, then correct the highlighted population settings.";
    } else if (this.#settlementFrontageRoadIds.size === 0) {
      this.#settlementFrontageError = "Select at least one road that intersects the settlement.";
    } else {
      try {
        const roads = model.list("road").filter((entity): entity is Road => entity.kind === "road");
        const proxy = prefabProxySize({ category: asset.category, scale: 1 }, assetCatalog);
        this.#settlementFrontagePlan = buildSettlementFrontagePlan({
          settlement,
          eligibleRoadIds: [...this.#settlementFrontageRoadIds],
          roads,
          proxy,
          settings,
          world: model.bounds,
          prefabs: model.prefabInstances(),
          catalog: assetCatalog,
          terrain: workingTerrain,
        });
        this.#settlementFrontageTerrain = workingTerrain;
        this.#settlementFrontageSourceKey = this.#settlementFrontageCurrentSourceKey();
        const accepted = this.#settlementFrontagePlan.acceptedCount;
        const skipped = this.#settlementFrontagePlan.candidates.length - accepted;
        this.#elements.statusMessage.textContent = accepted > 0
          ? `Settlement preview ready — ${accepted.toLocaleString()} house${accepted === 1 ? "" : "s"}${skipped > 0 ? `, ${skipped.toLocaleString()} skipped` : ""}`
          : `Settlement preview produced no safe houses — ${skipped.toLocaleString()} candidate${skipped === 1 ? "" : "s"} skipped; project unchanged`;
      } catch (error) {
        this.#settlementFrontageError = error instanceof Error ? error.message : String(error);
        this.#elements.statusMessage.textContent = `Settlement population could not run — ${this.#settlementFrontageError}`;
      }
    }
    this.#renderSettlementFrontageControls();
    this.#syncProjection();
  }

  #renderSettlementFrontageControls(): void {
    const model = this.#store.state.model;
    const terrain = this.#store.state.workingTerrain;
    const settlement = this.#selectedSettlement();
    const asset = this.#selectedAsset();
    const eligibility = settlement ? this.#settlementFrontageEligibility(settlement) : [];
    this.#syncSettlementFrontageContext(settlement, eligibility);
    const settings = this.#settlementFrontageSettings();
    const summary = this.#elements.settlementFrontageSummary;
    summary.classList.remove("has-preview", "has-warning", "has-error", "has-skips");
    this.#elements.settlementFrontageRoads.innerHTML = eligibility.length === 0
      ? `<p class="settlement-frontage-roads-empty">${settlement ? "No native road intersects this place." : "Select a place to list its intersecting roads."}</p>`
      : eligibility.map(({ road, ranges, totalRangeLengthM }) => `
        <label class="settlement-frontage-road">
          <input type="checkbox" data-settlement-road="${escapeHtml(road.id)}" ${this.#settlementFrontageRoadIds.has(road.id) ? "checked" : ""} />
          <span><strong>${escapeHtml(road.name)}</strong><small>${ranges.length.toLocaleString()} clipped range${ranges.length === 1 ? "" : "s"} · ${totalRangeLengthM.toFixed(1)} m · ${road.visible ? "visible" : "hidden"}</small></span>
        </label>`).join("");

    const plan = this.#settlementFrontagePlan;
    if (!model || !terrain) {
      summary.textContent = "Create a terrain project to populate a settlement.";
    } else if (!settlement) {
      summary.textContent = "Select an editable place region to populate.";
    } else if (asset?.category !== "house") {
      summary.textContent = "Select a house asset from the catalogue.";
    } else if (eligibility.length === 0) {
      summary.textContent = "No native road intersects the selected place; project unchanged.";
      summary.classList.add("has-warning");
    } else if (this.#settlementFrontageRoadIds.size === 0) {
      summary.textContent = "Choose at least one intersecting road.";
      summary.classList.add("has-warning");
    } else if (!settings) {
      summary.textContent = "Correct the highlighted frontage and population settings.";
      summary.classList.add("has-error");
    } else if (this.#settlementFrontageError) {
      summary.textContent = this.#settlementFrontageError;
      summary.classList.add("has-error");
    } else if (plan) {
      const skippedCount = plan.candidates.length - plan.acceptedCount;
      const reasons = settlementFrontageSkipText(plan);
      summary.textContent = `${plan.acceptedCount.toLocaleString()} ready · ${plan.candidates.length.toLocaleString()} evaluated · ${plan.ranges.length.toLocaleString()} clipped road range${plan.ranges.length === 1 ? "" : "s"} · ${plan.junctions.length.toLocaleString()} junction${plan.junctions.length === 1 ? "" : "s"}${skippedCount > 0 ? ` · ${skippedCount.toLocaleString()} skipped (${reasons})` : ""}`;
      summary.classList.add(skippedCount > 0 ? "has-skips" : "has-preview");
    } else if (this.#settlementFrontageInvalidated) {
      summary.textContent = "The previous population preview was invalidated; populate the settlement again.";
      summary.classList.add("has-warning");
    } else {
      summary.textContent = `${settlement.name} · ${this.#settlementFrontageRoadIds.size.toLocaleString()} of ${eligibility.length.toLocaleString()} intersecting roads selected · ${labelFor(settings.side)} side`;
    }

    this.#elements.populateSettlementButton.disabled = !model
      || !terrain
      || !settlement
      || asset?.category !== "house"
      || eligibility.length === 0
      || this.#settlementFrontageRoadIds.size === 0
      || !settings;
    this.#elements.generateSettlementFrontageButton.disabled = !plan
      || plan.acceptedCount === 0
      || this.#settlementFrontageTerrain !== terrain
      || this.#settlementFrontageCurrentSourceKey() !== this.#settlementFrontageSourceKey;
    this.#elements.clearSettlementFrontageButton.disabled = !plan
      && !this.#settlementFrontageError
      && !this.#settlementFrontageInvalidated;
  }

  #generateSettlementFrontage(): void {
    const model = this.#store.state.model;
    const asset = this.#selectedAsset();
    const settlement = this.#selectedSettlement();
    const plan = this.#settlementFrontagePlan;
    if (!model || asset?.category !== "house" || !settlement || !plan) return;
    if (
      this.#settlementFrontageTerrain !== this.#store.state.workingTerrain
      || this.#settlementFrontageCurrentSourceKey() !== this.#settlementFrontageSourceKey
    ) {
      this.#invalidateSettlementFrontage();
      this.#renderSettlementFrontageControls();
      this.#syncProjection();
      return;
    }
    const candidates = plan.candidates.filter(({ skipReason }) => skipReason === null);
    if (candidates.length === 0) return;
    const usedNames = new Set(model.all().map((entity) => entity.name));
    const entities: PrefabInstance[] = candidates.map((candidate) => ({
      kind: "prefab",
      id: newEntityId(),
      name: nextUniqueName(asset.display_name, usedNames),
      visible: true,
      locked: false,
      category: asset.category,
      asset_id: asset.asset_id,
      x_m: candidate.xM,
      z_m: candidate.zM,
      rotation_deg: candidate.rotationDeg,
      scale: 1,
      frontage_road_id: candidate.roadId,
      terrain_pad: { ...DEFAULT_TERRAIN_PAD, enabled: false },
    }));
    const skippedCount = plan.candidates.length - plan.acceptedCount;
    this.#settlementFrontagePlan = null;
    this.#settlementFrontageTerrain = null;
    this.#settlementFrontageSourceKey = null;
    this.#settlementFrontageError = null;
    this.#settlementFrontageInvalidated = false;
    this.#selectedId = entities.at(-1)?.id ?? null;
    this.#selectedVertex = null;
    this.#store.addEntities(entities, `Populate ${settlement.name} with ${String(entities.length)} houses`);
    this.#elements.statusMessage.textContent = `Generated ${entities.length.toLocaleString()} settlement house${entities.length === 1 ? "" : "s"} as one undoable edit${skippedCount > 0 ? ` · skipped ${skippedCount.toLocaleString()}` : ""}`;
  }

  #clearSettlementFrontage(showStatus: boolean): void {
    this.#settlementFrontagePlan = null;
    this.#settlementFrontageTerrain = null;
    this.#settlementFrontageSourceKey = null;
    this.#settlementFrontageError = null;
    this.#settlementFrontageInvalidated = false;
    if (showStatus) this.#elements.statusMessage.textContent = "Settlement population preview cleared — project unchanged";
    this.#renderSettlementFrontageControls();
    this.#syncProjection();
  }

  #roadRouteClick(point: PointXZ): void {
    const { model, workingTerrain } = this.#store.state;
    if (!model || !workingTerrain) return;
    if (this.#roadRouteEnd || this.#roadRouteResult || this.#roadRouteRunning) {
      this.#clearRoadRoute(false);
    }
    const endpoint = this.#resolveRoadRouteEndpoint(point);
    if (!this.#roadRouteStart) {
      this.#roadRouteStart = endpoint;
      this.#roadRouteTerrain = workingTerrain;
      this.#roadRouteInvalidated = false;
      this.#elements.statusMessage.textContent = endpoint.snappedRoadId
        ? "Route start snapped to a visible road — click the destination"
        : "Route start set — click the destination";
      this.#renderRoadRouteControls();
      this.#syncProjection();
      return;
    }
    this.#roadRouteEnd = endpoint;
    this.#startRoadRoute();
  }

  #resolveRoadRouteEndpoint(point: PointXZ): RoadRouteEndpoint {
    const model = this.#store.state.model;
    if (!model || !this.#elements.routeSnapEndpoints.checked || !this.#elements.layerRoads.checked) {
      return { point: [point.x, point.z], snappedRoadId: null };
    }
    const roads = model.list("road").filter((entity): entity is Road => entity.kind === "road");
    const anchor = closestRoadAnchor(roads, point, this.#viewport.worldUnitsPerPixel() * 10);
    return anchor
      ? { point: anchor.point, snappedRoadId: anchor.roadId }
      : { point: [point.x, point.z], snappedRoadId: null };
  }

  #roadRouteSettings(): RoadRouteAuthoringSettings | null {
    const roadClassValue = this.#elements.routeRoadClass.value;
    const surfaceValue = this.#elements.routeRoadSurface.value;
    const roadClass = ROAD_CLASSES.includes(roadClassValue as RoadClass) ? roadClassValue as RoadClass : null;
    const surface = ROAD_SURFACES.includes(surfaceValue as RoadSurface) ? surfaceValue as RoadSurface : null;
    this.#elements.routeRoadClass.setAttribute("aria-invalid", String(roadClass === null));
    this.#elements.routeRoadSurface.setAttribute("aria-invalid", String(surface === null));
    const widthM = surveyInputNumber(this.#elements.routeRoadWidth, (value) => value > 0);
    const gridStepM = surveyInputNumber(this.#elements.routeGridStep, (value) => value > 0);
    const slopeWeight = surveyInputNumber(this.#elements.routeSlopeWeight, (value) => value >= 0);
    const maximumGrade = surveyInputNumber(this.#elements.routeMaximumGrade, (value) => value > 0);
    const turnPenaltyM = surveyInputNumber(this.#elements.routeTurnPenalty, (value) => value >= 0);
    const edgeClearanceM = surveyInputNumber(this.#elements.routeEdgeClearance, (value) => value >= 0);
    const seed = surveyInputNumber(this.#elements.routeSeed, Number.isSafeInteger);
    if (
      roadClass === null
      || surface === null
      || widthM === null
      || gridStepM === null
      || slopeWeight === null
      || maximumGrade === null
      || turnPenaltyM === null
      || edgeClearanceM === null
      || seed === null
    ) return null;
    return {
      roadClass,
      surface,
      widthM,
      seed,
      routing: { gridStepM, slopeWeight, maximumGrade, turnPenaltyM, edgeClearanceM },
    };
  }

  #startRoadRoute(): void {
    const start = this.#roadRouteStart;
    const end = this.#roadRouteEnd;
    const terrain = this.#store.state.workingTerrain;
    const settings = this.#roadRouteSettings();
    this.#roadRouteResult = null;
    this.#roadRouteError = null;
    this.#roadRouteInvalidated = false;
    if (!start || !end || !terrain) return;
    if (!settings) {
      this.#roadRouteError = "Correct the highlighted routing inputs, then click the destination again.";
      this.#roadRouteEnd = null;
      this.#renderRoadRouteControls();
      this.#syncProjection();
      return;
    }
    this.#roadRouteTerrain = terrain;
    this.#roadRouteRunning = true;
    this.#elements.statusMessage.textContent = "Routing road on the working terrain…";
    this.#renderRoadRouteControls();
    this.#syncProjection();
    try {
      this.#roadRouter.start(
        { start: start.point, end: end.point, ...settings.routing },
        settings.seed,
        copyRoadRouteTerrain(terrain),
        {
          onResult: (result) => {
            this.#roadRouteRunning = false;
            this.#roadRouteResult = result;
            this.#roadRouteError = null;
            this.#elements.statusMessage.textContent = result.status === "success"
              ? `Route ready — ${result.output.pathLengthM.toFixed(1)} m, ${(result.output.maximumGrade * 100).toFixed(1)}% maximum grade`
              : `Road routing failed — ${result.diagnostics[0]?.message ?? result.reason}`;
            this.#renderRoadRouteControls();
            this.#syncProjection();
          },
          onError: (message) => {
            this.#roadRouteRunning = false;
            this.#roadRouteResult = null;
            this.#roadRouteError = message;
            this.#elements.statusMessage.textContent = `Road routing worker failed — ${message}`;
            this.#renderRoadRouteControls();
            this.#syncProjection();
          },
        },
      );
    } catch (error) {
      this.#roadRouteRunning = false;
      this.#roadRouteError = error instanceof Error ? error.message : String(error);
      this.#renderRoadRouteControls();
      this.#syncProjection();
    }
  }

  #roadRouteSettingsChanged(): void {
    const hadPreview = this.#roadRouteEnd !== null || this.#roadRouteResult !== null || this.#roadRouteRunning;
    this.#roadRouter.cancel();
    this.#roadRouteEnd = null;
    this.#roadRouteResult = null;
    this.#roadRouteRunning = false;
    this.#roadRouteError = null;
    this.#roadRouteInvalidated = hadPreview;
    this.#renderRoadRouteControls();
    this.#syncProjection();
  }

  #renderRoadRouteControls(): void {
    const summary = this.#elements.routeSummary;
    summary.classList.remove("has-preview", "has-warning", "has-error", "is-running");
    const settings = this.#roadRouteSettings();
    const result = this.#roadRouteResult;
    if (!this.#store.state.model) {
      summary.textContent = "Create a terrain project to begin.";
    } else if (!settings) {
      summary.textContent = "Correct the highlighted routing settings.";
      summary.classList.add("has-error");
    } else if (this.#roadRouteError) {
      summary.textContent = this.#roadRouteError;
      summary.classList.add("has-error");
    } else if (this.#roadRouteRunning) {
      summary.textContent = "Searching the transferred working-terrain snapshot… the editor remains interactive.";
      summary.classList.add("is-running");
    } else if (result?.status === "failure") {
      const visited = result.metrics.find(({ name }) => name === "visited_nodes")?.value ?? 0;
      const elapsed = result.metrics.find(({ name }) => name === "elapsed")?.value ?? 0;
      summary.textContent = `${result.diagnostics[0]?.message ?? "No valid route."} · ${visited.toLocaleString()} nodes · ${elapsed.toFixed(1)} ms · project unchanged`;
      summary.classList.add("has-error");
    } else if (result?.status === "success") {
      summary.textContent = `Route ready · ${result.output.pathLengthM.toFixed(1)} m · max ${(result.output.maximumGrade * 100).toFixed(1)}% · mean ${(result.output.meanGrade * 100).toFixed(1)}% · ${result.output.visitedNodes.toLocaleString()} nodes · cost ${result.output.cost.toFixed(1)} · ${result.output.elapsedMs.toFixed(1)} ms`;
      summary.classList.add("has-preview");
    } else if (this.#roadRouteStart) {
      const road = this.#roadRouteStart.snappedRoadId
        ? this.#store.state.model.get(this.#roadRouteStart.snappedRoadId)?.name
        : null;
      summary.textContent = this.#roadRouteInvalidated
        ? `Settings changed; start retained${road ? ` on ${road}` : ""}. Click a new destination.`
        : `Start set${road ? ` — snapped to ${road}` : ""}. Click the destination.`;
      summary.classList.add(this.#roadRouteInvalidated ? "has-warning" : "has-preview");
    } else if (this.#roadRouteInvalidated) {
      summary.textContent = "The previous route was invalidated. Click a new start and destination.";
      summary.classList.add("has-warning");
    } else {
      summary.textContent = this.#tool === "route_road"
        ? "Click the route start, then its destination."
        : "Turn on Route road, then click a start and destination.";
    }
    this.#elements.acceptRoadRouteButton.disabled = this.#tool !== "route_road"
      || result?.status !== "success"
      || this.#roadRouteTerrain !== this.#store.state.workingTerrain;
    this.#elements.clearRoadRouteButton.disabled = !this.#roadRouteStart
      && !this.#roadRouteEnd
      && !this.#roadRouteResult
      && !this.#roadRouteRunning
      && !this.#roadRouteError;
  }

  #acceptRoadRoute(): void {
    const model = this.#store.state.model;
    const settings = this.#roadRouteSettings();
    const result = this.#roadRouteResult;
    if (!model || !settings || result?.status !== "success") return;
    if (this.#roadRouteTerrain !== this.#store.state.workingTerrain) {
      this.#roadRouteSettingsChanged();
      return;
    }
    const entity: Road = {
      kind: "road",
      id: newEntityId(),
      name: model.nextUniqueName("Road"),
      visible: true,
      locked: false,
      points: result.output.points,
      width_m: settings.widthM,
      road_class: settings.roadClass,
      surface: settings.surface,
    };
    this.#roadRouter.cancel();
    this.#roadRouteStart = null;
    this.#roadRouteEnd = null;
    this.#roadRouteResult = null;
    this.#roadRouteTerrain = null;
    this.#roadRouteRunning = false;
    this.#roadRouteError = null;
    this.#roadRouteInvalidated = false;
    this.#selectedId = entity.id;
    this.#selectedVertex = null;
    this.#store.addEntity(entity, `Create routed ${entity.name}`);
    this.#setTool("select");
    this.#elements.statusMessage.textContent = `Created ${entity.name} from the accepted terrain-aware route as one undoable edit`;
    this.#renderInspector();
  }

  #clearRoadRoute(showStatus: boolean): void {
    this.#roadRouter.cancel();
    this.#roadRouteStart = null;
    this.#roadRouteEnd = null;
    this.#roadRouteResult = null;
    this.#roadRouteTerrain = null;
    this.#roadRouteRunning = false;
    this.#roadRouteError = null;
    this.#roadRouteInvalidated = false;
    if (showStatus) this.#elements.statusMessage.textContent = "Road route preview cancelled — project unchanged";
    this.#renderRoadRouteControls();
    this.#syncProjection();
  }

  #cancelInteraction(): void {
    const cancelledCounty = this.#countyBuildRunning || this.#countyBuildResult !== null;
    const cancelledFrontage = this.#tool === "frontage" && this.#frontageStart !== null;
    const cancelledSurvey = this.#settlementSurveyResult !== null;
    const cancelledRoute = this.#tool === "route_road"
      && (this.#roadRouteStart !== null || this.#roadRouteRunning || this.#roadRouteResult !== null);
    const cancelledSettlementFrontage = this.#settlementFrontagePlan !== null;
    if (this.#drag) {
      this.#store.replaceLive(this.#drag.original);
      this.#drag = null;
    }
    this.#draft = [];
    this.#draftHover = null;
    this.#prefabGhost = null;
    this.#frontageStart = null;
    this.#frontageEnd = null;
    this.#frontagePlan = null;
    this.#settlementSurveyResult = null;
    this.#settlementSurveySelected.clear();
    this.#settlementSurveyTerrain = null;
    this.#settlementSurveyPlacesKey = null;
    this.#settlementSurveyError = null;
    this.#settlementSurveyInvalidated = false;
    this.#roadRouter.cancel();
    this.#roadRouteStart = null;
    this.#roadRouteEnd = null;
    this.#roadRouteResult = null;
    this.#roadRouteTerrain = null;
    this.#roadRouteRunning = false;
    this.#roadRouteError = null;
    this.#roadRouteInvalidated = false;
    this.#settlementFrontagePlan = null;
    this.#settlementFrontageTerrain = null;
    this.#settlementFrontageSourceKey = null;
    this.#settlementFrontageError = null;
    this.#settlementFrontageInvalidated = false;
    this.#countyBuilder.cancel();
    this.#countyBuildResult = null;
    this.#countyBuildProgress = null;
    this.#countyBuildRunning = false;
    this.#countyBuildSourceRevision = null;
    this.#countyBuildSettingsKey = null;
    this.#countyBuildError = null;
    this.#countyBuildInvalidated = false;
    this.#elements.statusMessage.textContent = cancelledCounty
      ? "County preview cancelled — project unchanged"
      : cancelledRoute
      ? "Road route preview cancelled — route tool remains on"
      : cancelledSettlementFrontage
        ? "Settlement population preview cancelled — project unchanged"
      : cancelledSurvey
        ? "Settlement survey preview cancelled"
        : cancelledFrontage ? "Frontage range cancelled — assist remains on" : "Draft cancelled";
    this.#renderFrontageControls();
    this.#renderSettlementSurveyControls();
    this.#renderRoadRouteControls();
    this.#renderSettlementFrontageControls();
    this.#renderCountyBuildControls();
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
    if (before?.kind !== "prefab" && before?.kind !== "vegetation") return;
    if (before.locked) {
      this.#elements.statusMessage.textContent = `${before.name} is locked — unlock it before rotating`;
      return;
    }
    const after = before.kind === "vegetation"
      ? rotateVegetation(before, deltaDeg)
      : { ...before, rotation_deg: normalizeDegrees(before.rotation_deg + deltaDeg) };
    const rotation = after.rotation_deg;
    this.#store.updateEntity(before, after, before.kind === "vegetation" ? "Rotate vegetation" : "Rotate prefab");
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
    if (!before) return;
    const data = new FormData(form);
    try {
      const common = {
        name: requiredText(data, "name"),
        visible: data.get("visible") === "on",
        locked: data.get("locked") === "on",
      };
      let after: GeometryEntity | PrefabInstance | VegetationInstance;
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
        case "vegetation": {
          after = {
            ...before,
            ...common,
            vegetation_type: requiredText(data, "vegetation_type") as VegetationInstance["vegetation_type"],
            asset_id: requiredText(data, "asset_id"),
            x_m: requiredNumber(data, "x_m"),
            z_m: requiredNumber(data, "z_m"),
            rotation_deg: normalizeDegrees(requiredNumber(data, "rotation_deg")),
            scale: requiredNumber(data, "scale"),
            source_region_id: optionalText(data, "source_region_id"),
          };
          if (before.locked && vegetationSpatialFieldsChanged(before, after)) {
            throw new Error("Unlock this vegetation instance and apply before changing its transform");
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
    this.#renderSettlementFrontageControls();
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
      this.#elements.layerNativeVegetation.checked,
      {
        points: this.#draft.map((point) => [point.x, point.z] as PointTuple),
        hover: this.#draftHover ? [this.#draftHover.x, this.#draftHover.z] : null,
      },
      this.#prefabGhost && selectedAsset
        ? { xM: this.#prefabGhost.x, zM: this.#prefabGhost.z, asset: selectedAsset }
        : null,
      this.#frontagePlan,
      this.#settlementSurveyResult?.status === "success"
        ? {
          candidates: this.#settlementSurveyResult.output.candidates,
          selectedIds: this.#settlementSurveySelected,
        }
        : null,
      {
        start: this.#roadRouteStart?.point ?? null,
        end: this.#roadRouteEnd?.point ?? null,
        points: this.#roadRouteResult?.status === "success" ? this.#roadRouteResult.output.points : null,
        widthM: Number.isFinite(Number(this.#elements.routeRoadWidth.value))
          ? Math.max(0.1, Number(this.#elements.routeRoadWidth.value))
          : 7.5,
        running: this.#roadRouteRunning,
      },
      this.#settlementFrontagePlan,
      this.#countyBuildResult?.status === "success" ? this.#countyBuildResult.output : null,
      this.#countyBuildPreviewFilter(),
      this.#store.state.countyReference,
      this.#store.state.vegetationReference,
      this.#referenceLayers(),
    );
  }

  #renderInspector(): void {
    const model = this.#store.state.model;
    const terrain = this.#store.state.workingTerrain;
    const selected = this.#selectedId ? model?.get(this.#selectedId) : undefined;
    if (selected && model && terrain) {
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
      ["Native vegetation", model.vegetationInstances().length.toLocaleString()],
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

  #referenceLayers(): {
    readonly vegetation: boolean;
    readonly countySettlements: boolean;
    readonly countyRoads: boolean;
    readonly countyBuildings: boolean;
  } {
    return {
      vegetation: this.#elements.layerVegetationReference.checked,
      countySettlements: this.#elements.layerCountySettlements.checked,
      countyRoads: this.#elements.layerCountyRoads.checked,
      countyBuildings: this.#elements.layerCountyBuildings.checked,
    };
  }

  #countyBuildPreviewFilter(): CountyBuildPreviewFilter {
    const enabled = new Set(this.#elements.countyPreviewClassFilters
      .filter(({ checked }) => checked)
      .map(({ dataset }) => dataset.countyPreviewClass));
    return {
      placePlanId: this.#elements.countyPreviewPlaceFilter.value || null,
      places: enabled.has("places"),
      roads: enabled.has("roads"),
      prefabs: enabled.has("prefabs"),
      junctions: enabled.has("junctions"),
      skipped: enabled.has("skipped"),
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
        case "vegetation": return this.#elements.layerNativeVegetation.checked;
      }
    })();
    if (!remainsVisible) {
      this.#selectedId = null;
      this.#selectedVertex = null;
    }
    this.#renderInteraction();
  }

  #resetInteraction(): void {
    this.#roadRouter.cancel();
    this.#countyBuilder.cancel();
    this.#selectedId = null;
    this.#selectedVertex = null;
    this.#draft = [];
    this.#draftHover = null;
    this.#drag = null;
    this.#prefabGhost = null;
    this.#frontageStart = null;
    this.#frontageEnd = null;
    this.#frontagePlan = null;
    this.#settlementSurveyResult = null;
    this.#settlementSurveySelected.clear();
    this.#settlementSurveyTerrain = null;
    this.#settlementSurveyPlacesKey = null;
    this.#settlementSurveyError = null;
    this.#settlementSurveyInvalidated = false;
    this.#roadRouteStart = null;
    this.#roadRouteEnd = null;
    this.#roadRouteResult = null;
    this.#roadRouteTerrain = null;
    this.#roadRouteRunning = false;
    this.#roadRouteError = null;
    this.#roadRouteInvalidated = false;
    this.#settlementFrontagePlan = null;
    this.#settlementFrontageRoadIds.clear();
    this.#settlementFrontageRoadsCustomized = false;
    this.#settlementFrontagePlaceId = null;
    this.#settlementFrontageTerrain = null;
    this.#settlementFrontageSourceKey = null;
    this.#settlementFrontageError = null;
    this.#settlementFrontageInvalidated = false;
    this.#countyBuildResult = null;
    this.#countyBuildProgress = null;
    this.#countyBuildRunning = false;
    this.#countyBuildSourceRevision = null;
    this.#countyBuildSettingsKey = null;
    this.#countyBuildError = null;
    this.#countyBuildInvalidated = false;
    this.#tool = "select";
  }

  #renderAssetChoices(catalog: AssetCatalog | null): void {
    const previous = this.#elements.assetSelect.value;
    if (!catalog || catalog.assets.length === 0) {
      this.#elements.assetSelect.innerHTML = `<option value="">No catalogue loaded</option>`;
      this.#elements.assetSelect.disabled = true;
      this.#elements.assetSummary.textContent = catalog ? "Catalogue contains no assets." : "Load the shared catalogue to enable proxy placement.";
      this.#renderCountyAssetChoices(catalog);
      return;
    }
    this.#elements.assetSelect.innerHTML = catalog.assets.map((asset) => (
      `<option value="${escapeHtml(asset.asset_id)}">${escapeHtml(asset.display_name)} [${escapeHtml(asset.asset_id)}]</option>`
    )).join("");
    if (catalog.definition(previous)) this.#elements.assetSelect.value = previous;
    this.#elements.assetSelect.disabled = false;
    this.#elements.assetSummary.textContent = `${String(catalog.assets.length)} assets · ${String(new Set(catalog.assets.map((asset) => asset.category)).size)} proxy categories`;
    this.#renderCountyAssetChoices(catalog);
  }

  #renderCountyAssetChoices(catalog: AssetCatalog | null): void {
    for (const select of this.#elements.countyAssetRoleSelects) {
      const role = select.dataset.countyAssetRole;
      if (!isCountyBuildingRole(role)) continue;
      const previous = new Set([...select.selectedOptions].map(({ value }) => value).filter(Boolean));
      const options = catalog?.assets ?? [];
      select.innerHTML = `<option value="">${role === "house" ? "Select required asset" : "None"}</option>${options.map((asset) => (
        `<option value="${escapeHtml(asset.asset_id)}">${escapeHtml(asset.display_name)} [${escapeHtml(asset.asset_id)}]</option>`
      )).join("")}`;
      if ([...previous].some((assetId) => catalog?.definition(assetId))) {
        for (const option of [...select.options]) option.selected = previous.has(option.value);
      } else if (role === "house") {
        const selectedAsset = catalog?.definition(this.#elements.assetSelect.value);
        const defaultHouse = selectedAsset?.category === "house"
          ? selectedAsset
          : options.find(({ category }) => category === "house");
        select.value = defaultHouse?.asset_id ?? "";
      }
      select.disabled = !catalog || options.length === 0;
    }
  }

  #renderCountyContextChoices(): void {
    const previous = this.#elements.countyMainPlace.value;
    const places = this.#store.state.model?.list("place")
      .filter((entity): entity is PlaceRegion => entity.kind === "place" && entity.visible && entity.place_type !== "military_area") ?? [];
    this.#elements.countyMainPlace.innerHTML = `<option value="">Auto (highest-ranked town)</option>${places.map((place) => (
      `<option value="${escapeHtml(place.id)}">${escapeHtml(place.name)}</option>`
    )).join("")}`;
    this.#elements.countyMainPlace.value = places.some(({ id }) => id === previous) ? previous : "";
  }

  #renderWarnings(state: EditorState): void {
    const warnings = state.warnings.filter((warning) => {
      if (state.vegetationReference && warning.startsWith("Optional vegetation source")) return false;
      if (state.countyReference && warning.startsWith("Optional county-features source")) return false;
      if (state.assetCatalog && (
        warning.startsWith("Optional asset catalogue source")
        || warning.startsWith("Project contains prefab instances")
        || warning.startsWith("Missing asset catalogue entries")
      )) return false;
      return true;
    });
    const logicalAssetRecords = state.model
      ? [...state.model.prefabInstances(), ...state.model.vegetationInstances()]
      : [];
    const missingAssets = state.model && state.assetCatalog
      ? [...new Set(logicalAssetRecords
        .filter((entity) => !state.assetCatalog?.definition(entity.asset_id))
        .map((entity) => entity.asset_id))].sort()
      : [];
    if (logicalAssetRecords.length > 0 && !state.assetCatalog) {
      warnings.push("Project contains logical prefab or vegetation assets but no usable asset catalogue is loaded.");
    } else if (missingAssets.length > 0) {
      warnings.push(`Missing asset catalogue entries: ${missingAssets.join(", ")}`);
    }
    const unique = [...new Set(warnings)];
    this.#elements.warningsPanel.hidden = unique.length === 0;
    this.#elements.warningsPanel.innerHTML = unique.length === 0
      ? ""
      : `<p class="eyebrow">PROJECT WARNINGS</p>${unique.map((warning) => `<p>⚠ ${escapeHtml(warning)}</p>`).join("")}`;
  }

  #selectedAsset(): AssetDefinition | undefined {
    return this.#store.state.assetCatalog?.definition(this.#elements.assetSelect.value);
  }

  #showDialogError(message: string): void {
    this.#elements.dialogError.textContent = message;
    this.#elements.dialogError.hidden = false;
  }

  #showOpenDialogError(message: string): void {
    this.#elements.openDialogError.textContent = message;
    this.#elements.openDialogError.hidden = false;
  }
}

function propertyForm(
  entity: GeometryEntity | PrefabInstance | VegetationInstance,
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
    case "vegetation": {
      fields.push(selectField("Vegetation type", "vegetation_type", entity.vegetation_type, VEGETATION_TYPES));
      fields.push(textField("Logical species / asset ID", "asset_id", entity.asset_id));
      fields.push(`<p class="property-heading">Transform</p>`);
      fields.push(numberField("X (m)", "x_m", entity.x_m));
      fields.push(numberField("Z (m)", "z_m", entity.z_m));
      fields.push(numberField("Rotation (deg)", "rotation_deg", entity.rotation_deg));
      fields.push(numberField("Scale", "scale", entity.scale));
      fields.push(`<div class="property-inline-actions">
        <button class="button" data-action="rotate-negative" type="button" ${locked ? "disabled" : ""}>Rotate −15°</button>
        <button class="button" data-action="rotate-positive" type="button" ${locked ? "disabled" : ""}>Rotate +15°</button>
      </div>`);
      fields.push(optionalTextField("Source region UUID", "source_region_id", entity.source_region_id ?? ""));
      fields.push(`<p class="property-explanation">Terrain Y is derived from the current working terrain and is never stored in the editable project.</p>`);
      break;
    }
  }
  const meta = entity.kind === "prefab"
    ? `${catalog?.definition(entity.asset_id) ? "resolved catalogue asset" : "missing catalogue asset"} · pad ${entity.terrain_pad.enabled ? "enabled" : "disabled"}${locked ? " · locked spatially" : ""}`
    : entity.kind === "vegetation"
      ? `${catalog?.definition(entity.asset_id) ? "resolved catalogue asset" : "missing catalogue asset"} · terrain Y ${workingTerrain.heightAt(entity.x_m, entity.z_m).toFixed(2)} m${locked ? " · locked spatially" : ""}`
      : `${entity.points.length.toLocaleString()} vertices${selectedVertex === null ? "" : ` · vertex ${String(selectedVertex + 1)} selected`}${locked ? " · locked spatially" : ""}`;
  return `
    <div class="object-kind"><strong>${escapeHtml(kind)}</strong><code title="${entity.id}">${entity.id}</code></div>
    <form class="property-form" data-property-form>
      ${fields.join("")}
      <p class="property-meta">${meta}</p>
      <div class="property-error" data-property-error hidden></div>
      <div class="property-actions">
        <button class="button button-primary" type="submit">Apply properties</button>
        ${isGeometry(entity) ? `<button class="button" data-action="delete-vertex" type="button" ${selectedVertex === null || locked ? "disabled" : ""}>Delete vertex</button>` : ""}
        <button class="button button-danger" data-action="delete-object" type="button" ${locked ? "disabled" : ""}>Delete object</button>
      </div>
    </form>`;
}

function textField(label: string, name: string, value: string): string {
  return `<label for="property-${name}">${label}</label><input id="property-${name}" name="${name}" type="text" value="${escapeHtml(value)}" required />`;
}

function optionalTextField(label: string, name: string, value: string): string {
  return `<label for="property-${name}">${label}</label><input id="property-${name}" name="${name}" type="text" value="${escapeHtml(value)}" />`;
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

function entityKindLabel(entity: GeometryEntity | PrefabInstance | VegetationInstance): string {
  switch (entity.kind) {
    case "place": return "Place region";
    case "land_use": return entity.land_use_type === "woodland" ? "Woodland region" : "Land-use region";
    case "road": return "Native road";
    case "linear_feature": return "Hedgerow";
    case "prefab": return "Prefab instance";
    case "vegetation": return "Native vegetation instance";
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
    || value === "route_road"
    || value === "hedgerow"
    || value === "prefab"
    || value === "frontage"
    || value === "vegetation"
    || PLACE_TYPES.some((kind) => value === `place:${kind}`)
    || LAND_USE_TYPES.some((kind) => value === `land:${kind}`);
}

function isToggleTool(tool: Tool): tool is "prefab" | "frontage" | "vegetation" | "route_road" {
  return tool === "prefab" || tool === "frontage" || tool === "vegetation" || tool === "route_road";
}

function isFrontageSide(value: string | undefined): value is FrontageSide {
  return value === "left" || value === "right" || value === "both";
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

function vegetationSpatialFieldsChanged(before: VegetationInstance, after: VegetationInstance): boolean {
  return before.x_m !== after.x_m
    || before.z_m !== after.z_m
    || before.rotation_deg !== after.rotation_deg
    || before.scale !== after.scale;
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

function isSettlementSurveyProfileId(value: string): value is SettlementSurveyProfileId {
  return value === "town" || value === "village" || value === "hamlet" || value === "farm";
}

function isCountyBuildingRole(value: string | undefined): value is CountyBuildingRole {
  return value !== undefined && COUNTY_BUILDING_ROLES.includes(value as CountyBuildingRole);
}

function isCountySourceMode(value: string): value is CountySourceMode {
  return value === "survey" || value === "existing_places";
}

function isCountyOutputMode(value: string): value is CountyOutputMode {
  return value === "full" || value === "network_only";
}

function isCountySiteMix(value: string): value is CountySiteMix {
  return value === "balanced" || value === "urban" || value === "rural";
}

function isCountyStreetStyle(value: string): value is CountyStreetStyle {
  return COUNTY_STREET_STYLES.includes(value as CountyStreetStyle);
}

function isCountyBackboneOrientation(value: string): value is CountyBackboneOrientation {
  return value === "auto" || value === "west_east" || value === "north_south";
}

function countyBuildInputKey(input: CountyBuildInput): string {
  return JSON.stringify(input);
}

function emptyCountyAssetProgram(): CountyAssetProgram {
  return Object.fromEntries(COUNTY_BUILDING_ROLES.map((role) => [role, []])) as unknown as CountyAssetProgram;
}

function surveyInputNumber(input: HTMLInputElement, valid: (value: number) => boolean): number | null {
  const value = Number(input.value);
  const accepted = input.value.trim().length > 0 && Number.isFinite(value) && valid(value);
  input.setAttribute("aria-invalid", String(!accepted));
  return accepted ? value : null;
}

function settlementPlacesKey(places: readonly PlaceRegion[]): string {
  return JSON.stringify(places);
}

function surveyRejectionText(rejections: readonly { readonly reason: string; readonly count: number }[]): string {
  return rejections
    .filter(({ count }) => count > 0)
    .map(({ reason, count }) => `${String(count)} ${labelFor(reason).toLowerCase()}`)
    .join(", ");
}

function settlementFrontageSkipText(plan: SettlementFrontagePlan): string {
  const labels: Readonly<Record<keyof SettlementFrontagePlan["skipped"], string>> = {
    outside_settlement: "outside settlement",
    outside_world: "outside world",
    prefab_overlap: "prefab overlap",
    road_clash: "road clash",
    junction_clearance: "junction clearance",
    excessive_plot_slope: "excessive slope",
  };
  return Object.entries(plan.skipped)
    .filter(([, count]) => count > 0)
    .map(([reason, count]) => `${String(count)} ${labels[reason as keyof typeof labels]}`)
    .join(", ");
}

function labelFor(value: string): string {
  return value.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function nextUniqueName(stem: string, usedNames: Set<string>): string {
  if (!usedNames.has(stem)) {
    usedNames.add(stem);
    return stem;
  }
  let suffix = 2;
  while (usedNames.has(`${stem} ${String(suffix)}`)) suffix += 1;
  const name = `${stem} ${String(suffix)}`;
  usedNames.add(name);
  return name;
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function fileStem(value: string): string {
  const stem = value.trim().replace(/\.scenery\.json$/i, "").replace(/\.[^.]+$/, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return stem || "polygon-county";
}
