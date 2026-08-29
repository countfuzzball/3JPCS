# Versioned schema snapshots

These files are byte-for-byte copies of the Python reference schemas at the start of
the Three.js rewrite:

- `asset-catalog-v3.schema.json` ← `python_reference/schemas/asset_catalog.schema.json`
- `runtime-scenery-v2.schema.json` ← `python_reference/schemas/runtime_scenery.schema.json`
- `scenery-project-v3.schema.json` ← `python_reference/schemas/scenery_project.schema.json`

They are retained as explicit legacy contract fixtures and are not silently changed.

`scenery-project-v4.schema.json` is the browser rewrite's current editable project
contract. It adds the required native `vegetation_instances` collection. The rewrite
strictly loads v1–v4 and normalizes the in-memory model to v4 without rewriting the
source document merely by reading it. Milestone 5 saves only v4.

`runtime-scenery-v3.schema.json` is the current strict runtime contract. It adds the
required native `vegetation_instances` collection, derived terrain Y, normalized yaw,
and catalogue-resolution status while omitting editor locks and terrain-pad state. The
independently versioned v2 snapshot remains available only through the explicitly
labelled legacy export; nonempty native vegetation is never silently omitted.
