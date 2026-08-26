export interface EditorElements {
  readonly newProjectButton: HTMLButtonElement;
  readonly fitButton: HTMLButtonElement;
  readonly dialog: HTMLDialogElement;
  readonly projectForm: HTMLFormElement;
  readonly projectName: HTMLInputElement;
  readonly npyInput: HTMLInputElement;
  readonly descriptorInput: HTMLInputElement;
  readonly dialogError: HTMLElement;
  readonly createButton: HTMLButtonElement;
  readonly viewport: HTMLElement;
  readonly viewportEmpty: HTMLElement;
  readonly layerTerrain: HTMLInputElement;
  readonly layerHillshade: HTMLInputElement;
  readonly layerContours: HTMLInputElement;
  readonly projectTitle: HTMLElement;
  readonly dirtyMarker: HTMLElement;
  readonly projectState: HTMLElement;
  readonly inspector: HTMLElement;
  readonly statusCoordinates: HTMLElement;
  readonly statusElevation: HTMLElement;
  readonly statusSlope: HTMLElement;
  readonly statusMessage: HTMLElement;
  readonly viewReadout: HTMLElement;
}

export function buildRootLayout(host: HTMLElement): EditorElements {
  host.innerHTML = `
    <main class="editor-shell">
      <header class="topbar">
        <div class="brand-block">
          <div class="brand-mark" aria-hidden="true"><span></span><span></span><span></span></div>
          <div>
            <p class="eyebrow">POLYGON COUNTY</p>
            <div class="project-heading"><h1 id="project-title">Scenery Editor</h1><span id="dirty-marker" class="dirty-marker" hidden>UNSAVED</span></div>
          </div>
        </div>
        <nav class="command-bar" aria-label="Project commands">
          <button id="new-project" class="button button-primary" type="button"><span class="button-icon">＋</span> New terrain project</button>
          <button class="button" type="button" disabled title="Project opening is delivered in Milestone 4">Open</button>
          <button class="button" type="button" disabled title="Project saving is delivered in Milestone 4">Save</button>
          <span class="command-divider"></span>
          <button id="fit-terrain" class="button" type="button" disabled><span class="keycap">F</span> Fit terrain</button>
        </nav>
        <div id="project-state" class="project-state"><span class="state-dot"></span>No project</div>
      </header>

      <section class="workspace">
        <aside class="panel panel-left">
          <section class="panel-section">
            <div class="section-heading"><span>01</span><h2>Authoring</h2></div>
            <button class="tool-button is-active" type="button" disabled>
              <span class="tool-symbol">↖</span><span><strong>Inspect terrain</strong><small>Navigation mode</small></span><kbd>V</kbd>
            </button>
            <p class="milestone-note">Geometry and object tools unlock in Milestone 2. Terrain navigation is fully active.</p>
          </section>
          <section class="panel-section layers-section">
            <div class="section-heading"><span>02</span><h2>Terrain layers</h2></div>
            ${layerToggle("layer-terrain", "Terrain colour", "Elevation palette", "terrain-swatch")}
            ${layerToggle("layer-hillshade", "Hillshade", "Northwest lighting", "hillshade-swatch")}
            ${layerToggle("layer-contours", "Contours", "Adaptive metre interval", "contour-swatch")}
          </section>
          <section class="panel-section navigation-help">
            <div class="section-heading"><span>03</span><h2>Navigate</h2></div>
            <dl>
              <div><dt>Zoom</dt><dd>Mouse wheel at cursor</dd></div>
              <div><dt>Pan</dt><dd>Middle or right drag</dd></div>
              <div><dt>Fit</dt><dd><kbd>F</kbd></dd></div>
            </dl>
          </section>
        </aside>

        <section class="viewport-panel" aria-label="Map viewport">
          <div class="viewport-ruler viewport-ruler-x"><span>WEST / X 0</span><span>+X EAST</span></div>
          <div id="viewport" class="viewport">
            <div class="north-indicator" aria-label="North is up"><span>N</span><i></i></div>
            <div id="view-readout" class="view-readout">No active view</div>
            <div id="viewport-empty" class="viewport-empty">
              <div class="empty-map-icon" aria-hidden="true"><i></i><i></i><i></i></div>
              <p class="eyebrow">TERRAIN REFERENCE REQUIRED</p>
              <h2>Begin with the world surface</h2>
              <p>Select a float32 NPY and its matching descriptor JSON. Both files stay local in your browser.</p>
              <button id="empty-new-project" class="button button-primary" type="button">Choose terrain sources</button>
            </div>
          </div>
        </section>

        <aside class="panel panel-right">
          <section class="panel-section inspector-header">
            <p class="eyebrow">CURRENT SELECTION</p>
            <h2>Terrain reference</h2>
          </section>
          <section id="inspector" class="inspector-empty">
            <div class="inspector-placeholder"></div>
            <h3>No terrain loaded</h3>
            <p>World dimensions, grid topology, elevation range, and the source fingerprint appear here.</p>
          </section>
          <section class="contract-card">
            <p class="eyebrow">COORDINATE CONTRACT</p>
            <div class="axis-diagram" aria-label="X east, Z south, Y elevation">
              <span class="axis-origin"></span><span class="axis-x">+X EAST</span><span class="axis-z">+Z SOUTH</span><span class="axis-y">+Y UP</span>
            </div>
            <p>Origin is the northwest corner. Every authored dimension remains in metres.</p>
          </section>
        </aside>
      </section>

      <footer class="statusbar">
        <div class="status-primary"><span class="status-pulse"></span><span id="status-message">Ready — source files never leave this browser</span></div>
        <div class="status-metric"><span>X / Z</span><strong id="status-coordinates">—</strong></div>
        <div class="status-metric"><span>ELEVATION</span><strong id="status-elevation">—</strong></div>
        <div class="status-metric"><span>SLOPE</span><strong id="status-slope">—</strong></div>
        <div class="status-build">MILESTONES 0–1</div>
      </footer>
    </main>

    <dialog id="new-project-dialog" class="project-dialog">
      <form id="new-project-form" method="dialog">
        <div class="dialog-heading">
          <div><p class="eyebrow">NEW SCENERY PROJECT</p><h2>Attach immutable base terrain</h2></div>
          <button class="icon-button" value="cancel" aria-label="Close dialog" type="submit">×</button>
        </div>
        <p class="dialog-intro">The browser reads both files in memory. Saved path strings are only portable hints and never grant filesystem access.</p>
        <label class="field-label" for="project-name">Project name</label>
        <input id="project-name" name="project-name" type="text" value="Untitled Scenery" required />
        <div class="source-grid">
          <label class="source-picker" for="terrain-npy">
            <span class="source-number">01</span><strong>Float32 terrain NPY</strong><small>C- or Fortran-order, 2D</small>
            <input id="terrain-npy" name="terrain-npy" type="file" accept=".npy,application/octet-stream" required />
          </label>
          <label class="source-picker" for="terrain-descriptor">
            <span class="source-number">02</span><strong>Terrain descriptor</strong><small>Matching JSON contract</small>
            <input id="terrain-descriptor" name="terrain-descriptor" type="file" accept=".json,application/json" required />
          </label>
        </div>
        <div id="dialog-error" class="dialog-error" role="alert" hidden></div>
        <div class="dialog-actions">
          <button class="button" value="cancel" type="submit">Cancel</button>
          <button id="create-project" class="button button-primary" value="default" type="submit">Validate &amp; create project</button>
        </div>
      </form>
    </dialog>
  `;

  const byId = <T extends HTMLElement>(id: string, elementType: new () => T): T => {
    const element = document.querySelector(`#${CSS.escape(id)}`);
    if (!element) throw new Error(`missing editor element #${id}`);
    if (!(element instanceof elementType)) throw new Error(`editor element #${id} has the wrong type`);
    return element;
  };
  const emptyButton = byId("empty-new-project", HTMLButtonElement);
  const newProjectButton = byId("new-project", HTMLButtonElement);
  emptyButton.addEventListener("click", () => newProjectButton.click());

  return {
    newProjectButton,
    fitButton: byId("fit-terrain", HTMLButtonElement),
    dialog: byId("new-project-dialog", HTMLDialogElement),
    projectForm: byId("new-project-form", HTMLFormElement),
    projectName: byId("project-name", HTMLInputElement),
    npyInput: byId("terrain-npy", HTMLInputElement),
    descriptorInput: byId("terrain-descriptor", HTMLInputElement),
    dialogError: byId("dialog-error", HTMLElement),
    createButton: byId("create-project", HTMLButtonElement),
    viewport: byId("viewport", HTMLElement),
    viewportEmpty: byId("viewport-empty", HTMLElement),
    layerTerrain: byId("layer-terrain", HTMLInputElement),
    layerHillshade: byId("layer-hillshade", HTMLInputElement),
    layerContours: byId("layer-contours", HTMLInputElement),
    projectTitle: byId("project-title", HTMLElement),
    dirtyMarker: byId("dirty-marker", HTMLElement),
    projectState: byId("project-state", HTMLElement),
    inspector: byId("inspector", HTMLElement),
    statusCoordinates: byId("status-coordinates", HTMLElement),
    statusElevation: byId("status-elevation", HTMLElement),
    statusSlope: byId("status-slope", HTMLElement),
    statusMessage: byId("status-message", HTMLElement),
    viewReadout: byId("view-readout", HTMLElement),
  };
}

function layerToggle(id: string, title: string, detail: string, swatchClass: string): string {
  return `
    <label class="layer-row" for="${id}">
      <input id="${id}" type="checkbox" checked />
      <span class="layer-check" aria-hidden="true"></span>
      <span class="layer-swatch ${swatchClass}" aria-hidden="true"></span>
      <span><strong>${title}</strong><small>${detail}</small></span>
    </label>`;
}
