# Polygon County Scenery Editor

Polygon County Scenery Editor is a local, browser-based tool for authoring roads,
places, land use, buildings, and vegetation over an existing Polygon County terrain.
It uses TypeScript, Three.js, and WebGL to keep large scenery projects interactive and
exports engine-neutral files for a separate viewer or game runtime.

The primary application is the version 2.0.0 web editor. A preserved Python/Tkinter
prototype is included under `python_reference/` as a behavioural and file-format
reference; it is not required to run the web application.

## What the editor does

- Loads a float32 NPY terrain and its matching terrain descriptor without modifying
  the source files.
- Authors editable place and land-use polygons, roads, hedgerows, prefab instances,
  and manually placed native vegetation.
- Loads an asset catalogue and previews catalogue prefabs as GLB models when their
  resources are available.
- Imports large, non-editable vegetation-v1 placement datasets and resamples their
  runtime elevations against the working terrain.
- Applies optional, non-destructive terrain pads beneath prefabs.
- Provides undo/redo, object locking, visibility controls, project save/open, and
  browser file relinking.
- Generates deterministic settlement surveys, terrain-aware A* roads, road frontage,
  internal street networks, and complete multi-settlement county plans.
- Previews generated work before baking it as ordinary editable project records.
- Uses chunked and instanced GPU rendering for the full 32,498-record vegetation
  benchmark rather than creating one Three.js object per vegetation record.

The editor is an authoring application, not the final Polygon County viewer. Exported
runtime data describes what should exist and where; the consuming viewer remains
responsible for its own final road meshes, junction meshes, asset loading, materials,
lighting, collision, and gameplay behaviour.

## Inputs and outputs

### Typical inputs

- A source float32 `.npy` terrain heightfield.
- The matching terrain JSON descriptor.
- An optional asset catalogue v3.
- Optional imported vegetation placement data v1.
- Optional county-feature reference data.

The browser stores file handles only where the browser permits it. After reopening a
project, the editor may ask you to relink source files. Stored source paths are hints,
not permanent browser filesystem permissions.

### Main outputs

- Editable scenery project v4 JSON.
- Final terrain as a 16-bit greyscale PNG with matching metadata JSON.
- Runtime scenery v3 JSON.
- Resampled imported vegetation v1 JSON.
- A viewer bundle v2 ZIP containing its manifest, final heightmap and metadata,
  runtime scenery, and—when loaded—resampled vegetation and catalogue documents.

The viewer bundle deliberately does not embed GLB models, textures, source NPY data,
or other asset binaries. See
[the runtime export/importer guide](docs/RUNTIME_EXPORT_IMPORTER_GUIDE.md) for the
complete consumer contract.

Application version numbers and data-schema versions are independent. Version 2.0.0
of the editor currently saves project schema v4 and exports runtime scenery schema v3.

## Requirements

- Node.js 20.19 or newer.
- pnpm 11.19.0 is recommended for reproducible installation from the tracked lockfile.
- A current desktop browser with WebGL support.
- Git, if cloning instead of downloading a source archive.

The production application is static. It requires an HTTP server but no application
backend.

## Run on Windows

Open PowerShell:

```powershell
git clone https://github.com/countfuzzball/3JPCS.git
cd 3JPCS

corepack enable
corepack prepare pnpm@11.19.0 --activate
pnpm install --frozen-lockfile
pnpm dev
```

Open the local URL printed by Vite, normally
[http://localhost:5173](http://localhost:5173).

If `corepack` is unavailable, install the same pnpm version with npm:

```powershell
npm install --global pnpm@11.19.0
```

If PowerShell reports that `node`, `npm`, or `corepack` is not recognized after
installing Node.js, close and reopen the terminal so that it receives the updated
`PATH`.

## Run on Linux

Open a terminal:

```bash
git clone https://github.com/countfuzzball/3JPCS.git
cd 3JPCS

corepack enable
corepack prepare pnpm@11.19.0 --activate
pnpm install --frozen-lockfile
pnpm dev
```

Open the local URL printed by Vite, normally
[http://localhost:5173](http://localhost:5173).

If your Node.js installation does not include Corepack:

```bash
npm install --global pnpm@11.19.0
```

## Create and edit a project

1. Start the development server or production preview.
2. Choose **File → New Scenery Project**.
3. Select the source float32 NPY and matching terrain descriptor.
4. Load an asset catalogue if you want resolved prefab previews.
5. Import any optional county or large vegetation reference data.
6. Draw or generate scenery, inspect the preview, and bake the accepted results.
7. Save the editable project JSON.
8. Export the final terrain and required runtime documents for your viewer.

Basic viewport controls:

- Mouse wheel: zoom around the cursor.
- Middle- or right-drag: pan.
- `F`: fit the terrain in the viewport.
- `Enter` or double-click: finish a drawn geometry.
- `Backspace`: remove the latest draft point.
- `Escape`: cancel the current draft or placement mode.
- `Delete`: delete the selected object.
- `Shift+Delete`: delete a selected geometry vertex where valid.
- `Ctrl`-click a selected road or hedgerow segment: insert a point.
- `Q` / `E`: rotate a selected prefab or vegetation instance.

The **Place prefab** and **Place vegetation** controls are toggle tools. While enabled,
each click places another instance of the current selection. Toggling the active tool
off returns to selection mode; enabling one placement tool disables the other.

Generated settlement, route, frontage, and county results remain non-mutating previews
until explicitly baked. County baking is atomic, so one undo removes the complete
generated build.

## Build for production

The commands are the same on Windows PowerShell and Linux:

```text
pnpm install --frozen-lockfile
pnpm build
pnpm preview
```

The production files are written to `dist/`. Open the HTTP URL printed by the preview
server, normally [http://localhost:4173](http://localhost:4173).

For static deployment, upload the contents of `dist/` to an HTTP server or static
hosting service. Asset URLs are generated relative to the deployment directory, so
the build can be hosted at the domain root or beneath a path such as
`/polygon-county/`.

Do not open `dist/index.html` directly through `file://`. Browsers require an HTTP
origin and correct JavaScript MIME types for ES modules. Opening the file directly, or
using a host that rewrites missing JavaScript assets to an HTML fallback page, can
produce errors such as:

```text
Loading module was blocked because of a disallowed MIME type ("text/html")
```

## Tests and verification

Run the static checks, unit tests, and production build:

```text
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Install Playwright's Chromium browser once, then run the browser workflows:

### Windows

```powershell
pnpm exec playwright install chromium
pnpm test:browser
```

### Linux

```bash
pnpm exec playwright install --with-deps chromium
pnpm test:browser
```

The browser tests run against the production `dist/`, so run `pnpm build` first.
The current verification baseline is 170 Vitest tests and 10 Playwright workflows.

Run the deterministic full-scene performance benchmark with:

```text
pnpm benchmark
```

## Optional Python/Tkinter reference

The original v0.2 editor is preserved in
[`python_reference/`](python_reference/README.md). It has its own dependencies and
does not participate in the TypeScript build.

### Windows

```powershell
cd python_reference
py -3 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe main.py
```

Run its compatibility tests with:

```powershell
.\.venv\Scripts\python.exe -m pytest -q
```

### Linux

```bash
cd python_reference
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python main.py
```

Run its compatibility tests with:

```bash
python -m pytest -q
```

Some Linux distributions package Tkinter separately; for example, Debian and Ubuntu
users may need the `python3-tk` package.

## Repository layout

```text
src/app/          application composition and editor state
src/model/        authored entities, validation, migrations, and coordinates
src/history/      delta-based commands and undo/redo
src/io/           project persistence, imports, exports, and viewer bundles
src/terrain/      immutable base terrain and derived working terrain
src/rendering/    Three.js projections and GPU vegetation batches
src/interaction/  navigation, picking, editing, frontage, and placement logic
src/generation/   survey, A* routing, frontage, and county generation
src/workers/      background routing and county-build workers
src/schemas/      versioned JSON schema snapshots
tests/            unit, contract, benchmark, and Playwright browser tests
docs/             format guides and implementation milestone records
examples/         example descriptors, catalogues, and scenery documents
scripts/          fixture and benchmark tooling
python_reference/ preserved Python/Tkinter reference implementation
```

## Further documentation

- [Three.js rewrite architecture and implementation record](README_THREEJS_REWRITE.md)
- [Scenery format overview](docs/SCENERY_FORMATS.md)
- [Runtime export/importer guide](docs/RUNTIME_EXPORT_IMPORTER_GUIDE.md)
- [Settlement automation milestones](docs/SETTLEMENT_AUTOMATION_MILESTONE_PLAN.md)
- [Settlement-network automation milestones](docs/SETTLEMENT_NETWORK_AUTOMATION_PLAN.md)
- [Milestone 5 performance benchmark](docs/MILESTONE_5_BENCHMARK.md)

## License

Polygon County Scenery Editor, including the Three.js rewrite and preserved Python
reference implementation, is free software licensed under the GNU General Public
License version 3 or, at your option, any later version (`GPL-3.0-or-later`). See
[LICENSE](LICENSE). Third-party dependencies retain their respective licences.
