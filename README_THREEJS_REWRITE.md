# Polygon County Scenery Editor — Three.js rewrite

This is the **1.0.0 release** of the genuine static browser rewrite, completed through
**Milestone 5**, the baked road-frontage house generator, and settlement-automation
milestone **SA-4**. The Python/Tkinter
application remains checked in under `python_reference/` as the behavioural and
data-contract reference.

## Run and verify

Node 20.19 or newer is required.

```text
npm install
npm run dev
npm test
npm run lint
npm run typecheck
npm run build
```

To open the production build locally, serve it over HTTP:

```text
npm run build
npm run preview
```

Then use the URL printed by Vite (normally `http://localhost:4173/`). Do **not**
double-click `dist/index.html`: browsers do not load JavaScript modules from a
`file://` page with the HTTP MIME and origin rules a web app requires. An error such
as “loading module disallowed due to a disallowed MIME type (`text/html`)” also means
the host returned its HTML fallback for a missing JavaScript asset. Rebuild and
publish the complete `dist/` directory rather than `index.html` by itself.

`npm run benchmark` first builds the production bundle, launches that bundle in a
1920×1080 Chromium page, runs the exact seeded Polygon County workload, prints the
measurements, and writes `benchmark-results/milestone-5-latest.json`. It never samples
or lowers the 32,498 native vegetation count. See
[`docs/MILESTONE_5_BENCHMARK.md`](docs/MILESTONE_5_BENCHMARK.md) for the recorded
environment, results, target misses, and bottleneck analysis.

The Vite production output in `dist/` is static. It needs no backend and makes no
network requests for terrain or project data. Its asset URLs are relative, so the
complete directory can be hosted either at a domain root or below a URL subpath.

## Implemented scope

Milestone 0 provides:

- a strict TypeScript/Vite/Three.js project without React;
- lint, typecheck, Vitest, production-build, and focused browser-test scripts;
- an editor-style semantic HTML/CSS layout and an invalidation-aware empty renderer;
- deliberately versioned copies of the current Python-era schemas in `src/schemas/`;
- checked JSON and NPY v1/v2/v3 terrain fixtures; and
- stable module boundaries between application state, domain contracts, I/O, terrain,
  rendering, interaction, and UI.

Milestone 1 provides:

- user-mediated new-project selection of one float32 NPY and its descriptor JSON;
- a non-evaluating NPY v1/v2/v3 parser for two-dimensional float32 data, including
  Fortran-to-row-major normalization and explicit unsupported-endian errors;
- strict terrain descriptor arithmetic and semantic validation;
- SHA-256 of the original NPY bytes and an immutable base-terrain API boundary;
- exact NW–SE triangle height/slope queries, including inclusive east/south edges;
- a Three.js terrain mesh with the same NW–SE topology;
- elevation colour, hillshade, and contour layer toggles;
- a north-up orthographic camera in metre coordinates (`+X` right, `+Z` down);
- cursor-anchored wheel zoom, middle/right drag pan, fit (`F` and button), resize
  preservation, and continuous X/Z/elevation/slope status; and
- basic in-memory project source hints and dirty state with `beforeunload` protection.

Milestone 2 provides:

- a normalized, insertion-ordered model store with O(1) entity lookup and UUID-backed
  authored records;
- strict v1/v2/v3/v4 scenery-project DTO validation and migration to the current v4
  in-memory contract, including the explicit native `vegetation_instances` field;
- delta-based add, update, remove, and composite commands with undo/redo and atomic
  road-frontage cleanup when a referenced road is deleted;
- place-region tools for town, village, farm, and military area;
- land-use tools for pasture, rough grazing, and explicitly exposed woodland;
- road and hedgerow polyline tools with world-metre widths;
- Enter/double-click completion, Backspace draft removal, Escape cancellation, and
  duplicate double-click-point prevention;
- layer-aware selection and picking, selected vertex handles, whole-object and vertex
  dragging constrained to the world, Ctrl-click segment insertion, and guarded vertex
  deletion;
- visibility and locking semantics plus typed property editing; and
- disposable Three.js projections that rebuild only changed model records and never
  become serialized truth.

Milestone 3 provides:

- strict asset-catalogue v3 JSON validation with exact keys, positive category proxy
  dimensions, logical resource IDs, and stable asset ordering/lookups;
- catalogue asset selection, footprint/front ghost placement, conspicuous missing-
  asset fallbacks, and stable per-record Three.js proxy projections;
- local `-Z` front, clockwise-positive yaw, `Q`/`E` rotation, scale-aware proxy
  footprints, world-clamped dragging, and locked-prefab spatial immutability;
- typed prefab asset/category/transform/frontage properties, including automatic
  adoption of a known asset's category and atomic frontage cleanup with road deletion;
- terrain-pad core/blend overlays, pad properties and reset, nine-point site sampling,
  and warnings for footprints extending outside the world;
- an immutable-base, derived float32 working terrain whose visible enabled pads compose
  in project order with rotated, cell-aware coverage and smoothstep blending;
- scale-independent pads, deterministic overlap ordering, base-height-at-origin pad
  targets, and exact Python-derived working-terrain golden coverage;
- targeted pad recomposition for relevant edits and pad-aware undo/redo, while ordinary
  selection, catalogue, frontage, scale, and geometry edits avoid terrain rebuilds; and
- independent prefab and terrain-pad layer controls with layer-aware picking and
  in-place terrain mesh/texture refresh that preserves the active view.

Milestone 4 provides:

- browser Open with strict v1–v4 project migration, companion-file matching, explicit
  relinks for moved or absolute source hints, required terrain compatibility checks,
  and changed/missing-source warnings;
- current-schema v4 Save/Save As through the File System Access API where available,
  with a portable JSON download fallback and no browser handle or Three.js state in
  project data;
- strict vegetation v1 and county-feature v3 reference imports with matching project
  identity checks, independent layer toggles, and GPU-friendly projections (one point
  batch for imported vegetation and merged dashed county geometry);
- explicit one-time county conversion into native villages, local roads, and prefabs,
  preserving source UUIDs/frontage where valid and recording the bulk change as one
  undoable command;
- conspicuous missing-source and unresolved-asset warnings that do not prevent a
  compatible project from opening;
- Python-compatible runtime scenery v2 and resampled imported-vegetation v1 exports,
  with working-terrain Y values and an explicit block against silently dropping any
  native v4 vegetation from the legacy runtime format; and
- a narrow, browser-native unsigned 16-bit single-channel PNG encoder plus the full
  unversioned heightmap metadata contract and explicit little-endian float32 working-
  terrain SHA-256.

Milestone 5 provides:

- explicit creation of native forest-tree, scattered-tree, and shrub records with
  UUID identity, logical asset/species IDs, visibility/lock state, derived terrain Y,
  property editing, select/drag/rotate/scale/delete, and a separate layer toggle;
- an explicit, one-transaction conversion of immutable vegetation-v1 references into
  native records, preserving source placement fields and deterministically skipping
  exact placement duplicates on repeat conversion;
- a dedicated vegetation render-data manager using 512 m spatial chunks and
  asset/type batches, stable ID↔slot maps, swap-remove, cross-chunk re-batching,
  per-slot dirty buffer ranges, spatially bounded CPU picking, and transient selection
  overlays—never one Three.js object per placement;
- all-native terrain-height refresh after a committed terrain-pad change while
  ordinary single-record edits leave the other vegetation slots untouched;
- strict runtime scenery v3 export with native vegetation and derived float32 working-
  terrain Y, while legacy v2 remains a separately labelled, explicitly lossy action;
- bulk delta history that holds the converted records rather than whole-project
  snapshots and removes/restores the collection in linear time; and
- a deterministic benchmark containing 309 roads, 279 prefabs, 4,870 trees, and
  27,628 shrubs, with production-browser measurements for construction, interactivity,
  frame times, draws/Object3Ds, dense/sparse picks, within/cross-chunk moves, terrain-Y
  refresh, serialization, and available memory/resource counters.

Imported vegetation remains immutable until the user deliberately converts it. A
woodland polygon remains a semantic region and is never interpreted as thousands of
tree records.

The post-milestone frontage assist adds a transient, GPU-batched preview over a
user-selected stretch of native road. It repeats the selected house asset on Left,
Right, or Both sides using road-edge setback, inter-house gap, and end-clearance
controls. Left/right follow first-click-to-second-click direction; candidates face the
road, follow polyline arc length, and are skipped when they overlap a prefab, clash
with a road, or leave the terrain world. Generation bakes ordinary editable prefab-v4
records with the road UUID, disabled terrain pads, and one bulk undo command. Later
road edits do not reposition them, and no project/runtime schema change is involved.

Settlement-automation SA-2 adds a deterministic **Settlement survey** panel over the
current working terrain. Town, village, hamlet-sized, and farm profiles seed editable
radius and slope settings. Each proposed site samples the centre plus two fixed rings,
hard-rejects excessive slope, world-edge, and existing-place conflicts, then ranks
terrain roughness, edge preference, and optional lowland-reference elevation. Ranked
regions remain transient and batched until selected candidates are accepted as normal
unlocked 32-point place polygons in one undoable command. Changing settings, working
terrain, or existing places invalidates the preview; no-result and exhausted-budget
outcomes are explicit and non-destructive. No project/runtime schema changed.

Settlement-automation SA-3 adds the toggleable **Route road** tool. The first click
sets a start and the second sets a destination; either can snap to an existing visible
native road. An eight-neighbour deterministic A* search runs in a Vite module Web
Worker against a copied and transferred `WorkingTerrain` snapshot, leaving camera and
editor interaction responsive. Grid size and visited-node budgets are explicit,
maximum grade is impassable, and slope plus curvature affect cost. The simplified,
smoothed result preserves its exact endpoints and is revalidated before a transient
width preview appears. Length, maximum/mean grade, cost, visited nodes, elapsed time,
and explicit failures are shown before mutation. Accepting creates one normal UUID
road with the chosen current class, surface, and width in one undoable command;
cancelled and stale worker results cannot apply. No project/runtime schema changed.

Settlement-automation SA-4 adds **Populate settlement** for one selected editable
place and house asset. Every native road/polygon intersection becomes an individually
selectable clipped range, with visible intersecting roads selected by default.
Deterministic base spacing is generalized across all enabled ranges before optional
seeded spacing/yaw jitter. The preview uses road control-point order for Left/Right,
detects transient multi-road junctions, samples terrain slope at each house centre and
footprint corners, and reports outside-settlement, outside-world, existing/generated
prefab overlap, all-road clash, junction-clearance, and excessive-slope skips.
Accepted and skipped footprints, clipped ranges, and junction points use four batched
Three.js draw objects. Previewing never mutates the project; changed selections,
settings, terrain, roads, prefabs, or asset data invalidate it. **Generate houses**
bakes every accepted candidate as an ordinary unlocked prefab with scale 1, its
serving road UUID, and a disabled terrain pad in one undoable command. Save/reopen and
redo use the existing project model with no project or runtime schema change, while
the original two-click frontage assistant remains available.

The viewer-bundle export packages runtime scenery v3 plus any currently loaded
resampled vegetation v1 and asset catalogue v3 into one compressed ZIP. A strict
manifest v1 identifies each inner file and records absent optional entries as `null`;
the inner schemas remain independent. Final terrain and actual asset resources remain
separate exports.

The implemented survey, A* road routing, and settlement-scale frontage are specified
as independently referable `SA-0` through `SA-4` milestones in
[`docs/SETTLEMENT_AUTOMATION_MILESTONE_PLAN.md`](docs/SETTLEMENT_AUTOMATION_MILESTONE_PLAN.md).
The county backbone, multi-settlement access network, polygon-aware local streets,
building programme, and high-level **Build County** orchestrator are implemented as `SN-0`
through `SN-4` in
[`docs/SETTLEMENT_NETWORK_AUTOMATION_PLAN.md`](docs/SETTLEMENT_NETWORK_AUTOMATION_PLAN.md),
after which SA-5 provides production hardening, performance checks, and documentation.

The current verification baseline is 170 Vitest tests, 10 Playwright browser flows,
and all 45 Python reference tests.

## Source-of-truth priority

When contracts disagree, use this order:

1. strict prototype tests and strict model/I/O code;
2. `docs/SCENERY_FORMATS.md` and `docs/RUNTIME_EXPORT_IMPORTER_GUIDE.md`;
3. checked schemas and tracked examples;
4. incidental Tk UI behaviour.

The untracked `examples/catalog.json` is intentionally preserved. The tracked
`examples/asset_catalog.json` and strict catalogue loader are authoritative.

## Browser file limitations

A static browser cannot reopen an arbitrary path stored in `sources.*`. Source strings
are portable name/path hints only; they are not file capabilities. New/Open and the
reference pickers obtain fresh `File` objects through explicit user selection. Simple
relative names can match companion files selected in the same open operation; absolute
legacy paths require an explicit relink and are never rebound by basename alone. The
project never serializes `File`, directory handles, Three.js objects, or browser-only
state.

Save uses `showSaveFilePicker` when the browser exposes it. The download fallback
cannot provide the Python writer's atomic replace guarantee, and a later Save may
therefore create another download instead of overwriting the previous file.

NPY data is read locally in memory. The imported typed array is copied behind the
`TerrainReference` API; callers can request a copy but cannot obtain the authoritative
buffer. The original file bytes—not a decoded array—define the base SHA-256.

## Architecture

```text
src/app/          composition, normalized project state, dirty state
src/model/        entities, strict DTO migration, validation, coordinate transforms
src/history/      delta-based commands and undo/redo
src/io/           browser persistence/relinks, narrow NPY parser, and strict exports
src/terrain/      immutable base, derived float32 working terrain, NW–SE queries
src/rendering/    Three.js controller, disposable projections, vegetation GPU batches
src/interaction/  navigation, layer-aware picking, and constrained geometry editing
src/benchmark/    exact-count deterministic Polygon County performance scene
src/ui/           semantic DOM layout
src/schemas/      explicitly versioned contract snapshots
tests/            unit, golden fixture, and focused browser coverage
python_reference/ preserved Tkinter prototype, schemas, and compatibility tests
```

The Three.js scene is a disposable projection of model data. Rendering uses one
invalidation-aware animation-frame scheduler, responds to `ResizeObserver`, and
disposes replaced geometry, textures, and materials.

## Coordinate and terrain decisions

- World origin is northwest/top-left; all values remain metres.
- Model `(x_m, terrain_y_m, z_m)` maps directly to Three `(x, y, z)`.
- The top-down camera looks along `-Y` and uses up `(0, 0, -1)`.
- Every cell uses vertex sets `NW–NE–SE` and `NW–SE–SW`; mesh winding is reordered
  to `NW–SE–NE` and `NW–SW–SE` so the front faces point `+Y`.
- Height and slope queries are triangle-consistent, never bilinear.
- Editable yaw is clockwise-positive from local front `-Z`; a Three.js object uses the
  negative yaw radians. The `0/90/180/270` mapping and front marker are covered.
