# Polygon County Scenery Editor

This repository now contains two deliberately separate implementations:

- the preserved Python/Tkinter v0.2 prototype, which remains the behavioural and
  interchange-contract reference; and
- the browser-based Vite/TypeScript/Three.js editor, released as **version 1.0.0** with
  the completed Milestone 0–5 rewrite (application shell, terrain/native geometry,
  prefab/vegetation authoring, browser persistence and relinking, reference layers,
  versioned exports, and the full seeded performance benchmark), followed by a baked
  road-frontage house generator, deterministic terrain settlement survey, and
  worker-backed terrain-aware A* road routing, and deterministic settlement-wide
  multi-road frontage population.

See [README_THREEJS_REWRITE.md](README_THREEJS_REWRITE.md) for the web application,
its verified commands, architecture, browser file limitations, and milestone status.

## Run the web rewrite

```powershell
npm install
npm run dev
```

For the production build, run `npm run build` followed by `npm run preview` and open
the HTTP URL Vite prints. Do not open `dist/index.html` directly through `file://`;
browser JavaScript modules require an HTTP origin and the correct JavaScript MIME
type.

## Python/Tkinter reference v0.2

A standalone Python/Tkinter editor for composing engine-agnostic human scenery over
an existing Polygon County terrain. It loads the Terrain Editor's float32 NPY as an
immutable base, derives a separate in-memory working surface from per-object terrain
pads, and exports viewer-ready terrain and semantic scenery without overwriting any
source file. The complete preserved implementation, schemas, and compatibility tests
now live under [`python_reference/`](python_reference/README.md); the Three.js build
does not import or execute them.

## Run

Python 3.10 or newer is required.

```powershell
cd python_reference
python -m pip install -r requirements.txt
python main.py
# or: python -m scenery_editor
```

Choose **File → New Scenery Project**, then select the source float32 NPY and its
matching terrain descriptor. Load the viewer's authoritative
`public/assets/catalog.json`, or `examples/asset_catalog.json` to inspect the format.
The same minimal schema-v3 catalogue supplies `asset_id`, category, and resource to
both editor and viewer; it is not duplicated into runtime scenery.

## Authoring controls

- Mouse wheel zooms around the cursor; middle- or right-drag pans; `F` fits terrain.
- Drawing tools add world-space X/Z points. `Enter` or double-click finishes,
  `Backspace` removes the latest point, and `Escape` cancels.
- Select/Move exposes vertex handles. Drag a handle or whole object to edit it.
- `Ctrl`-click a selected road or hedgerow segment to insert a point.
- `Delete` deletes an object; `Shift+Delete` deletes a selected vertex where valid.
- `Q`/`E` rotate a selected prefab by 15 degrees.
- Native vegetation uses the same select/drag/delete/lock workflow. Choose a vegetation
  type and logical species/asset ID, then use **Place vegetation**; `Q`/`E` rotates it.
- A prefab's Properties panel controls terrain-pad enabled state, width, depth, and
  blend distance, or resets them to a disabled placement default.
- **Settlement survey** ranks deterministic town, village, hamlet-sized, or farm sites
  over the working terrain. Its previews are non-mutating; selected candidates bake as
  ordinary editable 32-point place regions in one undoable action.
- **Route road** snaps optional endpoints to visible native roads, searches a copied
  working-terrain snapshot in a module worker, and previews route diagnostics before
  baking one ordinary editable road in one undoable action.
- **Populate settlement** clips selected native roads to one selected place, previews
  safe and skipped house footprints with junction/slope/collision diagnostics, and
  bakes the accepted houses as ordinary editable prefabs in one undoable action.

Prefab yaw uses `rotation_deg == 0` facing world north (`-Z`), with positive rotation
clockwise from above. Terrain-pad width is local X and depth is local Z at zero yaw.

## Terrain-pad behavior

Each enabled, visible prefab can flatten a rotated rectangular site. Its target is the
immutable base-terrain height at the prefab origin. The core is flat and the outer
`blend_m` area uses a smooth transition into the current working surface. Pads compose
in stable project order; overlapping pads are therefore deterministic.

Pad participation is cell-aware. A 20 m × 20 m house on a 50 m terrain grid still
affects the intersected cell and does not produce a resolution warning. The imported
NPY remains read-only; undo/redo and edits rebuild a derived float32 copy.

Hidden prefabs and disabled pads do not modify working terrain. Terrain padding never
removes vegetation. The vegetation exporter preserves every imported placement and
only resamples its final `terrain_y_m`.

## Exports

- **Viewer bundle (.zip)** writes a versioned bundle manifest, runtime scenery v3,
  and—when loaded—the resampled vegetation v1 document and asset catalogue v3. The
  bundle preserves those independent schemas; it does not contain final terrain,
  editable project data, GLBs, textures, or other asset binaries.
- **Export Final Terrain PNG + Metadata** writes an unsigned 16-bit greyscale PNG and
  a same-stem JSON descriptor. The descriptor follows the Terrain Editor's current
  importer-facing heightmap metadata contract.
- **Export Resampled Vegetation** writes vegetation schema v1 with unchanged X/Z,
  type, species, rotation, scale, and region identity, plus fresh working-terrain Y.
- **Export Runtime Scenery v3** writes prefabs and native vegetation with logical
  `asset_id`, transform, visibility, asset status, and derived working-terrain Y. A
  separate legacy-v2 action requires explicit confirmation before omitting nonempty
  native vegetation. No catalogue path, GLB path, lock, pad, or renderer state is
  exported.

GLBs are expected to be authoring-correct: metres, Y up, local -Z forward, scale 1.0,
and a ground-ready pivot. Fix a nonconforming asset itself; neither editor nor viewer
stores yaw, pivot, or unit corrections.

The runtime JSON Y values come from the float32 working surface before PNG
quantization, so small centimetre-scale differences from heights decoded out of the
16-bit PNG are normal and bounded by that PNG's vertical quantization step.

## Architecture

`python_reference/scenery_editor/model` owns immutable authored records, terrain
queries, validation, and working-terrain composition. `project_io` owns strict imports,
migration, persistence, and final/runtime exports. `rendering` builds 2D terrain
previews. `app` owns Tk widgets and transient gestures. Models and I/O do not import
Tkinter.

See [docs/SCENERY_FORMATS.md](docs/SCENERY_FORMATS.md) for the v2 contracts and
[docs/RUNTIME_EXPORT_IMPORTER_GUIDE.md](docs/RUNTIME_EXPORT_IMPORTER_GUIDE.md) for the
self-contained viewer/importer guide.

## Tests

```powershell
cd python_reference
python -m pytest -q
```

## Deliberately deferred

Vegetation clearance/exclusion around objects, custom pad target elevations, terrain
brushes, road deformation, procedural settlement/farm/base generation, automatic
frontage population in the Tk prototype, generated crops/livestock, road or hedge
meshes, direct GLB/3D rendering, and engine-specific integration remain outside v0.2.
