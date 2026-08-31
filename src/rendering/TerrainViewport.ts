import * as THREE from "three";
import type { AssetCatalog } from "../model/assetCatalog";
import type { PointXZ } from "../model/coordinates";
import type { ProjectModel } from "../model/ProjectModel";
import type { TerrainSurface } from "../terrain/TerrainSurface";
import {
  fitOrthographicView,
  panViewByPixels,
  screenToWorld,
  viewWidthM,
  zoomViewAtScreenPoint,
  type OrthographicView,
  type ViewportSize,
} from "../interaction/orthographicMath";
import { buildTerrainGeometry, updateTerrainGeometryHeights } from "./terrain/terrainGeometry";
import { buildTerrainTexture, type TerrainLayerState } from "./terrain/terrainTexture";
import { GeometryRenderAdapter, type DraftProjection } from "./GeometryRenderAdapter";
import type { GeometryLayerState } from "../interaction/geometryEditing";
import {
  PrefabRenderAdapter,
  type PrefabGhostProjection,
  type PrefabLayerState,
} from "./PrefabRenderAdapter";
import {
  ReferenceRenderAdapter,
  type ReferenceLayerState,
} from "./ReferenceRenderAdapter";
import type { CountyReference, VegetationReference } from "../model/references";
import {
  VegetationRenderDataManager,
  type VegetationSyncMetrics,
} from "./VegetationRenderDataManager";
import type { FrontagePlan } from "../interaction/frontageAssist";
import {
  SettlementSurveyRenderAdapter,
  type SettlementSurveyProjection,
} from "./SettlementSurveyRenderAdapter";
import { RoadRouteRenderAdapter, type RoadRouteProjection } from "./RoadRouteRenderAdapter";

export interface ViewportPerformanceSnapshot {
  readonly drawCalls: number;
  readonly sceneObjectCount: number;
  readonly geometries: number;
  readonly textures: number;
  readonly gpu: { readonly vendor: string; readonly renderer: string } | null;
  readonly nativeVegetation: VegetationSyncMetrics;
}

export interface FrameTimeSummary {
  readonly samples: number;
  readonly medianMs: number;
  readonly p95Ms: number;
}

export interface PrimaryPointerIntent {
  readonly point: PointXZ;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
}

export interface CanvasClickIntent extends PrimaryPointerIntent {
  readonly detail: number;
}

export interface TerrainViewportCallbacks {
  readonly onPointerWorld: (point: PointXZ | null) => void;
  readonly onViewChanged: (view: OrthographicView) => void;
  readonly onPrimaryDown: (intent: PrimaryPointerIntent) => void;
  readonly onPrimaryMove: (point: PointXZ) => void;
  readonly onPrimaryUp: (point: PointXZ) => void;
  readonly onCanvasClick: (intent: CanvasClickIntent) => void;
  readonly onCanvasDoubleClick: (point: PointXZ) => void;
}

export class TerrainViewport {
  readonly #host: HTMLElement;
  readonly #renderer: THREE.WebGLRenderer;
  readonly #scene = new THREE.Scene();
  readonly #camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1_000_000);
  readonly #resizeObserver: ResizeObserver;
  readonly #callbacks: TerrainViewportCallbacks;
  readonly #geometry = new GeometryRenderAdapter();
  readonly #settlementSurvey = new SettlementSurveyRenderAdapter();
  readonly #roadRoute = new RoadRouteRenderAdapter();
  readonly #prefabs = new PrefabRenderAdapter();
  readonly #references = new ReferenceRenderAdapter();
  readonly #vegetation = new VegetationRenderDataManager();
  #terrain: TerrainSurface | null = null;
  #terrainMesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> | null = null;
  #border: THREE.LineLoop | null = null;
  #layers: TerrainLayerState = { terrain: true, hillshade: true, contours: true };
  #view: OrthographicView = { centerX: 0, centerZ: 0, heightM: 1 };
  #fitHeightM = 1;
  #animationFrame: number | null = null;
  #pan: { readonly pointerId: number; readonly x: number; readonly y: number } | null = null;
  #primaryPointerId: number | null = null;

  public constructor(host: HTMLElement, callbacks: TerrainViewportCallbacks) {
    this.#host = host;
    this.#callbacks = callbacks;
    this.#renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.#renderer.setClearColor(0x151d20, 1);
    this.#renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.#renderer.domElement.className = "viewport-canvas";
    this.#renderer.domElement.setAttribute("aria-label", "Top-down terrain viewport");
    this.#host.append(this.#renderer.domElement);

    this.#camera.up.set(0, 0, -1);
    this.#scene.add(new THREE.AmbientLight(0xffffff, 1));
    this.#scene.add(this.#geometry.group);
    this.#scene.add(this.#settlementSurvey.group);
    this.#scene.add(this.#roadRoute.group);
    this.#scene.add(this.#prefabs.group);
    this.#scene.add(this.#vegetation.group);
    this.#scene.add(this.#references.group);
    this.#bindEvents();
    this.#resizeObserver = new ResizeObserver(() => this.#resize());
    this.#resizeObserver.observe(this.#host);
    this.#resize();
  }

  public setTerrain(terrain: TerrainSurface, preserveView = false): void {
    const compatible = this.#terrainMesh !== null
      && this.#terrain?.pointCountX === terrain.pointCountX
      && this.#terrain.pointCountZ === terrain.pointCountZ
      && this.#terrain.spacingM === terrain.spacingM;
    this.#terrain = terrain;
    if (compatible && this.#terrainMesh) {
      updateTerrainGeometryHeights(this.#terrainMesh.geometry, terrain);
      this.#terrainMesh.material.map?.dispose();
      this.#terrainMesh.material.map = buildTerrainTexture(terrain, this.#layers);
      this.#terrainMesh.material.needsUpdate = true;
      if (preserveView) this.#updateCamera();
      else this.fitTerrain();
      return;
    }
    this.#disposeTerrain();
    const geometry = buildTerrainGeometry(terrain);
    const texture = buildTerrainTexture(terrain, this.#layers);
    const material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.FrontSide });
    this.#terrainMesh = new THREE.Mesh(geometry, material);
    this.#terrainMesh.name = "terrain";
    this.#scene.add(this.#terrainMesh);
    this.#border = this.#createBorder(terrain);
    this.#scene.add(this.#border);
    if (preserveView) this.#updateCamera();
    else this.fitTerrain();
  }

  public setLayers(layers: TerrainLayerState): void {
    this.#layers = { ...layers };
    if (this.#terrainMesh && this.#terrain) {
      this.#terrainMesh.material.map?.dispose();
      this.#terrainMesh.material.map = buildTerrainTexture(this.#terrain, this.#layers);
      this.#terrainMesh.material.needsUpdate = true;
    }
    this.invalidate();
  }

  public setAuthoringProjection(
    model: ProjectModel | null,
    catalog: AssetCatalog | null,
    selectedId: string | null,
    selectedVertex: number | null,
    geometryLayers: GeometryLayerState,
    prefabLayers: PrefabLayerState,
    vegetationLayer: boolean,
    draft: DraftProjection,
    ghost: PrefabGhostProjection | null,
    frontagePreview: FrontagePlan | null,
    settlementSurvey: SettlementSurveyProjection | null,
    roadRoute: RoadRouteProjection | null,
    county: CountyReference | null,
    vegetation: VegetationReference | null,
    referenceLayers: ReferenceLayerState,
  ): void {
    const terrain = this.#terrain;
    const overlayY = terrain
      ? terrain.maximumElevationM + Math.max(1, (terrain.maximumElevationM - terrain.minimumElevationM) * 0.01)
      : 1;
    this.#geometry.sync(model?.geometryEntities() ?? [], selectedId, selectedVertex, geometryLayers, draft, overlayY);
    this.#settlementSurvey.sync(settlementSurvey, overlayY);
    this.#roadRoute.sync(roadRoute, overlayY);
    this.#prefabs.sync(
      (model?.list("prefab") ?? []).filter((entity) => entity.kind === "prefab"),
      catalog,
      selectedId,
      prefabLayers,
      ghost,
      overlayY,
      frontagePreview,
    );
    this.#vegetation.sync(model?.vegetationInstances() ?? [], terrain, selectedId, vegetationLayer);
    this.#references.sync(county, vegetation, referenceLayers, overlayY);
    this.invalidate();
  }

  public pickNativeVegetation(point: PointXZ, toleranceM: number): string | null {
    return this.#vegetation.pick(point, toleranceM);
  }

  public performanceSnapshot(renderNow = false): ViewportPerformanceSnapshot {
    if (renderNow) this.#renderer.render(this.#scene, this.#camera);
    let sceneObjectCount = 0;
    this.#scene.traverse(() => { sceneObjectCount += 1; });
    return {
      drawCalls: this.#renderer.info.render.calls,
      sceneObjectCount,
      geometries: this.#renderer.info.memory.geometries,
      textures: this.#renderer.info.memory.textures,
      gpu: this.#gpuInformation(),
      nativeVegetation: this.#vegetation.metrics,
    };
  }

  #gpuInformation(): { readonly vendor: string; readonly renderer: string } | null {
    const context = this.#renderer.getContext();
    const extension = context.getExtension("WEBGL_debug_renderer_info") as DebugRendererInfo | null;
    if (!extension) return null;
    return {
      vendor: String(context.getParameter(extension.UNMASKED_VENDOR_WEBGL)),
      renderer: String(context.getParameter(extension.UNMASKED_RENDERER_WEBGL)),
    };
  }

  public async benchmarkPanZoomFrames(frameCount = 60, warmupFrames = 10): Promise<FrameTimeSummary> {
    const original = this.#view;
    const samples: number[] = [];
    let frame = 0;
    let previous = performance.now();
    await new Promise<void>((resolve) => {
      const step = (now: number): void => {
        const delta = now - previous;
        previous = now;
        const phase = frame * 0.15;
        this.#view = {
          centerX: original.centerX + Math.sin(phase) * original.heightM * 0.03,
          centerZ: original.centerZ + Math.cos(phase * 0.8) * original.heightM * 0.03,
          heightM: original.heightM * (1 + Math.sin(phase * 0.6) * 0.025),
        };
        this.#updateCamera();
        this.#renderer.render(this.#scene, this.#camera);
        if (frame >= warmupFrames) samples.push(delta);
        frame += 1;
        if (frame < warmupFrames + frameCount) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
    this.#view = original;
    this.#updateCamera();
    samples.sort((left, right) => left - right);
    return {
      samples: samples.length,
      medianMs: percentile(samples, 0.5),
      p95Ms: percentile(samples, 0.95),
    };
  }

  public worldUnitsPerPixel(): number {
    return this.#view.heightM / this.#size().heightPx;
  }

  public setDrawingCursor(drawing: boolean): void {
    this.#renderer.domElement.classList.toggle("is-drawing", drawing);
    this.#renderer.domElement.classList.toggle("is-selecting", !drawing);
  }

  public fitTerrain(): void {
    if (!this.#terrain) {
      return;
    }
    this.#view = fitOrthographicView(
      this.#terrain.worldWidthM,
      this.#terrain.worldDepthM,
      this.#size(),
    );
    this.#fitHeightM = this.#view.heightM;
    this.#updateCamera();
    this.#callbacks.onViewChanged(this.#view);
  }

  public invalidate(): void {
    if (this.#animationFrame === null) {
      this.#animationFrame = requestAnimationFrame(() => {
        this.#animationFrame = null;
        this.#renderer.render(this.#scene, this.#camera);
      });
    }
  }

  public dispose(): void {
    this.#resizeObserver.disconnect();
    if (this.#animationFrame !== null) {
      cancelAnimationFrame(this.#animationFrame);
    }
    this.#disposeTerrain();
    this.#geometry.dispose();
    this.#settlementSurvey.dispose();
    this.#roadRoute.dispose();
    this.#prefabs.dispose();
    this.#references.dispose();
    this.#vegetation.dispose();
    this.#scene.remove(this.#geometry.group);
    this.#scene.remove(this.#settlementSurvey.group);
    this.#scene.remove(this.#roadRoute.group);
    this.#scene.remove(this.#prefabs.group);
    this.#scene.remove(this.#references.group);
    this.#scene.remove(this.#vegetation.group);
    this.#renderer.dispose();
    this.#renderer.domElement.remove();
  }

  #bindEvents(): void {
    const canvas = this.#renderer.domElement;
    canvas.addEventListener("wheel", (event) => {
      if (!this.#terrain) {
        return;
      }
      event.preventDefault();
      const point = this.#localPointer(event);
      const factor = Math.exp(-event.deltaY * 0.0015);
      this.#view = zoomViewAtScreenPoint(
        this.#view,
        point,
        factor,
        this.#size(),
        this.#fitHeightM / 40,
        this.#fitHeightM * 4,
      );
      this.#updateCamera();
      this.#callbacks.onViewChanged(this.#view);
      this.#emitPointerWorld(point);
    }, { passive: false });
    canvas.addEventListener("pointerdown", (event) => {
      if ((event.button === 1 || event.button === 2) && this.#terrain) {
        event.preventDefault();
        canvas.setPointerCapture(event.pointerId);
        this.#pan = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
        canvas.classList.add("is-panning");
      } else if (event.button === 0 && this.#terrain) {
        canvas.setPointerCapture(event.pointerId);
        this.#primaryPointerId = event.pointerId;
        this.#callbacks.onPrimaryDown({
          point: this.#worldAt(this.#localPointer(event)),
          ctrlKey: event.ctrlKey || event.metaKey,
          shiftKey: event.shiftKey,
        });
      }
    });
    canvas.addEventListener("pointermove", (event) => {
      if (this.#pan?.pointerId === event.pointerId) {
        const delta = { x: event.clientX - this.#pan.x, y: event.clientY - this.#pan.y };
        this.#view = panViewByPixels(this.#view, delta, this.#size());
        this.#pan = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
        this.#updateCamera();
        this.#callbacks.onViewChanged(this.#view);
      } else if (this.#primaryPointerId === event.pointerId) {
        this.#callbacks.onPrimaryMove(this.#worldAt(this.#localPointer(event)));
      }
      this.#emitPointerWorld(this.#localPointer(event));
    });
    const endPan = (event: PointerEvent): void => {
      if (this.#pan?.pointerId === event.pointerId) {
        this.#pan = null;
        canvas.classList.remove("is-panning");
        if (canvas.hasPointerCapture(event.pointerId)) {
          canvas.releasePointerCapture(event.pointerId);
        }
      }
      if (this.#primaryPointerId === event.pointerId) {
        this.#callbacks.onPrimaryUp(this.#worldAt(this.#localPointer(event)));
        this.#primaryPointerId = null;
        if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      }
    };
    canvas.addEventListener("pointerup", endPan);
    canvas.addEventListener("pointercancel", endPan);
    canvas.addEventListener("pointerleave", () => {
      if (!this.#pan && this.#primaryPointerId === null) {
        this.#callbacks.onPointerWorld(null);
      }
    });
    canvas.addEventListener("click", (event) => {
      if (event.button !== 0 || !this.#terrain) return;
      this.#callbacks.onCanvasClick({
        point: this.#worldAt(this.#localPointer(event)),
        detail: event.detail,
        ctrlKey: event.ctrlKey || event.metaKey,
        shiftKey: event.shiftKey,
      });
    });
    canvas.addEventListener("dblclick", (event) => {
      if (event.button !== 0 || !this.#terrain) return;
      event.preventDefault();
      this.#callbacks.onCanvasDoubleClick(this.#worldAt(this.#localPointer(event)));
    });
    canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  }

  #emitPointerWorld(point: { readonly x: number; readonly y: number }): void {
    if (!this.#terrain) {
      this.#callbacks.onPointerWorld(null);
      return;
    }
    const world = this.#worldAt(point);
    const inside = world.x >= 0 && world.x <= this.#terrain.worldWidthM
      && world.z >= 0 && world.z <= this.#terrain.worldDepthM;
    this.#callbacks.onPointerWorld(inside ? world : null);
  }

  #worldAt(point: { readonly x: number; readonly y: number }): PointXZ {
    return screenToWorld(point, this.#view, this.#size());
  }

  #localPointer(event: MouseEvent | PointerEvent | WheelEvent): { readonly x: number; readonly y: number } {
    const bounds = this.#renderer.domElement.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }

  #resize(): void {
    const size = this.#size();
    this.#renderer.setSize(size.widthPx, size.heightPx, false);
    this.#updateCamera();
  }

  #size(): ViewportSize {
    return {
      widthPx: Math.max(1, this.#host.clientWidth),
      heightPx: Math.max(1, this.#host.clientHeight),
    };
  }

  #updateCamera(): void {
    const halfHeight = this.#view.heightM / 2;
    const halfWidth = viewWidthM(this.#view, this.#size()) / 2;
    this.#camera.left = -halfWidth;
    this.#camera.right = halfWidth;
    this.#camera.top = halfHeight;
    this.#camera.bottom = -halfHeight;
    const terrain = this.#terrain;
    const cameraY = terrain
      ? terrain.maximumElevationM + Math.max(terrain.worldWidthM, terrain.worldDepthM) + 1_000
      : 10_000;
    this.#camera.position.set(this.#view.centerX, cameraY, this.#view.centerZ);
    this.#camera.lookAt(this.#view.centerX, 0, this.#view.centerZ);
    this.#camera.near = 0.1;
    this.#camera.far = cameraY - (terrain?.minimumElevationM ?? 0) + 10_000;
    this.#camera.updateProjectionMatrix();
    this.invalidate();
  }

  #createBorder(terrain: TerrainSurface): THREE.LineLoop {
    const offset = terrain.maximumElevationM + Math.max(1, (terrain.maximumElevationM - terrain.minimumElevationM) * 0.002);
    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, offset, 0),
      new THREE.Vector3(terrain.worldWidthM, offset, 0),
      new THREE.Vector3(terrain.worldWidthM, offset, terrain.worldDepthM),
      new THREE.Vector3(0, offset, terrain.worldDepthM),
    ]);
    return new THREE.LineLoop(geometry, new THREE.LineBasicMaterial({ color: 0xdbe4e7 }));
  }

  #disposeTerrain(): void {
    if (this.#terrainMesh) {
      this.#scene.remove(this.#terrainMesh);
      this.#terrainMesh.geometry.dispose();
      this.#terrainMesh.material.map?.dispose();
      this.#terrainMesh.material.dispose();
      this.#terrainMesh = null;
    }
    if (this.#border) {
      this.#scene.remove(this.#border);
      this.#border.geometry.dispose();
      (this.#border.material as THREE.Material).dispose();
      this.#border = null;
    }
  }
}

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
  return sorted[index] ?? 0;
}

interface DebugRendererInfo {
  readonly UNMASKED_VENDOR_WEBGL: number;
  readonly UNMASKED_RENDERER_WEBGL: number;
}
