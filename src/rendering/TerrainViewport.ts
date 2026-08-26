import * as THREE from "three";
import type { PointXZ } from "../model/coordinates";
import type { TerrainReference } from "../terrain/TerrainReference";
import {
  fitOrthographicView,
  panViewByPixels,
  screenToWorld,
  viewWidthM,
  zoomViewAtScreenPoint,
  type OrthographicView,
  type ViewportSize,
} from "../interaction/orthographicMath";
import { buildTerrainGeometry } from "./terrain/terrainGeometry";
import { buildTerrainTexture, type TerrainLayerState } from "./terrain/terrainTexture";

export interface TerrainViewportCallbacks {
  readonly onPointerWorld: (point: PointXZ | null) => void;
  readonly onViewChanged: (view: OrthographicView) => void;
}

export class TerrainViewport {
  readonly #host: HTMLElement;
  readonly #renderer: THREE.WebGLRenderer;
  readonly #scene = new THREE.Scene();
  readonly #camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1_000_000);
  readonly #resizeObserver: ResizeObserver;
  readonly #callbacks: TerrainViewportCallbacks;
  #terrain: TerrainReference | null = null;
  #terrainMesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> | null = null;
  #border: THREE.LineLoop | null = null;
  #layers: TerrainLayerState = { terrain: true, hillshade: true, contours: true };
  #view: OrthographicView = { centerX: 0, centerZ: 0, heightM: 1 };
  #fitHeightM = 1;
  #animationFrame: number | null = null;
  #pan: { readonly pointerId: number; readonly x: number; readonly y: number } | null = null;

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
    this.#bindEvents();
    this.#resizeObserver = new ResizeObserver(() => this.#resize());
    this.#resizeObserver.observe(this.#host);
    this.#resize();
  }

  public setTerrain(terrain: TerrainReference): void {
    this.#disposeTerrain();
    this.#terrain = terrain;
    const geometry = buildTerrainGeometry(terrain);
    const texture = buildTerrainTexture(terrain, this.#layers);
    const material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.FrontSide });
    this.#terrainMesh = new THREE.Mesh(geometry, material);
    this.#terrainMesh.name = "terrain";
    this.#scene.add(this.#terrainMesh);
    this.#border = this.#createBorder(terrain);
    this.#scene.add(this.#border);
    this.fitTerrain();
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
      }
    });
    canvas.addEventListener("pointermove", (event) => {
      if (this.#pan?.pointerId === event.pointerId) {
        const delta = { x: event.clientX - this.#pan.x, y: event.clientY - this.#pan.y };
        this.#view = panViewByPixels(this.#view, delta, this.#size());
        this.#pan = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
        this.#updateCamera();
        this.#callbacks.onViewChanged(this.#view);
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
    };
    canvas.addEventListener("pointerup", endPan);
    canvas.addEventListener("pointercancel", endPan);
    canvas.addEventListener("pointerleave", () => {
      if (!this.#pan) {
        this.#callbacks.onPointerWorld(null);
      }
    });
    canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  }

  #emitPointerWorld(point: { readonly x: number; readonly y: number }): void {
    if (!this.#terrain) {
      this.#callbacks.onPointerWorld(null);
      return;
    }
    const world = screenToWorld(point, this.#view, this.#size());
    const inside = world.x >= 0 && world.x <= this.#terrain.worldWidthM
      && world.z >= 0 && world.z <= this.#terrain.worldDepthM;
    this.#callbacks.onPointerWorld(inside ? world : null);
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

  #createBorder(terrain: TerrainReference): THREE.LineLoop {
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
