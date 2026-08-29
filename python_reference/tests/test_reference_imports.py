import json

import pytest

from scenery_editor.model.geometry import prefab_footprint
from scenery_editor.model.asset_catalog import AssetCatalog
from scenery_editor.model.validation import ValidationError
from scenery_editor.project_io.reference_import import (
    convert_county_to_native,
    load_county_features,
    load_vegetation,
)


def test_vegetation_schema_v1_parsing(tmp_path, terrain, vegetation_document):
    path = tmp_path / "vegetation.json"
    path.write_text(json.dumps(vegetation_document))
    result = load_vegetation(path, terrain)
    assert result.objects[0]["type"] == "forest_tree"
    assert result.objects[0]["x_m"] == 4.0


def test_vegetation_count_mismatch_rejected(tmp_path, terrain, vegetation_document):
    vegetation_document["generated_object_count"] = 2
    path = tmp_path / "vegetation.json"
    path.write_text(json.dumps(vegetation_document))
    with pytest.raises(ValidationError, match="count"):
        load_vegetation(path, terrain)


def test_vegetation_out_of_bounds_rejected(tmp_path, terrain, vegetation_document):
    vegetation_document["objects"][0]["x_m"] = 21
    path = tmp_path / "vegetation.json"
    path.write_text(json.dumps(vegetation_document))
    with pytest.raises(ValidationError, match="outside"):
        load_vegetation(path, terrain)


def test_county_schema_v3_parsing(tmp_path, terrain, county_document):
    path = tmp_path / "county.json"
    path.write_text(json.dumps(county_document))
    result = load_county_features(path, terrain)
    assert len(result.settlement_regions) == len(result.roads) == len(result.buildings) == 1


def test_county_v2_is_not_interpreted_as_v3(tmp_path, terrain, county_document):
    county_document["schema_version"] = 2
    path = tmp_path / "county.json"
    path.write_text(json.dumps(county_document))
    with pytest.raises(ValidationError, match="v3"):
        load_county_features(path, terrain)


def test_county_import_converts_supported_records(tmp_path, terrain, county_document, project):
    project.places.clear(); project.roads.clear(); project.prefab_instances.clear()
    path = tmp_path / "county.json"
    path.write_text(json.dumps(county_document))
    warnings = convert_county_to_native(project, load_county_features(path, terrain))
    assert not warnings
    assert project.places[0].place_type == "village"
    assert project.roads[0].points == ((1.0, 2.0), (18.0, 2.0))
    assert project.prefab_instances[0].frontage_road_id == project.roads[0].id
    assert project.prefab_instances[0].terrain_pad.enabled is False
    assert project.prefab_instances[0].terrain_pad.width_m == 12.0


def test_shared_asset_catalog_parsing(catalog_document):
    catalog = AssetCatalog.from_document(catalog_document)
    assert catalog.by_asset_id["house"].resource == "buildings/house.glb"
    assert catalog.proxy_for_category("house").depth_m == 8.0
    assert catalog.to_document() == catalog_document


def test_asset_catalog_rejects_nonminimal_asset_records(catalog_document):
    catalog_document["assets"]["house"]["footprint_m"] = {"width": 4, "depth": 8}
    with pytest.raises(ValidationError, match="unknown"):
        AssetCatalog.from_document(catalog_document)


def test_legacy_catalog_is_explicitly_rejected():
    legacy = {
        "format": "polygon-county-prefab-catalog",
        "schema_version": 1,
        "prefabs": [{
            "asset_id": "legacy_house",
            "name": "Legacy House",
            "category": "house",
            "glb_path": "assets/legacy.glb",
            "footprint_width_m": 10.0,
            "footprint_depth_m": 14.0,
            "forward_axis": "-Z",
        }],
    }
    with pytest.raises(ValidationError, match="asset catalogue"):
        AssetCatalog.from_document(legacy)


def test_prefab_footprint_rotation_convention():
    unrotated = prefab_footprint(10, 10, 4, 8, 0)
    rotated = prefab_footprint(10, 10, 4, 8, 90)
    assert unrotated[0] == pytest.approx((8, 6))
    assert rotated[0] == pytest.approx((14, 8))
