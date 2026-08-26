from __future__ import annotations

import json
from dataclasses import replace

import numpy as np
import pytest
from PIL import Image

from scenery_editor.model.entities import LandUseRegion, LinearFeature, PlaceRegion, PrefabInstance, Road, TerrainPad
from scenery_editor.model.asset_catalog import AssetCatalog
from scenery_editor.model.project import SourceReferences
from scenery_editor.model.validation import ValidationError
from scenery_editor.model.working_terrain import WorkingTerrain
from scenery_editor.project_io.final_export import (
    export_final_heightmap,
    resampled_vegetation_document,
)
from scenery_editor.project_io.reference_import import load_vegetation
from scenery_editor.project_io.runtime_export import export_runtime_scenery, runtime_document
from scenery_editor.project_io.scenery_project_io import load_project, save_project


@pytest.mark.parametrize("attribute, cls", [
    ("places", PlaceRegion), ("land_use_regions", LandUseRegion), ("roads", Road),
    ("linear_features", LinearFeature), ("prefab_instances", PrefabInstance),
])
def test_authored_object_save_load(attribute, cls, tmp_path, project):
    path = tmp_path / "project.scenery.json"
    save_project(path, project)
    loaded = load_project(path).project
    assert getattr(loaded, attribute) == getattr(project, attribute)
    assert isinstance(getattr(loaded, attribute)[0], cls)


def test_stable_uuid_and_full_project_round_trip(tmp_path, project):
    path = tmp_path / "project.scenery.json"
    original_ids = [item.id for item in project.all_objects()]
    save_project(path, project)
    loaded = load_project(path).project
    assert [item.id for item in loaded.all_objects()] == original_ids
    assert loaded.authored_snapshot() == project.authored_snapshot()
    document = json.loads(path.read_text())
    assert document["format"] == "polygon-county-scenery-project"
    assert document["schema_version"] == 3
    assert "asset_catalog" in document["sources"]
    assert "prefab_catalog" not in document["sources"]
    assert "heights" not in document and "terrain" not in document


def test_terrain_source_fingerprint_change_warns(tmp_path, project, terrain_files):
    path = tmp_path / "project.scenery.json"
    save_project(path, project)
    np.save(terrain_files[0], terrain_files[2] + np.float32(1.0))
    loaded = load_project(path)
    assert any("contents changed" in warning for warning in loaded.warnings)
    assert loaded.project.terrain_fingerprint["sha256"] == loaded.terrain.sha256


def test_dimensionally_incompatible_fingerprint_rejected(tmp_path, project):
    path = tmp_path / "project.scenery.json"
    save_project(path, project)
    document = json.loads(path.read_text())
    document["terrain_fingerprint"]["point_count_x"] = 999
    path.write_text(json.dumps(document))
    with pytest.raises(ValidationError, match="incompatible"):
        load_project(path)


def test_runtime_scenery_export(tmp_path, project, terrain, catalog_document):
    catalog = AssetCatalog.from_document(catalog_document)
    working = WorkingTerrain.compose(terrain, project.prefab_instances)
    document = runtime_document(project, working, catalog)
    assert document["format"] == "polygon-county-runtime-scenery"
    assert document["roads"][0]["elevation_mode"] == "follow_terrain"
    assert all("y_m" not in key for key in document["roads"][0])
    assert document["prefab_instances"][0]["terrain_y_m"] == pytest.approx(terrain.height_at(5, 5))
    output = tmp_path / "runtime.json"
    export_runtime_scenery(output, project, working, catalog)
    exported = json.loads(output.read_text())
    assert exported["schema_version"] == 2
    assert "prefab_catalog" not in exported
    assert "asset_catalog" not in exported
    assert exported["terrain_float32_sha256"] == working.sha256


def test_missing_prefab_handling_is_explicit(project, terrain):
    project.prefab_instances[0] = project.prefab_instances[0].copy_with(asset_id="not_in_catalog")
    document = runtime_document(project, WorkingTerrain.compose(terrain, project.prefab_instances), None)
    assert document["prefab_instances"][0]["asset_status"] == "missing"


def test_runtime_prefab_y_uses_composed_working_terrain(project, terrain):
    source = project.prefab_instances[0]
    project.prefab_instances[0] = source.copy_with(
        terrain_pad=TerrainPad(enabled=True, width_m=2.0, depth_m=2.0, blend_m=0.0)
    )
    observer = PrefabInstance(name="Observer", asset_id="observer", x_m=1.0, z_m=1.0)
    project.prefab_instances.append(observer)
    working = WorkingTerrain.compose(terrain, project.prefab_instances)
    document = runtime_document(project, working, None)
    observer_record = next(item for item in document["prefab_instances"] if item["id"] == observer.id)
    assert observer_record["terrain_y_m"] == pytest.approx(working.height_at(1.0, 1.0))
    assert observer_record["terrain_y_m"] != pytest.approx(terrain.height_at(1.0, 1.0))
    assert "terrain_pad" not in observer_record


def test_missing_optional_asset_catalog_warns_but_project_opens(tmp_path, project):
    project.sources = SourceReferences(
        terrain_npy=project.sources.terrain_npy,
        terrain_descriptor=project.sources.terrain_descriptor,
        asset_catalog=str(tmp_path / "moved_catalog.json"),
    )
    path = tmp_path / "project.scenery.json"
    save_project(path, project)
    loaded = load_project(path)
    assert loaded.asset_catalog is None
    assert any("catalogue source is missing" in warning for warning in loaded.warnings)


def test_out_of_bounds_authored_geometry_rejected(project):
    project.places[0] = project.places[0].copy_with(points=((1, 1), (30, 1), (4, 8)))
    with pytest.raises(ValidationError, match="outside"):
        project.validate()


def test_duplicate_authored_uuid_rejected(project):
    project.linear_features[0] = project.linear_features[0].copy_with(id=project.roads[0].id)
    with pytest.raises(ValidationError, match="duplicate"):
        project.validate()


def test_locked_visible_and_rotation_round_trip(tmp_path, project):
    instance = project.prefab_instances[0]
    project.prefab_instances[0] = instance.copy_with(locked=True, visible=False, rotation_deg=450.0)
    path = tmp_path / "project.scenery.json"
    save_project(path, project)
    loaded = load_project(path).project.prefab_instances[0]
    assert loaded.locked is True and loaded.visible is False
    assert loaded.rotation_deg == 450.0


def test_project_v1_migrates_prefabs_to_disabled_terrain_pads(tmp_path, project):
    path = tmp_path / "legacy.scenery.json"
    save_project(path, project)
    document = json.loads(path.read_text())
    document["schema_version"] = 1
    document["sources"]["prefab_catalog"] = document["sources"].pop("asset_catalog")
    for prefab in document["prefab_instances"]:
        prefab.pop("terrain_pad")
    path.write_text(json.dumps(document), encoding="utf-8")
    loaded = load_project(path)
    assert loaded.project.prefab_instances[0].terrain_pad.enabled is False
    assert loaded.project.sources.asset_catalog is None


def test_project_v2_catalog_source_migrates_and_resaves_as_v3(
    tmp_path, project, catalog_document
):
    catalog_path = tmp_path / "assets.json"
    catalog_path.write_text(json.dumps(catalog_document), encoding="utf-8")
    project.sources = replace(project.sources, asset_catalog=str(catalog_path))
    legacy_path = tmp_path / "legacy-v2.scenery.json"
    save_project(legacy_path, project)
    document = json.loads(legacy_path.read_text())
    document["schema_version"] = 2
    document["sources"]["prefab_catalog"] = document["sources"].pop("asset_catalog")
    legacy_path.write_text(json.dumps(document), encoding="utf-8")

    loaded = load_project(legacy_path)
    assert loaded.project.sources.asset_catalog == str(catalog_path.resolve())
    assert loaded.asset_catalog is not None
    assert (
        loaded.project.prefab_instances[0].terrain_pad
        == project.prefab_instances[0].terrain_pad
    )

    migrated_path = tmp_path / "migrated.scenery.json"
    save_project(migrated_path, loaded.project)
    migrated = json.loads(migrated_path.read_text())
    assert migrated["schema_version"] == 3
    assert migrated["sources"]["asset_catalog"] == "assets.json"
    assert "prefab_catalog" not in migrated["sources"]


def test_final_heightmap_and_resampled_vegetation(
    tmp_path, project, terrain, vegetation_document
):
    instance = project.prefab_instances[0]
    project.prefab_instances[0] = instance.copy_with(
        terrain_pad=TerrainPad(enabled=True, width_m=4.0, depth_m=4.0, blend_m=0.0)
    )
    working = WorkingTerrain.compose(terrain, project.prefab_instances)
    png_path = tmp_path / "final.png"
    metadata_path = export_final_heightmap(png_path, working)
    assert png_path.exists() and metadata_path == tmp_path / "final.json"
    metadata = json.loads(metadata_path.read_text())
    assert metadata["elevation_points"] == {"x": 3, "z": 3, "total": 9}
    assert "schema_version" not in metadata
    with Image.open(png_path) as image:
        assert image.size == (3, 3)
        assert image.mode in {"I;16", "I"}
        samples = np.asarray(image, dtype=np.float64)
    decoded = metadata["minimum_elevation_m"] + samples / 65535.0 * (
        metadata["maximum_elevation_m"] - metadata["minimum_elevation_m"]
    )
    half_step = (metadata["maximum_elevation_m"] - metadata["minimum_elevation_m"]) / 65535.0 / 2.0
    assert np.max(np.abs(decoded - working.heights)) <= half_step + 1e-9

    vegetation_path = tmp_path / "vegetation.json"
    vegetation_path.write_text(json.dumps(vegetation_document), encoding="utf-8")
    vegetation = load_vegetation(vegetation_path, terrain)
    exported = resampled_vegetation_document(vegetation, working)
    assert exported["generated_object_count"] == len(vegetation.objects)
    assert exported["objects"][0]["terrain_y_m"] == pytest.approx(
        working.height_at(4.0, 5.0)
    )
