# Settlement automation milestone plan

Status: SA-0 through SA-4 implemented; SA-5 remains planned.

This document defines the staged integration of terrain-based settlement surveying,
A* road routing, and settlement-scale automatic frontage into the browser-based
Polygon County Scenery Editor. Its milestone IDs use the `SA-` prefix so they cannot
be confused with the completed Three.js rewrite Milestones 0–5.

The algorithmic reference is the user's earlier
`polygon_county_streaming_runtime_v0.5/tools/world_builder.py`, especially:

- `generate_settlements()` and `slope()` for candidate survey and ranking;
- `_route_astar()` and `_smooth_polyline()` for terrain-aware road routing;
- `_generate_local_network()` for later street-pattern ideas; and
- `_plot_candidates()`, `generate_buildings()`, and
  `_generate_roadside_properties()` for settlement frontage policy.

The Python file is reference source material, not a runtime dependency or an
instruction to retain its old world format. The implementation target is native
TypeScript using the editor's existing terrain, entities, preview rendering, history,
persistence, and runtime-export contracts.

## 1. Intended outcome

After the complete plan, an editor user can:

1. survey the imported working terrain for ranked settlement sites;
2. accept selected sites as ordinary editable place polygons;
3. route terrain-aware roads between chosen points or into an existing road network;
4. populate roads inside a selected settlement with baked prefab instances; and
5. save, reopen, edit, undo, and export every accepted result through the existing
   project and runtime formats.

All generated results are baked. There are no live procedural relationships: changing
a settlement polygon or road later does not automatically reroute roads or reposition
prefabs.

## 2. Fixed design decisions

- The old algorithms are ported to TypeScript; Python, Pyodide, subprocesses, and
  server-side generation are not introduced into the web editor.
- `WorkingTerrain` is authoritative for height and slope decisions, including the
  effect of currently enabled prefab terrain pads.
- Generation is preview-first. Computing or changing a preview must not mutate the
  project.
- Each acceptance action is one undoable command. Bulk acceptance uses the existing
  bulk entity command rather than recording one command per generated object.
- Accepted sites are normal `PlaceRegion` entities, accepted routes are normal `Road`
  entities, and accepted buildings are normal `PrefabInstance` entities.
- Generated entity IDs are UUIDs produced by the editor. Legacy identifiers such as
  `road-primary-000` are not copied.
- The current coordinate convention remains +X east, +Z south, and +Y up.
- Prefab yaw remains degrees clockwise from world north with local -Z forward. Legacy
  frontage rotations are radians and assume local +Z forward, so they are not copied.
- The current frontage engine's arc-length sampling, catalogue proxy dimensions,
  oriented footprint overlap, road clash checks, world checks, preview, and bulk undo
  remain the geometric foundation.
- The initial implementation requires no editable-project or runtime schema upgrade.
- Deterministic seeds are tool inputs. Because results are baked, seed and generator
  settings are not persisted as live relationships in the initial implementation.
- Failure is explicit. The editor must not silently substitute a straight road or an
  invalid settlement position when no valid result exists.

## 3. Legacy-to-editor adaptation map

| Legacy behavior | Reuse | Required editor adaptation |
| --- | --- | --- |
| Sample hundreds of candidate settlement centres | Preserve | Use actual working terrain, user-selected profiles, ranked previews, and no synthetic fallback |
| Slope, edge, elevation, and separation scoring | Preserve concept | Normalize against arbitrary world dimensions and use the editor's lowland/elevation metadata |
| Fixed settlement kinds, counts, radii, and names | Do not copy as global policy | User selects type/count/profile; accepted records use normal editor names and UUIDs |
| Fixed 100 m eight-neighbour A* grid | Preserve search structure | Make resolution terrain-aware and configurable, bound node count, and run in a worker |
| Squared gradient route penalty | Preserve | Sample `WorkingTerrain.heightAt()` and report grade/slope statistics |
| Procedural-noise route wiggle | Replace | Use deterministic tie-breaking and a small turn/curvature cost |
| Straight-line fallback when A* fails | Remove | Report no route and keep the project unchanged |
| Two-pass Chaikin smoothing | Adapt | Simplify/smooth, then revalidate slope, bounds, and exclusions before preview |
| Plot candidates sampled along road arc length | Preserve concept | Generalize the existing frontage planner over multiple eligible road ranges |
| Circular building collision approximation | Replace | Keep the editor's oriented catalogue-derived footprint tests |
| Random building dimensions and variants | Replace initially | Repeat the selected catalogue house asset; asset pools are a later extension |
| Junction and slope clearance | Add to current frontage | Compute junctions transiently and validate plot slope using working terrain |
| Driveway records and settlement/road roles | Defer | Ordinary lane roads are possible, but persistent driveway/role relationships require a separate decision |

## 4. Data-contract boundary

The core plan fits current records:

| Generated concept | Existing record | Key mapping |
| --- | --- | --- |
| Accepted settlement site | `PlaceRegion` | Requested type plus a generated boundary polygon |
| Accepted terrain route | `Road` | User-selected width, class, surface, and routed X/Z points |
| Accepted frontage building | `PrefabInstance` | Selected asset, baked transform, disabled terrain pad, and `frontage_road_id` |

The first version does not persist settlement centre, radius, style, generator seed,
road role, settlement membership, plot side, or driveway ID. A future schema revision
is justified only if regeneration or those semantic relationships become requirements.

Current place types map as follows:

- legacy town → `town`;
- legacy village → `village`;
- hamlet-sized survey profile → `village` in the initial version; and
- legacy farmstead → `farm`.

Adding a first-class `hamlet` type is deliberately deferred because it would change
the editable and runtime contracts.

## 5. Milestone dependency order

```text
SA-0 Reference baseline
  └─ SA-1 Shared generation foundations
       ├─ SA-2 Settlement survey
       └─ SA-3 A* road routing
            └─ SA-4 Settlement frontage population
                 └─ SA-5 Integrated workflow and hardening
```

SA-2 and SA-3 may be developed independently after SA-1, but SA-4 assumes reusable
road geometry from SA-1 and route/road-selection behavior established by SA-3.

## SA-0 — Reference baseline and contract freeze

Implementation record: the repository-owned fixtures and numerical/contract notes are
in [`tests/fixtures/settlement-automation`](../tests/fixtures/settlement-automation/README.md),
with executable consistency checks in
[`tests/settlementAutomation/referenceBaseline.test.ts`](../tests/settlementAutomation/referenceBaseline.test.ts).

### Goal

Convert the useful legacy behavior into stable, repository-owned specifications and
fixtures before porting algorithms.

### Work

- Record small deterministic legacy examples for:
  - candidate-site scoring and rejection;
  - an A* route over a known height grid; and
  - frontage candidate spacing, sides, and slope/junction rejection.
- Document numerical differences:
  - legacy `slope()` returns a rise/run ratio sampled across an axis-aligned span;
  - editor `slopeAt()` returns degrees for the active terrain triangle;
  - legacy height sampling is bilinear;
  - editor height sampling follows the NW–SE terrain triangle diagonal.
- Capture qualitative compatibility rather than requiring byte-identical legacy world
  output. The target editor has different terrain interpolation, IDs, yaw, records, and
  asset dimensions.
- Confirm that the existing project, runtime-v3, vegetation-v1, asset-catalog-v3, and
  viewer-bundle contracts remain unchanged.

### Acceptance criteria

- Golden fixtures are small, deterministic, checked into `tests/fixtures`, and do not
  depend on the Downloads directory at test time.
- The expected formulas, coordinate conventions, and deliberate differences are
  described beside the fixtures.
- Existing verification remains green: 115 Vitest tests, 6 Playwright flows, the
  production build, lint, typecheck, and 45 preserved Python-reference tests.
- No application behavior or schema changes in this milestone.

## SA-1 — Shared deterministic generation foundations

Implementation record: the pure TypeScript foundations are in [`src/generation`](../src/generation),
with deterministic coverage in [`tests/generation`](../tests/generation). The existing
frontage assistant now consumes the shared polyline and collision geometry without a
public API or behavior change.

### Goal

Create pure, tested primitives shared by survey, routing, and frontage without adding
user-visible generation yet.

### Work

- Add a small deterministic seeded random-number utility. It must not depend on
  JavaScript engine object iteration order.
- Add a binary min-priority queue suitable for A*.
- Extract reusable road/polyline functions from the current frontage module where
  appropriate:
  - cumulative length and segment metrics;
  - sampling by arc length;
  - smoothed tangents;
  - closest point and distance on a polyline;
  - range clipping and point/segment operations.
- Add reusable polygon containment/intersection helpers needed to decide which road
  ranges lie within a place region.
- Define serializable request/result types for long-running generators. Results carry
  diagnostics and skip/rejection reasons, not only accepted geometry.
- Add a generation-operation token so stale or cancelled worker results cannot replace
  a newer preview.

### Acceptance criteria

- All new algorithms are pure TypeScript with deterministic unit tests.
- Existing frontage behavior and its current tests are unchanged.
- Shared functions reject non-finite values, degenerate geometry, and out-of-world
  inputs clearly.
- No project mutation, UI, worker, or schema change occurs in this milestone.

## SA-2 — Terrain settlement survey

Implementation record: the deterministic survey, profiles, grade/degree conversions,
site evaluation, ranking, diagnostics, and 32-point boundaries are in
[`src/generation/settlementSurvey.ts`](../src/generation/settlementSurvey.ts). The
transient panel state and one-command acceptance live in
[`src/app/EditorApp.ts`](../src/app/EditorApp.ts), while the preview is rendered as
three batched draw objects by
[`src/rendering/SettlementSurveyRenderAdapter.ts`](../src/rendering/SettlementSurveyRenderAdapter.ts).
Unit/integration coverage is in
[`tests/generation/settlementSurvey.test.ts`](../tests/generation/settlementSurvey.test.ts)
and the production-browser workflow is in
[`tests/browser/settlement-survey.spec.ts`](../tests/browser/settlement-survey.spec.ts).

### Goal

Rank viable settlement locations over the current working terrain and bake user-chosen
sites as editable place polygons.

### Initial profiles

The legacy defaults become editable starting profiles rather than fixed world policy:

| Profile | Initial radius | Legacy maximum grade | Approximate degrees | Baked place type |
| --- | ---: | ---: | ---: | --- |
| Town | 470 m | 0.11 | 6.3° | `town` |
| Village | 300 m | 0.14 | 8.0° | `village` |
| Hamlet-sized | 190 m | 0.18 | 10.2° | `village` |
| Farm | 125 m | 0.22 | 12.4° | `farm` |

### Survey inputs

- profile/place type;
- desired candidate count;
- radius;
- maximum slope in degrees;
- minimum separation from existing and previewed settlements;
- world-edge clearance;
- optional preferred elevation, initially derived from the terrain's lowland reference;
- deterministic integer seed; and
- candidate-attempt budget.

### Algorithm

- Sample candidate centres inside radius-aware world bounds.
- Evaluate the centre and a deterministic set of samples across the proposed site,
  rather than trusting only the centre slope.
- Hard-reject candidates that exceed slope, edge, separation, or existing-place
  constraints.
- Rank valid candidates by normalized terrain roughness, edge preference, elevation
  preference, and deterministic tie-breaking.
- Do not silently produce fallback sites when the attempt budget finds no valid result.
- Represent previews separately from `ProjectModel`.
- Bake an accepted site as a regular polygon with enough vertices for a useful editable
  boundary; 32 points is the initial target.

### UI and preview

- Add a **Settlement survey** tool/panel with inputs and a **Run survey** action.
- Show ranked translucent candidate regions with rank, slope, elevation, and score.
- Permit selecting one or more preview candidates.
- **Accept selected** creates normal unlocked place regions as one bulk undo action.
- Editing any survey input invalidates the old preview.

### Acceptance criteria

- The same terrain, entities, settings, and seed produce the same ranked candidates.
- Candidate polygons stay inside world bounds and respect configured separation.
- The preview does not dirty or mutate the project.
- Accepted regions validate, save, reopen, and undo/redo through existing code.
- No-valid-site and exhausted-attempt cases are visible and non-destructive.
- Unit tests cover profiles, conversions between grade and degrees, ranking,
  separation, boundary rejection, determinism, and failure.
- A Playwright flow surveys terrain, accepts a site, undoes it, and restores it.

## SA-3 — A* terrain-aware road routing

Implementation record: the deterministic eight-neighbour A* search, terrain snapshot,
node budgets, post-processing, revalidation, and diagnostics are in
[`src/generation/roadRouting.ts`](../src/generation/roadRouting.ts). Module-worker
ownership, transferred elevation buffers, cancellation, and stale-result suppression
are in
[`src/generation/RoadRoutingWorkerClient.ts`](../src/generation/RoadRoutingWorkerClient.ts)
and [`src/workers/roadRoutingWorker.ts`](../src/workers/roadRoutingWorker.ts). The
two-click tool, visible-road endpoint snapping, settings, diagnostics, and one-command
acceptance live in [`src/app/EditorApp.ts`](../src/app/EditorApp.ts); the transient
width/centreline/endpoint preview is batched by
[`src/rendering/RoadRouteRenderAdapter.ts`](../src/rendering/RoadRouteRenderAdapter.ts).
Algorithm and worker-lifecycle tests are in
[`tests/generation/roadRouting.test.ts`](../tests/generation/roadRouting.test.ts) and
[`tests/generation/RoadRoutingWorkerClient.test.ts`](../tests/generation/RoadRoutingWorkerClient.test.ts),
with the responsive production-browser persistence/export flow in
[`tests/browser/road-routing.spec.ts`](../tests/browser/road-routing.spec.ts).

### Goal

Provide a two-point road-routing tool that previews an editable road chosen by terrain
cost rather than a straight chord.

### Route inputs

- start and end world points, with optional snapping to an existing visible road;
- road class, surface, and width;
- routing grid step;
- slope penalty;
- maximum traversable grade;
- turn/curvature penalty;
- world-edge clearance; and
- deterministic integer seed for tie-breaking only.

### Algorithm

- Use eight-neighbour A* with Euclidean distance as the admissible base heuristic.
- Sample elevation from a snapshot of `WorkingTerrain`.
- Initial routing step is `max(50 m, terrain spacing)`. The UI may permit a smaller
  value, but the implementation must enforce a safe node-count budget.
- Preserve the useful legacy movement model:

  ```text
  grade = abs(next_height - current_height) / movement_distance
  cost  = movement_distance × (1 + slope_weight × grade²) + turn_cost
  ```

- Treat the configured maximum grade as impassable rather than merely expensive.
- Run the search in a Vite module Web Worker using a copied/transferred terrain
  snapshot so camera and editing interaction remain responsive.
- Support cancellation and ignore stale worker results.
- Simplify and smooth the grid path, preserve exact requested endpoints, then
  revalidate the final polyline against bounds, slope, and any active exclusions.
- Return route diagnostics: visited nodes, path length, maximum grade, mean grade,
  cost, elapsed time, and explicit failure reason.

### UI and preview

- Add a toggleable **Route road** tool.
- The first click chooses the start and the second click chooses the destination.
- Display the proposed road with success/failure diagnostics before mutation.
- **Accept route** creates one ordinary road and one undo entry.
- Escape/cancel and any changed endpoint/settings invalidate the preview.

### Acceptance criteria

- Flat terrain chooses a near-direct deterministic route.
- A steep barrier causes a detour when a valid passage exists.
- An impassable search reports failure without inserting a straight fallback.
- Start/end snapping and output points remain within world bounds.
- The accepted entity uses UUID identity and current road classes/surfaces.
- Accepted roads save, reopen, export through runtime v3, and undo/redo normally.
- Worker cancellation and stale-result suppression are tested.
- A browser test confirms that the UI remains usable during a representative route.

## SA-4 — Settlement-scale automatic frontage

Implementation record: deterministic polygon clipping, multi-road range planning,
transient junction detection, seeded post-spacing jitter, centre/corner slope checks,
and staged collision/skip accounting are in
[`src/generation/settlementFrontage.ts`](../src/generation/settlementFrontage.ts). The
selected-place road list, shared frontage inputs, preview invalidation, diagnostics,
and one-command prefab generation live in
[`src/app/EditorApp.ts`](../src/app/EditorApp.ts). Accepted/skipped footprints, clipped
road ranges, and junctions are drawn in four batched objects by
[`src/rendering/SettlementFrontageRenderAdapter.ts`](../src/rendering/SettlementFrontageRenderAdapter.ts).
Algorithm coverage is in
[`tests/generation/settlementFrontage.test.ts`](../tests/generation/settlementFrontage.test.ts),
with renderer disposal coverage in
[`tests/rendering/SettlementFrontageRenderAdapter.test.ts`](../tests/rendering/SettlementFrontageRenderAdapter.test.ts)
and the production-browser preview/generate/undo/save/reopen flow in
[`tests/browser/settlement-frontage.spec.ts`](../tests/browser/settlement-frontage.spec.ts).

### Goal

Populate eligible roads within one selected place region using the selected house asset
while retaining precise current frontage geometry and adding legacy settlement policy.

### Initial inputs

- selected place region;
- selected catalogue asset, initially required to have category `house`;
- eligible road selection, defaulting to visible roads intersecting the place polygon;
- existing Left/Right/Both, setback, gap, and end-clearance controls;
- maximum plot slope;
- junction clearance;
- optional spacing and yaw jitter; and
- deterministic integer seed.

### Algorithm

- Compute the portions of each eligible road lying inside the selected place polygon.
- Detect road intersections transiently and create junction-clearance zones; junction
  records are not persisted.
- Generalize the current frontage planner across all eligible road ranges.
- Use current catalogue proxy dimensions and local -Z yaw convention.
- Preserve exact oriented-footprint overlap and all-road clash checks.
- Add rejection reasons for:
  - outside settlement;
  - outside world;
  - prefab overlap;
  - road clash;
  - junction clearance; and
  - excessive plot slope.
- Check terrain at the candidate centre and footprint corners.
- Apply deterministic jitter only after base spacing is calculated, then rerun every
  safety check.
- Accepted houses receive the serving road UUID as `frontage_road_id`, scale 1, and a
  disabled terrain pad.
- Do not reposition houses after later road or settlement edits.

### UI and preview

- Add **Populate settlement** for a selected place region.
- Render accepted and skipped candidate footprints distinctly.
- Report accepted count and per-reason skip totals before generation.
- **Generate houses** bakes all accepted prefabs in one bulk undo action.

### Acceptance criteria

- Existing two-click frontage assist remains available and unchanged.
- Multi-road population is deterministic for the same state/settings/seed.
- Every generated prefab is inside the settlement and world, clear of junctions and
  roads, below the plot-slope limit, and non-overlapping.
- Every generated prefab has a resolving `frontage_road_id`.
- Missing house assets, no eligible roads, or zero accepted candidates are reported
  without mutation.
- One undo removes the complete generated frontage and one redo restores it.
- Unit tests cover polygon clipping, junctions, slope, deterministic jitter, multiple
  roads, collisions, and skip accounting.
- A Playwright flow previews, generates, saves/reopens, and undoes a populated
  settlement.

## SA-5 — Integrated workflow, performance, and documentation

### Goal

Make survey → road routing → frontage population a coherent production workflow and
prove that it remains compatible with editor persistence and viewer exports.

### Work

- Present the three tools in one clearly labelled settlement-generation area without
  hiding the existing manual authoring tools.
- Ensure tool switching cancels transient previews and workers safely.
- Add concise status, progress, cancellation, and failure reporting.
- Exercise an end-to-end workflow:
  1. survey and bake a settlement;
  2. route and bake its access road;
  3. populate eligible frontage;
  4. manually edit generated regions, road vertices, and prefabs;
  5. undo/redo each accepted generation step;
  6. save and reopen the project; and
  7. export runtime scenery v3 and the viewer ZIP bundle.
- Add a deterministic generation benchmark over a representative county terrain.
- Track candidate attempts, A* visited nodes, worker time, accepted/skipped frontage,
  preview Object3D count, and project serialization size.
- Document the tools, coordinate/slope conventions, baked behavior, and limitations.

### Performance safeguards

- Survey and routing operations have explicit attempt/node budgets.
- A* and any later large survey run off the UI thread.
- Preview rendering uses batched geometry rather than one Three.js object per candidate.
- Repeated previews dispose replaced GPU buffers and cancel stale work.
- Performance checks should guard bounded work and interaction responsiveness rather
  than rely only on fragile wall-clock thresholds.

### Acceptance criteria

- The complete end-to-end browser flow passes against the production build.
- Generated results survive save/reopen with no special loader behavior.
- Runtime v3 and viewer-bundle inner schemas remain unchanged and validate normally.
- The editor has no Python runtime or network dependency.
- All old and new lint, typecheck, unit, browser, build, and Python-reference checks
  pass.
- Benchmark results and known limitations are committed under `docs` or
  `benchmark-results` using the existing project convention.

## 6. Explicitly deferred work

These are not required to complete SA-0 through SA-5:

- first-class `hamlet` project/runtime type;
- persistent settlement centre, radius, style, seed, or generation recipe;
- live regeneration after terrain, road, settlement, or asset changes;
- exact reproduction of the legacy fixed world, names, residents, or billboards;
- automatic planned/organic/roadside/agricultural local street templates;
- mixed building asset pools, zoning, shops, civic buildings, sheds, barns, warehouses,
  floors, or variants;
- generated driveways or persistent driveway-to-building relationships;
- persistent road roles, settlement membership, junction records, or plot-side fields;
- bridges, tunnels, switchbacks, road grading/deformation, cut-and-fill, or retaining
  structures;
- water, woodland, protected-area, parcel, or vegetation-clearance routing costs;
- GPU A*; routing is a CPU graph-search task and belongs in a Web Worker;
- automatic terrain pads for generated frontage; and
- viewer-side procedural regeneration.

Any deferred item that requires new persistent semantics must begin with a separate
schema and migration proposal rather than silently overloading existing fields.

## 7. Whole-initiative definition of done

The settlement-automation initiative is complete when:

- SA-0 through SA-5 acceptance criteria pass;
- the workflow is deterministic, preview-first, cancellable, and non-destructive until
  accepted;
- accepted output consists exclusively of valid existing entities;
- each accepted generation action is independently undoable;
- generated objects remain ordinary manual-editing targets afterward;
- project and runtime schemas have not changed unless the user separately approves a
  documented schema proposal; and
- the implementation guide and tests are sufficient for a future developer to modify
  cost weights or generation policy without consulting the old Python runtime.
