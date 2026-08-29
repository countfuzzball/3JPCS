from __future__ import annotations

from pathlib import Path
from typing import Any

from scenery_editor.model.asset_catalog import AssetCatalog
from scenery_editor.model.project import SceneryProject
from scenery_editor.model.validation import ValidationError
from scenery_editor.model.working_terrain import WorkingTerrain

from .common import write_json_atomic
from .reference_import import COORDINATE_SYSTEM


def runtime_document(project: SceneryProject, terrain: WorkingTerrain, asset_catalog: AssetCatalog | None,
                     destination: str | Path | None = None) -> dict[str, Any]:
    project.validate()
    if (terrain.world_width_m, terrain.world_depth_m, terrain.spacing_m) != (
        project.world.width_m, project.world.depth_m, project.world.terrain_spacing_m
    ):
        raise ValidationError("runtime terrain is incompatible with scenery project")
    definitions = asset_catalog.by_asset_id if asset_catalog else {}
    prefab_records = []
    for item in project.prefab_instances:
        definition = definitions.get(item.asset_id)
        prefab_records.append({
            "id": item.id, "name": item.name, "visible": item.visible, "asset_id": item.asset_id,
            "category": item.category, "x_m": item.x_m, "z_m": item.z_m,
            "terrain_y_m": terrain.height_at(item.x_m, item.z_m), "rotation_deg": item.rotation_deg % 360.0,
            "scale": item.scale, "frontage_road_id": item.frontage_road_id,
            "asset_status": "resolved" if definition else "missing",
        })
    return {
        "format": "polygon-county-runtime-scenery",
        "schema_version": 2,
        "coordinate_system": COORDINATE_SYSTEM,
        "world": project.world.to_dict(),
        "terrain_float32_sha256": terrain.sha256,
        "place_regions": [{"id": x.id, "name": x.name, "place_type": x.place_type,
                           "points": [list(p) for p in x.points], "visible": x.visible} for x in project.places],
        "land_use_regions": [{"id": x.id, "name": x.name, "land_use_type": x.land_use_type,
                              "points": [list(p) for p in x.points], "visible": x.visible} for x in project.land_use_regions],
        "roads": [{"id": x.id, "name": x.name, "points": [list(p) for p in x.points],
                   "width_m": x.width_m, "road_class": x.road_class, "surface": x.surface,
                   "elevation_mode": "follow_terrain", "visible": x.visible} for x in project.roads],
        "hedgerows": [{"id": x.id, "name": x.name, "points": [list(p) for p in x.points],
                       "nominal_width_m": x.nominal_width_m, "nominal_height_m": x.nominal_height_m,
                       "visible": x.visible} for x in project.linear_features],
        "prefab_instances": prefab_records,
    }


def export_runtime_scenery(path: str | Path, project: SceneryProject, terrain: WorkingTerrain,
                           asset_catalog: AssetCatalog | None) -> None:
    write_json_atomic(path, runtime_document(project, terrain, asset_catalog, path))
