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
  readonly countyBuildOptions: HTMLFieldSetElement;
  readonly countyOutputMode: HTMLSelectElement;
  readonly countySourceMode: HTMLSelectElement;
  readonly countyMainPlace: HTMLSelectElement;
  readonly countySettlementCount: HTMLInputElement;
  readonly countySeed: HTMLInputElement;
  readonly countySiteMix: HTMLSelectElement;
  readonly countyCreateBackbone: HTMLInputElement;
  readonly countyBackboneOrientation: HTMLSelectElement;
  readonly countyGridStep: HTMLInputElement;
  readonly countyMaximumGrade: HTMLInputElement;
  readonly countyRadiusScale: HTMLInputElement;
  readonly countyLocalEdgeClearance: HTMLInputElement;
  readonly countyBackboneWidth: HTMLInputElement;
  readonly countyAccessWidth: HTMLInputElement;
  readonly countyLocalWidth: HTMLInputElement;
  readonly countyDrivewayWidth: HTMLInputElement;
  readonly countySetback: HTMLInputElement;
  readonly countyGap: HTMLInputElement;
  readonly countyEndClearance: HTMLInputElement;
  readonly countyMaximumPlotSlope: HTMLInputElement;
  readonly countyJunctionClearance: HTMLInputElement;
  readonly countySpacingJitter: HTMLInputElement;
  readonly countyYawJitter: HTMLInputElement;
  readonly countyMaximumRoutes: HTMLInputElement;
  readonly countyMaximumVisitedNodes: HTMLInputElement;
  readonly countyMaximumPrefabs: HTMLInputElement;
  readonly countyMaximumDriveways: HTMLInputElement;
  readonly countyStyleSelects: readonly HTMLSelectElement[];
  readonly countyDriveways: HTMLInputElement;
  readonly countyAssetRoleSelects: readonly HTMLSelectElement[];
  readonly generateCountyButton: HTMLButtonElement;
  readonly cancelCountyButton: HTMLButtonElement;
  readonly bakeCountyButton: HTMLButtonElement;
  readonly clearCountyButton: HTMLButtonElement;
  readonly countyBuildProgress: HTMLProgressElement;
  readonly countyBuildSummary: HTMLElement;
  readonly countyBuildDiagnostics: HTMLElement;
  readonly countyPreviewPlaceFilter: HTMLSelectElement;
  readonly countyPreviewClassFilters: readonly HTMLInputElement[];
  readonly settlementSurveyOptions: HTMLFieldSetElement;
  readonly settlementProfile: HTMLSelectElement;
  readonly settlementCandidateCount: HTMLInputElement;
  readonly settlementRadius: HTMLInputElement;
  readonly settlementMaximumSlope: HTMLInputElement;
  readonly settlementMinimumSeparation: HTMLInputElement;
  readonly settlementEdgeClearance: HTMLInputElement;
  readonly settlementUsePreferredElevation: HTMLInputElement;
  readonly settlementPreferredElevation: HTMLInputElement;
  readonly settlementSeed: HTMLInputElement;
  readonly settlementAttemptBudget: HTMLInputElement;
  readonly runSettlementSurveyButton: HTMLButtonElement;
  readonly acceptSettlementsButton: HTMLButtonElement;
  readonly clearSettlementSurveyButton: HTMLButtonElement;
  readonly settlementSurveySummary: HTMLElement;
  readonly settlementSurveyCandidates: HTMLElement;
  readonly routeRoadOptions: HTMLFieldSetElement;
  readonly routeSnapEndpoints: HTMLInputElement;
  readonly routeRoadClass: HTMLSelectElement;
  readonly routeRoadSurface: HTMLSelectElement;
  readonly routeRoadWidth: HTMLInputElement;
  readonly routeGridStep: HTMLInputElement;
  readonly routeSlopeWeight: HTMLInputElement;
  readonly routeMaximumGrade: HTMLInputElement;
  readonly routeTurnPenalty: HTMLInputElement;
  readonly routeEdgeClearance: HTMLInputElement;
  readonly routeSeed: HTMLInputElement;
  readonly routeSummary: HTMLElement;
  readonly acceptRoadRouteButton: HTMLButtonElement;
  readonly clearRoadRouteButton: HTMLButtonElement;
  readonly settlementFrontageOptions: HTMLFieldSetElement;
  readonly settlementFrontageRoads: HTMLElement;
  readonly settlementFrontageMaximumSlope: HTMLInputElement;
  readonly settlementFrontageJunctionClearance: HTMLInputElement;
  readonly settlementFrontageSpacingJitter: HTMLInputElement;
  readonly settlementFrontageYawJitter: HTMLInputElement;
  readonly settlementFrontageSeed: HTMLInputElement;
  readonly populateSettlementButton: HTMLButtonElement;
  readonly generateSettlementFrontageButton: HTMLButtonElement;
  readonly clearSettlementFrontageButton: HTMLButtonElement;
  readonly settlementFrontageSummary: HTMLElement;
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
                ${toolButton("route_road", "⌁", "Route road")}
              </div>
            </div>
            <p id="tool-instructions" class="milestone-note">Create a terrain project to enable geometry authoring.</p>
          </section>
          <section class="panel-section county-build-section">
            <div class="section-heading"><span>SN</span><h2>Build County</h2></div>
            <fieldset id="county-build-options" class="settlement-survey-options county-build-options" disabled>
              <p class="settlement-frontage-context">Generate settlements, the county network, internal streets, junction-aware frontage, buildings, and optional driveways as one complete preview.</p>
              <label class="survey-profile" for="county-output-mode"><span>Workflow</span>
                <select id="county-output-mode">
                  <option value="full">Build complete county</option>
                  <option value="network_only">Network only for existing places</option>
                </select>
              </label>
              <label class="survey-profile" for="county-source-mode"><span>Settlement source</span>
                <select id="county-source-mode">
                  <option value="survey">Survey terrain automatically</option>
                  <option value="existing_places">Use existing place regions</option>
                </select>
              </label>
              <label class="survey-profile" for="county-main-place"><span>Main settlement</span>
                <select id="county-main-place"><option value="">Auto (highest-ranked town)</option></select>
              </label>
              <div class="survey-measures county-build-measures">
                <label for="county-settlement-count"><span>Settlements</span><input id="county-settlement-count" type="number" min="1" max="25" step="1" value="5" /></label>
                <label for="county-seed"><span>County seed</span><input id="county-seed" type="number" step="1" value="1" /></label>
              </div>
              <label class="survey-preferred-toggle" for="county-create-backbone">
                <input id="county-create-backbone" type="checkbox" checked />
                <span>Create county backbone</span>
              </label>
              <details class="county-build-advanced">
                <summary>Advanced county policy</summary>
                <label class="survey-profile" for="county-backbone-orientation"><span>Backbone orientation</span>
                  <select id="county-backbone-orientation">
                    <option value="auto">Auto</option>
                    <option value="west_east">West-East</option>
                    <option value="north_south">North-South</option>
                  </select>
                </label>
                <label class="survey-profile" for="county-site-mix"><span>Survey site mix</span>
                  <select id="county-site-mix">
                    <option value="balanced">Balanced</option>
                    <option value="urban">Urban-weighted</option>
                    <option value="rural">Rural-weighted</option>
                  </select>
                </label>
                <p class="tool-group-label">Internal street styles</p>
                <div class="county-asset-program county-style-program">
                  ${countyStyleSelect("town", "Town", "planned")}
                  ${countyStyleSelect("village", "Village", "roadside")}
                  ${countyStyleSelect("hamlet", "Hamlet", "roadside")}
                  ${countyStyleSelect("farm", "Farm", "agricultural")}
                </div>
                <div class="survey-measures county-build-measures">
                  <label for="county-grid-step"><span>A* grid step</span><input id="county-grid-step" type="number" min="0.1" step="1" value="50" /><small>m</small></label>
                  <label for="county-maximum-grade"><span>Maximum grade</span><input id="county-maximum-grade" type="number" min="0.001" step="0.01" value="0.18" /></label>
                  <label for="county-radius-scale"><span>Survey footprint multiplier</span><input id="county-radius-scale" type="number" min="0.05" max="4" step="0.05" value="1" /></label>
                  <label for="county-local-edge-clearance"><span>Street edge clearance</span><input id="county-local-edge-clearance" type="number" min="0" step="0.5" value="2" /><small>m</small></label>
                </div>
                <p class="tool-group-label">Generated road widths</p>
                <div class="survey-measures county-build-measures">
                  <label for="county-backbone-width"><span>Backbone</span><input id="county-backbone-width" type="number" min="0.1" step="0.5" value="9" /><small>m</small></label>
                  <label for="county-access-width"><span>Access</span><input id="county-access-width" type="number" min="0.1" step="0.5" value="6" /><small>m</small></label>
                  <label for="county-local-width"><span>Local/terminal</span><input id="county-local-width" type="number" min="0.1" step="0.5" value="4.4" /><small>m</small></label>
                  <label for="county-driveway-width"><span>Driveway</span><input id="county-driveway-width" type="number" min="0.1" step="0.2" value="2.8" /><small>m</small></label>
                </div>
                <label class="survey-preferred-toggle" for="county-driveways">
                  <input id="county-driveways" type="checkbox" checked />
                  <span>Generate valid driveway roads</span>
                </label>
                <p class="tool-group-label">County frontage safety and density</p>
                <div class="survey-measures county-build-measures">
                  <label for="county-setback"><span>County building offset</span><input id="county-setback" type="number" min="0" step="0.5" value="6" /><small>m</small></label>
                  <label for="county-gap"><span>Building gap</span><input id="county-gap" type="number" min="0" step="0.5" value="4" /><small>m</small></label>
                  <label for="county-end-clearance"><span>County endpoint margin</span><input id="county-end-clearance" type="number" min="0" step="0.5" value="5" /><small>m</small></label>
                  <label for="county-maximum-plot-slope"><span>County terrain angle cap</span><input id="county-maximum-plot-slope" type="number" min="0" max="89.9" step="0.5" value="18" /><small>°</small></label>
                  <label for="county-junction-clearance"><span>County intersection margin</span><input id="county-junction-clearance" type="number" min="0" step="0.5" value="8" /><small>m</small></label>
                  <label for="county-spacing-jitter"><span>County spacing variation</span><input id="county-spacing-jitter" type="number" min="0" step="0.1" value="0" /><small>m</small></label>
                  <label for="county-yaw-jitter"><span>County facing variation</span><input id="county-yaw-jitter" type="number" min="0" max="45" step="0.5" value="0" /><small>°</small></label>
                </div>
                <p class="tool-group-label">Building asset programme</p>
                <div class="county-asset-program">
                  ${countyAssetSelect("house", "House (required)")}
                  ${countyAssetSelect("shop", "Shop")}
                  ${countyAssetSelect("civic", "Civic")}
                  ${countyAssetSelect("farmhouse", "Farmhouse")}
                  ${countyAssetSelect("barn", "Barn")}
                  ${countyAssetSelect("shed", "Shed")}
                  ${countyAssetSelect("warehouse", "Warehouse")}
                </div>
                <p class="tool-group-label">Whole-build budgets</p>
                <div class="survey-measures county-build-measures">
                  <label for="county-maximum-routes"><span>Routes</span><input id="county-maximum-routes" type="number" min="1" max="256" step="1" value="64" /></label>
                  <label for="county-maximum-visited-nodes"><span>A* visited nodes</span><input id="county-maximum-visited-nodes" type="number" min="1" step="10000" value="5000000" /></label>
                  <label for="county-maximum-prefabs"><span>Buildings</span><input id="county-maximum-prefabs" type="number" min="1" step="100" value="5000" /></label>
                  <label for="county-maximum-driveways"><span>Driveways</span><input id="county-maximum-driveways" type="number" min="1" step="100" value="5000" /></label>
                </div>
              </details>
              <div class="county-build-actions">
                <button id="generate-county-preview" class="button button-primary" type="button">Generate County Preview</button>
                <button id="cancel-county-build" class="button" type="button" disabled>Cancel</button>
                <button id="bake-county" class="button" type="button" disabled>Bake County</button>
                <button id="clear-county-preview" class="button" type="button" disabled>Clear preview</button>
              </div>
              <progress id="county-build-progress" class="county-build-progress" max="1" value="0" hidden></progress>
              <p id="county-build-summary" class="settlement-survey-summary county-build-summary" role="status">Map a house asset, then generate a complete county preview.</p>
              <details class="county-build-advanced county-preview-filters">
                <summary>Preview filters</summary>
                <label class="survey-profile" for="county-preview-place"><span>Settlement</span><select id="county-preview-place"><option value="">All settlements</option></select></label>
                <div class="county-preview-filter-grid">
                  ${countyPreviewFilter("places", "Places")}
                  ${countyPreviewFilter("roads", "Roads")}
                  ${countyPreviewFilter("prefabs", "Buildings")}
                  ${countyPreviewFilter("junctions", "Junctions")}
                  ${countyPreviewFilter("skipped", "Skipped")}
                </div>
              </details>
              <div id="county-build-diagnostics" class="county-build-diagnostics" aria-label="County build diagnostics"></div>
            </fieldset>
          </section>
          <section class="panel-section settlement-survey-section">
            <div class="section-heading"><span>SA</span><h2>Settlement survey</h2></div>
            <fieldset id="settlement-survey-options" class="settlement-survey-options" disabled>
              <label class="survey-profile" for="settlement-profile"><span>Profile / place type</span>
                <select id="settlement-profile">
                  <option value="town">Town</option>
                  <option value="village">Village</option>
                  <option value="hamlet">Hamlet-sized → village</option>
                  <option value="farm">Farm</option>
                </select>
              </label>
              <div class="survey-measures">
                <label for="settlement-candidate-count"><span>Candidates</span><input id="settlement-candidate-count" type="number" min="1" max="100" step="1" value="5" /></label>
                <label for="settlement-radius"><span>Radius</span><input id="settlement-radius" type="number" min="0.1" step="1" value="470" /><small>m</small></label>
                <label for="settlement-maximum-slope"><span>Maximum slope</span><input id="settlement-maximum-slope" type="number" min="0.1" max="89.9" step="0.1" value="6.3" /><small>°</small></label>
                <label for="settlement-minimum-separation"><span>Minimum separation</span><input id="settlement-minimum-separation" type="number" min="0" step="10" value="250" /><small>m</small></label>
                <label for="settlement-edge-clearance"><span>World-edge clearance</span><input id="settlement-edge-clearance" type="number" min="0" step="10" value="50" /><small>m</small></label>
                <label for="settlement-seed"><span>Integer seed</span><input id="settlement-seed" type="number" step="1" value="1" /></label>
                <label for="settlement-attempt-budget"><span>Attempt budget</span><input id="settlement-attempt-budget" type="number" min="1" max="100000" step="100" value="1000" /></label>
              </div>
              <label class="survey-preferred-toggle" for="settlement-use-preferred-elevation">
                <input id="settlement-use-preferred-elevation" type="checkbox" checked />
                <span>Prefer elevation near lowland reference</span>
              </label>
              <label class="survey-preferred-value" for="settlement-preferred-elevation"><span>Preferred elevation</span><input id="settlement-preferred-elevation" type="number" step="1" value="0" /><small>m</small></label>
              <div class="settlement-survey-actions">
                <button id="run-settlement-survey" class="button button-primary" type="button">Run survey</button>
                <button id="accept-settlements" class="button" type="button" disabled>Accept selected</button>
                <button id="clear-settlement-survey" class="button" type="button" disabled>Clear preview</button>
              </div>
              <p id="settlement-survey-summary" class="settlement-survey-summary" role="status">Run a deterministic survey over the current working terrain.</p>
              <div id="settlement-survey-candidates" class="settlement-survey-candidates" aria-label="Ranked settlement candidates"></div>
            </fieldset>
          </section>
          <section class="panel-section route-road-section">
            <div class="section-heading"><span>SA</span><h2>Terrain road routing</h2></div>
            <fieldset id="route-road-options" class="settlement-survey-options route-road-options" disabled>
              <div class="route-road-selects">
                <label for="route-road-class"><span>Class for routed road</span>
                  <select id="route-road-class">
                    <option value="county_road">County road</option>
                    <option value="local_road" selected>Local road</option>
                    <option value="lane">Lane</option>
                    <option value="farm_track">Farm track</option>
                    <option value="military_road">Military road</option>
                  </select>
                </label>
                <label for="route-road-surface"><span>Material for routed road</span>
                  <select id="route-road-surface">
                    <option value="dirt">Dirt</option>
                    <option value="gravel" selected>Gravel</option>
                    <option value="paved">Paved</option>
                  </select>
                </label>
              </div>
              <div class="survey-measures route-road-measures">
                <label for="route-road-width"><span>Routed width</span><input id="route-road-width" type="number" min="0.1" step="0.5" value="7.5" /><small>m</small></label>
                <label for="route-grid-step"><span>Routing grid step</span><input id="route-grid-step" type="number" min="0.1" step="1" value="50" /><small>m</small></label>
                <label for="route-slope-weight"><span>Slope penalty</span><input id="route-slope-weight" type="number" min="0" step="1" value="42" /></label>
                <label for="route-maximum-grade"><span>Maximum grade</span><input id="route-maximum-grade" type="number" min="0.001" step="0.01" value="0.18" /></label>
                <label for="route-turn-penalty"><span>Turn penalty</span><input id="route-turn-penalty" type="number" min="0" step="0.5" value="4" /><small>m</small></label>
                <label for="route-edge-clearance"><span>Routing edge margin</span><input id="route-edge-clearance" type="number" min="0" step="1" value="0" /><small>m</small></label>
                <label for="route-seed"><span>Tie-breaking seed</span><input id="route-seed" type="number" step="1" value="1" /></label>
              </div>
              <label class="survey-preferred-toggle" for="route-snap-endpoints">
                <input id="route-snap-endpoints" type="checkbox" checked />
                <span>Snap clicks to shown native roads</span>
              </label>
              <div class="settlement-survey-actions route-road-actions">
                <button id="accept-road-route" class="button button-primary" type="button" disabled>Accept route</button>
                <button id="clear-road-route" class="button" type="button" disabled>Cancel / clear</button>
              </div>
              <p id="route-summary" class="settlement-survey-summary route-summary" role="status">Turn on Route road, then click a start and destination.</p>
            </fieldset>
          </section>
          <section class="panel-section settlement-frontage-section">
            <div class="section-heading"><span>SA</span><h2>Populate settlement</h2></div>
            <fieldset id="settlement-frontage-options" class="settlement-survey-options settlement-frontage-options" disabled>
              <p class="settlement-frontage-context">Select an editable place region and a house asset. Side, setback, gap, and end clearance come from Frontage generation below.</p>
              <div>
                <p class="tool-group-label">Eligible road ranges</p>
                <div id="settlement-frontage-roads" class="settlement-frontage-roads" aria-label="Eligible settlement roads"></div>
              </div>
              <div class="survey-measures settlement-frontage-measures">
                <label for="settlement-frontage-maximum-slope"><span>Plot slope limit</span><input id="settlement-frontage-maximum-slope" type="number" min="0.1" max="89.9" step="0.1" value="15" /><small>°</small></label>
                <label for="settlement-frontage-junction-clearance"><span>Junction clearance</span><input id="settlement-frontage-junction-clearance" type="number" min="0" step="1" value="18" /><small>m</small></label>
                <label for="settlement-frontage-spacing-jitter"><span>Spacing jitter</span><input id="settlement-frontage-spacing-jitter" type="number" min="0" step="0.5" value="0" /><small>m</small></label>
                <label for="settlement-frontage-yaw-jitter"><span>Yaw jitter</span><input id="settlement-frontage-yaw-jitter" type="number" min="0" max="180" step="0.5" value="0" /><small>°</small></label>
                <label for="settlement-frontage-seed"><span>Population seed</span><input id="settlement-frontage-seed" type="number" step="1" value="1" /></label>
              </div>
              <div class="settlement-survey-actions settlement-frontage-actions">
                <button id="populate-settlement" class="button button-primary" type="button" disabled>Populate settlement</button>
                <button id="generate-settlement-frontage" class="button" type="button" aria-label="Generate settlement houses" disabled>Generate houses</button>
                <button id="clear-settlement-frontage" class="button" type="button" disabled>Clear preview</button>
              </div>
              <p id="settlement-frontage-summary" class="settlement-survey-summary settlement-frontage-summary" role="status">Select a place region and house asset to begin.</p>
            </fieldset>
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
        <div class="status-build">MILESTONES 0–5 · SA-4</div>
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
    countyBuildOptions: byId("county-build-options", HTMLFieldSetElement),
    countyOutputMode: byId("county-output-mode", HTMLSelectElement),
    countySourceMode: byId("county-source-mode", HTMLSelectElement),
    countyMainPlace: byId("county-main-place", HTMLSelectElement),
    countySettlementCount: byId("county-settlement-count", HTMLInputElement),
    countySeed: byId("county-seed", HTMLInputElement),
    countySiteMix: byId("county-site-mix", HTMLSelectElement),
    countyCreateBackbone: byId("county-create-backbone", HTMLInputElement),
    countyBackboneOrientation: byId("county-backbone-orientation", HTMLSelectElement),
    countyGridStep: byId("county-grid-step", HTMLInputElement),
    countyMaximumGrade: byId("county-maximum-grade", HTMLInputElement),
    countyRadiusScale: byId("county-radius-scale", HTMLInputElement),
    countyLocalEdgeClearance: byId("county-local-edge-clearance", HTMLInputElement),
    countyBackboneWidth: byId("county-backbone-width", HTMLInputElement),
    countyAccessWidth: byId("county-access-width", HTMLInputElement),
    countyLocalWidth: byId("county-local-width", HTMLInputElement),
    countyDrivewayWidth: byId("county-driveway-width", HTMLInputElement),
    countySetback: byId("county-setback", HTMLInputElement),
    countyGap: byId("county-gap", HTMLInputElement),
    countyEndClearance: byId("county-end-clearance", HTMLInputElement),
    countyMaximumPlotSlope: byId("county-maximum-plot-slope", HTMLInputElement),
    countyJunctionClearance: byId("county-junction-clearance", HTMLInputElement),
    countySpacingJitter: byId("county-spacing-jitter", HTMLInputElement),
    countyYawJitter: byId("county-yaw-jitter", HTMLInputElement),
    countyMaximumRoutes: byId("county-maximum-routes", HTMLInputElement),
    countyMaximumVisitedNodes: byId("county-maximum-visited-nodes", HTMLInputElement),
    countyMaximumPrefabs: byId("county-maximum-prefabs", HTMLInputElement),
    countyMaximumDriveways: byId("county-maximum-driveways", HTMLInputElement),
    countyStyleSelects: [...document.querySelectorAll<HTMLSelectElement>("select[data-county-style-profile]")],
    countyDriveways: byId("county-driveways", HTMLInputElement),
    countyAssetRoleSelects: [...document.querySelectorAll<HTMLSelectElement>("select[data-county-asset-role]")],
    generateCountyButton: byId("generate-county-preview", HTMLButtonElement),
    cancelCountyButton: byId("cancel-county-build", HTMLButtonElement),
    bakeCountyButton: byId("bake-county", HTMLButtonElement),
    clearCountyButton: byId("clear-county-preview", HTMLButtonElement),
    countyBuildProgress: byId("county-build-progress", HTMLProgressElement),
    countyBuildSummary: byId("county-build-summary", HTMLElement),
    countyBuildDiagnostics: byId("county-build-diagnostics", HTMLElement),
    countyPreviewPlaceFilter: byId("county-preview-place", HTMLSelectElement),
    countyPreviewClassFilters: [...document.querySelectorAll<HTMLInputElement>("input[data-county-preview-class]")],
    settlementSurveyOptions: byId("settlement-survey-options", HTMLFieldSetElement),
    settlementProfile: byId("settlement-profile", HTMLSelectElement),
    settlementCandidateCount: byId("settlement-candidate-count", HTMLInputElement),
    settlementRadius: byId("settlement-radius", HTMLInputElement),
    settlementMaximumSlope: byId("settlement-maximum-slope", HTMLInputElement),
    settlementMinimumSeparation: byId("settlement-minimum-separation", HTMLInputElement),
    settlementEdgeClearance: byId("settlement-edge-clearance", HTMLInputElement),
    settlementUsePreferredElevation: byId("settlement-use-preferred-elevation", HTMLInputElement),
    settlementPreferredElevation: byId("settlement-preferred-elevation", HTMLInputElement),
    settlementSeed: byId("settlement-seed", HTMLInputElement),
    settlementAttemptBudget: byId("settlement-attempt-budget", HTMLInputElement),
    runSettlementSurveyButton: byId("run-settlement-survey", HTMLButtonElement),
    acceptSettlementsButton: byId("accept-settlements", HTMLButtonElement),
    clearSettlementSurveyButton: byId("clear-settlement-survey", HTMLButtonElement),
    settlementSurveySummary: byId("settlement-survey-summary", HTMLElement),
    settlementSurveyCandidates: byId("settlement-survey-candidates", HTMLElement),
    routeRoadOptions: byId("route-road-options", HTMLFieldSetElement),
    routeSnapEndpoints: byId("route-snap-endpoints", HTMLInputElement),
    routeRoadClass: byId("route-road-class", HTMLSelectElement),
    routeRoadSurface: byId("route-road-surface", HTMLSelectElement),
    routeRoadWidth: byId("route-road-width", HTMLInputElement),
    routeGridStep: byId("route-grid-step", HTMLInputElement),
    routeSlopeWeight: byId("route-slope-weight", HTMLInputElement),
    routeMaximumGrade: byId("route-maximum-grade", HTMLInputElement),
    routeTurnPenalty: byId("route-turn-penalty", HTMLInputElement),
    routeEdgeClearance: byId("route-edge-clearance", HTMLInputElement),
    routeSeed: byId("route-seed", HTMLInputElement),
    routeSummary: byId("route-summary", HTMLElement),
    acceptRoadRouteButton: byId("accept-road-route", HTMLButtonElement),
    clearRoadRouteButton: byId("clear-road-route", HTMLButtonElement),
    settlementFrontageOptions: byId("settlement-frontage-options", HTMLFieldSetElement),
    settlementFrontageRoads: byId("settlement-frontage-roads", HTMLElement),
    settlementFrontageMaximumSlope: byId("settlement-frontage-maximum-slope", HTMLInputElement),
    settlementFrontageJunctionClearance: byId("settlement-frontage-junction-clearance", HTMLInputElement),
    settlementFrontageSpacingJitter: byId("settlement-frontage-spacing-jitter", HTMLInputElement),
    settlementFrontageYawJitter: byId("settlement-frontage-yaw-jitter", HTMLInputElement),
    settlementFrontageSeed: byId("settlement-frontage-seed", HTMLInputElement),
    populateSettlementButton: byId("populate-settlement", HTMLButtonElement),
    generateSettlementFrontageButton: byId("generate-settlement-frontage", HTMLButtonElement),
    clearSettlementFrontageButton: byId("clear-settlement-frontage", HTMLButtonElement),
    settlementFrontageSummary: byId("settlement-frontage-summary", HTMLElement),
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

function countyAssetSelect(role: string, label: string): string {
  return `<label for="county-asset-${role}"><span>${label}</span><select id="county-asset-${role}" data-county-asset-role="${role}" multiple size="2" disabled><option value="">${role === "house" ? "Choose one or more assets" : "Disabled / unmapped"}</option></select></label>`;
}

function countyStyleSelect(profile: string, label: string, selected: string): string {
  const options = ["planned", "organic", "roadside", "agricultural"]
    .map((style) => `<option value="${style}" ${style === selected ? "selected" : ""}>${style.charAt(0).toUpperCase() + style.slice(1)}</option>`)
    .join("");
  return `<label for="county-style-${profile}"><span>${label}</span><select id="county-style-${profile}" data-county-style-profile="${profile}">${options}</select></label>`;
}

function countyPreviewFilter(value: string, label: string): string {
  return `<label><input type="checkbox" data-county-preview-class="${value}" checked /><span>${label}</span></label>`;
}
