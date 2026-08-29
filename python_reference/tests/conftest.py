from __future__ import annotations

import json
import uuid

import numpy as np
import pytest

from scenery_editor.model.entities import LandUseRegion, LinearFeature, PlaceRegion, PrefabInstance, Road
from scenery_editor.model.project import SceneryProject, SourceReferences, WorldSpec
from scenery_editor.model.terrain_reference import TerrainReference


def terrain_descriptor(width=20.0, depth=20.0, spacing=10.0, minimum=-100.0, maximum=100.0):
    cells_x, cells_z = round(width / spacing), round(depth / spacing)
    sea, lowland = 0.0, 5.0
    encode = lambda value: round((value - minimum) / (maximum - minimum) * 65535)
    return {
        "world_width_m": width,
        "world_depth_m": depth,
        "terrain_spacing_m": spacing,
        "terrain_cells": {"x": cells_x, "z": cells_z, "total": cells_x * cells_z},
        "elevation_points": {"x": cells_x + 1, "z": cells_z + 1, "total": (cells_x + 1) * (cells_z + 1)},
        "minimum_elevation_m": minimum,
        "sea_level_m": sea,
        "lowland_reference_elevation_m": lowland,
        "maximum_elevation_m": maximum,
        "uint16_reference_values": {"sea_level": encode(sea), "lowland_reference": encode(lowland)},
        "vertical_encoding": "Unsigned 16-bit greyscale: 0 maps to minimum_elevation_m and 65535 maps to maximum_elevation_m; values outside that range are clipped.",
        "grid_layout": "Rows increase along +Z; columns increase along +X.",
        "cell_diagonal": "Each cell is divided from northwest to southeast.",
    }


@pytest.fixture
def terrain_files(tmp_path):
    heights = np.array([[0, 10, 20], [20, 40, 60], [50, 70, 90]], dtype=np.float32)
    npy = tmp_path / "terrain.npy"
    descriptor = tmp_path / "terrain.json"
    np.save(npy, heights)
    descriptor.write_text(json.dumps(terrain_descriptor()), encoding="utf-8")
    return npy, descriptor, heights


@pytest.fixture
def terrain(terrain_files):
    return TerrainReference.load(terrain_files[0], terrain_files[1])


@pytest.fixture
def catalog_document():
    return {
        "format": "polygon-county-asset-catalog",
        "schema_version": 3,
        "category_defaults": {
            "house": {"proxy": {"width_m": 4.0, "depth_m": 8.0, "wall_height_m": 4.5}}
        },
        "assets": {
            "house": {"category": "house", "resource": "buildings/house.glb"}
        },
    }


@pytest.fixture
def project(terrain):
    road = Road(name="Lane", points=((1.0, 1.0), (18.0, 1.0)), width_m=5.0)
    return SceneryProject(
        name="Test Scenery",
        world=WorldSpec(terrain.world_width_m, terrain.world_depth_m, terrain.spacing_m),
        sources=SourceReferences(str(terrain.npy_path), str(terrain.descriptor_path)),
        terrain_fingerprint=terrain.fingerprint.to_dict(),
        places=[PlaceRegion(name="Village", place_type="village", points=((1, 1), (8, 1), (4, 8)))],
        land_use_regions=[LandUseRegion(name="Pasture", points=((10, 10), (18, 10), (14, 18)))],
        roads=[road],
        linear_features=[LinearFeature(name="Hedge", points=((2, 3), (12, 9)))],
        prefab_instances=[PrefabInstance(name="House", category="house", asset_id="house", x_m=5, z_m=5,
                                         rotation_deg=90, frontage_road_id=road.id)],
    )


@pytest.fixture
def vegetation_document():
    return {
        "schema_version": 1,
        "project_id": str(uuid.uuid4()),
        "project_name": "County",
        "coordinate_system": "X east/right, terrain Y elevation, Z south/down; metres",
        "generated_object_count": 1,
        "objects": [{
            "type": "forest_tree", "model_or_species": "oak", "x_m": 4.0, "z_m": 5.0,
            "terrain_y_m": 10.0, "rotation_deg": 33.0, "scale": 1.0,
            "source_region_id": str(uuid.uuid4()),
        }],
    }


@pytest.fixture
def county_document():
    road_id = str(uuid.uuid4())
    return {
        "format": "polygon-county-runtime-features", "schema_version": 3,
        "export_batch_id": str(uuid.uuid4()), "project_id": str(uuid.uuid4()), "project_name": "County",
        "world_width_m": 20.0, "world_depth_m": 20.0,
        "coordinate_system": "X east/right, terrain Y elevation, Z south/down; metres",
        "settlement_regions": [{"id": str(uuid.uuid4()), "name": "Place", "visible": True,
                                "points": [[1, 1], [9, 1], [5, 9]]}],
        "roads": [{"id": road_id, "name": "Road", "visible": True, "points": [[1, 2], [18, 2]],
                   "width_m": 5.0, "surface": "gravel", "elevation_mode": "follow_terrain"}],
        "buildings": [{"id": str(uuid.uuid4()), "name": "House", "visible": True,
                       "building_type": "residential_2storey", "asset_id": "house",
                       "x_m": 5.0, "z_m": 5.0, "terrain_y_m": 13.0, "rotation_deg": 90.0,
                       "footprint_width_m": 4.0, "footprint_depth_m": 8.0,
                       "frontage_road_id": road_id}],
    }
