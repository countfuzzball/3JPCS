from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from scenery_editor.model.entities import LandUseRegion, LinearFeature, PlaceRegion, PrefabInstance, Road
from scenery_editor.model.asset_catalog import AssetCatalog
from scenery_editor.model.project import SceneryProject, SourceReferences, WorldSpec
from scenery_editor.model.terrain_reference import TerrainReference
from scenery_editor.model.validation import ValidationError, non_empty_string, positive_number, require_exact_keys

from .common import portable_source_path, read_json, resolve_source_path, write_json_atomic
from .reference_import import CountyReference, VegetationReference, load_asset_catalog, load_county_features, load_vegetation


@dataclass(frozen=True)
class LoadedProject:
    project: SceneryProject
    terrain: TerrainReference
    vegetation: VegetationReference | None
    county: CountyReference | None
    asset_catalog: AssetCatalog | None
    warnings: tuple[str, ...]


def project_document(project: SceneryProject, destination: str | Path) -> dict[str, Any]:
    project.validate()
    path = Path(destination).resolve()
    sources = project.sources
    return {
        "format": "polygon-county-scenery-project",
        "schema_version": 3,
        "name": project.name,
        "world": project.world.to_dict(),
        "sources": {
            "terrain_npy": portable_source_path(sources.terrain_npy, path),
            "terrain_descriptor": portable_source_path(sources.terrain_descriptor, path),
            "vegetation": portable_source_path(sources.vegetation, path),
            "county_features": portable_source_path(sources.county_features, path),
            "asset_catalog": portable_source_path(sources.asset_catalog, path),
        },
        "terrain_fingerprint": dict(project.terrain_fingerprint),
        "places": [item.to_dict() for item in project.places],
        "land_use_regions": [item.to_dict() for item in project.land_use_regions],
        "roads": [item.to_dict() for item in project.roads],
        "linear_features": [item.to_dict() for item in project.linear_features],
        "prefab_instances": [item.to_dict() for item in project.prefab_instances],
    }


def save_project(path: str | Path, project: SceneryProject) -> None:
    write_json_atomic(path, project_document(project, path))


def load_project(path: str | Path) -> LoadedProject:
    project_path = Path(path).resolve()
    document = read_json(project_path)
    if not isinstance(document, dict):
        raise ValidationError("scenery project must be an object")
    top_keys = {"format", "schema_version", "name", "world", "sources", "terrain_fingerprint", "places", "land_use_regions", "roads", "linear_features", "prefab_instances"}
    require_exact_keys(document, top_keys, "scenery project")
    if (
        document["format"] != "polygon-county-scenery-project"
        or isinstance(document["schema_version"], bool)
        or document["schema_version"] not in {1, 2, 3}
    ):
        raise ValidationError("unsupported scenery project format or schema version")
    schema_version = document["schema_version"]
    world_value = document["world"]
    require_exact_keys(world_value, {"width_m", "depth_m", "terrain_spacing_m"}, "world")
    world = WorldSpec(positive_number(world_value["width_m"], "world.width_m"),
                      positive_number(world_value["depth_m"], "world.depth_m"),
                      positive_number(world_value["terrain_spacing_m"], "world.terrain_spacing_m"))
    source_value = document["sources"]
    catalog_source_key = "asset_catalog" if schema_version >= 3 else "prefab_catalog"
    common_source_keys = {"terrain_npy", "terrain_descriptor", "vegetation", "county_features"}
    source_keys = common_source_keys | {catalog_source_key}
    require_exact_keys(source_value, source_keys, "sources")
    for key in ("terrain_npy", "terrain_descriptor"):
        non_empty_string(source_value[key], f"sources.{key}")
    for key in ("vegetation", "county_features", catalog_source_key):
        if source_value[key] is not None:
            non_empty_string(source_value[key], f"sources.{key}")
    resolved = {
        key: resolve_source_path(source_value[key], project_path)
        for key in common_source_keys
    }
    resolved["asset_catalog"] = resolve_source_path(source_value[catalog_source_key], project_path)
    if resolved["terrain_npy"] is None or resolved["terrain_descriptor"] is None:
        raise ValidationError("terrain sources are required")
    terrain = TerrainReference.load(resolved["terrain_npy"], resolved["terrain_descriptor"])
    if abs(world.width_m - terrain.world_width_m) > 1e-6 or abs(world.depth_m - terrain.world_depth_m) > 1e-6 or abs(world.terrain_spacing_m - terrain.spacing_m) > 1e-6:
        raise ValidationError("terrain source dimensions/spacing are incompatible with the saved scenery world")
    fingerprint = document["terrain_fingerprint"]
    expected_fingerprint_keys = {"sha256", "world_width_m", "world_depth_m", "spacing_m", "cell_count_x", "cell_count_z", "point_count_x", "point_count_z"}
    require_exact_keys(fingerprint, expected_fingerprint_keys, "terrain_fingerprint")
    sha256 = fingerprint["sha256"]
    if not isinstance(sha256, str) or len(sha256) != 64 or any(character not in "0123456789abcdef" for character in sha256):
        raise ValidationError("terrain_fingerprint.sha256 must be 64 lowercase hexadecimal characters")
    for key in ("world_width_m", "world_depth_m", "spacing_m"):
        positive_number(fingerprint[key], f"terrain_fingerprint.{key}")
    for key in ("cell_count_x", "cell_count_z", "point_count_x", "point_count_z"):
        if isinstance(fingerprint[key], bool) or not isinstance(fingerprint[key], int) or fingerprint[key] <= 0:
            raise ValidationError(f"terrain_fingerprint.{key} must be a positive integer")
    dimensions = terrain.fingerprint.to_dict()
    for key in expected_fingerprint_keys - {"sha256"}:
        if fingerprint[key] != dimensions[key]:
            raise ValidationError(f"terrain source fingerprint is dimensionally incompatible ({key})")
    warnings = []
    if fingerprint["sha256"] != terrain.sha256:
        warnings.append("Terrain NPY contents changed, but dimensions remain compatible; prefab site heights were resampled.")
    sources = SourceReferences(**{key: str(value) if value is not None else None for key, value in resolved.items()})
    project = SceneryProject(name=non_empty_string(document["name"], "project.name"), world=world,
                             sources=sources, terrain_fingerprint=terrain.fingerprint.to_dict())
    collection_types = (("places", PlaceRegion), ("land_use_regions", LandUseRegion),
                        ("roads", Road), ("linear_features", LinearFeature))
    for name, cls in collection_types:
        if not isinstance(document[name], list):
            raise ValidationError(f"{name} must be an array")
        setattr(project, name, [cls.from_dict(value, world.width_m, world.depth_m) for value in document[name]])
    if not isinstance(document["prefab_instances"], list):
        raise ValidationError("prefab_instances must be an array")
    road_ids = {road.id for road in project.roads}
    project.prefab_instances = [
        PrefabInstance.from_dict(
            value,
            world.width_m,
            world.depth_m,
            road_ids,
            schema_version=schema_version,
        )
        for value in document["prefab_instances"]
    ]
    project.validate()
    vegetation = county = asset_catalog = None
    if resolved["vegetation"] is not None:
        if resolved["vegetation"].exists():
            vegetation = load_vegetation(resolved["vegetation"], terrain)
        else:
            warnings.append(f"Optional vegetation source is missing: {resolved['vegetation']}")
    if resolved["county_features"] is not None:
        if resolved["county_features"].exists():
            county = load_county_features(resolved["county_features"], terrain)
        else:
            warnings.append(f"Optional county-features source is missing: {resolved['county_features']}")
    if vegetation and county and vegetation.project_id != county.project_id:
        raise ValidationError("vegetation and county project IDs disagree")
    if resolved["asset_catalog"] is not None:
        if resolved["asset_catalog"].exists():
            asset_catalog = load_asset_catalog(resolved["asset_catalog"])
            missing = sorted({item.asset_id for item in project.prefab_instances} - set(asset_catalog.by_asset_id))
            if missing:
                warnings.append(f"Missing asset catalogue entries: {', '.join(missing)}")
        else:
            warnings.append(f"Optional asset catalogue source is missing: {resolved['asset_catalog']}")
    if asset_catalog is None and project.prefab_instances:
        warnings.append("Project contains prefab instances but has no usable asset catalogue source.")
    return LoadedProject(project, terrain, vegetation, county, asset_catalog, tuple(warnings))
