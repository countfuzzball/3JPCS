# Polygon County Scenery Editor runtime exports: importer/consumer guide

This document is a self-contained, importer-facing description of the runtime exports
produced by Polygon County Scenery Editor v0.2. It is intended for implementing a
terrain viewer, Godot/Unity/Three.js importer, conversion tool, or validation pipeline
without reading the editable `.scenery.json` project format.

> **Browser rewrite addendum (v0.5 / Milestone 5):** the Three.js editor now defaults
> to strict runtime scenery v3, which is the v2 document described below plus required
> native `vegetation_instances`. Each native record contains ID/name/visibility,
> vegetation type, logical asset ID, X/Z, working-terrain Y, normalized yaw, scale,
> nullable source-region UUID, and resolved/missing asset status. It omits locks and
> terrain pads. The original v2 contract below remains available as an explicitly
> labelled legacy export and cannot silently omit a nonempty native collection. See
> `src/schemas/runtime-scenery-v3.schema.json` and `docs/SCENERY_FORMATS.md` for the
> current browser contract. The remainder of this guide deliberately preserves the
> Python v0.2/v2 consumer contract.

This guide adapts the Terrain Editor runtime importer contract. Terrain image encoding,
coordinates, grid layout, and triangle sampling remain compatible. The Scenery Editor
adds composed terrain pads, resampled vegetation, and its own semantic runtime-scenery
JSON. It does not export the Terrain Editor's `county_features.json` contract.

## Contract summary

```text
document_role: importer-facing Scenery Editor export specification
editable_project_schema: not covered here
heightmap_png: unsigned 16-bit single-channel greyscale
heightmap_metadata_json: unversioned, paired to PNG by filename stem
vegetation_json_schema_version: 1
runtime_scenery_format: polygon-county-runtime-scenery
runtime_scenery_schema_version: 2
complete_bundle_command: none in v0.2; export the three products independently
runtime_asset_resolution: viewer-owned asset manifest keyed by asset_id
units: metres
origin: northwest / top-left of the world
axes: +X east/right, +Y elevation/up, +Z south/down
terrain_cell_diagonal: northwest to southeast
```

Normative implementation and schema files in this repository are:

- [`scenery_editor/project_io/final_export.py`](../scenery_editor/project_io/final_export.py)
- [`scenery_editor/project_io/runtime_export.py`](../scenery_editor/project_io/runtime_export.py)
- [`scenery_editor/model/working_terrain.py`](../scenery_editor/model/working_terrain.py)
- [`schemas/runtime_scenery.schema.json`](../schemas/runtime_scenery.schema.json)

The words **MUST**, **SHOULD**, and **MAY** below describe importer behavior.

## 1. Exported files

The Scenery Editor currently exposes three independent export commands:

| Export | Suggested filename | Identification | Current version |
| --- | --- | --- | --- |
| Final terrain | `terrain_heightmap.png` | User-selected PNG | PNG format; no application schema version |
| Terrain metadata | `terrain_heightmap.json` | Same directory and stem as the PNG | Unversioned required-field contract |
| Resampled vegetation | `generated_vegetation.json` | User-selected JSON | `schema_version == 1` |
| Runtime scenery | `runtime_scenery.json` | User-selected JSON | Fixed format plus `schema_version == 2` |

The commands are:

- **File → Export Final Terrain PNG + Metadata…**
- **File → Export Resampled Vegetation…**
- **File → Export Runtime Scenery…**

Exporting `name.png` always writes `name.json` beside it. Vegetation and runtime
scenery filenames are conventions only; neither document embeds its own filename.

There is no combined bundle command or bundle manifest in v0.2. Before each export,
the application recomposes the working terrain from the unchanged imported base
terrain and the current prefab terrain pads. If all three commands are run from the
same unchanged scenery-project state, their terrain-derived values describe the same
float32 surface.

Cross-file identity limitations:

- heightmap metadata contains no project identity, batch ID, or terrain hash;
- vegetation retains the `project_id` and `project_name` of its imported vegetation
  source;
- runtime scenery contains no project ID or project name;
- runtime scenery includes a hash of the pre-quantized float32 terrain grid, but the
  PNG does not contain that hash;
- no shared export-batch ID proves that independently selected files belong together.

An importer **SHOULD** keep the selected files together as one viewer-side bundle and
perform the consistency checks in section 10.

## 2. Runtime ownership and authority

The intended runtime separation is:

```text
final heightmap PNG + metadata
    authoritative runtime terrain surface

runtime scenery JSON
    semantic roads, hedgerows, regions, and prefab placements

resampled vegetation JSON
    already generated vegetation placements with final-terrain Y

viewer-owned asset manifest
    asset_id/model_or_species -> engine resource and model-specific corrections
```

The viewer does not need the editable scenery project or source float32 NPY, and no
asset path is embedded in runtime scenery. It consumes the shared asset catalogue (or
an equivalent viewer-owned manifest) separately.

The final heightmap already contains the effect of terrain pads. A consumer **MUST NOT**
apply terrain pads a second time. Terrain-pad width, depth, blend, target mode, and
composition order are authoring data and are deliberately absent from runtime scenery.

`asset_id` is a logical lookup key. It is not a filename, URI, Godot resource path,
Unity asset GUID, or guaranteed GLB stem. The viewer owns that mapping.

## 3. Shared coordinate and terrain conventions

All runtime data uses metres and the same world axes:

```text
world origin: (X=0, Z=0) at the northwest/top-left corner
+X: east/right
+Z: south/down on the editor map
+Y: elevation/up in 3D
```

Terrain array and image layout:

```text
PNG pixel column = terrain X index
PNG pixel row    = terrain Z index
world X          = column * terrain_spacing_m
world Z          = row    * terrain_spacing_m
```

Row 0 is the north edge and column 0 is the west edge. Importers **MUST NOT** flip the
heightmap vertically without applying the same coherent transform to vegetation,
regions, paths, prefab positions, and rotations.

The heightmap stores elevation points, not cells:

```text
point_count_x = cell_count_x + 1
point_count_z = cell_count_z + 1
world_width_m = cell_count_x * terrain_spacing_m
world_depth_m = cell_count_z * terrain_spacing_m
```

Grid spacing is authored data and may range from very fine to extremely coarse.
Importers **MUST** read dimensions and spacing from metadata rather than assume a
particular world size or resolution.

### 3.1 Required terrain triangulation

Each cell is divided along its northwest-to-southeast diagonal:

```text
NW -------- NE
| \          |
|   \        |
|     \      |
SW -------- SE

triangles: NW-NE-SE and NW-SE-SW
```

An importer constructing a terrain mesh **MUST** use this diagonal if it wants its
terrain Y to agree with exported vegetation, prefab origins, and editor queries.
Triangle winding may be reordered for the target renderer, but the two vertex sets
must remain the same.

Triangle-consistent sampling pseudocode:

```text
function terrain_height_at(x_m, z_m):
    require 0 <= x_m <= world_width_m
    require 0 <= z_m <= world_depth_m

    grid_x = x_m / terrain_spacing_m
    grid_z = z_m / terrain_spacing_m

    cell_x = min(floor(grid_x), cell_count_x - 1)
    cell_z = min(floor(grid_z), cell_count_z - 1)

    local_x = grid_x - cell_x
    local_z = grid_z - cell_z

    nw = height[row=cell_z,     column=cell_x]
    ne = height[row=cell_z,     column=cell_x + 1]
    sw = height[row=cell_z + 1, column=cell_x]
    se = height[row=cell_z + 1, column=cell_x + 1]

    if local_z <= local_x:
        # NW-NE-SE triangle
        return nw + local_x * (ne - nw) + local_z * (se - ne)
    else:
        # NW-SE-SW triangle
        return nw + local_z * (sw - nw) + local_x * (se - sw)
```

Do not substitute bilinear interpolation when validating exported Y values.

## 4. Meaning of the final working terrain

The Scenery Editor imports a float32 NPY as an immutable base terrain and creates a
separate float32 working copy. Enabled terrain pads belonging to visible prefab
instances are applied in stable prefab-list order.

For each pad, the editor:

1. samples its target height from the immutable base terrain at the prefab origin;
2. rotates the rectangular pad by the prefab's yaw;
3. flattens the cell-aware core to that target;
4. blends its outer region into the terrain produced by earlier pads; and
5. clips the result to the source metadata's minimum and maximum endpoints.

The blend uses a smoothstep weight:

```text
t = clamp(1 - distance_from_core / blend_m, 0, 1)
weight = t * t * (3 - 2 * t)
result = current + weight * (target - current)
```

The core is conservatively expanded according to terrain-cell size so that a pad
smaller than one grid cell still affects the intersected cell. For example, a 20 m
house pad on a 50 m grid is not ignored. This may flatten an area larger than the
literal rectangle on a coarse grid; that is intentional authoring behavior.

Overlapping pads are deterministic but order-sensitive. Hidden prefabs and disabled
pads do not modify working terrain. The viewer does not need to reproduce any of this
logic: it consumes the already composed final heightmap.

## 5. Final heightmap PNG

### 5.1 Image format

The final heightmap is a lossless PNG with one unsigned 16-bit greyscale sample per
terrain elevation point:

```text
color model: single-channel greyscale
bit depth: 16 bits per sample
logical sample range: 0..65535
image width: elevation_points.x
image height: elevation_points.z
```

A PNG library should return samples as 16-bit or wider integers. Importers **MUST NOT**
load the heightmap through an 8-bit color path, apply sRGB/gamma conversion, or lose the
original integer value before decoding elevation. PNG handles its own file byte order;
do not parse the compressed file as a raw little-endian array.

### 5.2 Vertical encoding

Let:

```text
q     = unsigned PNG sample in 0..65535
h_min = metadata.minimum_elevation_m
h_max = metadata.maximum_elevation_m
span  = h_max - h_min
```

The exporter encodes metres as:

```text
q = round(clamp((height_m - h_min) / span, 0, 1) * 65535)
```

The importer decodes metres as:

```text
height_m = h_min + (q / 65535) * span
```

The endpoint rule is exact:

```text
PNG 0     -> minimum_elevation_m
PNG 65535 -> maximum_elevation_m
```

The vertical step and maximum nearest-code quantization error are:

```text
code_step_m = (h_max - h_min) / 65535
maximum_quantization_error_m = code_step_m / 2
```

For the common `-20 m` to `3000 m` range, one step is approximately `0.046082246 m`
and the maximum quantization error is approximately `0.023041123 m`—about 2.3 cm.
Projects may use other endpoints, so importers **MUST** compute this from metadata.

## 6. Heightmap metadata JSON

The metadata is UTF-8 JSON beside the PNG with the same filename stem. It has no
`schema_version`, project identity, filename, or terrain hash. Its complete v0.2 shape
is:

```json
{
  "world_width_m": 6000.0,
  "world_depth_m": 6000.0,
  "terrain_spacing_m": 50.0,
  "terrain_cells": {
    "x": 120,
    "z": 120,
    "total": 14400
  },
  "elevation_points": {
    "x": 121,
    "z": 121,
    "total": 14641
  },
  "minimum_elevation_m": -20.0,
  "sea_level_m": 0.0,
  "lowland_reference_elevation_m": 10.0,
  "maximum_elevation_m": 3000.0,
  "uint16_reference_values": {
    "sea_level": 434,
    "lowland_reference": 651
  },
  "vertical_encoding": "Unsigned 16-bit greyscale: 0 maps to minimum_elevation_m and 65535 maps to maximum_elevation_m; values outside that range are clipped.",
  "grid_layout": "Rows increase along +Z; columns increase along +X.",
  "cell_diagonal": "Each cell is divided from northwest to southeast."
}
```

| Field | Type | Importer meaning |
| --- | --- | --- |
| `world_width_m` | number > 0 | World extent along X. |
| `world_depth_m` | number > 0 | World extent along Z. |
| `terrain_spacing_m` | number > 0 | Horizontal distance between elevation points. |
| `terrain_cells.x` / `.z` | integer > 0 | Mesh-cell counts. |
| `terrain_cells.total` | integer > 0 | Must equal `x * z`. |
| `elevation_points.x` / `.z` | integer >= 2 | PNG width and height. |
| `elevation_points.total` | integer >= 4 | Must equal `x * z`. |
| `minimum_elevation_m` | finite number | Height represented by PNG value 0. |
| `sea_level_m` | finite number | Semantic sea-level reference. |
| `lowland_reference_elevation_m` | finite number | Semantic lowland reference. |
| `maximum_elevation_m` | finite number | Height represented by PNG value 65,535. |
| `uint16_reference_values.*` | integer 0..65535 | Convenience encodings of the two semantic references. |
| `vertical_encoding` | string | Human-readable statement of the decode rule. |
| `grid_layout` | string | Human-readable row/column orientation. |
| `cell_diagonal` | string | Human-readable triangulation rule. |

The elevation references must satisfy:

```text
minimum_elevation_m <= sea_level_m
sea_level_m <= lowland_reference_elevation_m
lowland_reference_elevation_m <= maximum_elevation_m
maximum_elevation_m > minimum_elevation_m
```

## 7. Resampled vegetation JSON

Resampled vegetation preserves the imported Terrain Editor vegetation schema v1. It
contains generated runtime placements, not source forest/scatter polygons, species
weights, exclusion polygons, or regeneration settings.

Top-level shape:

```json
{
  "schema_version": 1,
  "project_id": "12345678-1234-4234-8234-123456789abc",
  "project_name": "Example County",
  "coordinate_system": "X east/right, terrain Y elevation, Z south/down; metres",
  "generated_object_count": 1,
  "objects": [
    {
      "type": "forest_tree",
      "model_or_species": "oak",
      "x_m": 1250.0,
      "z_m": 840.0,
      "terrain_y_m": 63.25,
      "rotation_deg": 217.5,
      "scale": 1.04,
      "source_region_id": "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
    }
  ]
}
```

Top-level fields:

| Field | Type | Required meaning |
| --- | --- | --- |
| `schema_version` | integer | Must equal `1`. |
| `project_id` | UUID string | Identity retained from the imported vegetation source. |
| `project_name` | non-empty string | Name retained from the imported vegetation source. |
| `coordinate_system` | fixed string | Shared coordinate convention. |
| `generated_object_count` | integer >= 0 | Must equal `objects.length`. |
| `objects` | array | Zero or more generated placements. |

Object fields:

| Field | Type | Required meaning |
| --- | --- | --- |
| `type` | string | `forest_tree`, `scattered_tree`, or `shrub`. |
| `model_or_species` | non-empty string | Viewer-side species/asset lookup key. |
| `x_m` | finite number | X position in metres. |
| `z_m` | finite number | Z position in metres. |
| `terrain_y_m` | finite number | Fresh pre-PNG working-terrain height at X/Z. |
| `rotation_deg` | finite number | Imported/generated yaw in degrees. |
| `scale` | finite number > 0 | Uniform object scale. |
| `source_region_id` | UUID string | Imported source generation-region identity. |

The Scenery Editor does not regenerate, move, exclude, or delete vegetation. It copies
every imported placement and replaces only `terrain_y_m` with a triangle-consistent
sample from the final float32 working terrain. Vegetation inside a prefab's terrain pad
is retained. If vegetation clearance is desired, that is a separate future semantic
feature and must not be inferred from terrain padding.

`model_or_species` is a logical key, not a filesystem path. The vegetation document
does not declare a model forward axis, pivot, pitch/roll convention, or engine resource.
Those corrections belong in the viewer's asset registry.

## 8. Runtime scenery JSON v2

Runtime scenery is a separate format from Terrain Editor `county_features.json` and
from the editable Scenery Editor project. Importers **MUST** require both:

```text
format == "polygon-county-runtime-scenery"
schema_version == 2
```

A representative complete document is:

```json
{
  "format": "polygon-county-runtime-scenery",
  "schema_version": 2,
  "coordinate_system": "X east/right, terrain Y elevation, Z south/down; metres",
  "world": {
    "width_m": 6000.0,
    "depth_m": 6000.0,
    "terrain_spacing_m": 50.0
  },
  "terrain_float32_sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "place_regions": [
    {
      "id": "11111111-1111-4111-8111-111111111111",
      "name": "Mill Village",
      "place_type": "village",
      "points": [[300.0, 300.0], [900.0, 300.0], [900.0, 900.0]],
      "visible": true
    }
  ],
  "land_use_regions": [
    {
      "id": "22222222-2222-4222-8222-222222222222",
      "name": "West Pasture",
      "land_use_type": "pasture",
      "points": [[1000.0, 300.0], [1600.0, 300.0], [1600.0, 900.0]],
      "visible": true
    }
  ],
  "roads": [
    {
      "id": "33333333-3333-4333-8333-333333333333",
      "name": "Mill Lane",
      "points": [[350.0, 600.0], [850.0, 600.0]],
      "width_m": 7.5,
      "road_class": "lane",
      "surface": "gravel",
      "elevation_mode": "follow_terrain",
      "visible": true
    }
  ],
  "hedgerows": [
    {
      "id": "44444444-4444-4444-8444-444444444444",
      "name": "North Hedge",
      "points": [[300.0, 280.0], [900.0, 280.0]],
      "nominal_width_m": 2.0,
      "nominal_height_m": 2.0,
      "visible": true
    }
  ],
  "prefab_instances": [
    {
      "id": "55555555-5555-4555-8555-555555555555",
      "name": "Mill House",
      "visible": true,
      "asset_id": "house_2storey_01",
      "category": "house",
      "x_m": 550.25,
      "z_m": 550.75,
      "terrain_y_m": 42.6,
      "rotation_deg": 294.02,
      "scale": 1.0,
      "frontage_road_id": "33333333-3333-4333-8333-333333333333",
      "asset_status": "resolved"
    }
  ]
}
```

### 8.1 Top-level fields

| Field | Type | Meaning |
| --- | --- | --- |
| `format` | fixed string | Runtime-scenery discriminator. |
| `schema_version` | integer | Must equal `2`. |
| `coordinate_system` | fixed string | Shared X/Y/Z declaration. |
| `world` | object | World dimensions and terrain spacing. |
| `terrain_float32_sha256` | 64 lowercase hex characters | Hash of the pre-PNG working grid; see section 10. |
| `place_regions` | array | Semantic place/planning polygons. |
| `land_use_regions` | array | Semantic land-use polygons. |
| `roads` | array | Semantic terrain-following road centrelines. |
| `hedgerows` | array | Semantic terrain-following linear features. |
| `prefab_instances` | array | Logical object placements with final-terrain origin Y. |

`world` has exactly the following current exporter fields:

```json
{
  "width_m": 6000.0,
  "depth_m": 6000.0,
  "terrain_spacing_m": 50.0
}
```

These values **MUST** agree with the selected heightmap metadata.

### 8.2 Place regions

Each place region has:

```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "name": "Mill Village",
  "place_type": "village",
  "points": [[300.0, 300.0], [900.0, 300.0], [900.0, 900.0]],
  "visible": true
}
```

`points` contains at least three `[x_m, z_m]` vertices. Current `place_type` values are:

- `town`
- `village`
- `farm`
- `military_area`

A place region is planning/semantic geometry. It does not automatically instantiate
buildings, population, roads, or gameplay objects.

### 8.3 Land-use regions

Each land-use region has:

```json
{
  "id": "22222222-2222-4222-8222-222222222222",
  "name": "West Pasture",
  "land_use_type": "pasture",
  "points": [[1000.0, 300.0], [1600.0, 300.0], [1600.0, 900.0]],
  "visible": true
}
```

Current `land_use_type` values are `pasture`, `rough_grazing`, and `woodland`. These are
semantic polygons only. They do not contain crops, reeds, grass instances, materials,
or procedural generation instructions. Future crops/reeds may be represented through
their own authored polygons rather than vegetation placement records.

### 8.4 Roads

Each road has:

```json
{
  "id": "33333333-3333-4333-8333-333333333333",
  "name": "Mill Lane",
  "points": [[350.0, 600.0], [850.0, 600.0]],
  "width_m": 7.5,
  "road_class": "lane",
  "surface": "gravel",
  "elevation_mode": "follow_terrain",
  "visible": true
}
```

Road semantics:

- `points` are ordered authored centreline controls in X/Z;
- `width_m` is the full road width;
- current `road_class` values are `county_road`, `local_road`, `lane`, `farm_track`,
  and `military_road`;
- current `surface` values are `paved`, `gravel`, and `dirt`;
- `surface` is semantic and is not a material path;
- `elevation_mode` is currently exactly `follow_terrain`.

Roads contain no Y samples. A road may have only two sparse controls while crossing
complex terrain. A consumer **MUST NOT** construct one straight XYZ chord using only
endpoint heights. It should create its own spline/polyline sampling and conform the
result continuously enough to the final heightmap.

The consumer owns tessellation, lateral vertices, joins, UVs, material lookup,
collision, LOD, z-fighting offset, bridges, and other rendering decisions.

### 8.5 Hedgerows

Each hedgerow has:

```json
{
  "id": "44444444-4444-4444-8444-444444444444",
  "name": "North Hedge",
  "points": [[300.0, 280.0], [900.0, 280.0]],
  "nominal_width_m": 2.0,
  "nominal_height_m": 2.0,
  "visible": true
}
```

The ordered points are X/Z centreline controls. Nominal width and height are semantic
dimensions, not generated geometry. Hedgerows have no Y samples or explicit elevation
mode; a terrain-following viewer should sample the final terrain along the path and
choose its own mesh, instance, collision, and material strategy.

### 8.6 Prefab instances

Each prefab instance has:

```json
{
  "id": "55555555-5555-4555-8555-555555555555",
  "name": "Mill House",
  "visible": true,
  "asset_id": "house_2storey_01",
  "category": "house",
  "x_m": 550.25,
  "z_m": 550.75,
  "terrain_y_m": 42.6,
  "rotation_deg": 294.02,
  "scale": 1.0,
  "frontage_road_id": "33333333-3333-4333-8333-333333333333",
  "asset_status": "resolved"
}
```

Field semantics:

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | UUID string | Stable scenery-object identity. |
| `name` | non-empty string | Human-readable editor name. |
| `visible` | boolean | Whether the object should normally render. |
| `asset_id` | non-empty string | Logical shared-catalogue lookup key. |
| `category` | non-empty string | Semantic/editor grouping; not a resource path. |
| `x_m`, `z_m` | finite numbers | World origin in the horizontal plane. |
| `terrain_y_m` | finite number | Unoffset pre-PNG working-terrain height at the origin. |
| `rotation_deg` | finite number | Normalized yaw in `[0, 360)`. |
| `scale` | finite number > 0 | Uniform object scale. |
| `frontage_road_id` | UUID string or null | Optional reference to a road in this document. |
| `asset_status` | `resolved` or `missing` | Whether the editor's loaded asset catalogue contained the key at export. |

Place the logical prefab origin at:

```text
(x_m, terrain_y_m, z_m)
```

`terrain_y_m` already includes all composed terrain pads affecting that location. It
does not include a foundation depth, pivot correction, hover offset, or engine-specific
Y adjustment.

Yaw convention:

```text
rotation_deg = 0   -> logical front faces world -Z / north
positive rotation -> clockwise when viewed from +Y
```

The X/Z transform for a logical local point is:

```text
world_x = x_m + cos(rotation) * local_x - sin(rotation) * local_z
world_z = z_m + sin(rotation) * local_x + cos(rotation) * local_z
```

The runtime document deliberately does not contain footprint width/depth, planning
envelope, model bounds, pivot, forward-axis correction, GLB path, or terrain-pad data.
Resource lookup belongs to the shared asset catalogue.

`asset_status == "missing"` means only that the Scenery Editor did not have a matching
asset catalogue loaded when it exported. A viewer may still resolve the `asset_id`
successfully after loading a catalogue. Conversely, `resolved` does not guarantee a
consumer can load the resource. Importers should report their own missing-resource
entries independently.

### 8.7 Visibility and IDs

Runtime export retains hidden authored objects with `visible: false`. Consumers
**MUST NOT** assume every record should render. Retaining hidden records preserves UUID
relationships such as `frontage_road_id`.

Editor-only `locked` state is absent. UUIDs are unique across all authored Scenery
Editor object collections at export time.

## 9. Shared asset catalogue v3

The editor and viewer consume one manually maintained engine-neutral catalogue:

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

Assets must already use metres, Y up, local -Z forward, correct scale at 1.0, and a
ground-ready pivot. A consumer resolves `resource`, places the model at exact exported
XYZ, applies the exported heading and optional instance scale, and stops. Old yaw,
pivot, base-scale, and per-asset footprint corrections are not accepted. Do not put
catalogue paths or resources into runtime scenery JSON.

Vegetation `model_or_species` should be resolved through a similar viewer-owned table.

## 10. Cross-file relationships, hashes, and precision

When exports come from the same unchanged scenery state:

- runtime `world.width_m` equals metadata `world_width_m`;
- runtime `world.depth_m` equals metadata `world_depth_m`;
- runtime `world.terrain_spacing_m` equals metadata `terrain_spacing_m`;
- vegetation and prefab `terrain_y_m` agree with NW-SE triangle interpolation of the
  final float32 working terrain before PNG quantization;
- every runtime road and hedgerow derives its runtime Y from the same final terrain;
- terrain pads are already represented in the final heightmap and all sampled Y values.

### 10.1 Float32 terrain hash

`terrain_float32_sha256` is computed as:

```text
SHA-256(row-major C-order bytes of the final float32 elevation array)
```

It is **not**:

- a SHA-256 of the PNG file;
- a SHA-256 of decoded PNG integers;
- a SHA-256 of the metadata JSON; or
- a hash of the original imported NPY file.

Because the PNG is quantized to 16 bits, a consumer with only the PNG cannot generally
reconstruct the exact float32 bytes and verify this hash. Treat it as provenance for
pipelines that retain or independently receive the float32 grid, or as an identity key
for checking that two runtime-scenery documents refer to the same working grid. Do not
reject an otherwise consistent PNG merely because its file hash differs.

### 10.2 Quantization-aware Y comparison

JSON Y values are sampled before PNG conversion. A decoded PNG height is therefore not
required to be bit-identical to vegetation or prefab `terrain_y_m`.

Use at least:

```text
tolerance_m >= (maximum_elevation_m - minimum_elevation_m) / (2 * 65535)
```

plus ordinary floating-point tolerance. For the common `-20..3000 m` range, PNG
quantization alone can produce approximately `0.0231 m` difference.

For validation:

```text
vegetation expected_y = triangle_height_at(x_m, z_m)
prefab expected_y     = triangle_height_at(x_m, z_m)
road/hedge runtime_y  = triangle_height_at(any tessellated x_m, z_m)
```

The vegetation `project_id` cannot currently be compared with runtime scenery because
runtime scenery v2 has no project ID. Association is therefore user/bundle managed.

## 11. Recommended importer algorithm

1. Ask the user for the final terrain PNG and locate its same-stem metadata JSON.
2. Parse metadata and validate all arithmetic relationships.
3. Decode the PNG through a 16-bit single-channel path.
4. Verify PNG dimensions against `elevation_points.x` and `.z`.
5. Decode PNG samples to metres using metadata minimum and maximum.
6. Build the terrain mesh with X columns, Z rows, and the NW-SE cell diagonal.
7. Load runtime scenery if present; require its exact format and schema v2.
8. Compare runtime world dimensions and spacing with heightmap metadata.
9. Validate UUID uniqueness, point shapes, numeric finiteness, coordinate bounds, and
   `frontage_road_id` references.
10. Apply one coherent world-axis conversion for the target engine.
11. Resolve each prefab `asset_id` through the viewer's own manifest.
12. Place prefab origins at exported X/Y/Z, convert yaw once, and honor visibility.
13. Build roads and hedgerows from ordered X/Z controls and conform viewer-generated
    geometry continuously to the final heightmap.
14. Treat place and land-use regions as semantic polygons unless the viewer explicitly
    implements behavior for them.
15. Load vegetation if present; require schema v1 and verify count, fields, UUIDs,
    bounds, finite numbers, and positive scale.
16. Resolve vegetation `model_or_species` through a viewer-owned registry.
17. Optionally compare vegetation and prefab Y against decoded terrain using the
    quantization-aware tolerance from section 10.
18. Do not apply terrain pads, vegetation culling, road deformation, or asset-path
    lookup rules inferred from the editable project.

## 12. Validation checklist

### Heightmap and metadata

- [ ] Metadata is valid UTF-8 JSON with every field in section 6.
- [ ] PNG is single-channel 16-bit greyscale.
- [ ] PNG width equals `elevation_points.x`.
- [ ] PNG height equals `elevation_points.z`.
- [ ] `terrain_cells.x + 1 == elevation_points.x`.
- [ ] `terrain_cells.z + 1 == elevation_points.z`.
- [ ] Cell and point totals match their X/Z products.
- [ ] Width/depth equal cell counts times spacing within numeric tolerance.
- [ ] Elevation references are ordered and maximum exceeds minimum.
- [ ] Reference uint16 values match the documented encode formula.
- [ ] The mesh uses the NW-SE cell diagonal.

### Resampled vegetation

- [ ] `schema_version == 1`.
- [ ] The coordinate-system string is supported.
- [ ] `generated_object_count == objects.length`.
- [ ] Project and source-region IDs are valid UUIDs.
- [ ] Every numeric value is finite; scale is positive.
- [ ] X/Z positions lie inside the heightmap world.
- [ ] Types and `model_or_species` keys are handled or rejected explicitly.
- [ ] No vegetation was implicitly removed merely because it lies in a terrain pad.
- [ ] Optional terrain-Y validation uses quantization-aware tolerance.

### Runtime scenery

- [ ] `format == "polygon-county-runtime-scenery"`.
- [ ] `schema_version == 2`.
- [ ] The coordinate-system string is supported.
- [ ] `terrain_float32_sha256` is 64 lowercase hexadecimal characters.
- [ ] Runtime world dimensions and spacing match heightmap metadata.
- [ ] All authored object IDs are valid and unique.
- [ ] Every path/polygon point has exactly two finite X/Z components inside the world.
- [ ] Place and land-use polygons contain at least three points.
- [ ] Roads and hedgerows contain at least two ordered points.
- [ ] Road width and hedgerow nominal dimensions are positive.
- [ ] Every road has `elevation_mode == "follow_terrain"`.
- [ ] Roads contain no Y samples or prebuilt ribbon geometry.
- [ ] `frontage_road_id` is null or resolves to a runtime road ID.
- [ ] Prefab scale is positive and rotation is finite.
- [ ] `asset_status` is handled as asset-catalogue status, not viewer resolution truth.
- [ ] Hidden objects are retained but not rendered unless explicitly desired.
- [ ] Runtime scenery contains no GLB path, catalog path, or terrain-pad instruction.

## 13. Version and failure policy

An importer **SHOULD** fail clearly rather than guess when:

- runtime scenery has an unsupported format or schema version;
- vegetation `schema_version` is not 1;
- the PNG is not 16-bit single-channel data;
- required metadata fields are absent or inconsistent;
- runtime world dimensions/spacing disagree with the selected terrain metadata;
- numeric values are non-finite or X/Z coordinates are out of bounds;
- required UUIDs are malformed or references do not resolve; or
- required semantic values such as road elevation mode are unsupported.

Runtime scenery v1 must not be silently interpreted as v2. V1 included a prefab-catalog
source path and identified the source terrain hash; v2 removes the catalog path and
identifies the composed final float32 terrain through `terrain_float32_sha256`. Older or
future versions should use an explicit migration adapter.

Heightmap metadata is currently unversioned. A tolerant metadata reader **MAY** ignore
unknown future fields, but it should still require and validate all fields documented
in section 6.

The checked-in runtime schema validates the v2 top-level envelope. Importers should
also perform the object-level validation in this guide, because current object records
are generated by strict editor models even though the schema file does not yet encode
every nested constraint.

## 14. What is deliberately not exported

The runtime products do not contain:

- the editable `.scenery.json` project;
- the original float32 base-terrain NPY;
- the exact float32 working array as a separate NPY;
- prefab terrain-pad settings or composition order;
- the separately distributed shared asset catalogue;
- GLB paths, engine resource paths, materials, or asset binaries;
- prefab planning envelopes, authoritative mesh bounds, pivot corrections, or
  foundation depth;
- vegetation source polygons, species weights, regeneration rules, or clearance areas;
- place/land-use procedural generation rules;
- road or hedgerow Y samples, meshes, cross-sections, joins, UVs, or tessellation;
- editor locks, selections, tools, undo/redo history, or UI state;
- a shared bundle manifest or export-batch ID.

An importer should treat the PNG as the authoritative runtime terrain, vegetation JSON
as a complete placement list resampled onto that terrain, and runtime scenery JSON as
engine-agnostic semantic scenery plus logical prefab placements. Mesh construction,
asset resolution, pivots, materials, collision, LOD, and engine coordinate conversion
remain viewer responsibilities.
