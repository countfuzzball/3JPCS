# Settlement automation reference fixtures

These fixtures are the repository-owned SA-0 baseline for the settlement survey,
terrain-aware road routing, and settlement frontage milestones. They were reduced from
the user's earlier `polygon_county_streaming_runtime_v0.5/tools/world_builder.py`; that
Downloads file is provenance only and is not needed to run the tests.

The goldens deliberately capture small numerical behaviors, not a byte-identical old
world. The editor uses different terrain interpolation, entity records, identifiers,
coordinate-facing conventions, and asset dimensions.

## Coordinate and numerical conventions

- Both systems store horizontal points as `[x_m, z_m]`, with +X east/right and +Z
  south/down. The editor adds +Y up for rendered elevation.
- Legacy `sample_height()` bilinearly interpolates all four corners of a cell.
- Editor `heightAt()` interpolates one of the two triangles formed by the fixed
  northwest-to-southeast diagonal.
- Legacy `slope(x, z, span)` samples two axis-aligned height differences and returns
  `max(abs(delta_x) / run_x, abs(delta_z) / run_z)`, a unitless rise/run grade.
- Editor `slopeAt(x, z)` returns the active terrain triangle's gradient magnitude as
  `atan(hypot(dh/dx, dh/dz))` in degrees.
- A grade may be converted to an angle with `atan(grade) * 180 / pi`, but that does
  not make the two slope functions equivalent because their sampling differs.
- Legacy frontage tangents are radians measured from +X. Its `side = +1` is serialized
  as `left`, even though the resulting +90-degree normal points toward +Z for an
  eastbound road. The editor retains its existing geometric meaning of left/right
  looking from the first frontage point toward the second.
- Legacy buildings use local +Z as their front and store radians. Editor prefabs use
  local -Z as their front and store clockwise degrees from world north. Legacy
  rotations are therefore not portable values.

The interpolation comparison in `candidate-site-scoring-v1.json` makes the first four
differences numeric. For a 10 m cell with NW/NE/SW/SE heights `0/0/0/10`, the centre
height is 2.5 m bilinearly but 5 m on the editor's NW-SE triangle. The legacy span
slope is grade 0.5 (about 26.565 degrees), while the editor triangle slope is 45
degrees.

## Candidate-site scoring fixture

`candidate-site-scoring-v1.json` calls the legacy height and slope formulas over a
small, piecewise-planar terrain. A village candidate is eligible only inside the
sampling margin, at or below grade 0.14, and at least 1,150 m from an accepted
settlement. Eligible candidates use:

```text
edge_penalty   = 1 - min(x, z, world_size - x, world_size - z) / (world_size / 2)
height_penalty = abs(height_m - 75) / 240
score          = slope_grade * 8 + edge_penalty * 0.12
                 + height_penalty + random_unit * 0.1
```

Lower scores are better. The fixture separates scored candidates from hard
rejections and from a point excluded by the radius-aware random sampling domain. It
also records that the legacy radial fallback is deliberately forbidden in the editor:
an all-rejected survey must report no valid site and leave the project unchanged.

## A* fixture

`astar-route-v1.json` invokes the legacy eight-neighbour route search on a 5 x 5 grid
with a single 30 m barrier cell. The legacy noise sampler is replaced by a constant
zero stub so the fixture isolates the terrain cost:

```text
grade         = abs(next_height - current_height) / movement_distance
slope_penalty = grade * grade * 42
step_cost     = movement_distance * (1 + slope_penalty + terrain_wiggle)
heuristic     = Euclidean distance to the goal
```

The fixture contains the raw grid path and the exact two-pass Chaikin result. The
editor port will keep the squared-grade cost concept, replace terrain wiggle with
deterministic tie-breaking plus a turn cost, impose maximum grade and node budgets,
and return an explicit failure instead of the legacy straight-line fallback.

## Frontage fixture

`frontage-policy-v1.json` invokes legacy `_plot_candidates()` with CPython
`random.Random(123)` on one 120 m straight road. It records the initial offset,
variable spacing multipliers, shuffled side order, junction rejection, and final
candidate shuffle. Junction proximity is:

```text
distance(anchor, junction) < junction.radius_m + margin_m
```

The junction check occurs before side candidates are emitted. The separate placement
checks record the later legacy building-centre slope rule, `slope(center, 18) <= 0.26`.
The future editor implementation reuses policy—not CPython's RNG sequence—and keeps
the current frontage engine's catalogue-sized oriented footprints and collision
checks.

## Frozen contracts

`contract-freeze-v1.json` records the contracts that SA-0 through SA-5 must not change:

| Contract | Discriminator/version |
| --- | --- |
| Editable project | `polygon-county-scenery-project`, v4 |
| Runtime scenery | `polygon-county-runtime-scenery`, v3 |
| Resampled vegetation | no format field, v1 |
| Asset catalogue | `polygon-county-asset-catalog`, v3 |
| Viewer bundle manifest | `polygon-county-viewer-bundle`, v1 |

SHA-256 values freeze the four repository JSON Schemas byte-for-byte. Resampled
vegetation v1 has no standalone schema file, so its exact root/object keys and a valid
document are frozen semantically against `parseVegetationReference()`.

Changing a fixture requires an explicit compatibility decision. Porting code should
normally consume these vectors unchanged.
