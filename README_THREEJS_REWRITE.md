# Polygon County Scenery Editor — Three.js rewrite

This is a genuine static browser rewrite, implemented through **Milestone 0 and
Milestone 1 only**. The Python/Tkinter application remains checked in beside it as the
behavioural and data-contract reference.

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

`npm run benchmark` currently reports that the full Polygon County performance
benchmark is deferred to Milestone 5. It does not fabricate performance results.

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

Project open/save/relink, authored geometry, prefabs, terrain pads, exports, explicit
vegetation, and the full workload benchmark belong to later milestones and are not
partially presented as finished here.

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
are portable name/path hints only; they are not file capabilities. Milestone 1 obtains
fresh `File` objects from explicit file inputs. Later project-open work must relink
missing sources through user selection and must never serialize `File`, directory
handles, Three.js objects, or browser-only state.

NPY data is read locally in memory. The imported typed array is copied behind the
`TerrainReference` API; callers can request a copy but cannot obtain the authoritative
buffer. The original file bytes—not a decoded array—define the base SHA-256.

## Architecture

```text
src/app/          composition, project seed, dirty state
src/model/        contracts, validation errors, coordinate transforms
src/io/           browser terrain adapters and narrow NPY parser
src/terrain/      immutable base terrain and NW–SE queries
src/rendering/    Three.js controller and terrain adapter
src/interaction/  orthographic fit/pan/zoom/cursor math
src/ui/           semantic DOM layout
src/schemas/      explicitly versioned contract snapshots
tests/            unit, golden fixture, and focused browser coverage
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
- Editable yaw remains clockwise-positive; a Three.js object uses the negative yaw
  radians. Milestone 1 tests the `0/90/180/270` mapping even though object authoring
  begins in later milestones.
