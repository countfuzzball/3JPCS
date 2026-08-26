from __future__ import annotations

import numpy as np
import pytest

from scenery_editor.model.entities import PrefabInstance, TerrainPad
from scenery_editor.model.working_terrain import WorkingTerrain


def test_pad_flattens_to_immutable_base_origin_height(terrain):
    original = terrain.heights.copy()
    prefab = PrefabInstance(
        name="Small house",
        asset_id="house",
        x_m=5.0,
        z_m=5.0,
        rotation_deg=27.0,
        terrain_pad=TerrainPad(enabled=True, width_m=4.0, depth_m=4.0, blend_m=0.0),
    )
    target = terrain.height_at(prefab.x_m, prefab.z_m)
    working = WorkingTerrain.compose(terrain, [prefab])

    assert working.height_at(5.0, 5.0) == pytest.approx(target)
    assert working.footprint_site_info(
        [(3.0, 3.0), (7.0, 3.0), (7.0, 7.0), (3.0, 7.0)], (5.0, 5.0)
    )["elevation_range_m"] == pytest.approx(0.0, abs=1e-6)
    assert np.array_equal(terrain.heights, original)
    assert terrain.heights.flags.writeable is False
    assert working.heights.flags.writeable is False


def test_smaller_than_grid_pad_still_changes_intersected_cell(terrain):
    prefab = PrefabInstance(
        name="Tiny site",
        asset_id="tiny",
        x_m=5.0,
        z_m=5.0,
        terrain_pad=TerrainPad(enabled=True, width_m=1.0, depth_m=1.0, blend_m=0.0),
    )
    working = WorkingTerrain.compose(terrain, [prefab])
    assert not np.array_equal(working.heights, terrain.heights)
    assert working.height_at(5.0, 5.0) == pytest.approx(terrain.height_at(5.0, 5.0))


def test_hidden_or_disabled_prefabs_do_not_modify_working_terrain(terrain):
    pad = TerrainPad(enabled=True, width_m=8.0, depth_m=8.0, blend_m=4.0)
    hidden = PrefabInstance(name="Hidden", asset_id="house", x_m=5.0, z_m=5.0, visible=False, terrain_pad=pad)
    disabled = PrefabInstance(name="Disabled", asset_id="house", x_m=15.0, z_m=15.0)
    working = WorkingTerrain.compose(terrain, [hidden, disabled])
    assert np.array_equal(working.heights, terrain.heights)


def test_pad_composition_is_deterministic(terrain):
    prefabs = [
        PrefabInstance(
            name="A", asset_id="a", x_m=5.0, z_m=5.0,
            terrain_pad=TerrainPad(enabled=True, width_m=5.0, depth_m=5.0, blend_m=4.0),
        ),
        PrefabInstance(
            name="B", asset_id="b", x_m=11.0, z_m=9.0, rotation_deg=30.0,
            terrain_pad=TerrainPad(enabled=True, width_m=7.0, depth_m=4.0, blend_m=3.0),
        ),
    ]
    first = WorkingTerrain.compose(terrain, prefabs)
    second = WorkingTerrain.compose(terrain, prefabs)
    assert np.array_equal(first.heights, second.heights)
    assert first.sha256 == second.sha256
