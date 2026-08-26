# Scenery editor data contracts

All geometry uses metres, origin at the northwest/top-left, +X east/right, +Z
south/down, and runtime +Y elevation/up. Roads and authored polygon geometry remain
2D X/Z data. Runtime scenery keeps only logical asset IDs; the separate shared asset
catalogue maps those IDs to resources.

## Native scenery project v3

Discriminator: `format == "polygon-county-scenery-project"` and
`schema_version == 3`.

The top level contains the world definition, external source references, immutable
base-terrain fingerprint, and the authored place, land-use, road, hedgerow, and prefab
collections. Paths are saved relative to the project where practical. Source paths
exist only in the editable project; runtime scenery does not inherit them.

The source object uses the engine-neutral shared catalogue name:

```json
{
  "terrain_npy": "terrain.npy",
  "terrain_descriptor": "terrain.json",
  "vegetation": "generated_vegetation.json",
  "county_features": "county_features.json",
  "asset_catalog": "asset_catalog.json"
}
```

Prefab instances store logical identity and authoring state:

```json
{
  "id": "01234567-89ab-4cde-8fab-0123456789ab",
  "name": "North Compound",
  "visible": true,
  "locked": false,
  "category": "military_compound",
  "asset_id": "military_compound_01",
  "x_m": 4120.0,
  "z_m": 1850.0,
  "rotation_deg": 27.0,
  "scale": 1.0,
  "frontage_road_id": null,
  "terrain_pad": {
    "enabled": true,
    "width_m": 220.0,
    "depth_m": 160.0,
    "blend_m": 100.0,
    "target_mode": "base_terrain_at_origin"
  }
}
```

There is deliberately no authored `terrain_y_m`: it is derived from the composed
working terrain. `target_mode` currently has one supported value. Pad width/depth must
be positive and blend must be non-negative.

Projects v1 and v2 remain readable. Both legacy versions used
`sources.prefab_catalog`; loading normalizes that reference to
`sources.asset_catalog`. V1 prefab instances additionally migrate to disabled terrain
pads so opening an old project never changes terrain unexpectedly, while v2 pads are
preserved. Saving always writes v3 and only the new source-field name.

## Shared asset catalogue v3

Discriminator: `format == "polygon-county-asset-catalog"` and
`schema_version == 3`.

```json
{
  "format": "polygon-county-asset-catalog",
  "schema_version": 3,
  "category_defaults": {
    "house": {
      "proxy": {"width_m": 10.0, "depth_m": 8.0, "wall_height_m": 4.5}
    }
  },
  "assets": {
    "house_2storey_01": {
      "category": "house",
      "resource": "buildings/house_2storey_01.glb"
    }
  }
}
```

This is the one manually maintained asset source used by the editor and viewer.
Category proxy dimensions are approximate UI/fallback geometry, not model bounds and
not terrain-pad defaults. Asset entries contain only category and neutral resource
path. Legacy catalogue v1/v2 documents and correction fields are rejected.

## Working terrain

The imported float32 NPY is an immutable base. Composition begins with a float32 copy
and applies enabled pads on visible prefabs in project-list order.

For each pad:

1. Sample the target from the immutable base at `(x_m, z_m)` using the required
   northwest-to-southeast triangle interpolation.
2. Rotate the pad rectangle by the prefab yaw.
3. Flatten its cell-aware core to the target.
4. Smoothstep the outer blend region into the surface produced by earlier pads.
5. Clip the result to the descriptor's minimum/maximum elevation endpoints.

The cell-aware core includes terrain vertices belonging to cells intersected by the
semantic rectangle. This guarantees useful behavior at any valid terrain spacing,
including pads smaller than a grid cell. Composition is deterministic but deliberately
order-sensitive where pads overlap.

## Final heightmap export

The final terrain export writes:

- an unsigned single-channel 16-bit PNG with columns along +X and rows along +Z; and
- a same-stem, unversioned metadata JSON using the Terrain Editor's complete current
  heightmap metadata fields.

Encoding is:

```text
q = round(clamp((height_m - minimum_elevation_m) /
                (maximum_elevation_m - minimum_elevation_m), 0, 1) * 65535)
```

The PNG stores elevation points, so its dimensions equal `elevation_points.x` by
`elevation_points.z`. Each terrain mesh cell must use the northwest-to-southeast
diagonal described by the metadata.

## Resampled vegetation v1

The output preserves the imported vegetation schema v1 and the complete object array.
For every record it replaces only `terrain_y_m` with a fresh triangle-consistent
sample from the final float32 working terrain. It does not move, regenerate, exclude,
or delete vegetation, including vegetation within a terrain pad.

## Runtime scenery v2

Discriminator: `format == "polygon-county-runtime-scenery"` and
`schema_version == 2`.

The export includes coordinate/world declarations, `terrain_float32_sha256`, and the
semantic place, land-use, road, hedgerow, and prefab arrays. It has no asset-catalogue
path or other filesystem asset reference.

Roads contain ordered X/Z controls and `elevation_mode: "follow_terrain"`; the viewer
owns continuous terrain conformance and mesh construction. A prefab includes logical
`asset_id`, category, X/Z, yaw, scale, visibility, optional frontage relationship, and
`terrain_y_m` sampled from the working surface. Terrain-pad authoring settings are not
runtime placement instructions and are omitted.

`terrain_float32_sha256` fingerprints the row-major float32 working grid. JSON
`terrain_y_m` samples therefore describe the pre-PNG surface. A viewer using the
quantized PNG should compare within half of one vertical code step rather than demand
bit identity.
