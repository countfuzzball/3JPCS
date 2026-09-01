# Settlement network and county orchestration plan

Status: SN-0 through SN-4 implemented. This work sits after settlement-automation SA-4
and before the initiative's final SA-5 performance, compatibility, and documentation
milestone.

This document specifies the missing high-level automation layer for the browser
editor. Its primary product is not merely an automatic road tool. It is a translated
recreation of the useful settlement-building chain in the earlier
`world_builder.py`:

```text
Build County
  -> survey and rank candidate settlement sites
  -> choose the best X sites and designate the main settlement
  -> optionally create a primary county backbone
  -> connect the remaining settlements to the growing road network
  -> generate style-specific internal streets and junctions
  -> populate frontage with buildings and property access
  -> preview the complete generated county
  -> bake it as ordinary editable editor entities
```

The policy reference is the user's earlier
`polygon_county_streaming_runtime_v0.5/tools/world_builder.py`, principally
`generate_settlements()`, `generate_roads()`, `_nearest_point_on_roads()`,
`_generate_local_network()`, `_generate_junctions()`, `_plot_candidates()`,
`generate_buildings()`, `_generate_roadside_properties()`, and the higher-level
`build()` sequence. The Python code is reference material only. The implementation
remains native TypeScript and reuses the editor's existing working terrain, SA-2
survey, SA-3 A* worker, SA-4 frontage planning, project entities, Three.js preview,
history, persistence, and export paths.

The milestone IDs use the `SN-` prefix. This preserves the completed SA-0 through
SA-4 history while adding the county-level composition those manual capabilities do
not provide on their own.

## 1. Product intent

### 1.1 Primary workflow: Build County

The default user experience is deliberately high level:

1. Open **Build County** and choose the site count, seed, county-road policy,
   settlement styles, and building assets.
2. Press **Generate County Preview** once.
3. The orchestrator runs the entire settlement chain against an immutable snapshot of
   the current terrain and relevant project entities.
4. Inspect one coherent preview containing proposed places, county roads, local
   streets, junctions, buildings, property access, and diagnostics.
5. Press **Bake County** once to create the complete accepted result as ordinary
   editable records in one composite history action.

The preview is the one-click generation experience. Baking remains a second deliberate
action so a poor seed, unsuitable terrain, missing asset mapping, or failed route can
never silently rewrite the project.

### 1.2 Manual workflows remain first-class

The orchestrator does not replace the implemented specialist tools:

- SA-2 remains available for surveying, reviewing, and baking selected sites.
- SA-3 remains available for individual two-click terrain-aware road routing.
- SA-4 remains available for populating one selected settlement or road set.
- A selected-settlement network mode may preview and bake access/local streets for one
  existing place.
- Ordinary place, road, and prefab editing remains available after any generated
  county is baked.

These tools and the high-level orchestrator must call the same pure planning engines.
There must not be a separate simplified algorithm that only the one-click workflow
uses.

### 1.3 Baked, not live procedural

The generated county is a starting point for editing, not a persistent procedural
graph. Later edits to terrain, place polygons, roads, or prefabs do not automatically
regenerate other objects. Running Build County again creates a new preview; it does not
secretly update the previous generation.

## 2. Scope boundary

Included in the Build County chain:

- running the existing SA-2 survey transiently and selecting the best `X` valid sites;
- deterministic main-settlement selection with an explicit user override;
- optional automatic county-backbone creation;
- incremental settlement-to-network A* connections;
- planned, organic, roadside, and agricultural internal street templates;
- junction generation and clearance;
- settlement frontage on all eligible generated roads;
- deterministic building-role selection and catalogue asset mapping;
- optional short driveway/property-access roads;
- complete batched preview, progress, cancellation, validation, and diagnostics;
- one composite bake/undo/redo for the generated places, roads, and prefabs; and
- continued availability of all manual settlement-generation tools.

The translated editor scope intentionally does not reproduce unrelated offline-runtime
steps from legacy `build()`:

- terrain synthesis (the editor already consumes an explicit working terrain);
- residents or demographic records;
- billboards and shooting-range gameplay semantics;
- runtime tile compilation, SVG preview generation, or text-report file generation;
- runtime-side procedural regeneration;
- bridges, tunnels, switchbacks, road grading/deformation, cut-and-fill, or retaining
  structures; and
- automatic movement or deletion of existing authored objects.

The first implementation may omit a building candidate whose requested role has no
asset mapping, but it must report the omission. It must never silently substitute an
unrelated asset. A mapped house asset is the minimum requirement for Build County.

## 3. Legacy-to-editor translation

| Legacy behavior | Editor treatment |
| --- | --- |
| Global `build()` calls every generator in sequence | Preserve the settlement/road/building sequence behind **Generate County Preview** |
| Legacy builder first creates its own heightfield | Replace with a snapshot of the editor's current `WorkingTerrain` |
| Best candidates become settlements immediately | Keep candidates transient until the complete county is baked |
| First settlement is the county-network seed | Make the main settlement explicit; default to the highest-ranked selected town, then the highest-ranked site |
| West/east primary road passes through the main settlement | Preserve as optional **Create county backbone**, with configurable deterministic orientation |
| Each later settlement joins the nearest current county road | Preserve; every successful planned access road joins the transient growing network before the next route |
| Circular centre/radius settlement model | Adapt to actual place polygons with deterministic interior anchors and local extents |
| Access-road tangent defines local street axes | Preserve using shared polyline metrics at the settlement anchor |
| Planned/organic/roadside/agricultural templates | Preserve policy in normalized local coordinates, clipped to the place polygon |
| Junction, road-role, plot-road, and connection records | Keep as transient planning semantics; bake ordinary current road records |
| Mixed building kinds and random dimensions | Map semantic roles to explicit catalogue assets and use their real proxy footprints |
| Buildings face serving roads and receive driveways | Preserve facing and `frontage_road_id`; optionally bake driveway geometry as ordinary roads |
| Straight route fallback after A* failure | Remove; expose failure and keep the project unchanged |
| Legacy fixed IDs and implicit random streams | Generate editor UUIDs at bake time and use named deterministic seed streams |
| Offline output is immediately written | Replace with a complete non-mutating preview followed by explicit atomic bake |

This is intended to be close to the legacy experience and policy, not a byte-for-byte
port of its world format or numerical accidents.

## 4. Fixed design decisions

- **Build County** is the primary SN deliverable. A network-only workflow is useful but
  is not the endpoint of this plan.
- One Generate action produces the complete county preview. The high-level workflow
  does not require accepting sites, then roads, then each settlement's frontage.
- One Bake action creates all accepted generated entities through one composite history
  command. One undo removes them all; one redo restores the same records and UUIDs.
- Preview generation never dirties the project or changes undo history.
- The implementation is TypeScript. The editor does not import, invoke, or ship the
  Python file.
- SA-2 is the authoritative terrain-site scorer. The orchestrator does not create a
  second settlement survey algorithm.
- SA-3 is the authoritative terrain-aware pathfinder and route validator. Batch
  planning reuses its cost model and worker protocol.
- SA-4 and the existing frontage geometry remain the authoritative building-spacing,
  facing, footprint-overlap, road-clash, world-bound, and slope foundations.
- **Create county backbone** is optional. It may default off in the specialist
  network-only tool, but defaults on in a new full Build County run when no eligible
  existing road network is selected.
- Survey rank controls deterministic default connection order. UUID is the final
  stable tie-breaker for manually selected existing places.
- Included required-stage failures make the full preview non-bakeable. The user can
  change settings, rerun, or deliberately exclude a failed site; partial output never
  masquerades as a successful county.
- Local streets operate inside actual place polygons. Road-width corridors respect
  polygon-edge clearance.
- Backbone, access, plot, terminal, loop, farm-yard, and property-access roles exist in
  the transient plan. They guide generation and diagnostics without requiring new
  persistent fields.
- Accepted objects are normal, unlocked current `PlaceRegion`, `Road`, and
  `PrefabInstance` records.
- No editable-project, runtime-v3, asset-catalogue, or viewer-bundle schema change is
  required for the initial implementation.

## 5. Inputs and initial defaults

### County composition

- desired settlement count `X`;
- settlement mix/profile using the compatible SA-2 town, village/hamlet, and farm
  candidates;
- explicit or automatic main-settlement choice;
- deterministic integer seed;
- existing authored entities treated as clash context; and
- generation policy: new surveyed county or build around selected existing places.

The automatic workflow ranks all successful survey candidates and takes the best `X`
that satisfy separation and requested mix constraints. The preview lists every chosen
and rejected site with its rank and reason. Manual SA-2 retains its candidate checklist;
Build County does not stop for a second checklist unless the user opens advanced site
selection.

Initial style defaults:

| Place type | Default style | Other initial choices |
| --- | --- | --- |
| Town | Planned | Organic |
| Village | Roadside | Planned, organic, agricultural |
| Farm | Agricultural | Roadside |

The hamlet-sized SA-2 profile continues to bake as the current `village` type. Its
hamlet policy and style remain transient generator choices.

### County roads

- use selected existing roads, create a new backbone, or both;
- backbone orientation: Auto, West-East, or North-South;
- backbone, access, local, terminal, farm-yard, and driveway class/surface/width;
- A* grid step, slope weight, maximum grade, turn penalty, and edge clearance;
- endpoint/junction snap tolerance; and
- per-route and whole-build node/time budgets.

Auto backbone orientation uses the world's longer axis and West-East for a square
world. Gate endpoints are inset from the world boundary by at least route clearance
plus half road width. Two A* legs meet at the exact main-settlement anchor.

### Building programme

The asset programme maps generator roles to catalogue assets or deterministic asset
pools:

- house (required);
- shop;
- civic;
- farmhouse;
- barn;
- shed; and
- warehouse.

The currently selected house asset initializes the required house mapping. Other roles
are optional and disabled until mapped. A mapped pool chooses variants by a named
deterministic seed stream. Catalogue proxy dimensions, not legacy random width/depth,
define physical footprints.

Initial frontage defaults inherit the validated SA-4 safety rules, while the
county-builder policy may set density and target counts by settlement type. Both road
sides are eligible by default for automatic county population. End clearance, junction
clearance, setback, gap, slope, overlap, road-clash, world-bound, and place-bound checks
remain configurable and explicit.

Driveways default enabled only when a valid segment can be created from the serving
road edge to the prefab footprint without a clash. They bake as ordinary narrow roads;
their property-access role and prefab association remain transient because the current
road schema has no driveway relationship field.

## 6. Transient orchestration contracts

The implementation should define serializable worker/request boundaries and pure plan
types without adding fields to project entities. Conceptually:

```text
CountyBuildRequest
  source_mode
  survey_settings or selected_places[]
  desired_site_count
  main_place_override
  county_road_settings
  local_style_settings[]
  frontage_settings
  building_asset_program
  seed
  source_revision_fingerprint
  working_terrain_snapshot
  clash_context

CountyBuildPlan
  places[]
  backbone_routes[]
  access_routes[]
  local_roads[]
  driveway_routes[]
  junctions[]
  prefabs[]
  site_results[]
  settlement_results[]
  diagnostics[]
  metrics
  completeness
```

Every planned object has a deterministic plan-local ID. Relationships such as owning
settlement, serving road, road role, plot eligibility, junction membership, and
driveway ownership use those plan IDs during preview. Bake resolves the complete graph
to new UUIDs before one mixed-entity add command is submitted.

The request fingerprint covers terrain identity/revision, relevant project entities,
asset catalogue and proxy dimensions, selected asset IDs, and all generation settings.
Changing any of them invalidates the preview.

## 7. Orchestration algorithm

### 7.1 Survey and choose sites

1. Run SA-2 against the captured working terrain or consume explicitly selected
   existing place polygons.
2. Filter invalid candidates and preserve the authoritative deterministic ranking.
3. Choose the best `X` candidates that satisfy separation and requested settlement
   mix.
4. Default the main settlement to the highest-ranked chosen town, otherwise the
   highest-ranked chosen site.
5. Create transient place polygons and names; do not bake them yet.
6. Record unselected and rejected candidates in the complete build report.

### 7.2 Derive settlement anchors and frames

For each place polygon:

1. Compute a stable centroid.
2. If it lies outside a concave polygon, find a deterministic interior anchor using a
   bounded grid/refinement search that maximizes distance from the edge.
3. Once an access road exists, sample its tangent at the anchor.
4. Define local `u` along the tangent and `v` perpendicular to it.
5. Project the polygon into that frame and derive usable positive/negative extents.

These values remain transient; baked place records are unchanged.

### 7.3 Seed the county road network

If **Create county backbone** is enabled:

1. Resolve the deterministic gate axis and inset endpoints.
2. Route gate A to the main anchor and the main anchor to gate B through SA-3.
3. Require both legs to succeed and pass post-route validation.
4. Merge them at their exact shared anchor and add the backbone to the transient
   growing network.
5. Mark the portion serving the main settlement as plot-eligible.

If existing roads are selected, add valid selected roads to the unchanged network seed.
Existing roads remain clash and junction context but are never duplicated in the bake.
If neither a usable existing seed nor a successful backbone exists, the county plan is
incomplete and cannot be baked.

### 7.4 Connect settlements incrementally

For each unserved settlement in deterministic order:

1. Treat an eligible road intersecting the place polygon as an existing access road.
2. Otherwise find the nearest valid segment projection on the existing plus already
   planned growing network.
3. Route from the exact connection point to the settlement anchor through SA-3.
4. Revalidate grade, world bounds, length, corridor safety, and finite geometry.
5. Snap the first and last points exactly to their intended connection points.
6. Add a successful access route to the growing network before planning the next
   settlement.
7. Record the connection junction and all route metrics.

This preserves the important legacy property that later settlements can connect to
roads generated for earlier settlements.

### 7.5 Generate internal streets

Templates use normalized local `u/v` coordinates and scale to actual polygon extents:

- **Planned town:** through spine, cross street, inset loop, terminal branches, and a
  secondary cross-link.
- **Planned village:** approach continuation, perpendicular spine, and smaller loop.
- **Roadside:** approach/main-road frontage, continuation, and short terminal branches.
- **Organic:** perturbed continuation and asymmetric terminal branches.
- **Agricultural:** terminal approach and compact farm-yard loop.

For every template road:

1. Construct control points with a seed stream keyed by place plan ID, style, role,
   and branch index.
2. Clip the centreline to the place polygon inset by half road width plus edge
   clearance.
3. Retain the fragment connected to its required parent junction.
4. Snap intentional connections and crossings.
5. Smooth where configured, then repeat all validation.
6. Reject short, disconnected, overlapping, accidental-crossing, or excessive-grade
   geometry with an explicit reason.
7. Mark eligible access, through, plot, and loop ranges for frontage.

### 7.6 Resolve junctions

Generate transient junctions from intentional planned/planned and planned/existing
intersections. Merge points within tolerance and derive clearance from contributing
road widths/classes. Junctions influence frontage exclusion and preview diagnostics;
they are not separately serialized.

### 7.7 Compose frontage and buildings

For each successfully networked settlement:

1. Collect its plot-eligible road ranges using plan-local road IDs.
2. Generate candidates through the shared SA-4 arc-length, polygon, junction, terrain,
   and collision geometry.
3. Apply deterministic settlement target counts and role weights adapted from the
   legacy town/village/hamlet/farmstead policy.
4. Resolve each role through the explicit asset programme.
5. Use the chosen asset's proxy footprint for setback and collision checks.
6. Face the prefab toward its serving road using the editor's local `-Z` front/yaw
   convention.
7. Check the candidate against all existing context plus earlier accepted planned
   prefabs and roads.
8. Optionally create a valid short driveway from the serving road edge to the prefab.
9. Record omitted roles, insufficient lots, missing mappings, and every safety
   rejection in per-settlement diagnostics.

The required house role makes a useful county possible immediately with one selected
asset. Mixed commercial, civic, agricultural, and industrial character appears only
where the user has deliberately supplied compatible role assets.

### 7.8 Decide completeness

A plan is complete only if:

- the requested number of settlements was selected or the report explicitly marks a
  user-approved lower result;
- the network seed exists;
- every included settlement has a successful access strategy;
- every accepted road and prefab passes final validation;
- all required asset roles resolve; and
- no source revision changed during planning.

Low building fill counts and optional unmapped roles are warnings rather than fatal
errors. Missing the required house asset, a failed required route, stale source data,
or invalid geometry is fatal.

## 8. Worker, progress, and cancellation model

Build County must remain responsive across multiple site checks and A* routes.

- Extend the current generation/road-routing worker protocol with a county-build batch
  request instead of creating an unrelated worker stack.
- Transfer one copied `WorkingTerrain` snapshot for the full build.
- Use named deterministic seed streams so adding diagnostics or an optional building
  role cannot perturb unrelated road geometry.
- Report progress by survey, backbone, access route, local streets, junctions,
  frontage, validation, and preview assembly.
- Enforce per-route budgets and a whole-operation node/time budget.
- Carry the generation token through every progress/result message.
- Cancel when the user requests it or when source inputs become invalid.
- Ignore stale results after cancellation or a newer build request.
- Return partial diagnostics for inspection, but never label partial geometry as a
  complete bakeable county.

Long pure geometry stages may remain on the main thread only if measured upper bounds
show they stay within the UI responsiveness budget; otherwise they join the worker
batch.

## 9. UI and complete preview

Add a clearly labelled **Build County** section to the settlement-generation area.

The compact/default controls expose:

- number of settlements;
- seed;
- main settlement: Auto or explicit after candidate generation;
- use existing roads and/or **Create county backbone**;
- required house asset;
- **Generate County Preview**, **Cancel**, **Bake County**, and **Clear Preview**; and
- progress, completeness, totals, warnings, and failures.

Advanced controls expose site mix, per-settlement style, road settings, routing costs,
asset-role pools, frontage density/safety, driveways, budgets, and selected existing
context.

Preview requirements:

- proposed place boundaries, backbone, access roads, local road roles, driveways,
  junctions, accepted prefabs, skipped candidates, and failures are distinguishable;
- the preview can be filtered by settlement and output class without rerunning;
- one batched Three.js object is used per preview class/role rather than per entity;
- replacing or clearing the preview disposes every old buffer/material owned by it;
- diagnostics state whether a problem is fatal or advisory; and
- generation never changes project dirty state or undo history.

The existing SA-2, SA-3, SA-4, and ordinary authoring controls remain accessible. The
new panel orchestrates them; it does not hide or rename them into implementation
details the user can no longer reach.

## 10. Atomic bake and history

On **Bake County**:

1. Require a complete plan and recheck its source fingerprint.
2. Allocate UUIDs for all new places, roads, and prefabs in deterministic plan order.
3. Resolve plan-local relationships to final UUIDs, including every prefab's
   `frontage_road_id`.
4. Convert accepted plans to ordinary current `PlaceRegion`, `Road`, and
   `PrefabInstance` records.
5. Apply current type/class/surface/width/visibility/unlocked fields and disabled
   prefab terrain pads.
6. Submit all mixed entities through one composite history command.
7. Clear the transient preview only after the command succeeds.

The bake is all-or-nothing. No site, road, driveway, or building is left behind if
conversion or command submission fails. One undo removes the generated county and one
redo restores the identical records and relationships.

Save/reopen and runtime scenery v3/viewer-bundle export require no special generator
loader. The procedural recipe, roles, seed, and diagnostics are not persisted in the
initial version; only the baked entities are part of the project.

## 11. Specialist network workflow

The previous narrower workflow remains useful as an advanced mode:

1. Select existing place regions.
2. Select an existing network or request a backbone.
3. Preview access and internal streets.
4. Bake only those roads as one undoable action.
5. Optionally open the existing SA-4 frontage tool for manual population.

This mode reuses the SN planners but does not define the high-level milestone outcome.
Its separate road-only acceptance is intentional and does not weaken the Build County
all-in-one bake contract.

## 12. Milestone dependency order

```text
Completed SA-2 survey ----+
Completed SA-3 A* --------+-> SN-0 Fidelity contract and county plan model
Completed SA-4 frontage --+      -> SN-1 Polygon frames and local streets
                                      -> SN-2 Backbone and multi-settlement network
                                           -> SN-3 County frontage/building composition
                                                -> SN-4 Build County orchestration,
                                                     preview, and atomic bake
                                                          -> SA-5 Performance,
                                                               compatibility, and docs
```

## SN-0 - Fidelity contract and county plan model

### Goal

Convert the relevant `world_builder.py` settlement chain into repository-owned,
deterministic policy fixtures and define the complete transient county plan.

### Work

- Record reference fixtures for site order, main-settlement choice, growing-network
  order, backbone gates, local templates, building-role weights, target counts,
  frontage ordering, and driveway geometry.
- Document deliberate translations from circles/random dimensions to place polygons
  and catalogue footprints.
- Define `CountyBuildRequest`, `CountyBuildPlan`, plan-local IDs, relationships,
  completeness, diagnostics, metrics, and source fingerprints.
- Define named seed streams and fatal-versus-advisory failure policy.
- Freeze role-to-current-entity defaults without adding persistent schema fields.

### Acceptance criteria

- Fixtures live under `tests/fixtures/settlement-network` and require no Downloads file
  at test time.
- Reference tests prove stable ordering and explicitly document every deliberate legacy
  difference.
- A complete transient plan can represent places, roads, junctions, prefabs, and
  driveways without allocating project UUIDs or mutating the store.
- No application behavior or schema changes occur.

## SN-1 - Polygon frames and internal-street foundations

### Goal

Implement the pure polygon geometry and deterministic local street planners shared by
manual network generation and Build County.

### Work

- Stable interior anchors for convex and concave place polygons.
- Access-tangent local frames and polygon extent projection.
- Road-width-aware polygon inset/clipping and connected-fragment retention.
- Planned, organic, roadside, and agricultural normalized templates.
- Endpoint snapping, junction merging, intentional-intersection, crossing, overlap,
  minimum-length, and grade checks.
- Deterministic role assignment and plot-eligible range output.

### Acceptance criteria

- Pure TypeScript tests cover concavity, narrow necks, rotated frames, clipping,
  snapping, loops, crossings, small polygons, and degenerate geometry.
- Every emitted local street is connected as intended, within its usable polygon
  corridor, finite, and deterministically ordered.
- Small/awkward settlements degrade by reported branch rejection, never by emitting
  invalid roads.
- Existing manual roads, SA-3, and SA-4 remain unchanged.

## SN-2 - Backbone and multi-settlement network

### Goal

Connect all included settlements to an existing or automatically created growing
county network in one cancellable planning batch.

### Work

- Consume transient surveyed places or ordered existing places.
- Implement main-settlement choice and optional backbone orientation/gates.
- Extend the SA-3 worker protocol for deterministic multi-route requests.
- Find nearest valid connection points on existing and earlier planned roads.
- Add successful access routes to the growing network before routing later sites.
- Run SN-1 local streets after each successful access strategy.
- Aggregate progress, route/node budgets, junctions, failures, and metrics.

### Acceptance criteria

- Backbone mode produces one validated primary road through the main settlement.
- Existing-network mode never modifies or duplicates its seed roads.
- Later settlements can join earlier planned access roads.
- Same terrain/sites/settings/seed produce identical plan geometry and order.
- A failed A* leg is explicit; no straight fallback appears.
- Cancellation and stale-result suppression cover the entire batch.
- The network-only specialist workflow can preview and bake its roads independently.

## SN-3 - County frontage and building composition

### Goal

Populate every successfully networked settlement inside the transient county plan,
using current frontage safety and explicit asset-role mappings.

### Work

- Generalize SA-4 invocation to plan-local roads and places that are not yet in the
  editor store.
- Apply deterministic target counts and building-role weights by settlement type,
  style, road role, and centrality.
- Resolve required house and optional role asset pools through the catalogue.
- Use real proxy footprints for spacing, setbacks, facing, slope, and collision.
- Validate candidates against existing and all earlier planned roads/prefabs.
- Generate optional driveway plans and comprehensive skip/fill diagnostics.

### Acceptance criteria

- A county can be fully populated with only a mapped house asset.
- Optional role assets produce deterministic mixed programmes without changing road or
  site geometry.
- Every planned prefab is in-world, in-place, below the slope limit, clear of roads,
  junctions, existing/planned prefabs, and faces its serving road.
- Every planned prefab resolves a plan-local serving road that can become
  `frontage_road_id` during bake.
- Missing optional mappings and low fill are warnings; missing required mapping is a
  non-mutating fatal error.
- Driveways are valid ordinary-road geometry or are individually skipped and reported.

## SN-4 - Build County orchestration, preview, and atomic bake

### Goal

Deliver the nearly one-click editor recreation of the legacy settlement-building
chain while preserving all manual tools.

### Work

- Add compact and advanced Build County controls.
- Orchestrate SA-2 -> SN-2 -> SN-3 from one request and immutable source snapshot.
- Report stage/settlement progress and support prompt cancellation.
- Render a bounded, filterable, complete county preview.
- Validate source fingerprints and plan completeness.
- Bake mixed places, roads, driveways, and prefabs through one composite command.
- Keep SA-2, SA-3, SA-4, network-only, and ordinary editing workflows available.

### Acceptance criteria

- **Generate County Preview** runs the full chain without intermediate acceptance or
  project mutation.
- **Bake County** is enabled only for a complete, current plan.
- One undo/redo removes/restores the entire generated county with stable UUID
  relationships.
- Accepted output consists only of valid current editor entities and survives
  save/reopen and runtime-v3/viewer-bundle export without special loading behavior.
- Same inputs and seed produce equivalent preview geometry, entity ordering, warnings,
  and bake relationships.
- A production-browser flow generates several settlements, backbone/access/local roads,
  junction-aware frontage, buildings and driveways; bakes once; edits generated
  entities; saves/reopens; exports; and verifies undo/redo.
- Existing manual settlement, road, routing, and frontage browser flows still pass.

## 13. SA-5 handoff

After SN-4, the high-level user workflow already exists:

```text
configure -> Generate County Preview -> inspect -> Bake County -> edit/export
```

SA-5 therefore concentrates on production hardening rather than inventing another
orchestrator. It benchmarks representative county sizes, verifies persistence/export
compatibility, improves diagnostics and documentation, and proves that manual and
automatic workflows share the same engines.

## 14. Performance safeguards

- Explicit candidate, site, route, node, local-branch, frontage, prefab, driveway, and
  whole-operation budgets.
- One transferred working-terrain snapshot per county plan.
- Worker execution for A* batches and any measured long-running survey/composition
  stages.
- Batched preview geometry with Object3D count independent of entity count within each
  preview role.
- Spatial indexes for road/prefab collision queries; no quadratic county-wide scan in
  the hot frontage loop.
- Named seed streams keep unrelated output stable when optional roles are toggled.
- Deterministic cache keys may reuse unchanged route results, but never bypass source
  fingerprint validation.
- Benchmarks report survey attempts, sites, routes, A* nodes/time, local streets,
  junctions, frontage candidates, accepted/skipped prefabs, driveways, preview
  Object3Ds, bake/undo time, and serialized size.

## 15. Whole-plan definition of done

Settlement network and county orchestration are complete when:

- SN-0 through SN-4 acceptance criteria pass;
- one action generates a complete, non-mutating county preview from current terrain;
- the preview covers chosen settlements, optional backbone, growing access network,
  internal streets, junctions, frontage, buildings, and optional property access;
- one Bake County action creates the complete result as ordinary editable entities;
- one undo/redo removes/restores that entire bake atomically;
- all output and diagnostics are deterministic for the same source/settings/seed;
- failures, omissions, low fill, and partial results are explicit;
- manual SA-2 survey, SA-3 road routing, SA-4 frontage, network-only planning, and
  ordinary editing all remain available;
- save/reopen, runtime-v3 export, and viewer bundle remain schema-compatible;
- the browser editor has no Python or network dependency; and
- SA-5 can harden and benchmark the feature without creating a second orchestration or
  generation implementation.
