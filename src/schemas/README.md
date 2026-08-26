# Versioned schema snapshots

These files are byte-for-byte copies of the Python reference schemas at the start of
the Three.js rewrite:

- `asset-catalog-v3.schema.json` ← `schemas/asset_catalog.schema.json`
- `runtime-scenery-v2.schema.json` ← `schemas/runtime_scenery.schema.json`
- `scenery-project-v3.schema.json` ← `schemas/scenery_project.schema.json`

They are retained as explicit legacy/current contract fixtures. They are not silently
expanded into future project v4 or runtime v3 schemas during Milestones 0–1.
