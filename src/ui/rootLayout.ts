export interface EditorElements {
  readonly newProjectButton: HTMLButtonElement;
  readonly openProjectButton: HTMLButtonElement;
  readonly saveButton: HTMLButtonElement;
  readonly saveAsButton: HTMLButtonElement;
  readonly fitButton: HTMLButtonElement;
  readonly undoButton: HTMLButtonElement;
  readonly redoButton: HTMLButtonElement;
  readonly toolButtons: readonly HTMLButtonElement[];
  readonly toolInstructions: HTMLElement;
  readonly assetCatalogInput: HTMLInputElement;
  readonly assetSelect: HTMLSelectElement;
  readonly assetSummary: HTMLElement;
  readonly frontageOptions: HTMLFieldSetElement;
  readonly frontageSideInputs: readonly HTMLInputElement[];
  readonly frontageSetback: HTMLInputElement;
  readonly frontageGap: HTMLInputElement;
  readonly frontageEndClearance: HTMLInputElement;
  readonly frontageSummary: HTMLElement;
  readonly generateFrontageButton: HTMLButtonElement;
  readonly clearFrontageButton: HTMLButtonElement;
  readonly vegetationTypeSelect: HTMLSelectElement;
  readonly vegetationAssetId: HTMLInputElement;
  readonly vegetationInput: HTMLInputElement;
  readonly countyInput: HTMLInputElement;
  readonly vegetationSummary: HTMLElement;
  readonly countySummary: HTMLElement;
  readonly convertCountyButton: HTMLButtonElement;
  readonly convertVegetationButton: HTMLButtonElement;
  readonly exportViewerBundleButton: HTMLButtonElement;
  readonly exportRuntimeButton: HTMLButtonElement;
  readonly exportRuntimeV2Button: HTMLButtonElement;
  readonly exportTerrainButton: HTMLButtonElement;
  readonly exportVegetationButton: HTMLButtonElement;
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
  readonly layerPlaces: HTMLInputElement;
  readonly layerLandUse: HTMLInputElement;
  readonly layerRoads: HTMLInputElement;
  readonly layerHedgerows: HTMLInputElement;
  readonly layerPrefabs: HTMLInputElement;
  readonly layerTerrainPads: HTMLInputElement;
  readonly layerNativeVegetation: HTMLInputElement;
  readonly layerVegetationReference: HTMLInputElement;
  readonly layerCountySettlements: HTMLInputElement;
  readonly layerCountyRoads: HTMLInputElement;
  readonly layerCountyBuildings: HTMLInputElement;
  readonly warningsPanel: HTMLElement;
  readonly openDialog: HTMLDialogElement;
  readonly openForm: HTMLFormElement;
  readonly openProjectInput: HTMLInputElement;
  readonly openCompanionsInput: HTMLInputElement;
  readonly openNpyInput: HTMLInputElement;
  readonly openDescriptorInput: HTMLInputElement;
  readonly openVegetationInput: HTMLInputElement;
  readonly openCountyInput: HTMLInputElement;
  readonly openCatalogInput: HTMLInputElement;
  readonly openDialogError: HTMLElement;
  readonly openButton: HTMLButtonElement;
  readonly projectTitle: HTMLElement;
  readonly dirtyMarker: HTMLElement;
  readonly projectState: HTMLElement;
  readonly inspectorTitle: HTMLElement;
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
          <button id="open-project" class="button" type="button">Open</button>
          <button id="save-project" class="button" type="button" disabled>Save</button>
          <button id="save-project-as" class="button" type="button" disabled>Save as</button>
          <span class="command-divider"></span>
          <button id="undo" class="button" type="button" disabled><span class="keycap">Ctrl Z</span> Undo</button>
          <button id="redo" class="button" type="button" disabled><span class="keycap">Ctrl Y</span> Redo</button>
          <span class="command-divider"></span>
          <button id="fit-terrain" class="button" type="button" disabled><span class="keycap">F</span> Fit terrain</button>
        </nav>
        <div id="project-state" class="project-state"><span class="state-dot"></span>No project</div>
      </header>

      <section class="workspace">
        <aside class="panel panel-left">
          <section class="panel-section authoring-section">
            <div class="section-heading"><span>01</span><h2>Authoring tools</h2></div>
            <div class="tool-stack" role="toolbar" aria-label="Geometry authoring tools">
              ${toolButton("select", "↖", "Select / move", "V")}
              <p class="tool-group-label">Place regions</p>
              <div class="tool-grid">
                ${toolButton("place:town", "T", "Town")}
                ${toolButton("place:village", "V", "Village")}
                ${toolButton("place:farm", "F", "Farm")}
                ${toolButton("place:military_area", "M", "Military")}
              </div>
              <p class="tool-group-label">Land use</p>
              <div class="tool-grid">
                ${toolButton("land:pasture", "P", "Pasture")}
                ${toolButton("land:rough_grazing", "R", "Rough grazing")}
                ${toolButton("land:woodland", "W", "Woodland")}
              </div>
              <p class="tool-group-label">Network</p>
              <div class="tool-grid">
                ${toolButton("road", "━", "Road")}
                ${toolButton("hedgerow", "┄", "Hedgerow")}
              </div>
            </div>
            <p id="tool-instructions" class="milestone-note">Create a terrain project to enable geometry authoring.</p>
          </section>
          <section class="panel-section prefab-section">
            <div class="section-heading"><span>02</span><h2>Prefab assets</h2></div>
            <label class="catalogue-picker" for="asset-catalog-file">
              <strong>Load asset catalogue v3</strong><small>Strict local JSON · resources remain logical IDs</small>
              <input id="asset-catalog-file" type="file" accept=".json,application/json" />
            </label>
            <label class="field-label compact-label" for="asset-select">Placement asset</label>
            <select id="asset-select" class="asset-select" disabled><option value="">No catalogue loaded</option></select>
            ${toolButton("prefab", "⌂", "Place prefab")}
            ${toolButton("frontage", "⇉", "Frontage assist")}
            <fieldset id="frontage-options" class="frontage-options" disabled>
              <legend>Frontage generation</legend>
              <div class="frontage-sides" role="radiogroup" aria-label="Frontage side">
                <label><input type="radio" name="frontage-side" value="left" checked /><span>Left</span></label>
                <label><input type="radio" name="frontage-side" value="right" /><span>Right</span></label>
                <label><input type="radio" name="frontage-side" value="both" /><span>Both</span></label>
              </div>
              <div class="frontage-measures">
                <label for="frontage-setback"><span>Road-edge setback</span><input id="frontage-setback" type="number" min="0" step="0.5" value="6" /><small>m</small></label>
                <label for="frontage-gap"><span>House gap</span><input id="frontage-gap" type="number" min="0" step="0.5" value="4" /><small>m</small></label>
                <label for="frontage-end-clearance"><span>End clearance</span><input id="frontage-end-clearance" type="number" min="0" step="0.5" value="5" /><small>m</small></label>
              </div>
              <p id="frontage-summary" class="frontage-summary" role="status">Select a house asset and create a road to begin.</p>
              <div class="frontage-actions">
                <button id="generate-frontage" class="button button-primary" type="button" disabled>Generate houses</button>
                <button id="clear-frontage" class="button" type="button" disabled>Clear range</button>
              </div>
            </fieldset>
            <p id="asset-summary" class="asset-summary">Load the shared catalogue to enable proxy placement.</p>
          </section>
          <section class="panel-section vegetation-section">
            <div class="section-heading"><span>03</span><h2>Native vegetation</h2></div>
            <label class="field-label compact-label" for="vegetation-type-select">Placement type</label>
            <select id="vegetation-type-select" class="asset-select">
              <option value="forest_tree">Forest tree</option>
              <option value="scattered_tree">Scattered tree</option>
              <option value="shrub">Shrub</option>
            </select>
            <label class="field-label compact-label" for="vegetation-asset-id">Logical species / asset ID</label>
            <input id="vegetation-asset-id" type="text" value="oak" spellcheck="false" />
            ${toolButton("vegetation", "♣", "Place vegetation")}
            <p class="asset-summary">Editable UUID records use chunked GPU batches; height is derived from working terrain.</p>
          </section>
          <section class="panel-section layers-section">
            <div class="section-heading"><span>04</span><h2>Terrain layers</h2></div>
            ${layerToggle("layer-terrain", "Terrain colour", "Elevation palette", "terrain-swatch")}
            ${layerToggle("layer-hillshade", "Hillshade", "Northwest lighting", "hillshade-swatch")}
            ${layerToggle("layer-contours", "Contours", "Adaptive metre interval", "contour-swatch")}
          </section>
          <section class="panel-section layers-section">
            <div class="section-heading"><span>05</span><h2>Authored layers</h2></div>
            ${layerToggle("layer-places", "Place regions", "Town, village, farm, military", "places-swatch")}
            ${layerToggle("layer-land-use", "Land use", "Pasture, grazing, woodland", "land-use-swatch")}
            ${layerToggle("layer-roads", "Native roads", "World-width geometry", "roads-swatch")}
            ${layerToggle("layer-hedgerows", "Hedgerows", "Editable control lines", "hedgerows-swatch")}
            ${layerToggle("layer-prefabs", "Prefabs", "Catalogue proxy footprints", "prefabs-swatch")}
            ${layerToggle("layer-terrain-pads", "Terrain pads", "Core and blend extents", "pads-swatch")}
            ${layerToggle("layer-native-vegetation", "Native vegetation", "Editable chunked GPU symbols", "native-vegetation-swatch")}
          </section>
          <section class="panel-section reference-section">
            <div class="section-heading"><span>06</span><h2>Reference sources</h2></div>
            <label class="compact-file" for="vegetation-reference-file"><strong>Vegetation v1</strong><input id="vegetation-reference-file" type="file" accept=".json,application/json" /></label>
            <p id="vegetation-summary" class="asset-summary">No imported vegetation reference.</p>
            <button id="convert-vegetation" class="button" type="button" disabled>Convert vegetation to editable</button>
            <label class="compact-file" for="county-reference-file"><strong>County features v3</strong><input id="county-reference-file" type="file" accept=".json,application/json" /></label>
            <p id="county-summary" class="asset-summary">No county reference.</p>
            <button id="convert-county" class="button" type="button" disabled>Convert county to native</button>
          </section>
          <section class="panel-section layers-section">
            <div class="section-heading"><span>07</span><h2>Reference layers</h2></div>
            ${layerToggle("layer-vegetation-reference", "Imported vegetation", "Single GPU points batch", "vegetation-swatch")}
            ${layerToggle("layer-county-settlements", "County settlements", "Dashed reference regions", "county-settlements-swatch")}
            ${layerToggle("layer-county-roads", "County roads", "Dashed reference lines", "county-roads-swatch")}
            ${layerToggle("layer-county-buildings", "County buildings", "Source footprint outlines", "county-buildings-swatch")}
          </section>
          <section class="panel-section export-section">
            <div class="section-heading"><span>08</span><h2>Exports</h2></div>
            <button id="export-viewer-bundle" class="button button-primary" type="button" disabled>Viewer bundle (.zip)</button>
            <button id="export-runtime" class="button" type="button" disabled>Runtime scenery v3</button>
            <button id="export-runtime-v2" class="button" type="button" disabled>Legacy runtime scenery v2</button>
            <button id="export-terrain" class="button" type="button" disabled>Final terrain PNG + JSON</button>
            <button id="export-vegetation" class="button" type="button" disabled>Resampled vegetation v1</button>
          </section>
          <section class="panel-section navigation-help">
            <div class="section-heading"><span>09</span><h2>Shortcuts</h2></div>
            <dl>
              <div><dt>Finish / cancel</dt><dd><kbd>Enter</kbd> / <kbd>Esc</kbd></dd></div>
              <div><dt>Draft point</dt><dd><kbd>Backspace</kbd></dd></div>
              <div><dt>Delete</dt><dd><kbd>Delete</kbd></dd></div>
              <div><dt>Vertex delete</dt><dd><kbd>Shift Delete</kbd></dd></div>
              <div><dt>Rotate object</dt><dd><kbd>Q</kbd> / <kbd>E</kbd></dd></div>
              <div><dt>Pan</dt><dd>Middle/right drag</dd></div>
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
            <h2 id="inspector-title">Terrain reference</h2>
          </section>
          <section id="inspector" class="inspector-empty">
            <div class="inspector-placeholder"></div>
            <h3>No terrain loaded</h3>
            <p>World dimensions, grid topology, elevation range, and the source fingerprint appear here.</p>
          </section>
          <section id="project-warnings" class="project-warnings" hidden></section>
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
        <div class="status-build">MILESTONES 0–5</div>
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

    <dialog id="open-project-dialog" class="project-dialog open-project-dialog">
      <form id="open-project-form" method="dialog">
        <div class="dialog-heading">
          <div><p class="eyebrow">OPEN SCENERY PROJECT</p><h2>Relink browser-readable sources</h2></div>
          <button class="icon-button" value="cancel" aria-label="Close open dialog" type="submit">×</button>
        </div>
        <p class="dialog-intro">Select the editable project and its source files. Saved paths are hints only; explicit relinks are required for absolute or moved paths.</p>
        <label class="field-label" for="open-project-file">Scenery project JSON</label>
        <input id="open-project-file" type="file" accept=".json,application/json" required />
        <label class="field-label open-field" for="open-companion-files">Companion files for relative-name matching</label>
        <input id="open-companion-files" type="file" multiple />
        <details class="relink-details" open>
          <summary>Explicit source relinks</summary>
          <div class="relink-grid">
            ${relinkField("open-terrain-npy", "Terrain NPY", ".npy,application/octet-stream")}
            ${relinkField("open-terrain-descriptor", "Terrain descriptor", ".json,application/json")}
            ${relinkField("open-vegetation", "Vegetation (optional)", ".json,application/json")}
            ${relinkField("open-county", "County features (optional)", ".json,application/json")}
            ${relinkField("open-catalog", "Asset catalogue (optional)", ".json,application/json")}
          </div>
        </details>
        <div id="open-dialog-error" class="dialog-error" role="alert" hidden></div>
        <div class="dialog-actions">
          <button class="button" value="cancel" type="submit">Cancel</button>
          <button id="open-project-confirm" class="button button-primary" value="default" type="submit">Validate &amp; open</button>
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
    openProjectButton: byId("open-project", HTMLButtonElement),
    saveButton: byId("save-project", HTMLButtonElement),
    saveAsButton: byId("save-project-as", HTMLButtonElement),
    fitButton: byId("fit-terrain", HTMLButtonElement),
    undoButton: byId("undo", HTMLButtonElement),
    redoButton: byId("redo", HTMLButtonElement),
    toolButtons: [...document.querySelectorAll<HTMLButtonElement>("[data-tool]")],
    toolInstructions: byId("tool-instructions", HTMLElement),
    assetCatalogInput: byId("asset-catalog-file", HTMLInputElement),
    assetSelect: byId("asset-select", HTMLSelectElement),
    assetSummary: byId("asset-summary", HTMLElement),
    frontageOptions: byId("frontage-options", HTMLFieldSetElement),
    frontageSideInputs: [...document.querySelectorAll<HTMLInputElement>("input[name='frontage-side']")],
    frontageSetback: byId("frontage-setback", HTMLInputElement),
    frontageGap: byId("frontage-gap", HTMLInputElement),
    frontageEndClearance: byId("frontage-end-clearance", HTMLInputElement),
    frontageSummary: byId("frontage-summary", HTMLElement),
    generateFrontageButton: byId("generate-frontage", HTMLButtonElement),
    clearFrontageButton: byId("clear-frontage", HTMLButtonElement),
    vegetationTypeSelect: byId("vegetation-type-select", HTMLSelectElement),
    vegetationAssetId: byId("vegetation-asset-id", HTMLInputElement),
    vegetationInput: byId("vegetation-reference-file", HTMLInputElement),
    countyInput: byId("county-reference-file", HTMLInputElement),
    vegetationSummary: byId("vegetation-summary", HTMLElement),
    countySummary: byId("county-summary", HTMLElement),
    convertCountyButton: byId("convert-county", HTMLButtonElement),
    convertVegetationButton: byId("convert-vegetation", HTMLButtonElement),
    exportViewerBundleButton: byId("export-viewer-bundle", HTMLButtonElement),
    exportRuntimeButton: byId("export-runtime", HTMLButtonElement),
    exportRuntimeV2Button: byId("export-runtime-v2", HTMLButtonElement),
    exportTerrainButton: byId("export-terrain", HTMLButtonElement),
    exportVegetationButton: byId("export-vegetation", HTMLButtonElement),
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
    layerPlaces: byId("layer-places", HTMLInputElement),
    layerLandUse: byId("layer-land-use", HTMLInputElement),
    layerRoads: byId("layer-roads", HTMLInputElement),
    layerHedgerows: byId("layer-hedgerows", HTMLInputElement),
    layerPrefabs: byId("layer-prefabs", HTMLInputElement),
    layerTerrainPads: byId("layer-terrain-pads", HTMLInputElement),
    layerNativeVegetation: byId("layer-native-vegetation", HTMLInputElement),
    layerVegetationReference: byId("layer-vegetation-reference", HTMLInputElement),
    layerCountySettlements: byId("layer-county-settlements", HTMLInputElement),
    layerCountyRoads: byId("layer-county-roads", HTMLInputElement),
    layerCountyBuildings: byId("layer-county-buildings", HTMLInputElement),
    warningsPanel: byId("project-warnings", HTMLElement),
    openDialog: byId("open-project-dialog", HTMLDialogElement),
    openForm: byId("open-project-form", HTMLFormElement),
    openProjectInput: byId("open-project-file", HTMLInputElement),
    openCompanionsInput: byId("open-companion-files", HTMLInputElement),
    openNpyInput: byId("open-terrain-npy", HTMLInputElement),
    openDescriptorInput: byId("open-terrain-descriptor", HTMLInputElement),
    openVegetationInput: byId("open-vegetation", HTMLInputElement),
    openCountyInput: byId("open-county", HTMLInputElement),
    openCatalogInput: byId("open-catalog", HTMLInputElement),
    openDialogError: byId("open-dialog-error", HTMLElement),
    openButton: byId("open-project-confirm", HTMLButtonElement),
    projectTitle: byId("project-title", HTMLElement),
    dirtyMarker: byId("dirty-marker", HTMLElement),
    projectState: byId("project-state", HTMLElement),
    inspectorTitle: byId("inspector-title", HTMLElement),
    inspector: byId("inspector", HTMLElement),
    statusCoordinates: byId("status-coordinates", HTMLElement),
    statusElevation: byId("status-elevation", HTMLElement),
    statusSlope: byId("status-slope", HTMLElement),
    statusMessage: byId("status-message", HTMLElement),
    viewReadout: byId("view-readout", HTMLElement),
  };
}

function toolButton(tool: string, symbol: string, label: string, shortcut = ""): string {
  return `
    <button class="tool-button${tool === "select" ? " is-active" : ""}" data-tool="${tool}" type="button" aria-pressed="${tool === "select" ? "true" : "false"}" disabled>
      <span class="tool-symbol">${symbol}</span><strong>${label}</strong>${shortcut ? `<kbd>${shortcut}</kbd>` : ""}
    </button>`;
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

function relinkField(id: string, label: string, accept: string): string {
  return `<label for="${id}"><span>${label}</span><input id="${id}" type="file" accept="${accept}" /></label>`;
}
