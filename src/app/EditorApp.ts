import type { PointXZ } from "../model/coordinates";
import { importTerrainSources } from "../io/terrainImport";
import { TerrainViewport } from "../rendering/TerrainViewport";
import type { TerrainLayerState } from "../rendering/terrain/terrainTexture";
import { buildRootLayout, type EditorElements } from "../ui/rootLayout";
import { EditorStore } from "./EditorStore";

export class EditorApp {
  readonly #elements: EditorElements;
  readonly #store = new EditorStore();
  readonly #viewport: TerrainViewport;

  public constructor(host: HTMLElement) {
    this.#elements = buildRootLayout(host);
    this.#viewport = new TerrainViewport(this.#elements.viewport, {
      onPointerWorld: (point) => this.#updatePointerStatus(point),
      onViewChanged: (view) => {
        this.#elements.viewReadout.textContent = `${view.heightM.toLocaleString(undefined, { maximumFractionDigits: 0 })} m view height`;
      },
    });
    this.#bindEvents();
    this.#store.subscribe((state) => {
      this.#elements.projectTitle.textContent = state.project?.name ?? "Scenery Editor";
      this.#elements.dirtyMarker.hidden = !state.dirty;
      this.#elements.projectState.innerHTML = state.project
        ? `<span class="state-dot is-ready"></span>${escapeHtml(state.project.name)}`
        : `<span class="state-dot"></span>No project`;
      document.title = `${state.project?.name ?? "Polygon County Scenery Editor"}${state.dirty ? " *" : ""}`;
      this.#elements.fitButton.disabled = !state.terrain;
      if (state.terrain && state.project) {
        this.#viewport.setTerrain(state.terrain);
        this.#elements.viewportEmpty.hidden = true;
        this.#renderInspector();
      }
    });
  }

  public dispose(): void {
    this.#viewport.dispose();
  }

  #bindEvents(): void {
    this.#elements.newProjectButton.addEventListener("click", () => {
      if (this.#store.state.dirty && !window.confirm("Discard the current unsaved project and choose new terrain sources?")) {
        return;
      }
      this.#elements.dialogError.hidden = true;
      this.#elements.dialog.showModal();
    });
    this.#elements.projectForm.addEventListener("submit", async (event) => {
      const submitter = event.submitter as HTMLButtonElement | null;
      if (submitter?.value === "cancel") {
        return;
      }
      event.preventDefault();
      await this.#createProject();
    });
    this.#elements.fitButton.addEventListener("click", () => this.#viewport.fitTerrain());
    for (const input of [
      this.#elements.layerTerrain,
      this.#elements.layerHillshade,
      this.#elements.layerContours,
    ]) {
      input.addEventListener("change", () => this.#viewport.setLayers(this.#layerState()));
    }
    window.addEventListener("keydown", (event) => {
      if (event.key.toLowerCase() === "f" && !isTypingTarget(event.target) && this.#store.state.terrain) {
        event.preventDefault();
        this.#viewport.fitTerrain();
      }
    });
    window.addEventListener("beforeunload", (event) => {
      if (this.#store.state.dirty) {
        event.preventDefault();
      }
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
      this.#store.createProject(
        this.#elements.projectName.value,
        terrain,
        { npy: npy.name, descriptor: descriptor.name },
      );
      this.#elements.dialog.close();
      this.#elements.statusMessage.textContent = `Loaded ${npy.name} — SHA-256 verified`;
    } catch (error) {
      this.#showDialogError(error instanceof Error ? error.message : String(error));
    } finally {
      this.#elements.createButton.disabled = false;
      this.#elements.createButton.textContent = "Validate & create project";
    }
  }

  #showDialogError(message: string): void {
    this.#elements.dialogError.textContent = message;
    this.#elements.dialogError.hidden = false;
  }

  #layerState(): TerrainLayerState {
    return {
      terrain: this.#elements.layerTerrain.checked,
      hillshade: this.#elements.layerHillshade.checked,
      contours: this.#elements.layerContours.checked,
    };
  }

  #updatePointerStatus(point: PointXZ | null): void {
    const terrain = this.#store.state.terrain;
    if (!point || !terrain) {
      this.#elements.statusCoordinates.textContent = "—";
      this.#elements.statusElevation.textContent = "—";
      this.#elements.statusSlope.textContent = "—";
      return;
    }
    this.#elements.statusCoordinates.textContent = `${point.x.toFixed(2)} / ${point.z.toFixed(2)} m`;
    this.#elements.statusElevation.textContent = `${terrain.heightAt(point.x, point.z).toFixed(2)} m`;
    this.#elements.statusSlope.textContent = `${terrain.slopeAt(point.x, point.z).toFixed(2)}°`;
  }

  #renderInspector(): void {
    const terrain = this.#store.state.terrain;
    const project = this.#store.state.project;
    if (!terrain || !project) return;
    const rows: readonly (readonly [string, string])[] = [
      ["World", `${formatMetres(terrain.worldWidthM)} × ${formatMetres(terrain.worldDepthM)}`],
      ["Spacing", formatMetres(terrain.spacingM)],
      ["Cells", `${terrain.cellCountX.toLocaleString()} × ${terrain.cellCountZ.toLocaleString()}`],
      ["Elevation points", `${terrain.pointCountX.toLocaleString()} × ${terrain.pointCountZ.toLocaleString()}`],
      ["Elevation range", `${terrain.minimumElevationM.toFixed(2)} — ${terrain.maximumElevationM.toFixed(2)} m`],
      ["Sea / lowland", `${terrain.seaLevelM.toFixed(2)} / ${terrain.lowlandReferenceElevationM.toFixed(2)} m`],
    ];
    this.#elements.inspector.className = "inspector-data";
    this.#elements.inspector.innerHTML = `
      <div class="terrain-badge"><span>NW–SE</span><strong>Triangle terrain</strong><small>Rows +Z · columns +X</small></div>
      <dl class="data-list">${rows.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl>
      <div class="fingerprint-block"><p class="eyebrow">BASE NPY SHA-256</p><code>${project.terrain_fingerprint.sha256}</code></div>
      <div class="source-hints"><p><span>NPY</span>${escapeHtml(project.sources.terrain_npy)}</p><p><span>JSON</span>${escapeHtml(project.sources.terrain_descriptor)}</p></div>
    `;
  }
}

function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement;
}

function formatMetres(value: number): string {
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })} m`;
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
