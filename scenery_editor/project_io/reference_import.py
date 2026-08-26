from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from scenery_editor.model.entities import PlaceRegion, PrefabInstance, Road, TerrainPad
from scenery_editor.model.asset_catalog import AssetCatalog
from scenery_editor.model.project import SceneryProject
from scenery_editor.model.terrain_reference import TerrainReference
from scenery_editor.model.validation import (
    ValidationError,
    ensure_unique,
    finite_number,
    non_empty_string,
    point_list,
    positive_number,
    require_exact_keys,
    uuid_string,
)

from .common import read_json


COORDINATE_SYSTEM = "X east/right, terrain Y elevation, Z south/down; metres"


@dataclass(frozen=True)
class VegetationReference:
    project_id: str
    project_name: str
    objects: tuple[dict[str, Any], ...]
    path: Path


@dataclass(frozen=True)
class CountyReference:
    project_id: str
    project_name: str
    settlement_regions: tuple[dict[str, Any], ...]
    roads: tuple[dict[str, Any], ...]
    buildings: tuple[dict[str, Any], ...]
    path: Path


def load_asset_catalog(path: str | Path) -> AssetCatalog:
    return AssetCatalog.from_document(read_json(path))


def load_vegetation(path: str | Path, terrain: TerrainReference) -> VegetationReference:
    document = read_json(path)
    if not isinstance(document, dict):
        raise ValidationError("vegetation document must be an object")
    require_exact_keys(document, {"schema_version", "project_id", "project_name", "coordinate_system", "generated_object_count", "objects"}, "vegetation")
    if document["schema_version"] != 1:
        raise ValidationError("vegetation schema_version must be 1")
    if document["coordinate_system"] != COORDINATE_SYSTEM:
        raise ValidationError("vegetation coordinate_system is unsupported")
    if not isinstance(document["objects"], list) or document["generated_object_count"] != len(document["objects"]):
        raise ValidationError("vegetation generated_object_count does not match objects")
    objects = []
    keys = {"type", "model_or_species", "x_m", "z_m", "terrain_y_m", "rotation_deg", "scale", "source_region_id"}
    for index, value in enumerate(document["objects"]):
        if not isinstance(value, dict):
            raise ValidationError(f"vegetation.objects[{index}] must be an object")
        require_exact_keys(value, keys, f"vegetation.objects[{index}]")
        object_type = value["type"]
        if object_type not in {"forest_tree", "scattered_tree", "shrub"}:
            raise ValidationError(f"unsupported vegetation type: {object_type}")
        x = finite_number(value["x_m"], f"vegetation.objects[{index}].x_m")
        z = finite_number(value["z_m"], f"vegetation.objects[{index}].z_m")
        if not 0.0 <= x <= terrain.world_width_m or not 0.0 <= z <= terrain.world_depth_m:
            raise ValidationError(f"vegetation.objects[{index}] lies outside the world")
        objects.append({
            "type": object_type,
            "model_or_species": non_empty_string(value["model_or_species"], f"vegetation.objects[{index}].model_or_species"),
            "x_m": x, "z_m": z,
            "terrain_y_m": finite_number(value["terrain_y_m"], f"vegetation.objects[{index}].terrain_y_m"),
            "rotation_deg": finite_number(value["rotation_deg"], f"vegetation.objects[{index}].rotation_deg"),
            "scale": positive_number(value["scale"], f"vegetation.objects[{index}].scale"),
            "source_region_id": uuid_string(value["source_region_id"], f"vegetation.objects[{index}].source_region_id"),
        })
    return VegetationReference(uuid_string(document["project_id"], "vegetation.project_id"),
                               non_empty_string(document["project_name"], "vegetation.project_name"),
                               tuple(objects), Path(path).resolve())


def load_county_features(path: str | Path, terrain: TerrainReference) -> CountyReference:
    document = read_json(path)
    if not isinstance(document, dict):
        raise ValidationError("county features document must be an object")
    top_keys = {"format", "schema_version", "export_batch_id", "project_id", "project_name", "world_width_m", "world_depth_m", "coordinate_system", "settlement_regions", "roads", "buildings"}
    require_exact_keys(document, top_keys, "county features")
    if document["format"] != "polygon-county-runtime-features" or document["schema_version"] != 3:
        raise ValidationError("county features must use runtime schema v3")
    if document["coordinate_system"] != COORDINATE_SYSTEM:
        raise ValidationError("county coordinate_system is unsupported")
    uuid_string(document["export_batch_id"], "county.export_batch_id")
    project_id = uuid_string(document["project_id"], "county.project_id")
    project_name = non_empty_string(document["project_name"], "county.project_name")
    width = positive_number(document["world_width_m"], "county.world_width_m")
    depth = positive_number(document["world_depth_m"], "county.world_depth_m")
    if abs(width - terrain.world_width_m) > 1e-6 or abs(depth - terrain.world_depth_m) > 1e-6:
        raise ValidationError("county world dimensions do not match terrain")
    if any(not isinstance(document[name], list) for name in ("settlement_regions", "roads", "buildings")):
        raise ValidationError("county feature collections must be arrays")
    settlements = []
    for index, value in enumerate(document["settlement_regions"]):
        require_exact_keys(value, {"id", "name", "visible", "points"}, f"settlement_regions[{index}]")
        settlements.append({"id": uuid_string(value["id"], f"settlement_regions[{index}].id"),
                            "name": non_empty_string(value["name"], f"settlement_regions[{index}].name"),
                            "visible": _boolean(value["visible"], f"settlement_regions[{index}].visible"),
                            "points": point_list(value["points"], 3, width, depth, f"settlement_regions[{index}].points")})
    roads = []
    road_ids: set[str] = set()
    for index, value in enumerate(document["roads"]):
        require_exact_keys(value, {"id", "name", "visible", "points", "width_m", "surface", "elevation_mode"}, f"roads[{index}]")
        if value["elevation_mode"] != "follow_terrain":
            raise ValidationError(f"roads[{index}] must follow terrain")
        road_id = uuid_string(value["id"], f"roads[{index}].id")
        roads.append({"id": road_id, "name": non_empty_string(value["name"], f"roads[{index}].name"),
                      "visible": _boolean(value["visible"], f"roads[{index}].visible"),
                      "points": point_list(value["points"], 2, width, depth, f"roads[{index}].points"),
                      "width_m": positive_number(value["width_m"], f"roads[{index}].width_m"),
                      "surface": non_empty_string(value["surface"], f"roads[{index}].surface"),
                      "elevation_mode": "follow_terrain"})
        road_ids.add(road_id)
    buildings = []
    building_keys = {"id", "name", "visible", "building_type", "asset_id", "x_m", "z_m", "terrain_y_m", "rotation_deg", "footprint_width_m", "footprint_depth_m", "frontage_road_id"}
    for index, value in enumerate(document["buildings"]):
        require_exact_keys(value, building_keys, f"buildings[{index}]")
        x = finite_number(value["x_m"], f"buildings[{index}].x_m")
        z = finite_number(value["z_m"], f"buildings[{index}].z_m")
        if not 0.0 <= x <= width or not 0.0 <= z <= depth:
            raise ValidationError(f"buildings[{index}] lies outside the world")
        frontage = value["frontage_road_id"]
        if frontage is not None:
            frontage = uuid_string(frontage, f"buildings[{index}].frontage_road_id")
            if frontage not in road_ids:
                raise ValidationError(f"buildings[{index}].frontage_road_id does not resolve")
        asset_id = value["asset_id"]
        if asset_id is not None:
            asset_id = non_empty_string(asset_id, f"buildings[{index}].asset_id")
        buildings.append({
            "id": uuid_string(value["id"], f"buildings[{index}].id"),
            "name": non_empty_string(value["name"], f"buildings[{index}].name"),
            "visible": _boolean(value["visible"], f"buildings[{index}].visible"),
            "building_type": non_empty_string(value["building_type"], f"buildings[{index}].building_type"),
            "asset_id": asset_id, "x_m": x, "z_m": z,
            "terrain_y_m": finite_number(value["terrain_y_m"], f"buildings[{index}].terrain_y_m"),
            "rotation_deg": finite_number(value["rotation_deg"], f"buildings[{index}].rotation_deg"),
            "footprint_width_m": positive_number(value["footprint_width_m"], f"buildings[{index}].footprint_width_m"),
            "footprint_depth_m": positive_number(value["footprint_depth_m"], f"buildings[{index}].footprint_depth_m"),
            "frontage_road_id": frontage,
        })
    ensure_unique((item["id"] for group in (settlements, roads, buildings) for item in group), "county object id")
    return CountyReference(project_id, project_name, tuple(settlements), tuple(roads), tuple(buildings), Path(path).resolve())


def _boolean(value: Any, context: str) -> bool:
    if not isinstance(value, bool):
        raise ValidationError(f"{context} must be a boolean")
    return value


def convert_county_to_native(project: SceneryProject, county: CountyReference) -> list[str]:
    """Append a one-time migration of supported county v3 records."""
    warnings: list[str] = []
    existing_ids = {item.id for item in project.all_objects()}
    imported_roads: set[str] = set()
    for item in county.settlement_regions:
        if item["id"] in existing_ids:
            warnings.append(f"Skipped duplicate county object {item['id']}")
            continue
        project.places.append(PlaceRegion(id=item["id"], name=item["name"], place_type="village",
                                          points=tuple(item["points"]), visible=item["visible"], locked=False))
        existing_ids.add(item["id"])
    for item in county.roads:
        if item["id"] in existing_ids:
            warnings.append(f"Skipped duplicate county object {item['id']}")
            continue
        surface = item["surface"] if item["surface"] in Road.SURFACES else "gravel"
        project.roads.append(Road(id=item["id"], name=item["name"], points=tuple(item["points"]),
                                  width_m=item["width_m"], road_class="local_road", surface=surface,
                                  visible=item["visible"], locked=False))
        imported_roads.add(item["id"])
        existing_ids.add(item["id"])
    road_ids = {road.id for road in project.roads}
    for item in county.buildings:
        if item["id"] in existing_ids:
            warnings.append(f"Skipped duplicate county object {item['id']}")
            continue
        asset_id = item["asset_id"] or item["building_type"]
        if item["asset_id"] is None:
            warnings.append(f"Building {item['name']} had no asset_id; using {asset_id!r} as an unresolved asset")
        frontage = item["frontage_road_id"] if item["frontage_road_id"] in road_ids else None
        project.prefab_instances.append(PrefabInstance(
            id=item["id"], name=item["name"], category=item["building_type"], asset_id=asset_id,
            x_m=item["x_m"], z_m=item["z_m"], rotation_deg=item["rotation_deg"],
            frontage_road_id=frontage, visible=item["visible"], locked=False,
            terrain_pad=TerrainPad(),
        ))
        existing_ids.add(item["id"])
    project.validate()
    return warnings
